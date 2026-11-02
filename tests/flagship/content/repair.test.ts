import {containerGrantPrincipalsCase} from './container-grant-principals.case';
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
{name:"container grant editors receive scoped labels while group administration and ordinary readers stay refused",before:async()=>{await resetDeployment();},run:containerGrantPrincipalsCase},
{name:"normalizes creation and structural task attribution and preserves existing completion",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const f=await fixture(),id=createUlid(),task={id,blockType:'task',treePosition:'1',content:{text:[{text:'Task'}],done:true,completedByMemberId:f.b,completedAt:'2000-01-01T00:00:00Z'}};
 const p=await page(f,[task]);let read=await f.request('GET',`/api/pages/${p.pageId}`);expect(read.data.blocks[0].content.completedByMemberId).toBe(f.a);const time=read.data.blocks[0].content.completedAt;expect(time).not.toBe(task.content.completedAt);
 const write=await f.request('PUT',`/api/pages/${p.pageId}/blocks`,{operationKey:createUlid(),expectedRevisionId:p.revisionId,blocks:[task]});expect(write.status).toBe(200);read=await f.request('GET',`/api/pages/${p.pageId}`);expect(read.data.blocks[0].content.completedAt).toBe(time);
 const undone=await f.request('PUT',`/api/pages/${p.pageId}/blocks`,{operationKey:createUlid(),expectedRevisionId:write.data.value.revisionId,blocks:[{...task,content:{...task.content,done:false}}]});expect(undone.status).toBe(200);expect((await f.request('GET',`/api/pages/${p.pageId}`)).data.blocks[0].content.completedByMemberId).toBeNull();

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
