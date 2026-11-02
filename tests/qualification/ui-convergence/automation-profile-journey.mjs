import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { ok } from './two-people-support.mjs';

/** Read definitions and populated histories independently of the presentation policy. */
export async function automationInventory(api) {
  const rules = (await api('/api/automation')).items;
  return Promise.all(rules.map(async rule => ({ rule, runs: (await api(`/api/automation/${rule.id}/runs`)).items })));
}

export async function switchAutomationProfile({ page, origin, api }, value) {
  const before = await api('/api/workspace');
  await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Edit workspace & policies', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true });
  await dialog.getByRole('combobox', { name: 'Automation boundaries', exact: true }).selectOption(value);
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual((await api('/api/workspace')).policies, { ...before.policies, 'automation.scope.v1': value });
}

/** Also used after a genuine ZIP restore, with restored execution authority disabled. */
export async function reconcileAutomationProfiles(state, expected) {
  assert.ok(expected.length >= 2, 'Compare populated rule definitions and execution histories.');
  for (const value of ['source', 'container', 'site', 'source']) {
    await switchAutomationProfile(state, value);
    assert.deepEqual(await automationInventory(state.api), expected, `${value} preserves every stored scope, definition and run after reload.`);
  }
}

/** One database toolbar and both rule-list profiles use native forms and real execution. */
export async function automationProfileJourney(state) {
  const { page, origin, context, api } = state;
  const post = (route, data) => ok(context, origin, 'POST', route, { operationKey: randomUUID(), ...data });
  const space = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  const databases = [];
  for (const title of ['Profile intake', 'Other intake']) {
    databases.push((await post('/api/databases', { containerId: space.id, title })).value);
  }
  const [database, other] = databases;
  const toolbar = async id => {
    await page.goto(`${origin}/app/databases/${id}`, { waitUntil: 'networkidle' });
    await page.getByRole('navigation', { name: 'Saved views' }).getByRole('button', { name: 'Automations', exact: true }).click();
  };
  const list = () => page.locator('.settings-panel').filter({ has: page.getByRole('heading', { name: 'Let the routine run.', exact: true }) });
  const row = name => list().locator('.settings-list > li').filter({ has: page.getByText(name, { exact: true }) });
  const create = async (name, scope) => {
    await page.getByRole('button', { name: 'New automation', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Create automation', exact: true });
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    if (scope === 'source') {
      await expect(form.getByRole('combobox', { name: 'Run across', exact: true })).toHaveCount(0);
      await expect(form.getByRole('combobox', { name: 'Apply actions to', exact: true })).toHaveCount(0);
      await expect(form.getByRole('combobox', { name: 'Space', exact: true })).toHaveCount(0);
      await expect(form.getByRole('combobox', { name: 'Database', exact: true })).toBeDisabled();
      await expect(form.getByRole('combobox', { name: 'Database', exact: true })).toHaveValue(database.id);
      await expect(form.getByRole('combobox', { name: 'When', exact: true })).toHaveCount(1);
      await expect(form.getByRole('heading', { name: 'Do', exact: true })).toHaveCount(1);
    } else {
      const selector = form.getByRole('combobox', { name: 'Run across', exact: true });
      assert.deepEqual(await selector.locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['source', 'container', 'site']);
      await selector.selectOption(scope);
      if (scope === 'container') await form.getByRole('combobox', { name: 'Space', exact: true }).selectOption(space.id);
      await expect(form.getByRole('combobox', { name: 'Apply actions to', exact: true })).toBeVisible();
    }
    await form.getByRole('combobox', { name: 'When', exact: true }).selectOption('record-created');
    await form.getByRole('button', { name: 'Add action', exact: true }).click();
    await form.getByRole('textbox', { name: 'Comment', exact: true }).fill(`Recorded by ${name}`);
    await page.screenshot({ path: `.artifacts/ui-convergence/automation-${scope}-1440.png`, fullPage: true });
    await form.getByRole('button', { name: 'Save automation', exact: true }).click();
    await expect(form).toBeHidden();
    const saved = (await api('/api/automation')).items.find(rule => rule.name === name);
    assert.equal(saved.scope, scope);
    assert.equal(saved.source_database_id, scope === 'source' ? database.id : null);
    assert.equal(saved.container_id, scope === 'container' ? space.id : null);
    return saved;
  };

  assert.equal((await api('/api/workspace')).policies['automation.scope.v1'], 'source');
  await toolbar(database.id);
  const source = await create('Source intake', 'source');
  // A populated second database rule proves source isolation instead of reading an empty list.
  const foreign = (await post('/api/automation', { name: 'Other database rule', scope: 'source', sourceDatabaseId: other.id,
    trigger: { event: 'record-created' }, conditions: [], actions: [{ type: 'comment', body: 'Other database only' }] })).value;
  const rules = [source];
  for (const scope of ['container', 'site']) {
    await switchAutomationProfile(state, scope);
    await page.goto(origin + '/app/settings/automation', { waitUntil: 'networkidle' });
    await expect(row(source.name)).toHaveCount(1);
    await expect(row('Other database rule')).toHaveCount(1);
    rules.push(await create(`${scope} intake`, scope));
  }
  for (const id of [database.id, other.id]) await post(`/api/databases/${id}/records`, { title: `Intake ${id}`, values: {} });
  await state.runScheduled();
  const inventory = await automationInventory(api);
  for (const rule of [...rules, { id: foreign.id }]) {
    const stored = inventory.find(item => item.rule.id === rule.id);
    assert.ok(stored.runs.some(run => run.state === 'success' && JSON.parse(run.records_json).length === 1), 'Every scope has real successful execution history.');
  }
  for (const scope of ['container', 'site']) {
    await switchAutomationProfile(state, scope);
    await page.goto(origin + '/app/settings/automation', { waitUntil: 'networkidle' });
    await expect(list().locator('.settings-list > li strong')).toHaveText(inventory.map(item => item.rule.name));
    const rule = rules.find(item => item.scope === scope);
    await row(rule.name).getByRole('button', { name: 'Run log', exact: true }).click();
    const log = page.getByRole('heading', { name: 'Run log', exact: true }).locator('..');
    await expect(log.locator('ol > li strong')).toHaveText(inventory.find(item => item.rule.id === rule.id).runs.map(run => run.state.replaceAll('-', ' ')));
    await page.screenshot({ path: `.artifacts/ui-convergence/automation-${scope}-log-1440.png`, fullPage: true });
  }
  await reconcileAutomationProfiles(state, inventory);
  await page.goto(origin + '/app/settings/automation', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'New automation', exact: true })).toHaveCount(0);
  await expect(list().locator('.settings-list > li')).toHaveCount(0);
  await toolbar(database.id);
  await expect(list().locator('.settings-list > li strong')).toHaveText([source.name]);
  await row(source.name).getByRole('button', { name: 'Run log', exact: true }).click();
  const log = page.getByRole('heading', { name: 'Run log', exact: true }).locator('..');
  const sourceRuns = inventory.find(item => item.rule.id === source.id).runs;
  await expect(log.locator('ol > li strong')).toHaveText(sourceRuns.map(run => run.state.replaceAll('-', ' ')));
  await expect(log).toContainText('success');
  await page.screenshot({ path: '.artifacts/ui-convergence/automation-source-log-1440.png', fullPage: true });
  for (const rule of rules) {
    const run = inventory.find(item => item.rule.id === rule.id).runs.find(item => item.state === 'success');
    const comments = await api(`/api/comments/page/${JSON.parse(run.records_json)[0]}`);
    assert.equal(comments.comments.filter(comment => JSON.stringify(comment.body).includes(`Recorded by ${rule.name}`)).length, 1);
  }
  console.log('PROBE AUTO-005 1: database toolbar -> source-only form, exact database rules and populated run log');
  console.log('PROBE AUTO-005 2: container and site rule lists -> native creation with all scopes and branch control');
  console.log('PROBE AUTO-005 3: native Settings profile round trip -> unchanged definitions, scopes and execution histories');
  console.log('PROBE AUTO-005 4: all three profiles -> exact native control inventories');
}

