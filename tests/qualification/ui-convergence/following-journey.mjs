import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible, openPageAction } from './browser-support.mjs';
import { ok, restrictedPage } from './two-people-support.mjs';
import { homeJourney } from './home-journey.mjs';
import { inboxJourney } from './inbox-journey.mjs';

const title = 'Quarterly plan', hidden = 'Board salaries';

/**
 * CONT-012 in two browsers: Morgan watches the Handbook space. Alex creates a
 * page, edits it in two sessions, comments on it after Morgan also watches it
 * directly, and creates a restricted page Morgan cannot read. Morgan's Home
 * Following section shows exactly the four events, once each, and nothing for
 * the restricted page.
 */
export async function followingJourney(state, people) {
  const { alice, bob } = people, origin = state.origin;
  const space = (await ok(alice.context, origin, 'GET', '/api/containers')).items.find(item => item.name === 'Handbook');
  await ok(alice.context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), targetKind: 'container', targetId: space.id, principalKind: 'member', principalId: bob.id, level: 'comment' });

  await bob.page.goto(`${origin}/app/containers/${space.id}`, { waitUntil: 'networkidle' });
  await bob.page.getByRole('button', { name: 'Watch space', exact: true }).click();
  await expect(bob.page.getByRole('button', { name: 'Stop watching space', exact: true })).toBeVisible();

  const pageId = (await ok(alice.context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, title })).value.pageId;
  const label = async labels => {
    const document = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
    await ok(alice.context, origin, 'PATCH', `/api/pages/${pageId}`, { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, properties: { labels } });
  };
  await label(['planning']);
  await label(['planning', 'q3']);
  // The first editing session ends once its idle window has passed: stored clock state, written with the Worker stopped.
  await state.atRest(`UPDATE watch_edit_sessions SET last_edit_at='${new Date(Date.now() - 86400000).toISOString()}' WHERE page_id='${pageId}';`);
  await label(['planning', 'q3', 'final']);
  await restrictedPage({ context: alice.context, origin }, hidden, ['Compensation bands for the board.']);

  await bob.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  await openPageAction(bob.page, 'Watch this page');
  await expect.poll(async () => (await ok(bob.context, origin, 'GET', '/api/navigation')).watches).toContain(pageId);
  await ok(alice.context, origin, 'POST', `/api/comments/page/${pageId}`, { operationKey: randomUUID(), body: [{ text: 'Budget numbers are in.' }] });

  await bob.page.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  const following = bob.page.getByRole('region', { name: 'Following' });
  const updates = following.locator('li').filter({ hasText: title });
  await expect(updates).toHaveCount(4);
  const kinds = (await updates.locator('.outcome-kind').allTextContents()).map(text => text.replace(' · Unread', '')).sort();
  assert.deepEqual(kinds, ['comment', 'page created', 'page edited', 'page edited']);
  await expect(following.locator('li').filter({ hasText: hidden })).toHaveCount(0);
  await accessible(bob.page, 'home following');
  await people.shot('bob', 'home following');
  const overflow = await bob.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `Home does not scroll sideways (${overflow}px).`);
  assert.equal((await ok(bob.context, origin, 'GET', '/api/notifications')).items.filter(item => item.pageId === pageId).length, 4, 'The inbox holds the same four items.');

  await updates.filter({ has: bob.page.locator('.outcome-kind').filter({ hasText: /^comment\b/ }) }).getByRole('link').click();
  await bob.page.waitForURL(url => url.pathname === `/app/pages/${pageId}`);
  await expect(bob.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(title);
  await people.shot('bob', 'following opened');
  await homeJourney(state, people);
  await inboxJourney(state, people);
}
