import { env } from 'cloudflare:test';
import { test, expect, vi } from 'vitest';
import { scenario, key, rows } from './helpers';
import { createApi } from '../../../src/core/app/hono';
import { sessionFor } from '../../e2e/setup/fixtures';
import { createPage, readPage } from '../../../src/core/features/pages/service';
import { invite, acceptInvitation } from '../../../src/core/features/workspace/invitations';
import { saveGrant, listGrants } from '../../../src/core/features/sharing/grants';
import { readRuntimeConfig } from '../../../src/core/platform/config/runtime';
import { createMemberRepository } from '../../../src/core/features/session/repository';
import { removeMember } from '../../../src/core/features/workspace/members';
test('ADMIN-003 — HTTP guest policy, default expiry and bulk revocation; SHARE-006 SHARE-001 SHARE-007: pending guest invitation grants no access, local provider double captures exact acceptance token, revoke invalidates pending grant', async () => {
    const { owner, containerId } = await scenario();
    const page = await createPage(owner, { operationKey: key('page'), containerId, title: 'Guest invitation' });
    const config = { ...readRuntimeConfig(env, false), appUrl: 'https://qualification.invalid', mailFrom: 'test@qualification.invalid', mailApiKey: 'TEST-ONLY-PROVIDER-DOUBLE' };
    const requests: string[] = [];
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => { requests.push(String(init?.body)); return Response.json({ id: 'LOCAL-SEMANTIC-MAIL-RECEIPT' }); });
    try {
        await invite(owner, config, { operationKey: key('invite'), email: 'pending@qualification.invalid', kind: 'guest', pageId: page.value.pageId });
        const [pending] = await rows('SELECT * FROM invitations WHERE page_id=?', page.value.pageId);
        expect(pending.accepted_by_member_id).toBeNull();
        expect((await listGrants(owner, 'page', page.value.pageId)).items.some(g => g.invitationEmail === 'pending@qualification.invalid')).toBe(true);
        expect(requests).toHaveLength(1);
        const match = requests[0].match(/https:\/\/qualification\.invalid\/api\/auth\/invitation\/accept\?token=([A-Za-z0-9_-]+)/);
        expect(match).not.toBeNull();
        await saveGrant(owner, { operationKey: key('revoke'), targetKind: 'page', targetId: page.value.pageId, id: pending.page_grant_id as string, principalKind: 'member', principalId: `invitation:${pending.id}`, level: 'view', revoke: true });
        await expect(acceptInvitation(env.DB, config, match![1], { files: env.FILES, jobs: env.JOBS })).rejects.toMatchObject({ code: 'LINK_INVALID' });
        expect(await rows("SELECT id FROM members WHERE email='pending@qualification.invalid'")).toEqual([]);
        expect((await rows('SELECT revoked_at FROM invitations WHERE id=?', pending.id))[0].revoked_at).toBe(owner.now);
        await invite(owner, config, { operationKey: key('invite-live'), email: 'accepted@qualification.invalid', kind: 'guest', pageId: page.value.pageId });
        const token = requests[1].match(/https:\/\/qualification\.invalid\/api\/auth\/invitation\/accept\?token=([A-Za-z0-9_-]+)/)![1];
        await acceptInvitation(env.DB, config, token, { files: env.FILES, jobs: env.JOBS });
        const [accepted] = await rows("SELECT id FROM members WHERE email='accepted@qualification.invalid'");
        const actor = await createMemberRepository(env.DB).getMember(accepted.id as string);
        expect((await readPage({ ...owner, actor: actor! }, page.value.pageId)).page.title).toBe('Guest invitation');
        await expect(acceptInvitation(env.DB, config, token, { files: env.FILES, jobs: env.JOBS })).rejects.toMatchObject({ code: 'LINK_INVALID' });
        const api=createApi(),cookie=await sessionFor(owner.actor.id);
        const request=(path:string,method='GET',body?:unknown,session=cookie)=>api.request('https://qualification.invalid/api'+path,{method,headers:{cookie:session,origin:'https://qualification.invalid','content-type':'application/json'},body:body?JSON.stringify(body):undefined},{...env,SLATE_PROFILE:undefined,APP_URL:'https://qualification.invalid'});
        const json=async(path:string,method='GET',body?:unknown)=>{const response=await request(path,method,body);const value=await response.json<any>();expect(response.status,JSON.stringify(value)).toBe(200);return value;};
        await json('/guests/policy','PUT',{operationKey:key('guest-policy'),defaultExpiryDays:14,allowedDomains:['qualification.invalid','blocked.invalid'],deniedDomains:['blocked.invalid']});
        expect((await request('/invitations','POST',{operationKey:key('denied'),kind:'guest',email:'someone@blocked.invalid',pageId:page.value.pageId})).status).toBe(403);
        expect((await request('/invitations','POST',{operationKey:key('not-allowed'),kind:'guest',email:'someone@other.invalid',pageId:page.value.pageId})).status).toBe(403);
        const guestIds:string[]=[accepted.id as string];
        for(const name of ['partner-one','partner-two']){
          const before=requests.length;
          await json('/invitations','POST',{operationKey:key('default-expiry'),kind:'guest',email:`${name}@qualification.invalid`,pageId:page.value.pageId});
          const invitation=(await rows('SELECT i.*,g.expires_at AS grant_expiry FROM invitations i JOIN page_grants g ON g.id=i.page_grant_id WHERE i.email=?',`${name}@qualification.invalid`))[0];
          expect(Date.parse(invitation.grant_expiry as string)-Date.now()).toBeGreaterThan(13*86400000);
          const acceptedToken=requests[before].match(/https:\/\/qualification\.invalid\/api\/auth\/invitation\/accept\?token=([A-Za-z0-9_-]+)/)![1];
          const result=await acceptInvitation(env.DB,config,acceptedToken,{files:env.FILES,jobs:env.JOBS});guestIds.push(result.memberId);
        }
        const guestCookies=await Promise.all(guestIds.map(id=>sessionFor(id)));
        const list=await json('/guests');
        for(const id of guestIds)expect(list.items.find((guest:any)=>guest.id===id)).toMatchObject({invitedBy:'Owner',access:expect.arrayContaining([expect.objectContaining({title:'Guest invitation'})]),lastActiveAt:expect.any(String)});
        expect(list.items.find((guest:any)=>guest.id===guestIds[0]).expiresAt).toBeNull();
        expect(Date.parse(list.items.find((guest:any)=>guest.id===guestIds[1]).expiresAt)-Date.now()).toBeGreaterThan(13*86400000);
        const ownerExpiry=new Date(Date.now()+3*86400000).toISOString();
        await json(`/guests/${guestIds[0]}/expiry`,'PUT',{operationKey:key('legacy-expiry'),expiresAt:ownerExpiry});
        expect((await json('/guests')).items.find((guest:any)=>guest.id===guestIds[0]).expiresAt).toBe(ownerExpiry);
        expect((await request('/guests','GET',undefined,guestCookies[0])).status).toBe(403);
        expect((await request('/guests/policy','PUT',{operationKey:key('forbidden-policy'),defaultExpiryDays:null,allowedDomains:[],deniedDomains:[]},guestCookies[0])).status).toBe(403);
        const revocation={operationKey:key('bulk-revoke'),memberIds:guestIds.slice(0,2)};
        await json('/guests/revoke','POST',revocation);await json('/guests/revoke','POST',revocation);
        for(const session of guestCookies.slice(0,2))expect((await request(`/pages/${page.value.pageId}`,'GET',undefined,session)).status).toBe(401);
        expect((await request(`/pages/${page.value.pageId}`,'GET',undefined,guestCookies[2])).status).toBe(200);
        expect((await json('/guests')).items.filter((guest:any)=>guestIds.includes(guest.id))).toHaveLength(1);
        await env.DB.prepare('UPDATE page_grants SET expires_at=? WHERE principal_id=?').bind('2000-01-01T00:00:00.000Z',guestIds[2]).run();
        expect((await request(`/pages/${page.value.pageId}`,'GET',undefined,guestCookies[2])).status).toBe(404);
        // Expiry must also fence the author's draft exception and an otherwise live grant.
        const authored=await createPage(owner,{operationKey:key('guest-author'),containerId,title:'Guest authored draft'});
        await env.DB.prepare("UPDATE pages SET author_member_id=?,lifecycle='draft' WHERE id=?").bind(guestIds[2],authored.value.pageId).run();
        await env.DB.prepare('UPDATE page_grants SET expires_at=NULL WHERE principal_id=?').bind(guestIds[2]).run();
        expect((await request(`/pages/${authored.value.pageId}`,'GET',undefined,guestCookies[2])).status).toBe(200);
        await env.DB.prepare('UPDATE members SET guest_expires_at=? WHERE id=?').bind('2000-01-01T00:00:00.000Z',guestIds[2]).run();
        expect((await request(`/pages/${authored.value.pageId}`,'GET',undefined,guestCookies[2])).status).toBe(401);
        expect((await request(`/pages/${page.value.pageId}`,'GET',undefined,guestCookies[2])).status).toBe(401);
        expect((await json('/guests')).items.find((guest:any)=>guest.id===guestIds[2]).access).toEqual([]);
        const invitationStart=requests.length;
        await json('/invitations','POST',{operationKey:key('policy-changed'),kind:'guest',email:'waiting@qualification.invalid',pageId:page.value.pageId});
        const waitingToken=requests[invitationStart].match(/https:\/\/qualification\.invalid\/api\/auth\/invitation\/accept\?token=([A-Za-z0-9_-]+)/)![1];
        await json('/guests/policy','PUT',{operationKey:key('deny-after-invite'),defaultExpiryDays:14,allowedDomains:[],deniedDomains:['qualification.invalid']});
        await expect(acceptInvitation(env.DB,config,waitingToken,{files:env.FILES,jobs:env.JOBS})).rejects.toMatchObject({code:'GUEST_DOMAIN_DENIED'});


    }
    finally {
        provider.mockRestore();
    }
});
test('native member invitations preserve uniform admission, lifetime and current inviter authority', async () => {
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
    try {
    const { owner, reader, containerId } = await scenario();
    const page = await createPage(owner, { operationKey: key('return-page'), containerId, title: 'Guest return page' });
    const config = { ...readRuntimeConfig(env, false), mailFrom: 'test@qualification.invalid', mailApiKey: 'synthetic-slate-301' };
    const mails: string[] = [];
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => { mails.push(String(init?.body)); return Response.json({ id: 'synthetic-slate-302' }); });
    const token = () => mails.at(-1)!.match(/\/api\/auth\/invitation\/accept\?token=([A-Za-z0-9_-]+)/)![1]!;
    try {
        {
        const origin='https://qualification.invalid';
        const bindings={...env,APP_URL:origin,SLATE_PROFILE:undefined,MAIL_PROVIDER:'resend',MAIL_FROM:'synthetic-slate-602\x40example.test',MAIL_API_KEY:'synthetic-slate-603'};
        const api=createApi(),cookie=await sessionFor(owner.actor.id);
        const request=(path:string,method='GET',body?:unknown)=>api.request(origin+'/api'+path,{method,headers:{cookie,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined},bindings);
        const admit=async(email:string)=>{
            const operationKey=key('lifetime');
            const response=await request('/invitations','POST',{operationKey,email,kind:'member'});
            expect(response.status).toBe(200);
            const body=await response.json<any>();
            expect(body.value).toEqual({accepted:true});
            expect(body.receipt.operationKey).toBe(operationKey);
            expect(body.receipt.activityId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
            expect(body.receipt.revisionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
            expect(body.receipt.entity.revisionId).toBe(body.receipt.revisionId);
            return {status:response.status,headers:[...response.headers],body:{...body,receipt:{...body.receipt,operationKey:'request',activityId:'activity',revisionId:'revision',entity:{...body.receipt.entity,revisionId:'revision'}}}};
        };
        const acceptance=(delivered:string,method='POST')=>api.request(origin+'/api/auth/invitation/accept'+(method==='GET'?`?token=${delivered}`:''),{method,headers:{origin,'content-type':'application/x-www-form-urlencoded'},...(method==='POST'?{body:new URLSearchParams({token:delivered})}:{})},bindings);
        const snapshot=async()=>Promise.all(['members','sessions','invitations'].map(table=>rows(`SELECT * FROM ${table} ORDER BY id`)));
        const refuse=async(delivered:string)=>{
            const before=await snapshot();
            for(const method of ['GET','POST']){
                const response=await acceptance(delivered,method);
                expect(response.status).toBe(400);
                expect(await response.text()).toContain('This invitation is invalid or expired');
                expect(response.headers.get('set-cookie')).toBeNull();
                expect(await snapshot()).toEqual(before);
            }
        };
        const beforeAnonymous=await snapshot();
        const anonymous=await api.request(origin+'/api/invitations',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({operationKey:key('anonymous-invite'),email:'synthetic-slate-607\x40example.test',kind:'member'})},bindings);
        expect(anonymous.status).toBe(401);
        expect(await snapshot()).toEqual(beforeAnonymous);
        const knownEmail=(await rows('SELECT email FROM members WHERE id=?',reader.actor.id))[0].email as string;
        const sentBefore=mails.length,known=await admit(knownEmail);
        expect(mails).toHaveLength(sentBefore);
        const admittedAt=Date.now(),email='synthetic-slate-604\x40example.test';
        expect(await admit(email)).toEqual(known);
        expect(mails).toHaveLength(sentBefore+1);
        const acceptedToken=token(),beforeAccept=await snapshot();
        const preview=await acceptance(acceptedToken,'GET');
        expect(preview.status).toBe(200);
        expect(await preview.text()).toContain('Accept invitation');
        expect(preview.headers.get('set-cookie')).toBeNull();
        expect(await snapshot()).toEqual(beforeAccept);
        const acceptedResponse=await acceptance(acceptedToken);
        expect(acceptedResponse.status).toBe(303);
        expect(acceptedResponse.headers.get('location')).toBe('/app');
        const acceptedCookie=acceptedResponse.headers.get('set-cookie')!.split(';')[0];
        const current=await api.request(origin+'/api/members/current',{headers:{cookie:acceptedCookie}},bindings);
        expect(current.status).toBe(200);
        expect((await current.json<any>()).email).toBe(email);
        expect(await rows('SELECT id FROM members WHERE email=?',email)).toHaveLength(1);
        await refuse(acceptedToken);
        const revokedEmail='synthetic-slate-605\x40example.test';
        await admit(revokedEmail);
        const revokedToken=token(),[revoked]=await rows('SELECT id FROM invitations WHERE email=?',revokedEmail);
        const memberCookie=await sessionFor(reader.actor.id),beforeForbidden=await snapshot();
        const forbidden=await api.request(origin+'/api/invitations/revoke',{method:'POST',headers:{cookie:memberCookie,origin,'content-type':'application/json'},body:JSON.stringify({operationKey:key('member-revoke'),id:revoked.id})},bindings);
        expect(forbidden.status).toBe(403);
        expect(await snapshot()).toEqual(beforeForbidden);
        const revokedResponse=await request('/invitations/revoke','POST',{operationKey:key('lifetime-revoke'),id:revoked.id});
        expect(revokedResponse.status).toBe(200);
        expect((await revokedResponse.json<any>()).value).toEqual({revoked:true});
        await refuse(revokedToken);
        expect(await rows('SELECT id FROM members WHERE email=?',revokedEmail)).toEqual([]);
        const expiredEmail='synthetic-slate-606\x40example.test';
        await admit(expiredEmail);
        const expiredToken=token(),[expiring]=await rows('SELECT * FROM invitations WHERE email=?',expiredEmail);
        expect(Date.parse(expiring.expires_at as string)-admittedAt).toBe(7*86400000);
        const boundaryEmail='synthetic-slate-608\x40example.test';
        await admit(boundaryEmail);
        const boundaryToken=token();
        const beforeExpiry=await snapshot();
        vi.setSystemTime(new Date(Date.parse(expiring.expires_at as string)-1));
        const stillValid=await acceptance(expiredToken,'GET');
        expect(stillValid.status).toBe(200);
        expect(await stillValid.text()).toContain('Accept invitation');
        expect(stillValid.headers.get('set-cookie')).toBeNull();
        expect(await snapshot()).toEqual(beforeExpiry);
        const lastValidAcceptance=await acceptance(boundaryToken);
        expect(lastValidAcceptance.status).toBe(303);
        const boundaryCookie=lastValidAcceptance.headers.get('set-cookie')!.split(';')[0];
        const boundaryMember=await api.request(origin+'/api/members/current',{headers:{cookie:boundaryCookie}},bindings);
        expect(boundaryMember.status).toBe(200);
        expect((await boundaryMember.json<any>()).email).toBe(boundaryEmail);
        for(const elapsed of [0,1]){
            vi.setSystemTime(new Date(Date.parse(expiring.expires_at as string)+elapsed));
            await refuse(expiredToken);
        }
        expect(await rows('SELECT * FROM invitations WHERE id=?',expiring.id)).toEqual([expiring]);
        expect(await rows('SELECT id FROM members WHERE email=?',expiredEmail)).toEqual([]);
        vi.setSystemTime(new Date(admittedAt));
        }
        await invite(reader, config, { operationKey: key('member-invite'), email: 'latecomer@qualification.invalid', kind: 'member' });
        const delivered = token();
        await removeMember(owner, { operationKey: key('remove-inviter'), memberId: reader.actor.id });
        const [{ email }] = await rows('SELECT email FROM members WHERE id=?', reader.actor.id);
        await invite(owner, config, { operationKey: key('guest-return'), email: String(email), kind: 'guest', pageId: page.value.pageId });
        await acceptInvitation(env.DB, config, token(), { files: env.FILES, jobs: env.JOBS });
        expect(await rows('SELECT status,member_kind FROM members WHERE id=?', reader.actor.id)).toEqual([{ status: 'active', member_kind: 'guest' }]);
        const origin = new URL(config.appUrl!).origin;
        const response = await createApi().request(origin + '/api/auth/invitation/accept', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: delivered }) }, env);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await rows("SELECT id FROM members WHERE email='latecomer@qualification.invalid'")).toEqual([]);
    } finally { provider.mockRestore(); }
    } finally { vi.useRealTimers(); }
});
