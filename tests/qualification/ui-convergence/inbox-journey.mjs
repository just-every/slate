import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { ok } from './two-people-support.mjs';

/** Populated Inbox, recipient views, referenced comment, read and archive actions. */
export async function inboxJourney(state, people) {
  const { alice, bob } = people, { origin } = state;
  const space = (await ok(alice.context, origin, 'GET', '/api/containers')).items.find(item => item.name === 'Handbook');
  const title = 'Inbox handoff review';
  const pageId = (await ok(alice.context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, title })).value.pageId;
  await ok(bob.context, origin, 'PUT', '/api/navigation/watches', { operationKey: randomUUID(), pageId, enabled: true });
  const input = { operationKey: randomUUID(), body: [{ text: 'Please review the handoff. ' }, { text: bob.name, mention: { kind: 'person', id: bob.id, label: bob.name } }] };
  const comment = await ok(alice.context, origin, 'POST', `/api/comments/page/${pageId}`, input);
  await ok(alice.context, origin, 'POST', `/api/comments/page/${pageId}`, input);
  // Stored notification clock fixture: both periods contain real delivered events.
  await Promise.all([alice.page.goto('about:blank'), bob.page.goto('about:blank')]);
  await state.atRest(`UPDATE notifications SET created_at='2000-01-01T12:00:00.000Z' WHERE source_page_id='${pageId}' AND event='comment';`);
  await bob.page.goto(origin + '/app/inbox', { waitUntil: 'networkidle' });
  const inbox = bob.page.getByRole('main');
  const data = await ok(bob.context, origin, 'GET', '/api/notifications');
  assert.ok(new Set(data.items.map(item => item.createdAt.slice(0, 10))).size >= 2);
  await expect(inbox).toContainText(`${data.unreadCount} unread notifications`);
  await expect(inbox.locator('.inbox-period')).toHaveCount(new Set(data.items.map(item => item.createdAt.slice(0, 10))).size);
  const dates = await inbox.locator('.outcome-list time').evaluateAll(elements => elements.map(element => element.dateTime));
  assert.ok(dates.length > 1);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'Visible notices are newest first.');
  const audience = inbox.getByRole('combobox', { name: 'Notification audience', exact: true });
  await audience.selectOption('watched');
  const watched = inbox.locator('li').filter({ hasText: title });
  await expect(watched).toHaveCount(2);
  assert.deepEqual((await watched.locator('.outcome-kind').allTextContents()).map(text => text.replace(' · Unread', '')).sort(), ['comment', 'page created']);
  await audience.selectOption('direct');
  const mention = inbox.locator('li').filter({ hasText: title });
  await expect(mention).toHaveCount(1);
  await expect(mention.locator('.outcome-kind')).toContainText('mention');
  const icon = bob.page.locator('button[data-tooltip]:visible').first();
  await expect(icon).toHaveAttribute('data-tooltip', /\S+\s+\S+/);
  await icon.focus();
  assert.equal(await icon.evaluate(element => getComputedStyle(element, '::after').opacity), '1', 'Keyboard focus immediately shows the icon tooltip.');
  await accessible(bob.page, 'Inbox direct mention');
  await people.shot('bob', 'inbox direct mention');
  await mention.getByRole('link').click();
  await expect(bob.page).toHaveURL(`${origin}/app/pages/${pageId}?comment=${comment.value.id}`);
  const opened = (await ok(bob.context, origin, 'GET', '/api/notifications')).items.find(item => item.pageId === pageId && item.event === 'mention');
  assert.ok(opened.readAt);
  await bob.page.goto(origin + '/app/inbox', { waitUntil: 'networkidle' });
  await inbox.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(inbox).toContainText('0 unread notifications');
  await inbox.getByRole('button', { name: 'Archive read', exact: true }).click();
  await expect(inbox.locator('.outcome-list > li')).toHaveCount(0);
  assert.equal((await ok(bob.context, origin, 'GET', '/api/notifications')).items.length, 0);
  assert.ok((await ok(bob.context, origin, 'GET', '/api/notifications?archived=true')).items.some(item => item.id === opened.id));
  await accessible(bob.page, 'Inbox archived read notices');
  await people.shot('bob', 'inbox archived');
}
