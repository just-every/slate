import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { openPageAction } from './browser-support.mjs';
import { grant, ok, restrictedPage } from './two-people-support.mjs';

const stored = document => ({ page: document.page, properties: document.properties, blocks: document.blocks });
const blocks = document => document.blocks.map(({ id, blockType, content, parentBlockId, treePosition }) => ({ id, blockType, content, parentBlockId, treePosition }));

/** Native form choices and structural actions retain their starting revision and refuse stale writes. */
export async function revisionConflictsJourney(state, people) {
  const { alice, bob, record, shot } = people, { origin } = state;
  const { pageId, blockIds } = await restrictedPage({ context: alice.context, origin }, 'Incident handover choices', ['Identify the incident.', 'Assign the lead.', 'Agree the next update.']);
  await grant(alice.context, origin, pageId, bob.id, 'edit');
  const route = `/api/pages/${pageId}`;
  const read = () => ok(alice.context, origin, 'GET', route);
  const opened = () => Promise.all([alice, bob].map(person => person.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' })));
  const mutations = [];
  const received = response => {
    const request = response.request();
    if ((new URL(response.url()).pathname.startsWith(route) || new URL(response.url()).pathname === `/api/status/page/${pageId}`) && ['PATCH', 'PUT', 'POST'].includes(request.method()))
      mutations.push({ method: request.method(), path: new URL(response.url()).pathname, status: response.status(), submitted: request.postDataJSON() });
  };
  alice.page.on('response', received);
  const history = async (revisionId, expected) => {
    const snapshot = await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}/${revisionId}`);
    assert.deepEqual(snapshot.blocks, expected.blocks, 'Retained revision keeps the exact committed block tree and content.');
    for (const key of ['title', 'labels', 'typeface', 'icon', 'cover', 'statusKey'])
      if (expected.properties && key in expected.properties)
        assert.deepEqual(snapshot.properties[key], expected.properties[key], `Retained revision keeps ${key}.`);
  };
  const unchanged = async (canonical, operationKey) => {
    assert.deepEqual(stored(await read()), stored(canonical), 'Refusal changes no canonical page, properties or blocks.');
    const activity = await ok(alice.context, origin, 'GET', '/api/activity?limit=100');
    assert.ok(!activity.items.some(item => item.operationKey === operationKey), 'A refused stale write creates no activity entry.');
  };
  try {
    for (const kind of ['display', 'labels', 'icon', 'cover', 'status']) {
      await opened();
      const before = await read();
      let form, submit, retained;
      const mutationPath = kind === 'status' ? `/api/status/page/${pageId}` : route;
      const mutationMethod = kind === 'status' ? 'POST' : 'PATCH';
      if (kind === 'display') {
        await alice.page.getByRole('button', { name: 'More', exact: true }).click();
        await alice.page.getByRole('menuitem', { name: 'Display settings', exact: true }).click();
        form = alice.page.getByRole('region', { name: 'Display settings', exact: true });
        retained = form.getByLabel('Labels', { exact: true });
        await retained.fill('incident-local');
        await form.getByRole('combobox', { name: /^Typeface/ }).selectOption('serif');
        submit = form.getByRole('button', { name: 'Save display settings', exact: true });
      } else if (kind === 'status') {
        await openPageAction(alice.page, 'Details');
        await alice.page.getByLabel('Set page status').selectOption('__clear');
        form = alice.page.getByRole('dialog', { name: 'Change page status', exact: true });
        submit = form.getByRole('button', { name: 'Set status', exact: true });
      } else if (kind === 'labels') {
        await openPageAction(alice.page, 'Details');
        await alice.page.getByRole('button', { name: 'Edit labels', exact: true }).click();
        form = alice.page.getByRole('dialog', { name: 'Edit page labels', exact: true });
        retained = form.getByLabel('Labels, separated by commas', { exact: true });
        await retained.fill('incident-local');
        submit = form.getByRole('button', { name: 'Save details', exact: true });
      } else {
        await alice.page.getByRole('button', { name: 'More', exact: true }).click();
        await alice.page.getByRole('menuitem', { name: new RegExp(`^(Add|Change) ${kind}$`) }).click();
        form = alice.page.getByRole('dialog', { name: kind === 'icon' ? 'Page icon' : 'Page cover', exact: true });
        retained = kind === 'icon' ? form.getByLabel('Icon', { exact: true }) : form.getByLabel('Gallery', { exact: true });
        if (kind === 'icon') await retained.fill('🧭');
        else await retained.selectOption('sand');
        submit = form.getByRole('button', { name: 'Save appearance', exact: true });
      }
      const competing = await ok(bob.context, origin, 'PATCH', route, {
        operationKey: randomUUID(), expectedRevisionId: before.page.revisionId,
        properties: { title: `Morgan committed ${kind}`, labels: [`incident-morgan-${kind}`] },
      });
      const canonical = await read();
      // Let the native collaboration poll update this page while the form retains its choices.
      await expect(alice.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(`Morgan committed ${kind}`, { timeout: 10000 });
      const refused = alice.page.waitForResponse(response => response.request().method() === mutationMethod && new URL(response.url()).pathname === mutationPath);
      await submit.click();
      const response = await refused, submitted = response.request().postDataJSON();
      assert.equal(response.status(), 409, `${kind}: stale choices must be refused, never silently overwritten.`);
      assert.equal(submitted.expectedRevisionId, before.page.revisionId, `${kind}: submit the page revision the choices began from.`);
      if (kind === 'status') await expect(form).toContainText('Remove the current status.');
      else await expect(retained).toHaveValue(kind === 'icon' ? '🧭' : kind === 'cover' ? 'sand' : 'incident-local');
      const reload = form.getByRole('button', { name: 'Reload saved page', exact: true });
      await expect(reload).toBeVisible();
      await unchanged(canonical, submitted.operationKey);
      await shot('alice', `${kind} choices retained after conflict`);
      await accessible(alice.page, `${kind} revision conflict`);
      await Promise.all([alice.page.waitForEvent('load'), reload.click()]);
      await expect(alice.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(`Morgan committed ${kind}`);
      await history(competing.value.revisionId, canonical);
      await opened();
      // The same explicit choice succeeds after the user loads the current page.
      if (kind === 'display') {
        await alice.page.getByRole('button', { name: 'More', exact: true }).click();
        await alice.page.getByRole('menuitem', { name: 'Display settings', exact: true }).click();
        await alice.page.getByLabel('Labels', { exact: true }).fill('incident-resolved');
        await alice.page.getByRole('combobox', { name: /^Typeface/ }).selectOption('serif');
        submit = alice.page.getByRole('button', { name: 'Save display settings', exact: true });
      } else if (kind === 'status') {
        await openPageAction(alice.page, 'Details');
        await alice.page.getByLabel('Set page status').selectOption('__clear');
        submit = alice.page.getByRole('dialog', { name: 'Change page status', exact: true }).getByRole('button', { name: 'Set status', exact: true });
      } else if (kind === 'labels') {
        await openPageAction(alice.page, 'Details');
        await alice.page.getByRole('button', { name: 'Edit labels', exact: true }).click();
        await alice.page.getByLabel('Labels, separated by commas', { exact: true }).fill('incident-resolved');
        submit = alice.page.getByRole('button', { name: 'Save details', exact: true });
      } else {
        await alice.page.getByRole('button', { name: 'More', exact: true }).click();
        await alice.page.getByRole('menuitem', { name: new RegExp(`^(Add|Change) ${kind}$`) }).click();
        if (kind === 'icon') await alice.page.getByLabel('Icon', { exact: true }).fill('🧭');
        else await alice.page.getByLabel('Gallery', { exact: true }).selectOption('sand');
        submit = alice.page.getByRole('dialog').getByRole('button', { name: 'Save appearance', exact: true });
      }
      const saved = alice.page.waitForResponse(response => response.request().method() === mutationMethod && new URL(response.url()).pathname === mutationPath);
      await submit.click();
      const accepted = await saved;
      assert.equal(accepted.status(), 200);
      const result = await accepted.json(), resolved = await read();
      assert.equal(resolved.page.revisionId, result.value.revisionId);
      if (kind === 'display' || kind === 'labels') assert.deepEqual(resolved.properties.labels, ['incident-resolved']);
      else if (kind === 'icon') assert.equal(resolved.properties.icon, '🧭');
      else if (kind === 'cover') assert.deepEqual(resolved.properties.cover, { kind: 'gallery', id: 'sand' });
      else assert.equal(resolved.properties.statusKey, null);
      await history(competing.value.revisionId, canonical);
      await history(result.value.revisionId, resolved);
      record(`propertyConflict-${kind}`, { refused: 409, fromRevision: submitted.expectedRevisionId, firstWriter: competing.value.revisionId, resolved: result.value.revisionId });
    }
    for (const kind of ['structure', 'order']) {
      await opened();
      const before = await read();
      const matches = url => url.pathname === `${route}/blocks`;
      let intercepted;
      const hold = route => { if (route.request().method() === 'PUT') intercepted = route; else return route.continue(); };
      await alice.page.route(matches, hold);
      let competing, canonical, submitted;
      const block = alice.page.locator(`[data-block-id="${blockIds[2]}"]`).first();
      try {
        await block.hover();
        await block.getByRole('button', { name: /^Block actions for/ }).click();
        await alice.page.getByRole('menuitem', { name: kind === 'structure' ? /^Indent\b/ : 'Move up', exact: true }).click();
        await expect.poll(() => !!intercepted).toBe(true);
        submitted = intercepted.request().postDataJSON();
        assert.equal(submitted.expectedRevisionId, before.page.revisionId, `${kind}: use the starting page revision.`);
        assert.deepEqual(submitted.blockRevisions, Object.fromEntries(before.blocks.map(block => [block.id, block.revisionId])));
        // Morgan changes committed content before Alex's native stale request reaches the Worker.
        const theirs = blocks(before);
        theirs[0] = { ...theirs[0], content: { text: [{ text: `Morgan retained ${kind}.` }] } };
        competing = await ok(bob.context, origin, 'PUT', `${route}/blocks`, {
          operationKey: randomUUID(), expectedRevisionId: before.page.revisionId,
          blockRevisions: Object.fromEntries(before.blocks.map(block => [block.id, block.revisionId])), blocks: theirs,
        });
        canonical = await read();
        const refused = alice.page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `${route}/blocks`);
        await intercepted.continue();
        assert.equal((await refused).status(), 409, `${kind}: the superseded structure is refused.`);
      } finally {
        await intercepted?.abort().catch(() => {});
        await alice.page.unroute(matches, hold);
      }
      const pending = alice.page.getByRole('region', { name: 'Unsaved structure change', exact: true });
      await expect(pending).toBeVisible();
      await expect(pending).toContainText('Agree the next update.');
      const pendingIds = await pending.locator('[data-pending-block-id]').evaluateAll(elements => elements.map(element => element.dataset.pendingBlockId));
      assert.deepEqual(pendingIds, submitted.blocks.map(block => block.id), 'The refused pending order is retained for inspection.');
      if (kind === 'structure') assert.equal(await pending.locator(`[data-pending-block-id="${blockIds[2]}"]`).getAttribute('data-pending-indent'), '1');
      await unchanged(canonical, submitted.operationKey);
      await shot('alice', `${kind} refused choices`);
      await accessible(alice.page, `${kind} refused choices`);
      await pending.getByRole('button', { name: 'Reload saved blocks', exact: true }).click();
      await expect(pending).toHaveCount(0);
      await expect(alice.page.locator(`[data-block-id="${blockIds[0]}"]`).first()).toContainText(`Morgan retained ${kind}.`);
      await block.hover();
      await block.getByRole('button', { name: /^Block actions for/ }).click();
      const saved = alice.page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `${route}/blocks`);
      await alice.page.getByRole('menuitem', { name: kind === 'structure' ? /^Indent\b/ : 'Move up', exact: true }).click();
      const accepted = await saved;
      assert.equal(accepted.status(), 200);
      const result = await accepted.json(), resolved = await read();
      assert.ok(JSON.stringify(resolved.blocks).includes(`Morgan retained ${kind}.`), 'Explicit resolution preserves the competing content.');
      if (kind === 'structure') assert.equal(resolved.blocks.find(block => block.id === blockIds[2]).parentBlockId, blockIds[1]);
      else assert.deepEqual(resolved.blocks.map(block => block.id), [blockIds[0], blockIds[2], blockIds[1]]);
      await history(competing.value.revisionId, canonical);
      await history(result.value.revisionId, resolved);
      await alice.page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(stored(await read()), stored(resolved));
      record(`${kind}Conflict`, { refused: 409, fromRevision: submitted.expectedRevisionId, firstWriter: competing.value.revisionId, resolved: result.value.revisionId });
    }
    record('nativeConflictMutations', mutations);
    await writeFile(`.artifacts/ui-convergence/revision-conflicts-${alice.page.viewportSize().width}.json`, JSON.stringify({
      pageId, width: alice.page.viewportSize().width, mutations, outcomes: people.timings,
    }, null, 2));
  } finally { alice.page.off('response', received); }
}
