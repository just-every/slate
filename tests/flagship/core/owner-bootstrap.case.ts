import {env} from 'cloudflare:test';
import {expect} from 'vitest';
import {ownerIdentity} from '../../../src/ext/config';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {createApi} from '../../../src/core/app/hono';

const token='b'.repeat(64),origin='https://slate.test';
const email=['qa-inbox','slate.test'].join('@');
const hosted={...env,SETUP_TOKEN:token,SETUP_OWNER_EMAIL:email} as typeof env;
const claim=(body:unknown,bindings=hosted)=>createApi().request(`${origin}/auth/bootstrap`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)},bindings);


// The hosted owner claim RER makes after the first publication (Base operator-auth's POST /auth/bootstrap).
export async function ownerBootstrapCase() {
 const refused=await claim({token:'c'.repeat(64),displayName:'Owner',returnTo:'/'});
 expect(refused.status).toBe(403);expect(await env.DB.prepare('SELECT count(*) n FROM workspaces').first()).toEqual({n:0});
 expect((await claim({token,displayName:'Owner',returnTo:'/'},env)).status).toBe(403);
 const claimed=await claim({token,displayName:'Owner',returnTo:'/'});
 expect(claimed.status).toBe(303);
 await readyWorkspace(claimed,hosted);
 expect(await env.DB.prepare("SELECT email,display_name,initials,role,is_setup_owner FROM members").all().then(r=>r.results)).toEqual([{email,display_name:'qa-inbox',initials:'QA',role:'owner',is_setup_owner:1}]);
 const kept=await claim({token,displayName:'Owner',returnTo:'/'});
 expect(kept.status).toBe(409);expect(await kept.json()).toMatchObject({error:'already_initialized'});
 expect(await env.DB.prepare('SELECT count(*) n FROM workspaces').first()).toEqual({n:1});
 const cookie=claimed.headers.get('set-cookie')!.split(';',1)[0]!;
 // Existing installs can retain stale role initials; session output derives identity afresh.
 await env.DB.prepare("UPDATE members SET initials='OW'").run();
 const session=await createApi().request(`${origin}/api/session`,{headers:{cookie}},hosted);
 expect(session.status).toBe(200);expect(await session.json()).toMatchObject({member:{displayName:'qa-inbox',initials:'QA'}});
 const page=await env.DB.prepare('SELECT id FROM pages LIMIT 1').first<{id:string}>();
 expect((await createApi().request(`${origin}/api/collaboration/${page!.id}/presence`,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({sessionId:'identity-session',cursor:null})},hosted)).status).toBe(200);
 const presence=await createApi().request(`${origin}/api/collaboration/${page!.id}`,{headers:{cookie}},hosted);
 expect(presence.status).toBe(200);expect(await presence.json()).toMatchObject({presence:[{displayName:'qa-inbox',initials:'QA'}]});
 await resetDeployment();
 const named=await claim({token,displayName:'Priya Shah',returnTo:'/'});
 expect(named.status).toBe(303);
 const namedCookie=named.headers.get('set-cookie')!.split(';',1)[0]!;
 const namedSession=await createApi().request(`${origin}/api/session`,{headers:{cookie:namedCookie}},hosted);
 expect(await namedSession.json()).toMatchObject({member:{email,displayName:'Priya Shah',initials:'PS'}});
 await claimTransactions();
}


