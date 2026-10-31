import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect } from '@playwright/test';
import { openNavigation } from './browser-support.mjs';
import { accessible } from './browser-evidence.mjs';
import { call, grant, ok, restrictedPage } from './two-people-support.mjs';

// Two real, distinct PNGs; only the external image origin is substituted.
function image(red, green, blue) {
  const chunk = (type, bytes) => {
    const data = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
const images = [image(180, 80, 40), image(30, 90, 150)];
const appearance = value => ({ icon: value.icon ?? null, cover: value.cover ?? null, coverFileId: value.coverFileId ?? null });

/** Native controls, receipts, current-reader projections, stored bytes and rendered sources. */
export async function pageAppearanceJourney(state, people) {
  const { page, context, origin, api } = state, { bob } = people;
  const width = page.viewportSize().width;
  const workspace = await api('/api/workspace');
  const profile = async lifecycle => {
    const current = await api('/api/workspace');
    const { name, mark, description, guestAccess, publicLinkAccess, anonymousAccess } = current;
    await ok(context, origin, 'PUT', '/api/workspace', { operationKey: randomUUID(), expectedRevisionId: current.revisionId,
      name, mark, description, guestAccess, publicLinkAccess, anonymousAccess, policies: { ...current.policies, 'page.lifecycle.v1': lifecycle } });
  };
  await profile('always-live');
  const { pageId } = await restrictedPage(state, 'Appearance atlas', ['The ordinary page body remains readable with any appearance.']);
  const readerGrant = await grant(context, origin, pageId, bob.id, 'view');
  const route = `/api/pages/${pageId}`, url = `${origin}/app/pages/${pageId}`;
  const read = (person = people.alice) => ok(person.context, origin, 'GET', route);
  const originalBlocks = (await read()).blocks;
  const uploads = new Map(), remoteRequests = [], galleryBackgrounds = new Map();
  for (const person of [people.alice, bob]) await person.context.route('https://appearance.invalid/**', async request => {
    remoteRequests.push({ url: request.request().url(), referer: request.request().headers().referer });
    await request.fulfill({ status: 200, contentType: 'image/png', body: images[0] });
  });
  const remoteA = 'https://appearance.invalid/first.png', remoteB = 'https://appearance.invalid/second.png';
  let expected = { icon: null, cover: null, coverFileId: null };
  async function edit(kind, source, value) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^(Add|Change) ${kind}$`) }).click();
    const dialog = page.getByRole('dialog', { name: kind === 'icon' ? 'Page icon' : 'Page cover', exact: true });
    if (source === 'remove') await dialog.getByLabel(`Remove ${kind}`, { exact: true }).check();
    else {
      await dialog.getByLabel(kind === 'icon' ? 'Icon source' : 'Cover source', { exact: true }).selectOption(source);
      if (source === 'upload') await dialog.getByLabel('Image', { exact: true }).setInputFiles({ name: `synthetic-slate-${kind}-${value}.png`, mimeType: 'image/png', buffer: images[value] });
      else if (source === 'symbols') await dialog.getByLabel('Supplied icon', { exact: true }).selectOption(value);
      else if (kind === 'icon') await dialog.getByLabel('Icon', { exact: true }).fill(value);
      else if (source === 'gallery') await dialog.getByLabel('Gallery', { exact: true }).selectOption(value);
      else await dialog.getByLabel('Cover HTTPS link', { exact: true }).fill(value);
    }
    const committed = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === route);
    const uploaded = source === 'upload' ? page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/media') : null;
    await dialog.getByRole('button', { name: 'Save appearance', exact: true }).click();
    const response = await committed;
    assert.equal(response.status(), 200, await response.text());
    const receipt = await response.json();
    await expect(dialog).toBeHidden();
    const current = await read();
    assert.equal(current.page.revisionId, receipt.value.revisionId, 'The native mutation receipt names the stored revision.');
    let fileId;
    if (uploaded) {
      const upload = await uploaded;
      assert.equal(upload.status(), 200, await upload.text());
      fileId = (await upload.json()).value.id;
      uploads.set(fileId, images[value]);
    }
    if (kind === 'icon') expected.icon = source === 'remove' ? null : source === 'upload' ? `file:${fileId}` : value;
    else {
      expected.coverFileId = source === 'upload' ? fileId : null;
      expected.cover = source === 'gallery' ? { kind: 'gallery', id: value } : source === 'link' ? { kind: 'link', url: value } : null;
    }
    assert.deepEqual(appearance(current.properties), expected, 'Changing one appearance preserves the other and replaces the previous source.');
    assert.deepEqual(current.blocks, originalBlocks, 'Appearance never changes the ordinary page body.');
    return fileId;
  }
  async function rendered(scope, selected) {
    const icons = scope.locator('.stored-page-icon');
    if (!selected.icon) await expect(icons).toHaveCount(0);
    else if (selected.icon.startsWith('file:')) {
      await expect(icons).toHaveAttribute('src', `/api/media/${selected.icon.slice(5)}?display=icon`);
      await expect.poll(() => icons.evaluate(element => element.complete && element.naturalWidth)).toBe(1);
    } else await expect(icons).toHaveText(selected.icon);
    const covers = scope.locator('.page-cover-image, .page-cover-thumbnail');
    if (selected.coverFileId) {
      await expect(covers).toHaveAttribute('src', `/api/media/${selected.coverFileId}?display=cover`);
      await expect.poll(() => covers.evaluate(element => element.complete && element.naturalWidth)).toBe(1);
    } else if (selected.cover?.kind === 'gallery') {
      await expect(covers).toHaveAttribute('aria-label', `${selected.cover.id} gallery cover`);
      const background = await covers.evaluate(element => getComputedStyle(element).backgroundImage);
      assert.match(background, /linear-gradient/);
      if (galleryBackgrounds.has(selected.cover.id)) assert.equal(background, galleryBackgrounds.get(selected.cover.id));
      else {
        for (const other of galleryBackgrounds.values()) assert.notEqual(background, other, 'Replacing the selected gallery changes the rendered source.');
        galleryBackgrounds.set(selected.cover.id, background);
      }
    } else if (selected.cover?.kind === 'link') {
      await expect(covers).toHaveCount(0);
      const load = scope.getByRole('button', { name: 'Load cover from appearance.invalid', exact: true });
      await expect(load).toBeVisible();
      const before = remoteRequests.length;
      const firstLoad = !remoteRequests.some(request => request.url === selected.cover.url);
      await load.click();
      await expect(covers).toHaveAttribute('src', selected.cover.url);
      await expect.poll(() => covers.evaluate(element => element.complete && element.naturalWidth)).toBe(1);
      // Chromium can reuse a decoded image between two surfaces in one document.
      // The first load must reach the edge; every surface must first show its gate.
      if (firstLoad) assert.equal(remoteRequests.length, before + 1);
      assert.ok(remoteRequests.some(request => request.url === selected.cover.url));
      assert.ok(remoteRequests.every(request => request.referer === undefined), 'The external image receives no page address.');
    } else {
      await expect(covers).toHaveCount(0);
      await expect(scope.locator('.page-cover-load')).toHaveCount(0);
    }
  }
  async function verify(selected, person = people.alice, capture = false) {
    const view = person.page;
    await view.goto(url, { waitUntil: 'networkidle' });
    await view.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(appearance((await read(person)).properties), selected);
    await rendered(view.locator('.page-appearance'), selected);
    await expect(view.locator('[data-page-editor]')).toContainText('The ordinary page body remains readable');
    if (capture) await accessible(view, `page appearance ${person.name}`);
    const tree = (await ok(person.context, origin, 'GET', '/api/pages')).items.find(item => item.id === pageId);
    assert.ok(tree); assert.deepEqual(appearance(tree), selected, 'The canonical tree selects this reader’s revision.');
    await openNavigation(view);
    const row = view.locator('.tree-row').filter({ has: view.locator(`a[href="/app/pages/${pageId}"]`) }).first();
    await expect(row).toBeVisible();
    await rendered(row, selected);
    if (capture) await accessible(view, `page appearance tree ${person.name}`);
    const search = await ok(person.context, origin, 'GET', '/api/search?q=Appearance%20atlas&kind=page');
    assert.equal(search.total, 1); assert.equal(search.items[0].id, pageId);
    assert.deepEqual(appearance(search.items[0]), selected, 'The search projection selects this reader’s revision.');
    await view.goto(`${origin}/app/search?q=Appearance%20atlas&kind=page`, { waitUntil: 'networkidle' });
    const result = view.locator('.search-results > li').filter({ has: view.getByRole('heading', { name: 'Appearance atlas', exact: true }) });
    await expect(result).toBeVisible();
    await rendered(result, selected);
    if (capture) await accessible(view, `page appearance search ${person.name}`);
    for (const [id, disposition] of [[selected.icon?.startsWith('file:') ? selected.icon.slice(5) : null, 'icon'], [selected.coverFileId, 'cover']]) {
      if (!id) continue;
      const response = await person.context.request.get(`${origin}/api/media/${id}?display=${disposition}`);
      assert.equal(response.status(), 200); assert.match(response.headers()['content-disposition'], /^inline/);
      assert.equal(response.headers()['content-type'], 'image/png'); assert.equal(response.headers()['x-content-type-options'], 'nosniff');
      assert.deepEqual(await response.body(), uploads.get(id), 'The authorized response contains the selected upload’s exact bytes.');
    }
    await page.goto(url, { waitUntil: 'networkidle' });
  }
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await verify(expected);
    for (const icon of ['📚', '🧭']) { await edit('icon', 'gallery', icon); await verify(expected); }
    for (const cover of ['ocean', 'forest']) { await edit('cover', 'gallery', cover); await verify(expected); }
    for (const icon of ['◆', '✦']) { await edit('icon', 'symbols', icon); await verify(expected); }
    const iconA = await edit('icon', 'upload', 0); await verify(expected);
    const iconB = await edit('icon', 'upload', 1); await verify(expected);
    await edit('cover', 'upload', 0); await verify(expected);
    const coverB = await edit('cover', 'upload', 1); await verify(expected, people.alice, true);
    await edit('cover', 'link', remoteA);
    assert.equal(remoteRequests.length, 0, 'Saving external descriptors fetches no external image.');
    await rendered(page.locator('.page-appearance'), expected);
    await edit('cover', 'link', remoteB);
    await expect(page.locator('.page-appearance').getByRole('button', { name: 'Load cover from appearance.invalid', exact: true })).toBeVisible();
    assert.equal(remoteRequests.filter(request => request.url === remoteB).length, 0, 'Replacing a loaded remote cover requires fresh consent.');
    await rendered(page.locator('.page-appearance'), expected);
    await verify(expected, people.alice, true);
    await edit('cover', 'upload', 1); await verify(expected);
    await edit('icon', 'remove'); await verify(expected);
    await edit('icon', 'gallery', '📚'); await edit('cover', 'remove'); await verify(expected);
    await edit('icon', 'remove'); await verify(expected, people.alice, true);
    assert.deepEqual(expected, { icon: null, cover: null, coverFileId: null });
    console.log(`PROBE PAGE-006 1: native remove controls, reload, tree and search at ${width} -> icon and cover removed independently; ordinary body retained with neither`);

    // A read-only member keeps the published appearance while the editor changes it.
    await edit('icon', 'upload', 0); await edit('cover', 'gallery', 'ocean');
    const published = { ...expected };
    await verify(published, bob);
    await profile('draft-then-publish');
    await edit('icon', 'upload', 1); const privateIcon = expected.icon.slice(5);
    await edit('cover', 'upload', 1); const privateCover = expected.coverFileId;
    await verify(expected, people.alice);
    await verify(published, bob, true);
    for (const id of [privateIcon, privateCover]) {
      const refused = await bob.context.request.get(`${origin}/api/media/${id}?display=cover`);
      assert.equal(refused.status(), 404, 'Unpublished uploaded bytes remain unavailable to the published reader.');
    }
    const before = await read();
    const refused = await call(bob.context, origin, 'PATCH', route, { operationKey: randomUUID(), expectedRevisionId: before.page.revisionId, properties: { icon: null, cover: null, coverFileId: null } });
    assert.equal(refused.status, 404); assert.deepEqual(await read(), before, 'A view-only mutation changes nothing.');
    await ok(context, origin, 'POST', '/api/sharing', { operationKey: randomUUID(), id: readerGrant.value.id, targetKind: 'page', targetId: pageId, principalKind: 'member', principalId: bob.id, level: 'view', revoke: true });
    assert.equal((await call(bob.context, origin, 'GET', route)).status, 404);
    const tree = await ok(bob.context, origin, 'GET', '/api/pages');
    assert.equal(tree.items.some(item => item.id === pageId), false);
    assert.equal((await ok(bob.context, origin, 'GET', '/api/search?q=Appearance%20atlas')).total, 0);
    assert.equal((await bob.context.request.get(`${origin}/api/media/${published.icon.slice(5)}?display=icon`)).status(), 404);
    console.log(`PROBE PAGE-006 2: native appearance controls at ${width} -> emoji, supplied symbols, gallery, uploads and links replace and render after reload in page, tree and search; exact media bytes, interaction gates and current-reader refusals pass`);
    assert.ok(iconA !== iconB && coverB !== iconB);
  } finally {
    await profile(workspace.policies['page.lifecycle.v1']);
    for (const person of [people.alice, bob]) await person.context.unroute('https://appearance.invalid/**');
  }
}
