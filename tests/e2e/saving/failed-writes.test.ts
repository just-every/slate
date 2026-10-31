import { SELF } from 'cloudflare:test';
import { beforeEach, expect } from 'vitest';
import { contract } from '../contract';
import { resetDeployment } from '../setup/reset-deployment';
import { seedWorkspace, seedMember, seedContainer, seedContainerGrant, sessionFor } from '../setup/fixtures';

beforeEach(resetDeployment);
contract('SAVE-002', 'refused title and block writes preserve committed data and a corrected retry commits once', async () => {
  const { workspaceId } = await seedWorkspace();
  const { memberId } = await seedMember(workspaceId, { role: 'owner', email: ['owner', 'slate.test'].join('@'), displayName: 'Alex Owner' });
  const { containerId } = await seedContainer(workspaceId, { ownerMemberId: memberId, visibility: 'private' });
  await seedContainerGrant(containerId, { principalKind: 'member', principalId: memberId, level: 'full' });
  const cookie = await sessionFor(memberId);
  const request = async (method: string, path: string, body?: unknown, actorCookie = cookie) => {
    const response = await SELF.fetch(`https://slate.test/api${path}`, { method, headers: { cookie: actorCookie, origin: 'https://slate.test', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json<any>() };
  };
  const blockId = crypto.randomUUID();
  const created = await request('POST', '/pages', { operationKey: crypto.randomUUID(), containerId, title: 'On-call guide', blocks: [{ id: blockId, blockType: 'paragraph', treePosition: '1', content: { text: [{ text: 'Contact the on-call lead.' }] } }] });
  expect(created.status).toBe(200);
  const pageId = created.data.value.pageId, route = `/pages/${pageId}`;
  const before = (await request('GET', route)).data;
  const titleAttempt = { operationKey: crypto.randomUUID(), expectedRevisionId: before.page.revisionId, properties: { title: 'Guide '.repeat(200) } };
  const blockAttempt = { operationKey: crypto.randomUUID(), expectedRevisionId: before.blocks[0].revisionId, content: { text: 'invalid rich text' } };
  for (const [path, body] of [[route, titleAttempt], [`${route}/blocks/${blockId}`, blockAttempt]] as const) {
    expect((await request('PATCH', path, body)).status).toBe(400);
    expect((await request('GET', route)).data).toEqual(before);
  }
  const corrected = { ...titleAttempt, properties: { title: 'On-call escalation guide' } };
  const saved = await request('PATCH', route, corrected);
  expect(saved.status).toBe(200);
  expect((await request('PATCH', route, corrected)).data).toEqual(saved.data);
  const read = (await request('GET', route)).data;
  expect(read.page.title).toBe(corrected.properties.title);
  expect(read.blocks).toEqual(before.blocks);
  expect(read.page.revisionId).toBe(saved.data.value.revisionId);
  // The other writer owns a genuinely separate native member session.
  const other = await seedMember(workspaceId, { role: 'member', email: ['morgan', 'slate.test'].join('@'), displayName: 'Morgan Member' });
  await seedContainerGrant(containerId, { principalKind: 'member', principalId: other.memberId, level: 'edit' });
  const otherCookie = await sessionFor(other.memberId);
  const tree = (document: any) => document.blocks.map(({ id, blockType, content, parentBlockId, treePosition }: any) => ({ id, blockType, content, parentBlockId, treePosition }));
  for (const kind of ['body', 'title', 'property', 'structure', 'order']) {
    const starting = (await request('GET', route)).data;
    const make = (document: any) => {
      if (kind === 'body') return { operationKey: crypto.randomUUID(), expectedRevisionId: document.blocks[0].revisionId, content: { text: [{ text: 'Alex explicitly resolved the body.' }] } };
      if (kind === 'title' || kind === 'property') return { operationKey: crypto.randomUUID(), expectedRevisionId: document.page.revisionId, properties: kind === 'title' ? { title: 'Alex resolved title' } : { labels: ['incident-resolved'], typeface: 'serif' } };
      const choices = tree(document);
      if (kind === 'structure') choices.push({ id: crypto.randomUUID(), blockType: 'paragraph', content: { text: [{ text: 'Alex added a retained block.' }] }, parentBlockId: null, treePosition: '2' });
      else choices.reverse().forEach((block: any, index: number) => { block.treePosition = String(index); });
      return { operationKey: crypto.randomUUID(), expectedRevisionId: document.page.revisionId, blocks: choices, blockRevisions: Object.fromEntries(document.blocks.map((block: any) => [block.id, block.revisionId])) };
    };
    const method = kind === 'structure' || kind === 'order' ? 'PUT' : 'PATCH';
    const path = kind === 'body' ? `${route}/blocks/${blockId}` : method === 'PUT' ? `${route}/blocks` : route;
    const stale = make(starting);
    const competing = await request('PATCH', `${route}/blocks/${blockId}`, { operationKey: crypto.randomUUID(), expectedRevisionId: starting.blocks.find((block: any) => block.id === blockId).revisionId, content: { text: [{ text: `Morgan committed before stale ${kind}.` }] } }, otherCookie);
    expect(competing.status).toBe(200);
    const canonical = (await request('GET', route)).data;
    const beforeHistory = (await request('GET', `/revisions/${pageId}`)).data;
    const beforeActivity = (await request('GET', '/activity?limit=100')).data;
    expect((await request(method, path, stale)).status).toBe(409);
    expect((await request('GET', route)).data).toEqual(canonical);
    expect((await request('GET', `/revisions/${pageId}`)).data).toEqual(beforeHistory);
    expect((await request('GET', '/activity?limit=100')).data).toEqual(beforeActivity);
    const resolution = await request(method, path, make(canonical));
    expect(resolution.status).toBe(200);
    const final = (await request('GET', route)).data;
    expect(final.page.revisionId).toBe(resolution.data.value.revisionId);
    const retained = (await request('GET', `/revisions/${pageId}/${competing.data.value.revisionId}`)).data;
    expect(JSON.stringify(retained.blocks)).toContain(`Morgan committed before stale ${kind}.`);
    const resolved = (await request('GET', `/revisions/${pageId}/${resolution.data.value.revisionId}`)).data;
    expect(resolved.blocks).toEqual(final.blocks);
    if (kind === 'body') expect(JSON.stringify(final.blocks)).toContain('Alex explicitly resolved the body.');
    else expect(JSON.stringify(final.blocks)).toContain(`Morgan committed before stale ${kind}.`);
    if (kind === 'title') expect(final.page.title).toBe('Alex resolved title');
    if (kind === 'property') expect(final.properties.labels).toEqual(['incident-resolved']);
    if (kind === 'structure') expect(final.blocks).toHaveLength(canonical.blocks.length + 1);
    if (kind === 'order') expect(final.blocks.map((block: any) => block.id)).toEqual(canonical.blocks.map((block: any) => block.id).reverse());
  }

});
