import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';
import { root } from '../../e2e/runtime-harness.mjs';
import { accessible } from './browser-evidence.mjs';
import { ok } from './two-people-support.mjs';

/**
 * SEARCH-011: equally relevant verified, unverified and lapsed pages rank in that order
 * with their badges; a near-duplicate pair collapses behind a similar-pages control while
 * a pair below the limit stays apart; anonymous published views carry no trust metadata.
 */
export async function trustRankingJourney({ page, context, origin }) {
  const width = page.viewportSize().width;
  const shot = (view, label) => view.screenshot({ path: path.join(root, `.artifacts/ui-convergence/trust-ranking-${width}-${label}.png`), fullPage: true });
  const space = (await ok(context, origin, 'GET', '/api/containers')).items.find(item => item.name === 'Handbook');
  const create = async (title, text) => {
    const blockId = randomUUID();
    const { value: { pageId } } = await ok(context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, title, blocks: [{ id: blockId, blockType: 'paragraph', treePosition: 'a0', content: { text: [{ text }] } }] });
    return { pageId, blockId };
  };
  const vocabulary = await ok(context, origin, 'GET', '/api/status');
  if (!vocabulary.items.some(entry => entry.key === 'verified' && entry.requiresVerification)) await ok(context, origin, 'POST', '/api/status', { operationKey: randomUUID(), key: 'verified', label: 'Verified', color: '#228855', requiresVerification: true });
  const verify = async pageId => {
    const document = await ok(context, origin, 'GET', `/api/pages/${pageId}`);
    await ok(context, origin, 'POST', `/api/pages/${pageId}/open`, { operationKey: randomUUID(), revisionId: document.workingRevisionId });
    await ok(context, origin, 'POST', `/api/status/page/${pageId}`, { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, statusKey: 'verified', attestRevisionId: document.workingRevisionId, expiresInDays: 30 });
  };

  // Equal matches with equal lengths. The lapsed page is verified, then edited, so it is also the most recently updated.
  const verified = await create('Crane procedure', 'Trustneedle polished documented procedure accepted');
  await verify(verified.pageId);
  await create('Tide procedure', 'Trustneedle tentative research proposal exploration');
  const lapsed = await create('Pier procedure', 'Trustneedle superseded incident historical timeline');
  await verify(lapsed.pageId);
  const before = (await ok(context, origin, 'GET', `/api/pages/${lapsed.pageId}`)).blocks[0];
  await ok(context, origin, 'PATCH', `/api/pages/${lapsed.pageId}/blocks/${lapsed.blockId}`, { operationKey: randomUUID(), expectedRevisionId: before.revisionId, content: { text: [{ text: 'Trustneedle superseded incident archived timeline' }] } });

  // 100 words; replacing the first 8 or 17 gives 5-word-shingle Jaccard 88/104 (0.85) and 79/113 (0.70) against the base.
  const base = Array.from({ length: 100 }, (_, index) => `word${index}`);
  const near = base.map((word, index) => index < 8 ? `near${index}` : word), further = base.map((word, index) => index < 17 ? `far${index}` : word);
  for (const [title, words] of [['Duplicatecorpus base', base], ['Duplicatecorpus near', near], ['Duplicatecorpus further', further]]) await create(title, words.join(' '));

  const search = async query => {
    await page.goto(`${origin}/app/search`, { waitUntil: 'networkidle' });
    await page.getByRole('searchbox', { name: 'Search your workspace', exact: true }).fill(query);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    return page.locator('.search-results > li');
  };
  let results = await search('Trustneedle');
  await expect(results.locator('h2')).toHaveText(['Crane procedure', 'Tide procedure', 'Pier procedure']);
  await expect(results.locator('.trust-state')).toHaveText(['Verified', 'Unverified', 'Lapsed']);
  for (const index of [0, 2]) {
    await expect(results.nth(index).locator('.result-meta')).toContainText('Alex Owner');
    await expect(results.nth(index).locator('.result-meta')).toContainText('Expires');
  }
  await expect(results.nth(1).locator('.result-meta')).not.toContainText('Expires');
  for (const index of [0, 1, 2]) await expect(results.nth(index).locator('.result-meta')).toContainText('Updated');
  await accessible(page, 'verified-first search results');
  await shot(page, 'ranked');

  results = await search('Duplicatecorpus');
  await expect(results).toHaveCount(2);
  const grouped = results.filter({ has: page.locator('details.similar-pages') });
  await expect(grouped).toHaveCount(1);
  const control = grouped.locator('details.similar-pages > summary');
  await expect(control).toHaveText('1 similar page');
  await control.click();
  const pair = [await grouped.locator('a h2').innerText(), await grouped.locator('details.similar-pages li a').innerText()];
  assert.deepEqual(pair.sort(), ['Duplicatecorpus base', 'Duplicatecorpus near'], 'The 0.85 pair collapses into one result.');
  await expect(results.filter({ hasNot: page.locator('details.similar-pages') }).locator('h2')).toHaveText('Duplicatecorpus further');
  await accessible(page, 'collapsed near-duplicates');
  await shot(page, 'similar-pages');

  // Anonymous published views: the verified page and a content query over its space show titles, never trust.
  const index = await ok(context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, title: 'Procedure index', blocks: [{ id: randomUUID(), blockType: 'content-query', treePosition: 'a0', content: { definition: { container: space.id, limit: 20 } } }] });
  for (const [pageId, slug] of [[verified.pageId, 'crane-procedure'], [lapsed.pageId, 'pier-procedure'], [index.value.pageId, 'procedure-index']]) {
    const document = await ok(context, origin, 'GET', `/api/pages/${pageId}`);
    await ok(context, origin, 'POST', `/api/publishing/${pageId}`, { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, host: new URL(origin).host, slug });
  }
  const publicContext = await context.browser().newContext({ viewport: page.viewportSize() });
  try {
    const reader = await publicContext.newPage();
    for (const slug of ['procedure-index', 'crane-procedure', 'pier-procedure']) {
      await reader.goto(`${origin}/p/${slug}`, { waitUntil: 'networkidle' });
      if (slug === 'procedure-index') for (const title of ['Crane procedure', 'Pier procedure']) await expect(reader.getByRole('link', { name: title, exact: true })).toBeVisible();
      await expect(reader.locator('body')).not.toContainText(/Verified|Unverified|Lapsed|Expires|Alex Owner/);
      if (slug === 'procedure-index') await shot(reader, 'published-query');
    }
    assert.deepEqual(await publicContext.cookies(), [], 'The public reader has no session.');
  } finally { await publicContext.close(); }
}
