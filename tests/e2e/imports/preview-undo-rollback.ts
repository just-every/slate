import {expect,vi} from 'vitest';
import {env} from 'cloudflare:test';
import {createApi} from '../../../src/core/app/hono';
import type {ImportFormat} from '../../../src/core/features/imports';
import {seedWorkspace,seedMember,sessionFor} from '../setup/fixtures';
import {resetDatabase} from '../setup/reset-database';
import {syntheticConfluenceArchive,syntheticDocx} from './fixtures/synthetic';
import type {StoredReview} from '../../../src/core/features/imports/preview';

async function nativeSnapshot() {
 const rows:Record<string,unknown>={};
 for(const table of ['containers','pages','page_blocks','files','page_revisions','core_entity_revisions','federation_import_mappings','operation_receipts','activity_entries'])rows[table]=(await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
 return rows;
}

async function bucketSnapshot() {
 const objects:{key:string;etag:string;size:number}[]=[];let cursor:string|undefined;
 do{const page=await env.FILES.list({cursor});objects.push(...page.objects.map(({key,etag,size})=>({key,etag,size})));cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return objects.sort((a,b)=>a.key.localeCompare(b.key));
}

async function importDoor() {
 vi.restoreAllMocks();await resetDatabase(env.DB);await env.DB.exec('DROP TABLE IF EXISTS _rer_deploy_migrations');
 const {workspaceId}=await seedWorkspace();
 const owner=await seedMember(workspaceId,{email:['synthetic-slate-1','example.test'].join('@'),displayName:'Import owner',role:'owner',isSetupOwner:true});
 const reader=await seedMember(workspaceId,{email:['synthetic-slate-2','example.test'].join('@'),displayName:'Other member',role:'member'});
 const cookie=await sessionFor(owner.memberId),readerCookie=await sessionFor(reader.memberId),app=createApi();
 const request=(path:string,body?:unknown,as=cookie)=>app.request(`https://slate.example/api${path}`,{
  method:body===undefined?'GET':'POST',headers:{Cookie:as,...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),
 },env);
 const call=async(path:string,body?:unknown)=>{const response=await request(path,body),data=await response.json() as any;expect(response.status,JSON.stringify(data)).toBe(200);return data;};
 const upload=async(format:ImportFormat,name:string,bytes:Uint8Array,destination?:{pageId:string;revisionId:string;mode:'append'|'children'})=>{
  const form=new FormData();form.set('file',new File([bytes as Uint8Array<ArrayBuffer>],name));form.set('format',format);form.set('operationKey',crypto.randomUUID());
  if(destination){form.set('destinationPageId',destination.pageId);form.set('expectedRevisionId',destination.revisionId);form.set('mode',destination.mode);}
  return call('/imports',form);
 };
 const original=async(id:string,bytes:Uint8Array)=>{const response=await request(`/imports/${id}/original`);expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);};
 return {request,call,upload,original,cookie,readerCookie};
}

export async function cancelsReviewedPreparation(format:'notion-workspace'|'confluence-space',stage:'media'|'sealed') {
 const door=await importDoor(),name=format==='notion-workspace'?'notion-workspace-export.zip':'synthetic-slate-5.zip';
 // A populated native tree and readable attachment must survive cancellation.
 let control=await door.upload('docx','synthetic-slate-3.docx',syntheticDocx());
 control=await door.call(`/imports/${control.id}/run`,{});expect(control.state).toBe('completed');
 const controlPage=await env.DB.prepare('SELECT id FROM pages').first<{id:string}>();expect(controlPage).toBeTruthy();
 const controlContent=await door.call(`/pages/${controlPage!.id}`);
 const controlMedia=await env.DB.prepare('SELECT id FROM files').first<{id:string}>();expect(controlMedia).toBeTruthy();
 const readable=await door.request(`/media/${controlMedia!.id}`);expect(readable.status).toBe(200);
 const controlBytes=new Uint8Array(await readable.arrayBuffer());expect(controlBytes.length).toBeGreaterThan(0);
 // The committed Cloud export has no attachments. The existing synthetic
 // Server and Data Center fixture supplies real media for this cleanup path.
 const bytes=format==='confluence-space'?syntheticConfluenceArchive():new Uint8Array(await (await (env as typeof env & {TEST_IMPORT_FIXTURES:Fetcher}).TEST_IMPORT_FIXTURES.fetch(`https://fixtures/${name}`)).arrayBuffer());
 let job=await door.upload(format,name,bytes);const id=job.id;
 job=await door.call(`/imports/${id}/preview`,{});expect(job.state).toBe('preview');
 const planKey=await env.DB.prepare('SELECT plan_key FROM federation_imports WHERE id=?').bind(id).first<string>('plan_key');
 const review=await (await env.FILES.get(planKey!))!.json<StoredReview>();
 expect(review.pageIds.length).toBeGreaterThan(0);expect(review.containerIds.length).toBeGreaterThan(0);expect(review.mediaSources.length).toBeGreaterThan(0);
 const media=(await env.DB.prepare("SELECT storage_key,available FROM import_objects WHERE import_id=? AND kind='media' ORDER BY storage_key").bind(id).all<{storage_key:string;available:number}>()).results;
 expect(media.length).toBeGreaterThan(0);
 for(const item of media){expect(item.available).toBe(0);expect(await env.FILES.head(item.storage_key)).toBeNull();}
 const before=await nativeSnapshot(),beforeFiles=await bucketSnapshot();
 const invisible=async()=>{
  for(const [table,column,ids] of [
   ['pages','id',review.pageIds],['containers','id',review.containerIds],
   ['page_blocks','page_id',review.pageIds],['files','page_id',review.pageIds],
  ] as const)expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).first('n'),table).toBe(0);
  expect(await nativeSnapshot()).toEqual(before);
  expect(await env.DB.prepare('SELECT native_published FROM federation_imports WHERE id=?').bind(id).first('native_published')).toBe(0);
 };
 const unreadable=async()=>{
  for(const as of [door.cookie,door.readerCookie]){
   for(const pageId of review.pageIds)expect((await door.request(`/pages/${pageId}`,undefined,as)).status).toBe(404);
   for(const containerId of review.containerIds)expect((await door.request(`/containers/${containerId}`,undefined,as)).status).toBe(404);
   for(const item of media)expect((await door.request(`/media/${item.storage_key.split('/').at(-1)}`,undefined,as)).status).toBe(404);
   for(const path of ['/containers','/navigation','/search?q=Project&includeTrashed=true&includeArchived=true']){
    const response=await door.request(path,undefined,as);expect(response.status).toBe(200);const visible=await response.text();
    for(const target of [...review.pageIds,...review.containerIds])expect(visible).not.toContain(target);
   }
  }
 };
 job=await door.call(`/imports/${id}/apply`,{fingerprint:job.report.fingerprint});expect(job.state).toBe('preparing');
 await invisible();await unreadable();
 // One genuine resume stores archive media, before any native publication.
 job=await door.call(`/imports/${id}/resume`,{});expect(job.state).toBe('preparing');expect(job.progress.checkpoint).toBeGreaterThan(0);
 const staged=(await env.DB.prepare("SELECT storage_key FROM import_objects WHERE import_id=? AND kind='media' AND available=1").bind(id).all<{storage_key:string}>()).results;
 expect(staged.length).toBeGreaterThan(0);for(const item of staged)expect(await env.FILES.head(item.storage_key)).not.toBeNull();
 if(stage==='sealed'){
  let kitId:string|null=null;
  for(let n=0;n<30&&!kitId;n++){
   job=await door.call(`/imports/${id}/resume`,{});expect(job.state).toBe('preparing');await invisible();
   kitId=await env.DB.prepare('SELECT kit_id FROM federation_imports WHERE id=?').bind(id).first<string>('kit_id');
  }
  expect(kitId).toBeTruthy();expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ik_d1_staging WHERE destination=?').bind(id).first<number>('n')).toBeGreaterThan(0);
 }else{
  expect(await env.DB.prepare('SELECT kit_id FROM federation_imports WHERE id=?').bind(id).first('kit_id')).toBeNull();
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ik_d1_staging WHERE destination=?').bind(id).first('n')).toBe(0);
 }
 await invisible();await unreadable();
 // Only the importing member can cancel or download this private custody.
 const preparing=await env.DB.prepare('SELECT * FROM federation_imports WHERE id=?').bind(id).first(),stagedFiles=await bucketSnapshot();
 for(const [path,body] of [[`/imports/${id}/undo`,{}],[`/imports/${id}/original`,undefined]] as const){
  const denied=await door.request(path,body,door.readerCookie);expect(denied.status).toBe(404);
 }
 expect(await env.DB.prepare('SELECT * FROM federation_imports WHERE id=?').bind(id).first()).toEqual(preparing);
 expect(await bucketSnapshot()).toEqual(stagedFiles);
 job=await door.call(`/imports/${id}/undo`,{});expect(job.state).toBe('undoing');await invisible();
 for(let n=0;job.state!=='undone'&&n<30;n++){job=await door.call(`/imports/${id}/resume`,{});await invisible();}
 expect(job.state).toBe('undone');expect(job.report.undo.message).toContain('cancelled before native publication');
 for(const item of media)expect(await env.FILES.head(item.storage_key)).toBeNull();
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM import_objects WHERE import_id=? AND kind='media' AND available!=0").bind(id).first('n')).toBe(0);
 for(const table of ['ik_d1_staging','ik_d1_preparation_steps','ik_d1_streams'])expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE destination=?`).bind(id).first('n'),table).toBe(0);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM operation_receipts WHERE operation_key=?').bind(`import-publish:${id}`).first('n')).toBe(0);
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM activity_entries WHERE target_id=? AND action='imports.publish'").bind(id).first('n')).toBe(0);
 expect(await bucketSnapshot()).toEqual(beforeFiles);
 expect(await door.call(`/pages/${controlPage!.id}`)).toEqual(controlContent);
 const retained=await door.request(`/media/${controlMedia!.id}`);expect(retained.status).toBe(200);expect(new Uint8Array(await retained.arrayBuffer())).toEqual(controlBytes);
 await door.original(id,bytes);
 const replay=await door.request(`/imports/${id}/resume`,{});expect(replay.status).toBe(409);expect(await replay.json()).toMatchObject({code:'IMPORT_PREVIEW_REQUIRED'});
 const applyReplay=await door.request(`/imports/${id}/apply`,{fingerprint:review.stream.fingerprint});expect(applyReplay.status).toBe(409);expect(await applyReplay.json()).toMatchObject({code:'IMPORT_PREVIEW_REQUIRED'});
 expect((await door.call(`/imports/${id}`)).state).toBe('undone');await invisible();await unreadable();await door.original(id,bytes);
 expect(await bucketSnapshot()).toEqual(beforeFiles);
 console.info(`PROBE IMP-001 acceptance-6 ${format} ${stage}: native reviewed Apply, Undo and resume -> undone; no imported tree; staged media reclaimed; existing content and media unchanged; exact original retained; foreign cancellation and replay refused`);
}

export async function rollsBackDocumentImport(mode:'append'|'children') {
 const door=await importDoor(),source=new TextEncoder().encode('Original destination content');
 let initial=await door.upload('text','synthetic-slate-1.txt',source);initial=await door.call(`/imports/${initial.id}/run`,{});expect(initial.state).toBe('completed');
 const destination=await env.DB.prepare('SELECT id,revision_id FROM pages').first<{id:string;revision_id:string}>();expect(destination).toBeTruthy();
 const retainedBytes=new Uint8Array([137,80,78,71,4]),form=new FormData();
 form.set('file',new File([retainedBytes],'synthetic-slate-4.png',{type:['image','png'].join('/')}));form.set('pageId',destination!.id);form.set('operationKey',crypto.randomUUID());
 const attachment=await door.call('/media',form);
 const retainedMedia=async()=>{const response=await door.request(`/media/${attachment.value.id}`);expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(retainedBytes);};
 await retainedMedia();
 const beforePage=await door.call(`/pages/${destination!.id}`);expect(JSON.stringify(beforePage)).toContain('Original destination content');
 const bytes=syntheticDocx(),job=await door.upload('docx','synthetic-slate-2.docx',bytes,{pageId:destination!.id,revisionId:destination!.revision_id,mode});
 const before=await nativeSnapshot(),beforeFiles=await bucketSnapshot(),blocks=await env.DB.prepare('SELECT COUNT(*) AS n FROM page_blocks').first<number>('n'),files=await env.DB.prepare('SELECT COUNT(*) AS n FROM files').first<number>('n');
 // Fail at the final activity write, only once real content and file rows are
 // present in the transaction. SQLite itself must reverse all earlier writes.
 await env.DB.prepare(`CREATE TRIGGER synthetic_slate_document_failure BEFORE INSERT ON activity_entries
  WHEN NEW.action='imports.publish'
   AND (SELECT COUNT(*) FROM page_blocks)>${blocks} AND (SELECT COUNT(*) FROM files)>${files}
  BEGIN SELECT RAISE(ABORT,'synthetic-slate-late-document-failure'); END`).run();
 const errors=vi.spyOn(console,'error');
 try{
  const response=await door.request(`/imports/${job.id}/run`,{});expect(response.status).toBe(500);
  expect(errors.mock.calls.some(call=>call.some(value=>String(value).includes('synthetic-slate-late-document-failure')))).toBe(true);
  expect(await nativeSnapshot()).toEqual(before);expect(await bucketSnapshot()).toEqual(beforeFiles);
  expect(await door.call(`/pages/${destination!.id}`)).toEqual(beforePage);
  await retainedMedia();
  const failed=await door.call(`/imports/${job.id}`);expect(failed).toMatchObject({id:job.id,state:'failed',report:{failure:'IMPORT_FAILED'}});
  expect((await door.call('/imports')).jobs).toContainEqual(expect.objectContaining({id:job.id,state:'failed'}));
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM operation_receipts WHERE operation_key=?').bind(`import-publish:${job.id}`).first('n')).toBe(0);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM activity_entries WHERE target_id=? AND action='imports.publish'").bind(job.id).first('n')).toBe(0);
  await door.original(job.id,bytes);
 }finally{errors.mockRestore();await env.DB.prepare('DROP TRIGGER synthetic_slate_document_failure').run();}
 // The same retained job can succeed when the transactional fault is removed.
 let completed=await door.call(`/imports/${job.id}/resume`,{});
 for(let n=0;completed.state!=='completed'&&n<30;n++)completed=await door.call(`/imports/${job.id}/resume`,{});
 expect(completed.state).toBe('completed');
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM files').first<number>('n')).toBe(files!+1);
 const target=mode==='append'?destination!.id:(await env.DB.prepare('SELECT id FROM pages WHERE parent_page_id=?').bind(destination!.id).first<{id:string}>())!.id;
 expect(JSON.stringify(await door.call(`/pages/${target}`))).toContain('Body text');
 expect(JSON.stringify(await door.call(`/pages/${destination!.id}`))).toContain('Original destination content');
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM operation_receipts WHERE operation_key=?').bind(`import-publish:${job.id}`).first('n')).toBe(1);
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM activity_entries WHERE target_id=? AND action='imports.publish'").bind(job.id).first('n')).toBe(1);
 await retainedMedia();
 await door.original(job.id,bytes);
 console.info(`PROBE IMP-001 acceptance-7-document ${mode}: native document run with late SQLite abort -> 500; destination, creations, receipts, activity and R2 unchanged; failed job and original retained; native retry completed`);
}
