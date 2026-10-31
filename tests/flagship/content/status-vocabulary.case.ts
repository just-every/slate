import {expect} from 'vitest';
import {env} from 'cloudflare:test';
import {createApi} from '../../../src/core/app/hono';
import {createUlid} from '../../../src/core/shared/ulid';
import {seedMember,sessionFor} from '../../e2e/setup/fixtures';

/** Real bootstrap and session-checked routes; only identity fixtures bypass transport. */
export async function statusVocabularyCase() {
  const origin=new URL(String(env.APP_URL)).origin;
  const token='a'.repeat(64);
  const hosted={...env,SETUP_TOKEN:token,SETUP_OWNER_EMAIL:['synthetic-slate-1','test.invalid'].join('@')} as typeof env;
  const app=createApi();
  const claimed=await app.request(origin+'/auth/bootstrap',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token,displayName:'Synthetic owner',returnTo:'/'})},hosted);
  expect(claimed.status).toBe(303);
  const ownerCookie=claimed.headers.get('set-cookie')!.split(';',1)[0]!;
  const request=async(method:string,path:string,body?:unknown,cookie=ownerCookie)=>{
    const response=await app.request(origin+path,{method,headers:{cookie,origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},hosted);
    return {status:response.status,data:await response.json<any>()};
  };
  const read=async(path:string)=>{const response=await request('GET',path);expect(response.status,JSON.stringify(response.data)).toBe(200);return response.data;};
  const workspace=await read('/api/workspace');
  const {memberId}=await seedMember(workspace.id,{role:'member',email:['synthetic-slate-2','test.invalid'].join('@'),displayName:'Synthetic member'});
  const memberCookie=await sessionFor(memberId);
  const seeded=[['in-progress','In progress','#4488cc',0],['ready-for-review','Ready for review','#cc9900',0],['rough-draft','Rough draft','#8b9098',0],['verified','Verified','#228855',1]];
  const entries=async()=> (await read('/api/status')).items;
  for(const profile of ['verification-only','open-vocabulary']) {
    const w=await read('/api/workspace');
    const settings={operationKey:createUlid(),expectedRevisionId:w.revisionId,name:w.name,mark:w.mark,description:w.description,guestAccess:w.guestAccess,publicLinkAccess:w.publicLinkAccess,anonymousAccess:w.anonymousAccess,policies:{...w.policies,'page.status.v1':profile}};
    expect((await request('PUT','/api/workspace',settings)).status).toBe(200);
    expect((await entries()).filter((s:any)=>seeded.some(([key])=>key===s.key)).map((s:any)=>[s.key,s.label,s.color,s.requiresVerification]).sort()).toEqual(seeded);
    const key=createUlid(),input={operationKey:createUlid(),key,label:'Synthetic review',color:'#123456',requiresVerification:false};
    const added=await request('POST','/api/status',input);expect(added.status).toBe(200);
    expect((await request('POST','/api/status',input)).data).toEqual(added.data);
    const space=(await read('/api/containers')).items[0];
    const created=await request('POST','/api/pages',{operationKey:createUlid(),containerId:space.id,title:'Retain status',properties:{statusKey:key}});
    expect(created.status).toBe(200);const pageId=created.data.value.pageId;
    const renamed={...input,operationKey:createUlid(),label:'Synthetic renamed',color:'#2468ac'};
    expect((await request('POST','/api/status',renamed)).status).toBe(200);
    const beforePage=await read(`/api/pages/${pageId}`),beforeHistory=await read(`/api/revisions/${pageId}`);
    const retired={...renamed,operationKey:createUlid(),retire:true};
    expect((await request('POST','/api/status',retired)).status).toBe(200);
    expect(await read(`/api/pages/${pageId}`)).toEqual(beforePage);
    expect(await read(`/api/revisions/${pageId}`)).toEqual(beforeHistory);
    expect((await entries()).find((s:any)=>s.key===key)).toMatchObject({key,label:'Synthetic renamed',color:'#2468ac',requiresVerification:0,retiredAt:expect.any(String)});
    expect((await read('/api/pages')).items.find((p:any)=>p.id===pageId).statusKey).toBe(key);
    const beforeVocabulary=await entries();
    const beforeActivity=await env.DB.prepare('SELECT * FROM activity_entries ORDER BY id').all();
    const beforeReceipts=await env.DB.prepare('SELECT * FROM operation_receipts ORDER BY id').all();
    for(const denied of [
      {...input,operationKey:createUlid(),key:createUlid()},
      {...renamed,operationKey:createUlid(),label:'Unauthorized rename'},
      {...renamed,operationKey:createUlid(),color:'#112233'},
      {...input,operationKey:createUlid(),key:'verified',requiresVerification:true,retire:true},
      input,
    ]) {
      expect((await request('POST','/api/status',denied,memberCookie)).status).toBe(403);
      expect(await entries()).toEqual(beforeVocabulary);
      expect(await read(`/api/pages/${pageId}`)).toEqual(beforePage);
    }
    expect((await env.DB.prepare('SELECT * FROM activity_entries ORDER BY id').all()).results).toEqual(beforeActivity.results);
    expect((await env.DB.prepare('SELECT * FROM operation_receipts ORDER BY id').all()).results).toEqual(beforeReceipts.results);
    const bulk={operationKey:createUlid(),action:'status',statusKey:'in-progress',pages:[{id:pageId,expectedRevisionId:beforePage.page.revisionId}]};
    const applied=await request('POST','/api/pages/bulk',bulk);expect(applied.status).toBe(200);expect(applied.data.items[0].success).toBe(true);
    expect((await request('POST','/api/pages/bulk',bulk)).data).toEqual(applied.data);
    const after=await read(`/api/pages/${pageId}`);expect(after.properties.statusKey).toBe('in-progress');expect(after.blocks).toEqual(beforePage.blocks);
    const receipt=applied.data.items[0].result.receipt;
    expect(await env.DB.prepare('SELECT id,operation_key FROM activity_entries WHERE target_id=? AND action=?').bind(pageId,'pages.status').all().then(r=>r.results)).toEqual([{id:receipt.activityId,operation_key:receipt.operationKey}]);
    // A revoked native session cannot replay its previous owner-authorized write.
    const saved=(await entries());
    const owner=await env.DB.prepare('SELECT id FROM members WHERE role=?').bind('owner').first<{id:string}>();
    const revocable=await sessionFor(owner!.id);
    const own={...input,operationKey:createUlid(),key:createUlid()};
    expect((await request('POST','/api/status',own,revocable)).status).toBe(200);
    const beforeRevocation=await entries();
    // Revoke the exact token through its digest, independent of session ordering.
    const {sessionDigest}=await import('../../../src/core/platform/auth/token');
    await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE token_digest=?').bind(new Date().toISOString(),await sessionDigest(String(env.SESSION_SECRET),revocable.split('=')[1]!)).run();
    const refused=await request('POST','/api/status',own,revocable);expect(refused.status).toBe(401);
    expect((await entries()).length).toBe(saved.length+1);
    expect(await entries()).toEqual(beforeRevocation);
    expect(await read(`/api/pages/${pageId}`)).toEqual(after);
  }
}
