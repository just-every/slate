import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {call, editable, grant, ok, restrictedPage} from './two-people-support.mjs';

/** Real body typing, durable spans, recipient readback and current reader labels. */
export async function bodyMentionsJourney(state, people) {
  const {origin} = state, {alice, bob} = people, page = alice.page;
  const workspace = await ok(alice.context, origin, 'GET', '/api/workspace');
  const lifecycle = async value => {
    const current = await ok(alice.context, origin, 'GET', '/api/workspace');
    const {name, mark, description, guestAccess, publicLinkAccess, anonymousAccess} = current;
    await ok(alice.context, origin, 'PUT', '/api/workspace', {operationKey: randomUUID(), expectedRevisionId: current.revisionId, name, mark, description, guestAccess, publicLinkAccess, anonymousAccess, policies: {...workspace.policies, 'page.lifecycle.v1': value}});
  };
  const source = await restrictedPage(state, 'Handover references', ['Review with ']);
  const target = await restrictedPage(state, 'Release handbook', ['The release owner keeps this guide current.']);
  const [blockId] = source.blockIds;
  await grant(alice.context, origin, source.pageId, bob.id, 'view');
  const targetGrant = await grant(alice.context, origin, target.pageId, bob.id, 'view');
  const document = (id, person = alice) => ok(person.context, origin, 'GET', `/api/pages/${id}`);
  const notices = async () => (await ok(bob.context, origin, 'GET', '/api/notifications')).items.filter(item => item.event === 'mention' && item.pageId === source.pageId);
  const body = view => view.locator(`[data-block-id="${blockId}"]`).first();
  const pageMention = view => body(view).locator('[data-mention-kind="page"]');
  const spans = doc => doc.blocks.find(block => block.id === blockId).content.text;
  let captured;
  const capture = response => {
    if (response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${source.pageId}/blocks/${blockId}`)
      captured = {input: response.request().postDataJSON(), result: response.json()};
  };
  page.on('response', capture);
  await page.goto(`${origin}/app/pages/${source.pageId}`, {waitUntil: 'networkidle'});
  // Clicking the text's centre could follow an inline page link. Use the editor's keyboard door.
  const end = async () => {
    await editable(page, blockId).focus();
    await page.keyboard.press('ControlOrMeta+End');
  };
  const insert = async (query, option, {catalog = false} = {}) => {
    await end();
    await page.keyboard.press('@');
    const picker = page.getByRole('listbox', {name: 'Insert mention', exact: true});
    if (catalog) {
      await expect(picker).toHaveCount(1);
      await expect(picker.getByRole('option', {name: `${bob.name} · Person`, exact: true})).toBeVisible();
      await expect(picker.getByRole('option', {name: 'Release handbook · Page', exact: true})).toHaveCount(1);
      await expect(picker.getByRole('option', {name: 'Today · Date', exact: true})).toHaveCount(1);
      await people.shot('alice', 'body mention people pages and dates');
    }
    await page.keyboard.type(query);
    const choice = picker.getByRole('option', {name: option, exact: true});
    await expect(choice).toBeInViewport({ratio: 1});
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${source.pageId}/blocks/${blockId}` && response.request().postDataJSON().content.text.some(span => span.mention?.label === query));
    await choice.click();
    assert.equal((await saved).status(), 200);
    await expect(page.locator('.editor-save-status')).toHaveText('Saved');
  };
  const separate = async () => {
    await end();
    await page.keyboard.type(' and ');
  };
  let british;
  try {
    await insert(bob.name, `${bob.name} · Person`, {catalog: true});
    assert.equal((await notices()).length, 1, 'A newly committed body mention notifies its readable recipient.');
    await separate();
    await insert(bob.name, `${bob.name} · Person`);
    await separate();
    await insert('Release handbook', 'Release handbook · Page');
    await separate();
    await insert('2030-06-17', '2030-06-17 · Date');
    const committed = await document(source.pageId);
    assert.deepEqual(spans(committed).filter(span => span.mention).map(span => [span.mention.kind, span.mention.id]), [
      ['person', bob.id], ['person', bob.id], ['page', target.pageId], ['date', '2030-06-17'],
    ], 'Native picker insertions commit every reference with its kind and identifier.');
    const replay = captured;
    assert.ok(replay, 'The real autosave request was captured.');
    const firstReceipt = await replay.result;
    const repeated = await ok(alice.context, origin, 'PATCH', `/api/pages/${source.pageId}/blocks/${blockId}`, replay.input);
    assert.deepEqual(repeated.value, firstReceipt.value, 'Replay returns the original committed result.');
    assert.deepEqual(spans(await document(source.pageId)), spans(committed), 'Replay leaves every committed span unchanged.');
    assert.equal((await notices()).length, 1, 'Repeated references and replay retain one recipient notification.');
    await page.reload({waitUntil: 'networkidle'});
    await expect(body(page).locator('[data-mention-kind="person"]')).toHaveText([`@${bob.name}`, `@${bob.name}`]);
    await expect(pageMention(page).getByRole('link')).toHaveText('Release handbook');
    await expect(body(page).locator('[data-mention-kind="date"]')).toHaveText('6/17/2030');
    assert.deepEqual(spans(await document(source.pageId)), spans(committed), 'Reload preserves the exact committed body spans.');
    await people.shot('alice', 'body mentions saved and reloaded');
    console.log('PROBE BLOCK-005 picker and spans: native @ body typing -> people, pages and dates in one list; four committed references survive reload.');

    await bob.page.goto(`${origin}/app/inbox`, {waitUntil: 'networkidle'});
    const [notification] = await notices();
    const notice = bob.page.locator('.outcome-list li').filter({has: bob.page.locator(`a[href="${notification.href}"]`)}).filter({has: bob.page.locator('.outcome-kind').filter({hasText: /^mention\b/})});
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('Handover references');
    await notice.getByRole('link', {name: /Handover references/}).click();
    await expect(body(bob.page)).toContainText(`@${bob.name}`);
    await expect(pageMention(bob.page).getByRole('link')).toHaveText('Release handbook');
    await people.shot('bob', 'one readable body mention notification');
    console.log('PROBE BLOCK-005 person and replay: repeated person references and captured PATCH replay -> one readable inbox item, opening the body with Morgan Reader rendered.');

    // The same native member session in another reader locale; only identity is supplied.
    british = await state.context.browser().newContext({viewport: page.viewportSize(), locale: 'en-GB'});
    await british.addCookies([{name: 'slate_session', value: state.readerCookie.split('=')[1], url: origin}]);
    const britishPage = await british.newPage();
    await britishPage.goto(`${origin}/app/pages/${source.pageId}`, {waitUntil: 'networkidle'});
    await expect(body(britishPage).locator('[data-mention-kind="date"]')).toHaveText('17/06/2030');
    await britishPage.screenshot({path: `${people.evidence}/body-mentions-british.png`, fullPage: true});
    console.log('PROBE BLOCK-005 date locale: same saved 2030-06-17 -> 6/17/2030 for en-US and 17/06/2030 for en-GB.');

    await page.goto(`${origin}/app/pages/${target.pageId}`, {waitUntil: 'networkidle'});
    const renamed = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${target.pageId}`);
    await page.getByRole('textbox', {name: 'Page title', exact: true}).fill('Release handbook revised');
    assert.equal((await renamed).status(), 200);
    const destination = (await ok(alice.context, origin, 'POST', '/api/containers', {operationKey: randomUUID(), name: 'Release library', visibility: 'closed'})).value.id;
    const placement = {containerId: destination, parentPageId: null, atEnd: true};
    const preview = await ok(alice.context, origin, 'POST', `/api/pages/${target.pageId}/move-preview`, placement);
    await ok(alice.context, origin, 'POST', `/api/pages/${target.pageId}/move`, {operationKey: randomUUID(), expectedRevisionId: (await document(target.pageId)).page.revisionId, ...placement, accessPreviewHash: preview.accessPreviewHash, orderPreviewHash: preview.orderPreviewHash});
    await bob.page.reload({waitUntil: 'networkidle'});
    const link = pageMention(bob.page).getByRole('link', {name: 'Release handbook revised', exact: true});
    await expect(link).toHaveAttribute('href', `/app/pages/${target.pageId}`);
    await people.shot('bob', 'body page mention after rename and move');
    await link.click();
    await expect(bob.page.getByRole('textbox', {name: 'Page title', exact: true})).toHaveValue('Release handbook revised');
    assert.equal((await document(target.pageId, bob)).page.containerId, destination, 'The mention opens the same moved page.');

    // An editor's unpublished rename must never become the read-only member's label.
    await lifecycle('draft-then-publish');
    await page.goto(`${origin}/app/pages/${target.pageId}`, {waitUntil: 'networkidle'});
    const draftSaved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/pages/${target.pageId}`);
    await page.getByRole('textbox', {name: 'Page title', exact: true}).fill('Unpublished release plan');
    assert.equal((await draftSaved).status(), 200);
    await bob.page.goto(`${origin}/app/pages/${source.pageId}`, {waitUntil: 'networkidle'});
    await expect(pageMention(bob.page).getByRole('link')).toHaveText('Release handbook revised');
    assert.ok(!JSON.stringify(await document(source.pageId, bob)).includes('Unpublished release plan'));
    await page.goto(`${origin}/app/pages/${source.pageId}`, {waitUntil: 'networkidle'});
    await expect(pageMention(page).getByRole('link')).toHaveText('Unpublished release plan');
    const toPublish = await document(target.pageId);
    const review = await ok(alice.context, origin, 'POST', `/api/pages/${target.pageId}/publish-preview`, {expectedRevisionId: toPublish.page.revisionId});
    await ok(alice.context, origin, 'POST', `/api/pages/${target.pageId}/publish`, {operationKey: randomUUID(), expectedRevisionId: toPublish.page.revisionId, previewFingerprint: review.previewFingerprint});
    await bob.page.reload({waitUntil: 'networkidle'});
    await expect(pageMention(bob.page).getByRole('link')).toHaveText('Unpublished release plan');
    await people.shot('bob', 'body mention current published title');

    // Current access is checked again on every read; a stored title is never authority.
    const targetGrants = await ok(alice.context, origin, 'GET', `/api/sharing/pages/${target.pageId}`);
    const readerGrant = targetGrants.items.find(item => item.principalId === bob.id);
    assert.ok(readerGrant && targetGrant.value);
    await grant(alice.context, origin, target.pageId, bob.id, 'view', {id: readerGrant.id, revoke: true});
    await bob.page.goto(`${origin}/app/pages/${source.pageId}`, {waitUntil: 'networkidle'});
    await expect(pageMention(bob.page)).toContainText('Restricted page');
    await expect(pageMention(bob.page).getByRole('link')).toHaveCount(0);
    assert.ok(!JSON.stringify(await document(source.pageId, bob)).includes('Unpublished release plan'), 'The restricted title is absent from the reader projection.');
    assert.equal((await call(bob.context, origin, 'GET', `/api/pages/${target.pageId}`)).status, 404);
    await people.shot('bob', 'body page mention respects revoked access');
    console.log('PROBE BLOCK-005 page identity and authority: native title edit and reviewed cross-space move -> current title and same working link; revocation -> Restricted page, no link, target 404.');
  } finally {
    page.off('response', capture);
    await british?.close();
    await lifecycle(workspace.policies['page.lifecycle.v1'] ?? 'always-live');
  }
}
