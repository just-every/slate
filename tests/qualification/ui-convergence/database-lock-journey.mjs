import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { call, grant, ok, withSecondPerson } from './two-people-support.mjs';

/** A populated database, native structure controls and two real member sessions. */
export async function databaseStructureLockJourney(state) {
  const { origin, api, page } = state;
  await withSecondPerson(state, page.viewportSize().width, async people => {
    const { alice, bob } = people;
    const mutate = async (person, route, data, method = 'POST') =>
      (await ok(person.context, origin, method, route, { operationKey: randomUUID(), ...data })).value;
    const space = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
    const database = await mutate(alice, '/api/databases', { containerId: space.id, title: 'Locked operations' });
    const base = `/api/databases/${database.id}`;
    const read = () => api(base);
    const field = { id: randomUUID(), name: 'Progress', type: 'text', config: {}, position: 0 };
    const spare = { id: randomUUID(), name: 'Unused field', type: 'text', config: {}, position: 1 };
    for (const item of [field, spare]) {
      await mutate(alice, base + '/fields', { expectedRevisionId: (await read()).database.revision_id, field: item });
    }
    const view = {
      id: randomUUID(), name: 'Active operations', layout: 'table',
      filters: [{ field: field.id, op: 'contains', value: 'Ready' }],
      sorts: [{ field: '$title', direction: 'asc' }], groups: [], calculations: {}, display: {}, position: 0,
    };
    await mutate(alice, base + '/views', { expectedRevisionId: (await read()).database.revision_id, view });
    const record = await mutate(alice, base + '/records', { title: 'Release checklist', values: { [field.id]: 'Ready for review' } });
    await grant(alice.context, origin, database.pageId, bob.id, 'edit');
    await grant(alice.context, origin, record.pageId, bob.id, 'edit');
    const grants = await api(`/api/sharing/pages/${database.pageId}`);
    await alice.page.goto(`${origin}/app/databases/${database.id}`, { waitUntil: 'networkidle' });
    await alice.page.getByRole('button', { name: 'Fields', exact: true }).click();
    await alice.page.getByRole('menuitem', { name: 'Lock structure', exact: true }).click();
    await expect(alice.page.getByText('Structure locked by Alex Owner. Record values remain editable.', { exact: true })).toBeVisible();
    await alice.page.reload({ waitUntil: 'networkidle' });
    const locked = await read();
    assert.equal(locked.database.structure_locked_by_member_id, 'browser-owner');
    assert.equal(locked.database.structure_locked_by_name, alice.name);
    assert.ok(locked.database.structure_locked_at);

    // No route is stubbed: every forbidden write must leave the complete native projection unchanged.
    const changes = [
      ['create field', '/fields', { field: { ...spare, id: randomUUID(), name: 'New field', position: 2 } }],
      ['change field', '/fields', { field: { ...field, name: 'Changed progress' } }],
      ['delete field', '/fields', { field: spare, delete: true }],
      ['create view', '/views', { view: { ...view, id: randomUUID(), name: 'Another view', position: 1 } }],
      ['change view', '/views', { view: { ...view, name: 'Changed operations' } }],
      ['change filters', '/views', { view: { ...view, filters: [] } }],
      ['change sorts', '/views', { view: { ...view, sorts: [{ field: '$title', direction: 'desc' }] } }],
      ['change layout', '/views', { view: { ...view, layout: 'list' } }],
      ['delete view', '/views', { view, delete: true }],
    ];
    for (const [label, suffix, input] of changes) {
      const refused = await call(alice.context, origin, 'POST', base + suffix, {
        operationKey: randomUUID(), expectedRevisionId: locked.database.revision_id, ...input,
      });
      assert.equal(refused.status, 409, label);
      assert.equal(refused.body.code, 'STRUCTURE_LOCKED', label);
      assert.deepEqual(await read(), locked, `${label} changes no structure or revision`);
    }

    for (const person of [alice, bob]) {
      await person.page.goto(`${origin}/app/databases/${database.id}`, { waitUntil: 'networkidle' });
      await expect(person.page.getByText('Structure locked by Alex Owner. Record values remain editable.', { exact: true })).toBeVisible();
      await person.page.getByRole('button', { name: 'Fields', exact: true }).click();
      await expect(person.page.getByRole('menuitem', { name: 'Add field', exact: true })).toBeDisabled();
      await expect(person.page.getByRole('menuitem', { name: field.name, exact: true })).toHaveCount(0);
      await expect(person.page.getByRole('menuitem', { name: spare.name, exact: true })).toHaveCount(0);
      await expect(person.page.getByRole('menuitem', { name: 'Unlock structure', exact: true })).toHaveCount(person === alice ? 1 : 0);
      await person.page.keyboard.press('Escape');
      await person.page.getByRole('button', { name: 'View options', exact: true }).click();
      for (const name of ['View settings', 'Add view', 'Duplicate view', 'Delete view']) {
        await expect(person.page.getByRole('menuitem', { name, exact: true })).toBeDisabled();
      }
      await person.page.keyboard.press('Escape');
      await expect(person.page.getByRole('dialog', { name: 'View settings', exact: true })).toHaveCount(0);
      await expect(person.page.getByRole('button', { name: 'Clear view filters', exact: true })).toHaveCount(0);
      const criteria = person.page.getByRole('region', { name: 'Applied view criteria', exact: true });
      await expect(criteria).toContainText('Progress contains Ready');
      await expect(criteria).toContainText('Name ascending');
    }
    const refusedUnlock = await call(bob.context, origin, 'POST', base + '/lock', {
      operationKey: randomUUID(), expectedRevisionId: locked.database.revision_id, locked: false,
    });
    assert.equal(refusedUnlock.status, 404);
    assert.deepEqual(await read(), locked, 'An edit-only member cannot unlock or change structure.');

    const cell = bob.page.getByRole('row').filter({ has: bob.page.getByRole('button', { name: 'Release checklist', exact: true }) })
      .getByRole('textbox', { name: 'Progress', exact: true });
    await expect(cell).toBeEditable();
    await cell.fill('Ready to ship while locked');
    await expect.poll(async () => (await api(base + '/records/' + record.pageId)).values[field.id]).toBe('Ready to ship while locked');
    await bob.page.reload({ waitUntil: 'networkidle' });
    await expect(cell).toHaveValue('Ready to ship while locked');
    assert.deepEqual(await read(), locked, 'A successful record edit changes no structure.');
    assert.deepEqual(await api(`/api/sharing/pages/${database.pageId}`), grants, 'Locking and record editing change no access grant.');
    await accessible(bob.page, 'database structure locked with editable record');
    await people.shot('bob', 'database-structure-locked');

    await grant(alice.context, origin, database.pageId, bob.id, 'full');
    const fullAccessGrants = await api(`/api/sharing/pages/${database.pageId}`);
    await bob.page.reload({ waitUntil: 'networkidle' });
    await bob.page.getByRole('button', { name: 'Fields', exact: true }).click();
    await bob.page.getByRole('menuitem', { name: 'Unlock structure', exact: true }).click();
    await expect(bob.page.getByText(/Structure locked by/)).toHaveCount(0);
    await bob.page.reload({ waitUntil: 'networkidle' });
    const unlocked = await read();
    assert.equal(unlocked.database.structure_locked_at, null);
    assert.equal(unlocked.database.structure_locked_by_member_id, null);
    assert.deepEqual(unlocked.fields, locked.fields);
    assert.deepEqual(unlocked.views, locked.views);
    assert.deepEqual(await api(`/api/sharing/pages/${database.pageId}`), fullAccessGrants, 'Another member unlocking changes no access grant.');
    await bob.page.getByRole('button', { name: 'Fields', exact: true }).click();
    await expect(bob.page.getByRole('menuitem', { name: 'Add field', exact: true })).toBeEnabled();
    await expect(bob.page.getByRole('menuitem', { name: field.name, exact: true })).toBeEnabled();
    await bob.page.keyboard.press('Escape');
    await bob.page.getByRole('button', { name: 'View options', exact: true }).click();
    for (const name of ['View settings', 'Add view', 'Duplicate view', 'Delete view']) {
      await expect(bob.page.getByRole('menuitem', { name, exact: true })).toBeEnabled();
    }
    await bob.page.keyboard.press('Escape');
    await expect(bob.page.getByRole('button', { name: 'Clear view filters', exact: true })).toBeEnabled();
    // The same payloads are valid after unlock; refusals above cannot pass merely because the inputs are invalid.
    for (const [, suffix, input] of changes) {
      await mutate(bob, base + suffix, { expectedRevisionId: (await read()).database.revision_id, ...input });
    }
    assert.equal((await api(base + '/records/' + record.pageId)).values[field.id], 'Ready to ship while locked');
  });
}
