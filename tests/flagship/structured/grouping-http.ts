import { expect } from 'vitest';
import { SELF } from 'cloudflare:test';

/** The existing session journey continues through typed saved views and current record authority. */
export async function groupingHttpJourney(database: { id: string }, owner: string, viewer: string, ownerId: string, viewerId: string) {
  const base = `/api/databases/${database.id}`;
  const call = async (method: string, path: string, cookie = owner, data?: unknown) => {
    const response = await SELF.fetch('http://localhost' + path, { method,
      headers: { cookie, origin: 'http://localhost', 'content-type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const mutate = async (method: string, path: string, data: Record<string, unknown>) => {
    const result = await call(method, path, owner, { operationKey: crypto.randomUUID(), ...data });
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
    return result.body.value;
  };
  const fields = [
    { id: 'selection', type: 'select', config: { options: ['Alpha', 'Beta', 'Unused'] } },
    { id: 'stage', type: 'status', config: { options: ['Open', 'Done', 'Unused'] } },
    { id: 'people', type: 'person', config: {} },
    { id: 'checked', type: 'checkbox', config: {} },
    { id: 'due', type: 'date', config: {} },
  ];
  for (const [position, field] of fields.entries()) await mutate('POST', base + '/fields', {
    expectedRevisionId: (await call('GET', base)).body.database.revision_id,
    field: { ...field, name: field.id, position },
  });
  const first = await mutate('POST', base + '/records', { title: 'First task', values: {
    selection: 'Alpha', stage: 'Open', people: [ownerId, viewerId], checked: true, due: '2040-06-01',
  } });
  const second = await mutate('POST', base + '/records', { title: 'Second task', values: {
    selection: 'Beta', stage: 'Done', people: [viewerId], checked: false, due: '2040-06-02',
  } });
  const empty = await mutate('POST', base + '/records', { title: 'Unassigned task', values: { people: [] } });
  // Publish through the native page door, then restrict one otherwise-matching record.
  const databasePageId = (await call('GET', base)).body.database.page_id;
  for (const id of [databasePageId, first.pageId, second.pageId, empty.pageId]) {
    const page = (await call('GET', '/api/pages/' + id)).body;
    await mutate('POST', `/api/pages/${id}/publish`, { expectedRevisionId: page.page.revisionId });
  }
  await mutate('POST', '/api/sharing', { targetKind: 'page', targetId: second.pageId, principalKind: 'member', principalId: ownerId, level: 'full' });
  await mutate('PUT', `/api/sharing/pages/${second.pageId}/inheritance`, {
    expectedRevisionId: (await call('GET', '/api/pages/' + second.pageId)).body.page.revisionId, restricted: true,
  });
  const view = { id: crypto.randomUUID(), name: 'Grouping', layout: 'board', filters: [], sorts: [],
    groups: [] as { field: string; hideEmpty: boolean }[], calculations: {}, display: {}, position: 0 };
  const save = async (field: string, hideEmpty = false) => {
    view.groups = [{ field, hideEmpty }];
    await mutate('POST', base + '/views', { expectedRevisionId: (await call('GET', base)).body.database.revision_id, view });
  };
  for (const [field, expected] of [
    ['selection', [['Alpha', [first.pageId]], ['Beta', [second.pageId]], ['Unused', []], [null, [empty.pageId]]]],
    ['stage', [['Open', [first.pageId]], ['Done', [second.pageId]], ['Unused', []], [null, [empty.pageId]]]],
    ['people', [[ownerId, [first.pageId]], [viewerId, [first.pageId, second.pageId]], [null, [empty.pageId]]]],
    ['checked', [[true, [first.pageId]], [false, [second.pageId]], [null, [empty.pageId]]]],
    ['due', [['2040-06-01', [first.pageId]], ['2040-06-02', [second.pageId]], [null, [empty.pageId]]]],
  ] as [string, [unknown, string[]][]][]) {
    await save(field);
    const normalized = (groups: any[]) => groups.map(g => [JSON.stringify(g.value), g.count, [...g.pageIds].sort()]).sort();
    const query = (await call('GET', base + '/views/' + view.id)).body;
    expect(normalized(query.groups[0].groups)).toEqual(normalized(expected.map(([value, pageIds]) => ({ value, count: pageIds.length, pageIds }))));
    const reader = (await call('GET', base + '/views/' + view.id, viewer)).body;
    expect(reader.records.map((r: any) => r.pageId).sort()).toEqual([first.pageId, empty.pageId].sort());
    const declared = ['select', 'status', 'checkbox'].includes(fields.find(item => item.id === field)!.type);
    const expectedReader = expected.map(([value, ids]) => ({ value, pageIds: ids.filter(id => id !== second.pageId) }))
      .filter(group => group.pageIds.length || group.value === null || declared)
      .map(group => ({ ...group, count: group.pageIds.length }));
    expect(normalized(reader.groups[0].groups)).toEqual(normalized(expectedReader));
    for (const group of reader.groups[0].groups) {
      expect(group.pageIds).not.toContain(second.pageId);
      expect(group.count).toBe(group.pageIds.length);
      const expectedIds = expected.find(([value]) => JSON.stringify(value) === JSON.stringify(group.value))?.[1].filter(id => id !== second.pageId) ?? [];
      expect([...group.pageIds].sort()).toEqual([...expectedIds].sort());
    }
    await save(field, true);
    const hidden = (await call('GET', base + '/views/' + view.id)).body;
    expect(hidden.groups[0].groups).toEqual(query.groups[0].groups.filter((g: any) => g.count > 0));
    expect((await call('GET', base)).body.views.find((v: any) => v.id === view.id).groups).toEqual([{ field, hideEmpty: true }]);
    await save(field);
    expect((await call('GET', base + '/views/' + view.id)).body.groups).toEqual(query.groups);
  }
  const before = (await call('GET', base + '/records/' + first.pageId)).body;
  const attempt = { operationKey: crypto.randomUUID(), expectedRevisionId: before.revisionId, values: { checked: false } };
  expect((await call('PATCH', base + '/records/' + first.pageId, viewer, attempt)).status).toBe(404);
  expect((await call('POST', base + '/views', viewer, { operationKey: crypto.randomUUID(), expectedRevisionId: (await call('GET', base)).body.database.revision_id, view })).status).toBe(404);
  expect((await call('GET', base + '/records/' + first.pageId)).body).toEqual(before);
  const updated = await mutate('PATCH', base + '/records/' + first.pageId, attempt);
  expect((await call('GET', base + '/records/' + first.pageId)).body.values.checked).toBe(false);
  expect((await call('PATCH', base + '/records/' + first.pageId, owner, attempt)).body.value).toEqual(updated);
}
