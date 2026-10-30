import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { openPageAction } from './browser-support.mjs';
import { call, grant, ok } from './two-people-support.mjs';
import { favouritesJourney } from './favourites-journey.mjs';

/** Populated personal Home, real destinations, and current access after revocation. */
export async function homeJourney(state, people) {
  const { alice, bob } = people, { origin } = state;
  const space = (await ok(alice.context, origin, 'GET', '/api/containers')).items.find(item => item.name === 'Handbook');
  const privateSpace = (await ok(alice.context, origin, 'POST', '/api/containers', { operationKey: randomUUID(), name: 'Personal navigation', visibility: 'private' })).value.id;
  const title = 'Personal release checklist';
  const created = (await ok(alice.context, origin, 'POST', '/api/pages', {
    operationKey: randomUUID(), containerId: privateSpace, title,
    blocks: [{ id: randomUUID(), blockType: 'paragraph', treePosition: 'a', content: { text: [{ text: 'Confirm the release owner before publishing.' }] } }],
  })).value;
  await alice.page.goto(`${origin}/app/pages/${created.pageId}`, { waitUntil: 'networkidle' });
  await openPageAction(alice.page, 'Add to favourites');
  await expect.poll(async () => (await ok(alice.context, origin, 'GET', '/api/navigation')).favourites.some(item => item.id === created.pageId)).toBe(true);
  await ok(alice.context, origin, 'PUT', '/api/navigation/favourites', { operationKey: randomUUID(), kind: 'container', id: space.id, enabled: true });
  await alice.page.goto(origin + '/app', { waitUntil: 'networkidle' });
  const home = alice.page.getByRole('main');
  const section = name => home.locator('.personal-home > section').filter({ has: alice.page.getByRole('heading', { name, exact: true }) });
  const recents = section('Recent pages'), favourites = section('Your favourites'), spaces = section('Your spaces');
  await expect(recents.getByRole('link', { name: title, exact: true })).toBeVisible();
  await expect(favourites.getByRole('link', { name: title, exact: true })).toBeVisible();
  await expect(favourites.getByRole('link', { name: 'Handbook', exact: true })).toBeVisible();
  await expect(spaces.getByRole('link', { name: 'Handbook', exact: true })).toBeVisible();
  await accessible(alice.page, 'populated personal Home');
  await people.shot('alice', 'personal home');
  for (const [area, name, destination] of [
    [recents, title, `/app/pages/${created.pageId}`],
    [favourites, title, `/app/pages/${created.pageId}`],
    [favourites, 'Handbook', `/app/containers/${space.id}`],
    [spaces, 'Handbook', `/app/containers/${space.id}`],
  ]) {
    await area.getByRole('link', { name, exact: true }).click();
    await expect(alice.page).toHaveURL(origin + destination);
    if (destination.includes('/pages/')) await expect(alice.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(title);
    else await expect(alice.page.getByRole('main')).toContainText('Handbook');
    await alice.page.goto(origin + '/app', { waitUntil: 'networkidle' });
  }

  const shared = await grant(alice.context, origin, created.pageId, bob.id, 'view');
  const beforeVisit = await ok(bob.context, origin, 'GET', '/api/navigation');
  assert.ok(!beforeVisit.recents.some(item => item.id === created.pageId));
  assert.ok(!beforeVisit.favourites.some(item => item.id === created.pageId));
  await bob.page.goto(`${origin}/app/pages/${created.pageId}`, { waitUntil: 'networkidle' });
  const capturedFavourite = { operationKey: randomUUID(), kind: 'page', id: created.pageId, enabled: true };
  await ok(bob.context, origin, 'PUT', '/api/navigation/favourites', capturedFavourite);
  await bob.page.goto(origin + '/app', { waitUntil: 'networkidle' });
  await expect(bob.page.getByRole('main').getByRole('link', { name: title, exact: true })).toHaveCount(2);
  // A second member's visit never becomes this member's recent or workspace feed.
  const privateTitle = 'Owner only launch budget';
  const privatePage = (await ok(alice.context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: privateSpace, title: privateTitle })).value.pageId;
  await alice.page.goto(`${origin}/app/pages/${privatePage}`, { waitUntil: 'networkidle' });
  await grant(alice.context, origin, created.pageId, bob.id, 'view', { id: shared.value.id, revoke: true });
  await bob.page.reload({ waitUntil: 'networkidle' });
  const replay = await call(bob.context, origin, 'PUT', '/api/navigation/favourites', capturedFavourite);
  assert.equal(replay.status, 404, 'Replaying a committed favourite after revocation cannot restore access or disclose its receipt.');
  const navigation = await ok(bob.context, origin, 'GET', '/api/navigation');
  assert.ok(!navigation.recents.some(item => item.id === created.pageId || item.id === privatePage));
  assert.ok(!navigation.favourites.some(item => item.id === created.pageId));
  assert.ok(!navigation.containers.some(item => item.id === privateSpace));
  await expect(bob.page.getByRole('main')).not.toContainText(title);
  await expect(bob.page.getByRole('main')).not.toContainText(privateTitle);
  await expect(bob.page.getByRole('main')).not.toContainText('Personal navigation');
  await accessible(bob.page, 'personal Home after access removal');
  await people.shot('bob', 'personal home access removed');
  const unwatchedTitle = 'Unwatched coordination note';
  const unwatched = (await ok(alice.context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: privateSpace, title: unwatchedTitle })).value.pageId;
  await grant(alice.context, origin, unwatched, bob.id, 'view');
  assert.equal((await ok(bob.context, origin, 'GET', `/api/pages/${unwatched}`)).page.title, unwatchedTitle);
  await bob.page.reload({ waitUntil: 'networkidle' });
  await expect(bob.page.getByRole('region', { name: 'Following', exact: true })).not.toContainText(unwatchedTitle);
  assert.ok(!(await ok(bob.context, origin, 'GET', '/api/navigation/following')).items.some(item => item.pageId === unwatched), 'Readable but unwatched activity does not become a workspace feed.');
  await favouritesJourney(state, people);
}
