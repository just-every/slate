import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { blockText, call, caretAtEnd, editable, elapsedUntil, grant, ok, restrictedPage, savedAfterCommit, typeAtEnd } from './two-people-support.mjs';

const text = async (page, blockId) => (await blockText(page, blockId).innerText()).replace(/\s+/g, ' ');
const savedBlock = async (context, origin, pageId, blockId) => JSON.stringify((await ok(context, origin, 'GET', `/api/pages/${pageId}`)).blocks.find(block => block.id === blockId).content);

/** Types one key at a time, never pausing long enough to autosave, until told to stop. */
function keepTyping(page, blockId, words) {
  let stopped = false;
  const typed = [];
  const done = (async () => {
    await caretAtEnd(page, blockId);
    for (const key of words.repeat(4)) {
      if (stopped) break;
      await page.keyboard.type(key);
      typed.push(key);
      await page.waitForTimeout(200);
    }
  })();
  // A journey that fails elsewhere closes the page under this loop; report it only when asked to stop.
  let failure;
  done.catch(cause => { failure = cause; });
  return { typed: () => typed.join(''), async stop() { stopped = true; await done.catch(() => {}); if (failure) throw failure; } };
}

/**
 * Lets a person's collaboration refreshes for one page wait while held, so their
 * copies of other people's blocks stay as they were. Routed once, before any of
 * the journey's pages open: adding or removing a route while requests are in
 * flight can strand one of them in the browser.
 */
async function refreshGate(page) {
  let held = null, gate = Promise.resolve();
  await page.route(url => url.pathname === held, async route => { await gate; await route.continue().catch(() => {}); });
  return {
    hold(pageId) {
      let release;
      held = `/api/collaboration/${pageId}`;
      gate = new Promise(resolve => { release = resolve; });
      return () => { held = null; release(); };
    },
  };
}

