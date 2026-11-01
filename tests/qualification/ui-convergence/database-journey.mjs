import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { recordDetailJourney } from './record-detail-journey.mjs';

/** Identity comes from the shared harness; all database setup and assertions use real public routes. */
export async function databaseJourney(state) {
  const { page, origin, context, api } = state;
  async function mutate(route, data, method = 'POST') {
    const response = await context.request.fetch(origin + route, {
      method, data: { operationKey: randomUUID(), ...data },
    });
    assert.ok(response.ok(), await response.text());
    return (await response.json()).value;
  }
  const container = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  assert.ok(container);
  const database = await mutate('/api/databases', { containerId: container.id, title: 'Field operations' });
  const base = `/api/databases/${database.id}`;
  const keep = { id: randomUUID(), name: 'Notes', type: 'text', config: {}, position: 0 };
  const remove = { id: randomUUID(), name: 'Retired field', type: 'text', config: {}, position: 1 };
  const hidden = { id: randomUUID(), name: 'Hidden details', type: 'text', config: {}, position: 2 };
  let revision = database.revisionId;
  for (const field of [keep, remove, hidden]) {
    revision = (await mutate(base + '/fields', { expectedRevisionId: revision, field })).revisionId;
  }
  const view = {
    id: randomUUID(), name: 'Operations', layout: 'table', filters: [], sorts: [], groups: [],
    calculations: {}, display: { visibleFieldIds: [keep.id, remove.id] }, position: 0,
  };
  await mutate(base + '/views', { expectedRevisionId: revision, view });
  const title = 'Selected, "quoted" record';
  const record = await mutate(base + '/records', {
    title, values: { [keep.id]: 'Before export', [remove.id]: 'Retained', [hidden.id]: 'Do not export hidden details' },
  });
  await mutate(base + '/records', { title: 'Other record', values: { [keep.id]: 'Outside the search' } });
  await page.goto(`${origin}/app/databases/${database.id}`, { waitUntil: 'networkidle' });

  async function openRemoval() {
    await page.getByRole('button', { name: 'Fields', exact: true }).click();
    await page.getByRole('menuitem', { name: remove.name, exact: true }).click();
    await page.getByRole('dialog', { name: 'Field settings', exact: true })
      .getByRole('button', { name: 'Remove field', exact: true }).click();
    return page.getByRole('dialog', { name: 'Remove this field?', exact: true });
  }
  let dialog = await openRemoval();
  // Impact must be visible before a destructive request; Cancel leaves the field intact.
  await expect(dialog).toContainText(remove.name);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok((await api(base)).fields.some(field => field.id === remove.id));

  dialog = await openRemoval();
  await dialog.getByRole('button', { name: 'Remove field', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  assert.ok((await api(base)).fields.some(field => field.id === remove.id));
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cleared = page.waitForResponse(response => response.url().endsWith(`/records/${record.pageId}`)
    && response.request().method() === 'PATCH');
  await page.getByRole('row').filter({ has: page.getByRole('button', { name: title, exact: true }) })
    .getByRole('textbox', { name: remove.name, exact: true }).fill('');
  assert.ok((await cleared).ok());
  await expect.poll(async () => (await api(base + '/records/' + record.pageId)).values[remove.id]).toBeNull();
  dialog = await openRemoval();
  await dialog.getByRole('button', { name: 'Remove field', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  assert.equal((await api(base)).fields.some(field => field.id === remove.id), false);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: remove.name, exact: true })).toHaveCount(0);

  // Export re-reads authorized data rather than downloading the stale rendered snapshot.
  const current = await api(base + '/records/' + record.pageId);
  const note = 'Fresh, "quoted"\nsecond line';
  await mutate(base + '/records/' + record.pageId, {
    expectedRevisionId: current.revisionId, values: { [keep.id]: note },
  }, 'PATCH');
  await page.getByRole('searchbox', { name: 'Find in this view', exact: true }).fill('Selected');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export view CSV', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.csv$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  assert.equal(csv, '"Name","Notes"\r\n"Selected, ""quoted"" record","Fresh, ""quoted""\nsecond line"\r\n');
  assert.equal((await api(base + '/records/' + record.pageId)).values[keep.id], note);
  await recordDetailJourney(state, page.viewportSize().width);
}
