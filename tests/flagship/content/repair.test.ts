import {structureSaveLabelsCase} from './structure-save-labels.case';
import {runFoldCases} from '../fold-cases';
import {beforeEach,it,expect} from 'vitest';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {env} from 'cloudflare:test';
import {createUlid} from '../../../src/core/shared/ulid';
import {fixture,page} from './journeys';
beforeEach(resetDeployment);
it("content structure, task attribution, privacy and activity retain exact revisions", async () => {
  await runFoldCases([
{name:"normalizes creation and structural task attribution and preserves existing completion",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const f=await fixture(),id=createUlid(),task={id,blockType:'task',treePosition:'1',content:{text:[{text:'Task'}],done:true,completedByMemberId:f.b,completedAt:'2000-01-01T00:00:00Z'}};
 const p=await page(f,[task]);let read=await f.request('GET',`/api/pages/${p.pageId}`);expect(read.data.blocks[0].content.completedByMemberId).toBe(f.a);const time=read.data.blocks[0].content.completedAt;expect(time).not.toBe(task.content.completedAt);
 const write=await f.request('PUT',`/api/pages/${p.pageId}/blocks`,{operationKey:createUlid(),expectedRevisionId:p.revisionId,blocks:[task]});expect(write.status).toBe(200);read=await f.request('GET',`/api/pages/${p.pageId}`);expect(read.data.blocks[0].content.completedAt).toBe(time);
 const undone=await f.request('PUT',`/api/pages/${p.pageId}/blocks`,{operationKey:createUlid(),expectedRevisionId:write.data.value.revisionId,blocks:[{...task,content:{...task.content,done:false}}]});expect(undone.status).toBe(200);expect((await f.request('GET',`/api/pages/${p.pageId}`)).data.blocks[0].content.completedByMemberId).toBeNull();
 expect((await f.request('GET',`/api/pages/${p.pageId}`)).data.blocks[0].content.completedAt).toBeNull();
 expect((await f.request('GET',`/api/pages/${p.pageId}/details`)).data.taskCompletion).toEqual({completed:0,total:1});
 const database=await f.request('POST','/api/databases',{operationKey:createUlid(),containerId:f.containerId,title:'Task exclusion records'});expect(database.status).toBe(201);
 const base=`/api/databases/${database.data.value.id}`;
 const recordIds=[];
 for(const title of ['Launch record','Handover record']){const record=await f.request('POST',`${base}/records`,{operationKey:createUlid(),title,values:{}});expect(record.status).toBe(201);recordIds.push(record.data.value.pageId);}
 const snapshots=[];
 for(const [position,layout] of ['table','list'].entries()){
  const current=await f.request('GET',base),viewId=createUlid();
  const saved=await f.request('POST',`${base}/views`,{operationKey:createUlid(),expectedRevisionId:current.data.database.revision_id,view:{id:viewId,name:layout,layout,filters:[],sorts:[{field:'$title',direction:'asc'}],groups:[],calculations:{},display:{},position}});expect(saved.status).toBe(200);
  const view=await f.request('GET',`${base}/views/${viewId}`);expect(view.status).toBe(200);expect(view.data.records.map((row:any)=>row.pageId).sort()).toEqual([...recordIds].sort());snapshots.push({viewId,records:view.data.records});
 }
 const open=await f.request('GET',`/api/pages/${p.pageId}`);
 const content={...open.data.blocks[0].content,done:true,completedByMemberId:f.a,completedAt:'2000-01-01T00:00:00Z'};
 const input={operationKey:createUlid(),expectedRevisionId:open.data.blocks[0].revisionId,content};
 const completed=await f.request('PATCH',`/api/pages/${p.pageId}/blocks/${id}`,input,f.b);expect(completed.status).toBe(200);
 const replay=await f.request('PATCH',`/api/pages/${p.pageId}/blocks/${id}`,input,f.b);expect(replay.status).toBe(200);expect(replay.data.receipt).toEqual(completed.data.receipt);
 const committed=await f.request('GET',`/api/pages/${p.pageId}`);
 expect(committed.data.blocks[0]).toMatchObject({id,blockType:'task',content:{done:true,completedByMemberId:f.b,completedAt:completed.data.receipt.committedAt}});
 expect((await f.request('GET',`/api/pages/${p.pageId}/details`)).data.taskCompletion).toEqual({completed:1,total:1});
 const undo=await f.request('PATCH',`/api/pages/${p.pageId}/blocks/${id}`,{operationKey:createUlid(),expectedRevisionId:committed.data.blocks[0].revisionId,content:{...committed.data.blocks[0].content,done:false}},f.b);expect(undo.status).toBe(200);
 const cleared=await f.request('GET',`/api/pages/${p.pageId}`);expect(cleared.data.blocks[0]).toMatchObject({id,blockType:'task',content:{done:false,completedByMemberId:null,completedAt:null}});
 expect((await f.request('GET',`/api/pages/${p.pageId}/details`)).data.taskCompletion).toEqual({completed:0,total:1});
 for(const snapshot of snapshots){const view=await f.request('GET',`${base}/views/${snapshot.viewId}`);expect(view.status).toBe(200);expect(view.data.records).toEqual(snapshot.records);expect(view.data.records.some((row:any)=>[p.pageId,id].includes(row.pageId))).toBe(false);}


} finally {}
}},
{name:"container metadata and archived listing expose stored policies and preserve personal privacy",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const f=await fixture();await env.DB.prepare("UPDATE containers SET guest_access='forbidden',anonymous_access='forbidden' WHERE id=?").bind(f.containerId).run();
 const metadata=await f.request('GET',`/api/containers/${f.containerId}`);expect(metadata.status).toBe(200);expect(metadata.data).toMatchObject({id:f.containerId,key:null,icon:null,name:'Team',description:'',visibility:'default',owners:[{memberId:f.a,displayName:f.a}],guestAccess:'forbidden',publicLinkAccess:'allowed',anonymousAccess:'forbidden',permissions:{canManage:true},archivedAt:null});
 const archive=await f.request('POST',`/api/containers/${f.containerId}/archive`,{operationKey:createUlid(),expectedRevisionId:metadata.data.revisionId});expect(archive.status).toBe(200);
 expect((await f.request('GET','/api/containers')).data.items).toHaveLength(0);const archived=await f.request('GET','/api/containers?archived=true');expect(archived.data.items[0]).toMatchObject({id:f.containerId,revisionId:archive.data.value.revisionId});
 const restore=await f.request('POST',`/api/containers/${f.containerId}/archive`,{operationKey:createUlid(),expectedRevisionId:archived.data.items[0].revisionId,restore:true});expect(restore.status).toBe(200);expect((await f.request('GET','/api/containers')).data.items).toHaveLength(1);

} finally {}
}},
{name:"public header controls and social metadata render from explicit publication without private search results",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const f=await fixture(),parent=await page(f),child=await f.request('POST','/api/pages',{operationKey:createUlid(),containerId:f.containerId,parentPageId:parent.pageId,title:'Public child'});
 const expose=async(id:string,revision:string,slug:string,extra={})=>f.request('POST',`/api/publishing/${id}`,{operationKey:createUlid(),expectedRevisionId:revision,host:'local.test',slug,...extra});
 expect((await expose(parent.pageId,parent.revisionId,`ancestor-${parent.pageId}`)).status).toBe(200);
 expect((await expose(child.data.value.pageId,child.data.value.revisionId,`child-${parent.pageId}`,{headerControls:['search','breadcrumbs','duplicate'],duplicateAsTemplate:true,socialPreview:{title:'Social <title>',description:'Social description'}})).status).toBe(200);
 await f.request('POST','/api/pages',{operationKey:createUlid(),containerId:f.containerId,title:'Secret needle'});
 const request=async(q='')=>{const r=await f.app.request(`https://local.test/p/child-${parent.pageId}${q}`,{},env);expect(r.status).toBe(200);return r.text();};
 const ancestorLink=`href="/p/ancestor-${parent.pageId}"`;
 let html=await request('?q=needle');expect(html).toContain(ancestorLink);expect(html).toContain('role="search"');expect(html).toContain('Duplicate this page');expect(html).toContain('Social &lt;title&gt;');expect(html).toContain('No published pages found');expect(html).not.toContain('Secret needle');
 await env.DB.prepare("UPDATE public_exposures SET revoked_at=? WHERE page_id=?").bind(f.ctx.now,parent.pageId).run();html=await request();expect(html).not.toContain(ancestorLink);expect(html).toContain('aria-current="page">Public child');
 expect((await expose(child.data.value.pageId,child.data.value.revisionId,`child-${parent.pageId}`,{headerControls:[],duplicateAsTemplate:true})).status).toBe(200);html=await request('?q=Public');expect(html).not.toMatch(/role="search"|Duplicate this page|Search results/);

} finally {}
}},
{name:"comment activity receives exact entity revision context in the atomic operation",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const f=await fixture(),p=await page(f);const {createComment,editComment,resolveThread}=await import('../../../src/core/features/comments/service');
 const comment=await createComment(f.ctx,p.pageId,{operationKey:createUlid(),body:[{text:'First'}]});
 const detail=async(activityId:string|null)=>JSON.parse((await env.DB.prepare('SELECT detail_json FROM activity_entries WHERE id=?').bind(activityId).first<{detail_json:string}>())!.detail_json);
 expect(await detail(comment.receipt.activityId)).toEqual({commentId:comment.value.id,revisionId:comment.value.revisionId});
 const edited=await editComment(f.ctx,comment.value.id,{operationKey:createUlid(),expectedRevisionId:comment.value.revisionId,body:[{text:'Edited'}]});expect(await detail(edited.receipt.activityId)).toEqual({commentId:comment.value.id,revisionId:edited.value.revisionId});
 const resolved=await resolveThread(f.ctx,comment.value.threadId,{operationKey:createUlid(),expectedRevisionId:edited.value.revisionId,resolved:true});expect(await detail(resolved.receipt.activityId)).toEqual({revisionId:resolved.value.revisionId});

} finally {}
}}
  ,
{name:"a structure save never reports a conflict for a block whose only difference is a mention label",before:async()=>{await resetDeployment();},run:structureSaveLabelsCase}
]);
});
