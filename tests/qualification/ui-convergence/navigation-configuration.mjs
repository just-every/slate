import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function configureNavigation({ page, origin, api }) {
  const original = await api('/api/navigation/configuration');
  await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Configure navigation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace navigation', exact: true });
  const field = id => dialog.locator('fieldset').filter({ has: page.locator('legend', { hasText: new RegExp(`^${id}$`) }) });
  await field('search').getByRole('textbox', { name: 'Destination label', exact: true }).fill('Find knowledge');
  await field('search').getByRole('button', { name: 'Move up', exact: true }).click();
  await field('archive').getByRole('checkbox', { name: 'Visible', exact: true }).uncheck();
  const destinations = structuredClone(original.destinations);
  const search = destinations.findIndex(item => item.id === 'search');
  destinations[search].label = 'Find knowledge';
  [destinations[search - 1], destinations[search]] = [destinations[search], destinations[search - 1]];
  destinations.find(item => item.id === 'archive').visible = false;
  await dialog.getByRole('button', { name: 'Save navigation', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual((await api('/api/navigation/configuration')).destinations, destinations);
  return { original, destinations };
}

/** Exercise every native option, checking only this clause's navigation duty. */
export async function navigationPolicies(state, reconcile) {
  const { page, origin, api } = state;
  const before = await api('/api/workspace');
  const open = async () => {
    await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Edit workspace & policies', exact: true }).click();
    return page.getByRole('dialog', { name: 'Workspace settings', exact: true });
  };
  let dialog = await open();
  const policies = await dialog.locator('select[name$=".v1"]').evaluateAll(selects => selects.map(select => ({ id: select.name, values: [...select.options].map(option => option.value) })));
  assert.deepEqual(policies.map(policy => policy.id).sort(), Object.keys(before.policies).sort(), 'Every configured knowledge policy has its native control exercised.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const save = async (id, value) => {
    dialog = await open();
    await dialog.locator(`select[name="${id}"]`).selectOption(value);
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload({ waitUntil: 'networkidle' });
  };
  for (const { id, values } of policies) {
    for (const value of values) {
      await save(id, value);
      assert.deepEqual((await api('/api/workspace')).policies, { ...before.policies, [id]: value });
      await reconcile();
      console.log(`PROBE NAV-004 policy ${id}=${value}: native Settings save and reload -> ordered sidebar unchanged`);
    }
    if (values.at(-1) !== before.policies[id]) await save(id, before.policies[id]);
  }
  assert.deepEqual((await api('/api/workspace')).policies, before.policies);
}
