import {env} from 'cloudflare:test';
import {expect} from 'vitest';
import {createApi} from '../../../src/core/app/hono';
import {sessionFor} from '../setup/fixtures';
import type {searchFixture} from './route-fixture';

/** Committed changes and erasure are observed through the same HTTP search door. */
export async function freshnessJourney(f:Awaited<ReturnType<typeof searchFixture>>) {
 const app=createApi(),cookie=await sessionFor('owner',{freshProof:true}),origin=new URL(String(env.APP_URL)).origin;
 const request=async(method:string,path:string,body?:unknown)=>{
  const response=await app.request(origin+'/api'+path,{method,headers:{cookie,origin,...(body instanceof FormData?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})},{...env,SLATE_PROFILE:undefined});
  const data=await response.json<any>();
  expect(response.status,method+' '+path+' '+JSON.stringify(data)).toBe(200);
  return data;
 };
 const revision=async(id:string)=>(await request('GET','/pages/'+id)).page.revisionId;
 const ids=async(query:string,actor='reader',filters:Record<string,string>={})=>{
  const result=await f.find(query,actor,filters);expect(result.status).toBe(200);
  return result.data.items.map((item:{id:string})=>item.id);
 };
 const observed=async(mutate:()=>Promise<unknown>,check:()=>Promise<void>,deadline=5000)=>{
  await mutate();const start=performance.now();await check();expect(performance.now()-start).toBeLessThan(deadline);
 };
 const created=await request('POST','/pages',{operationKey:crypto.randomUUID(),containerId:'c',title:'Freshness initial guide'});
 const id:string=created.value.pageId,createdAt=performance.now();
 expect(await ids('Freshness initial guide')).toEqual([id]);expect(performance.now()-createdAt).toBeLessThan(5000);
 await observed(async()=>request('PATCH','/pages/'+id,{operationKey:crypto.randomUUID(),expectedRevisionId:await revision(id),properties:{title:'Freshness revised guide'}}),async()=>{
  expect(await ids('Freshness initial guide')).toEqual([]);expect(await ids('Freshness revised guide')).toEqual([id]);
 });
 const destination=(await request('POST','/containers',{operationKey:crypto.randomUUID(),name:'Freshness destination',visibility:'default'})).value.id;
 await observed(async()=>{
  const placement={containerId:destination,treePosition:'a'};
  const preview=await request('POST','/pages/'+id+'/move-preview',placement);
  await request('POST','/pages/'+id+'/move',{...placement,operationKey:crypto.randomUUID(),expectedRevisionId:await revision(id),accessPreviewHash:preview.accessPreviewHash});
 },async()=>{
  expect(await ids('Freshness revised guide','owner',{containerId:'c'})).toEqual([]);
  expect(await ids('Freshness revised guide','owner',{containerId:destination})).toEqual([id]);
 });
 for(const action of ['archive','restore','trash','restore'] as const)await observed(async()=>{
  const expectedRevisionId=action==='restore'?(await request('GET','/archive')).items.find((item:{id:string})=>item.id===id).revisionId:await revision(id);
  await request('POST','/archive/'+id,{operationKey:crypto.randomUUID(),expectedRevisionId,action});
 },async()=>{
  expect(await ids('Freshness revised guide','owner')).toEqual(action==='restore'?[id]:[]);
  expect(await ids('Freshness revised guide','owner',{includeArchived:'true',includeTrashed:'true'})).toEqual([id]);
 });
 // A draft must become readable to the searching member only after publication.
 const workspace=await request('GET','/workspace');
 const configure=async(policies:Record<string,string>)=>{
  const current=await request('GET','/workspace');
  await request('PUT','/workspace',{operationKey:crypto.randomUUID(),expectedRevisionId:current.revisionId,name:current.name,mark:current.mark,description:current.description,guestAccess:current.guestAccess,publicLinkAccess:current.publicLinkAccess,anonymousAccess:current.anonymousAccess,policies});
 };
 await configure({...workspace.policies,'page.lifecycle.v1':'draft-then-publish'});
 const draft=(await request('POST','/pages',{operationKey:crypto.randomUUID(),containerId:'c',title:'Freshness publication guide'})).value.pageId;
 expect(await ids('Freshness publication guide')).toEqual([]);
 await observed(async()=>request('POST','/pages/'+draft+'/publish',{operationKey:crypto.randomUUID(),expectedRevisionId:await revision(draft)}),async()=>{
  expect(await ids('Freshness publication guide')).toEqual([draft]);
 });
 await configure(workspace.policies);
 // An already indexed retained record must stop matching after confirmed erasure.
 await request('POST','/archive/'+id,{operationKey:crypto.randomUUID(),expectedRevisionId:await revision(id),action:'trash'});
 const erase={operationKey:crypto.randomUUID(),confirmedPageIds:[id]};
 await observed(async()=>request('POST','/archive/'+id+'/permanent-delete',erase),async()=>{
  expect(await ids('Freshness revised guide','owner',{includeArchived:'true',includeTrashed:'true'})).toEqual([]);
 });
 await request('POST','/archive/'+id+'/permanent-delete',erase);
 expect(await ids('Freshness revised guide','owner',{includeArchived:'true',includeTrashed:'true'})).toEqual([]);
 // Replay of a completed import may never bring its erased source back.
 const form=new FormData();form.set('file',new File(['Freshness imported body'], 'Freshness import.txt',{type:'text/plain'}));form.set('format','text');form.set('operationKey',crypto.randomUUID());
 const imported=await request('POST','/imports',form);
 // A stale projection written during the text import's native rebuild must
 // keep this separate publication door Indexing, even with no dirty key left.
 await f.db.exec(`CREATE TRIGGER _slate_text_index_stale AFTER INSERT ON search_text
  WHEN NEW.kind='page' AND NEW.text LIKE '%Freshness imported body%'
  BEGIN UPDATE search_text SET document_json=json_set(document_json,'$.revisionId','synthetic-slate-stale-2')
   WHERE key=NEW.key AND variant=NEW.variant; END`.replaceAll('\n',' '));
 try{
  const indexed=await request('POST','/imports/'+imported.id+'/run',{});expect(indexed.state).toBe('indexing');
  expect((await request('GET','/imports/'+imported.id)).state).toBe('indexing');
 }finally{await f.db.exec('DROP TRIGGER IF EXISTS _slate_text_index_stale');}
 const published=(await f.db.prepare('SELECT * FROM pages WHERE id IN (SELECT target_id FROM federation_import_mappings WHERE import_job_id=?) ORDER BY id').bind(imported.id).all()).results;
 expect(published.length).toBeGreaterThan(0);
 expect((await request('POST','/imports/'+imported.id+'/resume',{})).state).toBe('indexing');
 expect((await f.db.prepare('SELECT * FROM pages WHERE id IN (SELECT target_id FROM federation_import_mappings WHERE import_job_id=?) ORDER BY id').bind(imported.id).all()).results).toEqual(published);
 await f.db.prepare('UPDATE pages SET title=title WHERE id IN (SELECT target_id FROM federation_import_mappings WHERE import_job_id=?)').bind(imported.id).run();
 const complete=await request('POST','/imports/'+imported.id+'/resume',{});expect(complete.state).toBe('completed');
 const mapped=(await f.db.prepare("SELECT target_id FROM federation_import_mappings WHERE import_job_id=? AND target_kind='page'").bind(imported.id).all<{target_id:string}>()).results;
 expect(mapped.length).toBeGreaterThan(0);
 for(const row of mapped){
  expect(await f.db.prepare('SELECT 1 FROM search_text WHERE page_id=?').bind(row.target_id).first()).not.toBeNull();
  expect(await f.db.prepare("SELECT 1 FROM search_dirty WHERE key IN ('page:'||?,'record:'||?)").bind(row.target_id,row.target_id).first()).toBeNull();
 }
 expect(await ids('Freshness imported body','owner')).toEqual(mapped.map(row=>row.target_id));
 await request('POST','/archive/'+mapped[0]!.target_id,{operationKey:crypto.randomUUID(),expectedRevisionId:await revision(mapped[0]!.target_id),action:'trash'});
 await request('POST','/archive/'+mapped[0]!.target_id+'/permanent-delete',{operationKey:crypto.randomUUID(),confirmedPageIds:[mapped[0]!.target_id]});
 const replay=await app.request(origin+'/api/imports/'+imported.id+'/run',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}'},{...env,SLATE_PROFILE:undefined});
 expect(replay.status).toBe(409);
 expect(await ids('Freshness imported body','owner',{includeArchived:'true',includeTrashed:'true'})).toEqual([]);
}
