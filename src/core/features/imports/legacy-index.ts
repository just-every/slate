import type {FeatureContext} from '../../app/feature-context';
import {mutationGuard} from '../../app/operations';
import {createUlid} from '../../shared/ulid';
import {incompleteImportSearchSql,verifySearchable} from '../search/service';
import {readImport,type ImportJob} from './jobs';
import {retainedImportReport} from './report-store';
/** The committed native planner IDs are immutable indexing input. Resume never
 * reparses an archive or republishes document/append content. */
export async function finishDocumentIndex(ctx:FeatureContext,job:ImportJob) {
 const progress=JSON.parse(job.progress_json) as {pageIds:string[];phase:string;checkpoint:number;total:number};
 const ready=await verifySearchable(ctx,progress.pageIds,{maxBatches:1,keyLimit:100});
 const authorization=()=>mutationGuard(ctx.db,"SELECT EXISTS(SELECT 1 FROM members WHERE id=? AND workspace_id=? AND status='active')",[ctx.actor.id,ctx.actor.workspaceId]);
 if(ready){
  const report=retainedImportReport(job.report_json);report.indexedPages=progress.pageIds.length;
  await ctx.db.batch([authorization(),mutationGuard(ctx.db,"SELECT revision_id=? AND state='indexing' FROM federation_imports WHERE id=?",[job.revision_id,job.id]),ctx.db.prepare(`UPDATE federation_imports SET state='completed',report_json=?,progress_json=?,revision_id=?,updated_at=? WHERE id=? AND NOT EXISTS(${incompleteImportSearchSql})`).bind(JSON.stringify(report),JSON.stringify({...progress,checkpoint:progress.pageIds.length}),createUlid(),ctx.now,job.id,JSON.stringify(progress.pageIds),ctx.actor.workspaceId),authorization()]);
 }else{
  const indexed=await ctx.db.prepare('SELECT COUNT(DISTINCT page_id) n FROM search_text WHERE workspace_id=? AND page_id IN (SELECT value FROM json_each(?))').bind(ctx.actor.workspaceId,JSON.stringify(progress.pageIds)).first<number>('n');
  await ctx.db.batch([authorization(),ctx.db.prepare("UPDATE federation_imports SET progress_json=?,updated_at=? WHERE id=? AND state='indexing' AND revision_id=?").bind(JSON.stringify({...progress,checkpoint:indexed??0}),ctx.now,job.id,job.revision_id),authorization()]);
 }
 return readImport(ctx,job.id);
}
