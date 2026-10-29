import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { call, ok } from './two-people-support.mjs';

/** Local Notify people presents real inbox events; grant custody is proved by the Workers journey. */
export async function todayOutcomesJourney(state) {
  const { page, context, origin } = state;
  const owner = await ok(context, origin, 'GET', '/api/members/current');
  const containerId = (await ok(context, origin, 'POST', '/api/containers', { operationKey: randomUUID(), name: 'Maintenance presentation', visibility: 'private' })).value.id;
  const rule = await call(context, origin, 'POST', '/api/automation', {
    operationKey: randomUUID(), name: 'Inspect local maintenance outcomes', scope: 'container', containerId,
    trigger: { event: 'created' }, conditions: [], actions: [{ type: 'notify', recipientMemberIds: [owner.id], message: 'Confirmed local maintenance.' }],
  });
  assert.equal(rule.status, 201, JSON.stringify(rule.body));
  for (const title of ['First maintained note', 'Second maintained note']) await ok(context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId, title });
  await state.runScheduled();
  await state.runScheduled();
  // Pin the stored event clock so two real outcomes share a period even at midnight.
  await page.goto('about:blank');
  await state.atRest("UPDATE notifications SET created_at='2000-01-01T12:00:00.000Z' WHERE event='maintenance' AND recipient_member_id='browser-owner';");
  const today = await ok(context, origin, 'GET', '/api/notifications/today');
  const group = today.outcomes.find(item => item.items.some(notice => notice.title === 'First maintained note'));
  assert.ok(group);
  assert.equal(group.count, 2);
  await page.goto(origin + '/app', { waitUntil: 'networkidle' });
  const details = page.getByRole('main').locator('details.today-section');
  await expect(details).toHaveCount(1);
  await expect(details.locator('summary')).toContainText('2 outcomes');
  await expect(details.getByRole('link', { name: /First maintained note/ })).toBeHidden();
  await details.locator('summary').click();
  await expect(details.getByRole('link', { name: /First maintained note/ })).toBeVisible();
  await expect(details.getByRole('link', { name: /Second maintained note/ })).toBeVisible();
  await expect(details).toContainText('Confirmed local maintenance.');
  const fontSize = await details.locator('summary').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  assert.ok(fontSize >= 13);
  await accessible(page, 'Today grouped inspectable outcomes');
  state.assertNoConsoleErrors();
}
