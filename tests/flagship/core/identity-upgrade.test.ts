import { contract } from '../../e2e/contract';
import { createApi } from '../../../src/core/app/hono';
import { seedWorkspace, seedMember, sessionFor } from '../../e2e/setup/fixtures';
import { samlProviderEdge } from './saml-provider-fixture';
import { recheckSamlDomains } from '../../../src/core/features/session/saml/domain';
import { env, applyD1Migrations } from 'cloudflare:test';
import { test, expect } from 'vitest';
import { createOpaqueToken, sessionDigest } from '../../../src/core/platform/auth/token';
import { readRuntimeConfig } from '../../../src/core/platform/config/runtime';
import { captureMail } from '../../e2e/helpers/mail-edge';
import { priorIdentityFixture } from './identity-prior-fixture';
import { providerEdge } from './identity-provider-fixture';
import { ownerSigninDigest } from '../../../modules/operator-auth/owner-signin-grant.mjs';

type Fixture = Awaited<ReturnType<typeof priorIdentityFixture>>;
const project = (rows: unknown[], like: unknown[]) => {
  const columns = Object.keys((like[0] ?? {}) as object);
  return (rows as Record<string, unknown>[]).map(row => Object.fromEntries(columns.map(column => [column, row[column]])));
};
function http(fixture: Fixture) {
  const { api, origin, bindings } = fixture, host = new URL(origin).host;
  bindings.MAIL_PROVIDER = 'resend';
  bindings.MAIL_API_KEY = 'test-only-mail-key';
  const mail = captureMail();
  return {
    host,
    get: (path: string, cookie?: string) => api.request(origin + path, { headers: { host, ...(cookie ? { cookie } : {}) } }, bindings),
    send: (method: string, path: string, body: unknown, cookie?: string, from = origin) => api.request(origin + path, { method, headers: { host, origin: from, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }, bindings),
    confirm: (token: string, cookie?: string, from = origin) => api.request(origin + '/auth/confirm', { method: 'POST', headers: { host, origin: from, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams({ token }) }, bindings),
    /** The newest outbox message for an address, opened as a person would. */
    async latestLink(email: string) {
      const link = mail.latestLink(email);
      expect(link.origin + link.pathname).toBe(origin + '/auth/confirm');
      return link.searchParams.get('token')!;
    },
    latestInvitation: (email: string) => mail.latestLink(email),
  };
}
const cookieOf = (response: Response) => response.headers.getSetCookie().find(value => value.startsWith('slate_session='))!.split(';')[0]!;

test('published v0.1.0 members, groups, guests and live sessions keep identity, access and authority through Base sign-in adoption', async () => {
  const fixture = await priorIdentityFixture();
  const { db, owner, member, before } = fixture;
  // A v0.1.0 GET link, still unused at upgrade time.
  const old = createOpaqueToken(), config = readRuntimeConfig(fixture.bindings, true);
  await db.prepare('INSERT INTO magic_links (id,email,token_digest,expires_at,created_at) VALUES (?,?,?,?,?)').bind('old-unused-link', 'prior-owner@example.org', await sessionDigest(config.sessionSecret, old), '2099-01-01T00:00:00.000Z', new Date().toISOString()).run();
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  for (const table of Object.keys(before)) expect(project((await db.prepare(`SELECT * FROM ${table}`).all()).results, before[table]!), table).toEqual(before[table]);
  // access() asserts the v0.1.0 access table: owner/member/guest sessions, group administration, allowed and denied pages.
  const priorAccess = await fixture.access();
  const web = http(fixture);

  // Earlier links never become credentials.
  const retired = await web.get('/api/auth/magic/accept?token=' + old);
  expect(retired.status).toBe(400); expect(await retired.text()).toContain('href="/signin"'); expect(retired.headers.get('set-cookie')).toBeNull();
  expect((await web.confirm(old)).status).toBe(400);
  expect((await db.prepare('SELECT used_at FROM magic_links WHERE id=?').bind('old-unused-link').first())?.used_at).toBeNull();

  // Email: Base proof, inert preview, same-origin POST, one use.
  expect((await web.send('POST', '/api/auth/magic', { email: 'prior-owner@example.org' })).status).toBe(200);
  const token = await web.latestLink('prior-owner@example.org');
  const preview = await web.get('/auth/confirm?token=' + token);
  expect(preview.status).toBe(200); expect(await preview.text()).toContain('<form method="post"'); expect(preview.headers.get('set-cookie')).toBeNull();
  expect((await web.confirm(token, undefined, 'https://other.example.org')).status).not.toBe(303);
  const accepted = await web.confirm(token);
  expect(accepted.status).toBe(303); expect(accepted.headers.get('location')).toBe('/app');
  const emailSession = await web.get('/api/session', cookieOf(accepted));
  expect(await emailSession.json()).toMatchObject({ member: { id: owner.memberId, role: 'owner' } });
  expect((await web.confirm(token)).status).toBe(400);

  // Provider: the incumbent issuer/client/callback, now pinned; first sign-in binds the verified mailbox's member.
  const provider = await providerEdge(fixture);
  try {
    const flow = await provider.signIn({ subject: 'prior-provider-subject', email: 'prior-member@example.org' });
    expect((await fixture.api.request(flow.url, { headers: { host: web.host } }, fixture.bindings)).status).toBe(400);
    const completed = await flow.complete();
    expect(completed.status).toBe(303); expect(completed.headers.get('location')).toBe('/app');
    expect(await (await web.get('/api/session', cookieOf(completed))).json()).toMatchObject({ member: { id: member.memberId, role: 'member' } });
    expect((await flow.complete()).status).toBe(400);
    expect((await db.prepare('SELECT issuer,subject,member_id FROM member_identity_bindings').all()).results)
      .toEqual([{ issuer: fixture.bindings.IDENTITY_ISSUER_URL, subject: 'prior-provider-subject', member_id: member.memberId }]);
    // A bound subject asserting the owner's mailbox is refused, and the binding never moves: nobody gains authority.
    const moved = await (await provider.signIn({ subject: 'prior-provider-subject', email: 'prior-owner@example.org' })).complete();
    expect(moved.status).toBe(403); expect(moved.headers.getSetCookie().some(value => value.startsWith('slate_session='))).toBe(false);
    const row = await db.prepare("SELECT kind,authority_version,issuer,created_at,expires_at FROM sessions WHERE kind='oidc' LIMIT 1").first<{ created_at: string; expires_at: string }>();
    expect(Date.parse(row!.expires_at) - Date.parse(row!.created_at)).toBeLessThanOrEqual(86_400_000);
  } finally { provider.restore(); }

  expect(await fixture.access()).toEqual(priorAccess);
  for (const table of ['members', 'groups', 'group_members', 'container_grants', 'pages', 'page_revisions']) expect(project((await db.prepare(`SELECT * FROM ${table}`).all()).results, before[table]!), table).toEqual(before[table]);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);

  // Ownership changes need a fresh email step-up in the asking session, and end
  // fenced sessions of the changed member.
  const { cookies } = fixture;
  // A post-upgrade email session for the member; their v0.1.0 session stays as it was.
  expect((await web.send('POST', '/api/auth/magic', { email: 'prior-member@example.org' })).status).toBe(200);
  const memberFresh = cookieOf(await web.confirm(await web.latestLink('prior-member@example.org')));
  const promote = () => web.send('PUT', `/api/members/${member.memberId}/role`, { operationKey: 'promote-' + crypto.randomUUID(), expectedRole: 'member', role: 'owner' }, cookies.owner);

  const refused = await promote();
  expect(refused.status).toBe(403); expect(await refused.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  const challenge = await web.latestLink('prior-owner@example.org');
  expect(await (await web.get('/auth/confirm?token=' + challenge)).text()).toContain('<form method="post"');
  // A step-up link completes only in the session that asked for it.
  expect((await web.confirm(challenge, cookies.member)).status).toBe(400);
  const confirmed = await web.confirm(challenge, cookies.owner);
  expect(confirmed.status).toBe(303); expect(confirmed.headers.get('set-cookie')).toBeNull();
  expect((await web.confirm(challenge, cookies.owner)).status).toBe(400);

  const promoted = await promote();
  expect(promoted.status).toBe(200);
  expect(await db.prepare('SELECT m.role,a.version FROM members m JOIN member_authority a ON a.member_id=m.id WHERE m.id=?').bind(member.memberId).first()).toEqual({ role: 'owner', version: 2 });
  // The new-style session was issued at the old authority version; the v0.1.0 session keeps its native contract.
  expect((await web.get('/api/session', memberFresh)).status).toBe(401);
  expect(await (await web.get('/api/session', cookies.member)).json()).toMatchObject({ member: { id: member.memberId, role: 'owner' } });
  expect(await (await web.get('/api/session', cookies.owner)).json()).toMatchObject({ member: { id: owner.memberId } });
  await invitedProviderJourney(fixture, web);
});

/** WORK-015: native invitation and session doors, with only provider and mail transport substituted. */
async function invitedProviderJourney(fixture: Fixture, web: ReturnType<typeof http>) {
  const { db, api, origin, bindings, cookies } = fixture;
  const oldEmail = ['synthetic-slate-703', 'example.test'].join('@');
  const newEmail = ['synthetic-slate-704', 'example.test'].join('@');
  const unknownEmail = ['synthetic-slate-705', 'example.test'].join('@');
  const rows = async (table: string) => (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
  const snapshot = async () => ({ members: await rows('members'), sessions: await rows('sessions'), bindings: (await db.prepare('SELECT * FROM member_identity_bindings ORDER BY issuer,subject').all()).results });
  const invite = async (email: string) => {
    const response = await web.send('POST', '/api/invitations', { operationKey: crypto.randomUUID(), email, kind: 'member' }, cookies.owner);
    expect(response.status, await response.clone().text()).toBe(200);
    const link = web.latestInvitation(email);
    expect(link.origin + link.pathname).toBe(origin + '/api/auth/invitation/accept');
    return link.searchParams.get('token')!;
  };
  const accept = (token: string) => api.request(origin + '/api/auth/invitation/accept', { method: 'POST', headers: { host: web.host, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }, bindings);
  const session = async (cookie: string) => {
    const response = await web.get('/api/session', cookie);
    expect(response.status).toBe(200);
    return (await response.json<{ member: { id: string; email: string; role: string } }>()).member;
  };
  const token = await invite(oldEmail), beforeAcceptance = await snapshot();
  const preview = await web.get('/api/auth/invitation/accept?token=' + token);
  expect(preview.status).toBe(200); expect(preview.headers.get('set-cookie')).toBeNull();
  expect(await snapshot()).toEqual(beforeAcceptance);
  const accepted = await accept(token);
  expect(accepted.status).toBe(303);
  const oldCookie = cookieOf(accepted), oldMember = await session(oldCookie);
  expect(oldMember).toMatchObject({ email: oldEmail, role: 'member' });
  expect(await db.prepare('SELECT accepted_by_member_id FROM invitations WHERE email=?').bind(oldEmail).first()).toEqual({ accepted_by_member_id: oldMember.id });

  const provider = await providerEdge(fixture, 'synthetic-slate-' + crypto.randomUUID());
  try {
    const flow = await provider.signIn({ subject: 'synthetic-slate-706', email: oldEmail });
    const signedIn = await flow.complete();
    expect(signedIn.status).toBe(303);
    const providerCookie = cookieOf(signedIn);
    expect(await session(providerCookie)).toEqual(oldMember);
    expect(await db.prepare('SELECT member_id FROM member_identity_bindings WHERE subject=?').bind('synthetic-slate-706').first()).toEqual({ member_id: oldMember.id });

    // A verified mailbox alone confers no admission and creates no native identity state.
    const beforeUnknown = await snapshot();
    const unknown = await (await provider.signIn({ subject: 'synthetic-slate-707', email: unknownEmail })).complete();
    expect(unknown.status).toBe(403);
    expect(unknown.headers.getSetCookie().some(value => value.startsWith('slate_session='))).toBe(false);
    expect(await snapshot()).toEqual(beforeUnknown);

    // Give the old identity a real private grant, then revoke it before the owner invites a new address.
    const page = await db.prepare("SELECT id FROM pages WHERE title='Owner page'").first<{ id: string }>();
    const grant = await web.send('POST', '/api/sharing', { operationKey: crypto.randomUUID(), targetKind: 'page', targetId: page!.id, principalKind: 'member', principalId: oldMember.id, level: 'view' }, cookies.owner);
    expect(grant.status, await grant.clone().text()).toBe(200);
    expect((await web.get('/api/pages/' + page!.id, oldCookie)).status).toBe(200);
    const removal = { operationKey: crypto.randomUUID(), memberId: oldMember.id };
    expect((await web.send('POST', '/api/members/remove', removal, cookies.owner)).status).toBe(200);
    for (const cookie of [oldCookie, providerCookie]) expect((await web.get('/api/session', cookie)).status).toBe(401);
    const retiredSessions = (await db.prepare('SELECT * FROM sessions WHERE member_id=? ORDER BY id').bind(oldMember.id).all()).results;
    const retiredGrants = (await db.prepare('SELECT * FROM page_grants WHERE principal_id=? ORDER BY id').bind(oldMember.id).all()).results;
    expect(retiredSessions.length).toBeGreaterThan(0); expect(retiredSessions.every(row => row.revoked_at !== null)).toBe(true);
    expect(retiredGrants).toHaveLength(1); expect(retiredGrants[0]!.revoked_at).not.toBeNull();

    const replacementToken = await invite(newEmail), replacement = await accept(replacementToken);
    expect(replacement.status).toBe(303);
    const replacementCookie = cookieOf(replacement), replacementMember = await session(replacementCookie);
    expect(replacementMember).toMatchObject({ email: newEmail, role: 'member' });
    expect(replacementMember.id).not.toBe(oldMember.id);
    expect((await web.get('/api/pages/' + page!.id, replacementCookie)).status).toBe(404);
    expect(await db.prepare('SELECT status,email FROM members WHERE id=?').bind(oldMember.id).first()).toEqual({ status: 'removed', email: oldEmail });
    expect((await db.prepare('SELECT * FROM sessions WHERE member_id=? ORDER BY id').bind(oldMember.id).all()).results).toEqual(retiredSessions);
    expect((await db.prepare('SELECT * FROM page_grants WHERE principal_id=? ORDER BY id').bind(oldMember.id).all()).results).toEqual(retiredGrants);
    const beforeReplay = await snapshot();
    for (const used of [token, replacementToken]) {
      const replay = await accept(used);
      expect(replay.status).toBe(400); expect(replay.headers.get('set-cookie')).toBeNull();
    }
    expect((await web.send('POST', '/api/members/remove', removal, cookies.owner)).status).toBe(200);
    for (const email of [oldEmail, newEmail]) {
      const rebound = await (await provider.signIn({ subject: 'synthetic-slate-706', email })).complete();
      expect(rebound.status).toBe(403);
      expect(rebound.headers.getSetCookie().some(value => value.startsWith('slate_session='))).toBe(false);
    }
    expect(await snapshot()).toEqual(beforeReplay);

    // Discovery, token transport and a cryptographically wrong signature each fail closed.
    // Keeping the edge broken during email confirmation proves the independent mailbox door.
    for (const failure of ['discovery', 'token', 'signature'] as const) {
      provider.fail(null);
      const pending = failure === 'discovery' ? null : await provider.signIn({ subject: 'synthetic-slate-708', email: newEmail });
      provider.fail(failure);
      const beforeFailure = await snapshot();
      const failed = pending ? await pending.complete(true) : await api.request(origin + '/auth/oidc/identity/start', { method: 'POST', headers: { host: web.host, origin, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' }, body: '' }, bindings);
      expect(failed.status).toBe(303);
      const destination = new URL(failed.headers.get('location')!, origin);
      expect(destination.pathname).toBe('/signin');
      expect(destination.searchParams.get('provider')).toBe('identity');
      expect(destination.searchParams.get('notice')).toBe(failure === 'signature' ? 'oidc_invalid_response' : 'oidc_provider_unavailable');
      expect(failed.headers.getSetCookie().some(value => value.startsWith('slate_session='))).toBe(false);
      expect(await snapshot()).toEqual(beforeFailure);
      expect((await web.send('POST', '/api/auth/magic', { email: newEmail })).status).toBe(200);
      const emailSession = await web.confirm(await web.latestLink(newEmail));
      expect(emailSession.status).toBe(303);
      expect(await session(cookieOf(emailSession))).toEqual(replacementMember);
      expect((await web.get('/api/session', providerCookie)).status).toBe(401);
    }
    provider.fail(null);
    bindings.SSO_ENABLED = 'false';
    const capabilities = await web.get('/api/auth/capabilities');
    expect(await capabilities.json()).toMatchObject({ mailDelivery: true, identityProvider: false, identityProviders: [] });
    expect((await web.send('POST', '/api/auth/magic', { email: newEmail })).status).toBe(200);
    const withoutProvider = await web.confirm(await web.latestLink(newEmail));
    expect(withoutProvider.status).toBe(303); expect(await session(cookieOf(withoutProvider))).toEqual(replacementMember);
    for (const cookie of [oldCookie, providerCookie]) expect((await web.get('/api/session', cookie)).status).toBe(401);
  } finally { bindings.SSO_ENABLED = 'true'; provider.restore(); }
}


contract('ADMIN-001', 'signed SP and IdP SAML, DNS-gated invited or allow-listed JIT, enforced member SSO and one owner mailbox escape', async () => {
  const workspaceId=(await env.DB.prepare('SELECT id FROM workspaces ORDER BY created_at,id LIMIT 1').first<{id:string}>())?.id??(await seedWorkspace()).workspaceId;
  const owner=await seedMember(workspaceId,{role:'owner',email:'saml-owner@example.org',displayName:'SAML owner',isSetupOwner:true});
  const member=await seedMember(workspaceId,{role:'member',email:'saml-member@example.org',displayName:'SAML member'});
  const otherOwner=await seedMember(workspaceId,{role:'owner',email:'saml-other-owner@example.org',displayName:'Other owner'});
  const guest=await seedMember(workspaceId,{role:'member',email:'saml-guest@outside.example',displayName:'SAML guest',isGuest:true});
  const origin='https://slate-saml.example.org',db=env.DB,api=createApi();
  const bindings={...env,APP_URL:origin,LOCAL_DEVELOPMENT:'false',MAIL_PROVIDER:'resend',MAIL_FROM:'Slate <mail@example.org>',MAIL_API_KEY:'test-only-mail-key',SETUP_OWNER_EMAIL:'saml-owner@example.org'};
  const mail=captureMail(),edge=await samlProviderEdge();
  const call=(path:string,method='GET',body?:unknown,cookie?:string)=>api.request(origin+path,{method,headers:{host:new URL(origin).host,origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})},bindings);
  const confirm=(token:string,cookie?:string)=>api.request(origin+'/auth/confirm',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body:new URLSearchParams({token})},bindings);
  const magic=async(email:string)=>{expect((await call('/api/auth/magic','POST',{email})).status).toBe(200);return mail.latestLink(email).searchParams.get('token')!;};
  const acs=(xml:string,relay?:string,cookie?:string)=>api.request(origin+'/auth/saml/acs',{method:'POST',headers:{host:new URL(origin).host,origin:edge.ssoUrl,'sec-fetch-site':'cross-site','content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body:new URLSearchParams({SAMLResponse:Buffer.from(xml).toString('base64'),...(relay?{RelayState:relay}:{})})},bindings);
  // An unsolicited response is completed only from Slate's own confirmation page, in the browser that received it.
  const confirmation=async(shown:Response)=>{const page=await shown.text(),field=(name:string)=>page.match(new RegExp(`name="${name}" value="([^"]+)"`))![1]!;return {page,flow:shown.headers.getSetCookie().find(value=>value.startsWith('__Host-slate_saml_flow='))!.split(';')[0]!,body:new URLSearchParams({SAMLResponse:field('SAMLResponse'),confirmation:field('confirmation')})};};
  const confirmIdp=async(xml:string)=>{const shown=await acs(xml);if(shown.status!==200)return shown;const {flow,body}=await confirmation(shown);return api.request(origin+'/auth/saml/acs',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/x-www-form-urlencoded',cookie:flow},body},bindings);};
  try{
    const staleOwner=await sessionFor(owner.memberId),memberCookie=await sessionFor(member.memberId),otherCookie=await sessionFor(otherOwner.memberId),guestCookie=await sessionFor(guest.memberId);
    const beforeMember=await magic('saml-member@example.org'),beforeOther=await magic('saml-other-owner@example.org');
    const settings={idpEntityId:edge.issuer,ssoUrl:edge.ssoUrl,certificate:edge.certificate,emailDomain:'example.org',allowedEmails:['saml-jit@example.org','saml-after-dns-failure@example.org'],enabled:true,enforced:false,breakGlassOwnerId:owner.memberId};
    expect((await call('/api/auth/saml')).status).toBe(401);
    expect((await call('/api/auth/saml','GET',undefined,memberCookie)).status).toBe(403);
    expect((await call('/api/auth/saml','PUT',settings,staleOwner)).status).toBe(403);
    expect((await confirm(mail.latestLink('saml-owner@example.org').searchParams.get('token')!,staleOwner)).status).toBe(303);
    const saved=await call('/api/auth/saml','PUT',settings,staleOwner);expect(saved.status,await saved.clone().text()).toBe(200);
    const view=await saved.json() as {txtName:string;txtValue:string;config:{certificateConfigured:boolean;domainStatus:string}};
    expect(view.config.certificateConfigured).toBe(true);expect(JSON.stringify(view)).not.toContain('BEGIN CERTIFICATE');
    const newProof=()=>edge.assertion({origin,email:'saml-jit@example.org'});
    expect((await acs(newProof())).status).toBe(503);
    expect(await db.prepare('SELECT id FROM members WHERE email=?').bind('saml-jit@example.org').first()).toBeNull();
    edge.dns(view.txtName,view.txtValue);
    const verifiedDomain=await call('/api/auth/saml/verify-domain','POST',{},staleOwner);expect(verifiedDomain.status).toBe(200);
    expect(edge.observed,await verifiedDomain.text()).toHaveLength(1);
    const metadata=await call('/auth/saml/metadata');expect(metadata.status).toBe(200);expect(await metadata.text()).toContain(origin+'/auth/saml/acs');
    for(const input of [{variant:'unsigned'},{variant:'wrong-signature'},{audience:'https://wrong-audience.example.org'},{recipient:'https://wrong-recipient.example.org/acs'},{expiresAt:Date.now()-1}]){
      const refused=await acs(edge.assertion({origin,email:'saml-jit@example.org',...input}));expect(refused.status).toBe(400);expect(refused.headers.get('set-cookie')).toBeNull();
    }
    expect((await acs('<!DOCTYPE samlp:Response [<!ENTITY x SYSTEM "https://external.invalid">]>'+newProof())).status).toBe(400);
    const wrapped=newProof();expect((await acs(wrapped.replace('</samlp:Response>',wrapped.match(/<saml:Assertion[\s\S]*<\/saml:Assertion>/)![0]+'</samlp:Response>'))).status).toBe(400);
    const alternate=await samlProviderEdge();
    try{expect((await acs(alternate.assertion({origin,email:'saml-jit@example.org'}))).status).toBe(400);}finally{alternate.restore();}
    const started=await call('/auth/saml/start');expect(started.status).toBe(303);
    expect(started.headers.get('set-cookie')?.startsWith('__Host-')).toBe(true);
    expect(started.headers.get('set-cookie')).toContain('SameSite=None');expect(started.headers.get('set-cookie')).toContain('; Secure');expect(started.headers.get('set-cookie')).toContain('; HttpOnly');
    const request=edge.requestId(started),correlated=edge.assertion({origin,email:'saml-jit@example.org',requestId:request.id});
    expect((await acs(correlated,request.relay)).status).toBe(400);
    expect((await acs(correlated,undefined,request.cookie)).status).toBe(400);
    const admitted=await acs(correlated,request.relay,request.cookie);expect(admitted.status).toBe(303);
    const samlCookie=cookieOf(admitted);
    expect(await (await call('/api/session','GET',undefined,samlCookie)).json()).toMatchObject({member:{email:'saml-jit@example.org'}});
    expect((await acs(correlated,request.relay,request.cookie)).status).toBe(400);
    // An unsolicited response names the account but never replaces this browser's session by itself.
    const shown=await acs(newProof(),undefined,samlCookie);expect(shown.status).toBe(200);expect(shown.headers.getSetCookie().some(value=>value.startsWith('slate_session='))).toBe(false);
    const pending=await confirmation(shown);expect(pending.page).toContain('saml-jit@example.org');
    const forged=await api.request(origin+'/auth/saml/acs',{method:'POST',headers:{host:new URL(origin).host,origin:edge.ssoUrl,'sec-fetch-site':'cross-site','content-type':'application/x-www-form-urlencoded',cookie:pending.flow},body:pending.body},bindings);expect(forged.status).toBe(400);expect(forged.headers.getSetCookie().some(value=>value.startsWith('slate_session='))).toBe(false);
    expect((await api.request(origin+'/auth/saml/acs',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/x-www-form-urlencoded'},body:pending.body},bindings)).status).toBe(400);
    const idp=await api.request(origin+'/auth/saml/acs',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/x-www-form-urlencoded',cookie:pending.flow},body:pending.body},bindings);expect(idp.status).toBe(303);expect((await acs(newProof(),'invented-state')).status).toBe(400);
    const outsider=await acs(edge.assertion({origin,email:'not-allowed@example.org'}));expect(outsider.status).toBe(403);
    const inviteResponse=await call('/api/invitations','POST',{operationKey:'saml-invite-'+crypto.randomUUID(),email:'saml-invited@example.org',kind:'member'},staleOwner);
    expect(inviteResponse.status).toBe(200);
    expect((await confirmIdp(edge.assertion({origin,email:'saml-invited@example.org'}))).status).toBe(303);
    // The incumbent OIDC provider still works beside unenforced SAML; its
    // existing session and a fresh callback cannot bypass SAML enforcement.
    const oidcIssuer='https://oidc-beside-saml.example.org';
    const oidcBindings={...bindings,SSO_ENABLED:'true',RER_DEV_KEY:'test-only-oidc-key'.padEnd(43,'k'),IDENTITY_ISSUER_URL:oidcIssuer,IDENTITY_CLIENT_ID:'saml-neighbour',IDENTITY_CLIENT_SECRET:'test-only-neighbour-secret',IDENTITY_AUTHORIZATION_ENDPOINT:oidcIssuer+'/authorize',IDENTITY_TOKEN_ENDPOINT:oidcIssuer+'/token',IDENTITY_JWKS_URI:oidcIssuer+'/keys',IDENTITY_TRANSACTION_SECRET:'test-only-neighbour-transaction-secret32+'};
    const oidcFixture={api,origin,bindings:oidcBindings} as Fixture;
    const oidc=await providerEdge(oidcFixture);let oidcCookie:string;
    let designatedOwnerOidcCookie:string;
    try{
      const callback=await (await oidc.signIn({subject:'saml-neighbour-member',email:'saml-member@example.org'})).complete();expect(callback.status).toBe(303);oidcCookie=cookieOf(callback);
      const ownerCallback=await (await oidc.signIn({subject:'synthetic-slate-701',email:'saml-owner@example.org'})).complete();
      expect(ownerCallback.status).toBe(303);designatedOwnerOidcCookie=cookieOf(ownerCallback);
    }finally{oidc.restore();}
    expect((await api.request(origin+'/api/session',{headers:{host:new URL(origin).host,cookie:oidcCookie!}},oidcBindings)).status).toBe(200);
    expect((await api.request(origin+'/api/session',{headers:{host:new URL(origin).host,cookie:designatedOwnerOidcCookie!}},oidcBindings)).status).toBe(200);
    const previewBindings={...bindings,RER_PREVIEW_OWNER_SIGNIN:'/auth/owner-signin'};
    const previewGrant=async()=>{
      const token=createOpaqueToken(),now=Date.now();
      await db.prepare('INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) SELECT ?,?,m.id,COALESCE((SELECT version FROM member_authority WHERE member_id=m.id),1),?,? FROM members m WHERE m.id=?')
        .bind(crypto.randomUUID(),await ownerSigninDigest(token),now,now+900_000,owner.memberId).run();
      return token;
    };
    const confirmPreview=(token:string)=>api.request(origin+'/auth/owner-signin',{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})},previewBindings);
    const previewBefore=await confirmPreview(await previewGrant());expect(previewBefore.status).toBe(303);expect(previewBefore.headers.getSetCookie().some(value=>value.startsWith('slate_session='))).toBe(true);
    const nativeInviteResponse=await call('/api/invitations','POST',{operationKey:'saml-native-invite-'+crypto.randomUUID(),email:'saml-native-invite@example.org',kind:'member'},staleOwner);
    expect(nativeInviteResponse.status).toBe(200);const nativeInvitation=mail.latestLink('saml-native-invite@example.org');
    expect((await call('/api/auth/saml','PUT',{...settings,certificate:undefined,enforced:true},staleOwner)).status).toBe(200);
    expect((await api.request(origin+'/api/session',{headers:{host:new URL(origin).host,cookie:oidcCookie!}},oidcBindings)).status).toBe(401);
    expect.soft((await api.request(origin+'/api/session',{headers:{host:new URL(origin).host,cookie:designatedOwnerOidcCookie!}},oidcBindings)).status,'The designated owner exception applies to mailbox sign-in, not an existing OIDC session').toBe(401);
    const enforcedOidc=await providerEdge(oidcFixture);
    try{const callback=await (await enforcedOidc.signIn({subject:'saml-neighbour-owner',email:'saml-other-owner@example.org'})).complete();expect(callback.status).toBe(400);expect(callback.headers.getSetCookie().some(value=>value.startsWith('slate_session='))).toBe(false);expect(await db.prepare('SELECT member_id FROM member_identity_bindings WHERE issuer=? AND subject=?').bind(oidcIssuer,'saml-neighbour-owner').first()).toBeNull();}finally{enforcedOidc.restore();}
    const enforcedMemberOidc=await providerEdge(oidcFixture);
    try{
      for(const identity of [
        {subject:'synthetic-slate-703',email:'saml-member@example.org'},
        {subject:'synthetic-slate-701',email:'saml-owner@example.org'},
        {subject:'synthetic-slate-702',email:'saml-owner@example.org'},
      ]){
        const sessionsBefore=(await db.prepare("SELECT count(*) AS n FROM sessions WHERE kind='oidc'").first<{n:number}>())!.n;
        const callback=await (await enforcedMemberOidc.signIn(identity)).complete();
        expect.soft(callback.status,identity.email+' must use SAML even when OIDC verifies its mailbox').toBe(400);
        expect.soft(callback.headers.getSetCookie().some(value=>value.startsWith('slate_session='))).toBe(false);
        expect.soft((await db.prepare("SELECT count(*) AS n FROM sessions WHERE kind='oidc'").first<{n:number}>())!.n).toBe(sessionsBefore);
        if(identity.subject!=='synthetic-slate-701')expect.soft(await db.prepare('SELECT member_id FROM member_identity_bindings WHERE issuer=? AND subject=?').bind(oidcIssuer,identity.subject).first()).toBeNull();
      }
    }finally{enforcedMemberOidc.restore();}
    const heldPreviewGrant=await previewGrant(),previewAfter=await confirmPreview(heldPreviewGrant);
    expect.soft(previewAfter.headers.getSetCookie().some(value=>value.startsWith('slate_session=')),'A Managed preview grant is not the designated owner mailbox break-glass').toBe(false);
    expect.soft(previewAfter.headers.get('location')).toContain('/signin');
    expect.soft((await db.prepare('SELECT consumed_at FROM oa_owner_signins WHERE token_hash=?').bind(await ownerSigninDigest(heldPreviewGrant)).first<{consumed_at:number|null}>())?.consumed_at).toBeNull();
    expect((await call('/api/session','GET',undefined,memberCookie)).status).toBe(401);
    expect((await call('/api/session','GET',undefined,otherCookie)).status).toBe(401);
    expect((await call('/api/session','GET',undefined,guestCookie)).status).toBe(200);
    expect((await call('/api/session','GET',undefined,staleOwner)).status).toBe(200);
    expect((await call('/api/session','GET',undefined,samlCookie)).status).toBe(401); // Config generation ended old provider sessions.
    expect((await confirm(beforeMember)).status).toBe(403);expect((await confirm(beforeOther)).status).toBe(400);
    expect((await db.prepare("SELECT used_at FROM auth_proofs WHERE member_id=? AND kind='magic'").bind(member.memberId).first())?.used_at).toBeNull();
    const count=(await db.prepare("SELECT count(*) AS n FROM auth_proofs WHERE kind='magic'").first<{n:number}>())!.n;
    expect((await call('/api/auth/magic','POST',{email:'saml-member@example.org'})).status).toBe(200);
    expect((await call('/api/auth/magic','POST',{email:'saml-other-owner@example.org'})).status).toBe(200);
    expect((await db.prepare("SELECT count(*) AS n FROM auth_proofs WHERE kind='magic'").first<{n:number}>())!.n).toBe(count);
    for(const email of ['saml-owner@example.org','saml-guest@outside.example'])expect((await confirm(await magic(email))).status).toBe(303);
    const nativeInvite=await api.request(nativeInvitation.toString(),{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:nativeInvitation.searchParams.get('token')!})},bindings);
    expect(nativeInvite.headers.get('set-cookie')).toBeNull();expect(nativeInvite.status).toBe(303);expect(nativeInvite.headers.get('location')).toBe('/auth/saml/start');
    const nativeInvitePerson=await db.prepare('SELECT id FROM members WHERE email=?').bind('saml-native-invite@example.org').first<{id:string}>();
    expect(nativeInvitePerson).not.toBeNull();expect(await db.prepare('SELECT id FROM sessions WHERE member_id=?').bind(nativeInvitePerson!.id).first()).toBeNull();
    const memberSaml=await confirmIdp(edge.assertion({origin,email:'saml-member@example.org'}));expect(memberSaml.status).toBe(303);
    // Step-up remains an email proof of the asking SAML session, not a new email session.
    const memberSamlCookie=cookieOf(memberSaml);
    expect((await call('/auth/step-up','POST',{action:'export',returnTo:'/app'},memberSamlCookie)).status).toBe(202);
    expect((await confirm(mail.latestLink('saml-member@example.org').searchParams.get('token')!,memberSamlCookie)).status).toBe(303);
    expect((await call('/api/session','GET',undefined,memberSamlCookie)).status).toBe(200);
    edge.unpublish();
    await db.prepare('UPDATE saml_provider_config SET domain_checked_at=?').bind(Date.now()-86_400_001).run();
    expect((await acs(edge.assertion({origin,email:'saml-after-dns-failure@example.org'}))).status).toBe(503);
    await recheckSamlDomains(db);
    expect(edge.observed).toHaveLength(2);
    expect(await db.prepare('SELECT domain_status,domain_checked_at FROM saml_provider_config').first()).toMatchObject({domain_status:'failed',domain_checked_at:expect.any(Number)});
    const notice=await call('/api/notifications','GET',undefined,staleOwner);expect(notice.status).toBe(200);expect(JSON.stringify(await notice.json())).toContain('SAML domain verification failed');
    expect((await acs(edge.assertion({origin,email:'saml-after-dns-failure@example.org'}))).status).toBe(503);
    expect((await confirmIdp(edge.assertion({origin,email:'saml-member@example.org'}))).status).toBe(303);
    const breakGlassChange=await call(`/api/members/${owner.memberId}/role`,'PUT',{operationKey:'saml-break-glass-change-'+crypto.randomUUID(),expectedRole:'owner',role:'member'},staleOwner);
    expect(breakGlassChange.status).toBe(409);expect(await breakGlassChange.json()).toMatchObject({code:'SAML_BREAK_GLASS_OWNER_REQUIRED'});
    expect(await db.prepare('SELECT role,status FROM members WHERE id=?').bind(owner.memberId).first()).toEqual({role:'owner',status:'active'});
    const jit=await db.prepare('SELECT id FROM members WHERE email=?').bind('saml-jit@example.org').first<{id:string}>();
    const erased=await call('/api/members/remove','POST',{operationKey:'saml-jit-erasure-'+crypto.randomUUID(),memberId:jit!.id,erase:true},staleOwner);
    expect(erased.status,await erased.clone().text()).toBe(200);
    const erasedConfig=await call('/api/auth/saml','GET',undefined,staleOwner);
    expect(JSON.stringify(await erasedConfig.json())).not.toContain('saml-jit@example.org');
    expect(await db.prepare('SELECT member_id FROM member_identity_bindings WHERE member_id=?').bind(jit!.id).first()).toBeNull();
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{edge.restore();mail.restore();}
});
