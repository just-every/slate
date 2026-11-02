import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible, openPageAction } from './browser-support.mjs';
import { ok } from './two-people-support.mjs';

/** REV-004: native snapshots selected through History, under both history profiles. */
export async function revisionCompareJourney(state, width) {
  const { page, context, origin } = state;
  const api = (method, route, data) => ok(context, origin, method, route, data);
  const original = await api('GET', '/api/workspace');
  const space = (await api('GET', '/api/containers')).items.find(item => item.name === 'Handbook');
  const cases = [];
  const setProfile = async policy => {
    await page.goto(origin + '/app/settings?section=workspace', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Edit workspace & policies', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true });
    await dialog.getByLabel('History', { exact: true }).selectOption(policy);
    const committed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace' && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
    assert.equal((await committed).status(), 200);
    await expect(dialog).toHaveCount(0);
    assert.equal((await api('GET', '/api/workspace')).policies['page.version.v1'], policy);
  };
  const inspect = async ({ pageId, left, right, history }, reverse = false, proof = false) => {
    const before = reverse ? right : left, after = reverse ? left : right;
    await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
    await openPageAction(page, 'History');
    await expect(page.getByRole('heading', { name: 'Version history', exact: true })).toBeVisible();
    const entries = page.locator('.history-list button');
    await expect(entries).toHaveCount(history.items.length);
    // Select by its position in the independently read native history; do not
    // preload a selected revision or comparison into the route.
    await entries.nth(history.items.findIndex(item => item.id === before.id)).click();
    await expect(page.locator('.revision-preview')).toBeVisible();
    const selector = page.getByRole('combobox', { name: 'Compare with', exact: true });
    const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/revisions/${pageId}/compare/${before.id}/${after.id}`);
    await selector.selectOption(after.id);
    assert.equal((await response).status(), 200);
    const comparison = page.getByRole('region', { name: 'Revision comparison', exact: true });
    await expect(comparison).toBeVisible();
    if (width === 1440) {
      const changes = { anchor: 'unchanged', removed: reverse ? 'added' : 'removed', changed: 'changed', moved: 'changed', typed: 'changed', nested: 'changed', added: reverse ? 'removed' : 'added' };
      for (const [label, snapshot] of [['Before revision', before], ['After revision', after]]) {
        const side = comparison.getByRole('region', { name: label, exact: true });
        const blocks = side.locator('[data-comparison-block]');
        await expect(blocks).toHaveCount(snapshot.blocks.length);
        assert.deepEqual(await blocks.evaluateAll(elements => elements.map(element => element.dataset.comparisonBlock)), snapshot.blocks.map(block => block.id), `${label} retains committed order, including an insertion and a move.`);
        for (const block of snapshot.blocks) {
          const rendered = side.locator(`[data-comparison-block="${block.id}"]`);
          await expect(rendered.getByRole('heading').first()).toHaveText(changes[block.id.split('-').at(-1)]);
          await expect(rendered).toContainText(block.content.text.map(run => run.text).join(''));
          assert.equal(await rendered.getAttribute('data-tree-position'), block.treePosition);
          assert.equal(await rendered.getAttribute('data-parent-block-id'), block.parentBlockId ?? '');
          const content = rendered.locator('[data-comparison-content]');
          const margin = await content.evaluate(element => parseFloat(getComputedStyle(element).marginInlineStart));
          assert.equal(margin, block.parentBlockId ? 20 : 0, 'The nested block is shown in its committed place.');
          if (block.blockType === 'quote') await expect(content.locator('blockquote')).toBeVisible();
        }
      }
      await comparison.getByText('Property changes', { exact: true }).click();
      assert.deepEqual(JSON.parse(await comparison.locator('pre').innerText()), { before: before.properties, after: after.properties });
      await expect(selector).toHaveValue(after.id);
      if (proof) await accessible(page, 'revision comparison at 1440');
    } else if (proof) {
      // One phone smoke and screenshot; the full behaviour asserts at desktop.
      await expect(comparison).toContainText('Call the new escalation line.');
      await accessible(page, 'revision comparison at 390');
    }
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Version history', exact: true })).toBeVisible();
    // History is reopened after reload, so selection is available independently
    // of transient component state.
    await page.locator('.history-list button').nth(history.items.findIndex(item => item.id === before.id)).click();
    await page.getByRole('combobox', { name: 'Compare with', exact: true }).selectOption(after.id);
    await expect(page.getByRole('region', { name: 'Revision comparison', exact: true })).toContainText('Call the new escalation line.');
  };
  try {
    for (const policy of ['autosnapshot', 'labelled']) {
      await setProfile(policy);
      const tag = randomUUID();
      const block = (name, text, position, extra = {}) => ({ id: `${tag}-${name}`, blockType: 'paragraph', content: { text: [{ text }] }, treePosition: position, ...extra });
      const blocks = [block('anchor', 'Keep the introduction.', '00'), block('removed', 'Retire the old instruction.', '10'), block('changed', 'Call the old escalation line.', '20'), block('moved', 'Move this instruction earlier.', '30'), block('typed', 'Keep these words as a quotation.', '40'), block('nested', 'Nest this explanation.', '50')];
      const created = await api('POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, title: `Compare ${policy}`, blocks });
      const pageId = created.value.pageId;
      const middle = await api('PATCH', `/api/pages/${pageId}`, { operationKey: randomUUID(), expectedRevisionId: created.receipt.revisionId, properties: { title: `Compare ${policy}, edited` } });
      const edited = await api('PUT', `/api/pages/${pageId}/blocks`, { operationKey: randomUUID(), expectedRevisionId: middle.receipt.revisionId, blocks: [blocks[0], block('added', 'Add the new instruction here.', '05'), { ...blocks[3], treePosition: '15' }, block('changed', 'Call the new escalation line.', '20'), { ...blocks[4], blockType: 'quote' }, { ...blocks[5], parentBlockId: blocks[0].id }] });
      const left = await api('GET', `/api/revisions/${pageId}/${created.receipt.revisionId}`);
      const right = await api('GET', `/api/revisions/${pageId}/${edited.receipt.revisionId}`);
      const history = await api('GET', `/api/revisions/${pageId}`);
      assert.deepEqual(history.items.slice(0, 3).map(item => item.id), [right.id, middle.receipt.revisionId, left.id], 'The selected pair is nonadjacent.');
      const item = { pageId, left, right, history };
      cases.push(item);
      await inspect(item, false, policy === 'labelled');
      if (width === 1440) await inspect(item, true);
    }
    for (const policy of ['autosnapshot', 'labelled']) {
      await setProfile(policy);
      for (const item of cases) {
        await inspect(item);
        assert.deepEqual(await api('GET', `/api/revisions/${item.pageId}`), item.history, 'Profile switches and comparison add no revisions.');
        assert.deepEqual(await api('GET', `/api/revisions/${item.pageId}/${item.left.id}`), item.left, 'The earlier snapshot is immutable.');
        assert.deepEqual(await api('GET', `/api/revisions/${item.pageId}/${item.right.id}`), item.right, 'The later snapshot is immutable.');
      }
    }
    console.log(`PROBE REV-004 1: Settings History switches autosnapshot to labelled and back -> both saved pairs compare without changing revisions at ${width}px`);
    console.log(`PROBE REV-004 2: Version history selects exact nonadjacent native revisions -> added, removed, changed and unchanged blocks retain each side's committed content and positions at ${width}px`);
  } finally {
    await setProfile(original.policies['page.version.v1']);
  }
}
