import {expect} from 'vitest';
import {env} from 'cloudflare:test';
import {fixture,createUlid} from '../backend/fixture';
export {env,createUlid};
export async function auditFixture(){
 const f=await fixture();
 const mutation=async(family:string,action:string,method:string,path:string,body:Record<string,unknown>)=>{
  const operationKey=createUlid(),input={...body,operationKey};const response=await f.request(method,path,input);expect(response.status,JSON.stringify(response)).toBeGreaterThanOrEqual(200);expect(response.status,JSON.stringify(response)).toBeLessThan(300);
  await assertAudit(f.workspaceId,operationKey,action,f.ownerId,family);const replay=await f.request(method,path,input);expect(replay.status,JSON.stringify(replay)).toBe(response.status);expect(replay.data).toEqual(response.data);await assertAudit(f.workspaceId,operationKey,action,f.ownerId,family);return response.data;
 };
 const revision=async(id:string)=>(await env.DB.prepare('SELECT revision_id FROM pages WHERE id=?').bind(id).first<{revision_id:string}>())!.revision_id;
 const profile=async(changes:Record<string,string>)=>{const w=(await f.request('GET','/api/workspace')).data;const response=await f.request('PUT','/api/workspace',{operationKey:createUlid(),expectedRevisionId:w.revisionId,name:w.name,mark:w.mark,description:w.description,guestAccess:w.guestAccess,publicLinkAccess:w.publicLinkAccess,anonymousAccess:w.anonymousAccess,policies:{...w.policies,...changes}});expect(response.status,JSON.stringify(response)).toBe(200);};
 return {...f,mutation,revision,profile};
}
export async function assertAudit(workspace:string,key:string,action:string,actor:string,family:string){
 const rows=(await env.DB.prepare('SELECT id,action,actor_member_id,feature,target_kind,target_id,occurred_at,operation_key FROM activity_entries WHERE workspace_id=? AND operation_key=?').bind(workspace,key).all()).results;
 expect(rows,`${family}: one attributed durable activity`).toHaveLength(1);expect(rows[0]).toMatchObject({action,actor_member_id:actor,operation_key:key});expect(Number.isFinite(Date.parse(String(rows[0].occurred_at)))).toBe(true);expect(String(rows[0].feature).length).toBeGreaterThan(0);expect(String(rows[0].target_kind).length).toBeGreaterThan(0);expect(String(rows[0].target_id).length).toBeGreaterThan(0);
 console.info('AUDIT_RECEIPT',JSON.stringify({family,...rows[0]}));return rows[0];
}

/** Native page writes, including an abort after the activity insert in the real D1 transaction. */
export async function pageDurabilityProof(f:Awaited<ReturnType<typeof auditFixture>>) {
 const created=await f.mutation('atomic page creation','pages.create','POST','/api/pages',{containerId:f.containerId,title:'synthetic-slate-atomic'});
 const id=created.value.pageId;
 const assertCommitted=async(result:any,text?:string)=>{
  const {receipt}=result;
  const document=await f.request('GET',`/api/pages/${id}`);expect(document.status).toBe(200);
  expect(document.data.page.revisionId).toBe(receipt.revisionId);
  const revision=await f.request('GET',`/api/revisions/${id}/${receipt.revisionId}`);expect(revision.status).toBe(200);
  if(text)expect(JSON.stringify(revision.data.blocks)).toContain(text);
  const stored=await env.DB.prepare('SELECT response_json,target_kind,target_id FROM operation_receipts WHERE workspace_id=? AND operation_key=?').bind(f.workspaceId,receipt.operationKey).first<any>();
  expect(stored).toMatchObject({target_kind:'page',target_id:id});expect(JSON.parse(stored.response_json)).toEqual(result);
  const timeline=await f.request('GET','/api/activity?kind=page&limit=100');expect(timeline.status).toBe(200);
  const entries=timeline.data.items.filter((entry:any)=>entry.operationKey===receipt.operationKey);
  expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({id:receipt.activityId,target:{kind:'page',id},context:{pageId:id,revisionId:receipt.revisionId},actor:{id:f.ownerId}});
 };
 await assertCommitted(created);
 const blockId=createUlid(),path=`/api/pages/${id}/blocks`;
 const committed=await f.mutation('atomic native body','pages.blocks.replace','PUT',path,{expectedRevisionId:await f.revision(id),blocks:[{id:blockId,blockType:'paragraph',treePosition:'1',content:{text:[{text:'synthetic-slate-committed-body'}]}}]});
 await assertCommitted(committed,'synthetic-slate-committed-body');
 const snapshot=async()=>({
  document:(await f.request('GET',`/api/pages/${id}`)).data,
  page:await env.DB.prepare('SELECT * FROM pages WHERE id=?').bind(id).first(),
  blocks:(await env.DB.prepare('SELECT * FROM page_blocks WHERE page_id=? ORDER BY id').bind(id).all()).results,
  revisions:(await env.DB.prepare('SELECT * FROM page_revisions WHERE page_id=? ORDER BY id').bind(id).all()).results,
  receipts:(await env.DB.prepare("SELECT * FROM operation_receipts WHERE workspace_id=? AND target_kind='page' AND target_id=? ORDER BY id").bind(f.workspaceId,id).all()).results,
  activity:(await env.DB.prepare("SELECT * FROM activity_entries WHERE workspace_id=? AND target_kind='page' AND target_id=? ORDER BY id").bind(f.workspaceId,id).all()).results,
 });
 const before=await snapshot(),operationKey=createUlid();
 const input={operationKey,expectedRevisionId:await f.revision(id),blocks:[{id:blockId,blockType:'paragraph',treePosition:'1',content:{text:[{text:'synthetic-slate-failed-body'}]}}]};
 // This test-only storage fault fires after receipt, revision, page and activity writes, never before admission.
 await env.DB.prepare(`CREATE TRIGGER synthetic_slate_late_audit_failure AFTER INSERT ON activity_entries WHEN NEW.operation_key='${operationKey}' BEGIN SELECT RAISE(ABORT,'synthetic-slate-late-batch-failure'); END`).run();
 try {
  const failed=await f.request('PUT',path,input);expect(failed.status).toBe(500);
  expect(await snapshot()).toEqual(before);
  expect(await env.DB.prepare('SELECT id FROM operation_receipts WHERE workspace_id=? AND operation_key=?').bind(f.workspaceId,operationKey).first()).toBeNull();
  expect(await env.DB.prepare('SELECT id FROM activity_entries WHERE workspace_id=? AND operation_key=?').bind(f.workspaceId,operationKey).first()).toBeNull();
 } finally {await env.DB.prepare('DROP TRIGGER synthetic_slate_late_audit_failure').run();}
 const retry=await f.request('PUT',path,input);expect(retry.status).toBe(200);
 expect((await f.request('PUT',path,input)).data).toEqual(retry.data);
 await assertCommitted(retry.data,'synthetic-slate-failed-body');
}

