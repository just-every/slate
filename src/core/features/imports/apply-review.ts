import {restoredNativeSource} from './native-source';
import {readNormalizedSource} from './source-store';
import {cancelImportPreparation,cleanCancelledMedia} from './cancel-preparation';
import {retainedImportReport,storeReportSection} from './report-store';
import {retainedZipBody,retainedArchiveHash} from './archive-r2';
import {storeImportedSource} from '../media/import-source';
import {PlanTooLargeError,PLAN_BYTES_LIMIT,prepareD1ImportStream,publishD1ImportPreparation,resumeD1ImportStream,undoD1ImportStream,readD1ImportUndoReport} from '../../../../modules/import-kit/src/d1/index.ts';
import {ApiProblem} from '../../app/problems';
import {mutationGuard} from '../../app/operations';
import {createUlid} from '../../shared/ulid';
import {incompleteImportSearchSql,verifySearchable} from '../search/service';
import {kitContext} from './kit-context';
import {type StoredReview,type PreviewJob} from './preview';
import type {ImportRequestContext} from './request-context';

export interface ReviewedJob extends PreviewJob {kit_id:string|null;report_json:string;counts_json:string;progress_json:string}
async function readReview(ctx:ImportRequestContext,job:ReviewedJob):Promise<StoredReview> {
  if(!job.plan_key)throw new ApiProblem(409,'IMPORT_PREVIEW_REQUIRED','Review this import before applying it.');
  const object=await ctx.files.get(job.plan_key);if(!object)throw new ApiProblem(409,'IMPORT_PLAN_MISSING','The reviewed import plan is missing.');
  return await object.json<StoredReview>();
}
export async function applyReviewedImport(ctx:ImportRequestContext,job:ReviewedJob,fingerprint?:string) {
  if(job.state==='completed')return;
  if(!['preview','preparing','running','indexing'].includes(job.state))throw new ApiProblem(409,'IMPORT_PREVIEW_REQUIRED','Review this import before applying it.');
  const review=await readReview(ctx,job),context=await kitContext(ctx,job);
  const planBytes=review.planBytes??JSON.parse(job.report_json).planBytes;
  if(planBytes>PLAN_BYTES_LIMIT)throw new PlanTooLargeError(planBytes,PLAN_BYTES_LIMIT,'plan');
  const permission=context.authorization.predicate('apply',job.id),authorized=()=>mutationGuard(ctx.db,`SELECT (${permission.sql})`,permission.params as (string|number|null)[]);
  if(job.state==='preview'){
    if(fingerprint!==review.stream.fingerprint)throw new ApiProblem(409,'IMPORT_REVIEW_CHANGED','Review the current import plan before applying it.');
    await ctx.db.batch([authorized(),ctx.db.prepare("UPDATE federation_imports SET state='preparing',progress_json=?,revision_id=?,updated_at=? WHERE id=? AND state='preview' AND revision_id=?").bind(JSON.stringify({phase:'media',checkpoint:0,total:review.mediaSources.length}),createUlid(),ctx.now,job.id,job.revision_id),authorized()]);return;
  }
  if(job.state==='preparing'){
    if(!job.kit_id){
      const previous=JSON.parse(job.progress_json??'{}'),start=previous.checkpoint??0;
      if(start<review.mediaSources.length){
        const authorization=context.authorization.predicate('apply',job.id),guards=()=>mutationGuard(ctx.db,`SELECT (${authorization.sql})`,authorization.params as (string|number|null)[]);
        const original=await ctx.files.head(job.archive_key);if(!original)throw new ApiProblem(409,'IMPORT_ARCHIVE_MISSING','The retained archive is missing.');
        if(original.etag!==review.archiveETag){if(await retainedArchiveHash(ctx.files,job.archive_key,original.etag)!==review.archiveHash)throw new ApiProblem(409,'IMPORT_ARCHIVE_CHANGED','The retained archive no longer matches the reviewed original.');review.archiveETag=original.etag;}
        let end=start,bytes=0;const attempted:string[]=[];
        try {
        for(;end<review.mediaSources.length&&end<start+8&&(end===start||bytes<32*1024*1024);end++){
          const media=review.mediaSources[end]!;
          attempted.push(media.storageKey);
          await storeImportedSource(ctx.files,media.storageKey,media.contentType,{sizeBytes:media.entry.expandedBytes,open:()=>retainedZipBody(ctx.files,job.archive_key,review.archiveETag,media.entry)},media.sizeBytes);bytes+=media.sizeBytes;
        }
        await ctx.db.batch([guards(),mutationGuard(ctx.db,"SELECT state='preparing' AND kit_id IS NULL AND json_extract(progress_json,'$.checkpoint')=? FROM federation_imports WHERE id=?",[start,job.id]),ctx.db.prepare('UPDATE import_objects SET available=1 WHERE import_id=? AND storage_key IN (SELECT value FROM json_each(?))').bind(job.id,JSON.stringify(review.mediaSources.slice(start,end).map(item=>item.storageKey))),ctx.db.prepare('UPDATE federation_imports SET progress_json=?,updated_at=? WHERE id=?').bind(JSON.stringify({phase:'media',checkpoint:end,total:review.mediaSources.length}),ctx.now,job.id),guards()]);
        }catch(error){await cleanCancelledMedia(ctx,job,attempted);throw error;}return;
      }
      const object=await ctx.files.get(review.sourceKey);if(!object)throw new ApiProblem(409,'IMPORT_PLAN_MISSING','The reviewed normalized source is missing.');
      const {source,mapping}=restoredNativeSource(await readNormalizedSource(object.body),true);
      const preparation=await prepareD1ImportStream(source,mapping,{...context,reviewedFingerprint:review.stream.fingerprint});
      await ctx.db.batch([authorized(),ctx.db.prepare("UPDATE federation_imports SET kit_id=?,revision_id=?,updated_at=? WHERE id=? AND state='preparing' AND kit_id IS NULL AND import_generation=?").bind(preparation.id,createUlid(),ctx.now,job.id,job.import_generation),authorized()]);return;
    }
    const stream=await publishD1ImportPreparation(job.kit_id!,context);
    await ctx.db.batch([authorized(),ctx.db.prepare("UPDATE federation_imports SET state='running',kit_id=?,revision_id=?,updated_at=? WHERE id=? AND state='preparing' AND import_generation=?").bind(stream.id,createUlid(),ctx.now,job.id,job.import_generation),authorized()]);return;
  }
  if(job.state==='running'){
    const progress=await resumeD1ImportStream(job.kit_id!,context);
    await ctx.db.batch([authorized(),ctx.db.prepare("UPDATE federation_imports SET progress_json=?,updated_at=? WHERE id=? AND import_generation=? AND state='running'").bind(JSON.stringify({checkpoint:progress.checkpoint,total:progress.total,state:progress.state}),ctx.now,job.id,job.import_generation),authorized()]);
    if(progress.state!=='completed')return;
    const authorization=context.authorization.predicate('apply',job.id);
    const guard=()=>mutationGuard(ctx.db,`SELECT (${authorization.sql})`,authorization.params as (string|number|null)[]);
    // Visibility changes for the whole tree commit in one native transaction.
    // All batches up to this point have durable Kit journals and are invisible.
    await ctx.db.batch([
      guard(),mutationGuard(ctx.db,"SELECT native_published=0 AND state='running' FROM federation_imports WHERE id=?",[job.id]),
      ctx.db.prepare('UPDATE pages SET deleted_at=NULL WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at=?').bind(JSON.stringify(review.pageIds),job.created_at),
      ctx.db.prepare('UPDATE containers SET trashed_at=NULL WHERE id IN (SELECT value FROM json_each(?)) AND trashed_at=?').bind(JSON.stringify(review.containerIds),job.created_at),
      ctx.db.prepare("UPDATE federation_imports SET native_published=1,state='indexing',updated_at=? WHERE id=?").bind(ctx.now,job.id),guard(),
    ]);
  }
  // Completion is a canonical index readback, never a readiness flag. A failed
  // refresh leaves an explicit indexing job that resumes from the same IDs.
  if(!await verifySearchable(ctx,review.pageIds,{maxBatches:1,keyLimit:100})){
    const indexed=await ctx.db.prepare('SELECT COUNT(DISTINCT page_id) AS n FROM search_text WHERE workspace_id=? AND page_id IN (SELECT value FROM json_each(?))').bind(ctx.actor.workspaceId,JSON.stringify(review.pageIds)).first<number>('n');
    await ctx.db.batch([authorized(),ctx.db.prepare("UPDATE federation_imports SET progress_json=?,updated_at=? WHERE id=? AND state='indexing'").bind(JSON.stringify({phase:'indexing',checkpoint:indexed??0,total:review.pageIds.length}),ctx.now,job.id),authorized()]);return;
  }
  const report=retainedImportReport(job.report_json),counts=report.counts;
  report.created=report.wouldCreate;delete report.wouldCreate;
  if(report.sections?.wouldCreate){report.sections.created=report.sections.wouldCreate;delete report.sections.wouldCreate;}
  report.indexedPages=review.pageIds.length;
  await ctx.db.batch([authorized(),ctx.db.prepare(`UPDATE federation_imports SET state='completed',report_json=?,counts_json=?,progress_json=?,revision_id=?,updated_at=? WHERE id=? AND state='indexing' AND native_published=1 AND NOT EXISTS(${incompleteImportSearchSql})`).bind(JSON.stringify(report),JSON.stringify(counts),JSON.stringify({phase:'indexing',checkpoint:review.pageIds.length,total:review.pageIds.length}),createUlid(),ctx.now,job.id,JSON.stringify(review.pageIds),ctx.actor.workspaceId),authorized()]);
}

