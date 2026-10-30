import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible} from './browser-evidence.mjs';
import {call, grant, ok, restrictedPage, withSecondPerson} from './two-people-support.mjs';

/** Save criteria through the browser, then run their embedded copy as each reader. */
export async function savedSearchJourney(state) {
  const {page, context, origin, api} = state;
  const shared = await restrictedPage(state, 'Catalog launch guide', ['Confirm the public launch checklist.']);
  const privatePage = await restrictedPage(state, 'Catalog private forecast', ['Confidential launch forecast.']);
  await ok(context, origin, 'POST', '/api/sharing', {operationKey:randomUUID(), targetKind:'container', targetId:shared.spaceId, principalKind:'member', principalId:'browser-reader', level:'view'});
  await grant(context, origin, shared.pageId, 'browser-reader', 'view');
  for (const id of [shared.pageId, privatePage.pageId]) {
    const document = await api(`/api/pages/${id}`);
    await ok(context, origin, 'PATCH', `/api/pages/${id}`, {operationKey:randomUUID(), expectedRevisionId:document.page.revisionId, properties:{labels:['launch']}});
    const labelled = await api(`/api/pages/${id}`);
    await ok(context, origin, 'POST', `/api/pages/${id}/publish`, {operationKey:randomUUID(), expectedRevisionId:labelled.page.revisionId});
  }
  const create = async (title, labels, containerId = shared.spaceId) => (await ok(context, origin, 'POST', '/api/pages', {
    operationKey:randomUUID(), containerId, title, properties:{labels},
    blocks:[{id:randomUUID(), blockType:'paragraph', treePosition:'a0', content:{text:[{text:`Independent procedure for ${title}.`}]}}],
  })).value.pageId;
  await create('Catalog unrelated handbook', ['support']);
  await create('Catalog Excluded draft', ['launch']);
  const otherSpace = (await ok(context, origin, 'POST', '/api/containers', {operationKey:randomUUID(), name:'Other catalog', visibility:'default'})).value.id;
  await create('Catalog outside scope', ['launch'], otherSpace);
  const host = await create('Saved launch index', []);
  await grant(context, origin, host, 'browser-reader', 'view');
  const query = 'title:Catalog AND label:launch -title:Excluded';
  const name = 'Launch review';
  const ownerTitles = ['Catalog launch guide', 'Catalog private forecast'];
  const searchTitles = async (view, expected) => {
    await expect.poll(async () => (await view.locator('.search-results h2').allTextContents()).sort()).toEqual([...expected].sort());
    await expect(view.getByRole('searchbox', {name:'Search your workspace', exact:true})).toHaveValue(query);
    await expect(view.getByText(`${expected.length} result${expected.length === 1 ? '' : 's'} within your access.`, {exact:true})).toBeVisible();
  };
  const save = async (view, savedName) => {
    await view.getByRole('button', {name:'Save this search', exact:true}).click();
    const dialog = view.getByRole('dialog', {name:'Save search', exact:true});
    await dialog.getByRole('textbox', {name:'Search name', exact:true}).fill(savedName);
    await dialog.getByRole('button', {name:'Save search', exact:true}).click();
    await expect(dialog).toHaveCount(0);
  };
  const reopen = async (view, savedName, expected) => {
    // Start without a query so the saved choice must restore it and its refinements.
    await view.goto(origin + '/app/search', {waitUntil:'networkidle'});
    await view.locator('.search-options > summary').click();
    await view.getByText('Saved searches', {exact:true}).click();
    await view.getByRole('button', {name:savedName, exact:true}).click();
    await searchTitles(view, expected);
    await expect(view.getByRole('combobox', {name:'Look in', exact:true})).toHaveValue('page');
    await view.getByText('Refine your search', {exact:true}).click();
    await expect(view.getByRole('combobox', {name:'Space', exact:true})).toHaveValue(shared.spaceId);
    await expect(view.getByRole('combobox', {name:'Sort results', exact:true})).toHaveValue('updated');
  };
  await page.goto(origin + '/app/search', {waitUntil:'networkidle'});
  await page.getByRole('searchbox', {name:'Search your workspace', exact:true}).fill(query);
  await page.getByRole('button', {name:'Search', exact:true}).click();
  await page.locator('.search-options > summary').click();
  await page.getByRole('combobox', {name:'Look in', exact:true}).selectOption('page');
  await page.getByText('Refine your search', {exact:true}).click();
  await page.getByRole('combobox', {name:'Space', exact:true}).selectOption(shared.spaceId);
  await page.getByRole('combobox', {name:'Sort results', exact:true}).selectOption('updated');
  await searchTitles(page, ownerTitles);
  await save(page, name);
  await page.reload({waitUntil:'networkidle'});
  await reopen(page, name, ownerTitles);
  const saved = (await api('/api/search/saved')).items.find(item => item.name === name);
  assert.ok(saved);
  assert.deepEqual(saved.query, {query, kind:'page', containerId:shared.spaceId, sort:'updated', includeArchived:false, includeTrashed:false, limit:30});
  // Pagination belongs to a result view; the embedded copy retains the criteria.
  const {limit: savedLimit, ...criteria} = saved.query;
  await accessible(page, 'reopened advanced saved search');

  await page.goto(`${origin}/app/pages/${host}`, {waitUntil:'networkidle'});
  await page.getByRole('button', {name:/Add block/}).click();
  await page.getByRole('option', {name:'Content query', exact:true}).click();
  await expect.poll(async () => (await api(`/api/pages/${host}`)).blocks.some(block => block.blockType === 'content-query')).toBe(true);
  await expect(page.locator('.editor-save-status')).toHaveText('Saved');
  await page.reload({waitUntil:'networkidle'});
  const embedded = view => view.getByRole('region', {name:'Content query', exact:true});
  await embedded(page).getByRole('button', {name:'Edit the query', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Edit content query', exact:true});
  await expect(dialog.getByRole('combobox', {name:'Saved search', exact:true}).locator('option', {hasText:name})).toHaveCount(1);
  await dialog.getByRole('combobox', {name:'Saved search', exact:true}).selectOption(saved.id);
  await dialog.getByRole('button', {name:'Save query', exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const stored = (await api(`/api/pages/${host}`)).blocks.find(block => block.blockType === 'content-query');
  assert.ok(stored, 'The native insertion persisted a content query block.');
  assert.deepEqual(stored.content.definition.search, criteria);
  assert.equal(stored.content.definition.searchName, name);
  const queryTitles = async (view, expected) => {
    await expect.poll(async () => (await embedded(view).locator('tbody button').allTextContents()).sort()).toEqual([...expected].sort());
    await expect(embedded(view)).toContainText(`Saved search ${name}`);
    await expect(embedded(view).locator('footer')).toContainText(`${expected.length} item${expected.length === 1 ? '' : 's'}`);
    await expect(embedded(view)).not.toContainText('Confidential launch forecast.');
  };
  await page.reload({waitUntil:'networkidle'});
  await queryTitles(page, ownerTitles);
  await accessible(page, 'saved search embedded after page reload');
  await withSecondPerson(state, page.viewportSize().width, async ({bob}) => {
    const readerDocument = await ok(bob.context, origin, 'GET', `/api/pages/${host}`);
    assert.equal(readerDocument.permissions.canEdit, false, 'The second person reads the embedded query without edit authority.');
    await bob.page.goto(`${origin}/app/pages/${host}`, {waitUntil:'networkidle'});
    await queryTitles(bob.page, ['Catalog launch guide']);
    await expect(embedded(bob.page)).not.toContainText('Catalog private forecast');
    await bob.page.goto(origin + '/app/search?' + new URLSearchParams({q:query, kind:'page', containerId:shared.spaceId, sort:'updated'}), {waitUntil:'networkidle'});
    await searchTitles(bob.page, ['Catalog launch guide']);
    await save(bob.page, 'My launch review');
    await bob.page.reload({waitUntil:'networkidle'});
    await reopen(bob.page, 'My launch review', ['Catalog launch guide']);

    const current = (await api(`/api/sharing/pages/${shared.pageId}`)).items.find(item => item.principalId === bob.id && !item.revokedAt);
    assert.ok(current);
    await grant(context, origin, shared.pageId, bob.id, 'view', {id:current.id, revoke:true});
    await reopen(bob.page, 'My launch review', []);
    await bob.page.goto(`${origin}/app/pages/${host}`, {waitUntil:'networkidle'});
    await queryTitles(bob.page, []);
    for (const title of ownerTitles) await expect(embedded(bob.page)).not.toContainText(title);
    assert.equal((await call(bob.context, origin, 'GET', `/api/pages/${shared.pageId}`)).status, 404);
    const denied = await ok(bob.context, origin, 'POST', `/api/pages/${host}/query`, stored.content.definition);
    assert.deepEqual(denied.items, [], 'Replaying embedded criteria after revocation grants no results.');
    await accessible(bob.page, 'embedded saved search after reader revocation');
  });
  await page.reload({waitUntil:'networkidle'});
  await queryTitles(page, ownerTitles);
  const retained = (await api(`/api/pages/${host}`)).blocks.find(block => block.id === stored.id);
  assert.deepEqual(retained.content.definition, stored.content.definition, 'Reader revocation changes results without rewriting the embedded criteria.');
}
