import { expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createUlid } from '../../../src/core/shared/ulid';

type Fixture = { a: string; b: string; containerId: string; request: (method: string, path: string, body?: unknown, actor?: string) => Promise<{status: number; data: any}> };
/** Populated native page, database and container restores share one retained-content comparison. */
export async function archiveRestoreCase(f: Fixture) {
  const op = createUlid;
  const ok = async (method: string, path: string, body?: unknown, actor = f.a) => {
    const response = await f.request(method, path, body, actor);
    expect(response.status, JSON.stringify(response.data)).toBeLessThan(300);
    return response.data;
  };
  await ok('POST', '/api/status', {operationKey: op(), key: 'synthetic-slate-ready', label: 'Ready', color: '#245678', requiresVerification: false});
  const page = async (title: string, parentPageId?: string, treePosition = title) => (await ok('POST', '/api/pages', {
    operationKey: op(), containerId: f.containerId, parentPageId, treePosition, title,
    properties: {statusKey: 'synthetic-slate-ready'},
    blocks: [{id: op(), blockType: 'paragraph', treePosition: '1', content: {text: [{text: `Retained ${title}`} ]}}],
  })).value.pageId as string;
  const parent = await page('Restore location'), before = await page('Before', parent, '10');
  const root = await page('Restore subtree', parent, '20'), after = await page('After', parent, '30');
  const child = await page('Nested child', root);
  const db = (await ok('POST', '/api/databases', {operationKey: op(), containerId: f.containerId, parentPageId: root, title: 'Retained database'})).value;
  await ok('POST', `/api/databases/${db.id}/fields`, {operationKey: op(), expectedRevisionId: db.revisionId, field: {id: 'points', name: 'Points', type: 'number', config: {}, position: 0}});
  const record = (await ok('POST', `/api/databases/${db.id}/records`, {operationKey: op(), title: 'Retained record', values: {points: 42}})).value.pageId;
  const ids = [root, child, db.pageId, record];
  for (const id of ids) {
    const doc = await ok('GET', `/api/pages/${id}`);
    await ok('PATCH', `/api/pages/${id}`, {operationKey: op(), expectedRevisionId: doc.page.revisionId, properties: {title: doc.page.title + ' revised'}});
    await ok('POST', `/api/comments/page/${id}`, {operationKey: op(), body: [{text: `Retained comment ${id}`}]});
    await ok('POST', '/api/sharing', {operationKey: op(), targetKind: 'page', targetId: id, principalKind: 'member', principalId: f.b, level: 'view'});
  }
  const retained = async () => {
    const marks = ids.map(() => '?').join(',');
    const rows = async (sql: string) => (await env.DB.prepare(sql).bind(...ids).all()).results;
    return {
      pages: await rows(`SELECT id,container_id,parent_page_id,database_id,page_kind,title,lifecycle,working_revision_id,published_revision_id,status_key,tree_position,revision_id FROM pages WHERE id IN (${marks}) ORDER BY id`),
      blocks: await rows(`SELECT * FROM page_blocks WHERE page_id IN (${marks}) ORDER BY id`),
      revisions: await rows(`SELECT * FROM page_revisions WHERE page_id IN (${marks}) ORDER BY id`),
      threads: await rows(`SELECT * FROM comment_threads WHERE page_id IN (${marks}) ORDER BY id`),
      grants: await rows(`SELECT * FROM page_grants WHERE page_id IN (${marks}) ORDER BY id`),
      record: (await ok('GET', `/api/databases/${db.id}/records/${record}`)).values,
      database: await ok('GET', `/api/databases/${db.id}`),
    };
  };
  const original = await retained();
  const revision = async (id: string) => (await ok('GET', `/api/pages/${id}`)).page.revisionId;
  const archive = async (id: string) => ok('POST', `/api/archive/${id}`, {operationKey: op(), expectedRevisionId: await revision(id), action: 'archive'});
  await archive(root);
  expect((await ok('GET', '/api/archive')).items.filter((item: any) => ids.includes(item.id))).toHaveLength(4);
  const input = {operationKey: op(), expectedRevisionId: await revision(root), action: 'restore'};
  const restored = await ok('POST', `/api/archive/${root}`, input);
  expect(await ok('POST', `/api/archive/${root}`, input)).toEqual(restored);
  expect(await retained()).toEqual(original);
  const ordered = (await ok('GET', `/api/pages?containerId=${f.containerId}`)).items.filter((item: any) => item.parentPageId === parent).map((item: any) => item.id);
  expect(ordered).toEqual([before, root, after]);
  for (const id of ids) {
    expect((await ok('GET', `/api/pages/${id}`, undefined, f.b)).page.id).toBe(id);
    expect((await ok('GET', `/api/comments/page/${id}`, undefined, f.b)).threads).toHaveLength(1);
    expect((await ok('GET', `/api/revisions/${id}`)).items.length).toBeGreaterThan(1);
  }
  expect((await ok('GET', `/api/databases/${db.id}/records/${record}`, undefined, f.b)).values.points).toBe(42);

  // The old parent can become unavailable after a child was archived separately.
  await archive(root);
  await archive(parent);
  const inventory = (await ok('GET', '/api/archive')).items;
  expect(inventory.find((item: any) => item.id === root).restoreNeedsDestination).toBe(true);
  const refused = await f.request('POST', `/api/archive/${root}`, {operationKey: op(), expectedRevisionId: await revision(root), action: 'restore'});
  expect(refused.status).toBe(409); expect(refused.data.code).toBe('RESTORE_DESTINATION_REQUIRED');
  for (const destination of [{containerId: op(), parentPageId: null}, {containerId: f.containerId, parentPageId: parent}]) {
    expect((await f.request('POST', `/api/archive/${root}`, {operationKey: op(), expectedRevisionId: await revision(root), action: 'restore', ...destination})).status).toBeGreaterThanOrEqual(400);
    expect((await ok('GET', '/api/archive')).items).toEqual(inventory);
  }
  const chosen = {operationKey: op(), expectedRevisionId: await revision(root), action: 'restore', containerId: f.containerId, parentPageId: null};
  await ok('POST', `/api/archive/${root}`, chosen);
  expect((await ok('GET', `/api/pages/${root}`)).parentPageId).toBeNull();
  const relocated = await retained();
  expect({...relocated, pages: relocated.pages.map((row: any) => row.id === root ? {...row, parent_page_id: parent} : row)}).toEqual(original);

  // A separately archived database restores its actual records; the container restores every root atomically.
  await archive(db.pageId);
  await ok('POST', `/api/archive/${db.pageId}`, {operationKey: op(), expectedRevisionId: await revision(db.pageId), action: 'restore'});
  expect(await retained()).toEqual(relocated);
  const space = await ok('GET', `/api/containers/${f.containerId}`);
  const archived = await ok('POST', `/api/containers/${f.containerId}/archive`, {operationKey: op(), expectedRevisionId: space.revisionId});
  const restoreSpace = {operationKey: op(), expectedRevisionId: archived.value.revisionId, restore: true};
  const receipt = await ok('POST', `/api/containers/${f.containerId}/archive`, restoreSpace);
  expect(await ok('POST', `/api/containers/${f.containerId}/archive`, restoreSpace)).toEqual(receipt);
  expect(await retained()).toEqual(relocated);
  expect((await ok('GET', `/api/databases/${db.id}/records/${record}`, undefined, f.b)).values.points).toBe(42);
}
