import {runFoldCases} from '../fold-cases.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:net';
import {readdirSync,readFileSync} from 'node:fs';
import {invite,revokeInvitation,acceptInvitation} from '../../../src/core/features/workspace/invitations.ts';
import {deliverIdentityMail,scheduleIdentityMail} from '../../../src/core/features/session/mail.ts';
import {listIdentityMail,retryIdentityMail} from '../../../src/core/features/session/mail-status.ts';
import {firstRunState,completeFirstRun} from '../../../src/core/features/workspace/bootstrap.ts';
import type {FeatureContext} from '../../../src/core/app/feature-context.ts';
import type {RuntimeConfig} from '../../../src/core/platform/config/runtime.ts';
const config:RuntimeConfig={sessionSecret:'a-test-only-secret-of-at-least-32-characters',localDevelopment:false,mailProvider:'resend',mailApiKey:'test-only-provider-key',appName:'Slate',mailFrom:'Slate <mail@test.invalid>',appUrl:'https://slate.test.invalid'};
const now=new Date().toISOString();
function fixture(){
 const sql=new DatabaseSync(':memory:',{enableDoubleQuotedStringLiterals:true});
 for(const name of readdirSync('migrations/core').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(`migrations/core/${name}`,'utf8'));
 let fail:(query:string)=>boolean=()=>false;
 const db={prepare(query:string){let args:any[]=[];const run=()=>{if(fail(query))throw new Error('injected process/storage failure');return sql.prepare(query);};const statement={bind(...values:any[]){args=values;return statement;},async first(column?:string){const row=run().get(...args);return column?row?.[column]??null:row??null;},async all(){return {results:run().all(...args),success:true,meta:{}};},async raw(){return run().all(...args).map(r=>Object.values(r));},async run(){const result=run().run(...args);return {success:true,meta:{changes:result.changes},results:[]};}};return statement;},async batch(statements:any[]){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
 sql.exec("INSERT INTO workspaces(id,name,mark,created_at,updated_at,revision_id) VALUES ('w','Workspace','W','n','n','r'); INSERT INTO members(id,workspace_id,email,display_name,initials,role,is_setup_owner,created_at,updated_at) VALUES ('a','w','a@test.invalid','Owner','A','owner',1,'n','n'),('b','w','b@test.invalid','Member','B','member',0,'n','n');");
 const ctx={db,now,actor:{id:'a',workspaceId:'w',workspaceName:'Workspace',email:'a@test.invalid',displayName:'Owner',initials:'A',role:'owner'}} as FeatureContext;
 return {db,sql,ctx,setFault(fn:(query:string)=>boolean){fail=fn;},close(){sql.close();}};
}
const input=(key=crypto.randomUUID())=>({operationKey:key,email:'new@test.invalid',kind:'member' as const});
const row=(f:ReturnType<typeof fixture>)=>f.sql.prepare('SELECT * FROM mail_deliveries ORDER BY created_at,id LIMIT 1').get() as any;
const after=(milliseconds:number)=>new Date(Date.parse(now)+milliseconds).toISOString();
function provider(fn:(request:RequestInit)=>Promise<Response>){const original=globalThis.fetch;globalThis.fetch=async(_url,init)=>fn(init!);return ()=>{globalThis.fetch=original;};}
function tokenFrom(body:string){return new URL(JSON.parse(body).text.split('\n')[0].split(': ').slice(1).join(': ')).searchParams.get('token')!;}
test("native mail and invitations retain migration, first-run and provider custody",async()=>{await runFoldCases([
{name:'WORK-006 revocation cancels exactly one invitation and expired leases recheck current grants',run:async()=>{
 const f=fixture();let calls=0;const restore=provider(async()=>{calls++;return new Response('down',{status:503});});
 try{await invite(f.ctx,config,input());const first=row(f);await invite(f.ctx,config,input());const second=f.sql.prepare('SELECT id FROM invitations WHERE id!=?').get(first.invitation_id)!.id;
  await revokeInvitation(f.ctx,{operationKey:crypto.randomUUID(),id:first.invitation_id});assert.equal(f.sql.prepare('SELECT revoked_at FROM invitations WHERE id=?').get(second)!.revoked_at,null);assert.equal(row(f).delivery_phase,'cancelled');
  f.sql.exec("UPDATE members SET status='removed' WHERE id='a'");await scheduleIdentityMail(f.db,config,undefined,after(150000));assert.equal(calls,2);assert.equal(f.sql.prepare("SELECT count(*) n FROM mail_deliveries WHERE delivery_phase='cancelled'").get()!.n,2);
  await assert.rejects(retryIdentityMail(f.ctx,config,first.id),{status:401});
 }finally{restore();f.close();}
}},
{name:'WORK-013 completion marker survives an empty tree and later members never receive wizard',run:async()=>{
 const f=fixture();try{assert.deepEqual(await firstRunState(f.ctx),{required:true,canComplete:true});assert.deepEqual(await firstRunState({...f.ctx,actor:{...f.ctx.actor,id:'b',role:'member'}}),{required:false,canComplete:false});await completeFirstRun(f.ctx,{operationKey:crypto.randomUUID(),workspaceName:'Named',containerName:'First',pageTitle:'Welcome'});assert.deepEqual(await firstRunState(f.ctx),{required:false,canComplete:false});assert.equal(f.sql.prepare('SELECT count(*) n FROM containers').get()!.n,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM pages').get()!.n,1);assert.ok(f.sql.prepare('SELECT first_run_completed_at FROM workspaces').get()!.first_run_completed_at);}finally{f.close();}
}},
{name:'WORK-006 MAIL-002 revoked guest grants and invitations fence recovered or racing delivery attempts',run:async()=>{
 for(const run of [
  // Original case: WORK-006 guest retry after restart re-resolves resource grants and refuses stale authority
  async()=>{
 const f=fixture();let calls=0;const restore=provider(async()=>{calls++;return new Response('down',{status:503});});
 try{f.sql.exec("INSERT INTO containers(id,workspace_id,name,visibility,guest_access,created_at,updated_at,revision_id) VALUES ('c','w','Shared','open','allowed','n','n','r'); INSERT INTO container_grants(id,container_id,principal_kind,principal_id,level,created_at,updated_at) VALUES ('g','c','member','a','full','n','n');");
  await invite(f.ctx,config,{...input(),kind:'guest',containerId:'c'});assert.equal(calls,1);
  // Durable state left by a process dying after claiming the second send.
  f.sql.prepare("UPDATE mail_deliveries SET delivery_phase='sending',cycle_attempt=2,attempt_count=2,lease_until=?,next_attempt_at=NULL").run(after(60000));
  f.sql.exec("UPDATE container_grants SET revoked_at='revoked' WHERE id='g'");await scheduleIdentityMail(f.db,config,undefined,after(60000));assert.equal(calls,1);assert.equal(row(f).delivery_phase,'cancelled');assert.equal(row(f).payload_ciphertext,null);
 }finally{restore();f.close();}

  },
  // Original case: MAIL-002 invitation revocation racing an attempt claim fences the provider send
  async()=>{
 const f=fixture();let calls=0;const restore=provider(async()=>{calls++;return new Response('down',{status:503});});
 try{await invite(f.ctx,config,input());let race=true;f.setFault(q=>{if(race&&q.startsWith('INSERT INTO core_write_guards')){race=false;f.sql.exec("UPDATE invitations SET revoked_at='revoked'");}return false;});await scheduleIdentityMail(f.db,config,undefined,after(150000));assert.equal(calls,1);assert.equal(row(f).attempt_count,1);
 }finally{restore();f.close();}

  }
 ]){await run();}
}},
{name:'MAIL-002 expired provider retention never replays an uncertain message',run:async()=>{
 const f=fixture();let calls=0;const restore=provider(async()=>{calls++;throw new Error('network response lost');});
 try{await invite(f.ctx,config,input());const id=row(f).id;await scheduleIdentityMail(f.db,config,undefined,after(23*3600000));assert.equal(calls,1);assert.equal(row(f).delivery_phase,'failed');assert.equal(row(f).payload_ciphertext,null);assert.equal((await listIdentityMail({...f.ctx,now:after(23*3600000)})).items[0].canRetry,false);await assert.rejects(retryIdentityMail({...f.ctx,now:after(23*3600000)},config,id),{code:'MAIL_NOT_RECOVERABLE'});assert.equal(calls,1);
 }finally{restore();f.close();}
}},
{name:'0008 forward migration preserves prior delivery history and records old populated onboarding',run:async()=>{
 const sql=new DatabaseSync(':memory:',{enableDoubleQuotedStringLiterals:true});try{
  for(const name of readdirSync('migrations/core').filter(n=>n.endsWith('.sql')&&n<'0008').sort())sql.exec(readFileSync(`migrations/core/${name}`,'utf8'));
  sql.exec("INSERT INTO workspaces(id,name,mark,created_at,updated_at,revision_id) VALUES ('old','Owner edited','O','before','before','r'); INSERT INTO containers(id,workspace_id,name,visibility,created_at,updated_at,revision_id) VALUES ('old-container','old','Kept','open','before','before','r'); INSERT INTO mail_deliveries(id,workspace_id,kind,target_email,state,attempt_count,error_detail,created_at,updated_at) VALUES ('old-mail','old','sign-in-link','person@test.invalid','failed',3,'prior failure','before','before');");
  sql.exec(readFileSync('migrations/core/0008_identity_mail_outbox.sql','utf8'));assert.equal(sql.prepare("SELECT name FROM workspaces WHERE id='old'").get()!.name,'Owner edited');assert.equal(sql.prepare("SELECT first_run_completed_at FROM workspaces WHERE id='old'").get()!.first_run_completed_at,'before');const legacy=sql.prepare("SELECT * FROM mail_deliveries WHERE id='old-mail'").get()!;assert.equal(legacy.attempt_count,3);assert.equal(legacy.error_detail,'prior failure');assert.equal(legacy.payload_ciphertext,null);assert.equal(legacy.delivery_phase,'legacy');assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{sql.close();}
}},
{name:'SHARE-006 accepting or revoking transfers only the exact pending guest grant',run:async()=>{
 const f=fixture();const bodies:string[]=[];const restore=provider(async init=>{bodies.push(String(init.body));return Response.json({id:`guest-${bodies.length}`});});try{
  f.sql.exec("INSERT INTO containers(id,workspace_id,name,visibility,guest_access,created_at,updated_at,revision_id) VALUES ('c','w','Shared','open','allowed','n','n','r'); INSERT INTO container_grants(id,container_id,principal_kind,principal_id,level,created_at,updated_at) VALUES ('g','c','member','a','full','n','n');");
  await invite(f.ctx,config,{...input(),kind:'guest',containerId:'c'});const invitation=f.sql.prepare('SELECT * FROM invitations').get()!;const grantId=invitation.container_grant_id;assert.equal(f.sql.prepare('SELECT principal_id FROM container_grants WHERE id=?').get(grantId)!.principal_id,`invitation:${invitation.id}`);
  await acceptInvitation(f.db,config,tokenFrom(bodies[0]),f.ctx);const member=f.sql.prepare("SELECT id FROM members WHERE email='new@test.invalid'").get()!.id;assert.equal(f.sql.prepare('SELECT principal_id FROM container_grants WHERE id=?').get(grantId)!.principal_id,member);assert.equal(f.sql.prepare("SELECT count(*) n FROM container_grants WHERE principal_id=?").get(member)!.n,1);
  await invite(f.ctx,config,{...input(),email:'second@test.invalid',kind:'guest',containerId:'c'});const pending=f.sql.prepare("SELECT * FROM invitations WHERE email='second@test.invalid'").get()!;const {saveGrant}=await import('../../../src/core/features/sharing/grants.ts');await saveGrant(f.ctx,{operationKey:crypto.randomUUID(),targetKind:'container',targetId:'c',id:pending.container_grant_id as string,principalKind:'member',principalId:`invitation:${pending.id}`,level:'view',revoke:true});assert.ok(f.sql.prepare('SELECT revoked_at FROM invitations WHERE id=?').get(pending.id)!.revoked_at);await assert.rejects(acceptInvitation(f.db,config,tokenFrom(bodies[1]),f.ctx),{code:'LINK_INVALID'});assert.equal(f.sql.prepare('SELECT revoked_at FROM container_grants WHERE id=?').get(grantId)!.revoked_at,null);
 }finally{restore();f.close();}
}},
{name:'MAIL-002 interrupted failure persistence retains spacing and provider custody across restart',run:async()=>{
 const f=fixture();let calls=0;const restore=provider(async()=>{calls++;return new Response('down',{status:503});});try{
  let interrupt=true;f.setFault(q=>{if(interrupt&&q.startsWith('UPDATE mail_deliveries SET state=?')){interrupt=false;return true;}return false;});await assert.rejects(invite(f.ctx,config,input()),/injected/);assert.equal(row(f).delivery_phase,'sending');assert.equal(row(f).next_attempt_at,after(150000));f.setFault(()=>false);
  await scheduleIdentityMail(f.db,config,undefined,after(60000));assert.equal(calls,1);await scheduleIdentityMail(f.db,config,undefined,after(150000));assert.equal(calls,2);
  await scheduleIdentityMail(f.db,{...config,mailApiKey:'synthetic-different-provider-credential'},undefined,after(300000));assert.equal(calls,2);assert.equal(row(f).state,'failed');assert.match(row(f).error_detail,/MAIL_PROVIDER_CHANGED/);
 }finally{restore();f.close();}
}}
]);});








test('MAIL-002 emitted Worker sends Managed sign-in and safely handles relay redirect, rate limit and credential refusal', {timeout:240000}, async () => {
 const {managedMailRuntime} = await import('../../e2e/mail-runtime.mjs');
 const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
 const origin=`http://127.0.0.1:${port}`,relay='https://management.test.invalid/api/managed-mail/send',email='jamie@aurora.example';
 const requests: Array<{body:{to:string;subject:string;text:string;html?:string};wire:string}> = [];
 let status=202,edgeError:unknown;
 const runtime=await managedMailRuntime({APP_URL:origin,LOCAL_DEVELOPMENT:'true',MAIL_PROVIDER:'rer',MAIL_FROM:'auth@test.invalid',MAIL_RELAY_URL:relay,MAIL_API_KEY:'test-only-relay-key',SESSION_SECRET:'test-only-emitted-secret-at-least-32-characters',SETUP_TOKEN:'test-only-setup-token-at-least-32-characters',SETUP_OWNER_EMAIL:email},async(request:Request)=>{
  try {
  assert.equal(request.url,relay,'No redirect target may receive a request');
  assert.equal(request.method,'POST');
  const headers=new Headers(request.headers);
  assert.equal(headers.get('host'),new URL(relay).host);
  for(const name of ['host','content-length','cf-worker'])headers.delete(name);
  assert.deepEqual(Object.fromEntries(headers),{authorization:'Bearer test-only-relay-key','content-type':'application/json'});
  const wire=await request.text(),body=JSON.parse(wire);
  assert.deepEqual(Object.keys(body).sort(),['subject','text','to',...(body.html?['html']:[])].sort());
  assert.equal(typeof body.to,'string');assert.ok(body.subject);assert.ok(body.text);
  requests.push({body,wire});
  return Response.json(status===202?{accepted:true}:{error:'private provider response'}, {status,headers:status===302?{location:'https://untrusted.test.invalid/mail'}:status===429?{'retry-after':'240'}:{}});
  } catch(cause) {edgeError=cause;throw cause;}
 },{port});
 try {
  const db=await runtime.getD1Database('DB'),worker=await runtime.getWorker();
  const {readD1Migrations}=await import('@cloudflare/vitest-pool-workers');
  for(const migration of await readD1Migrations('migrations/core'))await db.batch(migration.queries.map(query=>db.prepare(query)));
  const post=(path:string,body:unknown,cookie='')=>fetch(origin+path,{method:'POST',headers:{origin,host:new URL(origin).host,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
  const magic=()=>post('/api/auth/magic',{email,requestKey:crypto.randomUUID()});
  const first=await magic();if(edgeError)throw edgeError;assert.equal(first.status,200,await first.text());assert.equal(requests.length,1);
  assert.equal(requests[0].body.to,email);
  assert.ok(requests[0].body.subject.includes('Slate'));
  const link=new URL(requests[0].body.text.match(/https?:\/\/\S+/)![0]);
  assert.equal(link.origin,origin);assert.equal(link.pathname,'/auth/confirm');assert.ok(link.searchParams.get('token'));
  const confirmed=await fetch(origin+'/auth/confirm',{method:'POST',redirect:'manual',headers:{origin,host:new URL(origin).host,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:link.searchParams.get('token')!}).toString()});
  assert.equal(confirmed.status,303);
  const cookie=confirmed.headers.get('set-cookie')!.split(';')[0];
  console.log('Emitted Worker: sign-in reached MAIL_RELAY_URL; exact POST headers/body contract; redirect=manual; native confirmation succeeded.');
  status=302;let before=requests.length;assert.equal((await magic()).status,502);assert.equal(requests.length,before+1);
  const invite=(target:string)=>post('/api/invitations',{operationKey:crypto.randomUUID(),email:target,kind:'member'},cookie);
  assert.equal((await invite('redirect@example.test')).status,200);
  assert.equal((await db.prepare("SELECT delivery_phase FROM mail_deliveries WHERE target_email='redirect@example.test'").first<any>())!.delivery_phase,'failed');
  console.log('Emitted Worker: relay 302 refused, never followed; invitation rejected rather than held uncertain.');
  status=401;const refused=await magic();assert.equal(refused.status,502);const problem=await refused.json() as any;assert.equal(problem.code,'MAIL_NOT_SENT');assert.match(problem.message,/could not send|not sent/i);assert.doesNotMatch(JSON.stringify(problem),/private provider response|test-only-relay-key|provider_rejected/);
  const ownerStatus=await (await fetch(origin+'/api/workspace/mail',{headers:{cookie}})).json() as any;
  assert.ok(ownerStatus.items.some((item:any)=>item.state==='failed'&&item.errorDetail?.includes('Managed mail could not send')));
  console.log('Emitted Worker: relay 401 gives a plain owner-visible mail problem without provider response or credential.');
  status=429;assert.equal((await invite('retry@example.test')).status,200);
  const read=()=>db.prepare("SELECT * FROM mail_deliveries WHERE target_email='retry@example.test'").first<any>();
  const queued=await read();assert.equal(queued.delivery_phase,'retry');assert.equal(Date.parse(queued.next_attempt_at)-Date.parse(queued.last_attempted_at),240000);
  before=requests.length;
  await worker.scheduled({cron:'* * * * *'});assert.equal(requests.length,before);
  const wire=requests.at(-1)!.wire;
  // Move the durable deadline to now; exercise the emitted scheduled handler without a four-minute sleep.
  await db.prepare("UPDATE mail_deliveries SET next_attempt_at=? WHERE id=?").bind(new Date(Date.now()-1).toISOString(),queued.id).run();
  status=202;await worker.scheduled({cron:'* * * * *'});
  assert.equal(requests.length,before+1);assert.equal(requests.at(-1)!.wire,wire);assert.equal((await read()).delivery_phase,'sent');
  console.log('Emitted Worker: relay 429 queues with Retry-After, no early retry; scheduled retry sends identical payload and records acceptance.');
 } finally {await runtime.dispose();}
 const {mailFailureJourney}=await import('../../e2e/mail-failure-journey.mjs');
 await mailFailureJourney();
});