const request = (route:string, cookie:string, bindings=hosted, method='GET', body?:unknown) => createApi().request(origin+route, {
 method, headers:{cookie,origin,'content-type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)}),
},bindings);
async function read(route:string,cookie:string,bindings=hosted) {
 const response=await request(route,cookie,bindings);expect(response.status).toBe(200);return response.json() as Promise<any>;
}
async function readyWorkspace(claimed:Response,bindings=hosted) {
 const cookie=claimed.headers.get('set-cookie')!.split(';',1)[0]!;
 const workspace=await read('/api/workspace',cookie,bindings);
 expect(workspace.name).toBe(ownerIdentity.name);
 expect(await read('/api/workspace/first-run',cookie,bindings)).toEqual({required:false,canComplete:false});
 expect(await env.DB.prepare('SELECT first_run_completed_at AS completed FROM workspaces').first()).toEqual({completed:expect.any(String)});
 const spaces=(await read('/api/containers',cookie,bindings)).items.filter((item:any)=>item.visibility!=='personal');
 expect(spaces).toHaveLength(1);expect(spaces[0].name).toBe('General');
 const pages=(await read('/api/pages?containerId='+spaces[0].id,cookie,bindings)).items;
 expect(pages).toHaveLength(1);expect(pages[0].title).toBe('Welcome');
 return {cookie,workspace,space:spaces[0],page:pages[0]};
}
async function editableWorkspace(claimed:Response,bindings=hosted) {
 const {cookie,workspace,space,page}=await readyWorkspace(claimed,bindings);
 expect((await request('/api/workspace',cookie,bindings,'PUT',{operationKey:crypto.randomUUID(),expectedRevisionId:workspace.revisionId,name:'Claimed team',mark:workspace.mark,description:workspace.description,guestAccess:workspace.guestAccess,publicLinkAccess:workspace.publicLinkAccess,anonymousAccess:workspace.anonymousAccess,policies:workspace.policies})).status).toBe(200);
 expect((await read('/api/workspace',cookie,bindings)).name).toBe('Claimed team');
 const container=await read('/api/containers/'+space.id,cookie,bindings);
 expect((await request('/api/containers/'+space.id,cookie,bindings,'PATCH',{operationKey:crypto.randomUUID(),expectedRevisionId:container.revisionId,name:'Team handbook'})).status).toBe(200);
 expect((await read('/api/containers/'+space.id,cookie,bindings)).name).toBe('Team handbook');
 const document=await read('/api/pages/'+page.id,cookie,bindings);
 expect((await request('/api/pages/'+page.id,cookie,bindings,'PATCH',{operationKey:crypto.randomUUID(),expectedRevisionId:document.page.revisionId,properties:{title:'Start here'}})).status).toBe(200);
 const renamed=await read('/api/pages/'+page.id,cookie,bindings);
 expect(renamed.page.title).toBe('Start here');
 const blockId=crypto.randomUUID();
 expect((await request('/api/pages/'+page.id+'/blocks',cookie,bindings,'PUT',{operationKey:crypto.randomUUID(),expectedRevisionId:renamed.page.revisionId,blocks:[{id:blockId,blockType:'paragraph',content:{text:[{text:'Our first notes'}]},treePosition:'a0'}]})).status).toBe(200);
 const edited=await read('/api/pages/'+page.id,cookie,bindings);
 expect(edited.blocks).toEqual([expect.objectContaining({id:blockId,content:{text:[{text:'Our first notes'}]}})]);
 return cookie;
}
const encoded=(value:unknown)=>btoa(typeof value==='string'?value:JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function signedClaim() {
 // Generated only inside this test process; no provider or RER signing secret.
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const key=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const issuer='https://claim.slate.test',installationId='synthetic-slate-installation';
 const bindings={...hosted,RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_PUBLIC_KEYS:JSON.stringify({test:key})};
 const iat=Math.floor(Date.now()/1000);
 const payload=encoded({alg:'ES256',typ:'rer-owner-claim+jwt',kid:'test'})+'.'+encoded({v:1,iss:issuer,aud:origin,installationId,email,jti:crypto.randomUUID(),iat,exp:iat+300});
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(payload));
 const value=payload+'.'+encoded(String.fromCharCode(...new Uint8Array(signature)));
 const submit=(credential=value)=>createApi().request(origin+'/auth/owner-claim',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:credential,displayName:'Priya Shah'})},bindings);
 return {bindings,submit,value};
}
async function claimTransactions() {
 const originalName=ownerIdentity.name;
 // This is the buyer-owned configuration consumed by both native claim doors.
 // Use a nondefault name so a hard-coded product name cannot satisfy the proof.
 ownerIdentity.name='Synthetic team knowledge';
 try {
 for(const door of ['verified-bootstrap','signed-claim']) {
  await resetDeployment();
  const signed=await signedClaim();
  const bindings=door==='signed-claim'?signed.bindings:hosted;
  const submit=door==='signed-claim'?()=>signed.submit():()=>claim({token,displayName:'Priya Shah',returnTo:'/app'});
  if(door==='signed-claim') {
   expect((await signed.submit('synthetic-slate-invalid')).status).toBe(403);
   const foreign={...signed.bindings,RER_OWNER_CLAIM_INSTALLATION_ID:'synthetic-slate-other-installation'};
   expect((await createApi().request(origin+'/auth/owner-claim',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:signed.value})},foreign)).status).toBe(403);
  }
  const snapshot=async()=>Promise.all(['workspaces','members','containers','pages','page_revisions','container_owners','container_members','container_grants','page_grants','status_entries','sessions'].map(async table=>({table,...await env.DB.prepare('SELECT count(*) n FROM '+table).first()})));
  const before=await snapshot();
  // Fail the final canonical page-revision insert inside the real native D1
  // batch, after the workspace, owner, space, grants and page were attempted.
  await env.DB.exec("CREATE TRIGGER synthetic_first_run_rollback BEFORE INSERT ON page_revisions BEGIN SELECT RAISE(ABORT, 'synthetic-slate-rollback'); END");
  try {
   const failed=await submit();expect(failed.status).toBeGreaterThanOrEqual(500);expect(failed.headers.get('set-cookie')).toBeNull();
   expect(await snapshot()).toEqual(before);
  } finally {await env.DB.exec('DROP TRIGGER synthetic_first_run_rollback');}
  const claimed=await submit();expect(claimed.status).toBe(303);
  const cookie=await editableWorkspace(claimed,bindings);
  const completed=await snapshot();
  expect((await submit()).status).toBe(409);expect(await snapshot()).toEqual(completed);
  // Captured claims cannot restore authority after that owner's session and
  // membership are revoked in the installation that already consumed them.
  await env.DB.prepare("UPDATE sessions SET revoked_at=?").bind(new Date().toISOString()).run();
  await env.DB.prepare("UPDATE members SET status='removed'").run();
  const revoked=await snapshot();
  expect((await submit()).status).toBe(409);expect(await snapshot()).toEqual(revoked);
  expect((await request('/api/workspace',cookie,bindings)).status).toBe(401);
 }
 } finally {ownerIdentity.name=originalName;}
}
