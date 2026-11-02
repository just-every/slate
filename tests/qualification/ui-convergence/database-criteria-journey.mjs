import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {accessible} from './browser-evidence.mjs';
import {criteriaFixture} from './database-criteria-fixture.mjs';
import {ok, withSecondPerson} from './two-people-support.mjs';

async function openSettings(page) {
  await page.getByRole('button', {name: 'View options', exact: true}).click();
  await page.getByRole('menuitem', {name: 'View settings', exact: true}).click();
  return page.getByRole('dialog', {name: 'View settings', exact: true});
}
async function leaf(builder, rule) {
  await builder.locator(':scope > div').getByRole('button', {name: 'Add condition', exact: true}).click();
  const row = builder.locator(':scope > fieldset').last();
  await row.getByLabel('Field', {exact: true}).selectOption(rule.field);
  await row.getByLabel('Condition', {exact: true}).selectOption(rule.op);
  if (!['empty', 'not-empty'].includes(rule.op)) {
    const input = row.getByLabel('Value', {exact: true});
    if (await input.evaluate(element => element.tagName === 'SELECT')) await input.selectOption(String(rule.value));
    else await input.fill(String(rule.value));
  }
}
async function group(builder, rule) {
  await builder.locator(':scope > div').getByRole('button', {name: 'Add condition group', exact: true}).click();
  const row = builder.locator(':scope > fieldset').last();
  await row.getByLabel('Match conditions', {exact: true}).selectOption(rule.or ? 'or' : 'and');
  const nested = row.locator(':scope > .filter-builder');
  for (const child of rule.or ?? rule.and) {
    if (child.or || child.and) await group(nested, child);
    else await leaf(nested, child);
  }
}
async function readControls(dialog, expected) {
  const root = dialog.locator('.filter-builder').first();
  const readRules = async builder => {
    const result = [];
    for (const row of await builder.locator(':scope > fieldset').all()) {
      const nested = row.locator(':scope > .filter-builder');
      if (await nested.count()) {
        const op = await row.locator(':scope > label').getByLabel('Match conditions', {exact: true}).inputValue();
        result.push({[op]: await readRules(nested)});
      } else {
        const field = await row.getByLabel('Field', {exact: true}).inputValue();
        const op = await row.getByLabel('Condition', {exact: true}).inputValue();
        const rule = {field, op};
        if (!['empty', 'not-empty'].includes(op)) {
          const value = await row.getByLabel('Value', {exact: true}).inputValue();
          rule.value = field === 'checked' ? value === 'true' : ['quantity', 'formula', 'rollup'].includes(field) ? Number(value) : value;
        }
        result.push(rule);
      }
    }
    return result;
  };
  assert.deepEqual(await readRules(root), expected.filters);
  const sorts = dialog.getByRole('group', {name: 'Sort order', exact: true});
  const values = [];
  for (const row of await sorts.locator(':scope > fieldset').all()) values.push({
    field: await row.getByLabel('Sort field', {exact: true}).inputValue(),
    direction: await row.getByLabel('Sort direction', {exact: true}).inputValue(),
  });
  assert.deepEqual(values, expected.sorts);
}
function visibleRecords(page) {
  return page.locator('main ul > li button').filter({hasText: /^(Alpha|Bravo|Charlie|Delta|Private priority|Excluded status|Excluded quantity)$/});
}
async function shown(page, names) {
  await expect(visibleRecords(page)).toHaveText(names);
}

