import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { blockText, call, editable, grant, ok, restrictedPage, savedAfterCommit } from './two-people-support.mjs';

const order = async (context, origin, pageId) => (await ok(context, origin, 'GET', `/api/pages/${pageId}`)).blocks.map(block => block.id);

/** REV-003 and REV-005: restore writes a new revision and citations resolve to theirs. */
export async function historyJourney(state, people) {
  const { alice, bob, record, shot } = people, { origin } = state;
  const tag = randomBytes(4).toString('hex');
  const { pageId, spaceId, blockIds: [first, second, third] } = await restrictedPage({ context: alice.context, origin }, `Runbook ${tag}`, ['Check the pager rota.', 'Call the vendor.', 'Close the incident.']);
  await grant(alice.context, origin, pageId, bob.id, 'view');
  const page = alice.page;
  await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });

  // A comment anchored to text in the first block.
  const firstEditable = editable(page, first);
  await firstEditable.focus();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let index = 0; index < 'Check the pager'.length; index++) await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await page.getByRole('textbox', { name: 'Comment text', exact: true }).fill('Who owns the rota?');
  await page.getByRole('button', { name: 'Send comment', exact: true }).click();
  await expect(page.locator('.comment-thread')).toContainText('Who owns the rota?');
  const [thread] = (await ok(alice.context, origin, 'GET', `/api/comments/page/${pageId}`)).threads;
  await page.locator('.detail-close').click();
  // Explicit local exposure preconditions, through the owner's native settings.
  const workspace = await ok(alice.context, origin, 'GET', '/api/workspace');
  const saveWorkspace = async changes => {
    const w = await ok(alice.context, origin, 'GET', '/api/workspace');
    return ok(alice.context, origin, 'PUT', '/api/workspace', {operationKey:randomUUID(),expectedRevisionId:w.revisionId,name:w.name,mark:w.mark,description:w.description,guestAccess:w.guestAccess,publicLinkAccess:w.publicLinkAccess,anonymousAccess:w.anonymousAccess,policies:w.policies,...changes});
  };
  await saveWorkspace({publicLinkAccess:'allowed',anonymousAccess:'allowed'});
  const space = await ok(alice.context, origin, 'GET', `/api/containers/${spaceId}`);
  await ok(alice.context, origin, 'POST', '/api/sharing/container-settings', {operationKey:randomUUID(),id:spaceId,expectedRevisionId:space.revisionId,visibility:space.visibility,guestAccess:space.guestAccess,publicLinkAccess:'allowed',anonymousAccess:'allowed'});
  // A child page and a required public exposure.
  const child = await ok(alice.context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: spaceId, parentPageId: pageId, title: `Runbook appendix ${tag}`, blocks: [] });
  let current = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
  const slug = `runbook-${tag}`;
  const exposureResult = await call(alice.context, origin, 'POST', `/api/publishing/${pageId}`, { operationKey: randomUUID(), expectedRevisionId: current.page.revisionId, host: new URL(origin).host, slug, indexable: false, theme: 'default', headerControls: [], duplicateAsTemplate: false, socialPreview: {}, revoke: false });
  assert.equal(exposureResult.status, 200, JSON.stringify(exposureResult.body));
  const published = true;
  record('publicLink', published ? { slug, status: exposureResult.status } : { status: exposureResult.status, code: exposureResult.body?.code, message: exposureResult.body?.message });

  // Several edits: text in the second block (the revision we will restore), then
  // text in the third block and a moved block.
  await page.reload({ waitUntil: 'networkidle' });
  const target = await savedAfterCommit(page, second, async () => { await editable(page, second).click(); await page.keyboard.press('End'); await page.keyboard.type(' Use the escalation line.'); });
  await savedAfterCommit(page, third, async () => { await editable(page, third).click(); await page.keyboard.press('End'); await page.keyboard.type(' Write the review within a day.'); });
  const handle = page.locator(`[data-block-id="${third}"]`).getByRole('button', { name: /^Block actions for/ });
  await page.locator(`[data-block-id="${third}"]`).hover();
  await handle.click();
  await page.getByRole('menuitem', { name: 'Move up', exact: true }).click();
  await expect.poll(() => order(alice.context, origin, pageId)).toEqual([first, third, second]);
  // Two comments made after the revision we will restore: one on text that revision
  // also holds, one on text written after it.
  const commentOn = async (blockId, skip, length, body) => {
    await editable(page, blockId).focus();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let index = 0; index < skip; index++) await page.keyboard.press('ArrowRight');
    for (let index = 0; index < length; index++) await page.keyboard.press('Shift+ArrowRight');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await page.getByRole('textbox', { name: 'Comment text', exact: true }).fill(body);
    await page.getByRole('button', { name: 'Send comment', exact: true }).click();
    await expect(page.locator('.comment-thread').filter({ hasText: body })).toBeVisible();
    await page.locator('.detail-close').click();
    return (await ok(alice.context, origin, 'GET', `/api/comments/page/${pageId}`)).threads.at(-1);
  };
  await page.reload({ waitUntil: 'networkidle' });
  const kept = await commentOn(third, 0, 'Close the incident'.length, 'Who closes it?');
  const lost = await commentOn(third, 'Close the incident. '.length, 'Write the review'.length, 'Which template?');
  current = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
  const before = { revision: current.workingRevisionId, history: (await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}`)).items.map(item => item.id) };
  const grantsBefore = (await ok(alice.context, origin, 'GET', `/api/sharing/pages/${pageId}`)).items.map(item => ({ id: item.id, principalId: item.principalId, level: item.level, status: item.status }));
  const childPlace = async () => { const item = (await ok(alice.context, origin, 'GET', '/api/pages')).items.find(entry => entry.id === child.value.pageId); return { parentPageId: item.parentPageId, treePosition: item.treePosition }; };
  const childBefore = await childPlace();
  assert.equal(childBefore.parentPageId, pageId);
  const exposureBefore = published ? (await ok(alice.context, origin, 'GET', `/api/publishing/${pageId}`)).exposure : null;

  // Restore the earlier revision from History.
  await page.goto(`${origin}/app/pages/${pageId}?detail=history&revision=${target.revisionId}`, { waitUntil: 'networkidle' });
  const preview = page.locator('.revision-preview');
  await expect(preview).toContainText('A newer revision exists. This is the exact selected version.');
  await expect(preview).not.toContainText('Write the review within a day.');
  await shot('alice', 'history selected earlier revision');
  await preview.getByRole('button', { name: 'Restore this revision', exact: true }).click();
  const restoreDialog = page.getByRole('dialog', { name: 'Restore this revision?' });
  const restored = page.waitForResponse(response => response.url().includes(`/api/revisions/${pageId}/${target.revisionId}/restore`));
  await restoreDialog.getByRole('button', { name: 'Restore revision', exact: true }).click();
  assert.equal((await restored).status(), 200);
  await expect(blockText(page, third)).not.toContainText('Write the review within a day.');
  current = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
  const after = { revision: current.workingRevisionId, history: (await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}`)).items.map(item => item.id) };
  assert.ok(!before.history.includes(after.revision), 'Restoring writes a new revision.');
  assert.deepEqual(after.history.filter(id => id !== after.revision), before.history, 'Every earlier revision remains.');
  const targetSnapshot = await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}/${target.revisionId}`);
  const restoredSnapshot = await ok(alice.context, origin, 'GET', `/api/revisions/${pageId}/${after.revision}`);
  const content = blocks => blocks.map(block => [block.id, JSON.stringify(block.content)]);
  // COMM-004: the earlier content, with the live comment on text it still holds anchored again.
  const keptAnchor = JSON.parse(kept.anchor_json).anchorId;
  const expected = targetSnapshot.blocks.map(block => block.id === third ? { ...block, content: { text: [{ text: 'Close the incident', commentAnchorId: keptAnchor }, { text: '.' }] } } : block);
  assert.deepEqual(content(restoredSnapshot.blocks), content(expected), 'The new revision holds the earlier content.');
  // Activity names who restored which revision.
  const activity = (await ok(alice.context, origin, 'GET', '/api/activity?limit=20')).items.find(item => item.action === 'pages.restore' && item.target.id === pageId);
  assert.ok(activity, 'The restore is in activity.');
  assert.equal(activity.actor?.displayName ?? activity.actor?.name, alice.name);
  assert.equal(activity.context.revisionId, target.revisionId, 'Activity names the restored revision.');
  // Nothing outside the content moved.
  const [threadAfter] = (await ok(alice.context, origin, 'GET', `/api/comments/page/${pageId}`)).threads;
  assert.deepEqual({ block: threadAfter.block_id, anchor: threadAfter.anchor_json, orphaned: !!threadAfter.orphaned }, { block: thread.block_id, anchor: thread.anchor_json, orphaned: false }, 'The comment anchor is unchanged.');
  await expect(editable(page, first).locator('mark')).toHaveText('Check the pager');
  const threadsAfter = (await ok(alice.context, origin, 'GET', `/api/comments/page/${pageId}`)).threads;
  const keptAfter = threadsAfter.find(item => item.id === kept.id), lostAfter = threadsAfter.find(item => item.id === lost.id);
  assert.deepEqual({ block: keptAfter.block_id, orphaned: !!keptAfter.orphaned }, { block: third, orphaned: false }, 'A comment on text the restored revision holds stays anchored.');
  assert.equal(!!lostAfter.orphaned, true, 'A comment on text the restored revision lacks is orphaned.');
  await expect(editable(page, third).locator('mark')).toHaveText('Close the incident');
  await page.goto(`${origin}/app/pages/${pageId}?detail=comments`, { waitUntil: 'networkidle' });
  await expect(page.locator('.comment-thread').filter({ hasText: 'Who closes it?' }).getByRole('button', { name: 'Jump to selected text', exact: true })).toBeVisible();
  await expect(page.locator('.comment-thread').filter({ hasText: 'Which template?' })).toContainText('Original text is no longer on the page.');
  await shot('alice', 'restored comments anchored and orphaned');
  await page.locator('.detail-close').click();
  assert.deepEqual(await childPlace(), childBefore, 'The child page is unchanged.');
  assert.deepEqual((await ok(alice.context, origin, 'GET', `/api/sharing/pages/${pageId}`)).items.map(item => ({ id: item.id, principalId: item.principalId, level: item.level, status: item.status })), grantsBefore, 'Grants are unchanged.');
  if (published) {
    assert.deepEqual((await ok(alice.context, origin, 'GET', `/api/publishing/${pageId}`)).exposure, exposureBefore, 'The public link is unchanged.');
    const anonymous = await state.context.browser().newContext();
    assert.equal((await anonymous.request.get(`${origin}/p/${slug}`)).status(), 200, 'The public link still resolves.');
    await anonymous.close();
  }
  await shot('alice', 'restored as new revision');
  await accessible(page, 'restored revision');

  // REV-005: the pre-restore revision opens exactly as committed, with a newer-revision notice.
  const card = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}/link-card?revision=${before.revision}`);
  assert.equal(card.href, `/app/pages/${pageId}?revision=${before.revision}`);
  const citation = new URL(card.href, origin).href;
  await page.goto(citation, { waitUntil: 'networkidle' });
  await expect(preview).toContainText('A newer revision exists.');
  await expect(preview).toContainText('Write the review within a day.');
  const shown = await preview.innerText();
  const positions = ['Check the pager', 'Close the incident', 'Call the vendor'].map(line => shown.indexOf(line));
  assert.ok(positions.every((at, index) => at >= 0 && (index === 0 || at > positions[index - 1])), 'The cited revision shows its committed block order.');
  await shot('alice', 'citation to pre-restore revision');
  // Follow a native rich-text link carrying the exact address emitted above.
  const reference = await restrictedPage({context:alice.context,origin},`Citations ${tag}`,['Open cited revision']);
  const source = await ok(alice.context,origin,'GET',`/api/pages/${reference.pageId}`);
  await ok(alice.context,origin,'PATCH',`/api/pages/${reference.pageId}/blocks/${reference.blockIds[0]}`,{operationKey:randomUUID(),expectedRevisionId:source.blocks[0].revisionId,content:{text:[{text:'Open cited revision',link:{href:card.href}}]}});
  await grant(alice.context,origin,reference.pageId,bob.id,'view');
  await bob.page.goto(`${origin}/app/pages/${reference.pageId}`,{waitUntil:'networkidle'});
  const link=bob.page.getByRole('link',{name:'Open cited revision',exact:true});
  await expect(link).toHaveAttribute('href',card.href);
  const opened=bob.page.waitForEvent('popup');
  await link.click();
  const cited=await opened;
  await expect(cited).toHaveURL(citation);
  await expect(cited.locator('.revision-preview')).toContainText('Write the review within a day.');
  await expect(cited.locator('.revision-preview')).toContainText('A newer revision exists.');
  await expect(cited.locator('.revision-preview').getByText('A newer revision exists. This is the exact selected version.',{exact:true})).toBeInViewport();
  await cited.screenshot({path:`${people.evidence}/generated-citation-opened.png`,fullPage:true});
  await cited.close();
  // Bob could read it; after his access is removed his copied citation gives nothing.
  await bob.page.goto(citation,{waitUntil:'networkidle'});
  await expect(bob.page.locator('.revision-preview')).toContainText('Write the review within a day.');
  const grants = await ok(alice.context, origin, 'GET', `/api/sharing/pages/${pageId}`);
  const bobGrant = grants.items.find(item => item.principalId === bob.id);
  await grant(alice.context, origin, pageId, bob.id, 'view', { id: bobGrant.id, revoke: true });
  await bob.page.goto(citation, { waitUntil: 'networkidle' });
  await expect(bob.page.getByRole('heading', { name: 'Access needed', exact: true })).toBeVisible();
  assert.ok(!(await bob.page.locator('body').innerText()).includes('Write the review within a day.'), 'A member who lost access gets no historical content.');
  assert.ok([403, 404].includes((await call(bob.context, origin, 'GET', `/api/revisions/${pageId}/${before.revision}`)).status));
  await shot('bob', 'citation after access removed');
  // Regrant with a genuine short expiry: the same generated citation opens,
  // then stops at current authority without reviving its published history.
  const expiresAt = new Date(Date.now() + 4000).toISOString();
  await grant(alice.context, origin, pageId, bob.id, 'view', {id:bobGrant.id,expiresAt});
  await bob.page.goto(citation, {waitUntil:'networkidle'});
  await expect(bob.page.locator('.revision-preview')).toContainText('Write the review within a day.');
  await expect.poll(async () => (await ok(alice.context, origin, 'GET', `/api/sharing/pages/${pageId}`)).items.find(item => item.id===bobGrant.id)?.status, {timeout:10000}).toBe('expired');
  await bob.page.reload({waitUntil:'networkidle'});
  await expect(bob.page.getByRole('heading',{name:'Access needed',exact:true})).toBeVisible();
  await expect(bob.page.locator('body')).not.toContainText('Write the review within a day.');
  assert.equal((await call(bob.context,origin,'GET',`/api/revisions/${pageId}/${before.revision}`)).status,404);
  await shot('bob','citation after grant expired');
  // An anonymous reader of a page that is not published gets nothing.
  const { pageId: privatePage } = await restrictedPage({ context: alice.context, origin }, `Private notes ${tag}`, [`Private body ${tag}.`]);
  const privateRevision = (await ok(alice.context, origin, 'GET', `/api/pages/${privatePage}`)).workingRevisionId;
  const anonymous = await state.context.browser().newContext();
  const stranger = await anonymous.newPage();
  await stranger.goto(`${origin}/app/pages/${privatePage}?detail=history&revision=${privateRevision}`, { waitUntil: 'networkidle' });
  assert.ok(!(await stranger.locator('body').innerText()).includes(`Private body ${tag}`), 'An anonymous reader of an unpublished page gets no content.');
  assert.equal((await anonymous.request.get(`${origin}/api/revisions/${privatePage}/${privateRevision}`)).status(), 401);
  await stranger.screenshot({ path: `${people.evidence}/anonymous-citation-unpublished.png`, fullPage: true });
  // The generated member address admits anonymous readers only for a published
  // revision under a current public exposure. Working-only content never opens.
  await stranger.goto(citation, {waitUntil:'networkidle'});
  await expect(stranger.locator('.public-document')).toContainText('Write the review within a day.');
  await expect(stranger.locator('.public-document')).toContainText('A newer revision exists.');
  await stranger.screenshot({path:`${people.evidence}/anonymous-citation-published.png`,fullPage:true});
  await saveWorkspace({policies:{...workspace.policies,'page.lifecycle.v1':'draft-then-publish'}});
  current = await ok(alice.context,origin,'GET',`/api/pages/${pageId}`);
  const unpublished = await ok(alice.context,origin,'PATCH',`/api/pages/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:current.page.revisionId,properties:{title:`Unpublished citation ${tag}`}});
  const unpublishedCard = await ok(alice.context,origin,'GET',`/api/pages/${pageId}/link-card?revision=${unpublished.value.revisionId}`);
  await stranger.goto(new URL(unpublishedCard.href,origin).href,{waitUntil:'networkidle'});
  await expect(stranger.locator('body')).not.toContainText(`Unpublished citation ${tag}`);
  assert.equal((await anonymous.request.get(`${origin}/p/${slug}?revision=${unpublished.value.revisionId}`)).status(),404);
  assert.equal((await call(bob.context,origin,'GET',`/api/revisions/${pageId}/${unpublished.value.revisionId}`)).status,404);
  await stranger.goto(citation,{waitUntil:'networkidle'});
  await expect(stranger.locator('.public-document')).toContainText('Write the review within a day.');
  await expect(stranger.locator('body')).not.toContainText(`Unpublished citation ${tag}`);
  // Public access switches and revocation apply to that same old citation now.
  await saveWorkspace({anonymousAccess:'forbidden'});
  await stranger.goto(citation,{waitUntil:'networkidle'});
  await expect(stranger.locator('body')).not.toContainText('Write the review within a day.');
  await saveWorkspace({anonymousAccess:'allowed'});

  // Native trash and explicit cascade confirmation: a refused incomplete list
  // destroys nothing, then the full confirmation erases content and is replay-safe.
  current = await ok(alice.context,origin,'GET',`/api/pages/${pageId}`);
  await ok(alice.context,origin,'POST',`/api/archive/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:current.page.revisionId,action:'trash'});
  const refused = await call(alice.context,origin,'POST',`/api/archive/${pageId}/permanent-delete`,{operationKey:randomUUID(),confirmedPageIds:[pageId]});
  assert.equal(refused.status,409);
  assert.equal(refused.body.code,'CONFIRM_CASCADE');
  await ok(alice.context,origin,'POST',`/api/archive/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:current.page.revisionId,action:'restore'});
  assert.equal((await ok(alice.context,origin,'GET',`/api/revisions/${pageId}/${before.revision}`)).blocks.length,3);
  await ok(alice.context,origin,'POST',`/api/archive/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:current.page.revisionId,action:'trash'});
  const deletion = {operationKey:randomUUID(),confirmedPageIds:[pageId,child.value.pageId]};
  const erased = await ok(alice.context,origin,'POST',`/api/archive/${pageId}/permanent-delete`,deletion);
  assert.deepEqual(new Set(erased.value.deletedPageIds),new Set(deletion.confirmedPageIds));
  await ok(alice.context,origin,'POST',`/api/archive/${pageId}/permanent-delete`,deletion);
  for (const route of [`/api/pages/${pageId}`,`/api/revisions/${pageId}/${before.revision}`,`/api/pages/${pageId}/link-card?revision=${before.revision}`]) {
    const gone = await call(alice.context,origin,'GET',route);
    assert.equal(gone.status,404);
    assert.equal(gone.body.code,'PAGE_ERASED');
    assert.deepEqual(Object.keys(gone.body.details).sort(),['deletedAt','kind']);
    assert.equal(gone.body.details.kind,'page');
    assert.ok(Number.isFinite(Date.parse(gone.body.details.deletedAt)));
  }
  await page.goto(citation,{waitUntil:'networkidle'});
  const tombstone = page.getByRole('article',{name:'Deleted record'});
  await expect(tombstone).toContainText('Deleted page');
  await expect(tombstone.locator('time')).toHaveAttribute('datetime',/T/);
  for (const privateText of [`Runbook ${tag}`,`Unpublished citation ${tag}`,'Write the review within a day.','Who owns the rota?','Alex Owner','Morgan Reader']) await expect(tombstone).not.toContainText(privateText);
  await expect(page.locator('.revision-preview')).toHaveCount(0);
  await shot('alice','same citation after confirmed erasure');
  await accessible(page,'erased revision citation');
  await bob.page.goto(citation,{waitUntil:'networkidle'});
  await expect(bob.page.getByRole('heading',{name:'Access needed',exact:true})).toBeVisible();
  await stranger.goto(citation,{waitUntil:'networkidle'});
  await expect(stranger.locator('body')).not.toContainText('Write the review within a day.');
  await anonymous.close();
  await saveWorkspace({publicLinkAccess:workspace.publicLinkAccess,anonymousAccess:workspace.anonymousAccess,policies:workspace.policies});
  record('history', { restoredFrom: target.revisionId, newRevision: after.revision, revisionsBefore: before.history, revisionsAfter: after.history, activity: { action: activity.action, actor: alice.name, restoredRevisionId: activity.context.revisionId } });
}
