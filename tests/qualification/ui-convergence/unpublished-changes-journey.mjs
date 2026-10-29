import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {call, editable, grant, ok, restrictedPage} from './two-people-support.mjs';

/** Native publication and discard with an editor and a read-only member. */
export async function unpublishedChangesJourney(state, people) {
  const {alice, bob, shot} = people, {origin} = state;
  const workspace = await ok(alice.context, origin, 'GET', '/api/workspace');
  const profile = async lifecycle => {
    const current = await ok(alice.context, origin, 'GET', '/api/workspace');
    const {name, mark, description, guestAccess, publicLinkAccess, anonymousAccess} = current;
    await ok(alice.context, origin, 'PUT', '/api/workspace', {
      operationKey: randomUUID(), expectedRevisionId: current.revisionId,
      name, mark, description, guestAccess, publicLinkAccess, anonymousAccess,
      policies: {...workspace.policies, 'page.lifecycle.v1': lifecycle},
    });
  };
  const page = alice.page;
  const indication = view => view.getByRole('status').filter({hasText: /^Unpublished changes\./});
  const document = (person = alice) => ok(person.context, origin, 'GET', `/api/pages/${pageId}`);
  let pageId;
  try {
    await profile('draft-then-publish');
    const created = await restrictedPage({context: alice.context, origin}, 'Published response guide', ['Published response body']);
    pageId = created.pageId;
    const [blockId] = created.blockIds;
    await grant(alice.context, origin, pageId, bob.id, 'view');
    await page.goto(`${origin}/app/pages/${pageId}`, {waitUntil: 'networkidle'});
    const publish = async (title, body) => {
      await page.getByRole('button', {name: 'More', exact: true}).click();
      await page.getByRole('menuitem', {name: 'Publish workspace revision', exact: true}).click();
      const dialog = page.getByRole('dialog', {name: 'Publish this revision', exact: true});
      const preview = dialog.getByRole('region', {name: 'Workspace publication preview'});
      await expect(preview.getByRole('heading')).toHaveText(title);
      await expect(preview).toContainText(body);
      await dialog.getByRole('button', {name: 'Review publication', exact: true}).click();
      await expect(dialog.getByRole('region', {name: 'Reviewed publication'})).toBeVisible();
      await dialog.getByRole('button', {name: 'Publish workspace revision', exact: true}).click();
      await expect(dialog).toBeHidden();
      await expect.poll(async () => (await document()).page.lifecycle).toBe('live');
    };
    const read = async (person, title, body) => {
      await expect(person.page.getByRole('textbox', {name: 'Page title', exact: true})).toHaveValue(title);
      await expect(person.page.locator(`[data-block-id="${blockId}"]`).first()).toContainText(body);
      const current = await document(person);
      assert.equal(current.page.title, title);
      assert.equal(current.blocks[0].content.text.map(span => span.text).join(''), body);
      return current;
    };
    const edit = async (title, body) => {
      const savedTitle = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${pageId}`);
      await page.getByRole('textbox', {name: 'Page title', exact: true}).fill(title);
      await editable(page, blockId).click();
      assert.equal((await savedTitle).status(), 200);
      const savedBody = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${pageId}/blocks/${blockId}`);
      await editable(page, blockId).fill(body);
      assert.equal((await savedBody).status(), 200);
      await expect(page.locator('.editor-save-status').filter({hasText: /^Saved$/})).toBeVisible();
      await expect(indication(page)).toBeVisible();
    };
    await publish('Published response guide', 'Published response body');
    await bob.page.goto(`${origin}/app/pages/${pageId}`, {waitUntil: 'networkidle'});
    await read(bob, 'Published response guide', 'Published response body');
    assert.equal((await document(bob)).permissions.canEdit, false);
    await expect(bob.page.getByRole('textbox', {name: 'Page title', exact: true})).toHaveAttribute('readonly', '');
    await edit('Revised response guide', 'Revised response body');
    await page.reload({waitUntil: 'networkidle'});
    await read(alice, 'Revised response guide', 'Revised response body');
    await expect(indication(page)).toBeVisible();
    await shot('alice', 'unpublished title and body indicated');
    await bob.page.reload({waitUntil: 'networkidle'});
    await read(bob, 'Published response guide', 'Published response body');
    await expect(indication(bob.page)).toHaveCount(0);
    await shot('bob', 'published revision retained after reload');
    await publish('Revised response guide', 'Revised response body');
    await expect(indication(page)).toHaveCount(0);
    await bob.page.reload({waitUntil: 'networkidle'});
    await read(bob, 'Revised response guide', 'Revised response body');
    await edit('Discarded response guide', 'Discarded response body');
    const before = await document();
    const history = (await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}`)).items;
    const snapshots = new Map();
    for (const version of history) snapshots.set(version.id, await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}/${version.id}`));
    assert.ok([...snapshots.values()].some(version => version.properties.title === 'Discarded response guide'), 'The version to discard is actually retained.');
    const denied = await call(bob.context, origin, 'POST', `/api/pages/${pageId}/discard-changes`, {operationKey: randomUUID(), expectedRevisionId: before.page.revisionId});
    assert.equal(denied.status, 404, 'A read-only member cannot discard editor work.');
    assert.equal((await document()).workingRevisionId, before.workingRevisionId);
    assert.deepEqual((await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}`)).items, history);
    // Switching policy must hide publication-only surfaces without destroying the work.
    await profile('always-live');
    await page.reload({waitUntil: 'networkidle'});
    await expect(indication(page)).toHaveCount(0);
    await page.getByRole('button', {name: 'More', exact: true}).click();
    await expect(page.getByRole('menuitem', {name: 'Discard unpublished changes', exact: true})).toHaveCount(0);
    await expect(page.getByRole('menuitem', {name: 'Publish workspace revision', exact: true})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await profile('draft-then-publish');
    await page.reload({waitUntil: 'networkidle'});
    await expect(indication(page)).toBeVisible();
    await page.getByRole('button', {name: 'More', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Discard unpublished changes', exact: true}).click();
    const confirm = page.getByRole('dialog', {name: 'Confirm this page change', exact: true});
    await expect(confirm).toContainText('Its history is retained.');
    await confirm.getByRole('button', {name: 'Confirm', exact: true}).click();
    await expect(confirm).toBeHidden();
    await page.reload({waitUntil: 'networkidle'});
    const restored = await read(alice, 'Revised response guide', 'Revised response body');
    assert.equal(restored.page.lifecycle, 'live');
    assert.equal(restored.workingRevisionId, before.publishedRevisionId);
    assert.equal(restored.publishedRevisionId, before.publishedRevisionId);
    await expect(indication(page)).toHaveCount(0);
    const after = (await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}`)).items;
    for (const version of history) {
      assert.ok(after.some(item => item.id === version.id && !item.deletedAt), 'Every pre-discard version remains undeleted.');
      const retained = await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}/${version.id}`);
      const {newerRevisionExists: beforeNotice, ...original} = snapshots.get(version.id);
      const {newerRevisionExists: afterNotice, ...immutable} = retained;
      assert.deepEqual(immutable, original, 'Authorized editors can still read the identical pre-discard version.');
      assert.notEqual(retained.deleted, true);
    }
    await shot('alice', 'discard restored published title and body');
    await page.goto(`${origin}/app/pages/${pageId}?detail=history&revision=${before.workingRevisionId}`, {waitUntil: 'networkidle'});
    const retainedPreview = page.locator('.revision-preview');
    await expect(retainedPreview).toContainText('Discarded response body');
    await expect(retainedPreview.getByRole('button', {name: 'Restore this revision', exact: true})).toBeVisible();
    await shot('alice', 'discarded working version remains readable in History');
    await page.goto(`${origin}/app/pages/${pageId}`, {waitUntil: 'networkidle'});
    await bob.page.reload({waitUntil: 'networkidle'});
    await read(bob, 'Revised response guide', 'Revised response body');
    await expect(indication(bob.page)).toHaveCount(0);
    const comments = page.getByRole('button', {name: 'Comments', exact: true});
    await comments.focus();
    assert.equal(await comments.evaluate(element => getComputedStyle(element, '::after').opacity), '1', 'Icon control tooltip appears immediately on keyboard focus.');
    await page.getByRole('textbox', {name: 'Page title', exact: true}).focus();
    await comments.hover();
    await expect.poll(() => comments.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
    await shot('alice', 'page icon tooltip after discard');
  } finally {
    await profile(workspace.policies['page.lifecycle.v1'] ?? 'always-live');
  }
}
