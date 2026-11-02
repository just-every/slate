import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { accessible } from './browser-support.mjs';
import { call, ok } from './two-people-support.mjs';

/**
 * SHARE-003 through the loaded Share panel and an independent reader session.
 * The ancestor grants exist before any child does; children are created later,
 * one restriction cuts a subtree off, and restoring it leaves every stored grant
 * row exactly as it was while traversal alone changes what each page shows.
 */
export async function inheritanceChainJourney({ page, context, origin, api, readerCookie }) {
  const mutate = (route, data, method = 'POST') => ok(context, origin, method, route, { ...data, operationKey: crypto.randomUUID() });
  const space = (await mutate('/api/containers', { name: 'Inheritance chain', visibility: 'private' })).value.id;
  const create = async (title, parentPageId) => (await mutate('/api/pages', { containerId: space, title, ...(parentPageId ? { parentPageId } : {}) })).value.pageId;
  const grant = async (targetId, principalKind, principalId, level) => {
    const input = { targetKind: 'page', targetId, principalKind, principalId, level };
    return { ...input, id: (await mutate('/api/sharing', input)).value.id };
  };
  const group = (await mutate('/api/groups', { name: 'Chain editors', memberIds: ['browser-owner'] })).value.id;
  const root = await create('Chain root');
  const rootGrants = [await grant(root, 'member', 'browser-reader', 'comment'), await grant(root, 'group', group, 'view')];

  const reader = await context.browser().newContext();
  await reader.addCookies([{ name: 'slate_session', value: readerCookie.split('=')[1], url: origin }]);
  const read = id => call(reader, origin, 'GET', `/api/pages/${id}`);
  const levelOf = async id => { const result = await read(id); return result.status === 200 ? result.body.permissions.level : result.status; };
  const ids = { root }, names = { [root]: 'Chain root' };
  const project = id => api(`/api/sharing/pages/${id}`);
  const grantIds = list => list.map(item => item.id).sort();
  try {
    // Children are created after the ancestor grants and are readable by the
    // reader the moment each exists, without a single grant row being written.
    for (const [key, title, parent] of [['a', 'Chain A', 'root'], ['b', 'Chain B', 'a'], ['c', 'Chain C', 'b'], ['f', 'Chain F', 'c'], ['d', 'Chain D', 'root']]) {
      ids[key] = await create(title, ids[parent]);
      names[ids[key]] = title;
      assert.equal(await levelOf(ids[key]), 'comment', `${title} inherits the parent grant at creation.`);
      assert.deepEqual((await project(ids[key])).items, [], `${title} carries no copied grant row.`);
    }
    const bGrants = [await grant(ids.b, 'member', 'browser-owner', 'full'), await grant(ids.b, 'group', group, 'edit')];
    const pages = ['root', 'a', 'b', 'c', 'f', 'd'];
    const rows = async () => Object.fromEntries(await Promise.all(pages.map(async key => [key, (await project(ids[key])).items])));
    const spaceGrants = (await api(`/api/sharing/containers/${space}`)).items;
    assert.ok(spaceGrants.length >= 1, 'The private space keeps its creator grant.');
    const before = await rows();
    assert.deepEqual(grantIds(before.root), grantIds(rootGrants));
    assert.deepEqual(grantIds(before.b), grantIds(bGrants));
    for (const key of ['a', 'c', 'f', 'd']) assert.deepEqual(before[key], [], 'Only the parent and the restricted page hold grant rows.');

    const expectProjection = async (key, restriction, inheritedFrom) => {
      const projection = await project(ids[key]);
      assert.deepEqual(projection.restriction, restriction, `${names[ids[key]]} reports its restriction.`);
      assert.deepEqual(grantIds(projection.inheritedItems), grantIds(inheritedFrom), `${names[ids[key]]} inherits exactly the traversed grants.`);
      assert.deepEqual(grantIds(projection.effectiveItems), grantIds([...projection.items, ...inheritedFrom]));
      for (const item of projection.inheritedItems) assert.equal(item.origin.id, rootGrants.some(g => g.id === item.id) ? root : bGrants.some(g => g.id === item.id) ? ids.b : space, 'Each inherited row names the page that holds it.');
      return projection;
    };
    const none = null, boundary = key => ({ scope: key === undefined ? 'page' : 'ancestor', id: ids.b, name: 'Chain B' });
    const unrestricted = async () => {
      await expectProjection('root', none, spaceGrants);
      await expectProjection('a', none, [...rootGrants, ...spaceGrants]);
      await expectProjection('b', none, [...rootGrants, ...spaceGrants]);
      await expectProjection('c', none, [...rootGrants, ...bGrants, ...spaceGrants]);
      await expectProjection('f', none, [...rootGrants, ...bGrants, ...spaceGrants]);
      await expectProjection('d', none, [...rootGrants, ...spaceGrants]);
      assert.deepEqual(await rows(), before, 'Grant rows are exactly the stored set.');
    };
    await unrestricted();

    const panel = page.locator('.right');
    const openShare = async key => {
      await page.goto(`${origin}/app/pages/${ids[key]}`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await expect(panel.getByRole('heading', { name: 'Share this page', exact: true })).toBeVisible();
    };
    const shown = async (key, expected, label) => {
      await openShare(key);
      const notice = panel.locator('[data-restriction]');
      if (!expected) await expect(notice).toHaveCount(0);
      else {
        await expect(notice).toHaveCount(1);
        await expect(notice).toHaveAttribute('data-restriction', expected.scope);
        await expect(notice).toContainText(expected.scope === 'page' ? 'Restricted: this page does not inherit' : `Restricted by ${expected.name}`);
      }
      if (label) await accessible(page, label);
    };
    for (const key of pages) await shown(key, none);

    // Restrict the middle page through its native control.
    await openShare('b');
    await panel.locator('.advanced-access > summary').click();
    await panel.getByRole('button', { name: 'Restrict inherited access', exact: true }).click();
    await expect.poll(async () => (await project(ids.b)).restricted).toBe(true);
    await expectProjection('b', boundary(), []);
    await expectProjection('c', boundary(1), bGrants);
    await expectProjection('f', boundary(1), bGrants);
    await expectProjection('a', none, [...rootGrants, ...spaceGrants]);
    await expectProjection('d', none, [...rootGrants, ...spaceGrants]);
    assert.deepEqual(await rows(), before, 'Restricting changes no stored grant row.');
    await shown('b', boundary(), 'restricted page names its restriction');
    await shown('c', boundary(1), 'descendant names the restricting ancestor');
    await shown('f', boundary(1));
    await expect(panel.locator('.inherited-grant-list > li')).toHaveCount(bGrants.length);
    await expect(panel.locator('.inherited-grant-list')).toContainText('From Chain B');
    await expect(panel.locator('.inherited-grant-list')).not.toContainText('From Chain root');
    await shown('a', none);
    await shown('d', none);
    assert.deepEqual(await Promise.all(['a', 'd'].map(key => levelOf(ids[key]))), ['comment', 'comment']);
    assert.deepEqual(await Promise.all(['b', 'c', 'f'].map(key => levelOf(ids[key]))), [404, 404, 404], 'The reader loses the restricted subtree and only that subtree.');

    // Restore through the same control: the subtree follows the ancestors again.
    await openShare('b');
    await panel.locator('.advanced-access > summary').click();
    await panel.getByRole('button', { name: 'Restore inherited access', exact: true }).click();
    await expect.poll(async () => (await project(ids.b)).restricted).toBe(false);
    await unrestricted();
    for (const key of pages) await shown(key, none);
    assert.deepEqual(await Promise.all(['a', 'b', 'c', 'f', 'd'].map(key => levelOf(ids[key]))), Array(5).fill('comment'), 'Restoring inheritance returns the reader through traversal.');

    // Change the ancestor grant: every descendant follows at once, still without a copy.
    await openShare('root');
    await panel.locator('.advanced-access > summary').click();
    const readerGrant = panel.locator('.grant-list > li').filter({ has: page.getByRole('combobox', { name: 'Access for Morgan Reader', exact: true }) });
    await readerGrant.getByRole('combobox', { name: 'Access for Morgan Reader', exact: true }).selectOption('view');
    await expect.poll(async () => (await project(ids.root)).items.find(item => item.id === rootGrants[0].id).level).toBe('view');
    rootGrants[0].level = 'view';
    assert.deepEqual(await Promise.all(['a', 'b', 'c', 'f', 'd'].map(key => levelOf(ids[key]))), Array(5).fill('view'), 'Descendants follow the narrowed ancestor grant on the next request.');
    await openShare('f');
    const row = panel.locator(`.inherited-grant-list [data-grant-id="${rootGrants[0].id}"]`);
    await expect(row).toContainText('Morgan Reader');
    await expect(row).toContainText('View');
    await expect(row).toContainText('From Chain root');
    await page.reload({ waitUntil: 'networkidle' });
    // The panel may reopen on its own after a reload; open it only when it has not.
    const heading = panel.getByRole('heading', { name: 'Share this page', exact: true });
    if (!await heading.isVisible()) await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(heading).toBeVisible();
    await expect(panel.locator(`.inherited-grant-list [data-grant-id="${rootGrants[0].id}"]`)).toContainText('View');
    await mutate('/api/sharing', { ...rootGrants[0], level: 'edit' });
    assert.deepEqual(await Promise.all(['a', 'b', 'c', 'f', 'd'].map(key => levelOf(ids[key]))), Array(5).fill('edit'), 'Descendants follow the widened ancestor grant.');
    rootGrants[0].level = 'edit';
    const changed = await rows();
    assert.deepEqual(Object.fromEntries(['a', 'b', 'c', 'f', 'd'].map(key => [key, changed[key]])), Object.fromEntries(['a', 'b', 'c', 'f', 'd'].map(key => [key, before[key]])), 'No descendant row is written when an ancestor grant changes.');

    // Reader-safe provenance: a person who may manage a descendant but cannot read
    // the restricting ancestor sees neither its title nor its identifier.
    const document = (await api(`/api/pages/${ids.b}`)).page;
    await mutate(`/api/sharing/pages/${ids.b}/inheritance`, { expectedRevisionId: document.revisionId, restricted: true }, 'PUT');
    await grant(ids.f, 'member', 'browser-reader', 'full');
    const safe = await call(reader, origin, 'GET', `/api/sharing/pages/${ids.f}`);
    assert.equal(safe.status, 200);
    assert.deepEqual(safe.body.restriction, { scope: 'ancestor', id: null, name: 'Restricted ancestor' });
    assert.ok(safe.body.inheritedItems.length && safe.body.inheritedItems.every(item => item.origin.id === null && item.origin.name === 'Restricted ancestor'));
    assert.ok(!JSON.stringify(safe.body).includes('Chain B') && !JSON.stringify(safe.body).includes(ids.b), 'The unreadable ancestor is not disclosed.');
    assert.equal((await call(reader, origin, 'GET', `/api/sharing/pages/${ids.c}`)).status, 404, 'A sibling the reader cannot manage stays hidden.');
  } finally { await reader.close(); }
}
