import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { call, grant, ok, withSecondPerson } from './two-people-support.mjs';

const copyProperties = ['icon', 'coverFileId', 'cover', 'labels', 'typeface', 'smallText', 'fullWidth'];
const propertiesOf = document => Object.fromEntries(copyProperties.map(key => [key, document.properties[key]]));
const bodyOf = blocks => blocks.map(({ blockType, content, treePosition, parentBlockId }) => ({
  blockType, content, treePosition,
  parent: parentBlockId ? blocks.findIndex(block => block.id === parentBlockId) : null,
}));

/** Native authored pages exercise both capture choices, every exclusion and the destination's own authority. */
export async function templateCaptureJourney(state) {
  const { page, context, origin, api } = state;
  const width = page.viewportSize().width;
  const shot = label => page.screenshot({ path: `.artifacts/ui-convergence/template-capture-${width}-${label}.png`, fullPage: true });
  const mutate = (route, data, method = 'POST') => ok(context, origin, method, route, { operationKey: randomUUID(), ...data });
  const sourceSpace = (await mutate('/api/containers', { name: 'Capture sources', visibility: 'closed' })).value.id;
  const destination = (await mutate('/api/containers', { name: 'Capture destination', visibility: 'closed' })).value.id;
  await mutate('/api/sharing', { targetKind: 'container', targetId: destination, principalKind: 'member', principalId: 'browser-reader', level: 'view' });
  const statusKey = 'synthetic-slate-review';
  await mutate('/api/status', { key: statusKey, label: 'Source review', color: '#228855', requiresVerification: false });
  const sources = [], excluded = new Set();

  // Every node has real old body content and all seven excluded record families.
  async function author(title, parentPageId, position) {
    const properties = {
      icon: '📘', coverFileId: null, cover: { kind: 'gallery', id: position === 0 ? 'ocean' : 'forest' },
      labels: ['capture', `synthetic-slate-${position}`], typeface: position % 2 ? 'serif' : 'mono',
      smallText: position % 2 === 0, fullWidth: position % 2 !== 0,
    };
    const blocks = [
      { id: randomUUID(), blockType: 'heading', content: { level: 2, text: [{ text: `Retired source body ${position}` }] }, treePosition: 'a0' },
      { id: randomUUID(), blockType: 'paragraph', content: { text: [{ text: `Current instructions ${position}`, marks: ['bold'] }] }, treePosition: 'a1' },
    ];
    const created = await mutate('/api/pages', { containerId: sourceSpace, parentPageId, title, properties, blocks });
    const id = created.value.pageId;
    let document = await api(`/api/pages/${id}`);
    const currentHeading = { level: 2, text: [{ text: `Authored heading ${position}` }] };
    await mutate(`/api/pages/${id}/blocks/${blocks[0].id}`, { expectedRevisionId: document.blocks[0].revisionId, content: currentHeading }, 'PATCH');
    blocks[0].content = currentHeading;
    await grant(context, origin, id, 'browser-reader', 'comment');
    await mutate(`/api/comments/page/${id}`, { body: [{ text: `Private discussion ${position}` }] });
    await mutate('/api/navigation/watches', { pageId: id, enabled: true }, 'PUT');
    document = await api(`/api/pages/${id}`);
    await mutate(`/api/status/page/${id}`, { expectedRevisionId: document.page.revisionId, statusKey });
    document = await api(`/api/pages/${id}`);
    await mutate(`/api/publishing/${id}`, { expectedRevisionId: document.page.revisionId, host: new URL(origin).host, slug: `synthetic-slate-capture-${position}` });
    for (let visit = 0; visit < 3; visit++) await mutate('/api/analytics/views', { pageId: id });
    document = await api(`/api/pages/${id}`);
    assert.deepEqual(propertiesOf(document), properties);
    assert.deepEqual(bodyOf(document.blocks), bodyOf(blocks));
    assert.equal(document.properties.statusKey, statusKey);
    const comments = await api(`/api/comments/page/${id}`);
    assert.equal(comments.comments.length, 1);
    assert.equal(comments.threads.length, 1);
    assert.equal(comments.comments[0].body[0].text, `Private discussion ${position}`);
    const revisions = (await api(`/api/revisions/${id}`)).items;
    assert.ok(revisions.length >= 3, 'The source has historical creation, edit and status revisions.');
    const old = await api(`/api/revisions/${id}/${created.value.revisionId}`);
    assert.ok(JSON.stringify(old).includes(`Retired source body ${position}`));
    const grants = await api(`/api/sharing/pages/${id}`);
    assert.ok(grants.items.some(item => item.principalId === 'browser-reader' && item.level === 'comment'));
    assert.ok((await api('/api/navigation')).watches.includes(id));
    assert.equal((await api(`/api/analytics?pageId=${id}`)).totalViews, 3);
    const exposure = (await api(`/api/publishing/${id}`)).exposure;
    assert.equal(exposure.slug, `synthetic-slate-capture-${position}`);
    assert.equal(exposure.revokedAt, null);
    const anonymous = await fetch(`${origin}/p/${exposure.slug}`, { headers: { connection: 'close' } });
    assert.equal(anonymous.status, 200);
    assert.ok((await anonymous.text()).includes(`Authored heading ${position}`));
    for (const value of [id, ...revisions.map(row => row.id), ...comments.comments.map(row => row.id), ...comments.threads.map(row => row.id), ...grants.items.map(row => row.id), exposure.slug]) excluded.add(value);
    const source = { id, title, properties, blocks, children: [] };
    sources.push(source);
    return source;
  }

  const root = await author('Capture handbook', undefined, 0);
  root.children.push(await author('First child guide', root.id, 1));
  root.children.push(await author('Second child guide', root.id, 2));
  root.children[0].children.push(await author('Nested child guide', root.children[0].id, 3));

  function inspectSnapshot(snapshot, source, includeChildren) {
    assert.equal(snapshot.title, source.title);
    assert.deepEqual(snapshot.properties, source.properties, 'Only authored appearance and labels are retained; source status and authority are excluded.');
    assert.deepEqual(bodyOf(snapshot.blocks), bodyOf(source.blocks));
    for (const key of Object.keys(snapshot)) assert.ok(['title', 'properties', 'blocks', 'children', 'assets', 'databaseId', 'fieldDefinitions', 'fileFieldIds', 'relationFieldIds'].includes(key), `No excluded record family in snapshot: ${key}`);
    for (const block of snapshot.blocks) assert.deepEqual(Object.keys(block).sort(), ['id', 'blockType', 'content', 'parentBlockId', 'treePosition'].sort(), 'Body retains no page or revision record.');
    const serialized = JSON.stringify(snapshot);
    for (const value of excluded) assert.ok(!serialized.includes(value), `Snapshot excludes source record ${value}`);
    assert.ok(!serialized.includes('Private discussion'));
    assert.ok(!serialized.includes('Retired source body'));
    assert.ok(!serialized.includes(statusKey));
    assert.equal(snapshot.children.length, includeChildren ? source.children.length : 0);
    snapshot.children.forEach((child, index) => inspectSnapshot(child, source.children[index], true));
  }

  // Disable the creator's independent autowatch preference so a new implicit
  // watch cannot be confused with copying either source subscriber.
  const preferences = await api('/api/navigation/preferences');
  await mutate('/api/navigation/preferences', { expectedRevisionId: preferences.revisionId, value: { ...preferences.value, autowatch: false } }, 'PUT');
  const sourceWatches = (await api('/api/navigation')).watches;
  assert.ok(sources.every(source => sourceWatches.includes(source.id)), 'Changing autowatch retains the explicitly selected source watches.');

  await withSecondPerson(state, width, async people => {
    for (const source of sources) {
      await ok(people.bob.context, origin, 'PUT', '/api/navigation/watches', { operationKey: randomUUID(), pageId: source.id, enabled: true });
    }
    for (const includeChildren of [false, true]) {
      await page.goto(`${origin}/app/pages/${root.id}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(root.title);
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Save as template', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Save as a template', exact: true });
      const title = includeChildren ? 'Saved handbook tree' : 'Saved handbook only';
      await dialog.getByRole('textbox', { name: 'Template name', exact: true }).fill(title);
      await dialog.getByRole('checkbox', { name: 'Include child pages you can access', exact: true }).setChecked(includeChildren);
      await shot(includeChildren ? 'capture-tree' : 'capture-page');
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/templates' && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Save template', exact: true }).click();
      const response = await saved;
      assert.equal(response.status(), 201);
      const { value: { id } } = await response.json();
      await expect(dialog).toBeHidden();
      const notice = page.getByRole('status').filter({ hasText: 'Template saved.' });
      await expect(notice).toBeVisible();
      const dismiss = notice.getByRole('button', { name: 'Dismiss', exact: true });
      await page.keyboard.press('Tab');
      await dismiss.focus();
      await expect.poll(() => dismiss.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
      await shot(includeChildren ? 'saved-tree-tooltip' : 'saved-page-tooltip');
      await expect(dismiss).toHaveAttribute('data-tooltip', /\S+\s+\S+/);
      await page.getByRole('textbox', { name: 'Page title', exact: true }).focus();
      await page.mouse.move(0, 0);
      await expect.poll(() => dismiss.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('0');
      await dismiss.hover();
      await expect.poll(() => dismiss.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
      await dismiss.click();
      await expect(notice).toHaveCount(0);
      const retained = await api(`/api/templates/${id}`);
      inspectSnapshot(retained.snapshot, root, includeChildren);
      await page.goto(`${origin}/app/templates/${id}`, { waitUntil: 'networkidle' });
      const preview = page.locator('.template-preview');
      await expect(preview).toContainText('Authored heading 0');
      await expect(preview).toContainText('synthetic-slate-0');
      await expect(preview.getByRole('heading', { name: 'Nested child guide', exact: true })).toHaveCount(includeChildren ? 1 : 0);
      await shot(includeChildren ? 'retained-tree' : 'retained-page');
      const before = new Set((await api(`/api/pages?containerId=${destination}`)).items.map(item => item.id));
      await page.getByRole('button', { name: 'Use this template', exact: true }).click();
      const use = page.getByRole('dialog', { name: 'Use this template', exact: true });
      await use.getByRole('combobox', { name: /^Create in/ }).selectOption({ label: 'Capture destination' });
      const submitted = page.waitForRequest(request => new URL(request.url()).pathname === `/api/templates/${id}/apply` && request.method() === 'POST');
      const applied = page.waitForResponse(response => new URL(response.url()).pathname === `/api/templates/${id}/apply` && response.request().method() === 'POST');
      await use.getByRole('button', { name: 'Create page', exact: true }).click();
      const appliedResponse = await applied;
      assert.equal(appliedResponse.status(), 201);
      const input = (await submitted).postDataJSON();
      await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(root.title);
      await page.waitForLoadState('networkidle');
      // Read the durable receipt through its native retry door after navigation.
      const receipt = await ok(context, origin, 'POST', `/api/templates/${id}/apply`, input);
      const copiedIds = receipt.value.pageIds;
      assert.equal(copiedIds.length, includeChildren ? sources.length : 1);
      assert.equal(new Set(copiedIds).size, copiedIds.length);
      const createdId = receipt.value.pageId;
      await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(root.title);
      assert.equal(new URL(page.url()).pathname, `/app/pages/${createdId}`);
      await page.waitForLoadState('networkidle');
      const created = (await api(`/api/pages?containerId=${destination}`)).items.filter(item => !before.has(item.id));
      assert.deepEqual(created.map(item => item.id).sort(), [...copiedIds].sort(), 'Only the requested root and optional descendants are created.');
      const ownerWatches = (await api('/api/navigation')).watches;
      const readerWatches = (await ok(people.bob.context, origin, 'GET', '/api/navigation')).watches;
      async function inspectCopy(copyId, source, parentId) {
        const copy = await api(`/api/pages/${copyId}`);
        assert.equal(copy.page.title, source.title);
        assert.equal(copy.page.containerId, destination);
        assert.equal(copy.parentPageId, parentId);
        assert.deepEqual(propertiesOf(copy), source.properties);
        assert.deepEqual(bodyOf(copy.blocks), bodyOf(source.blocks));
        for (const block of copy.blocks) assert.ok(!sources.some(item => item.blocks.some(original => original.id === block.id)), 'Applied body gets new block identifiers.');
        assert.equal(copy.properties.statusKey, null);
        assert.equal((await api(`/api/status/page/${copyId}`)).verification, null);
        assert.deepEqual(await api(`/api/comments/page/${copyId}`), { threads: [], comments: [], reactions: [] });
        const history = (await api(`/api/revisions/${copyId}`)).items;
        assert.equal(history.length, 1, 'Only this new page creation revision exists.');
        assert.ok(!excluded.has(history[0].id));
        const grants = await api(`/api/sharing/pages/${copyId}`);
        assert.deepEqual(grants.items, [], 'No direct source grants are copied.');
        assert.ok(grants.effectiveItems.some(item => item.principalId === 'browser-reader' && item.level === 'view' && item.origin.id === destination));
        const reader = await ok(people.bob.context, origin, 'GET', `/api/pages/${copyId}`);
        assert.equal(reader.permissions.level, 'view', 'Access comes from the destination, without the source comment grant.');
        const refused = await call(people.bob.context, origin, 'POST', `/api/comments/page/${copyId}`, { operationKey: randomUUID(), body: [{ text: 'Refused source authority' }] });
        assert.equal(refused.status, 404);
        assert.deepEqual((await api(`/api/comments/page/${copyId}`)).comments, []);
        assert.equal((await api(`/api/pages/${copyId}`)).page.revisionId, copy.page.revisionId);
        assert.ok(!ownerWatches.includes(copyId) && !readerWatches.includes(copyId));
        const analytics = await api(`/api/analytics?pageId=${copyId}`);
        assert.equal(analytics.totalViews, copyId === createdId ? 1 : 0, 'Only the newly opened copy has its own view; source readership is absent.');
        assert.equal(analytics.uniqueViewers, copyId === createdId ? 1 : 0);
        assert.equal((await api(`/api/publishing/${copyId}`)).exposure, null);
        const children = created.filter(item => item.parentPageId === copyId);
        assert.equal(children.length, includeChildren ? source.children.length : 0);
        for (const [index, child] of children.entries()) {
          assert.equal(child.title, source.children[index].title);
          await inspectCopy(child.id, source.children[index], copyId);
        }
      }
      await inspectCopy(createdId, root, null);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(root.title);
      await expect(page.locator('[data-page-editor]')).toContainText('Authored heading 0');
      await shot(includeChildren ? 'applied-tree' : 'applied-page');
      assert.deepEqual(await api(`/api/templates/${id}`), retained, 'Applying leaves the retained template unchanged.');
      for (const source of sources) {
        const original = await api(`/api/pages/${source.id}`);
        assert.deepEqual(propertiesOf(original), source.properties);
        assert.deepEqual(bodyOf(original.blocks), bodyOf(source.blocks));
        assert.equal(original.properties.statusKey, statusKey);
        assert.equal((await api(`/api/comments/page/${source.id}`)).comments.length, 1);
        assert.ok((await api(`/api/sharing/pages/${source.id}`)).items.some(item => item.principalId === 'browser-reader' && item.level === 'comment' && item.effective));
        assert.ok((await api(`/api/publishing/${source.id}`)).exposure);
      }
      console.log(`PROBE TMPL-005 ${includeChildren ? 'children on' : 'children off'}: More > Save as template, preview and Use this template -> ${copiedIds.length} exact copies, all seven source record families excluded at ${width}px`);
    }
  });
}
