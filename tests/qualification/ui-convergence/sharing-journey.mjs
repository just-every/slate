import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { accessible, closeDetails } from './browser-support.mjs';
import { expiryRegrantJourney } from './expiry-journey.mjs';
import { call, ok } from './two-people-support.mjs';

export async function shareJourney(state, pageId) {
  const { page, origin, api, readerCookie, switchIdentity } = state;
  await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const panel = page.locator('.right');
  await expect(panel.getByRole('heading', { name: 'Share this page' })).toBeVisible();
  assert.ok(await panel.evaluate(element => element.contains(document.activeElement)), 'Share opens with keyboard focus inside its panel.');
  const invite = page.getByRole('combobox', { name: 'Invite someone', exact: true });
  await expect(invite).toBeVisible();
  const inviteBox = await invite.boundingBox();
  const disclosureBox = await panel.locator('.advanced-access').boundingBox();
  assert.ok(inviteBox && disclosureBox && inviteBox.y < disclosureBox.y, 'Invite controls precede inherited-access disclosure.');
  const copyBox = await panel.getByRole('button', { name: 'Copy page link', exact: true }).boundingBox();
  assert.ok(copyBox && copyBox.y < disclosureBox.y, 'Copy link precedes inherited-access disclosure.');
  assert.equal(await panel.locator('.advanced-access').getAttribute('open'), null, 'Inherited access is initially collapsed.');
  await expect(panel.getByRole('button', { name: 'Remove access', exact: true })).toHaveCount(0);
  await expect(panel).not.toContainText(/\bContainers?\b/);
  const dateInputs = await panel.locator('input[type="datetime-local"]').count();
  assert.equal(dateInputs, 0, 'Share uses the app date convention rather than native locale-dependent datetime fields.');
  await invite.selectOption('member:browser-reader');
  await page.getByRole('combobox', { name: 'Permission', exact: true }).selectOption('view');
  await panel.locator('form').first().locator('summary').filter({ hasText: 'Set an access expiry' }).click();
  await panel.locator('form').first().getByRole('textbox', { name: 'Access expiry date and time', exact: true }).fill('31 Dec 2099, 16:30');
  await panel.locator('form').first().getByRole('textbox', { name: 'Access expiry date and time', exact: true }).blur();
  const submittedExpiry = await panel.locator('form').first().locator('input[type="hidden"][name="expiresAt"]').inputValue();
  await expect(panel.locator('form').first()).toContainText('Day month year, 24-hour time');
  await accessible(page, 'share invite');
  await page.getByRole('button', { name: 'Share page', exact: true }).click();
  await panel.locator('.advanced-access summary').first().click();
  await expect(page.getByRole('combobox', { name: 'Access for Morgan Reader', exact: true })).toBeVisible();
  await expect(panel.locator('.grant-list')).toContainText('31 Dec 2099');
  const grants = await api(`/api/sharing/pages/${pageId}`);
  assert.ok(grants.items.some(grant => grant.principalId === 'browser-reader' && grant.level === 'view' && !grant.revokedAt));
  assert.equal(new Date(grants.items.find(grant => grant.principalId === 'browser-reader').expiresAt).getFullYear(), 2099);
  const storedExpiry = grants.items.find(grant => grant.principalId === 'browser-reader').expiresAt;
  const readerGrant = panel.locator('.grant-list > li').filter({
    has: page.getByRole('combobox', { name: 'Access for Morgan Reader', exact: true }),
  });
  await expect(readerGrant).toHaveCount(1);
  await readerGrant.locator('details summary').click();
  const displayedExpiry = await readerGrant.getByRole('textbox', { name: 'Access expiry date and time', exact: true }).inputValue();
  assert.equal(displayedExpiry, '31 Dec 2099, 16:30');
  assert.equal(submittedExpiry, storedExpiry, 'Displayed and submitted expiry agree with the real grant.');
  const readerDocument = await api(`/api/pages/${pageId}`, { headers: { cookie: readerCookie } });
  assert.equal(readerDocument.page.id, pageId);
  assert.equal(readerDocument.permissions.level, 'view');
  await page.getByRole('button', { name: 'Copy page link', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}/app/pages/${pageId}`);
  await accessible(page, 'shared page link');
  await expiryRegrantJourney({ page, api }, pageId);
  await closeDetails(page);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeFocused();
  await switchIdentity('reader');
  try {
    await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('member-name')).toHaveText('Morgan Reader');
    await expect(page.locator('.page-document')).toContainText('Keep this unsent detail.');
    await expect(page.locator('.page-document')).toContainText('Second block: record the next action.');
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveAttribute('readonly', '');
    assert.equal(await page.locator('.page-document [contenteditable="true"]').count(), 0, 'The granted reader renders committed content without editable controls.');
    await accessible(page, 'granted reader page');
  } finally { await switchIdentity('owner'); }

  await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const ownerPanel = page.locator('.right');
  await ownerPanel.locator('.advanced-access > summary').click();
  const ownerGrant = ownerPanel.locator('.grant-list > li').filter({
    has: page.getByRole('combobox', { name: 'Access for Morgan Reader', exact: true }),
  });
  await expect(ownerGrant.getByRole('combobox', { name: 'Access for Morgan Reader', exact: true })).toBeVisible();
  await ownerGrant.locator('details summary').click();
  await ownerGrant.getByRole('button', { name: 'Remove access', exact: true }).click();
  await expect.poll(async () => (await api(`/api/sharing/pages/${pageId}`)).items.find(item => item.principalId === 'browser-reader').revokedAt).not.toBeNull();
  const activityLink = page.locator('a[href="/app/settings?section=activity"]');
  await expect(activityLink).toBeVisible();
  await activityLink.click();
  await page.waitForURL(url => url.pathname === '/app/settings' && url.searchParams.get('section') === 'activity');
  await expect(page.getByRole('heading', { name: 'What changed.', exact: true })).toBeVisible();
  assert.ok((await api(`/api/sharing/pages/${pageId}`)).items.find(item => item.principalId === 'browser-reader').revokedAt, 'Opening Activity leaves the removed page grant revoked.');
  await grantCorpusJourney(state);
}

/** Native grants, rather than seeded ACL rows, drive the loaded Share panel. */
async function grantCorpusJourney({ page, context, origin, api, readerCookie }) {
  const mutate = (route, data, method = 'POST') => ok(context, origin, method, route, { ...data, operationKey: crypto.randomUUID() });
  const space = (await mutate('/api/containers', { name: 'Sharing corpus', visibility: 'private' })).value.id;
  const parent = (await mutate('/api/pages', { containerId: space, title: 'Grant source' })).value.pageId;
  const child = (await mutate('/api/pages', { containerId: space, parentPageId: parent, title: 'Grant recipient' })).value.pageId;
  const group = (await mutate('/api/groups', { name: 'Sharing editors', memberIds: ['browser-owner'] })).value.id;
  const future = '2099-12-30T15:45:00.000Z', past = '2000-01-02T12:00:00.000Z';
  const grant = async (targetKind, targetId, principalKind, principalId, level, expiresAt = null) => {
    const input = { operationKey: crypto.randomUUID(), targetKind, targetId, principalKind, principalId, level, expiresAt };
    return { ...input, id: (await ok(context, origin, 'POST', '/api/sharing', input)).value.id };
  };
  // Keep an independent record of the requests and returned grant ids. The API
  // projection and the panel must both agree with this corpus after reload.
  const own = [];
  own.push(await grant('page', child, 'member', 'browser-owner', 'full'));
  own.push(await grant('page', child, 'member', 'browser-reader', 'view', future));
  own.push(await grant('page', child, 'group', group, 'edit'));
  own.push(await grant('page', child, 'container', space, 'comment', future));
  const ancestor = [await grant('page', parent, 'member', 'browser-reader', 'comment', future),
    await grant('page', parent, 'group', group, 'full')];
  const general = await grant('container', space, 'workspace', 'browser-workspace', 'view', future);
  const fields = item => [item.id, item.principalKind, item.principalId, item.level, item.expiresAt];
  const containerRows = (await api(`/api/sharing/containers/${space}`)).items;
  assert.equal(containerRows.length, 2, 'The native space has only its creator and the added workspace grant.');
  assert.deepEqual(fields(containerRows.find(item => item.id === general.id)), fields(general), 'The inherited workspace grant retains the submitted principal, level and expiry.');
  assert.deepEqual(new Set(own.map(item => item.level)), new Set((await api('/api/sharing/configuration')).levels));
  const project = () => api(`/api/sharing/pages/${child}`);
  const readAsReader = () => api(`/api/pages/${child}`, { headers: { cookie: readerCookie } });
  const label = level => ({ full: 'Manage access', edit: 'Edit', comment: 'Comment', view: 'View' })[level];
  const panel = page.locator('.right');
  async function inspect(expectedOwn, expectedInherited, screenshot) {
    const projection = await project();
    assert.deepEqual(projection.items.map(fields), expectedOwn.map(fields), 'Direct grants retain native creation order and values.');
    assert.deepEqual(projection.inheritedItems.map(fields).sort(), expectedInherited.map(fields).sort(), 'All and only traversed ancestor and container grants are returned.');
    assert.deepEqual(projection.effectiveItems.map(item => item.id).sort(),
      [...expectedOwn, ...expectedInherited].filter(item => !item.revokedAt && (!item.expiresAt || item.expiresAt === future)).map(item => item.id).sort(), 'Expired and revoked grants never enter the effective list.');
    await page.goto(`${origin}/app/pages/${child}`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Share this page', exact: true })).toBeVisible();
    await expect(panel.locator('.grant-list > li')).toHaveCount(expectedOwn.length);
    assert.deepEqual(await panel.locator('.grant-list > li').evaluateAll(rows => rows.map(row => row.dataset.grantId)), expectedOwn.map(item => item.id));
    await expect(panel.locator('.inherited-grant-list > li')).toHaveCount(expectedInherited.length);
    for (const item of [...projection.items, ...projection.inheritedItems]) {
      const row = panel.locator(`[data-grant-id="${item.id}"]`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(item.principalLabel);
      if (item.inherited) {
        assert.equal(item.origin.kind, ancestor.some(grant => grant.id === item.id) ? 'page' : 'container');
        assert.equal(item.origin.id, item.origin.kind === 'page' ? parent : space);
        assert.equal(item.origin.name, item.origin.kind === 'page' ? 'Grant source' : 'Sharing corpus');
        await expect(row).toContainText(`From ${item.origin.name}`);
        await expect(row).toContainText(label(item.level));
        await expect(row).toContainText(item.status);
        await expect(row.getByRole('combobox')).toHaveCount(0);
      } else if (item.revokedAt) await expect(row).toContainText('Revoked');
      else await expect(row.getByRole('combobox')).toHaveValue(item.level);
      if (item.expiresAt) {
        const date = await page.evaluate(value => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)), item.expiresAt);
        await expect(row).toContainText(`${item.status === 'expired' ? 'Expired' : 'Expires'} ${date}`);
      } else await expect(row).not.toContainText(/Expires |Expired /);
    }
    if (screenshot) await accessible(page, screenshot);
    return projection;
  }
  await inspect(own, [...ancestor, ...containerRows], 'all effective direct and inherited grants with expiry');
  assert.equal((await readAsReader()).permissions.level, 'comment');

  const reader = await context.browser().newContext();
  await reader.addCookies([{ name: 'slate_session', value: readerCookie.split('=')[1], url: origin }]);
  try {
    const before = await project();
    assert.equal((await call(reader, origin, 'GET', `/api/sharing/pages/${child}`)).status, 404);
    assert.equal((await call(reader, origin, 'POST', '/api/sharing', { ...own[1], id: own[1].id, operationKey: crypto.randomUUID(), level: 'full' })).status, 404);
    assert.deepEqual(await project(), before, 'A reader cannot expose or change the grant inventory.');
  } finally { await reader.close(); }

  // A page has one general grant. Replacing the container principal with the
  // workspace principal leaves every person and group grant intact.
  own[3] = await grant('page', child, 'workspace', 'browser-workspace', 'comment');
  await inspect(own, [...ancestor, ...containerRows]);
  assert.equal((await readAsReader()).permissions.level, 'comment');
  await panel.locator('.advanced-access > summary').click();
  await panel.getByRole('button', { name: 'Restrict inherited access', exact: true }).click();
  await expect.poll(async () => (await project()).restricted).toBe(true);
  await inspect(own, [], 'restricted page retains only direct grants');
  assert.equal((await readAsReader()).permissions.level, 'comment', 'Direct workspace access survives the inheritance restriction.');

  // Expire the direct general grant and revoke the direct person grant, then
  // replay its original capture. Neither inactive grant may regain authority.
  own[3].expiresAt = past;
  await mutate('/api/sharing', own[3]);
  await mutate('/api/sharing', { ...own[1], revoke: true });
  own[1].revokedAt = (await project()).items.find(item => item.id === own[1].id).revokedAt;
  await ok(context, origin, 'POST', '/api/sharing', { ...own[1], id: undefined, revokedAt: undefined });
  assert.ok((await project()).items.find(item => item.id === own[1].id).revokedAt, 'A replay cannot restore a revoked grant.');
  await inspect(own, [], 'revoked and expired direct grants remain inactive after replay');
  const denied = await context.request.get(origin + `/api/pages/${child}`, { headers: { cookie: readerCookie } });
  assert.equal(denied.status(), 404);

  await panel.locator('.advanced-access > summary').click();
  await panel.getByRole('button', { name: 'Restore inherited access', exact: true }).click();
  await expect.poll(async () => (await project()).restricted).toBe(false);
  await inspect(own, [...ancestor, ...containerRows]);
  assert.equal((await readAsReader()).permissions.level, 'comment', 'Restoring inheritance uses the ancestor grant without copying it.');
  ancestor[0].expiresAt = past;
  await mutate('/api/sharing', ancestor[0]);
  await inspect(own, [...ancestor, ...containerRows], 'expired ancestor grant preserves source and expiry');
  assert.equal((await readAsReader()).permissions.level, 'view', 'An expired ancestor grant falls back to current space access.');
  await mutate('/api/sharing', { ...general, revokedAt: undefined, revoke: true });
  containerRows.find(item => item.id === general.id).revokedAt = (await project()).inheritedItems.find(item => item.id === general.id).revokedAt;
  await inspect(own, [...ancestor, ...containerRows]);
  const revoked = await context.request.get(origin + `/api/pages/${child}`, { headers: { cookie: readerCookie } });
  assert.equal(revoked.status(), 404, 'Revoked and expired inherited grants disclose no page.');
}
