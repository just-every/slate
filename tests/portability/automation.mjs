import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { automationInventory, reconcileAutomationProfiles } from '../qualification/ui-convergence/automation-profile-journey.mjs';

const get = (instance, cookie) => async route => {
  const response = await fetch(instance.origin + route, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200, route);
  return response.json();
};
const post = async (instance, cookie, route, data) => {
  const response = await fetch(instance.origin + route, { method: 'POST', headers: { Cookie: cookie, Origin: instance.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationKey: randomUUID(), ...data }) });
  assert.equal(response.status, route === '/api/automation' ? 201 : 200, `${route}: ${await response.clone().text()}`);
  return (await response.json()).value;
};

/** Archive actual native rule executions, rather than fixture-shaped history rows. */
export async function populateAutomation(instance, cookie) {
  for (const scope of ['container', 'site']) {
    await post(instance, cookie, '/api/automation', { name: `Portable ${scope} rule`, scope,
      ...(scope === 'container' ? { containerId: 'archive-container' } : {}),
      trigger: { event: 'created' }, conditions: [], actions: [{ type: 'comment', body: `Portable ${scope} receipt` }] });
  }
  const page = await post(instance, cookie, '/api/pages', { containerId: 'archive-container', title: 'Portable automation event',
    blocks: [{ id: randomUUID(), blockType: 'paragraph', treePosition: '0', content: { text: [{ text: 'A real event for both rule scopes.' }] } }] });
  await instance.scheduled();
  const api = get(instance, cookie), inventory = await automationInventory(api);
  assert.deepEqual(inventory.map(item => item.rule.scope).sort(), ['container', 'site']);
  for (const { rule, runs } of inventory) {
    assert.equal(rule.disabled_at, null);
    assert.deepEqual(runs.map(run => run.state).sort(), ['configuration-changed', 'success']);
    const run = runs.find(item => item.state === 'success');
    assert.deepEqual(JSON.parse(run.records_json), [page.pageId]);
    assert.deepEqual(run.receipts.map(receipt => ({ targetId: receipt.targetId, state: receipt.state })), [{ targetId: page.pageId, state: 'confirmed' }]);
  }
  const comments = (await api(`/api/comments/page/${page.pageId}`)).comments;
  assert.equal(comments.length, 2);
  for (const scope of ['container', 'site']) assert.equal(comments.filter(comment => JSON.stringify(comment.body).includes(`Portable ${scope} receipt`)).length, 1);
  return inventory;
}

export async function restoredAutomation(instance, cookie, original) {
  const api = get(instance, cookie), restored = await automationInventory(api);
  assert.equal(restored.length, original.length);
  for (const { rule, runs } of restored) {
    const before = original.find(item => item.rule.id === rule.id);
    assert.match(rule.disabled_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(rule.disabled_reason, 'Restored: owner must re-enable authority.');
    assert.deepEqual(rule, { ...before.rule, disabled_at: rule.disabled_at, disabled_reason: rule.disabled_reason });
    assert.deepEqual(runs, before.runs, 'Restore retains every real execution, trigger, target and action receipt.');
  }
  const browser = await chromium.launch({ headless: true, ...(process.env.SLATE_CHROMIUM_PATH ? { executablePath: process.env.SLATE_CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'slate_session', value: cookie.split('=')[1], url: instance.origin }]);
    const page = await context.newPage();
    await reconcileAutomationProfiles({ page, origin: instance.origin, api }, restored);
  } finally { await browser.close(); }
  // A fresh native event and cron cannot reactivate the restored delegation.
  const page = await post(instance, cookie, '/api/pages', { containerId: 'archive-container', title: 'After restore event', blocks: [] });
  await instance.scheduled();
  assert.deepEqual(await automationInventory(api), restored, 'Neither profile switches nor a new event re-enable restored rules.');
  assert.deepEqual((await api(`/api/comments/page/${page.pageId}`)).comments, []);
  console.log('PROBE AUTO-005 3 archive: native ZIP restore and all native Settings profiles -> exact scopes, definitions and run history; new event has no restored effects');
}