/** Every retained context comes from a native mutation, and current access fences it. */
export async function activityContextProof(f:Awaited<ReturnType<typeof auditFixture>>) {
 const page=await f.page('synthetic-slate-context');
 const comment=await f.mutation('exact comment context','comments.create','POST',`/api/comments/page/${page.id}`,{body:[{text:'synthetic-slate-thread'}]});
 const grant=await f.mutation('exact grant context','sharing.grant','POST','/api/sharing',{targetKind:'page',targetId:page.id,principalKind:'member',principalId:f.readerId,level:'view'});
 const timeline=await f.request('GET','/api/activity?limit=100');expect(timeline.status).toBe(200);
 const entry=(id:string)=>timeline.data.items.find((row:any)=>row.id===id);
 expect(entry(comment.receipt.activityId).context).toEqual({pageId:page.id,threadId:comment.value.threadId,commentId:comment.value.id});
 expect(entry(grant.receipt.activityId).context).toEqual({pageId:page.id,grantId:grant.value.id});
 const retained=await env.DB.prepare('SELECT * FROM activity_entries WHERE id IN (?,?) ORDER BY id').bind(comment.receipt.activityId,grant.receipt.activityId).all();
 expect((await f.request('GET',`/api/comments/page/${page.id}`,undefined,f.readerId)).status).toBe(200);
 expect((await f.request('GET',`/api/sharing/pages/${page.id}`)).data.items.some((row:any)=>row.id===grant.value.id)).toBe(true);
 expect((await env.DB.prepare('SELECT * FROM activity_entries WHERE id IN (?,?) ORDER BY id').bind(comment.receipt.activityId,grant.receipt.activityId).all()).results).toEqual(retained.results);
 await f.mutation('revoke context access','sharing.grant','POST','/api/sharing',{targetKind:'page',targetId:page.id,id:grant.value.id,principalKind:'member',principalId:f.readerId,level:'view',revoke:true});
 expect((await f.request('GET',`/api/pages/${page.id}`,undefined,f.readerId)).status).toBe(404);
 expect((await f.request('GET',`/api/comments/page/${page.id}`,undefined,f.readerId)).status).toBe(404);
 const denied=await f.request('GET','/api/activity?limit=100',undefined,f.readerId);expect(denied.status).toBe(200);
 expect(denied.data.items.some((row:any)=>row.context.pageId===page.id||row.target.id===page.id||row.target.id===comment.value.threadId)).toBe(false);
 expect((await f.request('POST',`/api/comments/page/${page.id}`,{operationKey:comment.receipt.operationKey,body:[{text:'synthetic-slate-thread'}]},f.readerId)).status).toBe(404);
}
