import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { ok } from './two-people-support.mjs';
import { configureNavigation, navigationPolicies } from './navigation-configuration.mjs';

async function openNavigation(page) {
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.locator('.sidebar')).toBeVisible();
}

const links = locator => locator.evaluateAll(nodes => nodes.map(node => ({
  href: new URL(node.href).pathname,
  label: (node.querySelector('span')?.textContent ?? node.textContent).trim(),
})));

/** Populated native data, configuration, all policies, nesting and persisted collapse. */
export async function navigationJourney(state, width, { buyerSlot = false } = {}) {
  const { page, context, origin, api } = state;
  const mutate = (method, route, data) => ok(context, origin, method, route, { operationKey: randomUUID(), ...data });
  const member = await api('/api/members/current');
  const personal = (await api('/api/containers')).items.find(item => item.visibility === 'personal' && item.owners.some(owner => owner.memberId === member.id));
  assert.ok(personal, 'Native membership supplies the personal space.');
  const space = (await mutate('POST', '/api/containers', { name: 'Navigation response team', visibility: 'private' })).value;
  const make = async (containerId, title, parentPageId) => (await mutate('POST', '/api/pages', { containerId, title, parentPageId,
    blocks: [{ id: randomUUID(), blockType: 'paragraph', treePosition: 'a0', content: { text: [{ text: 'Keep the response plan usable while navigating.' }] } }],
  })).value.pageId;
  const root = await make(space.id, 'Response handbook');
  const child = await make(space.id, 'Response escalation', root);
  const privatePage = await make(personal.id, 'My response notes');
  const database = (await mutate('POST', '/api/databases', { containerId: space.id, title: 'Response tracker' })).value;
  await mutate('POST', `/api/pages/${root}/expansion`, { expanded: true });
  for (const [position, [kind, id]] of [['page', privatePage], ['container', space.id], ['database', database.id]].entries()) {
    await mutate('PUT', '/api/navigation/favourites', { kind, id, enabled: true, position });
  }
  const { original, destinations } = await configureNavigation(state);
  const sidebar = page.locator('.sidebar');
  const primary = sidebar.getByRole('navigation', { name: 'Workspace navigation', exact: true });
  const favourites = sidebar.getByRole('navigation', { name: 'Favourites', exact: true });
  const trees = sidebar.getByRole('navigation', { name: 'Pages', exact: true });
  const slot = sidebar.getByRole('navigation', { name: 'Buyer navigation', exact: true });
  const expectedGlobal = destinations.filter(item => item.visible).map(({ href, label }) => ({ href, label }));
  await openNavigation(page);
  await expect(primary.locator('a')).toHaveCount(expectedGlobal.length);
  assert.deepEqual(await links(primary.locator('a')), expectedGlobal, 'Native label, ordering and visibility changes render exactly after reload.');
  const favouriteData = (await api('/api/navigation')).favourites;
  assert.deepEqual(favouriteData.slice(0, 3).map(item => item.id), [privatePage, space.id, database.id]);
  assert.deepEqual(await links(favourites.locator('a')), favouriteData.map(({ href, title }) => ({ href, label: title })));
  const group = trees.locator('details.space-group').filter({ has: trees.locator('summary', { hasText: 'Navigation response team' }) });
  await expect(trees.locator(`a[href="/app/pages/${privatePage}"]`)).toBeVisible();
  await expect(trees.locator(`a[href="/app/pages/${child}"]`)).toBeVisible();
  assert.equal(await trees.locator(`a[href="/app/pages/${child}"]`).evaluate(anchor => new URL(anchor.closest('li').parentElement.closest('li').querySelector(':scope > .tree-row a').href).pathname), `/app/pages/${root}`);
  if (buyerSlot) {
    await expect(slot.getByRole('link', { name: 'Response library', exact: true })).toBeVisible();
    assert.ok(await slot.evaluate(element => {
      const tree = element.parentElement.querySelector('.page-links'), account = element.parentElement.querySelector('.workrow');
      return tree && account && !!(tree.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(element.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), 'The real buyer contribution occupies its declared slot after trees and before the account.');
  }
  const inventory = async () => ({ global: await links(primary.locator('a')), favourites: await links(favourites.locator('a')), tree: await links(trees.locator('a')), buyer: buyerSlot ? await links(slot.locator('a')) : [] });
  const baseline = await inventory();
  const reconcile = async () => {
    await openNavigation(page);
    await expect(primary.locator('a')).toHaveCount(expectedGlobal.length);
    await expect(trees.locator(`a[href="/app/pages/${child}"]`)).toBeVisible();
    if (buyerSlot) await expect(slot.locator('a')).toBeVisible();
    assert.deepEqual(await inventory(), baseline, 'Policy changes preserve every ordered sidebar entry, including personal data and buyer placement.');
    const navigation = await api('/api/navigation');
    assert.deepEqual(navigation.configuration.destinations, destinations);
    assert.deepEqual(navigation.favourites, favouriteData);
  };
  await mkdir('.artifacts/ui-convergence', { recursive: true });
  const shot = label => page.screenshot({ path: `.artifacts/ui-convergence/navigation-${buyerSlot ? 'buyer-' : ''}${width}-${label}.png`, fullPage: true });
  await shot('configured');
  console.log(`PROBE NAV-004 1: native Configure navigation at ${width} -> relabelled, reordered and hidden destinations reconcile with API`);
  await navigationPolicies(state, reconcile);
  await page.goto(`${origin}/app/containers/${space.id}`, { waitUntil: 'networkidle' });
  const local = page.getByRole('navigation', { name: 'Space navigation', exact: true });
  await expect(local).toBeVisible();
  await local.getByRole('button', { name: 'Content', exact: true }).click();
  await expect(page.locator('.space-detail').getByRole('link', { name: 'Response handbook', exact: true })).toBeVisible();
  await reconcile();
  await group.locator(':scope > summary').click();
  await expect(group).not.toHaveAttribute('open', '');
  assert.ok((await api('/api/navigation')).preferences.value.collapsedContainers.includes(space.id));
  await page.reload({ waitUntil: 'networkidle' });
  await openNavigation(page);
  await expect(group).not.toHaveAttribute('open', '');
  await group.locator(':scope > summary').click();
  await expect(trees.locator(`a[href="/app/pages/${child}"]`)).toBeVisible();
  await trees.locator(`a[href="/app/pages/${child}"]`).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Response escalation');
  if (width === 1440) {
    const before = await page.getByRole('main').boundingBox();
    const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
    await collapse.focus();
    assert.equal(await collapse.evaluate(element => getComputedStyle(element, '::after').opacity), '1', 'The icon tooltip appears immediately on focus.');
    await page.keyboard.press('Enter');
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
    const after = await page.getByRole('main').boundingBox();
    assert.ok(after.width > before.width, 'Collapsing the sidebar returns width to the page.');
    await expect(page.locator('[data-page-editor]')).toContainText('Keep the response plan usable');
    await shot('collapsed');
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  } else {
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-page-editor]')).toBeInViewport();
    await shot('content');
  }
  await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('Response escalation ready');
  await page.getByRole('textbox', { name: 'Page title', exact: true }).press('Tab');
  await expect.poll(async () => (await api(`/api/pages/${child}`)).page.title).toBe('Response escalation ready');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Response escalation ready');
  console.log(`PROBE NAV-004 2: nested container tree at ${width} -> same operator shell, persisted expansion and usable content after collapse`);
  console.log(`PROBE NAV-004 3: populated sidebar${buyerSlot ? ' with real built buyer slot' : ''} at ${width} -> all policy values retain exact ordered inventory`);
  // Restore this shared workspace's configuration for subsequent journeys.
  const current = await api('/api/navigation/configuration');
  await mutate('PUT', '/api/navigation/configuration', { expectedRevisionId: current.revisionId, destinations: original.destinations });
}
