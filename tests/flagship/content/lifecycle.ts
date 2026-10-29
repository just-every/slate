import { env } from 'cloudflare:test';
import { expect, vi } from 'vitest';
import { createUlid } from '../../../src/core/shared/ulid';
import { runContentJobs } from '../../../src/core/features/lifecycle/jobs';

type Fixture = {
  w: string; a: string; b: string; containerId: string;
  request(method: string, path: string, body?: unknown, actor?: string): Promise<{status: number; data: any}>;
};

/** Native publication and clock doors; policies and the clock are fixture inputs. */
export async function lifecycleJourney(f: Fixture) {
  vi.useFakeTimers({toFake:['Date']});
  vi.setSystemTime(new Date('2035-04-10T12:00:00.000Z'));
  try {
  const clock = '2035-04-10T12:00:00.000Z';
  const future = '2035-04-10T13:00:00.000Z';
  const profile = async (value: string) => {
    await env.DB.prepare('INSERT INTO workspace_policies VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET profile_json=excluded.profile_json')
      .bind(f.w, JSON.stringify({'page.lifecycle.v1': value, 'page.version.v1': 'labelled'}), clock).run();
  };
  const send = async (method: string, route: string, body?: unknown) => {
    const result = await f.request(method, route, body);
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    return result.data;
  };
  await profile('draft-then-publish');
  const bid = createUlid();
  const created = await send('POST', '/api/pages', {operationKey:createUlid(),containerId:f.containerId,title:'Lifecycle field guide',blocks:[{id:bid,blockType:'paragraph',treePosition:'a',content:{text:[{text:'Reviewed release'}]}}]});
  const id = created.value.pageId;
  const read = () => send('GET', `/api/pages/${id}`);
  const state = async (expected: string) => {
    for (const policy of ['always-live', 'draft-then-publish']) {
      await profile(policy);
      const doc = await read();
      expect(doc.page.lifecycle).toBe(expected);
      expect(doc.workingRevisionId).toBeTruthy();
      if (expected === 'draft') expect(doc.publishedRevisionId).toBeNull();
      else expect(doc.publishedRevisionId).toBeTruthy();
      if (expected === 'live-with-unpublished-changes') expect(doc.workingRevisionId).not.toBe(doc.publishedRevisionId);
      const event = await env.DB.prepare('SELECT actor_member_id,created_at FROM content_events WHERE page_id=? ORDER BY rowid DESC LIMIT 1').bind(id).first<{actor_member_id:string;created_at:string}>();
      expect(event?.actor_member_id).toBe(f.a);
      expect(Number.isFinite(Date.parse(event!.created_at))).toBe(true);
    }
  };
  await state('draft');
  const denied = await f.request('POST', `/api/pages/${id}/publish`, {operationKey:createUlid(),expectedRevisionId:created.value.revisionId}, f.b);
  expect(denied.status).toBe(404);
  expect((await read()).page.revisionId).toBe(created.value.revisionId);
  const publishInput = {operationKey:createUlid(),expectedRevisionId:created.value.revisionId,label:'Reviewed release'};
  const published = await send('POST', `/api/pages/${id}/publish`, publishInput);
  expect(await send('POST', `/api/pages/${id}/publish`, publishInput)).toEqual(published);
  await state('live');
  const history = () => send('GET', `/api/revisions/${id}`);
  expect((await history()).items.filter((r: any) => r.origin === 'publish')).toHaveLength(1);
  const publishedBlockRevision=(await read()).blocks[0].revisionId;
  const changed = await send('PATCH', `/api/pages/${id}/blocks/${bid}`, {operationKey:createUlid(),expectedRevisionId:(await read()).blocks[0].revisionId,content:{text:[{text:'Private working edit'}]}});
  await state('live-with-unpublished-changes');
  const versions = (await history()).items.map((r: any) => r.id);
  await send('POST', `/api/pages/${id}/discard-changes`, {operationKey:createUlid(),expectedRevisionId:changed.value.revisionId});
  await state('live');
  const restored = await read();
  expect(restored.workingRevisionId).toBe(restored.publishedRevisionId);
  expect(restored.blocks[0].content.text[0].text).toBe('Reviewed release');
  expect(restored.blocks[0].revisionId).not.toBe(publishedBlockRevision);
  const staleEdit=await f.request('PATCH', `/api/pages/${id}/blocks/${bid}`, {operationKey:createUlid(),expectedRevisionId:publishedBlockRevision,content:{text:[{text:'Stale write after discard'}]}});
  expect(staleEdit.status).toBe(409);
  expect((await read()).blocks).toEqual(restored.blocks);
  expect((await history()).items.map((r: any) => r.id)).toEqual(expect.arrayContaining(versions));
  await send('POST', `/api/pages/${id}/publish`, {operationKey:createUlid(),expectedRevisionId:restored.page.revisionId,publishAt:future});
  await state('scheduled');
  await runContentJobs(env, clock);
  expect((await read()).page.lifecycle).toBe('scheduled');
  await runContentJobs(env, future);
  await runContentJobs(env, future);
  await state('live');
  expect((await history()).items.filter((r: any) => r.origin === 'publish')).toHaveLength(2);
  expect((await read()).schedule.state).toBe('published');
  await send('POST', `/api/archive/${id}`, {operationKey:createUlid(),expectedRevisionId:(await read()).page.revisionId,action:'archive'});
  await state('archived');
  await send('POST', `/api/archive/${id}`, {operationKey:createUlid(),expectedRevisionId:(await read()).page.revisionId,action:'restore'});
  await state('live');

  const cancelled = await send('POST', `/api/pages/${id}/publish`, {operationKey:createUlid(),expectedRevisionId:(await read()).page.revisionId,publishAt:future});
  await send('POST', `/api/pages/${id}/cancel-schedule`, {operationKey:createUlid(),expectedRevisionId:cancelled.value.revisionId});
  await state('draft');
  await runContentJobs(env, future);
  expect((await read()).page.lifecycle).toBe('draft');
  expect((await f.request('GET', `/api/pages/${id}`, undefined, f.b)).status).toBe(404);
  expect((await history()).items.filter((r: any) => r.origin === 'publish')).toHaveLength(2);

  await send('POST', `/api/pages/${id}/publish`, {operationKey:createUlid(),expectedRevisionId:(await read()).page.revisionId,publishAt:future});
  const beforeFailure = await read();
  await send('PATCH', `/api/pages/${id}`, {operationKey:createUlid(),expectedRevisionId:beforeFailure.page.revisionId,properties:{title:'Changed after scheduling'}});
  await runContentJobs(env, future);
  const failed = await read();
  expect(failed.page.lifecycle).toBe('scheduled');
  expect(failed.schedule.state).toBe('failed');
  expect(failed.schedule.failure).toContain('page changed');
  const listed = (await send('GET', '/api/pages')).items.find((p: any) => p.id === id);
  expect(listed.scheduleState).toBe('failed');
  expect(listed.scheduleFailure).toBe(failed.schedule.failure);
  expect((await f.request('GET', `/api/pages/${id}`, undefined, f.b)).status).toBe(404);
  expect((await history()).items.filter((r: any) => r.origin === 'publish')).toHaveLength(2);
  } finally { vi.useRealTimers(); }
}