/** Phone screen proof shares the registered phone smoke; functional assertions run at 1440. */
export async function automationProfilePhoneProof(state) {
  const { page, origin, context } = state;
  const space = (await state.api('/api/containers')).items.find(item => item.name === 'Handbook');
  const database = (await ok(context, origin, 'POST', '/api/databases', { operationKey: randomUUID(), containerId: space.id, title: 'Phone profile intake' })).value;
  for (const scope of ['source', 'container', 'site']) {
    await switchAutomationProfile(state, scope);
    await page.goto(scope === 'source' ? `${origin}/app/databases/${database.id}` : origin + '/app/settings/automation', { waitUntil: 'networkidle' });
    if (scope === 'source') await page.getByRole('navigation', { name: 'Saved views' }).getByRole('button', { name: 'Automations', exact: true }).click();
    await page.getByRole('button', { name: 'New automation', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Create automation', exact: true });
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Phone intake');
    if (scope !== 'source') await form.getByRole('combobox', { name: 'Run across', exact: true }).selectOption(scope);
    if (scope === 'container') await form.getByRole('combobox', { name: 'Space', exact: true }).selectOption(space.id);
    await form.getByRole('button', { name: 'Add action', exact: true }).click();
    await form.getByRole('textbox', { name: 'Comment', exact: true }).fill('Review this intake.');
    await page.screenshot({ path: `.artifacts/ui-convergence/automation-${scope}-390.png`, fullPage: true });
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await switchAutomationProfile(state, 'source');
}
