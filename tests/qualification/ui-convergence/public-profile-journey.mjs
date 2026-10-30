import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {expect} from '@playwright/test';
import {root} from '../../e2e/runtime-harness.mjs';
import {openPageAction} from './browser-support.mjs';
import {call, ok} from './two-people-support.mjs';

/** Real profile controls and anonymous reads over the emitted native Worker. */
export async function publicProfileJourney(state) {
  const {page, context, origin, api} = state;
  const directory = path.join(root, '.artifacts/ui-convergence/public-profile', String(page.viewportSize().width));
  await mkdir(directory, {recursive:true});
  const original = (await api('/api/workspace')).policies['page.public-access.v1'];
  const profile = async value => {
    await page.goto(origin + '/app/settings', {waitUntil:'networkidle'});
    await page.getByRole('button', {name:'Edit workspace & policies', exact:true}).click();
    const dialog = page.getByRole('dialog', {name:'Workspace settings', exact:true});
    await dialog.locator('select[name="page.public-access.v1"]').selectOption(value);
    await dialog.getByRole('button', {name:'Save settings', exact:true}).click();
    await expect(dialog).not.toBeVisible();
    assert.equal((await api('/api/workspace')).policies['page.public-access.v1'], value);
  };
  const container = (await api('/api/containers')).items.find(item => item.visibility !== 'personal');
  const created = await ok(context, origin, 'POST', '/api/pages', {
    operationKey:crypto.randomUUID(), containerId:container.id, title:'Synthetic public profile page',
  });
  const id = created.value.pageId;
  const read = async () => (await api(`/api/publishing/${id}`)).exposure;
  const showSettings = async () => {
    // Reload retains the panel in the route. Opening it again would close it.
    if (!await page.locator('.publication-settings').isVisible()) await openPageAction(page, 'Public access');
    await expect(page.locator('.publication-settings')).toBeVisible();
  };
  const open = async () => {
    await page.goto(`${origin}/app/pages/${id}`, {waitUntil:'networkidle'});
    await showSettings();
  };
  const post = (data, who=context) => call(who, origin, 'POST', `/api/publishing/${id}`, data);
  const slug = 'synthetic-slate-public-profile';
  const publicUrl = `${origin}/p/${slug}`;
  const anonymous = async (status, indexable=false) => {
    const response = await fetch(publicUrl);
    assert.equal(response.status, status);
    const html = await response.text();
    if (status === 200) {
      assert.match(html, /Synthetic public profile page/);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('x-robots-tag'), indexable ? 'index,follow' : 'noindex,nofollow');
      assert.match(html, /dark/);
    } else assert.doesNotMatch(html, /Synthetic public profile page/);
  };
  try {
    await profile('site');
    await open();
    await page.getByRole('button', {name:'Set up public page', exact:true}).click();
    const dialog = page.getByRole('dialog', {name:'Public page settings', exact:true});
    // This inventory is the user's editable exposure, not a pin of unrelated copy.
    assert.deepEqual(await dialog.locator('input, select, textarea').evaluateAll(items => items.map(item => item.name)),
      ['host','slug','theme','indexable','duplicate','header','header','header','socialTitle','socialDescription']);
    await expect(dialog.getByLabel('Host', {exact:true})).toHaveValue(new URL(origin).host);
    await dialog.getByLabel('Public address', {exact:true}).fill(slug);
    await dialog.locator('select[name="theme"]').selectOption('dark');
    await dialog.locator('input[name="duplicate"]').check();
    await dialog.locator('input[name="header"][value="search"]').check();
    await dialog.locator('input[name="header"][value="duplicate"]').check();
    await dialog.getByLabel('Social preview title', {exact:true}).fill('Synthetic public preview');
    await dialog.getByLabel('Social preview description', {exact:true}).fill('Retained exposure description');
    await page.screenshot({path:path.join(directory,'site-settings.png'), fullPage:true});
    await dialog.getByRole('button', {name:'Save public page', exact:true}).click();
    await expect(dialog).not.toBeVisible();
    const native = await read();
    assert.equal(native.slug, slug);
    assert.equal(native.theme, 'dark');
    assert.equal(native.duplicateAsTemplate, true);
    assert.deepEqual(native.headerControls, ['search','duplicate']);
    assert.deepEqual(native.socialPreview, {title:'Synthetic public preview',description:'Retained exposure description'});
    await expect(page.getByRole('complementary', {name:'Live public site', exact:true})).toBeVisible();
    await page.screenshot({path:path.join(directory,'site-banner.png'), fullPage:true});
    await anonymous(200);

    // The import boundary can retain metadata unknown to today's settings form.
    // Only this stored import fixture is substituted; saves and reads remain native.
    const importedPreview = {...native.socialPreview, image:'synthetic-slate-import-image'};
    await state.fixtureSql([`UPDATE public_exposures SET social_preview_json='${JSON.stringify(importedPreview)}' WHERE page_id='${id}'`]);
    const retained = await read();
    const pageBefore = await api(`/api/pages/${id}`);
    const grantsBefore = await api(`/api/sharing/pages/${id}`);
    const versionsBefore = await api(`/api/revisions/${id}`);
    await profile('link');

    // A page with no exposure can be published directly with the one toggle.
    const freshId = (await ok(context, origin, 'POST', '/api/pages', {
      operationKey:crypto.randomUUID(), containerId:container.id, title:'Synthetic link-only page',
    })).value.pageId;
    await page.goto(`${origin}/app/pages/${freshId}`, {waitUntil:'networkidle'});
    await showSettings();
    const linkSwitch = page.getByRole('switch', {name:'Public link', exact:true});
    await expect(linkSwitch).not.toBeChecked();
    assert.equal((await api(`/api/publishing/${freshId}`)).exposure, null);
    await linkSwitch.click();
    await expect(linkSwitch).toBeChecked();
    const fresh = (await api(`/api/publishing/${freshId}`)).exposure;
    assert.ok(fresh.slug);
    assert.equal(fresh.host, new URL(origin).host);
    assert.equal(fresh.indexable, false);
    assert.ok(fresh.theme);
    assert.deepEqual(fresh.headerControls, []);
    assert.equal(fresh.duplicateAsTemplate, false);
    assert.deepEqual(fresh.socialPreview, {});
    assert.equal(fresh.revokedAt, null);
    const freshUrl = `${origin}/p/${fresh.slug}`;
    await expect(page.getByRole('link', {name:freshUrl, exact:true})).toHaveAttribute('href', freshUrl);
    const freshResponse = await fetch(freshUrl);
    assert.equal(freshResponse.status, 200);
    assert.match(await freshResponse.text(), /Synthetic link-only page/);
    await linkSwitch.click();
    await expect(linkSwitch).not.toBeChecked();
    await expect.poll(async () => (await fetch(freshUrl)).status).toBe(404);

    await open();
    const settings = page.locator('.publication-settings');
    await expect(page.getByRole('complementary', {name:'Live public site', exact:true})).toHaveCount(0);
    await expect(settings.getByRole('switch', {name:'Public link', exact:true})).toBeChecked();
    assert.deepEqual(await settings.locator('input, select, textarea').evaluateAll(items => items.map(item => item.type)), ['checkbox','checkbox']);
    await expect(settings.getByRole('link', {name:publicUrl, exact:true})).toHaveAttribute('href', publicUrl);
    await expect(settings.getByRole('button')).toHaveText(['Stop public access']);
    await page.screenshot({path:path.join(directory,'link-settings.png'), fullPage:true});
    const indexing = settings.getByRole('checkbox', {name:'Allow search engines to index this page', exact:true});
    await indexing.click();
    await expect.poll(read).toEqual({...retained,indexable:true});
    await anonymous(200, true);
    await page.reload({waitUntil:'networkidle'});
    await showSettings();
    await expect(indexing).toBeChecked();
    await indexing.click();
    await expect.poll(read).toEqual(retained);
    await anonymous(200);

    const reader = await context.browser().newContext();
    try {
      await reader.addCookies([{name:'slate_session',value:state.readerCookie.split('=')[1],url:origin}]);
      const denied = await post({operationKey:crypto.randomUUID(),expectedRevisionId:pageBefore.page.revisionId,host:retained.host,slug,revoke:true}, reader);
      assert.ok([403,404].includes(denied.status));
      assert.deepEqual(await read(), retained, 'A reader cannot change public exposure.');
      await anonymous(200);
    } finally { await reader.close(); }
    await settings.getByRole('button', {name:'Stop public access', exact:true}).click();
    const revoke = page.getByRole('dialog', {name:'Stop public access?', exact:true});
    await revoke.getByRole('button', {name:'Stop public access', exact:true}).click();
    await expect(revoke).not.toBeVisible();
    await expect(settings.getByRole('switch', {name:'Public link', exact:true})).not.toBeChecked();
    await anonymous(404);
    await settings.getByRole('switch', {name:'Public link', exact:true}).click();
    await expect.poll(read).toEqual(retained);
    await anonymous(200);
    await settings.getByRole('switch', {name:'Public link', exact:true}).click();
    await expect.poll(async () => !!(await read()).revokedAt).toBe(true);
    await anonymous(404);
    await settings.getByRole('switch', {name:'Public link', exact:true}).click();
    await expect.poll(read).toEqual(retained);

    await profile('site');
    await open();
    await expect(page.getByRole('complementary', {name:'Live public site', exact:true})).toBeVisible();
    await page.getByRole('button', {name:'Edit public settings', exact:true}).click();
    await expect(dialog.getByLabel('Public address', {exact:true})).toHaveValue(slug);
    await expect(dialog.locator('select[name="theme"]')).toHaveValue('dark');
    await expect(dialog.locator('input[name="duplicate"]')).toBeChecked();
    await expect(dialog.locator('input[name="header"][value="search"]')).toBeChecked();
    await expect(dialog.locator('input[name="header"][value="duplicate"]')).toBeChecked();
    await expect(dialog.getByLabel('Social preview title', {exact:true})).toHaveValue(importedPreview.title);
    await dialog.getByRole('button', {name:'Cancel', exact:true}).click();
    assert.deepEqual(await read(), retained);
    assert.equal((await api(`/api/pages/${id}`)).page.revisionId, pageBefore.page.revisionId);
    assert.deepEqual((await api(`/api/pages/${id}`)).blocks, pageBefore.blocks);
    assert.deepEqual(await api(`/api/sharing/pages/${id}`), grantsBefore);
    assert.deepEqual(await api(`/api/revisions/${id}`), versionsBefore);
    await anonymous(200);
    await writeFile(path.join(directory,'results.json'), JSON.stringify({passed:true,id,before:retained,after:await read(),points:[1,2,3,4]},null,2));
  } finally { await profile(original); }
}
