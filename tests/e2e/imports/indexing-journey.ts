import {env} from 'cloudflare:test';
import {expect} from 'vitest';
import {strToU8,zipSync} from 'fflate';
import {createApi} from '../../../src/core/app/hono';
import {seedMember,seedWorkspace,sessionFor} from '../setup/fixtures';

type ExpectedDocument={kind:'page'|'record';title:string;body?:string;field?:string};
type NativePage={id:string;title:string;page_kind:string;container_id:string;revision_id:string};
type Projection={key:string;variant:string;workspace_id:string;kind:string;id:string;page_id:string;title:string;text:string;container_id:string;document_json:string};

/** Native reviewed import, with no search request until completion readback.
 * Faults affect only the derived index; every resume uses a fresh HTTP app. */
export async function indexingJourney(){
 const expected:ExpectedDocument[]=[],files:Record<string,Uint8Array>={};
 for(let n=1;n<=103;n++){
  const title=`synthetic-slate-page-${n}`,body=`synthetic-slate-body-${n}`;
  expected.push({kind:'page',title,body});files[`${title}.md`]=strToU8(body);
 }
 const records=Array.from({length:103},(_,index)=>{
  const title=`synthetic-slate-record-${index+1}`,field=`synthetic-slate-field-${index+1}`;
  expected.push({kind:'record',title,field});return `${title},${field}`;
 });
 const databaseTitle='synthetic-slate-database-1';
 files[`${databaseTitle}.csv`]=strToU8(['Name,Detail',...records].join('\n'));
 expected.push({kind:'page',title:databaseTitle});
 const {workspaceId}=await seedWorkspace();
 const owner=await seedMember(workspaceId,{email:['synthetic-slate-1','example.test'].join('@'),displayName:'Synthetic owner',role:'owner',isSetupOwner:true});
 const cookie=await sessionFor(owner.memberId),headers={Cookie:cookie};
 const request=(path:string,body?:unknown)=>createApi().request(`https://slate.example/api/imports${path}`,{
  method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),
 },env);
 const call=async(path:string,body?:unknown)=>{
  const response=await request(path,body),data=await response.json<any>();
  expect(response.status,JSON.stringify(data)).toBe(200);return data;
 };
 const form=new FormData();form.set('file',new File([zipSync(files)],'synthetic-slate-1.zip'));form.set('format','notion-workspace');form.set('operationKey',crypto.randomUUID());
 const uploaded=await call('',form),id:string=uploaded.id;
 let job=await call(`/${id}/preview`,{});
 expect(job.report.counts).toMatchObject({pages:expected.length,records:records.length,databases:1});
 expect(await env.DB.prepare('SELECT count(*) n FROM pages WHERE workspace_id=?').bind(workspaceId).first('n')).toBe(0);
 job=await call(`/${id}/apply`,{fingerprint:job.report.fingerprint});
 for(let n=0;job.state!=='indexing'&&n<100;n++)job=await call(`/${id}/resume`,{});
 expect(job.state).toBe('indexing');
 const pages=(await env.DB.prepare('SELECT id,title,page_kind,container_id,revision_id FROM pages WHERE workspace_id=? ORDER BY id').bind(workspaceId).all<NativePage>()).results;
 expect(pages.map(page=>page.title).sort()).toEqual(expected.map(item=>item.title).sort());
 const ids=JSON.stringify(pages.map(page=>page.id));
 const projections=async()=>(await env.DB.prepare('SELECT * FROM search_text WHERE workspace_id=? AND page_id IN (SELECT value FROM json_each(?)) ORDER BY key,variant').bind(workspaceId,ids).all<Projection>()).results;
 const dirty=async()=>(await env.DB.prepare("SELECT key,generation FROM search_dirty WHERE workspace_id=? AND substr(key,instr(key,':')+1) IN (SELECT value FROM json_each(?)) ORDER BY key").bind(workspaceId,ids).all<{key:string;generation:string}>()).results;
 const inventory=async()=>Promise.all([
  env.DB.prepare('SELECT * FROM import_native_targets WHERE import_id=? ORDER BY kind,target_id').bind(id).all(),
  ...['pages','page_blocks','page_revisions','databases','database_fields','database_records','ik_d1_stream_pages','ik_d1_history','ik_d1_entries'].map(table=>env.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()),
 ]).then(results=>results.map(result=>result.results));
 const published=await inventory(),initial=await projections(),initialDirty=await dirty();
 expect(initial.length).toBeGreaterThan(0);expect(initial.length).toBeLessThan(expected.length);
 expect(initial.length).toBeLessThanOrEqual(100);expect(initialDirty.length).toBeGreaterThan(100);
 expect(job.progress).toEqual({phase:'indexing',checkpoint:initial.length,total:expected.length});
 expect((await call(`/${id}`)).progress).toEqual(job.progress);
 expect((await call('')).jobs.find((item:{id:string})=>item.id===id)).toMatchObject({state:'indexing',progress:job.progress});
 expect(await projections()).toEqual(initial);expect(await dirty()).toEqual(initialDirty);

 // Interrupt a real D1 rebuild transaction. Its projection delete and inserts
 // roll back together, while the already-published native tree stays intact.
 await env.DB.exec('CREATE TABLE _slate_index_fault(key TEXT PRIMARY KEY)');
 await env.DB.prepare("INSERT INTO _slate_index_fault SELECT key FROM search_dirty WHERE workspace_id=? ORDER BY rowid LIMIT 1").bind(workspaceId).run();
 try{
  await env.DB.exec("CREATE TRIGGER _slate_index_interrupt BEFORE INSERT ON search_text WHEN NEW.key IN (SELECT key FROM _slate_index_fault) BEGIN SELECT RAISE(ABORT,'synthetic-slate-index-interrupted'); END");
  const interrupted=await request(`/${id}/resume`,{});expect(interrupted.status).toBe(500);
  expect(await projections()).toEqual(initial);expect(await dirty()).toEqual(initialDirty);
  expect((await call(`/${id}`))).toMatchObject({state:'indexing',progress:job.progress});
  expect(await inventory()).toEqual(published);
 }finally{await env.DB.exec('DROP TRIGGER IF EXISTS _slate_index_interrupt');}

 // A newer generation arriving as the final record projection is written must
 // survive the old generation's acknowledgement and keep Completed fenced.
 await env.DB.exec('DELETE FROM _slate_index_fault');
 await env.DB.prepare("INSERT INTO _slate_index_fault SELECT key FROM search_dirty WHERE workspace_id=? AND key LIKE 'record:%' ORDER BY rowid DESC LIMIT 1").bind(workspaceId).run();
 const renewedKey=(await env.DB.prepare('SELECT key FROM _slate_index_fault').first<string>('key'))!;
 expect(renewedKey).toBeTruthy();
 try{
  await env.DB.exec("CREATE TRIGGER _slate_index_renew AFTER INSERT ON search_text WHEN NEW.key IN (SELECT key FROM _slate_index_fault) BEGIN UPDATE search_dirty SET generation='synthetic-slate-renewed-'||generation WHERE key=NEW.key; END");
  for(let n=0;n<10;n++){
   job=await call(`/${id}/resume`,{});expect(job.state).toBe('indexing');
   expect(await inventory()).toEqual(published);
   if((await projections()).length===expected.length)break;
  }
  expect((await projections()).length).toBe(expected.length);
  const pending=await dirty();expect(pending).toHaveLength(1);expect(pending[0]!.key).toBe(renewedKey);expect(pending[0]!.generation).toContain('synthetic-slate-renewed-');
  job=await call(`/${id}`);expect(job).toMatchObject({state:'indexing',progress:{phase:'indexing',checkpoint:expected.length,total:expected.length}});
  expect((await call(`/${id}/resume`,{})).state).toBe('indexing');
 }finally{await env.DB.exec('DROP TRIGGER IF EXISTS _slate_index_renew');}

 // With no dirty key left, a missing canonical projection still forbids
 // completion. Requeue that canonical page, then resume instead of republishing.
 const missing=pages.find(page=>page.page_kind==='page')!;
 await env.DB.prepare('DELETE FROM search_text WHERE page_id=?').bind(missing.id).run();
 job=await call(`/${id}/resume`,{});expect(job.state).toBe('indexing');
 expect(await dirty()).toEqual([]);
 expect(await env.DB.prepare('SELECT key FROM search_text WHERE page_id=?').bind(missing.id).first()).toBeNull();
 expect((await call(`/${id}`)).state).toBe('indexing');
 await env.DB.prepare('UPDATE pages SET title=title WHERE id=?').bind(missing.id).run();
 job=await call(`/${id}/resume`,{});expect(job.state).toBe('completed');
 expect(job.progress).toEqual({phase:'indexing',checkpoint:expected.length,total:expected.length});
 expect(await dirty()).toEqual([]);
 const complete=await projections();expect(complete).toHaveLength(expected.length);
 for(const item of expected){
  const page=pages.find(page=>page.title===item.title)!,row=complete.find(row=>row.id===page.id)!;
  expect(row,item.title).toMatchObject({key:`${item.kind}:${page.id}`,variant:'working',workspace_id:workspaceId,kind:item.kind,id:page.id,page_id:page.id,title:item.title,container_id:page.container_id});
  expect(JSON.parse(row.document_json),item.title).toMatchObject({kind:item.kind,id:page.id,pageId:page.id,title:item.title,containerId:page.container_id,revisionId:page.revision_id,text:row.text});
  if(item.body)expect(row.text,item.title).toContain(item.body);
  if(item.field)expect(row.text,item.title).toContain(item.field);
 }
 expect(await inventory()).toEqual(published);
 expect(await env.DB.prepare('SELECT native_published FROM federation_imports WHERE id=?').bind(id).first('native_published')).toBe(1);
 expect((await call(`/${id}`))).toMatchObject({state:'completed',counts:{pages:expected.length,records:records.length}});
 expect((await call(`/${id}/resume`,{})).state).toBe('completed');
 expect(await inventory()).toEqual(published);expect(await projections()).toEqual(complete);expect(await dirty()).toEqual([]);
 await env.DB.exec('DROP TABLE _slate_index_fault');
 console.info(`PROBE PORT-004 bounded indexing: native import HTTP -> ${expected.length} canonical projections, ${records.length} records; durable Indexing, interruption rollback, renewed generation and missing projection fenced; resume retained native inventory; no search request`);
}
