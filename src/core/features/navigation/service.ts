import { authorScheduleProjections } from '../lifecycle/schedule-view';
import { navigationConfiguration } from './configuration';
import { requiredId } from './request';
import type { FeatureContext } from '../../app/feature-context';
import { currentSubject,requirePageLevel } from '../sharing/current-access';
import { containerListAccess } from '../containers/list-access';
import { navigationPageReads } from './list-reads';
import { personalMutation } from './mutations';
import { preferences } from './preferences';
export { preferences, updatePreferences } from './preferences';
export async function navigation(ctx:FeatureContext){const subject=await currentSubject(ctx);
 const [recent,favourites,containers,watches,containerWatches,personal,configuration]=await Promise.all([
 ctx.db.prepare('SELECT p.id,p.title,p.container_id AS containerId,p.icon,r.opened_at AS openedAt FROM recent_pages r JOIN pages p ON p.id=r.page_id WHERE r.member_id=? AND p.workspace_id=? AND p.deleted_at IS NULL ORDER BY r.opened_at DESC,p.id DESC').bind(ctx.actor.id,ctx.actor.workspaceId).all<{id:string;title:string;containerId:string;icon:string|null;openedAt:string}>(),
 ctx.db.prepare("SELECT CASE WHEN d.id IS NULL THEN 'page' ELSE 'database' END AS kind,COALESCE(d.id,p.id) AS id,p.id AS pageId,p.title AS title,f.position FROM page_favourites f JOIN pages p ON p.id=f.page_id LEFT JOIN databases d ON d.page_id=p.id WHERE f.member_id=? AND p.workspace_id=? AND p.deleted_at IS NULL UNION ALL SELECT 'container',c.id,NULL AS pageId,c.name,f.position FROM container_favourites f JOIN containers c ON c.id=f.container_id WHERE f.member_id=? AND c.workspace_id=? ORDER BY position,id").bind(ctx.actor.id,ctx.actor.workspaceId,ctx.actor.id,ctx.actor.workspaceId).all<{kind:'page'|'container'|'database';id:string;pageId:string|null;title:string;position:string}>(),
 ctx.db.prepare('SELECT DISTINCT c.id,c.name,c.icon FROM containers c LEFT JOIN container_members m ON m.container_id=c.id LEFT JOIN container_owners o ON o.container_id=c.id WHERE c.workspace_id=? AND (m.member_id=? OR o.member_id=?) ORDER BY c.name,c.id').bind(ctx.actor.workspaceId,ctx.actor.id,ctx.actor.id).all<{id:string;name:string;icon:string|null}>(),
 ctx.db.prepare('SELECT page_id AS id FROM page_watches WHERE member_id=? AND enabled=1').bind(ctx.actor.id).all<{id:string}>(),ctx.db.prepare('SELECT container_id AS id FROM container_watches WHERE member_id=?').bind(ctx.actor.id).all<{id:string}>(),preferences(ctx),navigationConfiguration(ctx)]);
 const pageIds=[...new Set([...recent.results.map(p=>p.id),...favourites.results.flatMap(p=>p.pageId?[p.pageId]:[]),...watches.results.map(p=>p.id)])];
 const containerIds=[...new Set([...containers.results.map(c=>c.id),...containerWatches.results.map(c=>c.id),...favourites.results.filter(f=>f.kind==='container').map(f=>f.id)])];
 const [schedules,pages,containerAccess]=await Promise.all([
  authorScheduleProjections(ctx,pageIds),navigationPageReads(ctx,pageIds,subject),containerListAccess(ctx,containerIds,subject)
 ]);
 const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:personal.value.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 const readableRecent=recent.results.filter(r=>pages.canRead(r.id)).map(r=>({...r,...schedules.get(r.id),title:pages.title(r.id),day:dayFormat.format(new Date(r.openedAt))}));
 const readableFavourites=favourites.results.filter(r=>r.kind==='container'?containerAccess.has(r.id):pages.canRead(r.pageId!)).map(r=>({...r,...(r.pageId?schedules.get(r.pageId):{}),title:r.kind==='container'?r.title:pages.title(r.pageId!),href:r.kind==='container'?`/app/containers/${r.id}`:r.kind==='database'?`/app/databases/${r.id}`:`/app/pages/${r.id}`}));
 const readableContainers=containers.results.filter(r=>containerAccess.has(r.id));
 const readableWatches=watches.results.filter(r=>pages.canRead(r.id)).map(r=>r.id);
 return {isGuest:subject.isGuest,recents:readableRecent,favourites:readableFavourites,containers:readableContainers,watches:readableWatches,containerWatches:containerWatches.results.filter(r=>containerAccess.has(r.id)).map(r=>r.id),preferences:personal,configuration};
}
export function openRecent(ctx:FeatureContext,input:{operationKey:string;pageId:string}) {requiredId(input.pageId);return personalMutation(ctx,{operationKey:input.operationKey,action:'recent.open',request:input,authorize:()=>requirePageLevel(ctx,input.pageId,'view').then(()=>{}),build:async()=>({statements:[ctx.db.prepare('INSERT INTO recent_pages(member_id,page_id,opened_at) VALUES (?,?,?) ON CONFLICT(member_id,page_id) DO UPDATE SET opened_at=excluded.opened_at').bind(ctx.actor.id,input.pageId,ctx.now)],value:{pageId:input.pageId,openedAt:ctx.now}})});}
export { setWatch, implicitWatchStatement } from './watches';
