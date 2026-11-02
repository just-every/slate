import {referenceStateJourney} from './reference-state-journey';
import {env} from 'cloudflare:test';
import {expect, test} from 'vitest';
import {strFromU8, unzipSync} from 'fflate';
import {createApi} from '../../../src/core/app/hono';
import {createUlid} from '../../../src/core/shared/ulid';
import {seedContainer, seedContainerGrant, seedMember, seedWorkspace, sessionFor} from '../../e2e/setup/fixtures';

/**
 * LINK-004 through the public routes, in the flagship profile with AI off: Bob reads
 * an index page that mentions a supplier page in its body, a comment, an inline comment
 * quote, a suggestion and a template, and Carol, who may edit the index, is refused a
 * stale save over that body by the HTTP routes and the live room. Once his grant on the supplier page is removed, and again once a
 * later grant expires, no door that hands him that content names the supplier page.
 */
test('LINK-004 — a mentioned page title reaches a reader through no door once their access is removed or expired', async () => {
  const api = createApi(), origin = 'https://slate.test';
  const {workspaceId} = await seedWorkspace();
  const {memberId: alice} = await seedMember(workspaceId, {role: 'owner', email: [`alice-${workspaceId}`, 'example.test'].join('@'), displayName: 'Alice Owner'});
  const {memberId: bob} = await seedMember(workspaceId, {role: 'member', email: [`bob-${workspaceId}`, 'example.test'].join('@'), displayName: 'Bob Reader'});
  const {memberId: carol} = await seedMember(workspaceId, {role: 'member', email: [`carol-${workspaceId}`, 'example.test'].join('@'), displayName: 'Carol Editor'});
  const aliceCookie = await sessionFor(alice,{freshProof:true}), bobCookie = await sessionFor(bob), carolCookie = await sessionFor(carol);
  const call = async (cookie: string | null, method: string, path: string, body?: unknown) => {
    const response = await api.request(path.startsWith('http') ? path : origin + path, {method, headers: {...(cookie ? {cookie} : {}), ...(body ? {'content-type': 'application/json', origin} : {})}, ...(body ? {body: JSON.stringify(body)} : {})}, env);
    return {status: response.status, type: response.headers.get('content-type') ?? '', bytes: new Uint8Array(await response.arrayBuffer())};
  };
  const ok = async (cookie: string, method: string, path: string, body?: unknown) => {
    const result = await call(cookie, method, path, body);
    const text = strFromU8(result.bytes);
    expect(result.status, `${method} ${path}: ${text.slice(0, 300)}`).toBeLessThan(300);
    return JSON.parse(text);
  };
  const key = () => crypto.randomUUID();

  const {containerId: shared} = await seedContainer(workspaceId, {ownerMemberId: alice, visibility: 'closed'});
  await seedContainerGrant(shared, {principalKind: 'member', principalId: alice, level: 'full'});
  await seedContainerGrant(shared, {principalKind: 'member', principalId: bob, level: 'view'});
  await seedContainerGrant(shared, {principalKind: 'member', principalId: carol, level: 'edit'});
  const {containerId: closed} = await seedContainer(workspaceId, {ownerMemberId: alice, visibility: 'closed'});
  await seedContainerGrant(closed, {principalKind: 'member', principalId: alice, level: 'full'});

  const title = `Supplier contacts ${key().slice(0, 8)}`;
  const supplier = (await ok(aliceCookie, 'POST', '/api/pages', {operationKey: key(), containerId: closed, title})).value.pageId as string;
  const anchorId = key();
  const mention = (text: string, anchored = false) => ({text: [{text: `${text} `}, {text: title, mention: {kind: 'page', id: supplier, label: title}}, {text: ' tonight.'}].map(span => anchored ? {...span, commentAnchorId: anchorId} : span)});
  const blockId = key(), quote = `Call ${title} tonight.`;
  const index = (await ok(aliceCookie, 'POST', '/api/pages', {operationKey: key(), containerId: shared, title: 'Index', blocks: [
    {id: blockId, blockType: 'paragraph', content: mention('Call', true), treePosition: 'a0'},
    {id:key(),blockType:'paragraph',content:{text:[{text:title,link:{href:`/app/pages/${supplier}`}},{text:title,link:{href:`${origin}/app/pages/${supplier}`}}]},treePosition:'a1'},
    {id:key(),blockType:'link-card',content:{url:`/app/pages/${supplier}`,display:'card',previewState:'ready',preview:{title,description:title,iconLabel:title}},treePosition:'a2'},
  ]})).value.pageId as string;
  let document = await ok(aliceCookie, 'GET', `/api/pages/${index}`);
  const first = document.page.revisionId as string;
  await ok(aliceCookie, 'POST', `/api/comments/page/${index}`, {operationKey: key(), kind: 'page', body: mention('Check').text});
  await ok(aliceCookie, 'POST', `/api/comments/page/${index}`, {operationKey: key(), kind: 'inline', blockId, anchor: {anchorId, quote}, anchorRevisionId: first, body: [{text: 'Which number?'}]});
  await ok(aliceCookie, 'POST', `/api/suggestions/page/${index}`, {operationKey: key(), expectedRevisionId: document.page.revisionId, blocks: [{...document.blocks[0], content: mention('Phone')}]});
  const template = (await ok(aliceCookie, 'POST', '/api/templates', {operationKey: key(), sourcePageId: index, includeChildren: false, containerId: shared, title: 'Index template', description: '', category: 'Team'})).value.id as string;
  document = await ok(aliceCookie, 'GET', `/api/pages/${index}`);
  const working = document.workingRevisionId as string;
  const host = env.PUBLIC_PAGE_HOST, slug = `index-${key().slice(0, 8)}`;
  await ok(aliceCookie, 'POST', `/api/publishing/${index}`, {operationKey: key(), expectedRevisionId: document.page.revisionId, host, slug, indexable: false, theme: 'default', headerControls: [], duplicateAsTemplate: false, socialPreview: {}, revoke: false});

  /** The same stale save sent through the live room's socket as Carol: the room's error message. */
  const socketConflict = async () => {
    const rooms = (env as unknown as {CONTENT_COLLABORATION: DurableObjectNamespace}).CONTENT_COLLABORATION;
    const response = await rooms.get(rooms.idFromName(index)).fetch(`https://local.test/socket?pageId=${index}`, {headers: {Upgrade: 'websocket', cookie: carolCookie}});
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    const error = new Promise<Record<string, any>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No error message from the room')), 4000);
      socket.addEventListener('message', event => { const message = JSON.parse(String(event.data)); if (message.type === 'error') { clearTimeout(timer); resolve(message); } });
    });
    socket.send(JSON.stringify({type: 'edit', blockId, operationKey: key(), expectedRevisionId: createUlid(), content: {text: [{text: 'Unsaved'}]}}));
    const message = await error;
    socket.close();
    expect(message.code).toBe('BLOCK_CONFLICT');
    return JSON.stringify(message);
  };

  /** Every door that returns the index page's text, as Bob (and the public page as anyone), plus Carol's refused saves. */
  const doors = async () => {
    const seen: Record<string, string> = {};
    const json = async (name: string, method: string, path: string, body?: unknown) => { seen[name] = JSON.stringify(await ok(bobCookie, method, path, body)); };
    await json('page', 'GET', `/api/pages/${index}`);
    await json('collaboration', 'GET', `/api/collaboration/${index}`);
    // Carol (edit) saves over a block that changed since she loaded it: the refusal carries the saved text.
    const refused = async (method: string, path: string, body: unknown) => {
      const result = await call(carolCookie, method, path, body), text = strFromU8(result.bytes);
      expect(result.status, `${method} ${path}: ${text.slice(0, 300)}`).toBe(409);
      expect(JSON.parse(text).code).toBe('BLOCK_CONFLICT');
      return text;
    };
    seen.blockConflict = await refused('PATCH', `/api/pages/${index}/blocks/${blockId}`, {operationKey: key(), expectedRevisionId: createUlid(), content: {text: [{text: 'Unsaved'}]}});
    seen.replaceConflict = await refused('PUT', `/api/pages/${index}/blocks`, {operationKey: key(), expectedRevisionId: working, blocks: [{id: blockId, blockType: 'paragraph', content: {text: [{text: 'Unsaved'}]}, treePosition: 'a0'}], blockRevisions: {[blockId]: createUlid()}});
    seen.socketConflict = await socketConflict();
    await json('revision', 'GET', `/api/revisions/${index}/${working}`);
    await json('compare', 'GET', `/api/revisions/${index}/compare/${first}/${working}`);
    await json('comments', 'GET', `/api/comments/page/${index}`);
    await json('suggestions', 'GET', `/api/suggestions/page/${index}`);
    await json('template', 'GET', `/api/templates/${template}`);
    await json('search', 'GET', `/api/search?q=${encodeURIComponent(title)}`);
    seen.search = JSON.stringify(JSON.parse(seen.search!).items);
    await json('notifications', 'GET', '/api/notifications');
    await json('aiEvidence', 'POST', '/api/ai/evidence', {refs: [{kind: 'page', sourceId: index, revisionId: working}]});
    const exported = await call(bobCookie, 'POST', '/api/exports/readable', {scope: 'page', id: index, format: 'markdown'});
    expect(exported.status).toBe(200);
    seen.export = Object.values(unzipSync(exported.bytes)).map(bytes => strFromU8(bytes)).join('\n');
    const published = await call(null, 'GET', `http://${host}/p/${slug}`);
    seen.public = `${published.status} ${strFromU8(published.bytes)}`;
    return seen;
  };
  const leaks = (seen: Record<string, string>) => Object.entries(seen).filter(([, text]) => text.includes(title)).map(([door]) => door);

  // While Bob may open the supplier page, the doors that show a mention's label name it.
  const give = async (member: string, expiresAt?: string) => (await ok(aliceCookie, 'POST', '/api/sharing', {operationKey: key(), targetKind: 'page', targetId: supplier, principalKind: 'member', principalId: member, level: 'view', ...(expiresAt ? {expiresAt} : {})})).value.id as string;
  const take = (member: string, id: string) => ok(aliceCookie, 'POST', '/api/sharing', {operationKey: key(), targetKind: 'page', targetId: supplier, id, principalKind: 'member', principalId: member, level: 'view', revoke: true});
  const quoteSeen = (seen: Record<string, string>) => (JSON.parse(seen.comments!).threads as {anchor_json: string | null}[]).map(t => JSON.parse(t.anchor_json ?? '{}').quote).filter(Boolean);
  const grant = await give(bob), carolGrant = await give(carol);
  const granted = await doors();
  expect(granted.aiEvidence).toContain(title);
  expect(granted.page).toContain(title);
  // With access, the refused saves carry the saved text and the inline quote stays as written.
  for (const door of ['blockConflict', 'replaceConflict', 'socketConflict']) expect(granted[door], door).toContain(title);
  expect(quoteSeen(granted)).toEqual([quote]);

  await take(bob, grant);
  await take(carol, carolGrant);
  const removed = await doors();
  expect(leaks(removed)).toEqual([]);
  expect(removed.aiEvidence).toContain('Restricted page');
  for (const door of ['blockConflict', 'replaceConflict', 'socketConflict']) expect(removed[door], door).toContain('Restricted page');
  expect(quoteSeen(removed)).toEqual(['Call Restricted page tonight.']);
  expect(removed.public).toMatch(/^200 /);

  const soon = new Date(Date.now() + 3_600_000).toISOString(), regrant = await give(bob, soon), carolRegrant = await give(carol, soon);
  const regranted = await doors();
  expect(regranted.aiEvidence).toContain(title);
  for (const door of ['blockConflict', 'replaceConflict', 'socketConflict']) expect(regranted[door], door).toContain(title);
  expect(quoteSeen(regranted)).toEqual([quote]);
  for (const id of [regrant, carolRegrant]) await env.DB.prepare('UPDATE page_grants SET expires_at=? WHERE id=?').bind(new Date(Date.now() - 1000).toISOString(), id).run();
  const expired = await doors();
  expect(leaks(expired)).toEqual([]);
  expect(quoteSeen(expired)).toEqual(['Call Restricted page tonight.']);
  await referenceStateJourney(ok,async (cookie,method,path,body)=>{const result=await call(cookie,method,path,body);return {status:result.status,body:JSON.parse(strFromU8(result.bytes))};},aliceCookie,bobCookie,bob,closed,origin,{cookie:carolCookie,id:carol});
});
