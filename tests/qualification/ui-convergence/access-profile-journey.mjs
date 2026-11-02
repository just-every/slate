import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { accessible, closeDetails } from './browser-support.mjs';
import { call, ok } from './two-people-support.mjs';

/** Profile and configuration writes use Settings; every ACL uses the native grant door. */
export async function accessProfileJourney(state) {
  const { page, context, origin, api, readerCookie } = state;
  const post = (route, data, method = 'POST') => ok(context, origin, method, route, { operationKey: crypto.randomUUID(), ...data });
  const original = await api('/api/workspace'), originalLevels = await api('/api/sharing/configuration');
  assert.deepEqual(originalLevels.levels, ['full', 'edit', 'comment', 'view']);
  const space = (await post('/api/containers', { name: 'Access profile corpus', visibility: 'private' })).value.id;
  const group = (await post('/api/groups', { name: 'Profile editors', memberIds: ['browser-owner'] })).value.id;
  const create = async (title, parentPageId) => {
    const id = (await post('/api/pages', { containerId: space, title, parentPageId,
      blocks: [{ id: crypto.randomUUID(), blockType: 'paragraph', content: { text: [{ text: 'Populated profile content.' }] }, treePosition: 'a' }] })).value.pageId;
    await grant(id, 'member', 'browser-owner', 'full');
    return id;
  };
  const grant = (targetId, principalKind, principalId, level) => post('/api/sharing', { targetKind: 'page', targetId, principalKind, principalId, level });
  const direct = await create('Profile direct grants');
  await grant(direct, 'member', 'browser-reader', 'edit');
  await grant(direct, 'group', group, 'comment');
  const parent = await create('Profile ancestor');
  await grant(parent, 'member', 'browser-reader', 'comment');
  const inherited = await create('Profile inherited grants', parent);
  const containerGeneral = await create('Profile bounded general');
  await grant(containerGeneral, 'container', space, 'view');
  const workspaceGeneral = await create('Profile workspace general');
  await grant(workspaceGeneral, 'workspace', original.id, 'view');
  const absent = await create('Profile without general access');
  await post(`/api/comments/page/${direct}`, { body: [{ text: 'Existing discussion survives configuration.' }] });
  const ids = [direct, parent, inherited, containerGeneral, workspaceGeneral, absent];
  const stored = async () => ({ space: await api(`/api/sharing/containers/${space}`), pages: await Promise.all(ids.map(id => api(`/api/sharing/pages/${id}`))) });
  const grantsOnly = snapshot => JSON.parse(JSON.stringify(snapshot, (key, value) => key === 'levels' ? undefined : value));
  const inventory = grantsOnly(await stored());
  const content = async () => Promise.all(ids.map(async id => {
    const doc = await api(`/api/pages/${id}`);
    return { page: doc.page, blocks: doc.blocks, properties: doc.properties, working: doc.workingRevisionId, published: doc.publishedRevisionId };
  }));
  const beforeContent = await content();
  const reader = await context.browser().newContext();
  await reader.addCookies([{ name: 'slate_session', value: readerCookie.split('=')[1], url: origin }]);
  const access = async () => Promise.all(ids.map(async id => {
    const result = await call(reader, origin, 'GET', `/api/pages/${id}`);
    return [result.status, result.body?.permissions?.level ?? null];
  }));
  const expected = [[200, 'edit'], [200, 'comment'], [200, 'comment'], [404, null], [200, 'view'], [404, null]];
  assert.deepEqual(await access(), expected);
  const panel = page.locator('.right');
  const captured = new Set();
  async function proof(screen) { if (!captured.has(screen)) { await accessible(page, screen); captured.add(screen); } }
  const openShare = async id => {
    await page.goto(`${origin}/app/pages/${id}?detail=share`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(panel.getByRole('combobox', { name: 'Permission', exact: true })).toBeVisible();
  };
  const choices = locator => locator.locator('option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
  async function switchProfile(value) {
    await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Edit workspace & policies', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true });
    await dialog.getByRole('combobox', { name: 'General access', exact: true }).selectOption(value);
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal((await api('/api/workspace')).policies['page.access.v1'], value);
    assert.deepEqual(grantsOnly(await stored()), inventory, 'Profile changes preserve the exact populated direct, inherited, general and absent inventories.');
    assert.deepEqual(await access(), expected, 'A profile change neither admits an unrelated member nor changes any existing access level.');
    assert.deepEqual(await content(), beforeContent);
  }
  async function configure(levels) {
    await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
    const form = page.locator('section[aria-label="Sharing levels"]');
    for (const [value, label] of Object.entries({ full: 'Manage access', edit: 'Edit', comment: 'Comment', view: 'View' })) {
      await form.getByRole('checkbox', { name: label, exact: true }).setChecked(levels.includes(value));
    }
    const saved = page.waitForResponse(response => response.url().endsWith('/api/sharing/configuration') && response.request().method() === 'PUT');
    await form.getByRole('button', { name: 'Save sharing levels', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await expect.poll(async () => (await api('/api/sharing/configuration')).levels).toEqual(levels);
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(grantsOnly(await stored()), inventory, 'Changing available choices never edits stored grants.');
    assert.deepEqual(await access(), expected);
    assert.deepEqual(await content(), beforeContent);
    if (!levels.includes('comment')) await proof('sharing levels with comment removed');
    console.log(`PROBE SHARE-005 3: Settings levels=${levels.join(',')} -> retained grants and exact reader access`);
  }
  async function inspectChoices(levels) {
    await openShare(direct);
    for (const select of await panel.locator('select[name="level"], .grant-list select').all()) {
      assert.deepEqual(await choices(select), levels, 'Every direct, new-person and invitation level selector follows configuration.');
    }
    await panel.locator('summary').filter({ hasText: /^Invite by email$/ }).click();
    assert.deepEqual(await choices(panel.getByRole('combobox', { name: 'Invitation access', exact: true })), levels);
    await page.goto(`${origin}/app/containers?container=${space}`, { waitUntil: 'networkidle' });
    await page.getByRole('navigation', { name: 'Space navigation', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.space-access-details > summary').click();
    await page.getByRole('button', { name: 'Grant access', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Space access grant', exact: true });
    assert.deepEqual(await choices(dialog.getByRole('combobox', { name: 'Access', exact: true })), levels);
    if (!levels.includes('comment')) await proof('space grant choices with comment removed');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    // Editing a grant whose level was removed must offer no hidden-level choice.
    await page.locator('.space-access-details').getByRole('button', { name: 'Edit access', exact: true }).first().click();
    assert.deepEqual(await choices(dialog.getByRole('combobox', { name: 'Access', exact: true })), levels);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  async function comments(enabled) {
    await page.goto(`${origin}/app/pages/${direct}?detail=comments`, { waitUntil: 'networkidle' });
    await expect(panel).toContainText('Existing discussion survives configuration.');
    await expect(panel.getByRole('button', { name: 'Send comment', exact: true })).toHaveCount(enabled ? 1 : 0);
    await expect(panel.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(enabled ? 1 : 0);
    await expect(panel.getByRole('button', { name: 'Resolve', exact: true })).toHaveCount(enabled ? 1 : 0);
    if (!enabled) await proof('existing discussion without comment actions');
    await closeDetails(page);
    const commentsControl = page.locator('.page-topbar').getByRole('button', { name: 'Comments', exact: true });
    await commentsControl.hover();
    await expect.poll(() => commentsControl.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
    await page.mouse.move(0, 0);
    await commentsControl.focus();
    assert.equal(await commentsControl.evaluate(element => getComputedStyle(element, '::after').opacity), '1');
    const editable = page.locator('[data-page-editor] [data-slate-editable]').first();
    await editable.evaluate(element => { const selection = getSelection(), range = document.createRange(); range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
    const toolbar = page.getByRole('toolbar', { name: 'Formatting for the selected text', exact: true });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Comment', exact: true })).toHaveCount(enabled ? 1 : 0);
    for (const control of await toolbar.locator('button[aria-label]').all()) assert.ok(await control.getAttribute('data-tooltip'), 'Icon-only formatting actions have tooltips.');
    if (!enabled) await proof('inline formatting without comment action');
    await page.getByRole('textbox', { name: 'Page title', exact: true }).click();
    assert.equal((await api(`/api/pages/${direct}`)).permissions.canComment, enabled);
    assert.equal((await api(`/api/pages/${direct}`, { headers: { cookie: readerCookie } })).permissions.level, 'edit');
  }
  try {
    const config = await api('/api/sharing/configuration');
    assert.equal((await call(reader, origin, 'PUT', '/api/sharing/configuration', { operationKey: crypto.randomUUID(), expectedRevisionId: config.revisionId, levels: ['view'] })).status, 403);
    assert.deepEqual(await api('/api/sharing/configuration'), config, 'A non-owner cannot change workspace configuration.');
    // Forward, reverse, and back: each existing scope is checked at every switch.
    for (const profile of ['workspace-general', 'container-general', 'workspace-general']) {
      await switchProfile(profile);
      await openShare(containerGeneral);
      await expect(panel.locator('.grant-list')).toContainText('Access profile corpus');
      await openShare(workspaceGeneral);
      await expect(panel.locator('.grant-list')).toContainText(original.name);
      await inspectChoices(originalLevels.levels);
      await comments(true);
      const created = await create(`New general under ${profile}`);
      await openShare(created);
      await panel.locator('.advanced-access > summary').click();
      const label = profile === 'container-general' ? 'Allow general read access in Access profile corpus' : 'Allow general read access to workspace members';
      await panel.getByRole('button', { name: label, exact: true }).click();
      await expect.poll(async () => (await api(`/api/sharing/pages/${created}`)).items.filter(item => ['container', 'workspace'].includes(item.principalKind)).length).toBe(1);
      const general = (await api(`/api/sharing/pages/${created}`)).items.filter(item => ['container', 'workspace'].includes(item.principalKind));
      assert.equal(general.length, 1);
      assert.equal(general[0].principalKind, profile === 'container-general' ? 'container' : 'workspace');
      assert.equal(general[0].principalId, profile === 'container-general' ? space : original.id);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(panel.locator('.grant-list')).toContainText(profile === 'container-general' ? 'Access profile corpus' : original.name);
      assert.equal((await call(reader, origin, 'GET', `/api/pages/${created}`)).status, profile === 'container-general' ? 404 : 200);
      await proof(`access profile ${profile}`);
      console.log(`PROBE SHARE-005 1,2,5,6: ${profile} -> ${general[0].principalKind} principal; populated inventories and access unchanged by switching`);
      await configure(['full', 'edit', 'view']);
      await inspectChoices(['full', 'edit', 'view']);
      await comments(false);
      await configure(originalLevels.levels);
      await comments(true);
    }
    // Each other level can also be removed independently, including a stored full grant.
    for (const removed of ['full', 'edit', 'view']) {
      const levels = originalLevels.levels.filter(level => level !== removed);
      await configure(levels);
      await inspectChoices(levels);
      await configure(originalLevels.levels);
    }
    await switchProfile(original.policies['page.access.v1']);
    const lifecycle = async value => {
      await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Edit workspace & policies', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true });
      await dialog.getByRole('combobox', { name: 'Publishing', exact: true }).selectOption(value);
      await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
      await expect(dialog).toBeHidden();
    };
    await lifecycle('draft-then-publish');
    const draft = await create('Profile publication choices');
    for (const levels of [originalLevels.levels, ...originalLevels.levels.map(removed => originalLevels.levels.filter(level => level !== removed))]) {
      await configure(levels);
      await page.goto(`${origin}/app/pages/${draft}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Publish workspace revision', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Publish this revision', exact: true });
      await dialog.getByRole('combobox', { name: 'General access when published', exact: true }).selectOption(original.policies['page.access.v1'] === 'container-general' ? 'container' : 'workspace');
      const select = dialog.getByRole('combobox', { name: 'General access level', exact: true });
      assert.deepEqual(await choices(select), levels, 'Publication offers only configured levels.');
      await expect(select).toHaveValue(levels.at(-1));
      if (!levels.includes('view')) await proof('publication choices without view');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await configure(originalLevels.levels);
    await lifecycle(original.policies['page.lifecycle.v1']);
    assert.deepEqual(grantsOnly(await stored()), inventory);
    console.log('PROBE SHARE-005 1-6: native profile and configuration switches preserve populated grants and access; both general scopes and hidden choices verified.');
  } finally { await reader.close(); }
}
