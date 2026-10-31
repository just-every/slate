import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { expect } from '@playwright/test';
import { closeDetails } from './browser-support.mjs';
import { accessible } from './browser-evidence.mjs';
import { editable, grant, ok } from './two-people-support.mjs';

export async function pageDisplayJourney(state, people) {
  const { page, context, origin, api } = state;
  const width = page.viewportSize().width;
  const space = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  const blocks = [
    { blockType: 'heading', content: { level: 1, text: [{ text: 'When a customer needs help' }] } },
    { blockType: 'paragraph', content: { text: [{ text: 'Name the incident owner, record customer impact and agree on the next update before changing production. Keep a written timeline so the next responder can take over.' }] } },
    { blockType: 'paragraph', content: { text: [{ text: 'After recovery, confirm the service is healthy and share the follow-up actions with the team.' }] } },
  ].map((block, index) => ({ ...block, id: randomUUID(), treePosition: String(index) }));
  const { value: { pageId } } = await ok(context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, title: 'Customer incident response', blocks });
  await grant(context, origin, pageId, 'browser-reader', 'view');
  const shot = (view, label) => view.screenshot({ path: `.artifacts/ui-convergence/page-display-${width}-${label}.png`, fullPage: false });
  async function checkDisplay(view, display) {
    const document = view.locator('.main.page-document');
    await expect(document).toHaveAttribute('data-typeface', display.typeface);
    assert.equal(await document.evaluate(element => element.classList.contains('page-small-text')), display.smallText);
    assert.equal(await document.evaluate(element => element.classList.contains('page-full-width')), display.fullWidth);
    const paragraph = view.locator('[data-slate-editable]').filter({ hasText: 'Name the incident owner' });
    const style = await paragraph.evaluate(element => ({ font: getComputedStyle(element).fontFamily, size: getComputedStyle(element).fontSize }));
    if (display.typeface === 'serif') assert.match(style.font, /Georgia/);
    if (display.typeface === 'mono') assert.match(style.font, /monospace/);
    if (display.smallText) assert.equal(style.size, '14px');
    return style;
  }
  await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  for (const display of [
    { typeface: 'serif', smallText: true, fullWidth: true },
    { typeface: 'mono', smallText: false, fullWidth: true },
    { typeface: 'default', smallText: false, fullWidth: false },
  ]) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Display settings', exact: true }).click();
    await page.getByRole('combobox', { name: /^Typeface/ }).selectOption(display.typeface);
    await page.getByLabel('Small text', { exact: true }).setChecked(display.smallText);
    await page.getByLabel('Full width', { exact: true }).setChecked(display.fullWidth);
    // Keep the panel and its pending choices open while this tab commits text.
    // The next display write must follow our receipt without requiring a reload.
    if (display.typeface !== 'default') {
      const bodyEdit = display.typeface === 'mono';
      const path = `/api/pages/${pageId}${bodyEdit ? `/blocks/${blocks[2].id}` : ''}`;
      const [saved] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === path),
        (async () => {
          if (bodyEdit) {
            // Keyboard focus can reach the body behind the phone's side panel.
            await editable(page, blocks[2].id).focus();
            await page.keyboard.press('ControlOrMeta+End');
            await page.keyboard.type(' Confirmed by the incident lead.');
          } else {
            await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('Customer incident response — reviewed');
            await page.getByRole('combobox', { name: /^Typeface/ }).focus();
          }
        })(),
      ]);
      assert.equal(saved.status(), 200, 'Our text save succeeds while Display settings stays open.');
      await expect(page.locator('.editor-save-status')).toHaveText('Saved');
      await expect(page.getByRole('region', { name: 'Display settings', exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: /^Typeface/ })).toHaveValue(display.typeface);
    }
    const beforeDisplay = await api(`/api/pages/${pageId}`);
    if (display.typeface === 'serif') assert.equal(beforeDisplay.page.title, 'Customer incident response — reviewed');
    if (display.typeface === 'mono') assert.match(JSON.stringify(beforeDisplay.blocks[2].content), /Confirmed by the incident lead\./);
    const savedDisplay = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${pageId}`);
    await page.getByRole('button', { name: 'Save display settings', exact: true }).click();
    assert.equal((await savedDisplay).status(), 200, 'Display settings follows our own text save without a conflict or reload.');
    await expect(page.getByRole('status').filter({ hasText: 'Display settings saved.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload saved page', exact: true })).toHaveCount(0);
    const persisted = await api(`/api/pages/${pageId}`);
    for (const [key, value] of Object.entries(display)) assert.equal(persisted.properties[key], value, `Stored ${key} matches the pending display choice.`);
    await accessible(page, 'page display settings');
    await shot(page, `${display.typeface}-settings`);
    await closeDetails(page);
    await page.reload({ waitUntil: 'networkidle' });
    const ownerStyle = await checkDisplay(page, display);
    await shot(page, `${display.typeface}-owner`);
    await people.bob.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
    assert.deepEqual(await checkDisplay(people.bob.page, display), ownerStyle, 'The reader uses the same stored display as the editor.');
    await shot(people.bob.page, `${display.typeface}-reader`);
    const current = await api(`/api/pages/${pageId}`);
    assert.deepEqual(current.blocks, beforeDisplay.blocks, 'Display changes preserve stored body content, including our own edit.');
    if (display.typeface !== 'serif') continue;
    // Open the product's actual exported HTML, including its own offline styles.
    const response = await context.request.post(`${origin}/api/exports/readable`, { headers: { origin }, data: { scope: 'page', id: pageId, format: 'html' } });
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    const exported = unzipSync(bytes);
    const output = await context.newPage();
    try {
      await output.setContent(new TextDecoder().decode(exported[`pages/${pageId}.html`]));
      const style = await output.locator('body').evaluate(element => ({ font: getComputedStyle(element).fontFamily, size: getComputedStyle(element).fontSize, width: getComputedStyle(element).maxWidth }));
      assert.match(style.font, /Georgia/); assert.equal(style.size, '14px'); assert.equal(style.width, 'none');
      await shot(output, 'exported-html');
    } finally { await output.close(); }
    const previous = new Set((await api('/api/pages')).items.map(item => item.id));
    const upload = await context.request.post(`${origin}/api/imports`, { headers: { origin }, multipart: { file: { name: 'incident-response.zip', mimeType: 'application/zip', buffer: bytes }, format: 'slate-readable', operationKey: randomUUID() } });
    assert.equal(upload.status(), 200);
    const job = await upload.json();
    const imported = await ok(context, origin, 'POST', `/api/imports/${job.id}/run`, {});
    assert.equal(imported.state, 'completed');
    const copy = (await api('/api/pages')).items.find(item => !previous.has(item.id));
    assert.ok(copy);
    await page.goto(`${origin}/app/pages/${copy.id}`, { waitUntil: 'networkidle' });
    await checkDisplay(page, display);
    await shot(page, 'reimported');
    await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  }
}
