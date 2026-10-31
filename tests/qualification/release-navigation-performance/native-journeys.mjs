import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium, expect} from '@playwright/test';
import {createRuntime} from '../local/runtime.mjs';
import {fixtureFirstOwner} from '../local/first-owner.mjs';
import {actorChecks} from './native-permissions.mjs';

const checks = [], requests = [];
let runtime, browser, page;
try {
  runtime = await createRuntime({root: process.cwd(), evidence: process.env.QUAL_EVIDENCE, appPort: 59802, inspectorPort: 59803});
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  ({page} = await fixtureFirstOwner(runtime, context));
  const read = async pathname => {
    const response = await context.request.get(runtime.origin+pathname);
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const post = async (pathname, data) => {
    const response = await context.request.post(runtime.origin+pathname, {data: {operationKey: randomUUID(), ...data}});
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const initial = (await read('/api/pages')).items[0];
  const parent = (await post('/api/pages', {containerId: initial.containerId, title: 'Navigation parent'})).value.pageId;
  const leaf = (await post('/api/pages', {containerId: initial.containerId, title: 'Navigation leaf'})).value.pageId;
  const child = (await post('/api/pages', {containerId: initial.containerId, parentPageId: parent, title: 'Navigation child'})).value.pageId;
  page.on('request', request => {const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push({path: url.pathname, method: request.method()});});
  const tree = page.getByRole('navigation', {name: 'Pages', exact: true});
  const link = name => tree.getByRole('link', {name, exact: true});
  const countTree = () => requests.filter(r => r.path === '/api/pages' && r.method === 'GET').length;
  const expansionReads = id => requests.filter(r => r.path === `/api/pages/${id}/expansion` && r.method === 'GET').length;
  const invalidate = () => page.evaluate(() => window.dispatchEvent(new Event('slate:navigation-changed')));
  await page.goto(runtime.origin+'/app/pages/'+parent);
  await page.waitForLoadState('networkidle');
  assert.equal(countTree(), 1);
  assert.equal(expansionReads(leaf), 0);
  assert.equal(expansionReads(child), 0);
  await page.getByTestId('nav-workspace').click();
  await page.waitForURL(url => url.pathname === '/app');
  await expect(page.locator('.personal-home > section').first().getByRole('link', {name: 'Navigation parent', exact: true})).toBeVisible();
  await page.goBack();
  await page.waitForURL(url => url.pathname === '/app/pages/'+parent);
  await expect(page.getByRole('textbox', {name: 'Page title', exact: true})).toHaveValue('Navigation parent');
  checks.push('Native page open updates recents with one unchanged-tree read and no leaf expansion reads');

  await tree.getByRole('button', {name: 'Expand Navigation parent', exact: true}).click();
  await expect(link('Navigation child')).toBeVisible();
  assert.equal((await read(`/api/pages/${parent}/expansion`)).expanded, true);
  await page.reload();
  await expect(link('Navigation child')).toBeVisible();
  await page.waitForLoadState('networkidle');
  assert.equal(expansionReads(child), 0);
  checks.push('Parent expansion persists in native server state across reload; rendered child remains a true leaf');

  // A genuine stored preference is ignored while a node has no children, then read when it gains one.
  await post(`/api/pages/${leaf}/expansion`, {expanded: true});
  await post('/api/pages', {containerId: initial.containerId, parentPageId: leaf, title: 'New leaf child'});
  const beforeGain = countTree();
  await invalidate();
  await expect(link('New leaf child')).toBeVisible();
  assert.equal(countTree(), beforeGain+1);
  assert.equal(expansionReads(leaf), 1);
  checks.push('Explicit tree invalidation discovers a leaf gaining a child and reads its stored expansion');

  const oldReads = countTree();
  await page.getByRole('textbox', {name: 'Page title', exact: true}).fill('Renamed navigation parent');
  await page.getByRole('button', {name: 'More', exact: true}).click();
  await page.keyboard.press('Escape');
  await expect(link('Renamed navigation parent')).toBeVisible();
  assert.equal(countTree(), oldReads+1);
  assert.equal((await read('/api/pages/'+parent)).page.title, 'Renamed navigation parent');
  checks.push('Native rename still invalidates and refreshes the page tree');

  await link('Renamed navigation parent').hover();
  await tree.getByRole('button', {name: 'Create child of Renamed navigation parent', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Blank page', exact: true}).click();
  await page.waitForURL(url => url.pathname.startsWith('/app/pages/') && !url.pathname.endsWith(parent));
  const childTitle = page.getByRole('textbox', {name: 'Page title', exact: true});
  await expect(childTitle).toBeFocused();
  await page.keyboard.type('UI created child');
  await childTitle.press('Tab');
  await expect(link('UI created child')).toBeVisible();
  const createdId = new URL(page.url()).pathname.split('/').at(-1);
  assert.equal((await read('/api/pages/'+createdId)).parentPageId, parent);
  checks.push('Native child creation appears under its persisted parent');

  await link('UI created child').hover();
  await tree.getByRole('button', {name: 'Move UI created child in tree', exact: true}).click();
  const move = page.getByRole('dialog');
  await move.getByLabel('Parent page', {exact: true}).selectOption(leaf);
  await move.getByRole('button', {name: 'Review access changes', exact: true}).click();
  await move.getByRole('button', {name: 'Confirm tree move', exact: true}).click();
  await move.waitFor({state: 'hidden'});
  await expect(link('UI created child')).toBeVisible();
  assert.equal((await read('/api/pages/'+createdId)).parentPageId, leaf);
  checks.push('Native reviewed tree move refreshes and renders its new persisted parent');

  await page.getByRole('button', {name: 'More', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Move to trash', exact: true}).click();
  const trash = page.getByRole('dialog', {name: 'Move this page to trash?', exact: true});
  await trash.getByRole('button', {name: 'Confirm', exact: true}).click();
  await expect(link('UI created child')).toHaveCount(0);
  assert.ok(!(await read('/api/pages')).items.some(item => item.id === createdId));
  checks.push('Native trash mutation invalidates the page tree and removes its row');

  await page.goto(runtime.origin+'/app/pages/'+parent);
  await page.waitForLoadState('networkidle');
  await page.screenshot({path: runtime.directory+'/navigation-desktop.jpg'});
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Open navigation', exact: true}).click();
  await expect(link('Navigation child')).toBeVisible();
  await page.screenshot({path: runtime.directory+'/navigation-mobile.jpg'});
  await actorChecks({runtime, browser, context, page, parent, child, checks});
  await writeFile(runtime.directory+'/result.json', JSON.stringify({passed: true, checks, requests, artifact: runtime.artifact.artifactHash}, null, 2));
  console.log(JSON.stringify({passed: true, checks, evidence: runtime.directory}, null, 2));
} catch (error) {
  if (runtime) await writeFile(runtime.directory+'/result.json', JSON.stringify({passed: false, checks, requests, error: error.stack}, null, 2));
  throw error;
} finally {await browser?.close(); await runtime?.close();}
