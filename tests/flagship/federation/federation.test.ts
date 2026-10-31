import {runFoldCases} from '../fold-cases';
import {scheduledBackupJourney} from '../../e2e/imports/scheduled-backup-journey';
import {documentImportJourney} from '../../e2e/imports/persisted-outcomes';
import {contract} from '../../e2e/contract';
import {applyReviewedSpace} from '../../e2e/imports/reviewed-space';
import {resetDatabase} from '../../e2e/setup/reset-database';
import {env} from 'cloudflare:test';
import {describe,it,expect,afterEach,beforeEach,vi} from 'vitest';
import {seedWorkspace,seedMember,sessionFor} from '../../e2e/setup/fixtures';
import type {FeatureContext} from '../../../src/core/app/feature-context';
import {startImport,runImport,readImport} from '../../../src/core/features/imports/jobs';
import {connect,disconnect} from '../../../src/core/features/connectors/service';
import {addSource,refreshSource,resolveEvidence} from '../../../src/core/features/source-memory/service';
import {exportWorkspace,restoreWorkspace} from '../../../src/core/features/portability/service';
import {createApi} from '../../../src/core/app/hono';
import {startOAuth,finishOAuth,inferSource} from '../../../src/core/features/connectors/oauth';
import {exportReadable} from '../../../src/core/features/workspace-export/readable';
import {searchSources} from '../../../src/core/features/source-memory/search';
import {decodeArchive,encodeArchive} from '../../../src/core/features/portability/archive';
async function context(){const {workspaceId}=await seedWorkspace();const {memberId}=await seedMember(workspaceId,{email:'owner@federation.test',displayName:'Owner',role:'owner',isSetupOwner:true});return {db:env.DB,files:env.FILES,jobs:env.JOBS,actor:{id:memberId,workspaceId,workspaceName:'Test',email:'owner@federation.test',displayName:'Owner',initials:'OW',role:'owner'},now:new Date().toISOString()} as FeatureContext;}
async function reset(){await resetDatabase(env.DB);}
beforeEach(reset);
afterEach(()=>{vi.unstubAllGlobals();});
describe('durable imports and federation',()=>{
 it("imports, source authority and portable archives persist exactly through failure and recovery", async () => {
  await runFoldCases([
{name:"durable imports and federation persists a real Google Docs export, retains original, searchable canonical content, and replays without duplicate pages",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();const bytes=new Uint8Array(await(await (env as typeof env & {TEST_IMPORT_FIXTURES:Fetcher}).TEST_IMPORT_FIXTURES.fetch('https://fixtures/google-docs-download.docx')).arrayBuffer());const job=await startImport(ctx,{operationKey:'real-google-docx',format:'google-docx',source:{name:'google.docx',bytes}});const complete=await runImport(ctx,job.id);expect(complete.state).toBe('completed');const pages=await ctx.db.prepare('SELECT id,title FROM pages WHERE workspace_id=?').bind(ctx.actor.workspaceId).all();expect(pages.results.length).toBeGreaterThan(0);expect(await ctx.db.prepare('SELECT count(*) AS count FROM page_blocks').first<number>('count')).toBeGreaterThan(0);await runImport(ctx,job.id);expect((await ctx.db.prepare('SELECT id FROM pages WHERE workspace_id=?').bind(ctx.actor.workspaceId).all()).results.length).toBe(pages.results.length);expect(await ctx.files.get(complete.archive_key)).not.toBeNull();await expect(startImport(ctx,{operationKey:'real-google-docx',format:'text',source:{name:'different.txt',bytes:new TextEncoder().encode('different')}})).rejects.toMatchObject({code:'OPERATION_KEY_CONFLICT'});
await documentImportJourney(createApi(),await sessionFor(ctx.actor.id),'google-docx','google-docs-download.docx',bytes);
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation reviews genuine Notion and Confluence exports before atomic publication",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();for(const [format,name]of [['notion-workspace','notion-workspace-export.zip'],['confluence-space','confluence-space-export.zip']] as const){const bytes=new Uint8Array(await(await (env as typeof env & {TEST_IMPORT_FIXTURES:Fetcher}).TEST_IMPORT_FIXTURES.fetch(`https://fixtures/${name}`)).arrayBuffer());const job=await startImport(ctx,{operationKey:`real-${format}`,format,source:{name,bytes}});const result=await applyReviewedSpace(ctx,job.id);expect(result.state).toBe('completed');expect(JSON.parse(result.counts_json).pages).toBeGreaterThan(0);}
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation fails an invalid destination plan without publishing partial tree and retries after interruption",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();const job=await startImport(ctx,{operationKey:'interrupted-import',format:'text',source:{name:'hello.txt',bytes:new TextEncoder().encode('Hello retained content')}});await ctx.db.prepare("UPDATE federation_imports SET state='running' WHERE id=?").bind(job.id).run();await expect(runImport(ctx,job.id)).rejects.toThrow();expect(await ctx.db.prepare('SELECT count(*) AS count FROM pages').first<number>('count')).toBe(0);await ctx.db.prepare("UPDATE federation_imports SET state='failed' WHERE id=?").bind(job.id).run();expect((await runImport(ctx,job.id)).state).toBe('completed');
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation retains exact source revisions, denies changed audience and revoked connection without content",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();let version=1;vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.endsWith('/user')?{id:7,login:'reader'}:{title:'Issue',body:`Version ${version}`,updated_at:`v${version}`,state:'open',number:1}),{status:200,headers:{'Content-Type':'application/json'}}));const key='01234567890123456789012345678901';const connected=await connect(ctx,{operationKey:'connect-github',provider:'github',accountId:'reader',token:'test-provider-token'},key);const source=await addSource(ctx,{operationKey:'source-github',connectionId:connected.value.id,remoteId:'just-every/run-slate/1'});const first=await refreshSource(ctx,source.value.id,key);version=2;await refreshSource(ctx,source.value.id,key);const exact=await resolveEvidence(ctx,first,{secret:key});expect(exact).toMatchObject({state:'available',text:'State: open\nVersion 1',freshness:'stale'});const denied=await resolveEvidence(ctx,first,{secret:key,audienceMemberIds:['missing-person']});expect(denied.state).toBe('unavailable');expect(denied).not.toHaveProperty('text');await disconnect(ctx,{id:connected.value.id,operationKey:'disconnect-github',expectedRevisionId:connected.receipt.revisionId!});expect(await resolveEvidence(ctx,first,{secret:key})).toMatchObject({state:'unavailable',reason:'access'});
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation complete credential-free archives refuse corruption and restore retained records and originals into an empty deployment",before:async()=>{await reset();},run:async()=>{
try {
for(const scenario of [async()=>{const ctx=await context();const job=await startImport(ctx,{operationKey:'export-import',format:'text',source:{name:'content.txt',bytes:new TextEncoder().encode('Portable page')}});await runImport(ctx,job.id);const exported=await exportWorkspace(ctx,{operationKey:'portable-repeat-key'});expect((await exportWorkspace(ctx,{operationKey:'portable-repeat-key'})).id).toBe(exported.id);const row=await ctx.db.prepare('SELECT archive_key FROM federation_exports WHERE id=?').bind(exported.id).first<{archive_key:string}>();const bytes=new Uint8Array(await(await ctx.files.get(row!.archive_key))!.arrayBuffer());const archive=await decodeArchive(bytes);expect(archive.manifest.tables.pages!.length).toBe(1);expect(archive.manifest.tables.sessions).toBeUndefined();expect(archive.manifest.blobs.length).toBeGreaterThan(0);const corrupted=await encodeArchive({...archive.manifest,version:2 as 1},{});await expect(restoreWorkspace(ctx,corrupted)).rejects.toMatchObject({code:'CORRUPT_ARCHIVE'});expect(await ctx.db.prepare('SELECT count(*) AS count FROM pages').first<number>('count')).toBe(1);},async()=>{const ctx=await context();const job=await startImport(ctx,{operationKey:'round-trip-import',format:'text',source:{name:'portable.txt',bytes:new TextEncoder().encode('Unique portable content')}});await runImport(ctx,job.id);const exported=await exportWorkspace(ctx,{operationKey:'portable-repeat-key'});expect((await exportWorkspace(ctx,{operationKey:'portable-repeat-key'})).id).toBe(exported.id);const row=await ctx.db.prepare('SELECT archive_key FROM federation_exports WHERE id=?').bind(exported.id).first<{archive_key:string}>();const bytes=new Uint8Array(await(await ctx.files.get(row!.archive_key))!.arrayBuffer());const before=(await ctx.db.prepare('SELECT id,working_revision_id FROM pages').all()).results;await reset();const target=await context();const restored=await restoreWorkspace(target,bytes);expect(restored.state).toBe('completed');expect((await ctx.db.prepare('SELECT id,working_revision_id FROM pages').all()).results).toEqual(before);expect(await ctx.db.prepare('SELECT count(*) AS count FROM sessions').first<number>('count')).toBe(0);const file=await ctx.db.prepare('SELECT archive_key FROM federation_imports WHERE id=?').bind(job.id).first<{archive_key:string}>();expect(await(await ctx.files.get(file!.archive_key))!.text()).toBe('Unique portable content');}]){await reset();await scenario();}
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation imports a publisher-produced Microsoft Word fixture with retained provenance",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();const bytes=new Uint8Array(await(await (env as typeof env & {TEST_IMPORT_FIXTURES:Fetcher}).TEST_IMPORT_FIXTURES.fetch('https://fixtures/word-government-impact-assessment.docx')).arrayBuffer());const job=await startImport(ctx,{operationKey:'genuine-word',format:'docx',source:{name:'word-government-impact-assessment.docx',bytes}});expect((await runImport(ctx,job.id)).state).toBe('completed');expect(await ctx.db.prepare('SELECT count(*) AS count FROM page_blocks').first<number>('count')).toBeGreaterThan(10);
await documentImportJourney(createApi(),await sessionFor(ctx.actor.id),'docx','word-government-impact-assessment.docx',bytes);
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation authorizes real Worker HTTP imports and export endpoints against current sessions",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context(),app=createApi(),cookie=await sessionFor(ctx.actor.id);const request=(path:string,token?:string)=>app.request(`https://slate.example${path}`,{headers:token?{Cookie:token}:{}},env);expect((await request('/api/connectors')).status).toBe(401);expect((await request('/api/connectors',await sessionFor(ctx.actor.id,{expiresAt:'2000-01-01T00:00:00.000Z'}))).status).toBe(401);expect((await request('/api/connectors',cookie)).status).toBe(200);await ctx.db.prepare("UPDATE members SET status='removed' WHERE id=?").bind(ctx.actor.id).run();expect((await request('/api/connectors',cookie)).status).toBe(401);
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation uses actor-bound single-use OAuth PKCE and discovers identity instead of asking for account ids",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();const key='01234567890123456789012345678901';const config={APP_URL:'https://slate.example',CONNECTOR_CREDENTIALS_KEY:key,GITHUB_CLIENT_ID:'app-id',GITHUB_CLIENT_SECRET:'app-secret'};const started=await startOAuth(ctx,'github',config,'https://github.com/just-every/run-slate/issues/1');const url=new URL(started.authorizationUrl);expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(inferSource('https://github.com/just-every/run-slate/issues/1')).toEqual({provider:'github',remoteId:'just-every/run-slate/1'});const other=await seedMember(ctx.actor.workspaceId,{email:'other@federation.test',displayName:'Other',role:'member'});await expect(finishOAuth({...ctx,actor:{...ctx.actor,id:other.memberId}},'github',config,{state:url.searchParams.get('state')!,code:'valid-code'})).rejects.toMatchObject({code:'INVALID_OAUTH_STATE'});vi.stubGlobal('fetch',async(input:string)=>new Response(JSON.stringify(input.includes('access_token')?{access_token:'provider-token'}:{id:7,login:'reader'}),{headers:{'Content-Type':'application/json'}}));const complete=await finishOAuth(ctx,'github',config,{state:url.searchParams.get('state')!,code:'valid-code'});expect(complete.value.accountId).toBe('reader');await expect(finishOAuth(ctx,'github',config,{state:url.searchParams.get('state')!,code:'valid-code'})).rejects.toMatchObject({code:'INVALID_OAUTH_STATE'});const row=await ctx.db.prepare('SELECT credential_ciphertext FROM federation_connections WHERE id=?').bind(complete.value.id).first<{credential_ciphertext:string}>();expect(row!.credential_ciphertext).not.toContain('provider-token');
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation exports readable Markdown HTML and embedded-font PDF and reimports its tree",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();const job=await startImport(ctx,{operationKey:'readable-source',format:'text',source:{name:'portable.txt',bytes:new TextEncoder().encode('Unicode café Ω readable content')}});await runImport(ctx,job.id);const page=await ctx.db.prepare('SELECT id FROM pages').first<{id:string}>();for(const format of ['markdown','html','pdf'] as const){const archive=await exportReadable(ctx,{scope:'page',id:page!.id,format});expect(archive.bytes[0]).toBe(80);if(format==='markdown'){const imported=await startImport(ctx,{operationKey:'readable-restore',format:'slate-readable',source:{name:archive.filename,bytes:archive.bytes}});expect((await runImport(ctx,imported.id)).state).toBe('completed');}}expect(await ctx.db.prepare('SELECT count(*) AS count FROM pages').first<number>('count')).toBe(2);
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation keeps the previous published source on provider failure and treats deletion as a content-free tombstone",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();let failed=false,deleted=false;vi.stubGlobal('fetch',async(url:string)=>url.endsWith('/user')?new Response(JSON.stringify({id:7,login:'reader'})):new Response(JSON.stringify({title:'Evidence',body:'Stable retained passage',updated_at:'v1',state:'open',number:1}),{status:deleted?404:failed?502:200}));const key='01234567890123456789012345678901',c=await connect(ctx,{operationKey:'refresh-connection',provider:'github',accountId:'reader',token:'token'},key),source=await addSource(ctx,{operationKey:'refresh-source',connectionId:c.value.id,remoteId:'just-every/run-slate/1'}),first=await refreshSource(ctx,source.value.id,key);expect((await searchSources(ctx,'Stable',{secret:key})).items).toHaveLength(1);failed=true;await expect(refreshSource(ctx,source.value.id,key)).rejects.toMatchObject({code:'SOURCE_PROVIDER_FAILED'});expect(await ctx.db.prepare('SELECT published_revision_id FROM federation_sources WHERE id=?').bind(source.value.id).first<string>('published_revision_id')).toBe(first.sourceRevisionId);failed=false;deleted=true;expect(await resolveEvidence(ctx,first,{secret:key})).toEqual({state:'unavailable',reference:first,reason:'deleted'});
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation rolls back a failing D1 publication after earlier page statements and succeeds on a retained-archive retry",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();const bytes=new Uint8Array(await(await (env as typeof env & {TEST_IMPORT_FIXTURES:Fetcher}).TEST_IMPORT_FIXTURES.fetch('https://fixtures/confluence-space-export.zip')).arrayBuffer());const job=await startImport(ctx,{operationKey:'atomic-import-fault',format:'confluence-space',source:{name:'confluence.zip',bytes}});await ctx.db.prepare("CREATE TRIGGER federation_test_abort BEFORE INSERT ON pages WHEN (SELECT count(*) FROM pages)>0 BEGIN SELECT RAISE(ABORT,'injected write failure'); END").run();await expect(applyReviewedSpace(ctx,job.id)).rejects.toThrow();expect(await ctx.db.prepare('SELECT count(*) AS n FROM pages').first<number>('n')).toBe(0);expect(await ctx.db.prepare('SELECT count(*) AS n FROM containers').first<number>('n')).toBe(0);expect(await ctx.db.prepare('SELECT state FROM federation_imports WHERE id=?').bind(job.id).first<string>('state')).toBe('running');await ctx.db.prepare('DROP TRIGGER federation_test_abort').run();expect((await applyReviewedSpace(ctx,job.id)).state).toBe('completed');
} finally {{vi.unstubAllGlobals();}}
}},
{name:"durable imports and federation appends an import to an existing page atomically and preserves preexisting blocks on stale revisions",before:async()=>{await reset();},run:async()=>{
try {
const ctx=await context();const first=await startImport(ctx,{operationKey:'append-original',format:'text',source:{name:'original.txt',bytes:new TextEncoder().encode('Original content')}});await runImport(ctx,first.id);const page=await ctx.db.prepare('SELECT id,revision_id FROM pages').first<{id:string;revision_id:string}>();const second=await startImport(ctx,{operationKey:'append-next',format:'text',source:{name:'next.txt',bytes:new TextEncoder().encode('Appended content')},destination:{pageId:page!.id,expectedRevisionId:page!.revision_id,mode:'append'}});expect((await runImport(ctx,second.id)).state).toBe('completed');const blocks=await ctx.db.prepare('SELECT content_json FROM page_blocks WHERE page_id=?').bind(page!.id).all<{content_json:string}>();expect(blocks.results.map(b=>b.content_json).join(' ')).toContain('Original content');expect(blocks.results.map(b=>b.content_json).join(' ')).toContain('Appended content');const stale=await startImport(ctx,{operationKey:'append-stale',format:'text',source:{name:'stale.txt',bytes:new TextEncoder().encode('Must not persist')},destination:{pageId:page!.id,expectedRevisionId:page!.revision_id,mode:'append'}});await expect(runImport(ctx,stale.id)).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect((await ctx.db.prepare('SELECT content_json FROM page_blocks WHERE page_id=?').bind(page!.id).all()).results).toEqual(blocks.results);
} finally {{vi.unstubAllGlobals();}}
}}
  ]);
});















});

contract('PORT-009','Scheduled backup writes to the destination, applies retention, notifies owners on failure and restores into an empty deployment',scheduledBackupJourney);
