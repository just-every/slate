import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';
import { root } from '../../e2e/runtime-harness.mjs';
import { accessible } from './browser-evidence.mjs';
import { call, ok } from './two-people-support.mjs';

/**
 * DB-015: Alex saves a weekly template, so the Templates tab says it runs as Alex. Morgan, given edit access,
 * saves it again, and both people then read that it runs as Morgan: the label names the last saver, never the creator.
 */
export async function recordTemplatesJourney(state, people) {
  const { origin } = state, { alice, bob } = people;
  const width = alice.page.viewportSize().width;
  const shot = (view, label) => view.screenshot({ path: path.join(root, `.artifacts/ui-convergence/record-templates-${width}-${label}.png`), fullPage: true });
  const space = (await ok(alice.context, origin, 'POST', '/api/containers', { operationKey: randomUUID(), name: 'Recurring notes', visibility: 'private' })).value;
  const access = (await ok(alice.context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), targetKind: 'container', targetId: space.id, principalKind: 'member', principalId: bob.id, level: 'edit' })).value;
  const database = (await ok(alice.context, origin, 'POST', '/api/databases', { operationKey: randomUUID(), containerId: space.id, title: 'Team syncs' })).value;
  const viewId = randomUUID();
  await ok(alice.context, origin, 'POST', `/api/databases/${database.id}/views`, {
    operationKey: randomUUID(), expectedRevisionId: database.revisionId,
    view: { id: viewId, name: 'All syncs', layout: 'table', filters: [], sorts: [], groups: [], calculations: {}, display: {}, position: 0 },
  });
  const saved = (await ok(alice.context, origin, 'POST', `/api/databases/${database.id}/templates`, {
    operationKey: randomUUID(), name: 'Weekly sync', title: 'Weekly sync notes', values: {}, blocks: [], recurrence: { frequency: 'weekly', weekdays: [1, 3], time: '09:00' },
  })).value;
  const card = view => view.locator('.record-template-list > li').filter({ has: view.getByRole('heading', { name: 'Weekly sync', exact: true }) });
  const open = async (view, reload = false) => {
    if (reload) await view.reload({ waitUntil: 'networkidle' });
    else await view.goto(`${origin}/app/databases/${database.id}`, { waitUntil: 'networkidle' });
    await view.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(card(view)).toBeVisible();
  };

  await open(alice.page);
  await expect(card(alice.page)).toContainText('runs as Alex Owner');
  await expect(card(alice.page)).not.toContainText('created as');
  await accessible(alice.page, 'record template runs as the saver');
  await shot(alice.page, 'runs-as-alex');

  await open(bob.page);
  await expect(card(bob.page)).toContainText('runs as Alex Owner');
  await card(bob.page).getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = bob.page.getByRole('dialog', { name: 'Edit Weekly sync', exact: true });
  const committed = bob.page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/databases/${database.id}/templates`);
  await dialog.getByRole('button', { name: 'Save template', exact: true }).click();
  const response = await committed;
  assert.equal(response.status(), 201);
  const replay = response.request().postDataJSON();
  await expect(dialog).not.toBeVisible();
  await expect(card(bob.page)).toContainText('runs as Morgan Reader');
  await open(bob.page, true);
  await expect(card(bob.page)).toContainText('runs as Morgan Reader');
  await accessible(bob.page, 'record template re-saved by a second person');
  await shot(bob.page, 'runs-as-morgan');

  await open(alice.page, true);
  await expect(card(alice.page)).toContainText('runs as Morgan Reader');
  await shot(alice.page, 'handed-to-morgan');
  const listed = (await ok(alice.context, origin, 'GET', `/api/databases/${database.id}/templates`)).items.find(item => item.id === saved.id);
  assert.deepEqual(listed.lastSaver, { id: bob.id, name: 'Morgan Reader' });
  assert.deepEqual(listed.creator, listed.lastSaver, 'The old creator field still answers with the last saver for existing clients.');

  // The former editor keeps read access, but a revoked edit grant cannot power the schedule or a replayed save.
  await ok(alice.context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), targetKind: 'container', targetId: space.id, id: access.id, principalKind: 'member', principalId: bob.id, level: 'edit', revoke: true });
  await ok(alice.context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), targetKind: 'container', targetId: space.id, principalKind: 'member', principalId: bob.id, level: 'view' });
  const refused = await call(bob.context, origin, 'POST', `/api/databases/${database.id}/templates`, replay);
  assert.equal(refused.status, 404);
  assert.equal(refused.body.code, 'NOT_FOUND');
  const before = await ok(alice.context, origin, 'GET', `/api/databases/${database.id}/views/${viewId}`);
  // Move only the due clock into the past, then execute the emitted Worker's native scheduled handler.
  await state.fixtureSql([`UPDATE database_record_templates SET next_occurrence_at='2000-01-03T09:00:00.000Z' WHERE id='${saved.id}'`]);
  await state.runScheduled();
  const paused = (await ok(alice.context, origin, 'GET', `/api/databases/${database.id}/templates`)).items.find(item => item.id === saved.id);
  assert.equal(paused.nextOccurrenceAt, null);
  assert.ok(paused.pausedAt);
  assert.deepEqual(paused.lastSaver, { id: bob.id, name: 'Morgan Reader' });
  const reason = 'Paused: Morgan Reader can no longer add records to this database. Save the schedule again to resume it as yourself.';
  assert.equal(paused.pausedReason, reason);
  const after = await ok(alice.context, origin, 'GET', `/api/databases/${database.id}/views/${viewId}`);
  assert.deepEqual(after.records, before.records, 'The revoked saver creates no scheduled record.');
  for (const view of [alice.page, bob.page]) {
    await open(view, true);
    await expect(card(view).getByRole('status')).toHaveText(reason);
    await accessible(view, 'record template paused after edit access is revoked');
  }
  await expect(card(bob.page).getByRole('button', { name: 'Edit and resume', exact: true })).toHaveCount(0);
  await shot(alice.page, 'paused-after-revocation');
}
