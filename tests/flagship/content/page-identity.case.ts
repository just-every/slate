import {expect} from 'vitest';
import {env} from 'cloudflare:test';
import {createApi} from '../../../src/core/app/hono';
import {seedWorkspace,seedMember,sessionFor} from '../../e2e/setup/fixtures';

/** Native creation and populated references; identities alone are the seeded edge. */
export async function pageIdentityCase(){
 const {workspaceId}=await seedWorkspace({profile:{'page.lifecycle.v1':'always-live'}});
 const owner=await seedMember(workspaceId,{email:['synthetic-slate-1','example.test'].join('@'),displayName:'Identity owner',role:'owner',isSetupOwner:true});
 const app=createApi(),cookie=await sessionFor(owner.memberId);
 const request=async(method:string,path:string,body?:unknown)=>{
  const response=await app.request('https://slate.example'+path,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env);
  const data=await response.json<any>();expect(response.status,JSON.stringify(data)).toBeGreaterThanOrEqual(200);expect(response.status,JSON.stringify(data)).toBeLessThan(300);return data;
 };
 const mutate=(path:string,body:Record<string,unknown>)=>request('POST',path,{operationKey:crypto.randomUUID(),...body});
 const container=(await mutate('/api/containers',{name:'Page identity'})).value;
 const database=(await mutate('/api/databases',{containerId:container.id,title:'Decisions register'})).value;
 const record=(await mutate(`/api/databases/${database.id}/records`,{title:'Retained record',values:{}})).value;
 const recordRead=await request('GET',`/api/databases/${database.id}/records/${record.pageId}`);
 const recordPage=await request('GET',`/api/pages/${record.pageId}`);
 expect(recordRead.page).toEqual(recordPage);
 expect(recordPage.page.id).toBe(record.pageId);expect(recordPage.parentPageId).toBe(database.pageId);
 const targets=[];
 for(const title of ['First reference','Second reference']){
  const blockId=crypto.randomUUID(),treePosition=String(targets.length+1);
  const created=await mutate('/api/pages',{containerId:container.id,title,treePosition,properties:{icon:'📚',cover:{kind:'gallery',id:'forest'},labels:['identity']},blocks:[{id:blockId,blockType:'paragraph',treePosition:'a',content:{text:[{text:title+' body'}]}}]});
  const pageId=created.value.pageId;
  expect(created.receipt.entity).toEqual({kind:'page',id:pageId,revisionId:created.value.revisionId});
  const doc=await request('GET',`/api/pages/${pageId}`);
  expect(doc.page).toMatchObject({id:pageId,title,containerId:container.id,lifecycle:'live',revisionId:created.value.revisionId});
  expect(doc.properties).toMatchObject({title,icon:'📚',cover:{kind:'gallery',id:'forest'},ownerMemberId:owner.memberId,labels:['identity']});
  expect(doc.authorMemberId).toBe(owner.memberId);expect(Number.isFinite(Date.parse(doc.createdAt))).toBe(true);expect(doc.updatedAt).toBe(doc.createdAt);
  expect(doc.blocks).toHaveLength(1);expect(doc.blocks[0]).toMatchObject({id:blockId,pageId,content:{text:[{text:title+' body'}]}});
  const position=(await request('GET',`/api/pages?containerId=${container.id}`)).items.filter((p:any)=>p.id===pageId);
  expect(position).toHaveLength(1);expect(position[0]).toMatchObject({parentPageId:null,treePosition});
  expect((await request('GET',`/api/sharing/pages/${pageId}`)).inheritedItems.length).toBeGreaterThan(0);
  const comment=await mutate(`/api/comments/page/${pageId}`,{body:[{text:title+' discussion'}]});
  const decision=await mutate('/api/decisions',{pageId,question:title+' choice?',options:['Keep','Change'],outcome:'Keep',rationale:'Retain identity',ownerId:owner.memberId,decidedAt:null,reviewAt:null,citations:[]});
  await mutate(`/api/publishing/${pageId}`,{expectedRevisionId:doc.page.revisionId,host:'localhost:8787',slug:`identity-${targets.length}`});
  targets.push({pageId,commentId:comment.value.id,threadId:comment.value.threadId,decisionId:decision.value.id,revisionId:created.value.revisionId});
 }
 // Compare the complete populated inventories, including a second page that can catch cross-association.
 for(const [index,target] of targets.entries()){
  const {pageId,threadId,commentId,decisionId,revisionId}=target,other=targets[1-index]!;
  const comments=await request('GET',`/api/comments/page/${pageId}`);
  expect(comments.threads.map((t:any)=>[t.id,t.page_id])).toEqual([[threadId,pageId]]);
  expect(comments.comments.map((c:any)=>[c.id,c.threadId])).toEqual([[commentId,threadId]]);
  const revisions=(await request('GET',`/api/revisions/${pageId}`)).items;
  expect(revisions.map((r:any)=>r.id)).toEqual([revisionId]);
  expect((await request('GET',`/api/revisions/${pageId}/${revisionId}`)).blocks.every((b:any)=>b.pageId===pageId)).toBe(true);
  const wrong=await app.request(`https://slate.example/api/revisions/${other.pageId}/${revisionId}`,{headers:{cookie}},env);expect(wrong.status).toBe(404);
  expect((await request('GET',`/api/decisions/${decisionId}`)).page_id).toBe(pageId);
  expect((await request('GET',`/api/decisions?pageId=${pageId}`)).items.map((d:any)=>[d.id,d.page_id])).toEqual([[decisionId,pageId]]);
  const exposure=(await request('GET',`/api/publishing/${pageId}`)).exposure;expect(exposure.slug).toBe(`identity-${index}`);
  const rows=await env.DB.prepare('SELECT id,page_id,slug FROM public_exposures WHERE page_id IN (?,?) ORDER BY slug').bind(pageId,other.pageId).all();
  expect(rows.results.map(row=>[row.page_id,row.slug])).toEqual(targets.map((t,i)=>[t.pageId,`identity-${i}`]));
 }
 console.log('PROBE PAGE-001 2: native record and two populated reference inventories -> exact page associations; cross-page revision refused');
}
