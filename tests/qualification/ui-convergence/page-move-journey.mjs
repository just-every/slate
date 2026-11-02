import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { inbox, newOutboxLink } from '../../e2e/outbox-auth.mjs';
import { accessible } from './browser-evidence.mjs';
import { call, ok } from './two-people-support.mjs';

/** PAGE-004: an edit-only member reviews and moves a populated branching tree. */
export async function pageMoveJourney(state, people, { proofOnly = false } = {}) {
  const { context, origin, api } = state, mover = people.bob, view = mover.page;
  const key = () => randomUUID();
  const screens = new Set();
  const captureScreen = async (label, page = view) => {
    if (screens.has(label)) return;
    await accessible(page, label);
    screens.add(label);
  };
  const readers = [];
  try {
    // Admit independent readers through the same single-use invitation as a person.
    for (const name of ['source-reader', 'destination-reader']) {
      const email = [name + '-' + key(), 'test.invalid'].join('@'), mail = await inbox(origin);
      await ok(context, origin, 'POST', '/api/invitations', { operationKey: key(), email, kind: 'member' });
      const link = new URL(await newOutboxLink(origin, mail));
      const accepted = await fetch(origin + '/api/auth/invitation/accept', { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: link.searchParams.get('token') }) });
      assert.equal(accepted.status, 303);
      const readerContext = await context.browser().newContext({ viewport: view.viewportSize() });
      await readerContext.addCookies([{ name: 'slate_session', value: accepted.headers.get('set-cookie').split(';', 1)[0].split('=')[1], url: origin }]);
      readers.push({ context: readerContext, page: await readerContext.newPage(), ...(await ok(readerContext, origin, 'GET', '/api/session')).member });
    }
    const [sourceReader, destinationReader] = readers;
    const share = async (targetKind, targetId, principalId, level, extra = {}) => ok(context, origin, 'POST', '/api/sharing', { operationKey: key(), targetKind, targetId, principalKind: 'member', principalId, level, ...extra });
    const source = (await ok(context, origin, 'POST', '/api/containers', { operationKey: key(), name: 'Move source', visibility: 'private' })).value.id;
    const destination = (await ok(context, origin, 'POST', '/api/containers', { operationKey: key(), name: 'Move destination', visibility: 'private' })).value.id;
    await share('container', source, mover.id, 'edit');
    await share('container', destination, mover.id, 'edit');
    const create = async (title, containerId = source, parentPageId = null, blocks = []) => (await ok(context, origin, 'POST', '/api/pages', { operationKey: key(), containerId, parentPageId, title, blocks })).value.pageId;
    const oldParent = await create('Original move parent'), newParent = await create('Another move parent');
    const targetParent = await create('Destination move parent', destination);
    await share('page', oldParent, sourceReader.id, 'view');
    const inherited = await share('page', newParent, destinationReader.id, 'comment');
    await share('page', targetParent, destinationReader.id, 'view');
    const nodes = [];
    const firstSibling = await create('Before moving branch', source, oldParent);
    for (const [title, parentIndex] of [['Moving branch', -1], ['Left branch', 0], ['Right branch', 0], ['Deep leaf', 1]]) {
      const blockId = key(), text = `Retained body for ${title}.`, parent = parentIndex < 0 ? oldParent : nodes[parentIndex].id;
      const id = await create(title, source, parent, [{ id: blockId, blockType: 'paragraph', treePosition: 'a', content: { text: [{ text }] } }]);
      const document = await api(`/api/pages/${id}`);
      await ok(context, origin, 'POST', `/api/comments/page/${id}`, { operationKey: key(), kind: 'inline', blockId, anchorRevisionId: document.page.revisionId, anchor: { anchorId: key(), quote: text }, body: [{ text: `Retained discussion for ${title}.` }] });
      await ok(context, origin, 'PATCH', `/api/pages/${id}`, { operationKey: key(), expectedRevisionId: document.page.revisionId, properties: { labels: ['retained-move'] } });
      nodes.push({ id, title, blockId, text, parent });
    }
    const root = nodes[0].id, lastSibling = await create('After moving branch', source, oldParent);
    const linkPage = await create('Permanent move references', source, null, nodes.map((node, index) => ({ id: key(), blockType: 'paragraph', treePosition: String(index), content: { text: [{ text: node.title, link: { href: `${origin}/app/pages/${node.id}` } }] } })));
    await share('page', linkPage, destinationReader.id, 'view');
    const retained = new Map();
    for (const node of nodes) {
      const history = (await api(`/api/revisions/${node.id}`)).items;
      assert.equal(history.length, 2, 'The move corpus includes multiple immutable snapshots per node.');
      const document = await api(`/api/pages/${node.id}`);
      assert.equal(document.permissions.level, 'full');
      assert.equal((await ok(mover.context, origin, 'GET', `/api/pages/${node.id}`)).permissions.level, 'edit');
      retained.set(node.id, { blocks: document.blocks, properties: document.properties, comments: await api(`/api/comments/page/${node.id}`), history, snapshots: await Promise.all(history.map(async version => [version.id, await api(`/api/revisions/${node.id}/${version.id}`)])) });
    }
    const topology = async () => (await api('/api/pages')).items.map(item => ({ id: item.id, containerId: item.containerId, parentPageId: item.parentPageId, treePosition: item.treePosition, revisionId: item.revisionId })).sort((a, b) => a.id.localeCompare(b.id));
    const canonical = async () => ({ tree: await topology(), content: await Promise.all(nodes.map(async node => ({ document: await api(`/api/pages/${node.id}`), history: await api(`/api/revisions/${node.id}`), comments: await api(`/api/comments/page/${node.id}`) }))), moves: await api('/api/activity?action=pages.move&limit=100') });
    const initialTree = await topology();
    const siblings = async parent => (await api('/api/pages')).items.filter(item => item.parentPageId === parent).map(item => item.id);
    assert.deepEqual(await siblings(oldParent), [firstSibling, root, lastSibling]);
    for (const node of nodes) {
      assert.equal((await call(sourceReader.context, origin, 'GET', `/api/pages/${node.id}`)).status, 200);
      assert.equal((await call(destinationReader.context, origin, 'GET', `/api/pages/${node.id}`)).status, 404);
    }
    const openPicker = async () => {
      await view.goto(`${origin}/app/pages/${root}`, { waitUntil: 'networkidle' });
      await view.getByRole('button', { name: 'More', exact: true }).click();
      await view.getByRole('menuitem', { name: 'Move page', exact: true }).click();
      const picker = view.getByRole('dialog', { name: 'Move “Moving branch”', exact: true });
      await expect(picker).toBeVisible();
      await expect(picker.getByRole('combobox', { name: 'Move destinations' })).toBeVisible();
      return picker;
    };
    const review = async (parentId, label, containerId = source) => {
      const before = await canonical(), picker = await openPicker();
      // The source and every descendant are excluded as cycle destinations.
      for (const node of nodes) await expect(picker.locator(`[role="option"][id$="page-${node.id}"]`)).toHaveCount(0);
      await picker.getByRole('combobox', { name: 'Move destinations' }).fill('No destination with this title');
      await expect(picker.getByRole('button', { name: 'Move page', exact: true })).toBeDisabled();
      await picker.getByRole('combobox', { name: 'Move destinations' }).fill(label);
      await picker.getByRole('option').filter({ hasText: label }).click();
      await expect(picker).toContainText('3 child pages move with it.');
      if (!proofOnly) {
        const close = picker.getByRole('button', { name: 'Close', exact: true });
        await close.focus();
        await expect(close).toHaveAttribute('data-tooltip', 'Close dialog');
        assert.equal(await close.evaluate(element => getComputedStyle(element, '::after').opacity), '1');
      }
      await captureScreen('page move searchable destination');
      const previewResponse = view.waitForResponse(response => new URL(response.url()).pathname === `/api/pages/${root}/move-preview` && response.request().method() === 'POST');
      await picker.getByRole('button', { name: 'Move page', exact: true }).click();
      const response = await previewResponse;
      assert.equal(response.status(), 200, await response.text());
      const input = response.request().postDataJSON(), preview = await response.json();
      assert.deepEqual(input, { containerId, parentPageId: parentId, atEnd: true });
      const dialog = view.getByRole('dialog', { name: 'Review changed access', exact: true });
      await expect(dialog).toBeVisible();
      const members = (await api('/api/members')).items;
      const titles = new Map(nodes.map(node => [node.id, node.title]));
      const expected = preview.changes.map(change => `${members.find(member => member.id === change.memberId).displayName} · ${titles.get(change.pageId)}: ${change.before ?? 'No access'} → ${change.after ?? 'No access'}`);
      assert.deepEqual(await dialog.locator('li').allTextContents(), expected, 'Every displayed access change agrees with the native preview.');
      assert.deepEqual(await canonical(), before, 'Picking and reviewing do not move or edit anything.');
      await captureScreen('page move access review');
      return { dialog, preview, input };
    };
    const confirm = async (parentId, label, containerId = source) => {
      const { dialog, preview, input } = await review(parentId, label, containerId);
      // Read the real receipt before delivering it: success immediately navigates
      // the browser, which otherwise discards the old document's response body.
      const matches = url => url.pathname === `/api/pages/${root}/move`;
      let resolve, reject;
      const committed = new Promise((done, fail) => { resolve = done; reject = fail; });
      const capture = async route => {
        try {
          const response = await route.fetch({ maxRetries: 0 });
          const receipt = { status: response.status(), submitted: route.request().postDataJSON(), result: await response.json() };
          await route.fulfill({ response });
          resolve(receipt);
        } catch (cause) { reject(cause); }
      };
      await view.route(matches, capture);
      let receipt;
      try {
        await dialog.getByRole('button', { name: 'Move page', exact: true }).click();
        receipt = await committed;
      } finally { await view.unroute(matches, capture); }
      const { submitted, result } = receipt;
      assert.equal(receipt.status, 200, JSON.stringify(result));
      assert.equal(submitted.accessPreviewHash, preview.accessPreviewHash);
      assert.equal(submitted.orderPreviewHash, preview.orderPreviewHash);
      for (const [field, value] of Object.entries(input)) assert.equal(submitted[field], value);
      assert.equal(result.receipt.entity.id, root);
      await expect(dialog).toBeHidden();
      await expect(view.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Moving branch');
      await view.reload({ waitUntil: 'networkidle' });
      const after = await topology();
      for (const node of nodes) {
        const row = after.find(item => item.id === node.id), original = initialTree.find(item => item.id === node.id);
        assert.equal(row.containerId, containerId);
        assert.equal(row.parentPageId, node.id === root ? parentId : node.parent);
        if (node.id !== root) assert.equal(row.treePosition, original.treePosition, 'Descendant order is retained exactly.');
        const own = await ok(mover.context, origin, 'GET', `/api/pages/${node.id}`);
        assert.equal(own.permissions.level, 'edit', 'A non-owner completes the move without sharing authority.');
        assert.deepEqual(own.blocks, retained.get(node.id).blocks);
      }
      for (const row of initialTree.filter(row => !nodes.some(node => node.id === row.id))) assert.deepEqual(after.find(item => item.id === row.id), row, 'Unrelated topology and revisions are unchanged.');
      people.record(`move-${parentId}`, { preview, input: submitted, receipt: result.receipt, topology: after });
      return preview;
    };
    if (!proofOnly) {
      let before = await canonical(), picker = await openPicker();
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.deepEqual(await canonical(), before, 'Picker cancellation changes nothing.');
      const cancelled = await review(newParent, 'Another move parent');
      await cancelled.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.deepEqual(await canonical(), before, 'Access-review cancellation changes nothing.');
      const stale = await review(newParent, 'Another move parent');
      await share('page', newParent, destinationReader.id, 'view', { id: inherited.value.id });
      before = await canonical();
      const refused = view.waitForResponse(response => new URL(response.url()).pathname === `/api/pages/${root}/move` && response.request().method() === 'POST');
      await stale.dialog.getByRole('button', { name: 'Move page', exact: true }).click();
      const response = await refused;
      assert.equal(response.status(), 409);
      assert.equal((await response.json()).code, 'ACCESS_PREVIEW_CHANGED');
      await expect(stale.dialog.getByRole('alert')).toContainText('Review the current access changes before moving.');
      assert.deepEqual(await canonical(), before, 'A stale native preview leaves topology, content, comments, revisions and move activity unchanged.');
      await stale.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await share('page', newParent, destinationReader.id, 'comment', { id: inherited.value.id });
    }
    await confirm(oldParent, 'Original move parent');
    assert.deepEqual(await siblings(oldParent), [firstSibling, lastSibling, root], 'Moving to the same parent stores the new position.');
    const reparent = await confirm(newParent, 'Another move parent');
    assert.equal(reparent.changes.filter(change => change.memberId === sourceReader.id && change.before === 'view' && change.after === null).length, 4);
    assert.equal(reparent.changes.filter(change => change.memberId === destinationReader.id && change.before === null && change.after === 'comment').length, 4);
    const cross = await confirm(targetParent, 'Destination move parent', destination);
    assert.equal(cross.changes.filter(change => change.memberId === destinationReader.id && change.before === 'comment' && change.after === 'view').length, 4);
    for (const node of nodes) {
      const data = retained.get(node.id), document = await api(`/api/pages/${node.id}`);
      assert.deepEqual(document.blocks, data.blocks);
      assert.deepEqual(document.properties, data.properties);
      assert.deepEqual(await api(`/api/comments/page/${node.id}`), data.comments);
      const history = (await api(`/api/revisions/${node.id}`)).items;
      for (const version of data.history) assert.deepEqual(history.find(item => item.id === version.id), version);
      for (const [id, snapshot] of data.snapshots) assert.deepEqual(await api(`/api/revisions/${node.id}/${id}`), snapshot, 'Pre-existing revision snapshots remain byte-equivalent.');
      assert.equal((await call(sourceReader.context, origin, 'GET', `/api/pages/${node.id}`)).status, 404);
      const readable = await ok(destinationReader.context, origin, 'GET', `/api/pages/${node.id}`);
      assert.equal(readable.permissions.level, 'view');
      assert.deepEqual(readable.blocks, data.blocks);
      assert.deepEqual(await ok(destinationReader.context, origin, 'GET', `/api/comments/page/${node.id}`), data.comments);
      assert.ok(!(await ok(sourceReader.context, origin, 'GET', '/api/pages')).items.some(item => item.id === node.id));
      await destinationReader.page.goto(`${origin}/app/pages/${linkPage}`, { waitUntil: 'networkidle' });
      const opened = destinationReader.page.waitForEvent('popup');
      await destinationReader.page.getByRole('link', { name: node.title, exact: true }).click();
      const linked = await opened;
      try {
        await expect(linked).toHaveURL(`${origin}/app/pages/${node.id}`);
        await linked.reload({ waitUntil: 'networkidle' });
        await expect(linked.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(node.title);
        await expect(linked.locator(`[data-block-id="${node.blockId}"]`).first()).toContainText(node.text);
        if (node === nodes.at(-1)) await captureScreen('moved descendant permanent link after reload', linked);
      } finally { await linked.close(); }
      const listed = (await ok(destinationReader.context, origin, 'GET', '/api/pages')).items.find(item => item.id === node.id);
      assert.equal(listed.containerId, destination);
      assert.equal(listed.parentPageId, node.id === root ? targetParent : node.parent);
    }
    console.log(`PROBE PAGE-004 picker: native More and filtered destinations -> selected parent, three descendants, cancellation unchanged`);
    console.log(`PROBE PAGE-004 1: non-owner edit-only review and move -> exact four-node topology, destination access, unchanged comments, snapshots and permanent links at ${view.viewportSize().width}px`);
    console.log('PROBE PAGE-004 2: native cross-container confirmation -> four pages in the destination, inherited reader changes displayed before commit and applied after reload');
  } finally {
    await Promise.all(readers.map(reader => reader.context.close()));
  }
}
