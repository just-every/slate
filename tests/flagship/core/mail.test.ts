import {sendgridMailCase} from './sendgrid-mail.case';
import {mailBoundaryCase} from './mail-boundary.case';
import {runFoldCases} from '../fold-cases';
import {env} from 'cloudflare:test';
import {beforeEach,test,expect,vi} from 'vitest';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {seedWorkspace,seedMember,seedContainer,seedContainerGrant,sessionFor} from '../../e2e/setup/fixtures';
import {createApi} from '../../../src/core/app/hono';
import {readRuntimeConfig} from '../../../src/core/platform/config/runtime';
import {invite,revokeInvitation,acceptInvitation} from '../../../src/core/features/workspace/invitations';
import {scheduleIdentityMail,deliverIdentityMail} from '../../../src/core/features/session/mail';
import {retryIdentityMail,listIdentityMail} from '../../../src/core/features/session/mail-status';
import type {FeatureContext} from '../../../src/core/app/feature-context';
const config={...readRuntimeConfig(env,false),appUrl:'https://slate.test.invalid',mailFrom:'Slate <mail@test.invalid>',mailApiKey:'test-only-key'};
beforeEach(resetDeployment);
async function fixture(){const{workspaceId}=await seedWorkspace();const{memberId}=await seedMember(workspaceId,{email:`${workspaceId}@test.invalid`,displayName:'Owner',role:'owner',isSetupOwner:true});return {db:env.DB,files:env.FILES,jobs:env.JOBS,actor:{id:memberId,workspaceId,workspaceName:'Workspace',email:`${workspaceId}@test.invalid`,displayName:'Owner',initials:'O',role:'owner'},now:new Date().toISOString()} as FeatureContext;}
// Match the Node harness: preparation and binding succeed, then SQLite/D1
// execution fails. A prepare-time exception would miss swallowed run failures.
function statementFault(db:D1Database,match:(query:string)=>boolean,fail:()=>never):D1Database{
 return new Proxy(db,{get(target,key){
  if(key==='prepare')return(query:string)=>{
   const statement=target.prepare(query);
   if(!match(query))return statement;
   const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values:unknown[])=>wrap(target.bind(...values));
    if(['run','all','first','raw'].includes(String(key)))return()=>Promise.resolve().then(fail);
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }});
   return wrap(statement);
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}
test("identity mail preserves durable retry, recovery, authentication and provider custody", async () => {
  await runFoldCases([
{name:"MAIL-002 Worker D1 durable retry uses a single encrypted message across five minutes and explicit recovery",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const ctx=await fixture();let success=false;const provider=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>success?Response.json({id:'provider-confirmed'}):new Response('provider raw secret',{status:503}));
 try{const input={operationKey:crypto.randomUUID(),email:'retry@test.invalid',kind:'member' as const};await invite(ctx,config,input);const read=()=>env.DB.prepare('SELECT * FROM mail_deliveries WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<any>();const initial=await read();expect(initial.payload_ciphertext).toMatch(/^v1\./);expect(initial.payload_ciphertext).not.toContain('/accept');expect(provider).toHaveBeenCalledTimes(1);expect(initial.next_attempt_at).toBe(new Date(Date.parse(ctx.now)+150000).toISOString());
  await deliverIdentityMail(env.DB,config,initial.id,ctx,new Date(Date.parse(ctx.now)+149999).toISOString());expect(provider).toHaveBeenCalledTimes(1);
  await invite(ctx,config,input);expect(provider).toHaveBeenCalledTimes(1);
  // A due retry runs exactly at 150s; a later cron tick must not send twice.
  await scheduleIdentityMail(env.DB,config,ctx,new Date(Date.parse(ctx.now)+150000).toISOString());expect(provider).toHaveBeenCalledTimes(2);
  await scheduleIdentityMail(env.DB,config,ctx,new Date(Date.parse(ctx.now)+180000).toISOString());expect(provider).toHaveBeenCalledTimes(2);expect((await read()).next_attempt_at).toBe(new Date(Date.parse(ctx.now)+300000).toISOString());
  const later={...ctx,now:new Date(Date.parse(ctx.now)+300000).toISOString()};await scheduleIdentityMail(env.DB,config,ctx,later.now);expect(provider).toHaveBeenCalledTimes(3);expect((await read()).state).toBe('failed');const item=(await listIdentityMail(later)).items[0];expect(item.errorDetail).toContain('503');expect(JSON.stringify(item)).not.toContain('provider raw secret');expect(item.canRetry).toBe(true);expect(JSON.stringify(item)).not.toContain('ciphertext');
  const {memberId:ordinary}=await seedMember(ctx.actor.workspaceId,{email:'synthetic-slate-301@test.invalid',displayName:'Member',role:'member'});
  await expect(retryIdentityMail({...later,actor:{...ctx.actor,id:ordinary,role:'member'}},config,initial.id)).rejects.toMatchObject({status:404});
  success=true;
  const api=createApi(),cookie=await sessionFor(ctx.actor.id),bindings={...env,APP_URL:config.appUrl,MAIL_PROVIDER:config.mailProvider,MAIL_FROM:config.mailFrom,MAIL_API_KEY:config.mailApiKey};
  const retry=()=>api.request(config.appUrl+'/api/workspace/mail/'+initial.id+'/retry',{method:'POST',headers:{cookie,origin:config.appUrl}},bindings);
  expect((await retry()).status).toBe(200);
  expect((await read()).state).toBe('sent');expect(provider).toHaveBeenCalledTimes(4);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM invitations').first<{n:number}>())!.n).toBe(1);
  expect((await retry()).status).toBe(200);expect(provider).toHaveBeenCalledTimes(4);expect((await read()).provider_message_id).toBe('provider-confirmed');expect((await read()).payload_ciphertext).toBeNull();const requests=provider.mock.calls.map(call=>call[1]!);expect(new Set(requests.map(r=>new Headers(r.headers).get('Idempotency-Key'))).size).toBe(1);expect(new Set(requests.map(r=>r.body)).size).toBe(1);
 }finally{provider.mockRestore();}

} finally {}
}},
{name:"MAIL-002 Worker routes require current authentication and expose public sign-in status only with capability",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const ctx=await fixture(),api=createApi();const noSession=await api.request('/api/workspace/mail',{},env);expect(noSession.status).toBe(401);const cookie=await sessionFor(ctx.actor.id);expect((await api.request('/api/workspace/mail',{headers:{cookie}},env)).status).toBe(200);
 const status=await api.request('/api/auth/magic/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'unknown@test.invalid',requestKey:crypto.randomUUID()})},env);expect(status.status).toBe(200);expect(await status.json()).toMatchObject({state:'unconfirmed'});
 const relayEnv={...env,APP_URL:'https://slate.test.invalid',MAIL_PROVIDER:'rer',MAIL_FROM:'auth@test.invalid',MAIL_API_KEY:'test-only-relay-key',MAIL_RELAY_URL:'https://management.test.invalid/api/managed-mail/send'};
 let responseStatus=202;
 const provider=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  // Keep workerd's native Request validation in front of the network fake.
  new Request(url,init);
  expect(String(url)).toBe(relayEnv.MAIL_RELAY_URL);expect(init!.method).toBe('POST');expect(init!.redirect).toBe('manual');
  expect(Object.fromEntries(new Headers(init!.headers))).toEqual({authorization:'Bearer test-only-relay-key','content-type':'application/json'});
  const body=JSON.parse(String(init!.body));expect(Object.keys(body).sort()).toEqual(['html','subject','text','to'].filter(key=>key!=='html'||body.html));expect(typeof body.to).toBe('string');expect(body.subject).toBeTruthy();expect(body.text).toBeTruthy();
  return Response.json(responseStatus===202?{accepted:true}:{error:'private relay response'}, {status:responseStatus,headers:responseStatus===429?{'Retry-After':'240'}:responseStatus===302?{Location:'https://untrusted.test.invalid/mail'}:{}});
 });
 try{
  const headers={'content-type':'application/json',origin:relayEnv.APP_URL,host:'slate.test.invalid'};
  const magic=()=>api.request(`${relayEnv.APP_URL}/api/auth/magic`,{method:'POST',headers,body:JSON.stringify({email:ctx.actor.email,requestKey:crypto.randomUUID()})},relayEnv);
  expect((await magic()).status).toBe(200);expect(provider).toHaveBeenCalledTimes(1);
  const signIn=JSON.parse(String(provider.mock.calls[0]![1]!.body));expect(signIn.to).toBe(ctx.actor.email.toLowerCase());expect(signIn.text).toContain('/auth/confirm?token=');
  responseStatus=302;const beforeRedirect=provider.mock.calls.length;expect((await magic()).status).toBe(502);expect(provider).toHaveBeenCalledTimes(beforeRedirect+1);
  responseStatus=401;const refused=await magic();expect(refused.status).toBe(502);expect(await refused.json()).toMatchObject({code:'MAIL_NOT_SENT'});
  const ownerMail=await api.request(`${relayEnv.APP_URL}/api/workspace/mail`,{headers:{cookie}},relayEnv);expect(ownerMail.status).toBe(200);const ownerStatus=await ownerMail.json() as {items:Array<{state:string;errorDetail:string|null}>};expect(ownerStatus.items.some(item=>item.state==='failed'&&typeof item.errorDetail==='string'&&item.errorDetail.length>0)).toBe(true);expect(JSON.stringify(ownerStatus)).not.toContain('private relay response');
  responseStatus=429;
  const invited=await api.request(`${relayEnv.APP_URL}/api/invitations`,{method:'POST',headers:{...headers,cookie},body:JSON.stringify({operationKey:crypto.randomUUID(),email:'relay-invite@test.invalid',kind:'member'})},relayEnv);expect(invited.status).toBe(200);
  const read=()=>env.DB.prepare("SELECT * FROM mail_deliveries WHERE target_email='relay-invite@test.invalid'").first<any>();
  const queued=await read();expect(queued.delivery_phase).toBe('retry');expect(Date.parse(queued.next_attempt_at)-Date.parse(queued.last_attempted_at)).toBe(240000);
  const sentBody=provider.mock.calls.at(-1)![1]!.body,calls=provider.mock.calls.length;
  const relayConfig=readRuntimeConfig(relayEnv,false);
  await scheduleIdentityMail(env.DB,relayConfig,ctx,new Date(Date.parse(queued.next_attempt_at)-1).toISOString());expect(provider).toHaveBeenCalledTimes(calls);
  responseStatus=202;await scheduleIdentityMail(env.DB,relayConfig,ctx,queued.next_attempt_at);expect(provider).toHaveBeenCalledTimes(calls+1);expect(provider.mock.calls.at(-1)![1]!.body).toBe(sentBody);expect(await read()).toMatchObject({delivery_phase:'sent',provider_message_id:null});
  // Without relay idempotency, transport ambiguity stays held instead of replaying.
  responseStatus=503;await api.request(`${relayEnv.APP_URL}/api/invitations`,{method:'POST',headers:{...headers,cookie},body:JSON.stringify({operationKey:crypto.randomUUID(),email:'relay-uncertain@test.invalid',kind:'member'})},relayEnv);
  expect(await env.DB.prepare("SELECT delivery_phase FROM mail_deliveries WHERE target_email='relay-uncertain@test.invalid'").first()).toMatchObject({delivery_phase:'uncertain'});
  responseStatus=302;const beforeInviteRedirect=provider.mock.calls.length;await api.request(`${relayEnv.APP_URL}/api/invitations`,{method:'POST',headers:{...headers,cookie},body:JSON.stringify({operationKey:crypto.randomUUID(),email:'relay-redirect@test.invalid',kind:'member'})},relayEnv);
  expect(provider).toHaveBeenCalledTimes(beforeInviteRedirect+1);expect(await env.DB.prepare("SELECT delivery_phase FROM mail_deliveries WHERE target_email='relay-redirect@test.invalid'").first()).toMatchObject({delivery_phase:'failed'});
 }finally{provider.mockRestore();}
 const first=await api.request('/api/workspace/first-run',{headers:{cookie}},env);expect(await first.json()).toEqual({required:true,canComplete:true});await env.DB.prepare("UPDATE members SET status='removed' WHERE id=?").bind(ctx.actor.id).run();expect((await api.request('/api/workspace/first-run',{headers:{cookie}},env)).status).toBe(401);

} finally {}
}},
{name:"WORK-006 Worker pending guest grant is durable and exact revocation disables delivery",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const ctx=await fixture();const{containerId}=await seedContainer(ctx.actor.workspaceId,{name:'Guest target',ownerMemberId:ctx.actor.id,visibility:'open',guestAccess:'allowed'});await seedContainerGrant(containerId,{principalKind:'member',principalId:ctx.actor.id,level:'full'});
 const provider=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('down',{status:503}));try{await invite(ctx,config,{operationKey:crypto.randomUUID(),email:'guest@test.invalid',kind:'guest',containerId});const invitation=await env.DB.prepare('SELECT id,container_grant_id FROM invitations WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{id:string;container_grant_id:string}>();expect(invitation!.container_grant_id).toBeTruthy();
 const api=createApi(),cookie=await sessionFor(ctx.actor.id);
 expect((await api.request('/api/invitations',{},env)).status).toBe(401);
 const pendingResponse=await api.request('/api/invitations',{headers:{cookie}},env);expect(pendingResponse.status).toBe(200);
 const pending=await pendingResponse.json() as {items:{id:string;email:string}[]};expect(pending.items.find(item=>item.id===invitation!.id)?.email).toBe('guest@test.invalid');
 const reader=await seedMember(ctx.actor.workspaceId,{email:'reader@test.invalid',displayName:'Reader',role:'member'});
 expect((await api.request('/api/invitations',{headers:{cookie:await sessionFor(reader.memberId)}},env)).status).toBe(403);
 await revokeInvitation(ctx,{operationKey:crypto.randomUUID(),id:invitation!.id});expect(((await (await api.request('/api/invitations',{headers:{cookie}},env)).json()) as {items:{id:string}[]}).items.some(item=>item.id===invitation!.id)).toBe(false);expect((await env.DB.prepare('SELECT revoked_at FROM container_grants WHERE id=?').bind(invitation!.container_grant_id).first<{revoked_at:string}>())!.revoked_at).toBeTruthy();await scheduleIdentityMail(env.DB,config,ctx,new Date(Date.parse(ctx.now)+300000).toISOString());expect(provider).toHaveBeenCalledTimes(1);}finally{provider.mockRestore();}

} finally {}
}},
{name:"MAIL-002 Worker restart after invitation commit resumes the admitted encrypted command",before:async()=>{await resetDeployment();},run:async()=>{
try {

 const ctx=await fixture(),input={operationKey:crypto.randomUUID(),email:'restart@test.invalid',kind:'member' as const};
 const interrupted=statementFault(env.DB,q=>q.startsWith('SELECT id FROM mail_deliveries WHERE workspace_id='),()=>{throw new Error('process ended after commit');});
 const provider=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'restart-receipt'}));try{await expect(invite({...ctx,db:interrupted},config,input)).rejects.toThrow('process ended after commit');expect(provider).not.toHaveBeenCalled();const command=await env.DB.prepare('SELECT delivery_phase,payload_ciphertext FROM mail_deliveries WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{delivery_phase:string;payload_ciphertext:string}>();expect(command!.delivery_phase).toBe('pending');expect(command!.payload_ciphertext).toMatch(/^v1\./);expect(command!.payload_ciphertext).not.toContain('/accept');
  expect((await env.DB.prepare('SELECT count(*) AS n FROM invitations').first<{n:number}>())!.n).toBe(1);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM operation_receipts').first<{n:number}>())!.n).toBe(1);
  await scheduleIdentityMail(env.DB,config,ctx,ctx.now);await invite(ctx,config,input);expect(provider).toHaveBeenCalledTimes(1);expect((await env.DB.prepare('SELECT provider_message_id FROM mail_deliveries WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{provider_message_id:string}>())!.provider_message_id).toBe('restart-receipt');
  expect((await env.DB.prepare('SELECT payload_ciphertext FROM mail_deliveries WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{payload_ciphertext:null}>())!.payload_ciphertext).toBeNull();
  const body=JSON.parse(String(provider.mock.calls[0]![1]!.body));
  const token=new URL(body.text.split('\n')[0].split(': ').slice(1).join(': ')).searchParams.get('token')!;
  expect((await acceptInvitation(env.DB,config,token,ctx)).memberId).toBeTruthy();
  await expect(acceptInvitation(env.DB,config,token,ctx)).rejects.toMatchObject({code:'LINK_INVALID'});
  const cookie=await sessionFor(ctx.actor.id),status=await createApi().request('/api/workspace/mail',{headers:{cookie}},env);
  expect(status.status).toBe(200);expect(await status.json()).toMatchObject({items:[{state:'sent'}]});
 }finally{provider.mockRestore();}

} finally {}
}},
{name:"MAIL-002 Worker lost provider response replays identical request without a second logical email",before:async()=>{await resetDeployment();},run:async()=>{
try {

 for(const fault of ['response','receipt'] as const){
  await resetDeployment();
 const ctx=await fixture();const accepted=new Map<string,string>();let attempts=0;const provider=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{attempts++;const key=new Headers(init!.headers).get('Idempotency-Key')!,body=String(init!.body);if(!accepted.has(key)){accepted.set(key,body);if(fault==='response')throw new Error('provider accepted; response lost');}expect(body).toBe(accepted.get(key));return Response.json({id:'recovered-receipt'});});
 let loseReceipt=fault==='receipt';
 const interrupted=statementFault(env.DB,q=>loseReceipt&&q.includes("SET state='sent',delivery_phase='sent'"),()=>{
  loseReceipt=false;throw new Error('injected receipt persistence failure');
 });
 try{const input={operationKey:crypto.randomUUID(),email:'lost-response@test.invalid',kind:'member' as const};
  await invite({...ctx,db:interrupted},config,input);
  const pending=await env.DB.prepare('SELECT state,error_detail FROM mail_deliveries WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{state:string;error_detail:string}>();
  expect(pending!.state).toBe('queued');
  if(fault==='receipt')expect(pending!.error_detail).toMatch(/receipt persistence/);
  await scheduleIdentityMail(env.DB,config,ctx,new Date(Date.parse(ctx.now)+150000).toISOString());expect(attempts).toBe(2);expect(accepted.size).toBe(1);expect((await env.DB.prepare('SELECT state,provider_message_id FROM mail_deliveries WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{state:string;provider_message_id:string}>())).toMatchObject({state:'sent',provider_message_id:'recovered-receipt'});
  const cookie=await sessionFor(ctx.actor.id),api=createApi(),bindings={...env,APP_URL:config.appUrl,MAIL_PROVIDER:config.mailProvider,MAIL_FROM:config.mailFrom,MAIL_API_KEY:config.mailApiKey};
  expect((await api.request(config.appUrl+'/api/invitations',{method:'POST',headers:{cookie,origin:config.appUrl,'content-type':'application/json'},body:JSON.stringify(input)},bindings)).status).toBe(200);
  expect(attempts).toBe(2);
  const status=await api.request('/api/workspace/mail',{headers:{cookie}},bindings);
  expect(status.status).toBe(200);expect(await status.json()).toMatchObject({items:[{state:'sent'}]});
 }finally{provider.mockRestore();}
 }

} finally {}
}}
  ,
{name:"MAIL-002 BASE-ACCESS-001 SendGrid outcomes and expired leases retain durable attempts without blind resend",before:async()=>{await resetDeployment();},run:sendgridMailCase},
{name:"MAIL-001 Worker sign-in and invitation mail share one sender, wiki events and schedules send none, and replies are refused",before:async()=>{await resetDeployment();},run:mailBoundaryCase}
]);
});
