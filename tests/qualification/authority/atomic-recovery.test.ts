import {env} from 'cloudflare:test';
import {zipSync} from 'fflate';
import {test,expect,beforeEach,vi} from 'vitest';
import {fixture,reset,document} from './fixture';
import {sessionFor} from '../../e2e/setup/fixtures';
import {createApi} from '../../../src/core/app/hono';
import {decodeArchive} from '../../../src/core/features/portability/archive';

beforeEach(reset);
test('PORT-006 — a late D1 restore failure rolls back prior records and staged R2 originals, then the exact archive retries successfully',async()=>{
 const app=createApi(),origin=new URL(env.APP_URL!).origin;
 const request=(path:string,cookie?:string,options:RequestInit={})=>app.request(new URL(path,origin).href,{
  ...options,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...options.headers},
 },env);
 const run=(id:string,cookie:string)=>request(`/api/exports/jobs/${id}/run`,cookie,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 const f=await fixture(),page=await document(f,'Atomic recovery original'),sourceCookie=await sessionFor(f.owner,{freshProof:true});
 const original=new TextEncoder().encode('synthetic-slate-atomic-original');
 const upload=new FormData();upload.set('operationKey',crypto.randomUUID());upload.set('pageId',page.id);upload.set('file',new File([original],'original.txt',{type:'text/plain'}));
 const uploaded=await request('/api/media',sourceCookie,{method:'POST',body:upload});
 expect(uploaded.status).toBe(200);
 const file=(await uploaded.json() as {value:{id:string}}).value;
 const exported=await request('/api/exports/jobs/workspace',sourceCookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationKey:crypto.randomUUID()})});
 expect(exported.status).toBe(202);
 const exportId=(await exported.json() as {id:string}).id;
 const completed=await run(exportId,sourceCookie);expect(completed.status).toBe(200);
 expect(await completed.json()).toMatchObject({state:'completed'});
 const download=await request(`/api/exports/${exportId}/download`,sourceCookie);expect(download.status).toBe(200);
 const archive=new Uint8Array(await download.arrayBuffer()),decoded=await decodeArchive(archive);
 expect(decoded.manifest.blobs.length).toBeGreaterThan(0);
 const nonOwnerForm=new FormData();nonOwnerForm.set('operationKey',crypto.randomUUID());nonOwnerForm.set('file',new File([archive],'workspace.zip',{type:'application/zip'}));
 expect((await request('/api/exports/jobs/restore',await sessionFor(f.reader,{freshProof:true}),{method:'POST',body:nonOwnerForm})).status).toBe(403);
 await reset();
 for(const object of (await env.FILES.list()).objects)await env.FILES.delete(object.key);
 const target=await fixture({withReader:false}),cookie=await sessionFor(target.owner,{freshProof:true});
 const stage=(operationKey:string,token?:string)=>{
  const form=new FormData();form.set('operationKey',operationKey);form.set('file',new File([archive],'workspace.zip',{type:'application/zip'}));
  return request('/api/exports/jobs/restore',token,{method:'POST',body:form});
 };
 const inventory=async()=>(await env.FILES.list()).objects.map(o=>o.key).sort();
 const before=await inventory();
 const identity=await env.DB.prepare('SELECT * FROM members WHERE id=?').bind(target.owner).first();
 const workspace=await env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(target.workspaceId).first();
 const schema=async()=>(await env.DB.prepare("SELECT type,name,sql FROM sqlite_master WHERE name<>'qualification_restore_abort' ORDER BY type,name").all()).results;
 const beforeSchema=await schema();
 expect((await stage(crypto.randomUUID())).status).toBe(401);
 expect((await stage(crypto.randomUUID(),await sessionFor(target.owner,{revokedAt:new Date().toISOString()}))).status).toBe(401);
 const damaged=new FormData();damaged.set('operationKey',crypto.randomUUID());damaged.set('file',new File([zipSync({...decoded.entries,[decoded.manifest.blobs[0]!.entry]:new Uint8Array([0])})],'damaged.zip',{type:'application/zip'}));
 const refused=await request('/api/exports/jobs/restore',cookie,{method:'POST',body:damaged});
 expect(refused.status).toBe(400);expect(await refused.json()).toMatchObject({code:'CORRUPT_ARCHIVE'});
 expect(await env.DB.prepare('SELECT count(*) AS n FROM portability_jobs').first<number>('n')).toBe(0);
 expect(await inventory()).toEqual(before);
 const key=crypto.randomUUID(),admitted=await stage(key,cookie);
 expect(admitted.status).toBe(202);
 const queued=await admitted.json() as {id:string};
 expect(await (await request(`/api/exports/jobs/${queued.id}`,cookie)).json()).toMatchObject({state:'queued'});
 const stagedObjects:{key:string;bytes:Uint8Array}[]=[];
 const nativeDelete=env.FILES.delete.bind(env.FILES);
 const deletion=vi.spyOn(env.FILES,'delete').mockImplementation(async key=>{
  for(const item of typeof key==='string'?[key]:key){
   const object=await env.FILES.get(item);
   if(object&&item.startsWith('federation/restore/'))stagedObjects.push({key:item,bytes:new Uint8Array(await object.arrayBuffer())});
  }
  await nativeDelete(key);
 });
 await env.DB.prepare("CREATE TRIGGER qualification_restore_abort BEFORE INSERT ON page_blocks BEGIN SELECT RAISE(ABORT,'labelled late recovery fault'); END").run();
 try{
  const failed=await run(queued.id,cookie);expect(failed.status).toBe(200);
  expect(await failed.json()).toMatchObject({id:queued.id,state:'failed',counts:{},report:{code:'RESTORE_FAILED'}});
  expect(await (await request(`/api/exports/jobs/${queued.id}`,cookie)).json()).toMatchObject({state:'failed',report:{code:'RESTORE_FAILED'}});
  expect(stagedObjects).toHaveLength(decoded.manifest.blobs.length);
  for(const blob of decoded.manifest.blobs){
   const staged=stagedObjects.find(object=>object.key.endsWith('/'+blob.entry));
   expect(staged?.bytes).toEqual(decoded.entries[blob.entry]);
  }
  for(const table of ['pages','containers','page_blocks','page_revisions','files','groups','comments']){
   expect(await env.DB.prepare(`SELECT count(*) AS n FROM "${table}"`).first<number>('n')).toBe(0);
  }
  expect(await inventory()).toEqual(before);
  expect(await env.DB.prepare('SELECT * FROM members WHERE id=?').bind(target.owner).first()).toEqual(identity);
  expect(await env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(target.workspaceId).first()).toEqual(workspace);
  expect(await schema()).toEqual(beforeSchema);
  expect((await request(`/api/pages/${page.id}`,cookie)).status).toBe(404);
  expect((await request(`/api/media/${file.id}`,cookie)).status).toBe(404);
  expect(await (await stage(key,cookie)).json()).toMatchObject({id:queued.id,state:'failed'});
  expect(await (await run(queued.id,cookie)).json()).toMatchObject({state:'failed'});
 }finally{
  deletion.mockRestore();
  await env.DB.prepare('DROP TRIGGER qualification_restore_abort').run();
 }
 const retry=await stage(crypto.randomUUID(),cookie);expect(retry.status).toBe(202);
 const retried=await retry.json() as {id:string};expect(retried.id).not.toBe(queued.id);
 const restored=await run(retried.id,cookie);expect(restored.status).toBe(200);
 expect(await restored.json()).toMatchObject({state:'completed',counts:{pages:1,files:1}});
 expect(await env.DB.prepare('SELECT count(*) AS n FROM pages').first<number>('n')).toBe(1);
 expect((await env.FILES.list({prefix:'federation/restore/'})).objects.length).toBeGreaterThan(before.filter(key=>key.startsWith('federation/restore/')).length);
 expect((await request('/api/session',cookie)).status).toBe(401);
 const restoredCookie=await sessionFor(f.owner,{freshProof:true});
 const read=await request(`/api/pages/${page.id}`,restoredCookie);expect(read.status).toBe(200);
 expect(await read.json()).toMatchObject({page:{id:page.id,title:'Atomic recovery original'}});
 const media=await request(`/api/media/${file.id}`,restoredCookie);expect(media.status).toBe(200);
 expect(new Uint8Array(await media.arrayBuffer())).toEqual(original);
 expect(await (await request(`/api/exports/jobs/${retried.id}`,restoredCookie)).json()).toMatchObject({state:'completed'});
 expect(await schema()).toEqual(beforeSchema);
});
