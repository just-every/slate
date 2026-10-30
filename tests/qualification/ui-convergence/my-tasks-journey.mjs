import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';
import { root } from '../../e2e/runtime-harness.mjs';
import { accessible } from './browser-evidence.mjs';
import { openNavigation } from './browser-support.mjs';
import { grant, ok, restrictedPage } from './two-people-support.mjs';

/**
 * NAV-007: Alex assigns Morgan three tasks on two pages with different due dates. Morgan's
 * My tasks, open and by due date, lists exactly those three in order; completing one there
 * marks it done on its page, and revoking Morgan's access to a page drops its task on reload.
 */
export async function myTasksJourney(state, people) {
  const { origin } = state, { alice, bob } = people;
  const width = alice.page.viewportSize().width;
  const shot = (view, label) => view.screenshot({ path: path.join(root, `.artifacts/ui-convergence/my-tasks-${width}-${label}.png`), fullPage: true });
  const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const plan = [
    { title: 'Launch checklist', tasks: [['Draft the rollout notes', day(5)], ['Book the review room', day(9)]] },
    { title: 'Vendor onboarding', tasks: [['Confirm the vendor contract', day(2)]] },
  ];
  const pages = [];
  for (const { title, tasks } of plan) {
    const source = await restrictedPage({ context: alice.context, origin }, title, []);
    const access = await grant(alice.context, origin, source.pageId, bob.id, 'edit');
    const document = await ok(alice.context, origin, 'GET', `/api/pages/${source.pageId}`);
    const blocks = tasks.map(([text, dueDate], index) => ({ id: randomUUID(), blockType: 'task', treePosition: String(index + 1), content: { text: [{ text }], done: false, dueDate } }));
    await ok(alice.context, origin, 'PUT', `/api/pages/${source.pageId}/blocks`, { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, blocks });
    pages.push({ pageId: source.pageId, grantId: access.value.id, blocks });
  }

  // Alex assigns each task to Morgan on its page.
  for (const { pageId, blocks } of pages) {
    await alice.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
    for (const block of blocks) {
      await alice.page.locator(`[data-block-id="${block.id}"]`).getByRole('combobox', { name: 'Task assignee', exact: true }).selectOption({ label: 'Morgan Reader' });
      await expect.poll(async () => (await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`)).blocks.find(item => item.id === block.id)?.content.assigneeMemberId).toBe(bob.id);
    }
  }
  await shot(alice.page, 'assigned');

  // Morgan reaches My tasks from Home and from the sidebar.
  await bob.page.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  await expect(bob.page.getByRole('link', { name: 'My tasks →', exact: true })).toBeVisible();
  await openNavigation(bob.page);
  await bob.page.getByRole('navigation').getByRole('link', { name: /^My tasks/ }).first().click();
  await bob.page.waitForURL('**/app/tasks');
  await expect(bob.page.getByRole('tab', { name: 'Assigned to me', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(bob.page.locator('.task-filters label').filter({ hasText: /^State/ }).locator('select')).toHaveValue('open');
  await expect(bob.page.locator('.task-filters label').filter({ hasText: /^Sort/ }).locator('select')).toHaveValue('due');
  const rows = bob.page.locator('.task-list > li a.task-title');
  await expect(rows).toHaveText(['Confirm the vendor contract', 'Draft the rollout notes', 'Book the review room']);
  await accessible(bob.page, 'my tasks open by due date');
  await shot(bob.page, 'three-open');

  // Completing from the list completes the task on its page.
  const [launch, vendor] = pages, drafted = launch.blocks[0];
  const [completing] = await Promise.all([bob.page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/api/tasks/${launch.pageId}/${drafted.id}`)), bob.page.getByRole('checkbox', { name: 'Complete: Draft the rollout notes', exact: true }).click()]);
  assert.equal(completing.status(), 200, 'Completing from My tasks commits on the page.');
  await expect(rows).toHaveText(['Confirm the vendor contract', 'Book the review room']);
  const stored = (await ok(alice.context, origin, 'GET', `/api/pages/${launch.pageId}`)).blocks.find(item => item.id === drafted.id).content;
  assert.deepEqual([stored.done, stored.completedByMemberId], [true, bob.id]);
  await bob.page.goto(`${origin}/app/pages/${launch.pageId}`, { waitUntil: 'networkidle' });
  await expect(bob.page.getByRole('checkbox', { name: 'Mark complete: Draft the rollout notes', exact: true })).toBeChecked();
  await shot(bob.page, 'completed-on-page');

  // Revoking Morgan's access to the vendor page removes its task on the next load.
  await grant(alice.context, origin, vendor.pageId, bob.id, 'edit', { revoke: true, id: vendor.grantId });
  await bob.page.goto(`${origin}/app/tasks`, { waitUntil: 'networkidle' });
  await expect(rows).toHaveText(['Book the review room']);
  await expect(bob.page.locator('body')).not.toContainText('Confirm the vendor contract');
  await shot(bob.page, 'after-revocation');
}
