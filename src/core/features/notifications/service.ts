import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import { currentSubject } from '../sharing/current-access';
import { preferences } from '../navigation/service';
import { personalMutation } from '../navigation/mutations';
import { encodeCursor,limitValue,timeCursor } from '../search/pagination';
import { currentPageTitle } from '../search/visibility';
import { eventReadable } from './outbox';
import type { NotificationEvent } from './events';
export interface NotificationRow {id:string;event:NotificationEvent;source_page_id:string|null;source_container_id:string|null;comment_id:string|null;detail_json:string;created_at:string;read_at:string|null;archived_at:string|null;audience:string}
export interface NotificationView {id:string;event:NotificationEvent;pageId:string|null;containerId:string|null;commentId:string|null;title:string|null;detail:unknown;createdAt:string;readAt:string|null;audience:string;href:string;period:string}
export async function visibleNotification(ctx:FeatureContext,row:NotificationRow):Promise<NotificationView|undefined>{
 if(!await eventReadable(ctx,{event:row.event,page_id:row.source_page_id,container_id:row.source_container_id,detail_json:row.detail_json}))return;
 const title=row.event==='saml-domain-failed'?'SAML domain verification failed':row.event==='backup-failed'?'Scheduled backup failed':row.source_page_id?await currentPageTitle(ctx,row.source_page_id,{includeTrashed:row.event==='page-trashed'}):row.source_container_id?(await ctx.db.prepare('SELECT name AS title FROM containers WHERE id=?').bind(row.source_container_id).first<{title:string}>())?.title??null:null;
 const detail=JSON.parse(row.detail_json);
 return {id:row.id,event:row.event,pageId:row.source_page_id,containerId:row.source_container_id,commentId:row.comment_id,title,detail,createdAt:row.created_at,readAt:row.read_at,audience:row.audience,href:row.event==='maintenance'&&detail.runId?`/app/runs/${encodeURIComponent(detail.runId)}`:row.event==='saml-domain-failed'?'/app/settings?section=saml':row.event==='backup-failed'?'/app/settings?section=portability':row.event==='page-trashed'?'/app/archive':row.source_page_id?`/app/pages/${row.source_page_id}${row.comment_id?`?comment=${row.comment_id}`:detail.blockId?`#block-${encodeURIComponent(detail.blockId)}`:''}`:row.source_container_id?`/app/containers/${row.source_container_id}`:'/app',period:row.created_at.slice(0,10)};
}
export async function notificationList(ctx:FeatureContext,input:{cursor?:string;limit?:number;audience?:'direct'|'watched';archived?:boolean}={}) {
 await currentSubject(ctx);const cursor=timeCursor(input.cursor,ctx.now),limit=limitValue(input.limit);
 const rows=await ctx.db.prepare('SELECT * FROM notifications WHERE workspace_id=? AND recipient_member_id=? AND ((?=1 AND archived_at IS NOT NULL) OR (?=0 AND archived_at IS NULL)) ORDER BY created_at DESC,id DESC').bind(ctx.actor.workspaceId,ctx.actor.id,input.archived?1:0,input.archived?1:0).all<NotificationRow>();
 const all:NotificationView[]=[];for(const row of rows.results){const item=await visibleNotification(ctx,row);if(item)all.push(item);}
 const filtered=all.filter(r=>(!input.audience||r.audience===input.audience)&&r.createdAt<=cursor.ceiling&&(r.createdAt<cursor.at||r.createdAt===cursor.at&&r.id<cursor.id));
 const items=filtered.slice(0,limit);const last=items.at(-1);return {items,unreadCount:all.filter(r=>!r.readAt).length,nextCursor:filtered.length>limit&&last?encodeCursor({at:last.createdAt,id:last.id,ceiling:cursor.ceiling}):undefined};
}
export async function notificationAction(ctx:FeatureContext,input:{operationKey:string;action:'read'|'read-all'|'archive-read';id?:string}) {
 if(!['read','read-all','archive-read'].includes(input.action))throw new ApiProblem(400,'INVALID_ACTION','Unknown inbox action.');
 let selected:NotificationView[]=[];
 return personalMutation(ctx,{operationKey:input.operationKey,action:`notification.${input.action}`,request:input,authorize:async()=>{
  const rows=await ctx.db.prepare('SELECT * FROM notifications WHERE workspace_id=? AND recipient_member_id=? AND archived_at IS NULL').bind(ctx.actor.workspaceId,ctx.actor.id).all<NotificationRow>();
  for(const row of rows.results){if(input.action==='read'&&row.id!==input.id)continue;const item=await visibleNotification(ctx,row);if(item&&(input.action!=='archive-read'||item.readAt))selected.push(item);}
  if(input.action==='read'&&!selected.length)throw new ApiProblem(404,'NOT_FOUND','Not found.');
 },build:async()=>({statements:selected.map(r=>ctx.db.prepare(input.action==='archive-read'?'UPDATE notifications SET archived_at=? WHERE id=? AND recipient_member_id=? AND read_at IS NOT NULL':'UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_member_id=?').bind(ctx.now,r.id,ctx.actor.id)),value:{changed:selected.length,href:input.action==='read'?selected[0]?.href:undefined}})});
}
/** Routine successful maintenance is grouped; mandatory notices retain separate identity and actions. */
export async function today(ctx:FeatureContext) {
 const personal=await preferences(ctx);const items:NotificationView[]=[];let cursor:string|undefined;
 do{const page=await notificationList(ctx,{cursor,limit:100});items.push(...page.items);cursor=page.nextCursor;}while(cursor);
 const mandatory:NotificationView[]=[];for(const item of items.filter(r=>r.event!=='maintenance')){const resolver=todayResolvers.get(item.event);if(!resolver||await resolver(ctx,item))mandatory.push(item);}const groups=new Map<string,NotificationView[]>();
 for(const item of items.filter(r=>r.event==='maintenance')){const key=personal.value.quietRoutine?item.period:item.id;const group=groups.get(key)??[];group.push(item);groups.set(key,group);}
 return {decisions:mandatory.filter(r=>['decision-required','run-review'].includes(r.event)),contradictions:mandatory.filter(r=>r.event==='contradiction'),notices:mandatory.filter(r=>!['decision-required','run-review','contradiction'].includes(r.event)),outcomes:[...groups].map(([,entries])=>({day:entries[0].period,summary:`${entries.length} maintenance ${entries.length===1?'outcome':'outcomes'}`,count:entries.length,unreadCount:entries.filter(r=>!r.readAt).length,items:entries})),unreadCount:items.filter(r=>!r.readAt).length};
}
export type TodayResolver=(ctx:FeatureContext,notice:NotificationView)=>Promise<boolean>;
const todayResolvers=new Map<NotificationEvent,TodayResolver>();
/** Owning feature checks its current state; inbox history remains independently retained. */
export function registerTodayResolver(event:NotificationEvent,resolver:TodayResolver){todayResolvers.set(event,resolver);}
