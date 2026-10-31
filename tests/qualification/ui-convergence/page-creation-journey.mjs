import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { openNavigation } from './browser-support.mjs';
import { accessible } from './browser-evidence.mjs';
import { call, ok } from './two-people-support.mjs';

const placements = items => items.map(({ id, containerId, parentPageId, treePosition, revisionId, title, lifecycle }) =>
  ({ id, containerId, parentPageId: parentPageId ?? null, treePosition, revisionId, title, lifecycle })).sort((a, b) => a.id.localeCompare(b.id));
const content = blocks => blocks.map(({ blockType, content }) => ({ blockType, content }));

/** Native creation doors share one destination, lifecycle and refusal journey. */
export async function pageCreationJourney(state, { phoneProof = false } = {}) {
  const { page, context, origin, api, switchIdentity } = state;
  const width = page.viewportSize().width;
  const shot = label => page.screenshot({ path: `.artifacts/ui-convergence/page-creation-${width}-${label}.png`, fullPage: false });
  const space = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  const parent = (await api('/api/pages')).items.find(item => item.title === 'Welcome');
  const sourceId = (await ok(context, origin, 'POST', '/api/pages', {
    operationKey: randomUUID(), containerId: space.id, title: 'Creation source',
    properties: { labels: ['Operations'] }, blocks: [
      { id: randomUUID(), blockType: 'heading', content: { text: [{ text: 'Incident response' }], level: 2 }, treePosition: 'a' },
      { id: randomUUID(), blockType: 'paragraph', content: { text: [{ text: 'Retain the response procedure.' }] }, treePosition: 'b' },
    ],
  })).value.pageId;
  const sourceBefore = await api(`/api/pages/${sourceId}`);
  const templateId = (await ok(context, origin, 'POST', '/api/templates', {
    operationKey: randomUUID(), sourcePageId: sourceId, includeChildren: false, containerId: null,
    title: 'Creation procedure', description: 'A reusable incident procedure.', category: 'Operations',
  })).value.id;
  const templateBefore = await api(`/api/templates/${templateId}`);
  const retainedTemplate = ({ revisionId, title, description, category, snapshot }) => ({ revisionId, title, description, category, snapshot });
  const originalProfile = (await api('/api/workspace')).policies['page.lifecycle.v1'];

  async function profile(value) {
    await page.goto(`${origin}/app/settings`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Edit workspace & policies', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select[name="page.lifecycle.v1"]').selectOption(value);
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    assert.equal((await api('/api/workspace')).policies['page.lifecycle.v1'], value);
  }
  async function enter(door, template) {
    const existing = new Set((await api('/api/pages')).items.map(item => item.id));
    if (door === 'child') {
      await page.goto(`${origin}/app/pages/${parent.id}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'More', exact: true }).click();
      if (phoneProof) await shot('open-page-child');
      await page.getByRole('menuitem', { name: template ? 'Child from template' : 'Create child page', exact: true }).click();
    } else {
      await page.goto(`${origin}/app/containers/${space.id}`, { waitUntil: 'networkidle' });
      await openNavigation(page);
      if (door === 'global') {
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await page.getByRole('menuitem', { name: template ? 'Page from template' : 'Page', exact: true }).click();
      } else {
        const tree = page.getByRole('navigation', { name: 'Pages', exact: true });
        const name = door === 'tree-child' ? 'Create child of Welcome' : 'Create page in Handbook';
        const trigger = tree.getByRole('button', { name, exact: true });
        if (door === 'tree-child') {
          await tree.getByRole('link', { name: 'Welcome', exact: true }).hover();
          await trigger.focus();
          await page.keyboard.press('Tab');
          await page.keyboard.press('Shift+Tab');
          await expect(trigger).toBeFocused();
          await expect(trigger).toHaveAttribute('data-tooltip', 'Add child');
          assert.equal(await trigger.evaluate(element => getComputedStyle(element, '::after').opacity), '1', 'The focused child control shows its tooltip immediately.');
        }
        await trigger.click();
        if (door === 'tree') await shot('tree-choices');
        await page.getByRole('menuitem', { name: template ? 'Page from template' : 'Blank page', exact: true }).click();
      }
    }
    if (template) {
      await expect(page).toHaveURL(/\/app\/templates/);
      if (door !== 'global') {
        const url = new URL(page.url());
        assert.equal(url.searchParams.get('containerId'), space.id);
        assert.equal(url.searchParams.get('parentPageId'), ['child', 'tree-child'].includes(door) ? parent.id : null);
      }
      await page.locator('.template-choice').filter({ has: page.getByRole('heading', { name: 'Creation procedure', exact: true }) }).click();
      await page.getByRole('button', { name: 'Use this template', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Use this template', exact: true });
      const choice = dialog.getByRole('combobox', { name: /^Create in/ });
      const label = ['child', 'tree-child'].includes(door) ? 'Inside Welcome' : 'Handbook';
      if (door === 'global') await choice.selectOption({ label });
      assert.equal(await choice.locator('option:checked').textContent(), label, 'The originating destination remains selected.');
      if (door === 'child' || door === 'tree-child') {
        await accessible(page, 'template child destination');
        await shot('template-child-destination');
      }
      await dialog.getByRole('button', { name: 'Create page', exact: true }).click();
    }
    await page.waitForURL(url => url.pathname.startsWith('/app/pages/') && !existing.has(url.pathname.split('/').at(-1)), { waitUntil: 'networkidle' });
    await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeVisible();
    return new URL(page.url()).pathname.split('/').at(-1);
  }

  const profiles = phoneProof ? [originalProfile] : ['always-live', 'draft-then-publish'];
  for (const lifecycle of profiles) {
    if (!phoneProof) await profile(lifecycle);
    const cases = phoneProof ? [['tree', false], ['child', true], ['tree-child', true]] :
      ['tree', 'global', 'child', 'tree-child'].flatMap(door => [[door, false], [door, true]]);
    for (const [door, template] of cases) {
      const before = placements((await api('/api/pages')).items);
      const id = await enter(door, template);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(template ? 'Creation source' : 'Untitled');
      const document = await api(`/api/pages/${id}`);
      assert.equal(document.page.containerId, space.id);
      assert.equal(document.parentPageId, ['child', 'tree-child'].includes(door) ? parent.id : null);
      assert.equal(document.page.lifecycle, lifecycle === 'always-live' ? 'live' : 'draft');
      const after = placements((await api('/api/pages')).items);
      assert.deepEqual(after.filter(item => item.id !== id), before, 'Creation changes no existing page or sibling placement.');
      assert.equal(after.length, before.length + 1, `${lifecycle} ${door} creates exactly one page.`);
      const rows = after.filter(item => item.id === id);
      assert.equal(rows.length, 1, 'The page occupies one canonical tree row.');
      assert.ok(rows[0].treePosition, 'The page has an explicit durable sibling position.');
      assert.equal(after.filter(item => item.containerId === space.id && item.parentPageId === document.parentPageId && item.treePosition === rows[0].treePosition).length, 1);
      assert.deepEqual(content(document.blocks), template ? content(sourceBefore.blocks) : []);
      assert.deepEqual(document.properties.labels, template ? ['Operations'] : []);
      if (template) {
        await expect(page.locator('[data-page-editor]')).toContainText('Retain the response procedure.');
        assert.ok(document.blocks.every(block => !sourceBefore.blocks.some(original => original.id === block.id)), 'A copy has fresh block identities.');
      }
      await shot(`${lifecycle}-${door}-${template ? 'template' : 'blank'}`);
    }
    if (!phoneProof) {
      await ok(context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), targetKind: 'container', targetId: space.id, principalKind: 'member', principalId: 'browser-reader', level: 'view' });
      const before = placements((await api('/api/pages')).items);
      await switchIdentity('reader');
      await page.goto(`${origin}/app/pages/${parent.id}`, { waitUntil: 'networkidle' });
      await openNavigation(page);
      const tree = page.getByRole('navigation', { name: 'Pages', exact: true });
      await expect(tree.getByRole('button', { name: 'Create page in Handbook', exact: true })).toHaveCount(0);
      await tree.getByRole('link', { name: 'Welcome', exact: true }).hover();
      await expect(tree.getByRole('button', { name: 'Create child of Welcome', exact: true })).toBeDisabled();
      // Close the phone navigation before opening the page's own action menu.
      const close = page.getByRole('button', { name: 'Close navigation', exact: true });
      if (await close.isVisible()) await close.click();
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Create child page', exact: true })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Child from template', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      for (const parentPageId of [undefined, parent.id]) {
        for (const template of [false, true]) {
          const response = await call(context, origin, 'POST', template ? `/api/templates/${templateId}/apply` : '/api/pages', {
            operationKey: randomUUID(), containerId: space.id, parentPageId,
            ...(template ? { expectedRevisionId: templateBefore.revisionId } : { title: 'Refused creation' }),
          });
          assert.equal(response.status, 404, 'A non-editor cannot create at the root or below a page.');
        }
      }
      await switchIdentity('owner');
      assert.deepEqual(placements((await api('/api/pages')).items), before, 'Every refused creation leaves the entire canonical tree unchanged.');
    }
  }
  if (!phoneProof) await profile(originalProfile);
  assert.deepEqual(retainedTemplate(await api(`/api/templates/${templateId}`)), retainedTemplate(templateBefore), 'Applying copies never changes the source template.');
  const sourceAfter = await api(`/api/pages/${sourceId}`);
  assert.deepEqual({ page: sourceAfter.page, blocks: sourceAfter.blocks, properties: sourceAfter.properties },
    { page: sourceBefore.page, blocks: sourceBefore.blocks, properties: sourceBefore.properties }, 'Creation leaves the source page intact.');
}
