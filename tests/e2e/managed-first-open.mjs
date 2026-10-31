import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { inbox, newOutboxLink } from './outbox-auth.mjs';

/** RER's bootstrap request, then the owner's own email sign-in and first edit. */
export async function managedFirstOpen(origin, token, email = ['owner', 'example.test'].join('@')) {
  const anonymousSetup = await fetch(origin + '/setup', { redirect: 'manual' });
  assert.equal(anonymousSetup.status, 302);
  assert.equal(new URL(anonymousSetup.headers.get('location'), origin).pathname, '/signin');
  assert.equal((await fetch(origin + '/api/workspace/first-run', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ operationKey: randomUUID(), workspaceName: 'Refused', containerName: 'Refused', pageTitle: 'Refused' }) })).status, 401);
  const claim = await fetch(origin + '/auth/bootstrap', {
    method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token, displayName: 'Owner', returnTo: '/' }),
  });
  assert.equal(claim.status, 303, 'RER claims the native owner');
  const replay = await fetch(origin + '/auth/bootstrap', {
    method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token, displayName: 'Owner', returnTo: '/' }),
  });
  assert.equal(replay.status, 409, 'The claim cannot replace an existing workspace');
  const shots = process.env.SLATE_OWNER_SHOTS;
  if (shots) await mkdir(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 } });
      try {
        const page = await context.newPage();
        const shot = async name => {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (shots) await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
        };
        await page.goto(origin + '/', { waitUntil: 'networkidle' });
        assert.equal(await page.getByRole('link', { name: 'Finish setup' }).count(), 0);
        await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
        await shot('claimed');
        await page.goto(origin + '/signin?login_hint=' + encodeURIComponent(email), { waitUntil: 'networkidle' });
        assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), email);
        await shot('first-open');
        const before = await inbox(origin);
        await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
        await page.getByRole('heading', { name: 'Check your email' }).waitFor();
        // The address is a separate inline element; its preceding text must end in whitespace.
        assert.match(await page.locator('.paper-sent strong').evaluate(node => node.previousSibling.textContent), /\s$/);
        await shot('email-sent');
        await page.goto(await newOutboxLink(origin, before));
        await page.getByRole('button', { name: 'Confirm', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/app');
        const api = async url => { const response = await context.request.get(origin + url); assert.equal(response.status(), 200); return response.json(); };
        assert.equal((await api('/api/session')).member.email, email);
        assert.equal((await api('/api/workspace/first-run')).required, false);
        const workspace = await api('/api/workspace');
        assert.equal(workspace.name, 'Slate');
        const spaces = (await api('/api/containers')).items.filter(item => item.visibility !== 'personal');
        assert.equal(spaces.length, 1);
        assert.equal(spaces[0].name, 'General');
        await shot('workspace-ready');
        const pages = (await api('/api/pages?containerId=' + spaces[0].id)).items;
        assert.equal(pages.length, 1);
        assert.equal(pages[0].title, 'Welcome');
        await page.goto(origin + '/app/pages/' + pages[0].id, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Welcome', exact: true }).waitFor();
        await shot('welcome-page');
        await page.goto(origin + '/setup', { waitUntil: 'networkidle' });
        await page.waitForURL(url => url.pathname === '/app');
        assert.equal(await page.getByRole('heading', { name: 'Name this workspace', exact: true }).count(), 0);
        await page.goto(origin + '/app/pages/' + pages[0].id, { waitUntil: 'networkidle' });
        const rename = await context.request.put(origin + '/api/workspace', {
          headers: { origin }, data: { operationKey: randomUUID(), expectedRevisionId: workspace.revisionId, name: 'Team notes', mark: workspace.mark, description: workspace.description, guestAccess: workspace.guestAccess, publicLinkAccess: workspace.publicLinkAccess, anonymousAccess: workspace.anonymousAccess, policies: workspace.policies },
        });
        assert.equal(rename.status(), 200, 'The default workspace remains owner-editable');
        assert.equal((await api('/api/workspace')).name, 'Team notes');
        const spaceRoute = '/api/containers/' + spaces[0].id;
        const space = await api(spaceRoute);
        const renameSpace = await context.request.patch(origin + spaceRoute, { headers: { origin }, data: { operationKey: randomUUID(), expectedRevisionId: space.revisionId, name: 'Team handbook' } });
        assert.equal(renameSpace.status(), 200);
        assert.equal((await api(spaceRoute)).name, 'Team handbook');
        const pageRoute = '/api/pages/' + pages[0].id;
        const document = await api(pageRoute);
        const renamePage = await context.request.patch(origin + pageRoute, { headers: { origin }, data: { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, properties: { title: 'Start here' } } });
        assert.equal(renamePage.status(), 200);
        const renamed = await api(pageRoute);
        assert.equal(renamed.page.title, 'Start here');
        const blockId = randomUUID();
        const edit = await context.request.put(origin + pageRoute + '/blocks', { headers: { origin }, data: { operationKey: randomUUID(), expectedRevisionId: renamed.page.revisionId, blocks: [{ id: blockId, blockType: 'paragraph', content: { text: [{ text: 'Our first notes' }] }, treePosition: 'a0' }] } });
        assert.equal(edit.status(), 200);
        const edited = await api(pageRoute);
        assert.equal(edited.blocks[0].id, blockId);
        assert.deepEqual(edited.blocks[0].content, { text: [{ text: 'Our first notes' }] });
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.getByRole('textbox', { name: 'Page title', exact: true }).inputValue(), 'Start here');
        const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
        const closed = await navigation.isVisible();
        if (closed) await navigation.click();
        await page.getByTestId('workspace-name').filter({ hasText: 'Team notes' }).waitFor();
        if (closed) await page.locator('.mobile-bar').getByRole('button', { name: 'Close navigation', exact: true }).click();
        await page.getByText('Our first notes', { exact: true }).waitFor();
        await shot('claimed-editable');
        // Return names through the same native doors so both responsive views
        // start from the canonical first-open state, with durable content.
        const current = await api('/api/workspace');
        assert.equal((await context.request.put(origin + '/api/workspace', { headers: { origin }, data: { operationKey: randomUUID(), expectedRevisionId: current.revisionId, name: 'Slate', mark: current.mark, description: current.description, guestAccess: current.guestAccess, publicLinkAccess: current.publicLinkAccess, anonymousAccess: current.anonymousAccess, policies: current.policies } })).status(), 200);
        assert.equal((await context.request.patch(origin + spaceRoute, { headers: { origin }, data: { operationKey: randomUUID(), expectedRevisionId: (await api(spaceRoute)).revisionId, name: 'General' } })).status(), 200);
        assert.equal((await context.request.patch(origin + pageRoute, { headers: { origin }, data: { operationKey: randomUUID(), expectedRevisionId: edited.page.revisionId, properties: { title: 'Welcome' } } })).status(), 200);
        assert.equal((await api('/api/containers')).items.filter(item => item.visibility !== 'personal').length, 1);
        assert.equal((await api('/api/pages?containerId=' + spaces[0].id)).items.length, 1);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
