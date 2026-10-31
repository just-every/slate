import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {ok} from './two-people-support.mjs';
import {accessible} from './browser-evidence.mjs';

/** Native view settings create required fields before the first layout save. */
export async function layoutCreationJourney({page, context, origin, api}, containerId) {
  const mutate = (route, data, method = 'POST') =>
    ok(context, origin, method, route, {operationKey: randomUUID(), ...data});
  const database = (await mutate('/api/databases', {containerId, title: 'Layout planning'})).value;
  const base = `/api/databases/${database.id}`;
  const notes = {id: randomUUID(), name: 'Notes', type: 'text', config: {}, position: 0};
  await mutate(base + '/fields', {expectedRevisionId: database.revisionId, field: notes});
  const records = [];
  for (const title of ['Incident response', 'Follow-up review']) {
    records.push({...((await mutate(base + '/records', {title, values: {[notes.id]: title + ' notes'}})).value), title});
  }
  await page.clock.setFixedTime(new Date('2026-03-15T12:00:00Z'));
  await page.goto(origin + '/app/databases/' + database.id, {waitUntil: 'networkidle'});
  const settings = page.getByRole('dialog', {name: 'View settings', exact: true});
  const fieldDialog = page.getByRole('dialog', {name: 'Field settings', exact: true});
  const views = page.getByRole('navigation', {name: 'Saved views'});
  async function addView(layout) {
    await page.getByRole('button', {name: 'View options', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Add view', exact: true}).click();
    await settings.getByRole('textbox', {name: 'Name', exact: true}).fill('Planning ' + layout);
    await settings.getByRole('combobox', {name: 'Layout', exact: true}).selectOption(layout);
  }
  const unchanged = await api(base);
  for (const layout of ['board', 'calendar']) {
    await addView(layout);
    await expect(settings.getByRole('button', {name: 'Save view', exact: true})).toBeDisabled();
    await settings.getByRole('button', {name: layout === 'board' ? 'Create a grouping field' : 'Create a date field', exact: true}).click();
    await fieldDialog.getByRole('textbox', {name: 'Name', exact: true}).fill('Cancelled field');
    await fieldDialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect(settings.getByRole('textbox', {name: 'Name', exact: true})).toHaveValue('Planning ' + layout);
    await expect(settings.getByRole('combobox', {name: 'Layout', exact: true})).toHaveValue(layout);
    await settings.getByRole('button', {name: 'Cancel', exact: true}).click();
    assert.deepEqual(await api(base), unchanged, 'Cancelling field and view creation changes no structure.');
  }

  let group, date;
  for (const layout of ['board', 'calendar', 'table', 'list', 'gallery', 'timeline']) {
    await addView(layout);
    if (layout === 'board' || layout === 'calendar') {
      const type = layout === 'board' ? 'select' : 'date';
      const name = layout === 'board' ? 'Stage' : 'Due date';
      const before = await api(base);
      assert.equal(before.fields.some(field => field.type === type), false);
      await expect(settings.getByRole('button', {name: 'Save view', exact: true})).toBeDisabled();
      // Text fields cannot satisfy grouping, even when the database is populated.
      if (layout === 'board') await expect(settings.getByRole('combobox', {name: 'Group by', exact: true}).getByRole('option', {name: 'Notes', exact: true})).toHaveCount(0);
      await accessible(page, layout + ' offers field creation before save');
      await settings.getByRole('button', {name: layout === 'board' ? 'Create a grouping field' : 'Create a date field', exact: true}).click();
      await fieldDialog.getByRole('textbox', {name: 'Name', exact: true}).fill(name);
      if (layout === 'board') await fieldDialog.getByRole('textbox', {name: 'Options, one per line', exact: true}).fill('Open\nDone');
      await accessible(page, layout + ' native required field editor');
      await fieldDialog.getByRole('button', {name: 'Save field', exact: true}).click();
      await expect(fieldDialog).toBeHidden();
      const saved = await api(base);
      const field = saved.fields.find(field => field.name === name);
      assert.ok(field);
      assert.equal(field.type, type);
      assert.deepEqual(saved.views, before.views, 'Creating a required field does not save the unfinished view.');
      await expect(settings.getByRole('combobox', {name: layout === 'board' ? 'Group by' : 'Date field', exact: true})).toHaveValue(field.id);
      if (layout === 'board') group = field; else date = field;
    } else if (layout === 'timeline') {
      await settings.getByRole('combobox', {name: 'Date field', exact: true}).selectOption(date.id);
    }
    await settings.getByRole('button', {name: 'Save view', exact: true}).click();
    await expect(settings).toBeHidden();
    await expect(views.getByRole('button', {name: 'Planning ' + layout, exact: true})).toHaveAttribute('aria-pressed', 'true');
    const saved = (await api(base)).views.find(view => view.name === 'Planning ' + layout);
    assert.equal(saved.layout, layout);
    if (layout === 'board') assert.equal(saved.groups[0].field, group.id);
    if (layout === 'calendar' || layout === 'timeline') assert.equal(saved.display.dateField, date.id);
  }
  // Merely configuring views never edits existing records.
  for (const record of records) {
    const stored = await api(base + '/records/' + record.pageId);
    assert.deepEqual(stored.values, {[notes.id]: record.title + ' notes', [group.id]: null, [date.id]: null});
    assert.equal(stored.revisionId, record.revisionId);
    await mutate(base + '/records/' + record.pageId, {
      expectedRevisionId: stored.revisionId,
      values: {[group.id]: 'Open', [date.id]: '2026-03-15'},
    }, 'PATCH');
  }
  const snapshots = await Promise.all(records.map(record => api(base + '/records/' + record.pageId)));
  const structure = await api(base);
  for (const layout of ['table', 'board', 'list', 'gallery', 'calendar', 'timeline']) {
    await page.reload({waitUntil: 'networkidle'});
    await views.getByRole('button', {name: 'Planning ' + layout, exact: true}).click();
    await expect(views.getByRole('button', {name: 'Planning ' + layout, exact: true})).toHaveAttribute('aria-pressed', 'true');
    const view = structure.views.find(view => view.layout === layout);
    const query = await api(base + '/views/' + view.id);
    assert.deepEqual(query.view, view);
    assert.deepEqual(query.records.map(record => record.pageId).sort(), records.map(record => record.pageId).sort());
    for (const record of records) await expect(page.getByRole('button', {name: record.title, exact: true})).toBeVisible();
    const surface = page.locator('.database-workspace');
    if (layout === 'table') {
      await expect(surface.getByRole('table').getByRole('row').filter({has: page.getByRole('button', {name: records[0].title, exact: true})}).getByRole('textbox', {name: 'Notes', exact: true})).toHaveValue(records[0].title + ' notes');
      await expect(surface.getByRole('columnheader', {name: /Due date/})).toBeVisible();
    }
    if (layout === 'board') {
      assert.equal(query.groups[0].field, group.id);
      assert.equal(query.groups[0].groups.find(bucket => bucket.value === 'Open').count, 2);
      await expect(surface.getByText('Grouped by Stage', {exact: true})).toBeVisible();
      await expect(surface.getByRole('region', {name: 'Open', exact: true}).getByRole('article')).toHaveCount(2);
      await expect(surface.getByRole('region', {name: 'Done', exact: true}).getByRole('article')).toHaveCount(0);
    }
    if (layout === 'list') {
      await expect(surface.getByRole('listitem')).toHaveCount(2);
      for (const record of records) await expect(surface.getByRole('listitem').filter({has: page.getByRole('button', {name: record.title, exact: true})})).toContainText(record.title + ' notes');
      await expect(surface.getByRole('article')).toHaveCount(0);
    }
    if (layout === 'gallery') {
      await expect(surface.getByRole('article')).toHaveCount(2);
      assert.equal(await surface.getByRole('article').first().locator('..').evaluate(element => getComputedStyle(element).display), 'grid', 'Gallery records are arranged as a card grid.');
    }
    if (layout === 'calendar' || layout === 'timeline') await expect(page.getByText('Dated by Due date', {exact: true})).toBeVisible();
    if (layout === 'calendar') {
      await expect(surface.getByRole('heading', {name: 'March 2026', exact: true})).toBeVisible();
      for (const record of records) await expect(surface.getByRole('button', {name: record.title, exact: true}).locator('..').locator(':scope > span').first()).toHaveText('15 — today');
    }
    if (layout === 'timeline') {
      await expect(surface.getByRole('listitem')).toHaveCount(2);
      for (const record of records) {
        const row = surface.getByRole('listitem').filter({has: page.getByRole('button', {name: record.title, exact: true})});
        await expect(row).toContainText('15 Mar 2026');
        const bar = row.locator('[style*="width"]');
        const box = await bar.boundingBox();
        assert.ok(box && box.width > 0, 'Each dated record has a visible timeline bar.');
      }
    }
    await accessible(page, layout + ' native layout after reload');
    await page.getByRole('button', {name: 'View options', exact: true}).click();
    await page.getByRole('menuitem', {name: 'View settings', exact: true}).click();
    await expect(settings.getByRole('combobox', {name: 'Layout', exact: true})).toHaveValue(layout);
    if (layout === 'board') await expect(settings.getByRole('combobox', {name: 'Group by', exact: true})).toHaveValue(group.id);
    if (layout === 'calendar' || layout === 'timeline') await expect(settings.getByRole('combobox', {name: 'Date field', exact: true})).toHaveValue(date.id);
    await settings.getByRole('button', {name: 'Cancel', exact: true}).click();
  }
  assert.deepEqual(await api(base), structure);
  assert.deepEqual(await Promise.all(records.map(record => api(base + '/records/' + record.pageId))), snapshots);
  console.log('PROBE DB-004 1: native board and calendar field creation -> saved field selected before valid view save; cancellation unchanged');
  console.log('PROBE DB-004 2: native six layouts and reload -> identical record IDs, values and retained grouping and date configuration');
}
