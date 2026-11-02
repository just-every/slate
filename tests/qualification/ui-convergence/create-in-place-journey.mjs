import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { openNavigation } from './browser-support.mjs';
import { accessible, insideViewport } from './browser-evidence.mjs';
import { randomUUID } from 'node:crypto';
import { call, grant, ok } from './two-people-support.mjs';
import { writeFile } from 'node:fs/promises';

export async function createInPlaceJourney({ page, context, origin, api, switchIdentity }) {
  const width = page.viewportSize().width;
  const space = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  const shot = label => page.screenshot({ path: `.artifacts/ui-convergence/create-in-place-${width}-${label}.png`, fullPage: false });
  async function created(title, parentPageId = null) {
    const input = page.getByRole('textbox', { name: 'Page title', exact: true });
    await expect(input).toHaveValue('Untitled');
    const id = new URL(page.url()).pathname.split('/').at(-1);
    const document = await api(`/api/pages/${id}`);
    assert.equal(document.page.containerId, space.id);
    assert.equal(document.parentPageId, parentPageId);
    await input.fill(title);
    await input.press('Tab');
    await expect.poll(async () => (await api(`/api/pages/${id}`)).page.title).toBe(title);
    await shot(title.replaceAll(' ', '-'));
    return id;
  }
  const longName = 'Engineering operations and incident response';
  await ok(context, origin, 'POST', '/api/containers', { operationKey: randomUUID(), name: longName, visibility: 'private' });
  const pagesBefore = (await api('/api/pages')).items;
  const welcome = pagesBefore.find(item => item.title === 'Welcome');
  await page.reload({ waitUntil: 'networkidle' });
  await openNavigation(page);
  const tree = page.getByRole('navigation', { name: 'Pages', exact: true });
  await expect(tree.getByRole('button', { name: 'Create page in Handbook', exact: true })).toBeVisible();
  await accessible(page, 'tree creation destination');
  await shot('tree-footer');
  const longFooter = tree.getByRole('button', { name: `Create page in ${longName}`, exact: true });
  await longFooter.scrollIntoViewIfNeeded();
  assert.ok(await longFooter.locator('span').evaluate(element => element.scrollWidth <= element.clientWidth && getComputedStyle(element).whiteSpace === 'normal'), 'The whole destination wraps instead of being truncated.');
  await shot('long-destination');
  await tree.getByRole('button', { name: 'Create page in Handbook', exact: true }).click();
  const root = await created('Engineering handbook');
  await openNavigation(page);
  await tree.getByRole('link', { name: 'Engineering handbook', exact: true }).hover();
  await tree.getByRole('button', { name: 'Create child of Engineering handbook', exact: true }).click();
  const child = await created('Incident response', root);
  await openNavigation(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const globalPage = page.getByRole('menuitem', { name: 'Page', exact: true });
  await expect(globalPage).toHaveAccessibleDescription('in Handbook');
  await shot('global-destination');
  await globalPage.click();
  const global = await created('Release checklist');
  await page.goto(`${origin}/app/containers/${space.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Content', exact: true }).click();
  const footer = page.locator('.space-detail').getByRole('button', { name: 'Create page in Handbook', exact: true });
  await footer.scrollIntoViewIfNeeded();
  await shot('content-footer');
  await footer.click();
  const content = await created('Support escalation');
  const treeAfter = (await api('/api/pages')).items;
  assert.equal(treeAfter.length, pagesBefore.length + 4);
  for (const id of [root, child, global, content]) assert.equal(treeAfter.filter(item => item.id === id).length, 1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Support escalation');
  // Keep every row rendered, then enter once at the filter. After this point
  // only Tab and Shift+Tab move focus; a pointer cannot keep an old row open.
  await openNavigation(page);
  const handbook = tree.locator('.space-group').filter({ has: page.getByRole('textbox', { name: 'Filter pages in Handbook', exact: true }) });
  const expand = handbook.getByRole('button', { name: /^Expand / });
  while (await expand.count()) {
    await expect(expand.first()).toBeEnabled();
    const expandedName = (await expand.first().getAttribute('aria-label')).replace(/^Expand /, 'Collapse ');
    await expand.first().click();
    await expect(handbook.getByRole('button', { name: expandedName, exact: true })).toHaveAttribute('aria-expanded', 'true');
  }
  const rows = await handbook.locator('.tree-row').all();
  assert.ok(rows.length >= 5, 'The keyboard corpus contains the root, its child and sibling pages.');
  await handbook.getByRole('textbox', { name: 'Filter pages in Handbook', exact: true }).click();
  await page.mouse.move(width - 1, page.viewportSize().height - 1);
  const firstAction = rows[0].locator('.tree-action').last();
  assert.equal(await firstAction.evaluate(element => getComputedStyle(element).opacity), '0', 'Idle row actions retain their hover presentation.');
  await rows[0].hover();
  assert.equal(await firstAction.evaluate(element => getComputedStyle(element).opacity), '1', 'Hover reveals the row actions.');
  await page.mouse.move(width - 1, page.viewportSize().height - 1);
  const keyboard = [];
  for (const row of rows) {
    const controls = await row.locator(':scope > a, :scope > button:not([disabled])').all();
    for (const control of controls) {
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
    }
    const childControl = row.getByRole('button', { name: /^Create child of /, includeHidden: true });
    await expect(childControl).toBeFocused();
    // Leaving the row before returning is the regression: display:none makes
    // the child control disappear from the reverse keyboard order.
    await page.keyboard.press('Tab');
    await expect(childControl).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(childControl).toBeFocused();
    await insideViewport(page, childControl, 'The focused create-child action');
    assert.equal(await childControl.evaluate(element => getComputedStyle(element).opacity), '1');
    assert.equal(await childControl.evaluate(element => getComputedStyle(element, '::after').opacity), '1', 'Keyboard focus shows the Add child tooltip immediately.');
    keyboard.push(await childControl.getAttribute('aria-label'));
  }
  await shot('keyboard-focused-action');
  console.log(`PROBE PAGE-017 ${width === 390 ? 1 : 2}: ${width}px native Tab and Shift+Tab -> ${keyboard.length} visible create-child controls in row order`);

  // A member can edit the unrelated locked page, but cannot create at its
  // private space root. Destination discovery must skip that page's lock.
  const lockedSpace = (await ok(context, origin, 'POST', '/api/containers', { operationKey: randomUUID(), name: 'Restricted procedures', visibility: 'private' })).value.id;
  const lockedId = (await ok(context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: lockedSpace, title: 'Approved procedure', blocks: [{ id: randomUUID(), blockType: 'paragraph', content: { text: [{ text: 'Keep the approved procedure unchanged.' }] }, treePosition: 'a0' }] })).value.pageId;
  await grant(context, origin, lockedId, 'browser-reader', 'edit');
  const unlocked = await api(`/api/pages/${lockedId}`);
  await ok(context, origin, 'POST', `/api/pages/${lockedId}/lock`, { operationKey: randomUUID(), expectedRevisionId: unlocked.page.revisionId });
  const memberGrant = await ok(context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), targetKind: 'container', targetId: space.id, principalKind: 'member', principalId: 'browser-reader', level: 'edit' });
  await switchIdentity('reader');
  assert.equal((await api('/api/members/current')).role, 'member');
  const listed = await call(context, origin, 'GET', '/api/templates');
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const template = listed.body.items.find(item => item.title === 'Meeting notes' && item.isShipped);
  assert.ok(template, 'A populated native listing includes the shipped template.');
  const preview = await call(context, origin, 'GET', `/api/templates/${template.id}`);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.ok(preview.body.snapshot.blocks.length > 2);
  assert.ok(preview.body.applyDestinations.some(item => item.containerId === space.id && item.parentPageId === null));
  assert.ok(!preview.body.applyDestinations.some(item => item.parentPageId === lockedId));
  const applyInput = { operationKey: randomUUID(), containerId: space.id, expectedRevisionId: preview.body.revisionId };
  const applied = await call(context, origin, 'POST', `/api/templates/${template.id}/apply`, applyInput);
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal(applied.body.receipt.operationKey, applyInput.operationKey);
  const made = await api(`/api/pages/${applied.body.value.pageId}`);
  assert.equal(made.page.containerId, space.id);
  assert.equal(made.parentPageId, null);
  assert.equal(made.page.title, 'Meeting notes');
  assert.deepEqual(made.blocks.map(block => [block.blockType, block.content]), preview.body.snapshot.blocks.map(block => [block.blockType, block.blockType === 'task' ? { ...block.content, creatorMemberId: 'browser-reader', completedAt: null, completedByMemberId: null } : block.content]));
  console.log('PROBE PAGE-017 3: ordinary member native template list, preview and writable-root apply with unrelated lock -> 200, 200, 201 and persisted root page');
  await page.goto(`${origin}/app/pages/${lockedId}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-page-lock]')).toContainText('Locked by Alex Owner');
  await expect(page.locator('[data-page-editor] [contenteditable="true"]')).toHaveCount(0);
  await shot('locked-template-destination');
  const before = { destination: await api(`/api/pages/${lockedId}`), pages: await api('/api/pages') };
  const deniedInput = { ...applyInput, operationKey: randomUUID(), containerId: lockedSpace, parentPageId: lockedId };
  for (const attempt of ['initial', 'replay']) {
    const refused = await call(context, origin, 'POST', `/api/templates/${template.id}/apply`, deniedInput);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'PAGE_LOCKED');
    assert.deepEqual(await api(`/api/pages/${lockedId}`), before.destination, `${attempt}: every field of the locked destination stays unchanged.`);
    assert.deepEqual(await api('/api/pages'), before.pages, `${attempt}: no template target is created.`);
  }
  console.log('PROBE PAGE-017 4: native apply and replay to locked destination -> PAGE_LOCKED 409, exact destination and page inventory unchanged');
  await writeFile(`.artifacts/ui-convergence/page-017-${width}.json`, JSON.stringify({ width, keyboard, statuses: [listed.status, preview.status, applied.status, 409], receipt: applied.body.receipt, created: made, lockedBefore: before, lockedAfter: { destination: await api(`/api/pages/${lockedId}`), pages: await api('/api/pages') } }, null, 2));
  console.log(`PROBE PAGE-017 5: existing Verify-loaded createInPlaceJourney at ${width}px -> keyboard and locked-template checks pass in the same workspace`);

  // Preserve the existing read-only creation assertions after the new member case.
  await switchIdentity('owner');
  await ok(context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), targetKind: 'container', targetId: space.id, id: memberGrant.value.id, principalKind: 'member', principalId: 'browser-reader', level: 'view' });
  await switchIdentity('reader');
  await page.goto(`${origin}/app/pages/${welcome.id}`, { waitUntil: 'networkidle' });
  await openNavigation(page);
  await expect(tree.getByRole('button', { name: 'Create page in Handbook', exact: true })).toHaveCount(0);
  await tree.getByRole('link', { name: 'Welcome', exact: true }).hover();
  await expect(tree.getByRole('button', { name: 'Create child of Welcome', exact: true })).toBeDisabled();
  await shot('reader');
}