export async function undoReviewedImport(ctx:ImportRequestContext,job:ReviewedJob) {
  if(job.state==='undone')return;
  if(!['preparing','running','indexing','completed','undoing'].includes(job.state))throw new ApiProblem(409,'IMPORT_UNDO_UNAVAILABLE','This import has no applied batches to undo.');
  const context=await kitContext(ctx,job),previous=JSON.parse(job.progress_json??'{}');
  if(job.state!=='undoing'){
    const authorization=context.authorization.predicate('undo',job.id),nextContext=await kitContext(ctx,{...job,import_generation:job.import_generation+1}),after=nextContext.authorization.predicate('undo',job.id);
    await ctx.db.batch([mutationGuard(ctx.db,`SELECT (${authorization.sql})`,authorization.params as (string|number|null)[]),mutationGuard(ctx.db,'SELECT revision_id=? FROM federation_imports WHERE id=?',[job.revision_id,job.id]),ctx.db.prepare("UPDATE federation_imports SET state='undoing',import_generation=import_generation+1,progress_json=?,revision_id=?,updated_at=? WHERE id=?").bind(JSON.stringify(job.state==='preparing'?{phase:'cancel',checkpoint:0}:{}),createUlid(),ctx.now,job.id),mutationGuard(ctx.db,`SELECT (${after.sql})`,after.params as (string|number|null)[])]);return;
  }
  if(previous.phase==='cancel'){await cancelImportPreparation(ctx,job);return;}
  if(!job.kit_id)throw new ApiProblem(409,'IMPORT_UNDO_UNAVAILABLE','This import has no applied batches to undo.');
  const progress=previous.state==='undone'?previous:await undoD1ImportStream(job.kit_id,context);
  const authorization=context.authorization.predicate('undo',job.id),authorized=()=>mutationGuard(ctx.db,`SELECT (${authorization.sql})`,authorization.params as (string|number|null)[]);
  const report=retainedImportReport(job.report_json);
  report.undo??={conflicts:[],reportPage:0,reportOffset:0};
  // Read one maintained child report per separate request after reversal has
  // finished. Reporting never spends the next child's budget in this batch.
  let reportsDone=false;const reportKeys:string[]=[];
  if(previous.state==='undone'){
    const child=await ctx.db.prepare('SELECT job_id FROM ik_d1_stream_pages WHERE stream_id=? AND ordinal=?').bind(job.kit_id,report.undo.reportPage).first<{job_id:string}>();
    if(!child)reportsDone=true;
    else {
      const page=await readD1ImportUndoReport(child.job_id,context,{offset:report.undo.reportOffset,limit:100});
      const conflicts=page.dispositions.filter(disposition=>disposition.disposition==='retained').map(disposition=>({code:disposition.reason==='edited'?'NATIVE_EDIT_CONFLICT':'NATIVE_DEPENDENCY_KEPT',targetId:disposition.targetId,kind:disposition.targetKind,reason:disposition.reason}));
      if(conflicts.length){
        report.sections??={};const previousSection=report.sections.conflicts;
        const stored=await storeReportSection(ctx,job.id,`${job.plan_key}/report/conflicts`,conflicts,previousSection?.pages??0);
        report.sections.conflicts={...stored.section,count:(previousSection?.count??0)+conflicts.length};reportKeys.push(...stored.keys);
        if(!previousSection)report.undo.conflicts=stored.first;
      }
      if(page.nextOffset===null){report.undo.reportPage++;report.undo.reportOffset=0;}else report.undo.reportOffset=page.nextOffset;
    }
  }
  report.undo.state=reportsDone?'undone':'undoing';
  await ctx.db.batch([authorized(),mutationGuard(ctx.db,'SELECT revision_id=? FROM federation_imports WHERE id=?',[job.revision_id,job.id]),ctx.db.prepare("INSERT INTO import_objects(import_id,storage_key,kind) SELECT ?,value,'report' FROM json_each(?) WHERE 1 ON CONFLICT DO NOTHING").bind(job.id,JSON.stringify(reportKeys)),ctx.db.prepare('UPDATE federation_imports SET state=?,report_json=?,progress_json=?,revision_id=?,updated_at=? WHERE id=?').bind(reportsDone?'undone':'undoing',JSON.stringify(report),JSON.stringify({checkpoint:progress.checkpoint,total:progress.total,state:progress.state}),createUlid(),ctx.now,job.id),authorized()]);
}
