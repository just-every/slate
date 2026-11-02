import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible} from './browser-evidence.mjs';
import {openNavigation} from './browser-support.mjs';
import {call, grant, ok, withSecondPerson} from './two-people-support.mjs';

/** Populated native records, independent member sessions and retained snapshots. */
export async function recordDetailJourney(state, width) {
  const {context, origin, api} = state;
  const mutate = (method, route, data, actor = context) => ok(actor, origin, method, route, {operationKey: randomUUID(), ...data});
  const workspace = await api('/api/workspace');
  const policies = async parity => {
    const before = await api('/api/workspace');
    await state.page.goto(origin + '/app/settings', {waitUntil: 'networkidle'});
    await state.page.getByRole('button', {name: 'Edit workspace & policies', exact: true}).click();
    const dialog = state.page.getByRole('dialog', {name: 'Workspace settings', exact: true});
    await dialog.getByRole('combobox', {name: 'Records', exact: true}).selectOption(parity);
    await dialog.getByRole('button', {name: 'Save settings', exact: true}).click();
    await expect(dialog).toBeHidden();
    await state.page.reload({waitUntil: 'networkidle'});
    assert.deepEqual((await api('/api/workspace')).policies, {...before.policies, 'record.page-parity.v1': parity});
  };
  const container = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  const database = (await mutate('POST', '/api/databases', {containerId: container.id, title: 'Record detail proof'})).value;
  const base = `/api/databases/${database.id}`;
  // Insertion order differs from the defined field order.
  const fields = [
    {id: randomUUID(), name: 'Notes', type: 'text', config: {}, position: 2},
    {id: randomUUID(), name: 'Quantity', type: 'number', config: {}, position: 0},
    {id: randomUUID(), name: 'Created', type: 'created-at', config: {}, position: 3},
    {id: randomUUID(), name: 'Updated', type: 'updated-at', config: {}, position: 4},
    {id: randomUUID(), name: 'Record identifier', type: 'identifier', config: {}, position: 5},
  ];
  const [notes, quantity, created, updated, identifier] = fields;
  const computed = {id: randomUUID(), name: 'Double quantity', type: 'formula', position: 1,
    config: {expression: {op: 'multiply', args: [{field: quantity.id}, {literal: 2}]}}};
  let revision = database.revisionId;
  for (const field of [...fields, computed]) revision = (await mutate('POST', base + '/fields', {expectedRevisionId: revision, field})).value.revisionId;
  await mutate('POST', base + '/views', {expectedRevisionId: revision, view: {id: randomUUID(), name: 'All records', layout: 'table', filters: [], sorts: [], groups: [], calculations: {}, display: {}, position: 0}});
  const record = (await mutate('POST', base + '/records', {title: 'Populated record', values: {[notes.id]: 'Retained notes', [quantity.id]: 7}})).value;
  const recordPath = base + '/records/' + record.pageId;
  const pagePath = `/api/pages/${record.pageId}`;
  await mutate('PATCH', pagePath, {expectedRevisionId: record.revisionId, properties: {icon: '📚'}});
  const blockId = randomUUID();
  const beforeBody = await api(pagePath);
  await mutate('PUT', pagePath + '/blocks', {expectedRevisionId: beforeBody.page.revisionId,
    blocks: [{id: blockId, blockType: 'paragraph', treePosition: 'a', content: {text: [{text: 'Original retained record body'}]}}]});
  const earlier = await api(recordPath);
  await mutate('PATCH', pagePath + '/blocks/' + blockId, {expectedRevisionId: earlier.page.blocks[0].revisionId, content: {text: [{text: 'Current retained record body'}]}});
  const discussion = (await mutate('POST', `/api/comments/page/${record.pageId}`, {body: [{text: 'Retained record discussion'}]})).value;
  await grant(context, origin, database.pageId, 'browser-owner', 'full');
  await grant(context, origin, database.pageId, 'browser-reader', 'edit');
  await mutate('PUT', `/api/sharing/pages/${database.pageId}/inheritance`, {expectedRevisionId: (await api(`/api/pages/${database.pageId}`)).page.revisionId, restricted: true});
  const recordUrl = `${origin}/app/databases/${database.id}/records/${record.pageId}`;
  const orderedNames = ['Quantity', 'Double quantity', 'Notes', 'Created', 'Updated', 'Record identifier'];
  const row = (page, name) => page.locator('.record-field').filter({has: page.locator('dt').getByText(name, {exact: true})});
  const checkFields = async (page, canEdit, amount) => {
    await expect(page.locator('.record-field dt')).toHaveText(orderedNames);
    await expect(row(page, quantity.name).locator('dd')).toContainText(String(amount));
    await expect(row(page, computed.name).locator('dd')).toHaveText(String(amount * 2));
    await expect(row(page, notes.name).locator('dd')).toContainText('Retained notes');
    await expect(row(page, identifier.name).locator('dd')).toHaveText(record.pageId);
    const native = await api(recordPath);
    for (const field of [created, updated]) {
      assert.ok(Number.isFinite(Date.parse(native.values[field.id])));
      await expect(row(page, field.name).locator('dd')).not.toBeEmpty();
    }
    for (const field of [computed, created, updated, identifier]) await expect(row(page, field.name).getByRole('button')).toHaveCount(0);
    await expect(page.locator('.record-fields-list').getByRole('button', {name: 'Edit', exact: true})).toHaveCount(canEdit ? 2 : 0);
  };
  const projections = async (parity, browser) => {
    const pages = (await api('/api/pages?containerId=' + container.id)).items.filter(item => item.id === record.pageId);
    const search = await api('/api/search?kind=page&query=' + encodeURIComponent('Populated record'));
    if (parity === 'record-is-page') {
      assert.equal(pages.length, 1);
      assert.equal(pages[0].parentPageId, database.pageId);
      assert.equal(pages[0].pageKind, 'record');
      assert.equal(pages[0].icon, '📚');
      assert.ok(pages[0].treePosition);
      assert.deepEqual(search.items.map(item => item.id), [record.pageId]);
    } else {
      assert.deepEqual(pages, []);
      assert.deepEqual(search.items, []);
      assert.equal(search.total, 0);
    }
    const searchRead = browser.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/search' && url.searchParams.get('kind') === 'page' && url.searchParams.get('q') === 'Populated record';
    });
    await browser.goto(origin + '/app/search?q=Populated%20record&kind=page', {waitUntil: 'networkidle'});
    assert.deepEqual((await (await searchRead).json()).items.map(item => item.id), parity === 'record-is-page' ? [record.pageId] : []);
    await expect(browser.locator('.search-results h2')).toHaveText(parity === 'record-is-page' ? ['Populated record'] : []);
    await accessible(browser, 'record page search ' + parity);
    await openNavigation(browser);
    const tree = browser.getByRole('navigation', {name: 'Pages', exact: true});
    const filter = tree.getByRole('textbox', {name: 'Filter pages in Shared with me · Handbook', exact: true});
    await filter.fill('Populated record');
    const recordLink = tree.getByRole('link', {name: 'Populated record', exact: true});
    if (parity === 'record-is-page') {
      await expect(recordLink).toBeVisible();
      await expect(recordLink).toHaveAttribute('href', '/app/pages/' + record.pageId);
      await expect(recordLink.locator('.stored-page-icon')).toHaveText('📚');
      await expect(tree.getByRole('link', {name: 'Record detail proof', exact: true})).toBeVisible();
    } else await expect(recordLink).toHaveCount(0);
    await accessible(browser, 'record tree ' + parity);
    await browser.goto(recordUrl, {waitUntil: 'networkidle'});
  };
  try {
    await withSecondPerson(state, width, async ({bob}) => {
      await policies('record-is-page');
      assert.equal((await api(recordPath)).page.page.id, record.pageId);
      await bob.page.goto(`${origin}/app/databases/${database.id}`, {waitUntil: 'networkidle'});
      const title = bob.page.getByRole('button', {name: 'Populated record', exact: true});
      await expect(title).toContainText('📚');
      await title.click();
      const peek = bob.page.getByRole('dialog', {name: 'Record preview', exact: true});
      await expect(peek).toHaveClass(/record-peek-side/);
      for (const mode of ['side', 'center']) {
        if (mode === 'center') await peek.getByRole('button', {name: 'Centre peek', exact: true}).click();
        await expect(peek).toHaveClass(new RegExp('record-peek-' + mode));
        await checkFields(bob.page, true, 7);
        await expect(peek.locator('.stored-page-icon')).toHaveText('📚');
        await expect(peek.locator(`[data-block-id="${blockId}"]`).first()).toContainText('Current retained record body');
        await accessible(bob.page, 'record ' + mode + ' peek');
      }
      await peek.getByRole('link', {name: 'Open full page', exact: true}).click();
      await expect(bob.page).toHaveURL(recordUrl);
      await expect(peek).toHaveCount(0);
      await expect(bob.page.locator('.stored-page-icon')).toHaveText('📚');
      await projections('record-is-page', bob.page);
      console.log('PROBE DB-010 1–2: native record and page identifiers agree; populated icon, fields and body open in side peek, centre peek and full page; exact tree placement and page-search ID retained');
      await checkFields(bob.page, true, 7);
      await row(bob.page, quantity.name).getByRole('button', {name: 'Edit', exact: true}).click();
      const dialog = bob.page.getByRole('dialog', {name: 'Edit Quantity', exact: true});
      await dialog.getByRole('spinbutton', {name: 'Quantity', exact: true}).fill('11');
      await dialog.getByRole('button', {name: 'Save value', exact: true}).click();
      await expect(dialog).not.toBeVisible();
      await bob.page.reload({waitUntil: 'networkidle'});
      await checkFields(bob.page, true, 11);
      await expect(bob.page.locator(`[data-block-id="${blockId}"]`).first()).toContainText('Current retained record body');
      console.log('PROBE DB-012 ordinary edit: native record Quantity 7 -> 11; computed value 22 and reload retained');

      // Downgrade the same independently signed-in member; its native writes must now refuse unchanged.
      const sharing = await api(`/api/sharing/pages/${database.pageId}`);
      const memberGrant = sharing.items.find(item => item.principalId === bob.id);
      await grant(context, origin, database.pageId, bob.id, 'view', {id: memberGrant.id});
      const retained = await api(recordPath);
      const historyBefore = await api(`/api/revisions/${record.pageId}`);
      const stored = {page: retained.page.page, properties: retained.page.properties, blocks: retained.page.blocks, values: retained.values};
      const denied = await call(bob.context, origin, 'PATCH', recordPath, {operationKey: randomUUID(), expectedRevisionId: retained.revisionId, values: {[quantity.id]: 99}});
      assert.equal(denied.status, 404);
      assert.deepEqual(await api(recordPath), retained, 'A viewer write changes neither fields nor body nor revision.');
      assert.deepEqual(await api(`/api/revisions/${record.pageId}`), historyBefore);
      for (const parity of ['record-is-page', 'record-is-row', 'record-is-page']) {
        await policies(parity);
        if (parity === 'record-is-row') {
          await bob.page.goto(`${origin}/app/databases/${database.id}`, {waitUntil: 'networkidle'});
          await expect(title).toHaveText('Populated record');
          await title.click();
          await expect(bob.page).toHaveURL(recordUrl);
          await expect(bob.page.getByRole('dialog', {name: 'Record preview', exact: true})).toHaveCount(0);
        } else await bob.page.goto(recordUrl, {waitUntil: 'networkidle'});
        await checkFields(bob.page, false, 11);
        await projections(parity, bob.page);
        const current = await api(recordPath);
        assert.deepEqual({page: current.page.page, properties: current.page.properties, blocks: current.page.blocks, values: current.values}, stored);
        assert.deepEqual(await api(`/api/revisions/${record.pageId}`), historyBefore);
        const body = bob.page.locator(`[data-block-id="${blockId}"]`);
        if (parity === 'record-is-page') {
          await expect(body.first()).toContainText('Current retained record body');
          await expect(bob.page.locator('[data-page-editor] [contenteditable="true"]')).toHaveCount(0);
          await bob.page.getByRole('button', {name: 'Comments', exact: true}).click();
        } else {
          await expect(body).toHaveCount(0);
          await expect(bob.page.locator('.stored-page-icon')).toHaveCount(0);
          await expect(bob.page.locator('[data-page-editor]')).toHaveCount(0);
          await bob.page.evaluate(() => { window.slatePrintEvents = 0; window.addEventListener('beforeprint', () => window.slatePrintEvents++); });
          await bob.page.getByRole('button', {name: 'More', exact: true}).click();
          await bob.page.getByRole('menuitem', {name: 'Print record', exact: true}).click();
          await expect.poll(() => bob.page.evaluate(() => window.slatePrintEvents)).toBe(1);
          console.log('PROBE DB-010 3: Settings selects record-is-row; native field list remains, beforeprint fires once; icon, body, tree and page-search projection absent with stored page, fields, body and history unchanged');
          await bob.page.getByText('Record comments', {exact: true}).click();
        }
        await expect(bob.page.locator('.comment-thread')).toContainText('Retained record discussion');
        await expect(bob.page.getByRole('button', {name: 'Send comment', exact: true})).toHaveCount(0);
        const comments = await ok(bob.context, origin, 'GET', `/api/comments/page/${record.pageId}`);
        assert.ok(comments.comments.some(comment => comment.threadId === discussion.threadId && comment.body[0].text === 'Retained record discussion'));
        if (parity === 'record-is-page') {
          await bob.page.locator('.detail-close').click();
          if (width === 390) {
            await bob.page.getByRole('button', {name: 'More', exact: true}).click();
            await bob.page.getByRole('menuitem', {name: 'History', exact: true}).click();
          } else await bob.page.getByRole('button', {name: 'History', exact: true}).click();
        } else await bob.page.getByText('Record history', {exact: true}).click();
        const revisions = await ok(bob.context, origin, 'GET', `/api/revisions/${record.pageId}`);
        assert.ok(revisions.items.some(item => item.id === earlier.revisionId));
        await expect(bob.page.locator('.history-list > li')).toHaveCount(revisions.items.length);
        const exactRead = bob.page.waitForResponse(response => new URL(response.url()).pathname === `/api/revisions/${record.pageId}/${earlier.revisionId}`);
        await bob.page.locator('.history-list > li').nth(revisions.items.findIndex(item => item.id === earlier.revisionId)).getByRole('button').click();
        const snapshot = await (await exactRead).json();
        assert.equal(snapshot.id, earlier.revisionId);
        assert.equal(snapshot.properties.databaseFields[quantity.id], 7);
        await expect(bob.page.locator('.revision-preview')).toContainText('Original retained record body');
        await expect(bob.page.locator('.revision-preview')).not.toContainText('Current retained record body');
        await expect(bob.page.getByRole('button', {name: 'Restore this revision', exact: true})).toHaveCount(0);
        assert.deepEqual((await api(pagePath)).blocks, retained.page.blocks, 'Parity changes and historical reads never drop or restore current content.');
        console.log(`PROBE DB-012 ${parity}: viewer fields, retained comments, exact historical body and unchanged stored current body passed`);
        await accessible(bob.page, `record detail ${parity}`);
      }
      console.log('PROBE DB-010 4–5: native Settings switches back to record-is-page with identical icon, field map, block IDs, current body, page ID, revision history and tree placement');
      console.log('PROBE DB-012 read-only: all six fields readable; native viewer PATCH -> 404 and unchanged record and history');
    });
  } finally { await policies(workspace.policies['record.page-parity.v1'] ?? 'record-is-page'); }
}
