import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible, closeDetails } from './browser-support.mjs';
import { call, grant, ok, restrictedPage, withSecondPerson } from './two-people-support.mjs';

/** Native workspace policy controls presentation, never vocabulary or page storage. */
export async function statusProfileJourney(state, width) {
  const { page, context, origin, api } = state;
  const get = route => ok(context, origin, 'GET', route);
  const post = (route, data) => ok(context, origin, 'POST', route, { operationKey: randomUUID(), ...data });
  const entries = [
    ['rough-draft', 'Rough draft', '#8b9098', false],
    ['in-progress', 'In progress', '#4488cc', false],
    ['ready-for-review', 'Ready for review', '#cc9900', false],
    ['verified', 'Verified', '#228855', true],
    ['reviewed', 'Reviewed', '#554499', true],
  ];
  for (const [key, label, color, requiresVerification] of entries) {
    await post('/api/status', { key, label, color, requiresVerification });
  }
  const main = await restrictedPage(state, 'Status profile handbook', ['Keep this exact content while changing the profile.']);
  const other = await restrictedPage(state, 'Assigned draft status', ['A non-verifying status remains assigned while hidden.']);
  let otherDoc = await get(`/api/pages/${other.pageId}`);
  await post(`/api/status/page/${other.pageId}`, { expectedRevisionId: otherDoc.page.revisionId, statusKey: 'rough-draft' });
  const route = id => `${origin}/app/pages/${id}`;
  const openPanel = async id => {
    await page.goto(route(id) + '?detail=status', { waitUntil: 'networkidle' });
    await expect(page.getByRole('combobox', { name: 'Set page status', exact: true })).toBeVisible();
  };
  const options = () => page.getByRole('combobox', { name: 'Set page status', exact: true }).locator('option:not([disabled])').evaluateAll(nodes => nodes.map(node => node.value));
  const vocabulary = async () => (await get('/api/status')).items.sort((a, b) => a.key.localeCompare(b.key));
  const snapshots = async () => Promise.all([main.pageId, other.pageId].map(async id => {
    const doc = await get(`/api/pages/${id}`);
    return { page: doc.page, properties: doc.properties, blocks: doc.blocks, workingRevisionId: doc.workingRevisionId,
      publishedRevisionId: doc.publishedRevisionId, verification: doc.verification, history: await get(`/api/revisions/${id}`) };
  }));
  const switchProfile = async value => {
    const before = await get('/api/workspace');
    await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Edit workspace & policies', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true });
    await dialog.getByRole('combobox', { name: 'Page status', exact: true }).selectOption(value);
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload({ waitUntil: 'networkidle' });
    const after = await get('/api/workspace');
    assert.deepEqual(after.policies, { ...before.policies, 'page.status.v1': value });
  };

  assert.equal((await api('/api/workspace')).policies['page.status.v1'], 'verification-only');
  await openPanel(main.pageId);
  assert.deepEqual((await options()).sort(), ['verified', 'reviewed', '__clear'].sort(), 'Human verification exposes every verifying entry and no non-verifying entries.');
  await expect(page.getByRole('button', { name: 'Create a custom status', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Custom status label')).toHaveCount(0);
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Set page status', exact: true }).selectOption('verified');
  const verify = page.getByRole('dialog', { name: 'Verify this exact revision', exact: true });
  await verify.getByLabel('No expiry', { exact: true }).check();
  await verify.getByRole('button', { name: 'I reviewed this revision', exact: true }).click();
  await expect(verify).toBeHidden();
  const verified = (await get(`/api/status/page/${main.pageId}`)).verification;
  assert.equal(verified.state, 'current');
  assert.equal(verified.verifier.id, 'browser-owner');
  assert.equal(verified.revision_id, (await get(`/api/pages/${main.pageId}`)).workingRevisionId);
  await closeDetails(page);
  const titleRow = page.locator('.page-title-row');
  const statusAction = titleRow.getByRole('button', { name: 'Status', exact: true });
  await page.mouse.move(0, 0);
  await expect(titleRow.locator('.page-title-actions')).toHaveCSS('opacity', '0');
  await page.getByRole('textbox', { name: 'Page title', exact: true }).hover();
  await expect(titleRow.locator('.page-title-actions')).toHaveCSS('opacity', '1');
  await statusAction.click();
  await expect(page.getByRole('combobox', { name: 'Set page status', exact: true })).toBeVisible();
  await closeDetails(page);
  await statusAction.focus();
  await expect(titleRow.locator('.page-title-actions')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Set page status', exact: true })).toBeVisible();
  await closeDetails(page);
  const crumb = page.getByRole('navigation', { name: 'Location', exact: true }).locator('li').last();
  await expect(crumb.locator('[aria-current="page"]')).toHaveText('Status profile handbook');
  await expect(crumb.locator('.page-status-chip')).toContainText('Verified · Alex Owner · no expiry');
  await expect(crumb.locator('.page-status-chip')).toBeInViewport();
  await expect(page.locator('.page-byline .page-status-chip')).toHaveCount(0);
  for (const icon of await page.locator('.page-topbar .icon-action:visible').all()) {
    assert.ok(await icon.getAttribute('data-tooltip'), 'Every visible icon action has a tooltip.');
  }
  const comments = page.locator('.page-topbar').getByRole('button', { name: 'Comments', exact: true });
  await comments.hover();
  await expect.poll(() => comments.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
  await page.mouse.move(0, 0);
  await comments.focus();
  assert.equal(await comments.evaluate(element => getComputedStyle(element, '::after').opacity), '1', 'Keyboard focus shows the tooltip immediately.');
  await accessible(page, 'human verification profile');
  await page.screenshot({ path: `.artifacts/ui-convergence/status-profile-verification-${width}.png`, fullPage: true });

  const beforeVocabulary = await vocabulary(), beforePages = await snapshots();
  await switchProfile('open-vocabulary');
  assert.deepEqual(await vocabulary(), beforeVocabulary);
  assert.deepEqual(await snapshots(), beforePages, 'Exposing the vocabulary rewrites no page, content or revision.');
  await openPanel(main.pageId);
  assert.deepEqual((await options()).sort(), [...entries.map(([key]) => key), '__clear'].sort());
  await expect(page.locator('.page-topbar .page-status-chip')).toHaveCount(0);
  await expect(statusAction).toHaveCount(0);
  await expect(page.locator('.page-byline .page-status-chip')).toContainText('Verified');
  assert.deepEqual(await page.locator('.page-byline > *').evaluateAll(nodes => nodes.map(node => node.className).filter(name => ['byline-author', 'page-status-chip', 'byline-reading-time'].includes(name))), ['byline-author', 'page-status-chip', 'byline-reading-time']);
  await expect(page.locator('.byline-author')).toHaveText('By Alex Owner');
  await expect(page.locator('.byline-reading-time')).toHaveText('1 min read');
  await page.getByRole('button', { name: 'Create a custom status', exact: true }).click();
  const custom = page.getByRole('dialog', { name: 'Create custom page status', exact: true });
  await expect(custom.getByLabel('Status colour')).toBeVisible();
  const label = custom.getByLabel('Custom status label');
  await label.fill('synthetic-slate-12345');
  await expect(label).toHaveValue('synthetic-slate-1234');
  await custom.getByLabel('Status colour').fill('#445599');
  await accessible(page, 'custom status controls');
  await page.screenshot({ path: `.artifacts/ui-convergence/status-profile-custom-${width}.png`, fullPage: true });
  await custom.getByRole('button', { name: 'Create and set status', exact: true }).click();
  await expect(custom).toBeHidden();
  await expect(page.locator('.page-byline .page-status-chip')).toHaveText('synthetic-slate-1234');
  await expect(page.locator('.page-byline .status-colour')).toHaveCSS('background-color', 'rgb(68, 85, 153)');
  await closeDetails(page);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.page-byline .page-status-chip')).toHaveText('synthetic-slate-1234');
  await accessible(page, 'open vocabulary profile');
  await page.screenshot({ path: `.artifacts/ui-convergence/status-profile-open-${width}.png`, fullPage: true });

  const storedVocabulary = await vocabulary(), storedPages = await snapshots();
  const customEntry = storedVocabulary.find(entry => entry.label === 'synthetic-slate-1234');
  assert.equal(customEntry.color, '#445599');
  assert.equal(storedPages[0].properties.statusKey, customEntry.key);
  const tooLong = await call(context, origin, 'POST', '/api/status', { operationKey: randomUUID(), key: customEntry.key, label: 'synthetic-slate-12345', color: '#445599', requiresVerification: false });
  assert.equal(tooLong.status, 400, 'The public door enforces the label limit independently of the input.');
  assert.deepEqual(await vocabulary(), storedVocabulary);

  await withSecondPerson(state, width, async ({ bob }) => {
    await grant(context, origin, main.pageId, bob.id, 'edit');
    const before = await snapshots();
    const refused = await call(bob.context, origin, 'POST', '/api/status', { operationKey: randomUUID(), key: customEntry.key, label: 'Member overwrite', color: '#112233', requiresVerification: false });
    assert.equal(refused.status, 403, 'Editing a page gives no vocabulary authority.');
    assert.deepEqual(await vocabulary(), storedVocabulary);
    const unopened = await call(bob.context, origin, 'POST', `/api/status/page/${main.pageId}`, { operationKey: randomUUID(), expectedRevisionId: before[0].page.revisionId, statusKey: 'verified', attestRevisionId: before[0].workingRevisionId });
    assert.equal(unopened.status, 409);
    assert.equal(unopened.body.code, 'REVISION_NOT_OPENED');
    assert.deepEqual(await snapshots(), before, 'A refused attestation changes nothing.');
    await bob.page.goto(route(main.pageId) + '?detail=status', { waitUntil: 'networkidle' });
    await expect(bob.page.getByRole('button', { name: 'Create a custom status', exact: true })).toHaveCount(0);
    assert.deepEqual((await bob.page.getByRole('combobox', { name: 'Set page status', exact: true }).locator('option:not([disabled])').evaluateAll(nodes => nodes.map(node => node.value))).sort(), [...storedVocabulary.map(entry => entry.key), '__clear'].sort());
  });

  await switchProfile('verification-only');
  assert.deepEqual(await vocabulary(), storedVocabulary);
  assert.deepEqual(await snapshots(), storedPages, 'Hiding a custom status preserves all assignments, content and history.');
  await openPanel(main.pageId);
  assert.deepEqual((await options()).sort(), ['verified', 'reviewed', '__clear'].sort());
  await expect(page.getByRole('button', { name: 'Create a custom status', exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await expect(page.locator('.page-status-chip')).toHaveCount(0);
  await switchProfile('open-vocabulary');
  assert.deepEqual(await vocabulary(), storedVocabulary);
  assert.deepEqual(await snapshots(), storedPages, 'Showing custom statuses again preserves all stored page bytes.');
  await page.goto(route(main.pageId), { waitUntil: 'networkidle' });
  await expect(page.locator('.page-byline .page-status-chip')).toHaveText('synthetic-slate-1234');
  await page.goto(route(other.pageId), { waitUntil: 'networkidle' });
  await expect(page.locator('.page-byline .page-status-chip')).toHaveText('Rough draft');
  // Restore the default for the remaining steps in the shared workspace.
  await switchProfile('verification-only');
}
