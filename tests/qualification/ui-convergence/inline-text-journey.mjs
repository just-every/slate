import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { call } from './two-people-support.mjs';

/** Exercise the writing controls before comparing their single canonical span. */
export async function inlineTextJourney(state, pageId, width) {
  const { page, api, context, origin } = state;
  const addText = async () => {
    await page.getByRole('button', { name: /Add block/ }).click();
    await page.getByRole('option', { name: 'Text', exact: true }).click();
    return page.getByRole('textbox', { name: 'Paragraph', exact: true }).last();
  };
  const text = await addText();
  await text.fill('Every inline mark');
  const read = () => api(`/api/pages/${pageId}`);
  await expect.poll(async () => (await read()).blocks.at(-1).content.text).toEqual([{ text: 'Every inline mark' }]);
  const select = async () => { await text.click(); await text.press('ControlOrMeta+a'); };
  const save = async action => {
    const pending = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname.includes(`/api/pages/${pageId}/blocks/`));
    await action();
    assert.equal((await pending).status(), 200);
  };
  for (const key of ['b', 'i', 'u']) { await select(); await save(() => text.press(`ControlOrMeta+${key}`)); }
  const toolbar = page.getByRole('toolbar', { name: 'Formatting for the selected text' });
  for (const name of ['Strikethrough', 'Inline code']) {
    await select();
    await expect(toolbar.getByRole('button', { name, exact: true })).toHaveAttribute('data-tooltip', /\S+\s+\S+/);
    await save(() => toolbar.getByRole('button', { name, exact: true }).click());
  }
  await select();
  for (const name of ['Bold','Italic','Underline','Strikethrough','Inline code','Text colour','Add a link']) {
    const control = toolbar.getByRole('button', { name, exact: true });
    await expect(control).toHaveAttribute('data-tooltip', /\S+\s+\S+/);
  }
  const colourControl = toolbar.getByRole('button', { name: 'Text colour', exact: true });
  await colourControl.focus();
  await expect.poll(() => colourControl.evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1');
  await select();
  await toolbar.getByRole('button', { name: 'Text colour', exact: true }).click();
  await save(() => page.getByRole('button', { name: 'Blue', exact: true }).click());
  await page.keyboard.press('Escape');
  await select();
  await toolbar.getByRole('button', { name: 'Add a link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Link selected text', exact: true });
  await dialog.getByLabel('Link', { exact: true }).fill('https://example.invalid/document');
  await save(() => dialog.getByRole('button', { name: 'Apply link', exact: true }).click());
  const expected = [{text:'Every inline mark',marks:['bold','italic','underline','strikethrough','code'],colour:'blue',link:{href:'https://example.invalid/document'}}];
  assert.deepEqual((await read()).blocks.at(-1).content.text, expected);
  await page.reload({ waitUntil: 'networkidle' });
  const formatted = page.getByRole('textbox', { name: 'Paragraph', exact: true }).last();
  await expect(formatted.locator('strong em u s code')).toHaveText('Every inline mark');
  await expect(formatted.getByRole('link', { name: 'Every inline mark' })).toHaveAttribute('href', 'https://example.invalid/document');
  assert.notEqual(await formatted.locator('span.bg-hl-blue').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.deepEqual((await read()).blocks.at(-1).content.text, expected);

  const mentions = await addText();
  for (const [query, option] of [['Alex', 'Alex Owner · Person'], [state.journeyTitle, `${state.journeyTitle} · Page`], ['2030-06-15', '2030-06-15 · Date']]) {
    await mentions.click(); await mentions.press('ControlOrMeta+End');
    await page.keyboard.type(` @${query}`);
    await page.getByRole('listbox', { name: 'Insert mention', exact: true }).getByRole('option', { name: option, exact: true }).click();
    await expect.poll(async () => (await read()).blocks.at(-1).content.text.filter(span => span.mention).length).toBe(query === 'Alex' ? 1 : query === state.journeyTitle ? 2 : 3);
  }
  const document = await read();
  await page.reload({ waitUntil: 'networkidle' });
  const restored = page.getByRole('textbox', { name: 'Paragraph', exact: true }).last();
  await expect(restored.locator('[data-mention-kind=person]')).toContainText('@Alex Owner');
  await expect(restored.locator('[data-mention-kind=page] a')).toHaveAttribute('href', `/app/pages/${pageId}`);
  await expect(restored.locator('[data-mention-kind=date]')).toHaveText('6/15/2030');
  assert.deepEqual((await read()).blocks, document.blocks);
  await page.screenshot({ path: `.artifacts/ui-convergence/inline-marks-${width}.png`, fullPage: true });
  const block = document.blocks.at(-1);
  const activity = (await api('/api/activity')).items;
  for (const span of [{text:'unsafe',link:{href:'javascript:alert(1)'}},{text:'unsafe',marks:['script']},{text:'unsafe',html:'<img src=x onerror=alert(1)>'}]) {
    const response = await call(context, origin, 'PATCH', `/api/pages/${pageId}/blocks/${block.id}`, {operationKey:randomUUID(),expectedRevisionId:block.revisionId,content:{text:[span]}});
    assert.equal(response.status, 400);
    const unchanged = await read();
    assert.deepEqual(unchanged.blocks, document.blocks, 'Refused markup cannot change canonical content.');
    assert.deepEqual(unchanged.page, document.page, 'A refusal cannot advance the page revision.');
    assert.deepEqual((await api('/api/activity')).items, activity, 'A refusal creates no activity.');
  }
  console.log(`PROBE BLOCK-002 native marks, links, mentions and unsafe writes at ${width}: persisted spans and visible output agree; three unsafe writes refused without changes`);
}
