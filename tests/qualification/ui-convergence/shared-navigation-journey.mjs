import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { root } from '../../e2e/runtime-harness.mjs';
import { openNavigation } from './browser-support.mjs';
import { accessible } from './browser-evidence.mjs';
import { grant, ok } from './two-people-support.mjs';
import { linkAccessJourney } from './link-access-journey.mjs';

/** TREE-003: one page invitation exposes its named space, never its private neighbours. */
export async function sharedNavigationJourney(state, people) {
  const { origin } = state;
  const { alice, bob } = people;
  const width = bob.page.viewportSize().width;
  const evidence = path.join(root, '.artifacts/ui-convergence');
  await mkdir(evidence, { recursive: true });
  const shot = label => bob.page.screenshot({ path: path.join(evidence, `shared-navigation-${width}-${label}.png`), fullPage: true });
  const space = (await ok(alice.context, origin, 'POST', '/api/containers', {
    operationKey: randomUUID(), name: 'Supplier operations', visibility: 'private',
  })).value.id;
  const create = async (title, parentPageId) => (await ok(alice.context, origin, 'POST', '/api/pages', {
    operationKey: randomUUID(), containerId: space, parentPageId, title,
    blocks: [{ id: randomUUID(), blockType: 'paragraph', treePosition: 'a', content: { text: [{ text: 'Call the supplier duty manager for urgent delivery problems.' }] } }],
  })).value.pageId;
  const parent = await create('Confidential supplier negotiations');
  const shared = await create('Supplier escalation contacts', parent);
  const sibling = await create('Unannounced supplier change', parent);
  await grant(alice.context, origin, shared, bob.id, 'view');
  const readerTree = await ok(bob.context, origin, 'GET', '/api/pages');
  assert.ok(readerTree.items.some(page => page.id === shared && page.sharedWithMe && page.containerLabel === 'Supplier operations'));
  assert.ok(!readerTree.items.some(page => page.id === parent || page.id === sibling));
  const readerSpaces = await ok(bob.context, origin, 'GET', '/api/containers');
  assert.ok(!readerSpaces.items.some(item => item.id === space), 'The invitation does not grant space membership or discovery.');

  await bob.page.goto(origin + '/app', { waitUntil: 'networkidle' });
  await openNavigation(bob.page);
  const pages = bob.page.getByRole('navigation', { name: 'Pages', exact: true });
  const sharedSection = pages.getByRole('region', { name: 'Shared with me', exact: true });
  await expect(sharedSection).toBeVisible();
  await expect(sharedSection.locator('summary')).toHaveText('Supplier operations');
  const link = sharedSection.getByRole('link', { name: 'Supplier escalation contacts', exact: true });
  await expect(link).toBeVisible();
  await expect(pages.getByRole('link', { name: 'Confidential supplier negotiations', exact: true })).toHaveCount(0);
  await expect(pages.getByRole('link', { name: 'Unannounced supplier change', exact: true })).toHaveCount(0);
  const filter = sharedSection.getByRole('textbox', { name: 'Filter pages in Shared with me · Supplier operations', exact: true });
  await filter.fill('escalation');
  await expect(link).toBeVisible();
  await sharedSection.getByRole('button', { name: 'Clear page filter in Shared with me · Supplier operations', exact: true }).click();
  await expect(filter).toBeFocused();
  await accessible(bob.page, 'individual page invitation in named shared space');
  await shot('granted');
  await link.click();
  await expect(bob.page).toHaveURL(`${origin}/app/pages/${shared}`);
  await expect(bob.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Supplier escalation contacts');
  await expect(bob.page.locator('[data-page-editor]')).toContainText('Call the supplier duty manager');
  await shot('opened');

  // Leave the reader on Home: the first subsequent document load must already
  // omit the removed invitation, without opening the denied page or retrying.
  await bob.page.goto(origin + '/app', { waitUntil: 'networkidle' });
  await openNavigation(bob.page);
  await expect(link).toBeVisible();
  await alice.page.goto(`${origin}/app/pages/${shared}?detail=share`, { waitUntil: 'networkidle' });
  const row = alice.page.locator('.grant-list > li').filter({
    has: alice.page.getByRole('combobox', { name: 'Access for Morgan Reader', exact: true }),
  });
  await row.locator('summary').filter({ hasText: 'Expiry & removal' }).click();
  await row.getByRole('button', { name: 'Remove access', exact: true }).click();
  await expect(alice.page.locator('.grant-list > li').filter({ hasText: 'Morgan Reader' }).getByRole('button', { name: 'Regrant access', exact: true })).toBeVisible();
  await bob.page.reload({ waitUntil: 'networkidle' });
  await openNavigation(bob.page);
  await expect(pages.getByRole('link', { name: 'Supplier escalation contacts', exact: true })).toHaveCount(0);
  await expect(sharedSection).toHaveCount(0);
  const after = await ok(bob.context, origin, 'GET', '/api/pages');
  assert.ok(!after.items.some(page => page.id === shared), 'The first fresh tree has no removed invitation.');
  await accessible(bob.page, 'removed page invitation absent on first load');
  await shot('revoked');
  await linkAccessJourney(state, people, shared, space);
}