/** SAVE-001, SAVE-003, SAVE-004 and SAVE-006 with two signed-in people on one page. */
export async function concurrentEditingJourney(state, people) {
  const { alice, bob, record, shot } = people, { origin } = state;
  const tag = randomBytes(4).toString('hex');
  const refreshes = await refreshGate(alice.page);
  const page = await restrictedPage({ context: alice.context, origin }, `Shift handover ${tag}`, ['Alpha line.', 'Beta line.', 'Gamma line.']);
  const { pageId, blockIds: [first, second, third] } = page;
  await grant(alice.context, origin, pageId, bob.id, 'edit');
  const opened = Date.now();
  await Promise.all([alice, bob].map(person => person.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' })));
  // The page shows who has it open, to each of them.
  for (const person of [alice, bob]) {
    const presence = person.page.locator('.page-document p.muted').filter({ hasText: 'Here now:' });
    await expect(presence).toContainText(alice.name, { timeout: 15000 });
    await expect(presence).toContainText(bob.name);
  }
  record('presenceBothShownMs', Date.now() - opened);
  // Opening at the same moment as someone else raises no error on either page.
  for (const person of [alice, bob]) await expect(person.page.locator('.page-document [role="alert"]')).toHaveCount(0);
  await shot('alice', 'both open with presence');
  await shot('bob', 'both open with presence');

  // (a) Different blocks. Bob keeps typing in the third block while Alice saves the first.
  const bobWriting = keepTyping(bob.page, third, ' Bob is still writing');
  await bob.page.waitForTimeout(600);
  const aliceSave = await savedAfterCommit(alice.page, first, async () => {
    await editable(alice.page, first).click();
    await alice.page.keyboard.press('End');
    await alice.page.keyboard.type(' Alice confirmed the rota.');
  });
  const aliceCommitted = Date.now();
  const toBob = await elapsedUntil(async () => (await text(bob.page, first)).includes('Alice confirmed the rota.'), { timeout: 10000, since: aliceCommitted });
  const bobDraft = bobWriting.typed();
  assert.ok(bobDraft.length > 0 && (await text(bob.page, third)).includes(bobDraft.trim()), "Bob's unsaved third block is not replaced by Alice's committed block.");
  assert.equal(await savedBlock(alice.context, origin, pageId, third), JSON.stringify({ text: [{ text: 'Gamma line.' }] }), "Bob's text is still unsaved while Alice's block refreshes.");
  await shot('bob', 'alice block refreshed while bob types');
  // Now Alice keeps typing in the second block while Bob's third block commits.
  const aliceWriting = keepTyping(alice.page, second, ' Alice is drafting');
  await alice.page.waitForTimeout(600);
  const bobSave = await savedAfterCommit(bob.page, third, () => bobWriting.stop());
  const bobCommitted = Date.now();
  const toAlice = await elapsedUntil(async () => (await text(alice.page, third)).includes('Bob is still'), { timeout: 10000, since: bobCommitted });
  const aliceDraft = aliceWriting.typed();
  assert.ok(aliceDraft.length > 0 && (await text(alice.page, second)).includes(aliceDraft.trim()), "Alice's unsaved second block is not replaced by Bob's committed block.");
  await shot('alice', 'bob block refreshed while alice types');
  const aliceSecond = await savedAfterCommit(alice.page, second, () => aliceWriting.stop());
  await expect.poll(async () => (await text(bob.page, second)).includes('Alice is'), { timeout: 10000 }).toBe(true);
  record('differentBlocks', {
    aliceSavedAfterCommitMs: aliceSave.savedAfterCommitMs, bobSavedAfterCommitMs: bobSave.savedAfterCommitMs, aliceSecondSavedAfterCommitMs: aliceSecond.savedAfterCommitMs,
    aliceBlockShownToBobMs: toBob, bobBlockShownToAliceMs: toAlice,
  });
  await accessible(alice.page, 'two people different blocks');

  // (b) Same block. Alice drafts in the second block from its old revision while Bob saves it.
  const conflict = async (bobWords, aliceWords) => {
    const drafting = keepTyping(alice.page, second, aliceWords);
    await alice.page.waitForTimeout(600);
    const bobCommit = await savedAfterCommit(bob.page, second, async () => {
      await editable(bob.page, second).click();
      await bob.page.keyboard.press('End');
      await bob.page.keyboard.type(bobWords);
    });
    await alice.page.waitForTimeout(3500);
    const refused = alice.page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/blocks/${second}`));
    await drafting.stop();
    assert.equal((await refused).status(), 409, 'An edit against a superseded block revision is rejected with 409.');
    const badge = alice.page.locator(`[data-block-id="${second}"] [role="alert"]`);
    await expect(badge).toContainText('Your draft is kept and nothing was merged.');
    assert.ok((await text(alice.page, second)).includes(drafting.typed().trim()), "Alice's draft stays in the editor after the 409.");
    assert.ok((await savedBlock(alice.context, origin, pageId, second)).includes(bobWords.trim()), "The server keeps Bob's committed text; nothing was overwritten.");
    return { badge, bobCommit, aliceDraft: drafting.typed().trim() };
  };
  const firstConflict = await conflict(' Bob rewrote this.', ' Alice disagrees');
  await shot('alice', 'same block conflict');
  await accessible(alice.page, 'same block conflict');
  await firstConflict.badge.getByRole('button', { name: 'Compare', exact: true }).click();
  const compareDialog = alice.page.getByRole('dialog', { name: 'Resolve this block’s changes' });
  await expect(compareDialog.getByRole('heading', { name: 'Your unsaved text' })).toBeVisible();
  await expect(compareDialog).toContainText(firstConflict.aliceDraft);
  await expect(compareDialog).toContainText('Bob rewrote this.');
  await shot('alice', 'compare dialog');
  await compareDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await firstConflict.badge.getByRole('button', { name: 'Reload theirs', exact: true }).click();
  await expect(blockText(alice.page, second)).toContainText('Bob rewrote this.');
  await expect(blockText(alice.page, second)).not.toContainText(firstConflict.aliceDraft);
  await expect(alice.page.locator(`[data-block-id="${second}"] [role="alert"]`)).toHaveCount(0);
  await shot('alice', 'reloaded theirs');
  const secondConflict = await conflict(' Bob again.', ' Alice keeps hers');
  const overwrite = alice.page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/blocks/${second}`));
  await secondConflict.badge.getByRole('button', { name: 'Overwrite with mine', exact: true }).click();
  const overwritten = await overwrite;
  assert.equal(overwritten.status(), 200, 'An explicit overwrite is saved as a new revision.');
  const overwriteRevision = (await overwritten.json()).value.revisionId;
  await expect(alice.page.locator('.editor-save-status').filter({ hasText: /^Saved$/ })).toBeVisible();
  assert.ok((await savedBlock(alice.context, origin, pageId, second)).includes(secondConflict.aliceDraft), 'The overwrite holds Alice\'s text.');
  // No last write wins: Bob's text stays in the revision his save committed.
  const bobRevision = await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}/${secondConflict.bobCommit.revisionId}`);
  assert.ok(JSON.stringify(bobRevision.blocks).includes('Bob again.'), "The first writer's text stays in history.");
  assert.notEqual(overwriteRevision, secondConflict.bobCommit.revisionId);
  await shot('alice', 'overwrite saved');
  record('sameBlock', { conflictStatus: 409, compareShown: true, reloadKeptServerText: true, overwriteRevision, firstWriterRevision: secondConflict.bobCommit.revisionId });

  // (c) Title against a superseded page revision. Bob's tab has refreshed to Alice's overwrite first.
  await expect.poll(async () => (await text(bob.page, second)).includes(secondConflict.aliceDraft), { timeout: 10000 }).toBe(true);
  const title = alice.page.getByRole('textbox', { name: 'Page title', exact: true });
  let bobTitleRevision;
  const titleConflict = async (bobTitle, aliceSuffix) => {
    await title.click();
    await alice.page.keyboard.press('End');
    await alice.page.keyboard.type(aliceSuffix);
    const bobTitleBox = bob.page.getByRole('textbox', { name: 'Page title', exact: true });
    const bobSave = await savedAfterCommit(bob.page, undefined, async () => {
      await bobTitleBox.fill(bobTitle);
      await bobTitleBox.blur();
    });
    bobTitleRevision = bobSave.revisionId;
    const refused = alice.page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${pageId}`);
    await title.blur();
    assert.equal((await refused).status(), 409, 'A title saved against a superseded page revision is rejected with 409.');
    const alert = alice.page.locator('.page-document [role="alert"]').filter({ hasText: /Compare saved title/ });
    await expect(alert.getByRole('button', { name: 'Keep my title', exact: true })).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Reload saved title', exact: true })).toBeVisible();
    await expect(title).toHaveValue(new RegExp(`${aliceSuffix.trim()}$`));
    assert.equal((await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`)).page.title, bobTitle);
    return alert;
  };
  let alert = await titleConflict(`Shift handover ${tag} (Bob)`, ' — Alice');
  await alert.getByRole('button', { name: 'Compare saved title', exact: true }).click();
  await expect(alice.page.locator('.page-document [role="alert"]').filter({ hasText: `Saved title: Shift handover ${tag} (Bob). Your unsaved title: ` })).toBeVisible();
  await shot('alice', 'title conflict compare');
  await alice.page.locator('.page-document [role="alert"]').getByRole('button', { name: 'Reload saved title', exact: true }).click();
  await expect(title).toHaveValue(`Shift handover ${tag} (Bob)`);
  alert = await titleConflict(`Shift handover ${tag} (Bob again)`, ' — Alice keeps');
  const kept = alice.page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${pageId}`);
  // Keeping her title writes Alice's local title over Bob's; his stays in history.
  await alert.getByRole('button', { name: 'Keep my title', exact: true }).click();
  assert.equal((await kept).status(), 200);
  await expect.poll(async () => (await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`)).page.title).toBe(`Shift handover ${tag} (Bob) — Alice keeps`);
  await expect(bob.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(`Shift handover ${tag} (Bob) — Alice keeps`, { timeout: 10000 });
  const bobTitleSnapshot = await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}/${bobTitleRevision}`);
  assert.equal(bobTitleSnapshot.properties?.title ?? bobTitleSnapshot.title, `Shift handover ${tag} (Bob again)`, "Bob's title stays in history.");
  await shot('alice', 'title kept');
  record('title', { conflictStatus: 409, compare: true, reload: true, overwrite: true });

  // (d) The server is unreachable from Alice's browser while the network itself stays up.
  const marker = `offline${tag}`;
  await alice.page.route('**/api/**', route => route.abort('connectionrefused'));
  await editable(alice.page, first).click();
  await alice.page.keyboard.press('End');
  await alice.page.keyboard.type(` Unsent ${marker}.`);
  const offline = alice.page.locator(`[data-block-id="${first}"] [role="status"]`).filter({ hasText: /^Offline/ });
  await expect(offline).toBeVisible({ timeout: 10000 });
  await expect(blockText(alice.page, first)).toContainText(marker);
  await shot('alice', 'server unreachable keeps draft');
  const nowhere = async () => {
    assert.ok(!(await savedBlock(alice.context, origin, pageId, first)).includes(marker), 'The draft is not on the page.');
    assert.ok(!JSON.stringify(await ok(alice.context, origin, 'GET', '/api/pages')).includes(marker), 'The draft is in no tree or list.');
    assert.ok(!JSON.stringify(await ok(alice.context, origin, 'GET', `/api/search?q=${marker}`)).includes(pageId), 'The draft is in no search result.');
    const exported = await alice.context.request.post(`${origin}/api/exports/readable`, { headers: { origin, 'content-type': 'application/json' }, data: JSON.stringify({ scope: 'page', id: pageId, format: 'markdown' }) });
    assert.equal(exported.status(), 200);
    assert.ok(!(await exported.text()).includes(marker), 'The draft is in no export.');
    assert.ok(!(await text(bob.page, first)).includes(marker), 'Bob never sees the unsent draft.');
  };
  await nowhere();
  await alice.page.unroute('**/api/**');
  const unsaved = alice.page.locator(`[data-block-id="${first}"] [role="status"]`).filter({ hasText: /^Unsaved changes/ });
  await expect(unsaved).toBeVisible({ timeout: 10000 });
  await alice.page.waitForTimeout(1000);
  await nowhere();
  await shot('alice', 'reconnected draft labelled unsaved');
  await accessible(alice.page, 'reconnected draft labelled unsaved');
  const retried = await savedAfterCommit(alice.page, first, () => unsaved.getByRole('button', { name: 'Try saving again', exact: true }).click());
  assert.ok((await savedBlock(alice.context, origin, pageId, first)).includes(marker));
  await expect(blockText(bob.page, first)).toContainText(marker, { timeout: 10000 });
  record('offline', { offlineShown: true, unsavedAfterReconnect: true, absentWhileUnsaved: ['page', 'tree', 'search', 'export', 'other member'], retrySavedAfterCommitMs: retried.savedAfterCommitMs });
  const revisions = await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}`);
  record('revisionList', revisions.items.map(item => ({ id: item.id, author: item.authorDisplayName ?? item.origin, createdAt: item.createdAt })));

  // (e) Structure changes right after your own save. Bob commits a block, then Alice's save
  // commits, so her page revision already includes his commit while her copy of his block
  // is older. Moving, adding or commenting must never write that older copy over his text.
  const { pageId: rota, blockIds: [a, b, c] } = await restrictedPage({ context: alice.context, origin }, `Rota ${tag}`, ['Alpha line.', 'Bravo line.', 'Charlie line.']);
  await grant(alice.context, origin, rota, bob.id, 'edit');
  await Promise.all([alice, bob].map(person => person.page.goto(`${origin}/app/pages/${rota}`, { waitUntil: 'networkidle' })));
  const structured = alice.page.waitForResponse.bind(alice.page, response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/pages/${rota}/blocks`);
  const bobWrote = [];
  const afterOwnSave = async (variant, act) => {
    const words = ` Bob wrote ${tag} ${variant}.`;
    const before = (await ok(alice.context, origin, 'GET', `/api/pages/${rota}`)).blocks.find(block => block.id === b);
    const resume = refreshes.hold(rota);
    try {
      await savedAfterCommit(bob.page, b, () => typeAtEnd(bob.page, b, words));
      bobWrote.push(words.trim());
      await savedAfterCommit(alice.page, a, () => typeAtEnd(alice.page, a, ` Alice ${variant}.`));
      assert.ok(!(await text(alice.page, b)).includes(words.trim()), `${variant}: Alice's copy of Bob's block predates his commit.`);
      const response = structured();
      await act();
      return { response: await response, words, before };
    } finally { resume(); }
  };
  const bobSurvives = async variant => {
    for (const words of bobWrote) assert.ok((await savedBlock(alice.context, origin, rota, b)).includes(words), `${variant}: Bob's committed text is still on the page.`);
    // Bob's own tab keeps his text through a refresh cycle, and Alice now sees it.
    await bob.page.waitForTimeout(3500);
    for (const words of bobWrote) {
      await expect(blockText(bob.page, b)).toContainText(words);
      await expect(blockText(alice.page, b)).toContainText(words, { timeout: 10000 });
    }
  };
  const move = await afterOwnSave('move', async () => {
    await alice.page.locator(`[data-block-id="${c}"]`).hover();
    await alice.page.locator(`[data-block-id="${c}"]`).getByRole('button', { name: /^Block actions for/ }).click();
    await alice.page.getByRole('menuitem', { name: 'Move up', exact: true }).click();
  });
  assert.equal(move.response.status(), 200, 'The move commits.');
  await bobSurvives('move');
  assert.ok(JSON.stringify(JSON.parse(move.response.request().postData()).blocks.find(block => block.id === b).content).includes(move.words.trim()), 'The move was rebased on the saved page before it was sent.');
  assert.deepEqual((await ok(alice.context, origin, 'GET', `/api/pages/${rota}`)).blocks.map(block => block.id), [a, c, b]);
  await shot('bob', 'bob text kept after alice moved a block');
  const add = await afterOwnSave('add', async () => {
    await alice.page.getByRole('button', { name: /Add block/ }).click();
    await alice.page.getByRole('option', { name: 'Text', exact: true }).click();
  });
  assert.equal(add.response.status(), 200, 'The new block commits.');
  assert.equal((await ok(alice.context, origin, 'GET', `/api/pages/${rota}`)).blocks.length, 4);
  await bobSurvives('add');
  // Commenting anchors text in Bob's own block: Alice's change edits his block, so it
  // cannot be rebased. The server refuses it and Alice gets the block's conflict choices.
  const comment = await afterOwnSave('comment', async () => {
    await editable(alice.page, b).focus();
    await alice.page.keyboard.press('ControlOrMeta+Home');
    for (let index = 0; index < 'Bravo'.length; index++) await alice.page.keyboard.press('Shift+ArrowRight');
    await alice.page.getByRole('button', { name: 'Comment', exact: true }).click();
  });
  assert.equal(comment.response.status(), 409, 'Anchoring a comment on an older copy of a changed block is refused.');
  assert.equal((await comment.response.json()).code, 'BLOCK_CONFLICT');
  const badge = alice.page.locator(`[data-block-id="${b}"] [role="alert"]`);
  for (const choice of ['Compare', 'Reload theirs', 'Overwrite with mine']) await expect(badge.getByRole('button', { name: choice, exact: true })).toBeVisible();
  await expect(alice.page.locator('.page-document [role="alert"]').filter({ hasText: 'Someone else changed a block on this page' })).toBeVisible();
  await shot('alice', 'comment on a changed block is refused with its conflict choices');
  await accessible(alice.page, 'structure conflict after own save');
  await bobSurvives('comment');
  await badge.getByRole('button', { name: 'Reload theirs', exact: true }).click();
  await expect(blockText(alice.page, b)).toContainText(comment.words.trim());
  await expect(badge).toHaveCount(0);
  await expect(alice.page.locator('.page-document [role="alert"]').filter({ hasText: 'Someone else changed a block on this page' })).toHaveCount(0);
  // On the current text the comment anchors, and Bob's text stays.
  const anchored = structured();
  await editable(alice.page, b).focus();
  await alice.page.keyboard.press('ControlOrMeta+Home');
  for (let index = 0; index < 'Bravo'.length; index++) await alice.page.keyboard.press('Shift+ArrowRight');
  await alice.page.getByRole('button', { name: 'Comment', exact: true }).click();
  assert.equal((await anchored).status(), 200);
  await alice.page.getByRole('textbox', { name: 'Comment text', exact: true }).fill('Who covers Bravo?');
  await alice.page.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(alice.page.locator('.comment-thread')).toContainText('Who covers Bravo?');
  await bobSurvives('comment anchored');
  // The server half stands on its own: a structure change that sends an older copy of
  // Bob's block with its older revision is refused, whatever page revision it names.
  const current = await ok(alice.context, origin, 'GET', `/api/pages/${rota}`);
  const older = comment.before;
  const replayed = await call(alice.context, origin, 'PUT', `/api/pages/${rota}/blocks`, { operationKey: randomUUID(), expectedRevisionId: current.page.revisionId,
    blockRevisions: Object.fromEntries(current.blocks.map(block => [block.id, block.id === b ? older.revisionId : block.revisionId])),
    blocks: current.blocks.map(block => ({ id: block.id, blockType: block.blockType, content: block.id === b ? older.content : block.content, parentBlockId: block.parentBlockId, treePosition: block.treePosition })) });
  assert.equal(replayed.status, 409, 'An older copy of a changed block is refused.');
  assert.equal(replayed.body.code, 'BLOCK_CONFLICT');
  assert.equal(replayed.body.details.blockId, b);
  await bobSurvives('direct request');
  await alice.page.locator('.detail-close').click().catch(() => {});
  record('structureAfterOwnSave', { move: move.response.status(), add: add.response.status(), comment: comment.response.status(), commentAfterReload: 200, directStaleRequest: replayed.status, bobTextKept: bobWrote });
  return { pageId, spaceId: page.spaceId };
}
