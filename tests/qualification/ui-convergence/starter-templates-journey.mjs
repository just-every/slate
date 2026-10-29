import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';
import { root } from '../../e2e/runtime-harness.mjs';
import { accessible } from './browser-evidence.mjs';
import { templateScopeJourney } from './template-scope-journey.mjs';

const starters = { 'Meeting notes': 'Meetings', Retrospective: 'Meetings', Decision: 'Decisions', 'How-to guide': 'Documentation', 'Troubleshooting article': 'Documentation', 'Product requirements': 'Planning', 'Project plan': 'Planning', Runbook: 'Operations', 'Onboarding page': 'Teams', 'Team home': 'Teams', 'Policy page': 'Policies' };

/** TMPL-007: the shipped starter set in the gallery, from a workspace's first sign-in. */
export async function starterTemplatesJourney(state) {
  const { page, origin, api } = state;
  const width = page.viewportSize().width;
  const shot = label => page.screenshot({ path: path.join(root, `.artifacts/ui-convergence/starter-templates-${width}-${label}.png`), fullPage: true });
  const choice = title => page.locator('.template-choice').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const gallery = async () => { await page.goto(origin + '/app/templates', { waitUntil: 'networkidle' }); return page.getByLabel('Category', { exact: true }); };
  let category = await gallery();
  for (const [title, name] of Object.entries(starters)) {
    await category.fill(name);
    await expect(choice(title)).toBeVisible();
    await expect(choice(title)).toContainText(name);
  }
  await category.fill('Meetings');
  await choice('Meeting notes').click();
  const preview = page.locator('.template-preview');
  await expect(preview.getByRole('heading', { name: 'Meeting notes', exact: true, level: 2 })).toBeVisible();
  for (const text of ['Attendees', 'Agenda', 'Action items']) await expect(preview).toContainText(text);
  await accessible(page, 'starter template preview');
  await shot('preview');
  await page.getByRole('button', { name: 'Use this template', exact: true }).click();
  const use = page.getByRole('dialog', { name: 'Use this template', exact: true });
  await use.getByRole('combobox', { name: /^Create in/ }).selectOption({ label: 'Handbook' });
  await use.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Meeting notes');
  const pageId = new URL(page.url()).pathname.split('/').at(-1);
  const assignee = page.getByRole('combobox', { name: 'Task assignee', exact: true }).first();
  await assignee.selectOption({ index: 1 });
  const saved = async () => (await api(`/api/pages/${pageId}`)).blocks.find(block => block.blockType === 'task')?.content.assigneeMemberId ?? '';
  await expect.poll(saved).not.toBe('');
  await expect(assignee).toHaveValue(await saved());
  await shot('assigned');

  category = await gallery();
  await category.fill('Meetings');
  await choice('Retrospective').click();
  const shipped = (await api('/api/templates?category=Meetings')).items.find(item => item.title === 'Retrospective');
  const before = await api(`/api/templates/${shipped.id}`);
  await expect(page.getByRole('button', { name: 'Update from a page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByRole('dialog', { name: 'Duplicate template', exact: true }).getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(choice('Retrospective copy')).toBeVisible();
  await choice('Retrospective copy').click();
  await page.getByRole('button', { name: 'Update from a page', exact: true }).click();
  const update = page.getByRole('dialog', { name: 'Update this template', exact: true });
  await update.locator('select[name="sourcePageId"]').selectOption(pageId);
  await update.locator('input[name="title"]').fill('Team retro');
  await update.getByRole('button', { name: 'Save updated template', exact: true }).click();
  await expect(choice('Team retro')).toBeVisible();
  await shot('duplicated');
  assert.deepEqual(await api(`/api/templates/${shipped.id}`), before, 'The shipped retrospective stays unchanged.');
  await templateScopeJourney(state);
}
