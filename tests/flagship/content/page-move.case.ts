import { expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createApi } from '../../../src/core/app/hono';
import { createUlid } from '../../../src/core/shared/ulid';
import { seedWorkspace, seedMember, sessionFor } from '../../e2e/setup/fixtures';

/** Native sessions and routes, including captured confirmations after authority changes. */
export async function pageMoveCase() {
  const { workspaceId } = await seedWorkspace();
  const members = await Promise.all(['owner', 'editor', 'source', 'destination'].map(async name => ({
    name, ...(await seedMember(workspaceId, { role: name === 'owner' ? 'owner' : 'member', displayName: name, email: [name, 'test.invalid'].join('@') })),
  })));
  const cookies = new Map(await Promise.all(members.map(async member => [member.name, await sessionFor(member.memberId)] as const)));
  const app = createApi(), origin = new URL(String(env.APP_URL)).origin;
  const call = async (who: string, method: string, route: string, body?: unknown) => {
    const response = await app.request(origin + '/api' + route, {
      method, headers: { cookie: cookies.get(who)!, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
    return { status: response.status, data: await response.json<any>() };
  };
  const ok = async (who: string, method: string, route: string, body?: unknown) => {
    const result = await call(who, method, route, body);
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    return result.data;
  };
  const share = async (targetKind: string, targetId: string, name: string, level: string, id?: string) =>
    ok('owner', 'POST', '/sharing', { operationKey: createUlid(), targetKind, targetId, principalKind: 'member', principalId: members.find(member => member.name === name)!.memberId, level, ...(id ? { id } : {}) });
  const spaces = [];
  for (const name of ['Source', 'Destination']) spaces.push((await ok('owner', 'POST', '/containers', { operationKey: createUlid(), name, visibility: 'private' })).value.id);
  const [source, destination] = spaces;
  const sourceGrant = await share('container', source, 'editor', 'edit');
  const destinationGrant = await share('container', destination, 'editor', 'edit');
  await share('container', source, 'source', 'view');
  await share('container', destination, 'destination', 'view');
  const nodes: { id: string; parent: string | null; blockId: string; text: string }[] = [];
  for (const [name, parentIndex] of [['Root', -1], ['Left', 0], ['Right', 0], ['Leaf', 1]] as const) {
    const parent = parentIndex < 0 ? null : nodes[parentIndex]!.id, blockId = createUlid(), text = `Retained ${name} body`;
    const created = await ok('owner', 'POST', '/pages', { operationKey: createUlid(), containerId: source, parentPageId: parent, title: name, blocks: [{ id: blockId, blockType: 'paragraph', content: { text: [{ text }] }, treePosition: 'a' }] });
    const id = created.value.pageId;
    await ok('owner', 'POST', `/comments/page/${id}`, { operationKey: createUlid(), kind: 'inline', blockId, anchorRevisionId: created.value.revisionId, anchor: { anchorId: createUlid(), quote: text }, body: [{ text: `Retained ${name} comment` }] });
    nodes.push({ id, parent, blockId, text });
  }
  const root = nodes[0]!.id;
  const before = new Map();
  for (const node of nodes) {
    const history = (await ok('owner', 'GET', `/revisions/${node.id}`)).items;
    before.set(node.id, {
      document: await ok('owner', 'GET', `/pages/${node.id}`),
      comments: await ok('owner', 'GET', `/comments/page/${node.id}`), history,
      snapshots: await Promise.all(history.map(async (version: { id: string }) => [version.id, await ok('owner', 'GET', `/revisions/${node.id}/${version.id}`)])),
    });
  }
  const placement = { containerId: destination, parentPageId: null, atEnd: true };
  const preview = await ok('editor', 'POST', `/pages/${root}/move-preview`, placement);
  expect(preview.changes).toEqual(expect.arrayContaining(nodes.flatMap(node => [
    { pageId: node.id, memberId: members[2]!.memberId, before: 'view', after: null },
    { pageId: node.id, memberId: members[3]!.memberId, before: null, after: 'view' },
  ])));
  const confirmation = { operationKey: createUlid(), expectedRevisionId: before.get(root).document.page.revisionId, ...placement, accessPreviewHash: preview.accessPreviewHash, orderPreviewHash: preview.orderPreviewHash };
  const stored = async () => {
    const result: Record<string, unknown> = {};
    for (const table of ['pages', 'page_blocks', 'page_revisions', 'comment_threads', 'comments', 'operation_receipts', 'activity_entries']) {
      result[table] = (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
    }
    return result;
  };
  const unchangedRefusal = async (input: typeof confirmation, code: string) => {
    const snapshot = await stored();
    const refused = await call('editor', 'POST', `/pages/${root}/move`, input);
    expect(refused.status).toBe(code === 'NOT_FOUND' ? 404 : 409);
    expect(refused.data.code).toBe(code);
    expect(await stored()).toEqual(snapshot);
  };
  await unchangedRefusal({ ...confirmation, accessPreviewHash: 'wrong' }, 'ACCESS_PREVIEW_CHANGED');
  // A real grant edit invalidates the previously reviewed audience.
  const extra = await share('page', root, 'source', 'comment');
  await unchangedRefusal(confirmation, 'ACCESS_PREVIEW_CHANGED');
  await ok('owner', 'POST', '/sharing', { operationKey: createUlid(), targetKind: 'page', targetId: root, id: extra.value.id, principalKind: 'member', principalId: members[2]!.memberId, level: 'comment', revoke: true });
  // Source and destination authority are independently rechecked on confirmation.
  for (const [space, grant] of [[source, sourceGrant], [destination, destinationGrant]]) {
    await share('container', space, 'editor', 'view', grant.value.id);
    await unchangedRefusal(confirmation, 'NOT_FOUND');
    expect((await call('editor', 'POST', `/pages/${root}/move-preview`, placement)).status).toBe(404);
    await share('container', space, 'editor', 'edit', grant.value.id);
  }
  const current = await ok('editor', 'POST', `/pages/${root}/move-preview`, placement);
  const input = { ...confirmation, accessPreviewHash: current.accessPreviewHash, orderPreviewHash: current.orderPreviewHash };
  const moved = await ok('editor', 'POST', `/pages/${root}/move`, input);
  expect(moved.receipt.entity.id).toBe(root);
  expect(await ok('editor', 'POST', `/pages/${root}/move`, input)).toEqual(moved);
  for (const node of nodes) {
    const retained = before.get(node.id), document = await ok('destination', 'GET', `/pages/${node.id}`);
    expect(document.page.containerId).toBe(destination);
    expect(document.parentPageId).toBe(node.parent);
    expect(document.blocks).toEqual(retained.document.blocks);
    expect(document.properties).toEqual(retained.document.properties);
    expect((await call('source', 'GET', `/pages/${node.id}`)).status).toBe(404);
    expect(await ok('owner', 'GET', `/comments/page/${node.id}`)).toEqual(retained.comments);
    const history = (await ok('owner', 'GET', `/revisions/${node.id}`)).items;
    expect(history).toEqual(expect.arrayContaining(retained.history));
    for (const [id, snapshot] of retained.snapshots) expect(await ok('owner', 'GET', `/revisions/${node.id}/${id}`)).toEqual(snapshot);
  }
  await share('container', destination, 'editor', 'view', destinationGrant.value.id);
  await unchangedRefusal(input, 'NOT_FOUND');
  // Member inheritance is an edit; a changed public exposure still needs full access.
  await share('container', destination, 'editor', 'edit', destinationGrant.value.id);
  for (const [id, publicAccess] of [[destination, 'allowed'], [source, 'forbidden']]) {
    const container = await ok('owner', 'GET', `/containers/${id}`);
    await ok('owner', 'POST', '/sharing/container-settings', { operationKey: createUlid(), id, expectedRevisionId: container.revisionId, visibility: container.visibility, guestAccess: container.guestAccess, publicLinkAccess: publicAccess, anonymousAccess: publicAccess });
  }
  const document = await ok('owner', 'GET', `/pages/${root}`);
  await ok('owner', 'POST', `/publishing/${root}`, { operationKey: createUlid(), expectedRevisionId: document.page.revisionId, host: (env as unknown as { PUBLIC_PAGE_HOST: string }).PUBLIC_PAGE_HOST, slug: `synthetic-slate-${root}` });
  const reverse = { containerId: source, parentPageId: null, atEnd: true }, snapshot = await stored();
  expect((await call('editor', 'POST', `/pages/${root}/move-preview`, reverse)).status).toBe(404);
  const publicPreview = await ok('owner', 'POST', `/pages/${root}/move-preview`, reverse);
  expect(publicPreview.changes).toEqual(expect.arrayContaining([
    { pageId: root, memberId: null, audience: 'public-link', before: 'view', after: null },
    { pageId: root, memberId: null, before: 'view', after: null },
  ]));
  expect(await stored()).toEqual(snapshot);
}
