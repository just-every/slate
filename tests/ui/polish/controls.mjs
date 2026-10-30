import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ok } from '../../qualification/ui-convergence/two-people-support.mjs';

// Keep shared Checkbox tooltips bounded in every database host, including a
// trailing list field whose tip must expand back into the row.
async function databaseCheckboxBounds({ page, context, origin, api }, containerId, enabledRing) {
  const mutate = async (route, data) => (await ok(context, origin, 'POST', route, { operationKey: randomUUID(), ...data })).value;
  const database = await mutate('/api/databases', { containerId, title: 'Checkbox tooltip bounds' });
  const base = `/api/databases/${database.id}`;
  const field = { id: randomUUID(), name: 'Confirm this checkbox field remains readable within its database list, record, peek and gallery without widening the page. '.repeat(2).slice(0, 160), type: 'checkbox', config: {}, position: 0 };
  let revision = (await mutate(base + '/fields', { expectedRevisionId: database.revisionId, field })).revisionId;
  for (const [position, layout] of ['list', 'gallery'].entries()) {
    const view = { id: randomUUID(), name: `Checks ${layout}`, layout, filters: [], sorts: [], groups: [], calculations: {}, display: { visibleFieldIds: [field.id] }, position };
    revision = (await mutate(base + '/views', { expectedRevisionId: revision, view })).revisionId;
  }
  const record = await mutate(base + '/records', { title: 'Release checkbox', values: { [field.id]: false } });
  for (const surface of ['list', 'record', 'peek', 'gallery']) {
    if (surface === 'record') await page.goto(`${origin}/app/databases/${database.id}/records/${record.pageId}`, { waitUntil: 'networkidle' });
    else {
      await page.goto(`${origin}/app/databases/${database.id}`, { waitUntil: 'networkidle' });
      const view = page.getByRole('button', { name: `Checks ${surface === 'gallery' ? 'gallery' : 'list'}`, exact: true });
      await view.click();
      await expect(view).toHaveAttribute('aria-pressed', 'true');
      if (surface === 'peek') await page.getByRole('button', { name: 'Release checkbox', exact: true }).click();
    }
    // Changing views and opening a peek fetch their own record content. Finish
    // that render before placing the pointer on its final checkbox position.
    await page.waitForLoadState('networkidle');
    const host = surface === 'peek' ? page.getByRole('dialog', { name: 'Record preview', exact: true }) : page;
    const checkbox = host.getByRole('checkbox', { name: field.name, exact: true });
    await expect(checkbox).toBeDisabled();
    const measure = () => checkbox.evaluate(el => {
      const style = getComputedStyle(el, '::after'), box = el.getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, viewport: innerWidth, width: parseFloat(style.width), left: box.x + el.clientLeft + parseFloat(style.left), opacity: style.opacity, delay: style.transitionDelay, wrap: style.whiteSpace, ring: getComputedStyle(el).boxShadow, controlOpacity: getComputedStyle(el).opacity };
    });
    if (surface === 'gallery') assert.equal(await checkbox.evaluate(el => getComputedStyle(el.closest('article')).overflow), 'visible', 'SL35 gallery tips are not clipped by the card');
    const rest = await measure();
    assert.equal(rest.scroll, rest.viewport, `SL35 ${surface}: a hidden field tip does not widen the page`);
    assert.notEqual(rest.ring, enabledRing, `Read-only ${surface} checkbox keeps its faded ring`);
    // CI's headless Chromium froze for ~5 s (renderer, browser and GPU processes idle
    // in one task) when a hover followed straight after the pointer left another
    // control on an idle page. Let that settle, keep frames rendering, and let the
    // 300 ms delay and fade finish before the first read.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
    await page.evaluate(() => { const loop = () => { window.__tipFrames = requestAnimationFrame(loop); }; loop(); });
    await checkbox.hover();
    await page.waitForTimeout(1000);
    await expect.poll(() => checkbox.evaluate(el => el.matches(':hover')), { message: `SL35 ${surface}: the pointer reaches the field` }).toBe(true);
    await expect.poll(async () => (await measure()).opacity, { message: `SL35 ${surface}: the field tip appears after hover` }).toBe('1');
    const shown = await measure();
    await page.evaluate(() => cancelAnimationFrame(window.__tipFrames));
    assert.equal(shown.scroll, shown.viewport, `SL35 ${surface}: a shown field tip does not widen the page`);
    assert.ok(shown.width <= 256 && shown.left >= 0 && shown.left + shown.width <= shown.viewport, `SL35 ${surface}: the field name wraps inside its cap`);
    assert.equal(shown.wrap, 'normal');
    assert.equal(shown.delay, '0.3s');
    assert.equal(shown.controlOpacity, '1', `Disabled ${surface} tip retains full strength`);
  }
}

