import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible, openNavigation, openPageAction } from './browser-support.mjs';
import { grant, ok } from './two-people-support.mjs';

const keys = items => items.map(({ kind, id }) => `${kind}:${id}`);
const navigation = (person, origin) => ok(person.context, origin, 'GET', '/api/navigation');

/** Read the complete personal list through both public doors after a fresh load. */
async function listed(person, origin, expected) {
  assert.deepEqual(keys((await navigation(person, origin)).favourites), keys(expected));
  await person.page.goto(origin + '/app', { waitUntil: 'networkidle' });
  await openNavigation(person.page);
  const favourites = person.page.getByRole('navigation', { name: 'Favourites', exact: true });
  if (!expected.length) await expect(favourites).toHaveCount(0);
  else {
    await expect(favourites.locator('.favourite-row > a')).toHaveText(expected.map(item => item.title));
    assert.deepEqual(await favourites.locator('.favourite-row > a').evaluateAll(links => links.map(link => link.getAttribute('href'))), expected.map(item => item.href));
  }
}

/** Observe the native mutation, including its committed receipt, without replacing it. */
async function change(person, origin, target, enabled, action) {
  const committed = person.page.waitForResponse(response => new URL(response.url()).pathname === '/api/navigation/favourites' && response.request().method() === 'PUT' && response.request().postDataJSON().id === target.id);
  await action();
  const response = await committed;
  assert.equal(response.status(), 200, await response.text());
  const sent = response.request().postDataJSON(), result = await response.json();
  assert.equal(sent.kind, target.kind);
  assert.equal(sent.id, target.id);
  assert.equal(sent.enabled, enabled);
  assert.deepEqual(result.value, { id: target.id, enabled });
  assert.equal(result.receipt.operationKey, sent.operationKey);
  assert.ok(result.receipt.revisionId && result.receipt.committedAt);
  await expect.poll(async () => (await navigation(person, origin)).favourites.some(item => item.kind === target.kind && item.id === target.id)).toBe(enabled);
}

async function toggle(person, origin, target, enabled) {
  await person.page.goto(origin + target.href, { waitUntil: 'networkidle' });
  const label = enabled ? 'Add to favourites' : 'Remove from favourites';
  await change(person, origin, target, enabled, () => target.kind === 'page'
    ? openPageAction(person.page, label)
    : person.page.getByRole('button', { name: label, exact: true }).click());
  // The page menu deliberately stays open so its new state can be seen.
  const menuOpen = await person.page.getByRole('menu').isVisible();
  const current = person.page.getByRole(menuOpen ? 'menuitem' : 'button', { name: enabled ? 'Remove from favourites' : 'Add to favourites', exact: true });
  await expect(current).toBeVisible();
  if (menuOpen) await person.page.keyboard.press('Escape');
}

