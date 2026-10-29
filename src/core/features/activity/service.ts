import {activityPageId} from './context';
import type { FeatureContext } from '../../app/feature-context';
import { currentSubject,requireContainerLevel,resolveCurrentAccessMany } from '../sharing/current-access';
import { readableTarget,permitted } from '../search/visibility';
import { encodeCursor,limitValue,timeCursor } from '../search/pagination';
import { ApiProblem } from '../../app/problems';
export interface ActivityInput {actorId?:string;action?:string;kind?:string;containerId?:string;from?:string;to?:string;cursor?:string;limit?:number}
export interface Row {id:string;actor_member_id:string|null;feature:string|null;action:string;target_kind:string;target_id:string;detail_json:string;operation_key:string|null;automation_run_id:string|null;ai_run_id:string|null;occurred_at:string}
export type ActivityAccessResolver=(ctx:FeatureContext,id:string)=>Promise<boolean>;
const resolvers=new Map<string,ActivityAccessResolver>();
/** Feature-owned targets register their actual current authorization boundary at app assembly. */
export function registerActivityResolver(kind:string,resolver:ActivityAccessResolver){resolvers.set(kind,resolver);}
export async function activity(ctx:FeatureContext,input:ActivityInput={}){
 await currentSubject(ctx);for(const value of [input.from,input.to])if(value&&!Number.isFinite(Date.parse(value)))throw new ApiProblem(400,'INVALID_DATE','Invalid activity date.');
 const cursor=timeCursor(input.cursor,ctx.now),limit=limitValue(input.limit);
 if(input.containerId&&!await permitted(()=>requireContainerLevel(ctx,input.containerId!,'view')))return {items:[]};
 const rows=await ctx.db.prepare('SELECT * FROM activity_entries WHERE workspace_id=? AND occurred_at<=? AND (occurred_at<? OR (occurred_at=? AND id<?)) AND (? IS NULL OR actor_member_id=?) AND (? IS NULL OR action=?) AND (? IS NULL OR target_kind=?) AND (? IS NULL OR occurred_at>=?) AND (? IS NULL OR occurred_at<=?) ORDER BY occurred_at DESC,id DESC').bind(ctx.actor.workspaceId,cursor.ceiling,cursor.at,cursor.at,cursor.id,input.actorId??null,input.actorId??null,input.action??null,input.action??null,input.kind??null,input.kind??null,input.from??null,input.from??null,input.to??null,input.to??null).all<Row>();
 const contexts=new Map<string,string>();for(const row of rows.results){const id=await activityPageId(ctx,row.target_kind,row.target_id);if(id)contexts.set(row.id,id);}const pageIds=[...contexts.values()];const retained=await resolveCurrentAccessMany(ctx,pageIds,{includeDeleted:true,includeTrashed:true});
 const items=[];
 for(const row of rows.results){
  const pageId=contexts.get(row.id);const {allowed,detail}=await activityVisibility(ctx,row,pageId,pageId?!!retained.get(pageId)?.decision.allowed:undefined);if(!allowed)continue;
  const page=await ctx.db.prepare('SELECT container_id,deleted_at FROM pages WHERE id=? AND workspace_id=?').bind(pageId??'',ctx.actor.workspaceId).first<{container_id:string;deleted_at:string|null}>();if(input.containerId&&row.target_id!==input.containerId&&page?.container_id!==input.containerId)continue;
  let actor:null|{id:string;displayName:string}=null;if(row.actor_member_id&&!page?.deleted_at){const a=await ctx.db.prepare("SELECT id,display_name AS displayName FROM members WHERE id=? AND workspace_id=? AND (member_kind='member' OR id=?)").bind(row.actor_member_id,ctx.actor.workspaceId,ctx.actor.id).first<{id:string;displayName:string}>();actor=a?{...a,displayName:activityActorLabel(row)??a.displayName}:null;}
  // A thread revision is not a page version; only retained page revisions open history.
  const candidateRevision=detail.revisionId??(row.target_kind==='revision'?row.target_id:undefined);
  const revisionId=pageId && !detail.grantId && ['page','revision'].includes(row.target_kind) && candidateRevision
   ? (await ctx.db.prepare('SELECT id FROM page_revisions WHERE id=? AND page_id=?').bind(candidateRevision,pageId).first<{id:string}>())?.id : undefined;
  items.push({id:row.id,actor,feature:row.feature,action:row.action,target:{kind:row.target_kind,id:row.target_id},occurredAt:row.occurred_at,operationKey:row.operation_key,automationRunId:row.automation_run_id,aiRunId:row.ai_run_id,deleted:!!page?.deleted_at,context:page?.deleted_at?{}:{pageId,commentId:detail.commentId??(row.target_kind==='comment'?row.target_id:undefined),threadId:row.target_kind==='comment-thread'?row.target_id:undefined,revisionId,grantId:detail.grantId},explanation:page?.deleted_at?'The underlying page was erased; only this activity record remains.':undefined});if(items.length>limit)break;
 }
 const hasMore=items.length>limit;if(hasMore)items.pop();const last=items.at(-1);return {items,nextCursor:hasMore&&last?encodeCursor({at:last.occurredAt,id:last.id,ceiling:cursor.ceiling}):undefined};
}

/** Both the timeline and integrations use this exact target/source visibility boundary. */
async function activityVisibility(ctx:FeatureContext,row:Row,pageId?:string,allowedPage?:boolean){
 const allowed=pageId?(allowedPage??(await resolveCurrentAccessMany(ctx,[pageId],{includeDeleted:true,includeTrashed:true})).get(pageId)?.decision.allowed):resolvers.has(row.target_kind)?await resolvers.get(row.target_kind)!(ctx,row.target_id):await readableTarget(ctx,row.target_kind,row.target_id);
 const detail=JSON.parse(row.detail_json) as {commentId?:string;revisionId?:string;grantId?:string;sourcePageIds?:string[]};
 if(!allowed)return {allowed:false,detail};
 for(const id of detail.sourcePageIds??[])if(!await readableTarget(ctx,'page',id))return {allowed:false,detail};
 return {allowed:true,detail};
}
/** A content-free projection for one stable event; no page/comment body or credential detail leaves. */
export async function auditRecord(ctx:FeatureContext,id:string){
 await currentSubject(ctx);
 const row=await ctx.db.prepare('SELECT * FROM activity_entries WHERE id=? AND workspace_id=?').bind(id,ctx.actor.workspaceId).first<Row>();
 if(!row)return null;
 const pageId=await activityPageId(ctx,row.target_kind,row.target_id);
 if(!(await activityVisibility(ctx,row,pageId)).allowed)return null;
 const deleted=pageId?!!(await ctx.db.prepare('SELECT deleted_at FROM pages WHERE id=?').bind(pageId).first<{deleted_at:string|null}>())?.deleted_at:false;
 const actor=row.actor_member_id&&!deleted?await ctx.db.prepare("SELECT id,display_name AS displayName FROM members WHERE id=? AND workspace_id=? AND (member_kind='member' OR id=?)").bind(row.actor_member_id,ctx.actor.workspaceId,ctx.actor.id).first<{id:string;displayName:string}>():null;
 return {id:row.id,actor:actor?{...actor,displayName:activityActorLabel(row)??actor.displayName}:null,occurredAt:new Date(row.occurred_at).toISOString(),action:row.action,target:{kind:row.target_kind,id:row.target_id}};
}

function activityActorLabel(row:Row):string|undefined {const detail=JSON.parse(row.detail_json) as {scimCredential?:{name?:unknown}};return typeof detail.scimCredential?.name==='string'?`SCIM: ${detail.scimCredential.name}`:undefined;}
