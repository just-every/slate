import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-support.mjs';
import { call, grant, ok, withSecondPerson } from './two-people-support.mjs';

const general = grants => grants.items.filter(item => ['container', 'workspace'].includes(item.principalKind));

/** Native personal-container fixture: session admission creates it; no sharing state is seeded. */
export async function personalPage(state) {
  const containers = await state.api('/api/containers');
  const personal = containers.items.filter(item => item.visibility === 'personal');
  assert.equal(personal.length, 1, 'The owner has exactly one native personal container.');
  const created = await ok(state.context, state.origin, 'POST', '/api/pages', {
    operationKey: randomUUID(), containerId: personal[0].id,
    title: 'Personal general-access refusal', blocks: [],
  });
  return { pageId: created.value.pageId, containerId: personal[0].id };
}

/** General access, named-only restriction and private refusal through the mounted Share panel. */
export async function generalAccessJourney(state) {
  const { page, context, origin, api } = state;
  const workspace = await api('/api/workspace');
  const configure = async profile => {
    const current = await api('/api/workspace');
    const { name, mark, description, guestAccess, publicLinkAccess, anonymousAccess } = current;
    await ok(context, origin, 'PUT', '/api/workspace', {
      operationKey: randomUUID(), expectedRevisionId: current.revisionId,
      name, mark, description, guestAccess, publicLinkAccess, anonymousAccess,
      policies: { ...workspace.policies, 'page.access.v1': profile },
    });
  };
  const open = async pageId => {
    await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const panel = page.locator('.right');
    await expect(panel.getByRole('heading', { name: 'Share this page', exact: true })).toBeVisible();
    await panel.locator('.advanced-access > summary').click();
    return panel;
  };
  const entries = async pageId => (await api('/api/activity?action=sharing.grant&limit=100')).items.filter(item => item.target.id === pageId);
  const read = async pageId => {
    const grants = await api(`/api/sharing/pages/${pageId}`);
    assert.ok(general(grants).length <= 1, 'Every committed read has at most one general principal, including revoked rows.');
    return grants;
  };
  const change = async (pageId, action) => {
    const before = await entries(pageId);
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sharing');
    await action();
    const response = await pending;
    assert.equal(response.status(), 200, await response.text());
    const submitted = response.request().postDataJSON(), result = await response.json();
    const committed = await read(pageId);
    const after = await entries(pageId);
    assert.equal(after.length, before.length + 1, 'One Share action creates exactly one activity entry.');
    const own = after.filter(item => item.operationKey === submitted.operationKey);
    assert.equal(own.length, 1);
    assert.equal(own[0].id, result.receipt.activityId);
    assert.equal(own[0].actor.id, 'browser-owner');
    assert.deepEqual(own[0].target, { kind: 'page', id: pageId });
    assert.equal(own[0].occurredAt, result.receipt.committedAt);
    const replay = await ok(context, origin, 'POST', '/api/sharing', submitted);
    assert.deepEqual(replay.receipt, result.receipt, 'Request replay returns the original native receipt.');
    assert.deepEqual(await read(pageId), committed, 'Replay leaves grants unchanged.');
    assert.deepEqual(await entries(pageId), after, 'Replay cannot duplicate activity.');
    await open(pageId);
    assert.deepEqual(await read(pageId), committed, 'A full reload retains the committed grant projection.');
    return submitted;
  };
  try {
    await withSecondPerson(state, page.viewportSize().width, async people => {
      // Morgan owns this space and is therefore in its container principal, but
      // restriction must still exclude Morgan until the page names a grant.
      const container = (await ok(people.bob.context, origin, 'POST', '/api/containers', {
        operationKey: randomUUID(), name: 'General access members', visibility: 'private',
      })).value.id;
      await ok(people.bob.context, origin, 'POST', '/api/sharing', {
        operationKey: randomUUID(), targetKind: 'container', targetId: container,
        principalKind: 'member', principalId: 'browser-owner', level: 'full',
      });
      const personal = await personalPage(state);
      const readerAccess = async (pageId, allowed) => {
        const result = await call(people.bob.context, origin, 'GET', `/api/pages/${pageId}`);
        assert.equal(result.status, allowed ? 200 : 404, 'Independent member reads follow the committed grant.');
        await people.bob.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
        if (allowed) await expect(people.bob.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('General access boundary');
        else await expect(people.bob.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveCount(0);
      };
      for (const profile of ['workspace-general', 'container-general']) {
        await configure(profile);
        const created = await ok(context, origin, 'POST', '/api/pages', {
          operationKey: randomUUID(), containerId: container,
          title: 'General access boundary', blocks: [],
        });
        const pageId = created.value.pageId;
        await grant(context, origin, pageId, 'browser-owner', 'full');
        const document = await api(`/api/pages/${pageId}`);
        await ok(context, origin, 'PUT', `/api/sharing/pages/${pageId}/inheritance`, {
          operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, restricted: true,
        });
        assert.equal(general(await read(pageId)).length, 0);
        await readerAccess(pageId, false);
        await open(pageId);
        const add = await change(pageId, () => page.getByRole('button', { name: 'Allow general read access', exact: true }).click());
        assert.equal(general(await read(pageId))[0].principalKind, profile === 'workspace-general' ? 'workspace' : 'container');
        await readerAccess(pageId, true);
        const initialGeneral = general(await read(pageId))[0];
        const stored = await read(pageId);
        const other = profile === 'workspace-general' ? 'container-general' : 'workspace-general';
        await configure(other);
        assert.deepEqual(await read(pageId), stored, 'Changing the profile cannot itself rewrite a grant.');
        await open(pageId);
        await change(pageId, () => page.getByRole('button', { name: 'Allow general read access', exact: true }).click());
        const replacement = general(await read(pageId));
        assert.equal(replacement.length, 1, 'Replacing the scope leaves exactly one general principal.');
        assert.notEqual(replacement[0].id, initialGeneral.id);
        assert.equal(replacement[0].principalKind, other === 'workspace-general' ? 'workspace' : 'container');
        await readerAccess(pageId, true);
        const generalRow = () => page.locator('.grant-list > li').filter({ has: page.getByRole('combobox', { name: `Access for ${replacement[0].principalLabel}`, exact: true }) });
        await change(pageId, () => generalRow().getByRole('combobox').selectOption('comment'));
        assert.equal(general(await read(pageId))[0].level, 'comment');
        assert.equal((await ok(people.bob.context, origin, 'GET', `/api/pages/${pageId}`)).permissions.level, 'comment');
        const deniedBefore = await read(pageId), auditBefore = await entries(pageId);
        const denied = await call(people.bob.context, origin, 'POST', '/api/sharing', { ...add, operationKey: randomUUID() });
        assert.equal(denied.status, 404, 'A reader cannot widen general access.');
        assert.deepEqual(await read(pageId), deniedBefore);
        assert.deepEqual(await entries(pageId), auditBefore);
        await change(pageId, async () => {
          await generalRow().locator('details > summary').click();
          await generalRow().getByRole('button', { name: 'Remove access', exact: true }).click();
        });
        assert.equal(general(await read(pageId)).filter(item => item.effective).length, 0);
        await readerAccess(pageId, false);
        const removed = await read(pageId), removedAudit = await entries(pageId);
        await ok(context, origin, 'POST', '/api/sharing', add);
        assert.deepEqual(await read(pageId), removed, 'Replaying the old addition after removal cannot resurrect access.');
        assert.deepEqual(await entries(pageId), removedAudit);
        await readerAccess(pageId, false);
        await open(pageId);
        await page.getByRole('combobox', { name: 'Invite someone', exact: true }).selectOption('member:browser-reader');
        await page.getByRole('combobox', { name: 'Permission', exact: true }).selectOption('view');
        await change(pageId, () => page.getByRole('button', { name: 'Share page', exact: true }).click());
        await readerAccess(pageId, true);
        assert.equal((await ok(people.bob.context, origin, 'GET', `/api/pages/${pageId}`)).permissions.level, 'view');
        await accessible(page, `general access ${profile} named-only restriction`);

        await configure(profile);
        const privateBefore = await read(personal.pageId), privateAudit = await entries(personal.pageId);
        await readerAccess(personal.pageId, false);
        await open(personal.pageId);
        const refused = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sharing');
        await page.getByRole('button', { name: 'Allow general read access', exact: true }).click();
        const response = await refused;
        assert.equal(response.status(), 403);
        assert.equal((await response.json()).code, 'PERSONAL_PRIVATE');
        await expect(page.getByRole('alert')).toBeVisible();
        for (const principalKind of ['workspace', 'container']) {
          const result = await call(context, origin, 'POST', '/api/sharing', {
            operationKey: randomUUID(), targetKind: 'page', targetId: personal.pageId,
            principalKind, principalId: principalKind === 'workspace' ? workspace.id : personal.containerId, level: 'view',
          });
          assert.equal(result.status, 403);
          assert.equal(result.body.code, 'PERSONAL_PRIVATE');
          assert.deepEqual(await read(personal.pageId), privateBefore, 'Forbidden widening changes no private grant.');
          assert.deepEqual(await entries(personal.pageId), privateAudit, 'Forbidden widening writes no activity.');
        }
        await accessible(page, `general access ${profile} personal refusal`);
        await open(personal.pageId);
        assert.deepEqual(await read(personal.pageId), privateBefore, 'Private grants remain unchanged after reload.');
        await readerAccess(personal.pageId, false);
        console.log(`PROBE SHARE-004 1: Share under ${profile}, restricted and personal pages -> only named reader admitted; both private general principals refused unchanged`);
        console.log(`PROBE SHARE-004 2: Share add, replace, change level and remove under ${profile} -> one committed activity and original receipt on replay`);
        console.log(`PROBE SHARE-004 3: committed grant projection and reload under ${profile} -> at most one general principal; removed addition replay does not restore access`);
      }
    });
  } finally {
    const current = await api('/api/workspace');
    const { name, mark, description, guestAccess, publicLinkAccess, anonymousAccess } = current;
    await ok(context, origin, 'PUT', '/api/workspace', { operationKey: randomUUID(), expectedRevisionId: current.revisionId, name, mark, description, guestAccess, publicLinkAccess, anonymousAccess, policies: workspace.policies });
  }
}