/** Personal toggles and ordered navigation for two members who can read every target. */
export async function favouritesJourney(state, people) {
  const { alice, bob } = people, { origin } = state;
  const space = (await ok(alice.context, origin, 'POST', '/api/containers', { operationKey: randomUUID(), name: 'Shared navigation examples', visibility: 'open' })).value.id;
  const targets = [{ kind: 'container', id: space, title: 'Shared navigation examples', href: `/app/containers/${space}` }];
  for (const title of ['Team launch notes', 'Team support rota']) {
    const id = (await ok(alice.context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space, title })).value.pageId;
    await grant(alice.context, origin, id, bob.id, 'view');
    targets.push({ kind: 'page', id, title, href: `/app/pages/${id}` });
  }
  for (const person of [alice, bob]) {
    assert.equal((await ok(person.context, origin, 'GET', `/api/containers/${space}`)).name, targets[0].title);
    for (const target of targets.slice(1)) assert.equal((await ok(person.context, origin, 'GET', `/api/pages/${target.id}`)).page.title, target.title);
  }
  const aliceBefore = (await navigation(alice, origin)).favourites;
  const bobBefore = (await navigation(bob, origin)).favourites;
  for (const target of targets) await toggle(alice, origin, target, true);
  const added = (await navigation(alice, origin)).favourites;
  assert.deepEqual(new Set(keys(added)), new Set(keys([...aliceBefore, ...targets])));
  for (const target of targets) {
    const item = added.find(item => item.kind === target.kind && item.id === target.id);
    assert.equal(item.title, target.title);
    assert.equal(item.href, target.href);
  }
  await listed(alice, origin, added);
  await listed(bob, origin, bobBefore);
  // Readability is unchanged: the empty personal list is not an ACL refusal.
  assert.equal((await ok(bob.context, origin, 'GET', `/api/pages/${targets[1].id}`)).page.title, targets[1].title);

  for (const target of targets.slice(0, 2)) {
    await toggle(bob, origin, target, true);
    const bobAdded = (await navigation(bob, origin)).favourites;
    assert.deepEqual(new Set(keys(bobAdded)), new Set(keys([...bobBefore, target])));
    await listed(bob, origin, bobAdded);
    await listed(alice, origin, added);
    await toggle(bob, origin, target, false);
    await listed(bob, origin, bobBefore);
    await listed(alice, origin, added);
    await toggle(alice, origin, target, false);
    await listed(alice, origin, added.filter(item => item.id !== target.id));
    await toggle(alice, origin, target, true);
    await listed(alice, origin, added);
  }

  // Keep a populated second list while the first member reorders and removes.
  for (const target of [targets[2], targets[0]]) await toggle(bob, origin, target, true);
  const bobOrdered = (await navigation(bob, origin)).favourites;
  assert.deepEqual(new Set(keys(bobOrdered)), new Set(keys([...bobBefore, targets[2], targets[0]])));
  await listed(bob, origin, bobOrdered);
  await people.shot('bob', 'independent readable favourites');

  // Move the last item across several neighbours, including the default positions.
  // Each step independently derives the expected order from the previous list.
  let ordered = [...added];
  const moved = ordered.at(-1);
  for (let at = ordered.length - 1; at > 0; at--) {
    await alice.page.locator('.favourite-row').filter({ has: alice.page.locator(`a[href="${moved.href}"]`) }).hover();
    const control = alice.page.getByRole('button', { name: `Move ${moved.title} up`, exact: true });
    await expect(control).toHaveAttribute('data-tooltip', 'Move favourite');
    await change(alice, origin, moved, true, () => control.click());
    [ordered[at - 1], ordered[at]] = [ordered[at], ordered[at - 1]];
    await listed(alice, origin, ordered);
    await listed(bob, origin, bobOrdered);
  }
  const movedRow = alice.page.locator('.favourite-row').filter({ has: alice.page.locator(`a[href="${moved.href}"]`) });
  await movedRow.getByRole('link').focus();
  const moveControl = movedRow.getByRole('button', { name: `Move ${moved.title} up`, exact: true });
  await alice.page.keyboard.press('Tab');
  await expect(moveControl).toBeFocused();
  await expect.poll(() => moveControl.evaluate(element => Number(getComputedStyle(element, '::after').opacity))).toBeGreaterThanOrEqual(0.99);
  assert.ok(await movedRow.getByRole('link').evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 13));
  await accessible(alice.page, 'personal favourites in navigation');
  await people.shot('alice', 'ordered personal favourites');
  // One action removes each kind, leaving every untouched item in the same order.
  for (const target of targets.slice(0, 2)) {
    await alice.page.locator('.favourite-row').filter({ has: alice.page.locator(`a[href="${target.href}"]`) }).hover();
    const control = alice.page.getByRole('button', { name: `Unfavourite ${target.title}`, exact: true });
    await expect(control).toHaveAttribute('data-tooltip', 'Remove favourite');
    await change(alice, origin, target, false, () => control.click());
    ordered = ordered.filter(item => item.id !== target.id);
    await listed(alice, origin, ordered);
    await listed(bob, origin, bobOrdered);
    await alice.page.goto(origin + target.href, { waitUntil: 'networkidle' });
    if (target.kind === 'page' && !await alice.page.getByRole('button', { name: 'Add to favourites', exact: true }).isVisible()) {
      await alice.page.getByRole('button', { name: 'More', exact: true }).click();
      await expect(alice.page.getByRole('menuitem', { name: 'Add to favourites', exact: true })).toBeVisible();
      await alice.page.keyboard.press('Escape');
    } else await expect(alice.page.getByRole('button', { name: 'Add to favourites', exact: true })).toBeVisible();
    await accessible(alice.page, `unfavourited ${target.kind}`);
    await people.shot('alice', `unfavourited ${target.kind}`);
    await listed(alice, origin, ordered);
  }
}