/** Native controls write all field kinds; both members reopen the same durable criteria. */
export async function databaseCriteriaJourney(state, width) {
  const {page, origin, api} = state;
  const fixture = await criteriaFixture(state);
  const {base, database, fields, criteria, nested, expected, records, snapshot} = fixture;
  const before = await snapshot();
  const url = `${origin}/app/databases/${database.id}`;
  await page.goto(url, {waitUntil: 'networkidle'});
  const dialog = await openSettings(page);
  const builder = dialog.locator('.filter-builder').first();
  for (const criterion of criteria) await leaf(builder, criterion);
  await group(builder, nested);
  await accessible(page, 'database criteria nested native filters');
  const sorts = dialog.getByRole('group', {name: 'Sort order', exact: true});
  // Start in the wrong priority, then reorder with the native move control.
  for (const sort of [expected.sorts[1], expected.sorts[0], expected.sorts[2]]) {
    await sorts.getByRole('button', {name: 'Add sort', exact: true}).click();
    const row = sorts.locator(':scope > fieldset').last();
    await row.getByLabel('Sort field', {exact: true}).selectOption(sort.field);
    await row.getByLabel('Sort direction', {exact: true}).selectOption(sort.direction);
  }
  await sorts.getByRole('group', {name: 'Sort 2', exact: true}).getByRole('button', {name: 'Move sort up', exact: true}).click();
  await readControls(dialog, expected);
  await accessible(page, 'database criteria native editor');
  const submitted = page.waitForResponse(response => new URL(response.url()).pathname === base + '/views' && response.request().method() === 'POST');
  await dialog.getByRole('button', {name: 'Save view', exact: true}).click();
  const saved = await submitted;
  assert.equal(saved.status(), 200);
  const native = saved.request().postDataJSON();
  assert.deepEqual(native.view.filters, expected.filters);
  assert.deepEqual(native.view.sorts, expected.sorts);
  await expect(dialog).not.toBeVisible();
  await page.reload({waitUntil: 'networkidle'});
  const query = await api(base + '/views/' + expected.id);
  assert.deepEqual(query.view.filters, expected.filters);
  assert.deepEqual(query.view.sorts, expected.sorts);
  assert.deepEqual(query.records.map(record => record.title), ['Private priority', 'Bravo', 'Charlie', 'Alpha', 'Delta']);
  await shown(page, ['Private priority', 'Bravo', 'Charlie', 'Alpha', 'Delta']);
  const applied = page.getByRole('region', {name: 'Applied view criteria', exact: true});
  for (const field of fields) await expect(applied).toContainText(field.name);
  for (const text of ['Ready', 'Red', 'descending', 'ascending', 'Any of', 'All of']) await expect(applied).toContainText(text);
  assert.ok(await applied.evaluate(element => !!(element.compareDocumentPosition(document.querySelector('main ul')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Criteria appear before the records.');
  const reopened = await openSettings(page);
  await readControls(reopened, expected);
  await accessible(page, 'database criteria reopened configuration');
  await reopened.getByRole('button', {name: 'Cancel', exact: true}).click();
  await accessible(page, 'database criteria active results');
  await withSecondPerson(state, width, async ({bob, shot}) => {
    await bob.page.goto(url, {waitUntil: 'networkidle'});
    const read = await ok(bob.context, origin, 'GET', base + '/views/' + expected.id);
    assert.deepEqual(read.view.filters, expected.filters);
    assert.deepEqual(read.view.sorts, expected.sorts);
    assert.deepEqual(read.records.map(record => record.title), ['Bravo', 'Charlie', 'Alpha', 'Delta']);
    await shown(bob.page, ['Bravo', 'Charlie', 'Alpha', 'Delta']);
    await expect(bob.page.getByRole('region', {name: 'Applied view criteria'})).not.toContainText('Private priority');
    const memberDialog = await openSettings(bob.page);
    await readControls(memberDialog, expected);
    await memberDialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    await bob.page.reload({waitUntil: 'networkidle'});
    await shown(bob.page, ['Bravo', 'Charlie', 'Alpha', 'Delta']);
    await shot('bob', 'criteria authorized results');
    await accessible(bob.page, 'database criteria second member');
  });
  assert.deepEqual(await snapshot(), before, 'Saving, reopening and reading criteria never edits records.');
  const clearResponse = page.waitForResponse(response => new URL(response.url()).pathname === base + '/views' && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Clear filters and sorts', exact: true}).click();
  const cleared = await clearResponse;
  assert.equal(cleared.status(), 200);
  assert.deepEqual(cleared.request().postDataJSON().view.filters, []);
  assert.deepEqual(cleared.request().postDataJSON().view.sorts, []);
  await page.reload({waitUntil: 'networkidle'});
  await expect(page.getByRole('region', {name: 'Applied view criteria'})).toHaveCount(0);
  const all = await api(base + '/views/' + expected.id);
  assert.deepEqual(all.view.filters, []);
  assert.deepEqual(all.view.sorts, []);
  assert.deepEqual(all.records.map(record => record.pageId), records.map(record => record.pageId).sort());
  await shown(page, all.records.map(record => record.title));
  const emptyDialog = await openSettings(page);
  await readControls(emptyDialog, {...expected, filters: [], sorts: []});
  await emptyDialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  assert.deepEqual(await snapshot(), before, 'One clear action changes no record content, field, body or revision.');
  await accessible(page, 'database criteria cleared results');
  const checkboxDialog = await openSettings(page);
  const checkboxBuilder = checkboxDialog.locator('.filter-builder').first();
  await leaf(checkboxBuilder, {field: 'checked', op: 'empty'});
  await checkboxBuilder.locator(':scope > fieldset').getByLabel('Condition', {exact: true}).selectOption('eq');
  await expect(checkboxBuilder.getByLabel('Value', {exact: true})).toHaveValue('false');
  const checkboxWrite = page.waitForResponse(response => new URL(response.url()).pathname === base + '/views' && response.request().method() === 'POST');
  await checkboxDialog.getByRole('button', {name: 'Save view', exact: true}).click();
  const checkboxSaved = await checkboxWrite;
  assert.equal(checkboxSaved.status(), 200);
  assert.deepEqual(checkboxSaved.request().postDataJSON().view.filters, [{field: 'checked', op: 'eq', value: false}],
    'Changing an empty condition back to equality stores the Unchecked value the control displays.');
  await expect(checkboxDialog).not.toBeVisible();
  await page.reload({waitUntil: 'networkidle'});
  const unchecked = await api(base + '/views/' + expected.id);
  assert.deepEqual(unchecked.view.filters, [{field: 'checked', op: 'eq', value: false}]);
  assert.deepEqual(unchecked.records.map(record => record.title), ['Excluded status']);
  await shown(page, ['Excluded status']);
  await accessible(page, 'database criteria unchecked results');
  await page.getByRole('button', {name: 'Clear filters and sorts', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Applied view criteria'})).toHaveCount(0);
  assert.deepEqual(await snapshot(), before, 'Checkbox condition transitions and clearing leave all records unchanged.');
  console.log(`PROBE DB-005 checkbox at ${width}: empty to equality stores displayed false and returns the one unchecked record`);
  console.log(`PROBE DB-005 1 at ${width}: native View settings writes 19 field kinds, nested AND and OR and ordered sorts; reload and second member exact configuration and authorized order passed`);
  console.log(`PROBE DB-005 2 at ${width}: all criteria above records; one native Clear filters and sorts request removes both arrays; reopened configuration empty and all seven record snapshots unchanged`);
}
