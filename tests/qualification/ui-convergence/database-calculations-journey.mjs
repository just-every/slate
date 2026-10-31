import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { call, grant, ok, withSecondPerson } from './two-people-support.mjs';

/** Native filtered records, saved footer choices and two independently authorized sessions. */
export async function databaseCalculationsJourney(state, { smoke = false } = {}) {
  const { page, context, origin, api } = state;
  const mutate = (route, data, method = 'POST') => ok(context, origin, method, route, { operationKey: randomUUID(), ...data });
  const container = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  const database = (await mutate('/api/databases', { containerId: container.id, title: 'Calculation ledger' })).value;
  const base = `/api/databases/${database.id}`;
  const amount = { id: randomUUID(), name: 'Amount', type: 'number', config: {}, position: 0 };
  const note = { id: randomUUID(), name: 'Note', type: 'text', config: {}, position: 1 };
  const included = { id: randomUUID(), name: 'Included', type: 'checkbox', config: {}, position: 2 };
  let revision = database.revisionId;
  for (const field of [amount, note, included]) revision = (await mutate(base + '/fields', { expectedRevisionId: revision, field })).value.revisionId;
  const view = { id: randomUUID(), name: 'Included records', layout: 'table', filters: [{ field: included.id, op: 'eq', value: true }], sorts: [], groups: [], calculations: {}, display: { visibleFieldIds: [amount.id, note.id] }, position: 0 };
  await mutate(base + '/views', { expectedRevisionId: revision, view });
  const records = [];
  for (const [title, value, text, selected] of [
    ['Zero', 0, 'Zero note', true], ['Six', 6, 'Six note', true], ['Empty', null, null, true],
    ['Negative', -2, 'Negative note', true], ['Private', 8, 'Private note', true],
    ['Filtered out', 900, 'Excluded note', false],
  ]) records.push((await mutate(base + '/records', { title, values: { [amount.id]: value, [note.id]: text, [included.id]: selected } })).value);
  const readerGrant = { targetKind: 'page', targetId: database.pageId, principalKind: 'member', principalId: 'browser-reader', level: 'edit' };
  const grantInput = { operationKey: randomUUID(), ...readerGrant };
  const granted = await ok(context, origin, 'POST', '/api/sharing', grantInput);
  await grant(context, origin, records[4].pageId, 'browser-owner', 'full');
  const hidden = await api(`/api/pages/${records[4].pageId}`);
  await mutate(`/api/sharing/pages/${records[4].pageId}/inheritance`, { expectedRevisionId: hidden.page.revisionId, restricted: true }, 'PUT');
  const route = `${origin}/app/databases/${database.id}`;
  const queryPath = base + '/views/' + view.id;
  const footer = (screen, field = amount) => screen.locator('tfoot').getByRole('button').filter({ hasText: /./ }).and(screen.getByRole('button', { name: new RegExp(`(?:for ${field.name}:|total for ${field.name}$)`) }));
  async function choose(field, kind, label) {
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === base + '/views' && response.request().method() === 'POST');
    await footer(page, field).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    assert.ok((await saved).ok());
    await expect(footer(page, field)).toHaveAccessibleName(new RegExp(`^${label} for ${field.name}:`));
    assert.equal((await api(base)).views.find(item => item.id === view.id).calculations[field.id], kind);
  }
  await page.goto(route, { waitUntil: 'networkidle' });
  await withSecondPerson(state, page.viewportSize().width, async people => {
    const reader = people.bob;
    // Expectations are hand-calculated from this corpus, never from the aggregate implementation.
    const cases = [
      ['count', 'Count', 5, 4], ['filled', 'Filled', 4, 3], ['empty', 'Empty', 1, 1],
      ['sum', 'Sum', 12, 4], ['average', 'Average', 3, 4 / 3], ['minimum', 'Minimum', -2, -2],
      ['maximum', 'Maximum', 8, 6], ['range', 'Range', 10, 8], ['percent', 'Percent', 80, 75],
    ];
    for (const [kind, label, ownerValue, readerValue] of smoke ? [cases[3]] : cases) {
      await choose(amount, kind, label);
      await expect(footer(page)).toHaveAccessibleName(`${label} for Amount: ${ownerValue}`);
      await reader.page.goto(route, { waitUntil: 'networkidle' });
      await expect(footer(reader.page)).toHaveAccessibleName(`${label} for Amount: ${readerValue}`);
      for (const [person, expected, ids] of [[people.alice, ownerValue, records.slice(0, 5)], [reader, readerValue, records.slice(0, 4)]]) {
        const query = await ok(person.context, origin, 'GET', queryPath);
        assert.deepEqual(query.records.map(item => item.pageId).sort(), ids.map(item => item.pageId).sort());
        assert.equal(query.calculations[amount.id], expected);
        assert.deepEqual(query.view.filters, view.filters);
      }
    }
    await choose(note, 'percent', 'Percent');
    await choose(amount, 'sum', 'Sum');
    for (const person of [people.alice, reader]) {
      await person.page.reload({ waitUntil: 'networkidle' });
      await expect(footer(person.page)).toHaveAccessibleName(`Sum for Amount: ${person === reader ? 4 : 12}`);
      await expect(footer(person.page, note)).toHaveAccessibleName(`Percent for Note: ${person === reader ? 75 : 80}`);
    }
    if (!smoke) {
      async function edit(person, title, next, ownerTotal, readerTotal) {
        for (const [screen, total] of [[page, ownerTotal], [reader.page, readerTotal]]) await screen.evaluate(expected => {
          window.slateCalculation?.observer.disconnect();
          const observe = () => {
            if (document.querySelector(`tfoot button[aria-label="${expected}"]`) && !window.slateCalculation.observedAt) window.slateCalculation.observedAt = Date.now();
          };
          const observer = new MutationObserver(observe);
          window.slateCalculation = { observer, observedAt: null };
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
        }, `Sum for Amount: ${total}`);
        const dispatchedAt = Date.now();
        const response = person.page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname.startsWith(base + '/records/'));
        await person.page.getByRole('row').filter({ has: person.page.getByRole('button', { name: title, exact: true }) }).getByRole('spinbutton', { name: 'Amount', exact: true }).fill(String(next));
        const committed = await response;
        assert.ok(committed.ok(), await committed.text());
        const { receipt, value } = await committed.json();
        const receivedAt = Date.now(), committedAt = Date.parse(receipt.committedAt);
        assert.ok(Number.isFinite(committedAt) && committedAt >= dispatchedAt && committedAt <= receivedAt);
        for (const [name, screen, total] of [['owner', page, ownerTotal], ['reader', reader.page, readerTotal]]) {
          await screen.waitForFunction(() => window.slateCalculation.observedAt !== null, null, { timeout: 2000 });
          const observedAt = await screen.evaluate(() => window.slateCalculation.observedAt);
          assert.ok(observedAt >= committedAt && observedAt - committedAt <= 2000, `${name} footer updated ${observedAt - committedAt}ms after commit`);
          await expect(footer(screen)).toHaveAccessibleName(`Sum for Amount: ${total}`);
          people.record(`${title}-${name}`, { committedAt: receipt.committedAt, observedAt, elapsedMs: observedAt - committedAt, revisionId: receipt.revisionId });
          const query = await ok(screen.context(), origin, 'GET', queryPath);
          assert.equal(query.calculations[amount.id], total);
          assert.equal(query.records.find(item => item.pageId === receipt.entity.id).revisionId, value.revisionId);
          assert.equal(query.records.find(item => item.pageId === receipt.entity.id).values[amount.id], next);
        }
        const activity = (await api('/api/activity?action=databases.record.update&limit=100')).items.find(item => item.id === receipt.activityId);
        assert.equal(activity.operationKey, receipt.operationKey);
        assert.equal(activity.occurredAt, receipt.committedAt);
      }
      await edit(people.alice, 'Zero', 2, 14, 6);
      await edit(reader, 'Six', 10, 18, 10);
      // A repeated capture retains the revoked grant; the open query must drop its data.
      await mutate('/api/sharing', { ...readerGrant, id: granted.value.id, revoke: true });
      await ok(context, origin, 'POST', '/api/sharing', grantInput);
      assert.equal((await call(reader.context, origin, 'GET', queryPath)).status, 404);
      await expect(reader.page.locator('tfoot')).toHaveCount(0, { timeout: 2000 });
    }
    await accessible(page, 'database calculations');
    people.record('calculations', smoke ? 'phone footer and persisted selections' : 'nine operations; filtered owner and reader; local and second-session commits; revocation');
  });
}
