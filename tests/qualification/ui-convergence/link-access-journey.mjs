import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { call, grant, ok } from './two-people-support.mjs';

/** Readable mentions become content-free access requests when the target grant ends. */
export async function linkAccessJourney(state, people, target, containerId) {
  const { alice, bob } = people, { origin } = state;
  const secret = 'Supplier escalation contacts';
  const host = (await ok(alice.context, origin, 'POST', '/api/pages', {
    operationKey: randomUUID(), containerId, title: 'Supplier index',
    blocks: [{ id: randomUUID(), blockType: 'paragraph', treePosition: 'a', content: { text: [
      { text: 'Contact ' }, { text: secret, mention: { kind: 'page', id: target, label: secret } },
    ] } }],
  })).value.pageId;
  await grant(alice.context, origin, host, bob.id, 'view');
  const allowed = await grant(alice.context, origin, target, bob.id, 'view');
  await bob.page.goto(`${origin}/app/pages/${host}`, { waitUntil: 'networkidle' });
  const mention = bob.page.locator('[data-page-editor] [data-mention-kind=page]');
  await expect(mention.getByRole('link', { name: secret, exact: true })).toHaveAttribute('href', `/app/pages/${target}`);
  await mention.getByRole('link').click();
  await expect(bob.page).toHaveURL(`${origin}/app/pages/${target}`);
  await expect(bob.page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue(secret);
  await grant(alice.context, origin, target, bob.id, 'view', { id: allowed.value.id, revoke: true });
  await bob.page.goto(`${origin}/app/pages/${host}`, { waitUntil: 'networkidle' });
  await expect(mention).not.toContainText(secret);
  await expect(mention.getByRole('link')).toHaveCount(0);
  await expect(mention).toContainText('Restricted page');
  await accessible(bob.page, 'restricted linked record');
  await people.shot('bob', 'restricted mention');
  const requested = bob.page.waitForResponse(response => new URL(response.url()).pathname === `/api/sharing/pages/${target}/request-access`);
  await mention.getByRole('button', { name: 'Request access', exact: true }).click();
  const response = await requested;
  assert.equal(response.status(), 202);
  assert.deepEqual(await response.json(), { accepted: true });
  await bob.page.goto(`${origin}/app/pages/${target}`, { waitUntil: 'networkidle' });
  const denied = bob.page.locator('.page-document');
  await expect(denied.getByRole('heading', { name: 'Access needed', exact: true })).toBeVisible();
  await expect(denied).not.toContainText(secret);
  await expect(denied).not.toContainText('Call the supplier duty manager');
  await expect(denied).not.toContainText('Alex Owner');
  await expect(denied.locator('img, [data-page-editor]')).toHaveCount(0);
  await accessible(bob.page, 'linked record access needed');
  await people.shot('bob', 'linked record access needed');
  for (const id of [target, randomUUID()]) {
    const replay = await call(bob.context, origin, 'POST', `/api/sharing/pages/${id}/request-access`, { operationKey: randomUUID() });
    assert.equal(replay.status, 202);
    assert.deepEqual(replay.body, { accepted: true });
  }
  const notices = (await ok(alice.context, origin, 'GET', '/api/notifications')).items.filter(item => item.event === 'access-requested' && item.pageId === target);
  assert.equal(notices.length, 1, 'Repeated requests notify one current granter once.');
  assert.deepEqual(notices[0].detail, { requesterMemberId: bob.id });
  assert.equal((await call(bob.context, origin, 'GET', `/api/pages/${target}`)).status, 404, 'Requesting access never grants it.');
}
