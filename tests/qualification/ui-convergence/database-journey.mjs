import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { recordDetailJourney } from './record-detail-journey.mjs';
import { accessible } from './browser-evidence.mjs';
import { openNavigation } from './browser-support.mjs';
import { call, ok, withSecondPerson } from './two-people-support.mjs';

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
  await databaseLifecycleJourney(state, page.viewportSize().width);
}


/** DB-001: native creation and page lifecycle preserve a populated database and current access. */
export async function databaseLifecycleJourney(state, width) {
  const {page, context, origin, api} = state;
  const write = (method, route, data, actor = context) => ok(actor, origin, method, route, {operationKey: randomUUID(), ...data});
  const source = (await write('POST', '/api/containers', {name: 'Database source', visibility: 'closed'})).value.id;
  const destination = (await write('POST', '/api/containers', {name: 'Database destination', visibility: 'closed'})).value.id;
  const parent = (await write('POST', '/api/pages', {containerId: destination, title: 'Database destination parent'})).value.pageId;
  await write('POST', '/api/sharing', {targetKind: 'container', targetId: source, principalKind: 'member', principalId: 'browser-reader', level: 'edit'});
  const priorPages = (await api('/api/pages')).items.map(item => item.id).sort();
  const priorDatabases = (await api('/api/databases')).items.map(item => item.id).sort();
  const name = 'Lifecycle database';
  await page.goto(`${origin}/app/containers/${source}`, {waitUntil: 'networkidle'});
  await openNavigation(page);
  await page.getByRole('button', {name: 'Create', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Database', exact: true}).click();
  const creation = page.getByRole('dialog', {name: 'Create a database', exact: true});
  await creation.getByLabel('Name', {exact: true}).fill(name);
  await creation.getByLabel('Space', {exact: true}).selectOption(source);
  await creation.getByRole('button', {name: 'Create database', exact: true}).click();
  await expect(page).toHaveURL(/\/app\/databases\/[^/]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1), base = `/api/databases/${id}`;
  const database = (await api(base)).database, pageId = database.page_id;
  const pagePath = `/api/pages/${pageId}`, url = `${origin}/app/databases/${id}`;
  await expect(page.getByRole('heading', {name, exact: true})).toBeVisible();
  const definitions = [['Notes', 'text'], ['Quantity', 'number']];
  for (const [fieldName, type] of definitions) {
    await page.getByRole('button', {name: 'Fields', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Add field', exact: true}).click();
    const field = page.getByRole('dialog', {name: 'Field settings', exact: true});
    await field.getByLabel('Name', {exact: true}).fill(fieldName);
    await field.getByLabel('Type', {exact: true}).selectOption(type);
    await field.getByRole('button', {name: 'Save field', exact: true}).click();
    await expect(field).toBeHidden();
  }
  const fields = (await api(base)).fields;
  assert.deepEqual(fields.map(({name, type, position}) => ({name, type, position})), [
    {name: 'Notes', type: 'text', position: 0}, {name: 'Quantity', type: 'number', position: 1},
  ]);
  const [notes, quantity] = fields;
  const records = [];
  const editCell = async (view, title, field, value) => {
    const cell = view.getByRole('row').filter({has: view.getByRole('button', {name: title, exact: true})})
      .getByRole(field.type === 'number' ? 'spinbutton' : 'textbox', {name: field.name, exact: true});
    const receipt = view.waitForResponse(response => new URL(response.url()).pathname.startsWith(base + '/records/') && response.request().method() === 'PATCH');
    await cell.fill(String(value));
    assert.equal((await receipt).status(), 200);
    await view.reload({waitUntil: 'networkidle'});
    await expect(view.getByRole('row').filter({has: view.getByRole('button', {name: title, exact: true})})
      .getByRole(field.type === 'number' ? 'spinbutton' : 'textbox', {name: field.name, exact: true})).toHaveValue(String(value));
  };
  for (const [title, text, amount] of [['First retained record', 'First notes', 7], ['Second retained record', 'Second notes', 12]]) {
    await page.locator('.db-actions').getByRole('button', {name: 'New record', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'New record', exact: true});
    await dialog.getByLabel('Name', {exact: true}).fill(title);
    const created = page.waitForResponse(response => new URL(response.url()).pathname === base + '/records' && response.request().method() === 'POST');
    await dialog.getByRole('button', {name: 'Create record', exact: true}).click();
    const response = await created;
    assert.equal(response.status(), 201);
    const record = (await response.json()).value;
    await expect(dialog).toBeHidden();
    await editCell(page, title, notes, text);
    await editCell(page, title, quantity, amount);
    records.push({pageId: record.pageId, title, values: {[notes.id]: text, [quantity.id]: amount}});
  }
  const more = async action => {
    await page.getByRole('button', {name: 'More', exact: true}).click();
    await page.getByRole('menuitem', {name: action, exact: true}).click();
  };
  await page.getByRole('link', {name: 'About this database', exact: true}).click();
  await more('Add icon');
  const appearance = page.getByRole('dialog', {name: 'Page icon', exact: true});
  await appearance.getByLabel('Icon', {exact: true}).fill('🧭');
  await appearance.getByRole('button', {name: 'Save appearance', exact: true}).click();
  await expect(appearance).toBeHidden();
  const ids = [pageId, ...records.map(record => record.pageId)].sort();
  const expectedPages = [...priorPages, ...ids].sort();
  const sameRecords = async (actor = context) => {
    const native = await ok(actor, origin, 'GET', base);
    assert.equal(native.database.page_id, pageId);
    assert.deepEqual(native.fields, fields, 'Field identifiers, types, configuration and ordering survive.');
    assert.equal(native.views.length, 1);
    const listed = await ok(actor, origin, 'GET', `${base}/views/${native.views[0].id}`);
    assert.deepEqual(listed.records.map(record => record.pageId).sort(), records.map(record => record.pageId).sort());
    for (const record of records) {
      const read = await ok(actor, origin, 'GET', `${base}/records/${record.pageId}`);
      assert.equal(read.page.page.title, record.title);
      assert.deepEqual(read.values, record.values, 'Every populated record retains its own values.');
    }
  };
  const inventory = async (containerId, parentPageId) => {
    assert.deepEqual((await api('/api/pages')).items.map(item => item.id).sort(), expectedPages, 'No page or record is duplicated or lost.');
    assert.deepEqual((await api('/api/databases')).items.map(item => item.id).sort(), [...priorDatabases, id].sort());
    const index = (await api('/api/databases')).items.filter(item => item.id === id);
    assert.equal(index.length, 1);
    assert.deepEqual({pageId: index[0].pageId, title: index[0].title, icon: index[0].icon, containerId: index[0].containerId}, {pageId, title: name, icon: '🧭', containerId});
    const nodes = (await api(`/api/pages?containerId=${containerId}`)).items.filter(item => ids.includes(item.id));
    assert.equal(nodes.length, 3);
    for (const node of nodes) {
      assert.equal(node.parentPageId, node.id === pageId ? parentPageId : pageId);
      assert.equal(node.pageKind, node.id === pageId ? 'database' : 'record');
    }
    await sameRecords();
  };
  const show = async label => {
    const document = await api(pagePath);
    await page.goto(`${origin}/app/containers/${document.page.containerId}`, {waitUntil: 'networkidle'});
    await page.getByRole('navigation', {name: 'Space navigation', exact: true}).getByRole('button', {name: 'Content', exact: true}).click();
    await expect(page.locator('.space-detail .page-tree').first()).toBeVisible();
    for (const title of ['Database destination parent', name]) {
      const expand = page.locator('.space-detail').getByRole('button', {name: `Expand ${title}`, exact: true});
      if (await expand.isVisible()) await expand.click();
    }
    const tree = page.locator('.space-detail .page-tree').first();
    for (const node of [pageId, ...records.map(record => record.pageId)])
      await expect(tree.locator(`a[href="/app/pages/${node}"]`)).toHaveCount(1);
    const rendered = await tree.locator('a').evaluateAll(anchors => Object.fromEntries(anchors.map(anchor => {
      const parent = anchor.closest('li').parentElement.closest('li')?.querySelector(':scope > .tree-row a');
      return [new URL(anchor.href).pathname, parent ? new URL(parent.href).pathname : null];
    })));
    assert.equal(rendered[`/app/pages/${pageId}`], document.parentPageId ? `/app/pages/${document.parentPageId}` : null);
    for (const record of records) assert.equal(rendered[`/app/pages/${record.pageId}`], `/app/pages/${pageId}`);
    const link = tree.locator(`a[href="/app/pages/${pageId}"]`);
    await expect(link.locator('.stored-page-icon')).toHaveText('🧭');
    await link.click();
    await expect(page.getByRole('textbox', {name: 'Page title', exact: true})).toHaveValue(name);
    await page.goto(url, {waitUntil: 'networkidle'});
    await page.reload({waitUntil: 'networkidle'});
    await expect(page.getByRole('heading', {name, exact: true})).toBeVisible();
    for (const record of records) await expect(page.getByRole('button', {name: record.title, exact: true})).toBeVisible();
    await accessible(page, `database ${label}`);
  };
  await inventory(source, null);
  await show('created and populated');
  console.log('PROBE DB-001 identity: native Create database, Fields and New record -> one database page, icon, two typed fields and two exact populated record pages after reload');

  await withSecondPerson(state, width, async ({bob}) => {
    await sameRecords(bob.context);
    await page.getByRole('link', {name: 'About this database', exact: true}).click();
    await more('Move page');
    const picker = page.getByRole('dialog', {name: `Move “${name}”`, exact: true});
    await picker.getByRole('combobox').fill('Database destination parent');
    await picker.getByRole('option', {name: /Database destination parent/}).click();
    await picker.getByRole('button', {name: 'Move page', exact: true}).click();
    const review = page.getByRole('dialog', {name: 'Review changed access', exact: true});
    await expect(review).toContainText('Morgan Reader');
    await expect(review).toContainText('edit → No access');
    for (const title of [name, ...records.map(record => record.title)]) await expect(review).toContainText(title);
    await review.getByRole('button', {name: 'Move page', exact: true}).click();
    await expect(review).toBeHidden();
    await inventory(destination, parent);
    assert.equal((await api(`/api/pages?containerId=${source}`)).items.some(item => ids.includes(item.id)), false);
    for (const route of [base, pagePath, ...records.map(record => `${base}/records/${record.pageId}`)])
      assert.equal((await call(bob.context, origin, 'GET', route)).status, 404, 'Old-container access cannot read the moved database or its records.');
    assert.equal((await ok(bob.context, origin, 'GET', '/api/databases')).items.some(item => item.id === id), false);
    assert.equal((await ok(bob.context, origin, 'GET', '/api/pages')).items.some(item => ids.includes(item.id)), false);
    await show('moved');
    await write('POST', '/api/sharing', {targetKind: 'container', targetId: destination, principalKind: 'member', principalId: bob.id, level: 'view'});
    await sameRecords(bob.context);
    assert.equal((await ok(bob.context, origin, 'GET', pagePath)).permissions.level, 'view');
    await bob.page.goto(url, {waitUntil: 'networkidle'});
    for (const record of records) await expect(bob.page.getByRole('button', {name: record.title, exact: true})).toBeVisible();
    await expect(bob.page.locator('.db-actions').getByRole('button', {name: 'New record', exact: true})).toHaveCount(0);
    await expect(bob.page.getByRole('region', {name: 'Records table', exact: true}).getByRole('button', {name: 'New record', exact: true})).toBeDisabled();
    const snapshot = async () => ({database: await api(base), records: await Promise.all(records.map(record => api(`${base}/records/${record.pageId}`))),
      pages: await api('/api/pages'), archive: await api('/api/archive'), history: await Promise.all(ids.map(id => api(`/api/revisions/${id}`))), activity: await api('/api/activity?limit=100')});
    const before = await snapshot(), document = await api(pagePath), recordPath = `${base}/records/${records[0].pageId}`;
    for (const [method, route, data] of [
      ['POST', base + '/records', {title: 'Refused record', values: {}}],
      ['POST', base + '/fields', {expectedRevisionId: before.database.database.revision_id, field: {id: randomUUID(), name: 'Refused field', type: 'text', config: {}, position: 2}}],
      ['PATCH', recordPath, {expectedRevisionId: before.records[0].revisionId, values: {[quantity.id]: 99}}],
      ['POST', pagePath + '/move-preview', {containerId: source, parentPageId: null, atEnd: true}],
      ['POST', `/api/archive/${pageId}`, {expectedRevisionId: document.page.revisionId, action: 'archive'}],
      ['POST', `/api/archive/${pageId}`, {expectedRevisionId: document.page.revisionId, action: 'trash'}],
    ]) {
      const refused = await call(bob.context, origin, method, route, {operationKey: randomUUID(), ...data});
      assert.equal(refused.status, 404, `${method} ${route}: a reader cannot mutate the database.`);
      assert.deepEqual(await snapshot(), before, 'Refused reader mutations leave all pages, fields, records, history and activity unchanged.');
    }
    const grant = (await api(`/api/sharing/containers/${destination}`)).items.find(item => item.principalId === bob.id);
    await write('POST', '/api/sharing', {id: grant.id, targetKind: 'container', targetId: destination, principalKind: 'member', principalId: bob.id, level: 'edit'});
    await bob.page.reload({waitUntil: 'networkidle'});
    await editCell(bob.page, records[0].title, quantity, 19);
    records[0].values[quantity.id] = 19;
    await bob.page.reload({waitUntil: 'networkidle'});
    await sameRecords(bob.context);
    await inventory(destination, parent);
    console.log('PROBE DB-001 access: native Move page -> source editor loses database and records; destination view reads both and six mutations refuse unchanged; destination edit persists Quantity 19 after reload');
  });

  for (const action of ['archive', 'trash']) {
    await page.goto(url, {waitUntil: 'networkidle'});
    await page.getByRole('link', {name: 'About this database', exact: true}).click();
    await more(action === 'archive' ? 'Archive page' : 'Move to trash');
    const dialog = page.getByRole('dialog', {name: action === 'archive' ? 'Archive this page?' : 'Move this page to trash?', exact: true});
    const reason = `Database ${action} lifecycle proof`;
    await dialog.getByLabel('Reason', {exact: true}).fill(reason);
    await dialog.getByRole('button', {name: 'Confirm', exact: true}).click();
    await expect(dialog).toBeHidden();
    await page.goto(origin + '/app/archive', {waitUntil: 'networkidle'});
    if (action === 'trash') await page.getByRole('button', {name: 'Trash', exact: true}).click();
    const rows = (await api('/api/archive')).items.filter(item => ids.includes(item.id));
    assert.deepEqual(rows.map(item => item.id).sort(), ids, 'The database and both record pages enter the lifecycle together.');
    for (const row of rows) {assert.equal(row.reason, reason); assert.ok(action === 'archive' ? row.archivedAt : row.trashedAt);}
    assert.deepEqual((await api('/api/pages')).items.map(item => item.id).sort(), priorPages);
    assert.deepEqual((await api('/api/databases')).items.map(item => item.id).sort(), priorDatabases);
    await page.reload({waitUntil: 'networkidle'});
    if (action === 'trash') await page.getByRole('button', {name: 'Trash', exact: true}).click();
    const row = page.locator('.archive-list li').filter({has: page.getByRole('heading', {name, exact: true})});
    await expect(row).toContainText(reason);
    await accessible(page, `database ${action} retained`);
    await row.getByRole('button', {name: 'Restore', exact: true}).click();
    await expect(row).toHaveCount(0);
    assert.equal((await api('/api/archive')).items.some(item => ids.includes(item.id)), false);
    await inventory(destination, parent);
    await show(`restored from ${action}`);
    console.log(`PROBE DB-001 ${action}: native page action -> exactly database and two records retained outside active tree; native Restore -> same mapping, icon, fields, values and destination parent after reload`);
  }
}
