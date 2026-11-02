import {expect,vi} from 'vitest';
import {auditFixture,createUlid} from './audit-support';

/** Real native events, with only Date controlled, exercise the public timeline. */
export async function auditRetrievalProof(){
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-10-20T11:00:00.000Z'));
 try {
  const f=await auditFixture();
  const send=async(method:string,path:string,body?:Record<string,unknown>,actor=f.ownerId)=>{
   const result=await f.request(method,path,body?{operationKey:createUlid(),...body}:undefined,actor);
   expect(result.status,JSON.stringify(result.data)).toBe(200);return result.data;
  };
  const other=(await send('POST','/api/containers',{name:'Other timeline space',visibility:'private'})).value.id;
  const access=await send('POST','/api/sharing',{targetKind:'container',targetId:f.containerId,principalKind:'member',principalId:f.readerId,level:'edit'});
  const events:Record<string,any>={};
  const make=async(name:string,minute:number,containerId=f.containerId,actor=f.ownerId)=>{
   vi.setSystemTime(new Date(`2026-10-20T12:${String(minute).padStart(2,'0')}:00.000Z`));
   const made=await send('POST','/api/pages',{containerId,title:`Timeline ${name}`},actor);events[name]=made;return made.value.pageId as string;
  };
  const first=await make('first',0);
  await make('reader',1,f.containerId,f.readerId);
  await make('elsewhere',2,other);
  await make('tie-one',3);
  await make('tie-two',3);
  await make('last',4);
  vi.setSystemTime(new Date('2026-10-20T12:05:00.000Z'));
  events.comment=await send('POST',`/api/comments/page/${first}`,{body:[{text:'Timeline discussion'}]});
  vi.setSystemTime(new Date('2026-10-20T12:06:00.000Z'));
  events.edit=await send('PATCH',`/api/pages/${first}`,{expectedRevisionId:await f.revision(first),properties:{title:'Timeline edited'}});
  vi.setSystemTime(new Date('2026-10-20T12:10:00.000Z'));
  const query=async(filters:Record<string,string>={})=>(await send('GET',`/api/activity?${new URLSearchParams({from:'2026-10-20T11:30:00Z',...filters})}`));
  const ids=(names:string[])=>names.map(name=>events[name].receipt.activityId);
  const tied=['tie-one','tie-two'].sort((a,b)=>events[b].receipt.activityId.localeCompare(events[a].receipt.activityId));
  const creates=['last',...tied,'elsewhere','reader','first'];
  const all=['edit','comment',...creates];
  expect((await query()).items.map((item:any)=>item.id)).toEqual(ids(all));
  expect((await query({actorId:f.readerId})).items.map((item:any)=>item.id)).toEqual(ids(['reader']));
  expect((await query({action:'pages.create'})).items.map((item:any)=>item.id)).toEqual(ids(creates));
  expect((await query({kind:'comment-thread'})).items.map((item:any)=>item.id)).toEqual(ids(['comment']));
  expect((await query({containerId:other})).items.map((item:any)=>item.id)).toEqual(ids(['elsewhere']));
  expect((await query({from:'2026-10-20T14:04:00+02:00'})).items.map((item:any)=>item.id)).toEqual(ids(['edit','comment','last']));
  expect((await query({to:'2026-10-20T14:01:00+02:00'})).items.map((item:any)=>item.id)).toEqual(ids(['reader','first']));
  expect((await query({actorId:f.ownerId,action:'pages.create',kind:'page',containerId:f.containerId,from:'2026-10-20T12:03:00Z',to:'2026-10-20T12:04:00Z'})).items.map((item:any)=>item.id)).toEqual(ids(['last',...tied]));
  const seen:string[]=[];let cursor:string|undefined;let pages=0;
  do {
   const result=await query({limit:'2',...(cursor?{cursor}:{})});pages++;seen.push(...result.items.map((item:any)=>item.id));cursor=result.nextCursor;
   vi.setSystemTime(new Date(`2026-10-20T12:${20+pages}:00.000Z`));
   await send('POST','/api/pages',{containerId:f.containerId,title:`Arriving event ${pages}`});
  }while(cursor);
  expect(pages).toBe(4);expect(seen).toEqual(ids(all));expect(new Set(seen).size).toBe(seen.length);
  const readerQuery=async(cursor?:string)=>(await send('GET',`/api/activity?${new URLSearchParams({action:'pages.create',limit:'2',...(cursor?{cursor}:{})})}`,undefined,f.readerId));
  const visible=await readerQuery();expect(visible.items.some((item:any)=>item.context.pageId)).toBe(true);expect(visible.nextCursor).toBeTruthy();
  expect((await f.request('GET',`/api/pages/${first}`,undefined,f.readerId)).status).toBe(200);
  const original=await query({action:'pages.create'});expect(original.items.find((item:any)=>item.id===events.first.receipt.activityId).context.pageId).toBe(first);
  await send('POST','/api/sharing',{id:access.value.id,targetKind:'container',targetId:f.containerId,principalKind:'member',principalId:f.readerId,level:'edit',revoke:true});
  expect((await f.request('GET',`/api/pages/${first}`,undefined,f.readerId)).status).toBe(404);
  expect((await readerQuery()).items.some((item:any)=>item.target.id===first)).toBe(false);
  expect((await readerQuery(visible.nextCursor)).items.some((item:any)=>item.target.id===first)).toBe(false);
  expect((await query({action:'pages.create'})).items.map((item:any)=>item.id)).toEqual(original.items.map((item:any)=>item.id));
 }finally{vi.useRealTimers();}
}
