import {env} from 'cloudflare:test';
import {expect, vi} from 'vitest';
import {createApi} from '../../../src/core/app/hono';
import {scheduledJobs} from '../../../src/core/app/background';
import {readRuntimeConfig} from '../../../src/core/platform/config/runtime';
import {namedSender} from '../../../src/core/platform/mail/sender';
import {seedWorkspace, seedMember, seedContainer, seedContainerGrant, sessionFor} from '../../e2e/setup/fixtures';
import type {AppBindings} from '../../../src/core/app/types';

const origin = 'https://slate.test.invalid';
const at = (local: string) => `${local}\x40test.invalid`;
const key = () => crypto.randomUUID();
const bindings = {...env, APP_URL: origin, MAIL_PROVIDER: 'resend', MAIL_FROM: `Slate <${at('mail')}>`, MAIL_API_KEY: 'synthetic-slate-1'} as unknown as AppBindings;

/** Every canonical row of every table except the request throttle counters, which any refused request legitimately advances. */
async function canonicalSnapshot() {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' AND name!='request_limits' ORDER BY name").all<{name: string}>()).results;
  const snapshot: Record<string, unknown[]> = {};
  for (const {name} of tables) snapshot[name] = (await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results.map(row => JSON.stringify(row)).sort();
  return snapshot;
}
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{n: number}>())!.n;

