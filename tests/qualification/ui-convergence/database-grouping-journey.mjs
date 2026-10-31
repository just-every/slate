import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { call, ok } from './two-people-support.mjs';

/** Saved grouping, real move menus and canonical typed values share the existing database journey. */
export async function databaseGroupingJourney(state) {
  const { page, context, origin, api } = state;
  const mutate = async (route, data, method = 'POST') =>
    (await ok(context, origin, method, route, { operationKey: randomUUID(), ...data })).value;
  const container = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  // Identity only: all configuration, records, moves and permission changes use native routes.
  await state.fixtureSql(["INSERT INTO members(id,workspace_id,email,display_name,initials,role,member_kind,status,is_setup_owner,created_at,updated_at) SELECT 'synthetic-slate-person',workspace_id,replace(email,'owner','contributor'),'Sam Contributor','SC','member','member','active',0,created_at,updated_at FROM members WHERE id='browser-owner'"]);
  const database = await mutate('/api/databases', { containerId: container.id, title: 'Grouped work' });
  const base = `/api/databases/${database.id}`;
  const fields = [
    { id: 'selection', name: 'Selection', type: 'select', config: { options: ['Alpha', 'Beta', 'Unused'] } },
    { id: 'stage', name: 'Stage', type: 'status', config: { options: ['Open', 'Done', 'Unused'] } },
    { id: 'assignees', name: 'Assignees', type: 'person', config: {} },
    { id: 'checked', name: 'Checked', type: 'checkbox', config: {} },
    { id: 'due', name: 'Due', type: 'date', config: {} },
  ];
  let revision = database.revisionId;
  for (const [position, field] of fields.entries())
    revision = (await mutate(base + '/fields', { expectedRevisionId: revision, field: { ...field, position } })).revisionId;
  const view = { id: randomUUID(), name: 'Grouped work', layout: 'board', filters: [], sorts: [],
    groups: [{ field: 'selection', hideEmpty: false }], calculations: {}, display: {}, position: 0 };
  await mutate(base + '/views', { expectedRevisionId: revision, view });
  const first = await mutate(base + '/records', { title: 'First task', values: {
    selection: 'Alpha', stage: 'Open', assignees: ['browser-owner', 'browser-reader'], checked: true, due: '2040-06-01',
  } });
  const second = await mutate(base + '/records', { title: 'Second task', values: {
    selection: 'Beta', stage: 'Done', assignees: ['synthetic-slate-person'], checked: false, due: '2040-06-02',
  } });
  const empty = await mutate(base + '/records', { title: 'Unassigned task', values: { assignees: [] } });
  const names = new Map([[first.pageId, 'First task'], [second.pageId, 'Second task'], [empty.pageId, 'Unassigned task']]);
  const canonical = async () => (await api(base + '/records/' + first.pageId)).values;
  const group = label => page.getByRole('region', { name: label, exact: true });
  async function capture(label) {
    await mkdir('.artifacts/ui-convergence/grouping', { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.screenshot({ path: `.artifacts/ui-convergence/grouping/${label}-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const label = value => value == null ? 'No value' : ({
    'browser-owner': 'Alex Owner', 'browser-reader': 'Morgan Reader', 'synthetic-slate-person': 'Sam Contributor',
    '2040-06-01': '01 Jun 2040', '2040-06-02': '02 Jun 2040',
  }[String(value)] ?? String(value));
  async function reconcile(expected) {
    const query = await api(base + '/views/' + view.id);
    const actual = query.groups[0].groups;
    const normalize = groups => groups.map(([value, ids]) => [JSON.stringify(value), [...ids].sort()]).sort();
    assert.deepEqual(normalize(actual.map(item => [item.value, item.pageIds])), normalize(expected));
    assert.deepEqual(query.records.map(item => item.pageId).sort(), [...names.keys()].sort());
    for (const item of actual) {
      assert.equal(item.count, item.pageIds.length);
      await expect(group(label(item.value))).toBeVisible();
      await expect(group(label(item.value)).locator('header > span').last()).toHaveText(String(item.count));
      // Cards are reconciled by their actual open buttons, independent of their move icons.
      for (const [id, title] of names)
        await expect(group(label(item.value)).getByRole('button', { name: title, exact: true })).toHaveCount(item.pageIds.includes(id) ? 1 : 0);
    }
  }
  async function configure(field) {
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'View settings', exact: true });
    await dialog.getByRole('combobox', { name: /^Group by/ }).selectOption(field);
    if (field === 'selection') await capture('view-settings');
    await dialog.getByRole('button', { name: 'Save view', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    const saved = (await api(base)).views.find(item => item.id === view.id);
    assert.deepEqual(saved.groups, [{ field, hideEmpty: false }]);
  }
  async function move(from, to, expectedValue, field) {
    const trigger = group(from).getByRole('button', { name: 'Move First task to another group', exact: true });
    await page.keyboard.press('Tab');
    await trigger.focus();
    await expect.poll(() => trigger.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
    await expect(trigger).toHaveAttribute('data-tooltip', /\S+\s+\S+/);
    await trigger.click();
    const receipt = page.waitForResponse(response => new URL(response.url()).pathname === base + '/records/' + first.pageId
      && response.request().method() === 'PATCH');
    await page.getByRole('menuitem', { name: to, exact: true }).click();
    const response = await receipt;
    assert.equal(response.status(), 200, await response.text());
    const submitted = response.request().postDataJSON();
    assert.deepEqual(submitted.values[field], expectedValue);
    assert.deepEqual((await canonical())[field], expectedValue);
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual((await canonical())[field], expectedValue);
  }
  await page.goto(`${origin}/app/databases/${database.id}`, { waitUntil: 'networkidle' });
  for (const [field, from, to, initial, moved, expectedValue] of [
    ['selection', 'Alpha', 'Beta', [['Alpha', [first.pageId]], ['Beta', [second.pageId]], ['Unused', []], [null, [empty.pageId]]], [['Alpha', []], ['Beta', [first.pageId, second.pageId]], ['Unused', []], [null, [empty.pageId]]], 'Beta'],
    ['stage', 'Open', 'Done', [['Open', [first.pageId]], ['Done', [second.pageId]], ['Unused', []], [null, [empty.pageId]]], [['Open', []], ['Done', [first.pageId, second.pageId]], ['Unused', []], [null, [empty.pageId]]], 'Done'],
    ['assignees', 'Alex Owner', 'Sam Contributor', [['browser-owner', [first.pageId]], ['browser-reader', [first.pageId]], ['synthetic-slate-person', [second.pageId]], [null, [empty.pageId]]], [['browser-reader', [first.pageId]], ['synthetic-slate-person', [first.pageId, second.pageId]], [null, [empty.pageId]]], ['browser-reader', 'synthetic-slate-person']],
    ['checked', 'true', 'false', [[true, [first.pageId]], [false, [second.pageId]], [null, [empty.pageId]]], [[true, []], [false, [first.pageId, second.pageId]], [null, [empty.pageId]]], false],
    ['due', '01 Jun 2040', '02 Jun 2040', [['2040-06-01', [first.pageId]], ['2040-06-02', [second.pageId]], [null, [empty.pageId]]], [['2040-06-02', [first.pageId, second.pageId]], [null, [empty.pageId]]], '2040-06-02'],
  ]) {
    await configure(field);
    await reconcile(initial);
    await move(from, to, expectedValue, field);
    await reconcile(moved);
    console.log(`PROBE DB-006 ${field}: saved board and native move -> typed value, exact membership and counts retained after reload`);
    if (field === 'selection') {
      const toggle = page.getByRole('switch', { name: 'Hide empty groups', exact: true });
      let saved = page.waitForResponse(response => new URL(response.url()).pathname === base + '/views' && response.request().method() === 'POST');
      await toggle.click();
      assert.equal((await saved).status(), 200);
      await expect(toggle).toBeChecked();
      await page.reload({ waitUntil: 'networkidle' });
      await expect(group('Unused')).toHaveCount(0);
      await expect(group('Alpha')).toHaveCount(0);
      assert.equal((await api(base)).views.find(item => item.id === view.id).groups[0].hideEmpty, true);
      saved = page.waitForResponse(response => new URL(response.url()).pathname === base + '/views' && response.request().method() === 'POST');
      await toggle.click();
      assert.equal((await saved).status(), 200);
      await expect(toggle).not.toBeChecked();
      await page.reload({ waitUntil: 'networkidle' });
      await reconcile(moved);
    }
  }
  await configure('assignees');
  await move('Morgan Reader', 'Sam Contributor', ['synthetic-slate-person'], 'assignees');
  await move('Sam Contributor', 'No value', [], 'assignees');
  await expect(group('No value').getByRole('button', { name: 'First task', exact: true })).toBeVisible();
  await move('No value', 'Sam Contributor', ['synthetic-slate-person'], 'assignees');
  await reconcile([['synthetic-slate-person', [first.pageId, second.pageId]], [null, [empty.pageId]]]);
  const databasePageId = (await api(base)).database.page_id;
  for (const id of [databasePageId, first.pageId, second.pageId, empty.pageId]) {
    const document = await api('/api/pages/' + id);
    await mutate(`/api/pages/${id}/publish`, { expectedRevisionId: document.page.revisionId });
  }
  const snapshot = await canonical();
  // A current viewer cannot forge a grouping move or change the shared view.
  await mutate('/api/sharing', { targetKind: 'page', targetId: databasePageId, principalKind: 'member', principalId: 'browser-reader', level: 'view' });
  await state.switchIdentity('reader');
  const before = await call(context, origin, 'GET', base);
  assert.equal(before.status, 200);
  const refused = await call(context, origin, 'PATCH', base + '/records/' + first.pageId, {
    operationKey: randomUUID(), expectedRevisionId: (await call(context, origin, 'GET', base + '/records/' + first.pageId)).body.revisionId,
    values: { assignees: ['browser-reader'] },
  });
  assert.equal(refused.status, 404);
  const refusedView = await call(context, origin, 'POST', base + '/views', {
    operationKey: randomUUID(), expectedRevisionId: before.body.database.revision_id, view,
  });
  assert.equal(refusedView.status, 404);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /Move .* to another group/ })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Hide empty groups', exact: true })).toBeDisabled();
  await state.switchIdentity('owner');
  assert.deepEqual(await canonical(), snapshot);
  await page.reload({ waitUntil: 'networkidle' });
  await capture('board');
}
