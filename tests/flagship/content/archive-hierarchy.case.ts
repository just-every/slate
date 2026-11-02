import {env, SELF} from 'cloudflare:test';
import {expect} from 'vitest';
import {sessionFor} from '../../e2e/setup/fixtures';
import {createUlid} from '../../../src/core/shared/ulid';

/** Native sessions archive populated trees, including database record pages. */
export async function archiveHierarchyCase(ownerId: string, viewerId: string) {
  const cookie = await sessionFor(ownerId);
  const viewer = await sessionFor(viewerId);
  const revoked = await sessionFor(ownerId, {revokedAt: new Date().toISOString()});
  const call = async (method: string, path: string, body?: object, actor: string | null = cookie) => {
    const response = await SELF.fetch(`http://localhost/api${path}`, {
      method,
      headers: {origin: 'http://localhost', 'content-type': 'application/json', ...(actor ? {cookie: actor} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    return {status: response.status, body: await response.json() as any};
  };
  const mutate = async (path: string, body: object) => {
    const result = await call('POST', path, {operationKey: createUlid(), ...body});
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
    return result.body.value;
  };
  const space = await mutate('/containers', {name: 'Archive inventory', visibility: 'private'});
  const elsewhere = await mutate('/containers', {name: 'Unrelated inventory', visibility: 'private'});
  const page = async (title: string, parentPageId?: string, containerId = space.id) => mutate('/pages', {
    containerId, title, ...(parentPageId ? {parentPageId} : {}),
    blocks: [{id: createUlid(), blockType: 'paragraph', treePosition: 'a', content: {text: [{text: title + ' retained body'}]}}],
  });
  const root = await page('Archive subtree');
  const child = await page('Nested page', root.pageId);
  const database = await mutate('/databases', {containerId: space.id, parentPageId: child.pageId, title: 'Nested database'});
  const first = await mutate(`/databases/${database.id}/records`, {title: 'First record', values: {}});
  const second = await mutate(`/databases/${database.id}/records`, {title: 'Second record', values: {}});
  const leaf = await page('Record child', first.pageId);
  const sibling = await page('Unrelated sibling');
  const external = await page('Unrelated branch', undefined, elsewhere.id);
  const externalChild = await page('Unrelated child', external.pageId, elsewhere.id);
  await mutate('/sharing', {targetKind: 'container', targetId: space.id, principalKind: 'member', principalId: viewerId, level: 'view'});
  const databaseIds = [database.pageId, first.pageId, second.pageId, leaf.pageId].sort();
  const subtreeIds = [root.pageId, child.pageId, ...databaseIds].sort();
  const containerIds = [space.homePageId, sibling.pageId, ...subtreeIds].sort();
  const sql = async (query: string, ...values: string[]) => (await env.DB.prepare(query).bind(...values).all<Record<string, any>>()).results;
  const inventory = () => sql('SELECT * FROM pages ORDER BY id');
  const state = async () => ({
    pages: await inventory(),
    containers: await sql('SELECT * FROM containers ORDER BY id'),
    locations: await sql('SELECT * FROM content_archive_locations ORDER BY page_id'),
    events: await sql('SELECT * FROM content_events ORDER BY page_id,revision_id,kind'),
    activity: await sql('SELECT * FROM activity_entries ORDER BY id'),
    receipts: await sql('SELECT * FROM operation_receipts ORDER BY id'),
  });
  const structured = await sql('SELECT * FROM database_records WHERE database_id=? ORDER BY page_id', database.id);
  const revisions = await sql('SELECT * FROM page_revisions ORDER BY id');
  const unrelated = (await inventory()).filter(row => [external.pageId, externalChild.pageId, elsewhere.homePageId].includes(row.id));
  expect((await inventory()).filter(row => row.container_id === space.id).map(row => row.id).sort()).toEqual(containerIds);

  for (const scenario of [
    {name: 'database', target: database.pageId, ids: databaseIds},
    {name: 'page', target: root.pageId, ids: subtreeIds, reason: 'Project completed.'},
    {name: 'container', target: space.id, ids: containerIds, reason: 'Space retired.'},
    {name: 'container', target: space.id, ids: containerIds},
  ]) {
    const container = scenario.name === 'container';
    const path = container ? `/containers/${space.id}/archive` : `/archive/${scenario.target}`;
    const before = await inventory();
    const target = container ? (await call('GET', `/containers/${space.id}`)).body : before.find(row => row.id === scenario.target)!;
    const expectedRevisionId = container ? target.revisionId : target.revision_id;
    const input = {operationKey: createUlid(), expectedRevisionId, ...(container ? {} : {action: 'archive'}),
      ...(scenario.reason === undefined ? {} : {reason: scenario.reason})};
    const unchanged = await state();
    for (const actor of [null, revoked, viewer]) {
      const refusal = await call('POST', path, input, actor);
      expect(refusal.status).toBe(actor === viewer ? 404 : 401);
      expect(await state()).toEqual(unchanged);
    }
    const conflict = await call('POST', path, {...input, expectedRevisionId: 'synthetic-slate-stale'});
    expect(conflict.status).toBe(409);
    expect(await state()).toEqual(unchanged);
    const started = Date.now();
    const archived = await call('POST', path, input);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const {receipt} = archived.body;
    expect(receipt.operationKey).toBe(input.operationKey);
    expect(Date.parse(receipt.committedAt)).toBeGreaterThanOrEqual(started);
    expect(Date.parse(receipt.committedAt)).toBeLessThanOrEqual(Date.now());
    const affected = before.filter(row => scenario.ids.includes(row.id));
    const after = await inventory();
    expect(after.filter(row => !scenario.ids.includes(row.id))).toEqual(before.filter(row => !scenario.ids.includes(row.id)));
    expect(after.filter(row => scenario.ids.includes(row.id))).toEqual(affected.map(row => ({...row, lifecycle: 'archived', archived_at: receipt.committedAt, updated_at: receipt.committedAt})));
    const locations = await sql('SELECT * FROM content_archive_locations ORDER BY page_id');
    expect(locations).toEqual(affected.map(row => ({page_id: row.id, prior_parent_id: row.parent_page_id, prior_container_id: row.container_id,
      prior_position: row.tree_position, prior_lifecycle: row.lifecycle, action: 'archive', actor_member_id: ownerId,
      reason: scenario.reason ?? null, occurred_at: receipt.committedAt})));
    const listed = (await call('GET', '/archive')).body.items.sort((a: any, b: any) => a.id.localeCompare(b.id));
    expect(listed.map((row: any) => row.id)).toEqual(scenario.ids);
    for (const row of affected) {
      expect(listed.find((item: any) => item.id === row.id)).toMatchObject({pageKind: row.page_kind, actorMemberId: ownerId,
        occurredAt: receipt.committedAt, archivedAt: receipt.committedAt, priorContainerId: row.container_id,
        priorParentId: row.parent_page_id, priorPosition: row.tree_position, priorLifecycle: row.lifecycle, reason: scenario.reason ?? null});
    }
    const activity = await sql('SELECT * FROM activity_entries WHERE id=?', receipt.activityId);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({actor_member_id: ownerId, occurred_at: receipt.committedAt, operation_key: input.operationKey,
      action: container ? 'containers.archive' : 'archive.archive', target_id: scenario.target});
    const rootBefore = before.find(row => row.id === scenario.target);
    expect(JSON.parse(activity[0].detail_json)).toMatchObject({reason: scenario.reason ?? null,
      priorLocation: container ? {workspaceId: target.workspaceId ?? activity[0].workspace_id}
        : {containerId: rootBefore!.container_id, parentPageId: rootBefore!.parent_page_id, position: rootBefore!.tree_position}});
    const audit = (await call('GET', `/activity?${new URLSearchParams({action: container ? 'containers.archive' : 'archive.archive'})}`)).body.items;
    expect(audit.find((item: any) => item.id === receipt.activityId)).toMatchObject({actor: {id: ownerId}, occurredAt: receipt.committedAt, operationKey: input.operationKey});
    expect(await sql("SELECT page_id FROM content_events WHERE kind='archive' AND created_at=? ORDER BY page_id", receipt.committedAt)).toEqual(scenario.ids.map(page_id => ({page_id})));
    const saved = await state();
    expect((await call('POST', path, input)).body).toEqual(archived.body);
    expect(await state()).toEqual(saved);
    expect((await call('GET', '/archive')).body.items.sort((a: any, b: any) => a.id.localeCompare(b.id))).toEqual(listed);
    expect(await sql('SELECT * FROM database_records WHERE database_id=? ORDER BY page_id', database.id)).toEqual(structured);
    expect(await sql('SELECT * FROM page_revisions ORDER BY id')).toEqual(revisions);
    expect((await inventory()).filter(row => unrelated.some(item => item.id === row.id))).toEqual(unrelated);
    const restored = await call('POST', path, {operationKey: createUlid(), expectedRevisionId: container ? archived.body.value.revisionId : expectedRevisionId,
      ...(container ? {restore: true} : {action: 'restore'})});
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect((await call('GET', '/archive')).body.items).toEqual([]);
    expect((await inventory()).filter(row => scenario.ids.includes(row.id)).map(({updated_at, ...row}) => row))
      .toEqual(affected.map(({updated_at, ...row}) => row));
    console.log(`PROBE ARCH-001 ${scenario.name}: native session archive -> ${scenario.ids.length} exact descendants, actor, time, prior locations, ${scenario.reason ? 'supplied' : 'absent'} reason, unchanged refusals and one receipt under replay`);
  }
}
