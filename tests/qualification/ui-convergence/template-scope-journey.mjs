import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { ok } from './two-people-support.mjs';

/** Readable collections distinguish scope filtering from a permission refusal. */
export async function templateScopeJourney(state) {
  const { page, context, origin, api } = state;
  const width = page.viewportSize().width;
  const post = (route, data) => ok(context, origin, 'POST', route, { operationKey: randomUUID(), ...data });
  const baseline = (await api('/api/templates')).items;
  assert.ok(baseline.length > 0, 'The workspace collection is populated.');
  assert.ok(baseline.every(item => item.containerId === null));
  const spaces = [];
  for (const name of ['Atlas templates', 'Beacon templates']) {
    const space = (await post('/api/containers', { name, visibility: 'private' })).value;
    assert.equal((await api(`/api/containers/${space.id}`)).name, name);
    spaces.push({ ...space, name });
  }
  const source = (await post('/api/pages', {
    containerId: spaces[0].id, title: 'Scope source',
    blocks: [{ id: randomUUID(), blockType: 'paragraph', content: { text: [{ text: 'Retained scope snapshot' }] }, treePosition: 'a0' }],
  })).value;
  const definitions = [
    { title: 'A workspace movable', containerId: null },
    { title: 'B workspace retained', containerId: null },
    { title: 'Y Atlas first', containerId: spaces[0].id },
    { title: 'Z Atlas second', containerId: spaces[0].id },
    { title: 'Y Beacon first', containerId: spaces[1].id },
    { title: 'Z Beacon second', containerId: spaces[1].id },
  ];
  for (const item of definitions) {
    const saved = (await post('/api/templates', {
      sourcePageId: source.pageId, includeChildren: false,
      description: `Reusable ${item.title}`, category: 'Scope proof', ...item,
    })).value;
    item.id = saved.id;
    // Even the template deliberately excluded from another collection is readable.
    assert.equal((await api(`/api/templates/${item.id}`)).title, item.title);
  }
  const movable = definitions[0];
  const original = await api(`/api/templates/${movable.id}`);
  assert.match(JSON.stringify(original.snapshot), /Retained scope snapshot/);
  const alphabetic = items => [...items].sort((a, b) => a.title < b.title ? -1 : a.title > b.title ? 1 : a.id.localeCompare(b.id));
  const expected = containerId => [
    ...alphabetic(definitions.filter(item => containerId && item.containerId === containerId)),
    ...alphabetic([...baseline, ...definitions.filter(item => item.containerId === null)]),
  ];
  const choice = title => page.locator('.template-choice').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  async function collection(containerId, label) {
    const wanted = expected(containerId);
    const actual = (await api(`/api/templates${containerId ? `?containerId=${containerId}` : ''}`)).items;
    assert.deepEqual(actual.map(item => [item.id, item.title, item.containerId]), wanted.map(item => [item.id, item.title, item.containerId]), `${label}: exact native order and scope`);
    await page.goto(origin + (containerId ? `/app/containers/${containerId}` : '/app/templates'), { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    if (containerId) {
      await page.getByRole('navigation', { name: 'Space navigation', exact: true }).getByRole('button', { name: 'Templates', exact: true }).click();
    }
    await expect(page.getByRole('combobox', { name: 'Collection', exact: true })).toHaveValue(containerId ?? '');
    await expect(page.locator('.template-choice h3')).toHaveText(wanted.map(item => item.title));
    for (const item of definitions.filter(item => item.containerId && item.containerId !== containerId)) {
      await expect(choice(item.title)).toHaveCount(0);
    }
    return actual;
  }
  async function reconcile(label, capture = false) {
    for (const space of spaces) {
      const items = await collection(space.id, `${label} ${space.name}`);
      if (capture) {
        await accessible(page, `template scope ${space.name}`);
        await page.screenshot({ path: `.artifacts/ui-convergence/template-scope-${width}-${space.id}.png`, fullPage: true });
      }
      assert.ok(items.some(item => item.containerId === space.id), 'A populated local collection precedes workspace choices.');
    }
    await collection(null, `${label} workspace`);
    if (capture) await page.screenshot({ path: `.artifacts/ui-convergence/template-scope-${width}-workspace.png`, fullPage: true });
  }
  await reconcile('Initial', true);
  console.log('PROBE TMPL-006 scope: two readable container Templates tabs and workspace collection -> exact ordered lists, own scope first and other scope absent after reload');
  const requests = [];
  const record = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/templates/${movable.id}/change`) requests.push(request.postDataJSON());
  };
  page.on('request', record);
  try {
    for (const containerId of [spaces[0].id, null]) {
      await collection(movable.containerId, 'Move source');
      await choice(movable.title).click();
      const before = await api(`/api/templates/${movable.id}`);
      await page.getByRole('button', { name: 'Move collection', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Move template', exact: true });
      await dialog.getByRole('combobox', { name: 'Collection', exact: true }).selectOption(containerId ?? '');
      await page.screenshot({ path: `.artifacts/ui-convergence/template-scope-${width}-move-${containerId ? 'container' : 'workspace'}.png`, fullPage: true });
      const committed = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/templates/${movable.id}/change`);
      await dialog.getByRole('button', { name: 'Move', exact: true }).click();
      const response = await committed;
      assert.equal(response.status(), 200, await response.text());
      const receipt = await response.json();
      assert.equal(receipt.value.id, movable.id);
      assert.notEqual(receipt.value.revisionId, before.revisionId);
      await expect(dialog).toBeHidden();
      movable.containerId = containerId;
      await reconcile(containerId ? 'Moved into Atlas' : 'Returned to workspace');
      const after = await api(`/api/templates/${movable.id}`);
      assert.equal(after.id, original.id);
      assert.equal(after.revisionId, receipt.value.revisionId);
      assert.deepEqual(after.snapshot, original.snapshot, 'Scope moves retain the complete snapshot.');
      assert.deepEqual([after.title, after.description, after.category], [original.title, original.description, original.category]);
      console.log(`PROBE TMPL-006 move ${containerId ? 'into container' : 'back to workspace'}: one native Move collection submission -> receipt ${receipt.value.id}, unchanged snapshot and all three collections reconciled after reload`);
    }
    assert.deepEqual(requests.map(item => [item.action, item.containerId]), [['move', spaces[0].id], ['move', null]], 'Each scope change is exactly one native mutation.');
    assert.equal(new Set(requests.map(item => item.operationKey)).size, 2);
  } finally {
    page.off('request', record);
  }
}