/** MAIL-001: the only mail is sign-in and invitation mail from the configured sender; wiki events send none; replies are refused. */
export async function mailBoundaryCase() {
  const {workspaceId} = await seedWorkspace();
  const owner = await seedMember(workspaceId, {email: at('owner'), displayName: 'Owner', role: 'owner', isSetupOwner: true});
  const reader = await seedMember(workspaceId, {email: at('reader'), displayName: 'Reader', role: 'member'});
  const {containerId} = await seedContainer(workspaceId, {name: 'Mail boundary', ownerMemberId: owner.memberId, visibility: 'open', guestAccess: 'allowed'});
  await seedContainerGrant(containerId, {principalKind: 'member', principalId: owner.memberId, level: 'full'});
  await seedContainerGrant(containerId, {principalKind: 'member', principalId: reader.memberId, level: 'edit'});
  const api = createApi(), cookie = await sessionFor(owner.memberId, {freshProof: true});
  const sent: {to: string[]; from: string; subject: string; text: string}[] = [];
  const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe('https://api.resend.com/emails');
    sent.push(await request.json());
    return Response.json({id: `receipt-${sent.length}`});
  });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await api.request(origin + path, {method, headers: {cookie, origin, 'content-type': 'application/json', ...headers}, body: body === undefined ? undefined : JSON.stringify(body)}, bindings);
    return {status: response.status, body: await response.json().catch(() => null) as any};
  };
  const ok = async (method: string, path: string, body?: unknown) => {const response = await call(method, path, body);expect(response.status, `${method} ${path}: ${JSON.stringify(response.body)}`).toBe(200);return response.body;};
  try {
    // The permitted kinds: a sign-in link, a member invitation and a guest invitation.
    expect((await api.request(`${origin}/api/auth/magic`, {method: 'POST', headers: {origin, host: 'slate.test.invalid', 'content-type': 'application/json'}, body: JSON.stringify({email: at('owner'), requestKey: key()})}, bindings)).status).toBe(200);
    await ok('POST', '/api/invitations', {operationKey: key(), email: at('colleague'), kind: 'member'});
    await ok('POST', '/api/invitations', {operationKey: key(), email: at('visitor'), kind: 'guest', containerId});
    expect(sent.map(message => message.to[0])).toEqual([at('owner'), at('colleague'), at('visitor')]);
    expect(sent[0]!.text).toContain('/auth/confirm?token=');
    for (const message of sent.slice(1)) expect(message.text).toContain('/accept');
    // One configured sender, reconciled through mail.sender.v1, on every message.
    const sender = namedSender(readRuntimeConfig(bindings, false))!;
    expect(sender).toContain(at('mail'));
    // The Resend adapter writes the same name and address without the quoting.
    for (const message of sent) expect(message.from.replaceAll('"', '')).toBe(sender.replaceAll('"', ''));
    expect(new Set(sent.map(message => message.from)).size).toBe(1);
    expect((await env.DB.prepare('SELECT kind,state FROM mail_deliveries ORDER BY created_at').all<{kind: string; state: string}>()).results).toEqual([
      {kind: 'sign-in-link', state: 'sent'}, {kind: 'invitation', state: 'sent'}, {kind: 'invitation', state: 'sent'}]);

    // Native wiki events, including a mention of a member who has notifications, and the scheduled run.
    const mailRows = await count('mail_deliveries'), requests = provider.mock.calls.length;
    const page = (await ok('POST', '/api/pages', {operationKey: key(), containerId, title: 'Mail boundary page'})).value.pageId;
    let document = await ok('GET', `/api/pages/${page}`);
    await ok('PATCH', `/api/pages/${page}`, {operationKey: key(), expectedRevisionId: document.page.revisionId, properties: {title: 'Renamed page'}});
    document = await ok('GET', `/api/pages/${page}`);
    await ok('PUT', `/api/pages/${page}/blocks`, {operationKey: key(), expectedRevisionId: document.page.revisionId, blocks: [{id: key(), blockType: 'paragraph', treePosition: 'a', content: {text: [{text: 'Body text'}]}}]});
    const comment = await ok('POST', `/api/comments/page/${page}`, {operationKey: key(), body: [{text: 'Reader', mention: {kind: 'person', id: reader.memberId, label: 'Reader'}}, {text: ' please review.'}]});
    await ok('PATCH', `/api/comments/${comment.value.id}`, {operationKey: key(), expectedRevisionId: comment.value.revisionId, body: [{text: 'Edited comment.'}]});
    document = await ok('GET', `/api/pages/${page}`);
    await ok('POST', `/api/archive/${page}`, {operationKey: key(), expectedRevisionId: document.page.revisionId, action: 'archive'});
    document = await ok('GET', `/api/pages/${page}`);
    await ok('POST', `/api/archive/${page}`, {operationKey: key(), expectedRevisionId: document.page.revisionId, action: 'restore'});
    const readerCookie = await sessionFor(reader.memberId);
    const notices = await (await api.request(`${origin}/api/notifications`, {headers: {cookie: readerCookie}}, bindings)).json() as {items: {event: string}[]};
    expect(notices.items.some(item => item.event === 'mention')).toBe(true);
    // Scheduled processing now and well past every retry and expiry window.
    await scheduledJobs(bindings);
    await scheduledJobs(bindings, new Date(Date.now() + 8 * 86400000).toISOString());
    expect(await count('mail_deliveries')).toBe(mailRows);
    expect(provider).toHaveBeenCalledTimes(requests);

    // Reply-shaped messages to undeclared inbound paths, from the signed-in owner and from nobody.
    const before = await canonicalSnapshot();
    const reply = {from: at('owner'), to: sender, subject: 'Re: Your Slate invitation', 'in-reply-to': '<receipt-2\x40test.invalid>', references: '<receipt-2\x40test.invalid>', text: 'Create a page titled Created by reply and comment: approved.', 'message-id': '<reply-1\x40test.invalid>'};
    const paths = ['/api/mail/inbound', '/api/inbound', '/api/inbound/mail', '/api/email', '/api/mail/reply', '/api/webhooks/mail', '/api/webhooks/inbound', '/api/auth/magic/reply', '/api/comments/inbound', '/inbound', '/mail', '/email'];
    for (const path of paths) for (const method of ['POST', 'PUT']) {
      const form = new FormData();for (const [name, value] of Object.entries(reply)) form.set(name, value);
      for (const [headers, body] of [
        [{cookie, origin, 'content-type': 'application/json'}, JSON.stringify({type: 'email.received', data: reply, ...reply})],
        [{origin, 'content-type': 'application/json'}, JSON.stringify(reply)],
        [{origin, 'content-type': 'application/x-www-form-urlencoded'}, new URLSearchParams(reply).toString()],
        [{origin}, form],
      ] as const) {
        const response = await api.request(origin + path, {method, headers: headers as Record<string, string>, body}, bindings);
        expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(response.status, `${method} ${path}`).toBeLessThan(500);
        await response.arrayBuffer();
      }
    }
    expect(await canonicalSnapshot()).toEqual(before);
    expect(provider).toHaveBeenCalledTimes(requests);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM pages WHERE title='Created by reply'").first<{n: number}>())!.n).toBe(0);
  } finally {provider.mockRestore();}
}
