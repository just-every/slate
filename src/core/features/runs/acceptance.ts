import {requireWritingSelection,replaceSelectedSpans,selectedSpans,textContent,type WritingSelection} from '../ai/selection';
import {requireDestinationEvidence} from '../ai/disclosure';
import {z} from 'zod';
import type {FeatureContext} from '../../app/feature-context';
import {ApiProblem} from '../../app/problems';
import {commitOperation,mutationGuard,requestHash} from '../../app/operations';
import {requirePageLevel} from '../sharing/current-access';
import {readPage} from '../pages/service';
import {prepareReplaceBlocks} from '../editor/service';
import type {BlockInput} from '../pages/types';
import {requireRun,reauthorizeRun} from './repository';
import type {Answer} from '../ai/contracts';
import {id,revision,json} from '../ai/persistence';
import {requireGrant} from '../effects/grants';
import {settleBudget} from '../ai/budget';
import {notificationStatements} from '../notifications/events';
export const acceptChangesSchema=z.object({operationKey:z.string(),expectedRevisionId:z.string(),selections:z.array(z.object({index:z.number().int().nonnegative(),pageId:z.string(),expectedPageRevisionId:z.string(),mode:z.enum(['replace','insert-below']),blockId:z.string().optional()}).strict()).min(1).max(50)}).strict();
export async function acceptRunChanges(ctx:FeatureContext,runId:string,input:z.infer<typeof acceptChangesSchema>,standingGrantId?:string){
 const run=await requireRun(ctx,runId,true);if(!run.output_json)throw new ApiProblem(409,'NO_PROPOSAL','There is no proposal to accept.');const selection=(JSON.parse(run.input_json) as {selection?:WritingSelection}).selection;const output=JSON.parse(run.output_json) as {answer:Answer};
 if(new Set(input.selections.map(s=>s.index)).size!==input.selections.length)throw new ApiProblem(400,'DUPLICATE_SELECTION','Select each proposed change once.');
 for(const s of input.selections){if(selection&&(s.pageId!==selection.pageId||s.blockId!==selection.blockId))throw new ApiProblem(400,'SELECTION_TARGET','Apply the proposal only to its exact selected page, block and revision.');const change=output.answer.proposedChanges[s.index];if(!change||![s.pageId,s.blockId].includes(change.targetId))throw new ApiProblem(400,'SELECTION_TARGET','The selected target does not match the proposed change.');}
 return commitOperation(ctx,{operationKey:input.operationKey,action:standingGrantId?'runs.granted-changes':'runs.accept-changes',request:{runId,...input,standingGrantId:standingGrantId??null},authorize:async()=>{await requireRun(ctx,runId,true);await reauthorizeRun(ctx,run,false);for(const s of input.selections){await requirePageLevel(ctx,s.pageId,'edit');await requireDestinationEvidence(ctx,s.pageId,JSON.parse(run.refs_json),false);if(standingGrantId)await requireGrant(ctx,standingGrantId,{kind:'effect',operation:'page.maintain',target:s.pageId,sourceIds:JSON.parse(run.refs_json).map((r:{sourceId:string})=>r.sourceId),audience:['workspace'],costMicros:0,contentHash:await requestHash(output.answer.proposedChanges),conditions:{skillRevisionId:run.skill_revision_id??'',revisionId:s.expectedPageRevisionId}});}},prepare:async({revisionId})=>{
  if(run.status!=='needs-review')throw new ApiProblem(409,'NO_PROPOSAL','There is no proposal to accept.');await reauthorizeRun(ctx,run);if(selection)await requireWritingSelection(ctx,selection);
  const statements=[...(standingGrantId?[mutationGuard(ctx.db,'SELECT revoked_at IS NULL AND expires_at>? FROM intelligence_grants WHERE id=?',[ctx.now,standingGrantId])]:[]),mutationGuard(ctx.db,"SELECT revision_id=? AND status='needs-review' FROM intelligence_runs WHERE id=?",[input.expectedRevisionId,runId])];const pages=[];
  for(const pageId of new Set(input.selections.map(s=>s.pageId))){const selections=input.selections.filter(s=>s.pageId===pageId);if(new Set(selections.map(s=>s.expectedPageRevisionId)).size!==1)throw new ApiProblem(400,'MIXED_REVISIONS','One page must use one expected revision.');const document=await readPage(ctx,pageId);const blocks:BlockInput[]=document.blocks.map(b=>({id:b.id,parentBlockId:b.parentBlockId,blockType:b.blockType,content:b.content,treePosition:b.treePosition}));
   for(const s of selections){const change=output.answer.proposedChanges[s.index]!;const block:BlockInput={id:id(),blockType:'paragraph',content:{text:[{text:change.text}]},treePosition:''};const index=s.blockId?blocks.findIndex(b=>b.id===s.blockId):-1;if(s.blockId&&index<0)throw new ApiProblem(409,'STALE_SELECTION','The selected block is no longer present.');if(s.mode==='replace'){if(index<0)throw new ApiProblem(400,'BLOCK_REQUIRED','Select a block to replace.');blocks[index]=selection?{...blocks[index]!,content:{...textContent(blocks[index]!.content),text:replaceSelectedSpans(selectedSpans(textContent(blocks[index]!.content).text),selection,change.text) as import('../../shared/api/common').JsonValue}}:{...blocks[index]!,content:block.content,blockType:'paragraph'};}else blocks.splice(index<0?blocks.length:index+1,0,block);}
   blocks.forEach((b,index)=>b.treePosition=String(index).padStart(8,'0'));const pageRevision=id();const plan=await prepareReplaceBlocks(ctx,pageId,{expectedRevisionId:selections[0]!.expectedPageRevisionId,blocks},pageRevision);statements.push(...plan.statements);pages.push({id:pageId,revisionId:pageRevision});
  }
  statements.push(ctx.db.prepare("UPDATE intelligence_runs SET status='completed',revision_id=?,settled_at=?,updated_at=? WHERE id=?").bind(revisionId,ctx.now,ctx.now,runId),ctx.db.prepare('INSERT INTO intelligence_reviews(id,run_id,actor_id,outcome,detail_json,created_at) VALUES(?,?,?,?,?,?)').bind(id(),runId,ctx.actor.id,'accepted',json({selections:input.selections,pages,provider:run.provider,model:run.model,inputRefs:JSON.parse(run.refs_json)}),ctx.now),settleBudget(ctx,runId,run.cost_micros),revision(ctx,revisionId,'run-acceptance',runId,{selections:input.selections,pages}));
  if(standingGrantId)statements.push(...notificationStatements(ctx,{id:revisionId,event:'maintenance',pageId:run.page_id,recipientIds:[run.requester_id],actorId:null,detail:{runId,outcome:`Applied ${pages.length} granted page ${pages.length===1?'change':'changes'}.`,sourcePageIds:[...new Set([...JSON.parse(run.refs_json).filter((ref:{kind:string})=>ref.kind==='page').map((ref:{sourceId:string})=>ref.sourceId),...pages.map(page=>page.id)])]}}));
  return {entity:{id:runId,kind:'run',revisionId},value:{id:runId,status:'completed',pages,revisionId},statements};
 }});
}