// Extend the existing polish registration: paging and tooltips at desktop,
// phone-only review targets at phone width, all through the emitted Worker.
export async function controlPolishJourney({ page, context, origin, api }, width) {
  const containerId = (await api('/api/containers')).items.find(space => space.name === 'Handbook').id;
  const post = (route, data) => ok(context, origin, 'POST', route, { operationKey: randomUUID(), ...data });
  const workspace = await api('/api/workspace');
  const { name, mark, description, guestAccess, publicLinkAccess, anonymousAccess } = workspace;
  await ok(context, origin, 'PUT', '/api/workspace', { operationKey: randomUUID(), expectedRevisionId: workspace.revisionId, name, mark, description, guestAccess, publicLinkAccess, anonymousAccess, policies: { ...workspace.policies, 'page.lifecycle.v1': 'draft-then-publish' } });
  const blockId = randomUUID();
  const taskText = 'Check release notes '.repeat(22).slice(0, 400);
  const pageId = (await post('/api/pages', { containerId, title: 'Release review', blocks: [{ id: blockId, blockType: 'task', treePosition: '0', content: { text: [{ text: taskText }], done: false } }] })).value.pageId;
  await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  if (width === 1440) {
    const checkbox = page.getByRole('checkbox', { name: `Mark complete: ${taskText}`, exact: true });
    const name = await checkbox.getAttribute('aria-label');
    const enabledRing = await checkbox.evaluate(el => getComputedStyle(el).boxShadow);
    await expect(checkbox).toHaveAttribute('data-tooltip', name);
    const assertNoOverflow = async locator => {
      const box = await locator.evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth }));
      assert.equal(box.scroll, box.width, 'SL35 long To-do tips do not widen their surface');
    };
    await assertNoOverflow(page.locator('html'));
    const tip = await checkbox.evaluate(el => {
      const style = getComputedStyle(el, '::after');
      return { width: parseFloat(style.width), position: style.position, wrap: style.whiteSpace };
    });
    assert.ok(tip.width <= 256, 'SL35 long names wrap inside the 16rem cap');
    assert.equal(tip.position, 'absolute');
    assert.equal(tip.wrap, 'normal');
    await page.mouse.move(0, 0);
    await checkbox.hover();
    await expect.poll(() => checkbox.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
    const hover = await checkbox.evaluate(el => { const s = getComputedStyle(el, '::after'); return { text: s.content, delay: s.transitionDelay, pointerEvents: s.pointerEvents }; });
    assert.equal(JSON.parse(hover.text), name);
    assert.equal(hover.delay, '0.3s');
    assert.equal(hover.pointerEvents, 'none');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await checkbox.focus();
    await expect.poll(() => checkbox.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
    assert.equal(await checkbox.evaluate(el => getComputedStyle(el, '::after').transitionDelay), '0s');
    await page.keyboard.press('Escape');
    await expect.poll(() => checkbox.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
    await page.mouse.move(0, 0);
    await checkbox.blur();
    await checkbox.focus();
    await expect.poll(() => checkbox.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    const enabledFill = await checkbox.evaluate(el => getComputedStyle(el).backgroundColor);
    await expect.poll(async () => (await api(`/api/pages/${pageId}`)).blocks[0].content.done).toBe(true);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Publish workspace revision', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Workspace publication preview', exact: true });
    await expect(preview.getByRole('checkbox')).toBeDisabled();
    const disabledTip = preview.getByRole('checkbox');
    await disabledTip.hover();
    await expect.poll(() => disabledTip.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
    assert.equal(await disabledTip.evaluate(el => getComputedStyle(el).opacity), '1', 'Disabled control does not fade its accessible-name tip');
    assert.notEqual(await disabledTip.evaluate(el => getComputedStyle(el).backgroundColor), enabledFill, 'Read-only checked To-do keeps its faded fill');
    await assertNoOverflow(preview);
    await assertNoOverflow(page.locator('html'));
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Present this page', exact: true }).click();
    await expect(page.locator('.page-presentation article').getByRole('checkbox')).toBeDisabled();
    await assertNoOverflow(page.locator('.page-presentation article'));
    await assertNoOverflow(page.locator('html'));
    await page.getByRole('button', { name: 'Exit presentation', exact: true }).click();
    await databaseCheckboxBounds({ page, context, origin, api }, containerId, enabledRing);
    for (let i = 0; i < 30; i++) await post('/api/pages', { containerId, title: `Release guide ${i + 1}` });
    await page.goto(origin + '/app/search?q=&kind=page', { waitUntil: 'networkidle' });
    const next = page.getByRole('button', { name: 'Next results →', exact: true });
    const save = page.getByRole('button', { name: 'Save this search', exact: true });
    await expect(next).toBeVisible();
    const a = await next.boundingBox(), last = await page.locator('.search-results > li').last().boundingBox();
    assert.ok(a.y >= last.y + last.height, 'SL33 paging sits under the last result');
    await next.click();
    await expect(next).toHaveCount(0);
    await page.getByRole('button', { name: 'Filter results', exact: true }).click();
    await save.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } else {
    await post('/api/status', { key: 'verified', label: 'Verified', color: '#228855', requiresVerification: true });
    let document = await api(`/api/pages/${pageId}`);
    await post(`/api/status/page/${pageId}`, { expectedRevisionId: document.page.revisionId, statusKey: 'verified', attestRevisionId: document.workingRevisionId, expiresInDays: 30 });
    document = await api(`/api/pages/${pageId}`);
    await ok(context, origin, 'PUT', `/api/pages/${pageId}/blocks`, { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, blocks: [{ id: blockId, blockType: 'task', treePosition: '0', content: { text: [{ text: 'Check release notes today' }], done: false } }] });
    await page.reload({ waitUntil: 'networkidle' });
    await page.goto(origin + '/app/review', { waitUntil: 'networkidle' });
    const row = page.locator('.review-list li').filter({ hasText: 'Release review' });
    const title = row.getByRole('link', { name: 'Release review', exact: true });
    const checkbox = row.getByRole('checkbox', { name: 'Select Release review', exact: true });
    await expect(checkbox).toBeEnabled();
    const linkBox = await title.boundingBox(), checkBox = await checkbox.boundingBox();
    assert.ok(linkBox.height >= 44, 'SL34 title has a 44px phone target');
    assert.ok(checkBox.width >= 44 && checkBox.height >= 44, 'SL34 selection has a 44px square phone target');
    const chipBox = await row.locator('.page-status-chip').boundingBox();
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    assert.ok(!overlaps(linkBox, chipBox) && !overlaps(checkBox, chipBox), 'SL34 the status chip does not overlap either target');
    let checked = false;
    for (const y of [1, 22, 43]) {
      for (const x of [1, 22, 43]) {
        await checkbox.scrollIntoViewIfNeeded();
        const box = await checkbox.boundingBox();
        await page.mouse.click(box.x + x, box.y + y);
        checked = !checked;
        await expect(checkbox).toBeChecked({ checked });
        await expect(page).toHaveURL(origin + '/app/review');
      }
    }
    await expect(page.getByRole('button', { name: 'Verify selected opened revisions', exact: true })).toBeEnabled();
    for (const y of [1, 22, 43]) {
      await title.click({ position: { x: 2, y } });
      await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Release review');
      await page.goto(origin + '/app/review', { waitUntil: 'networkidle' });
    }
  }
}
