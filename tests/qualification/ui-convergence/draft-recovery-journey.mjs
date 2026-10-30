import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { blockText, editable, grant, ok, restrictedPage, savedAfterCommit, typeAtEnd } from './two-people-support.mjs';

/** Inspect the actual readable archive, including its committed content. */
export async function readablePage(context, origin, pageId, format = 'html') {
  const response = await context.request.post(`${origin}/api/exports/readable`, {
    headers: { origin }, data: { scope: 'page', id: pageId, format },
  });
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['content-type'], 'application/zip');
  const entries = unzipSync(await response.body());
  const manifest = JSON.parse(strFromU8(entries['slate-readable.json']));
  const page = manifest.pages.find(item => item.id === pageId);
  assert.ok(page, 'The decoded manifest contains the exported page.');
  const rendered = strFromU8(entries[`pages/${pageId}.${format === 'html' ? 'html' : 'md'}`]);
  assert.ok(rendered.includes(page.title), 'Rendered content carries the committed title.');
  return { manifest, page, rendered };
}

/** SAVE-004: real typing, persisted storage, same-tab reload and explicit retry. */
export async function draftRecoveryJourney(state, people) {
  const { alice, bob, shot, record } = people, { origin } = state;
  const marker = `synthetic-slate-${randomBytes(4).toString('hex')}`;
  const committedTitle = `Recovery handover ${marker}`;
  const committedBody = 'The next shift owns the recovery.';
  const { pageId, spaceId, blockIds: [blockId] } = await restrictedPage({ context: alice.context, origin }, committedTitle, [committedBody]);
  await grant(alice.context, origin, pageId, bob.id, 'edit');
  const route = `${origin}/app/pages/${pageId}`;
  await Promise.all([alice, bob].map(person => person.page.goto(route, { waitUntil: 'networkidle' })));
  const baseline = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
  let unsentTitle = `${committedTitle} unsent-title`;
  const unsentBody = ` Unsent-body ${marker}.`;
  const title = alice.page.getByRole('textbox', { name: 'Page title', exact: true });
  const bodyStatus = alice.page.locator(`[data-block-id="${blockId}"] [role="status"]`);
  const storage = () => alice.page.evaluate(id => ({
    title: Object.entries(localStorage).find(([key]) => key.startsWith('slate:unsaved-title:') && key.endsWith(`:${id}`))?.map(value => value),
    body: Object.entries(sessionStorage).find(([key]) => key.startsWith('slate:draft:') && key.endsWith(`:${id}`))?.map(value => value),
  }), pageId);
  await alice.page.route('**/api/**', request => request.abort('connectionrefused'));
  try {
    await title.click();
    await title.press('ControlOrMeta+End');
    await alice.page.keyboard.type(' unsent-title');
    await title.press('Tab');
    await expect(alice.page.getByRole('status').filter({ hasText: /^Not saved/ })).toBeVisible();
    await typeAtEnd(alice.page, blockId, unsentBody);
    await expect(bodyStatus).toContainText('Offline');
    await expect(bodyStatus).toContainText('unsaved');
    await expect(title).toHaveValue(unsentTitle);
    await expect(editable(alice.page, blockId)).toHaveText(committedBody + unsentBody);
    const stored = await storage();
    assert.equal(JSON.parse(stored.title[1]).title, unsentTitle);
    const journal = JSON.parse(stored.body[1]);
    assert.equal(journal.version, 1);
    assert.equal(journal.edits[0][0], blockId);
    assert.ok(JSON.stringify(journal.blocks).includes(unsentBody.trim()));
    assert.ok(JSON.stringify(journal.edits).includes(unsentBody.trim()));
    await shot('alice', 'offline title and body recovery stored');
  } finally { await alice.page.unroute('**/api/**'); }

  const noWorkspaceDraft = async () => {
    const document = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
    assert.equal(document.page.title, committedTitle);
    assert.equal(document.page.revisionId, baseline.page.revisionId, 'No recovered text has committed.');
    assert.deepEqual(document.blocks, baseline.blocks);
    for (const door of ['/api/pages', `/api/pages?containerId=${spaceId}`]) {
      const listed = await ok(alice.context, origin, 'GET', door);
      assert.equal(listed.items.find(item => item.id === pageId).title, committedTitle, door);
      assert.ok(!JSON.stringify(listed).includes('unsent-title'), 'Tree and lists use the committed title.');
    }
    const openNavigation = alice.page.getByRole('button', { name: 'Open navigation', exact: true });
    const closedNavigation = await openNavigation.isVisible();
    if (closedNavigation) await openNavigation.click();
    await expect(alice.page.getByRole('navigation', { name: 'Pages', exact: true }).locator(`a[href="/app/pages/${pageId}"]`)).toHaveText(committedTitle);
    if (closedNavigation) await alice.page.locator('button[aria-label="Close navigation"][aria-expanded="true"]').click();
    for (const query of ['unsent-title', `Unsent-body ${marker}`]) {
      const found = await ok(alice.context, origin, 'GET', `/api/search?q=${encodeURIComponent(query)}`);
      assert.ok(!JSON.stringify(found).includes(pageId), 'Unsent text is not indexed.');
    }
    const exported = await readablePage(alice.context, origin, pageId);
    assert.equal(exported.page.title, committedTitle);
    assert.ok(JSON.stringify(exported.page.blocks).includes(committedBody));
    assert.ok(exported.rendered.includes(committedBody));
    for (const output of [JSON.stringify(exported.manifest), exported.rendered])
      assert.ok(!output.includes('unsent-title') && !output.includes(unsentBody.trim()), 'Neither manifest nor rendered export exposes recovery text.');
    await bob.page.reload({ waitUntil: 'networkidle' });
    await expect(bob.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(committedTitle);
    await expect(editable(bob.page, blockId)).toHaveText(committedBody);
  };
  await expect(bodyStatus).toContainText('Unsaved changes', { timeout: 10000 });
  await noWorkspaceDraft();
  const pending = await storage();
  alice.page.once('dialog', dialog => dialog.accept());
  await alice.page.reload({ waitUntil: 'networkidle' });
  await expect(title).toHaveValue(unsentTitle);
  await expect(editable(alice.page, blockId)).toHaveText(committedBody + unsentBody);
  const recoveredTitle = alice.page.getByRole('status').filter({ hasText: /^Unsaved — a draft was recovered/ });
  await expect(recoveredTitle).toBeVisible();
  await expect(bodyStatus).toContainText('unsaved edit was recovered');
  await expect(alice.page.locator('.editor-save-status').filter({ hasText: /^Saved$/ })).toHaveCount(0);
  assert.deepEqual(await storage(), pending, 'Reload reads the real recovery journals without replacing them.');
  // Merely focusing and leaving a recovered title is not consent to commit it.
  await title.focus();
  await title.press('Tab');
  await alice.page.waitForTimeout(1200);
  await noWorkspaceDraft();
  // Correcting recovered text, including Enter, still waits for explicit retry.
  await title.focus();
  await title.press('ControlOrMeta+End');
  await alice.page.keyboard.type(' revised');
  unsentTitle += ' revised';
  await title.press('Enter');
  await alice.page.waitForTimeout(1200);
  await expect(recoveredTitle).toBeVisible();
  assert.equal(JSON.parse((await storage()).title[1]).title, unsentTitle);
  await noWorkspaceDraft();
  await shot('alice', 'recovered title and body explicitly unsaved');
  await accessible(alice.page, 'recovered title and body explicitly unsaved');

  const titleReceipt = alice.page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${pageId}`);
  await recoveredTitle.getByRole('button', { name: 'Try saving again', exact: true }).click();
  assert.equal((await titleReceipt).status(), 200);
  await expect(recoveredTitle).toHaveCount(0);
  const retry = await savedAfterCommit(alice.page, blockId, () => bodyStatus.getByRole('button', { name: 'Try saving again', exact: true }).click());
  const committed = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
  assert.equal(committed.page.title, unsentTitle);
  assert.ok(JSON.stringify(committed.blocks).includes(unsentBody.trim()));
  assert.deepEqual(await storage(), { title: undefined, body: undefined }, 'Confirmed retry clears recovery storage.');
  await Promise.all([alice, bob].map(person => person.page.reload({ waitUntil: 'networkidle' })));
  for (const person of [alice, bob]) {
    await expect(person.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(unsentTitle);
    await expect(editable(person.page, blockId)).toHaveText(committedBody + unsentBody);
  }
  assert.equal((await ok(alice.context, origin, 'GET', `/api/pages?containerId=${spaceId}`)).items.find(item => item.id === pageId).title, unsentTitle);
  assert.ok(JSON.stringify(await ok(alice.context, origin, 'GET', `/api/search?q=${encodeURIComponent(unsentBody.trim())}`)).includes(pageId), 'Explicit retry makes the recovered body searchable.');
  const exported = await readablePage(alice.context, origin, pageId);
  assert.equal(exported.page.title, unsentTitle);
  assert.ok(JSON.stringify(exported.page.blocks).includes(unsentBody.trim()));
  assert.ok(exported.rendered.includes(unsentBody.trim()));
  await shot('alice', 'explicit retry committed after recovery');
  record('draftRecovery', { browserStorageReadBack: true, sameTabReload: true, explicitRetry: true, absentBeforeRetry: ['canonical page', 'tree', 'list', 'search', 'decoded export', 'other reader'], retrySavedAfterCommitMs: retry.savedAfterCommitMs });
}
