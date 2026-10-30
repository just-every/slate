import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { applyMigrations, seedAuroraFixture, localDevelopmentVars, signInLocally, stop } from '../../e2e/runtime-harness.mjs';
import { startShellWorker } from './runtime.mjs';

// WORK-001/013, SEARCH-003/006, BASE-ACCESS-002/004, BASE-PUBLIC-003.
// Real local D1, native sessions, emitted Worker and browser. No provider calls.
for (const profile of ['core-wiki', 'flagship']) {
  test(`${profile}: current identity, required first use, returning search and keyboard history`, { timeout: 240000 }, async () => {
    const state = await mkdtemp(path.join(os.tmpdir(), 'slate-shell-'));
    let runtime, browser, page;
    const failures = [];
    try {
      await applyMigrations(state);
    await seedAuroraFixture(state);
      runtime = await startShellWorker(state, { ...localDevelopmentVars, ...(profile === 'flagship' ? { SLATE_PROFILE: profile } : {}) });
      const { cookie, body: { member } } = await signInLocally(runtime.baseUrl);
      const api = async (route, init = {}) => fetch(runtime.baseUrl + route, { ...init, headers: { cookie, origin: runtime.baseUrl, ...init.headers } });
      const initial = await (await api('/app')).text();
      // Setup names the signed-in owner by address; the workspace has no name of its own until step 1.
      assert.ok(initial.includes(`data-testid="member-email"`) && initial.includes(member.email));
      assert.ok(initial.includes('Name this workspace'));
      assert.equal((await (await api('/api/workspace/first-run')).json()).required, true);
      assert.equal((await (await api('/api/profile')).json()).profile, profile);
      browser = await chromium.launch();
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const [name, value] = cookie.split('=');
      await context.addCookies([{ name, value, url: runtime.baseUrl }]);
      page = await context.newPage();
      const calls = [];
      page.on('pageerror', error => failures.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
      page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
      page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
      page.on('request', request => { if (request.url().includes('/_serverFn/')) calls.push(request.url()); });
      const capture = async label => {
        if (!process.env.SHELL_EVIDENCE) return;
        await mkdir(process.env.SHELL_EVIDENCE, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SHELL_EVIDENCE, `${profile}-${label}.jpg`), fullPage: true, type: 'jpeg', quality: 85 });
      };
      await page.goto(runtime.baseUrl + '/app', { waitUntil: 'networkidle' });
      assert.equal(await page.getByText(member.email, { exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Create', exact: true }).count(), 0);
      await capture('first-use-desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.getByText(member.email, { exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await capture('first-use-mobile');
      const origin = await page.evaluate(() => performance.timeOrigin);
      await page.locator('header a[href="/"]').click();
      await page.getByRole('heading', { name: 'Slate', exact: true }).waitFor();
      await page.goBack();
      await page.getByRole('heading', { name: 'Name this workspace', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
      assert.ok(calls.length > 0);
      await page.getByLabel('Your name', { exact: true }).fill('Alex Owner');
      await page.getByLabel('Workspace name', { exact: true }).fill('Shell qualification workspace');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true);
      // A reload of /setup keeps the step and what was typed.
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('textbox', { name: 'Space name', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      assert.equal(await page.getByLabel('Workspace name', { exact: true }).inputValue(), 'Shell qualification workspace');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('textbox', { name: 'Space name', exact: true }).fill('Shell qualification space');
      await page.getByLabel('First page title', { exact: true }).fill('Shell qualification page');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Email addresses', { exact: true }).fill('invalid');
      await page.getByRole('button', { name: 'Send the invitations and finish', exact: true }).click();
      await page.getByText('Check each email address before continuing.', { exact: true }).waitFor();
      assert.equal((await (await api('/api/workspace/first-run')).json()).required, true);
      await page.getByLabel('Email addresses', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Skip this step', exact: true }).click();
      await page.waitForURL('**/app/pages/*');
      await page.waitForLoadState('networkidle');
      assert.equal((await (await api('/api/workspace/first-run')).json()).required, false);
      const containers = (await (await api('/api/containers')).json()).items;
      assert.equal(containers.filter(item => item.visibility !== 'personal').length, 1);
      assert.equal((await (await api('/api/pages')).json()).items.length, 1);
      assert.equal((await (await api('/api/workspace')).json()).name, 'Shell qualification workspace');
      await page.goto(runtime.baseUrl + '/app', { waitUntil: 'networkidle' });
      assert.equal(await page.getByRole('heading', { name: 'Name this workspace', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      assert.equal(await page.getByText(member.displayName, { exact: true }).isVisible(), true);
      await page.getByText(member.displayName, { exact: true }).scrollIntoViewIfNeeded();
      const identityBounds = await page.getByText(member.displayName, { exact: true }).boundingBox();
      assert.ok(identityBounds && identityBounds.y >= 0 && identityBounds.y + identityBounds.height <= 844);
      await capture('returning-mobile');
      const returningOrigin = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole('navigation', { name: 'Workspace navigation', exact: true }).getByRole('link', { name: /Search/ }).click();
      await page.waitForURL('**/app/search');
      await page.getByRole('heading', { name: 'Search your workspace', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => performance.timeOrigin), returningOrigin);
      assert.equal(await page.getByRole('button', { name: 'Open navigation', exact: true }).isVisible(), true);
      await page.getByRole('button', { name: 'Filter results', exact: true }).click();
      assert.equal(await page.getByRole('combobox', { name: 'Look in', exact: true }).isVisible(), true);
      await page.getByRole('combobox', { name: 'Look in', exact: true }).selectOption('page');
      await capture('search-mobile');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await capture('search-desktop');
      await page.getByRole('link', { name: 'Skip to content', exact: true }).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => location.hash), '#workspace-content');
      assert.equal(await page.locator(':focus').getAttribute('id'), 'workspace-content');
      await page.goBack();
      await page.waitForURL(url => url.pathname === '/app' && !url.hash);
      assert.equal(await page.evaluate(() => performance.timeOrigin), returningOrigin);
      await page.goto(runtime.baseUrl + '/app/search?containerId=' + encodeURIComponent(containers[0].id));
      await page.getByRole('button', { name: 'Filter results', exact: true }).click();
      await page.getByRole('combobox', { name: 'Space', exact: true }).locator(`option[value="${containers[0].id}"]`).waitFor({ state: 'attached' });
      assert.equal(await page.getByRole('combobox', { name: 'Space', exact: true }).inputValue(), containers[0].id);
      await page.goto(runtime.baseUrl + '/app/settings', { waitUntil: 'networkidle' });
      const sections = page.getByRole('navigation', { name: 'Settings sections', exact: true });
      assert.equal(await sections.getByRole('link', { name: 'Connections', exact: true }).count(), profile === 'flagship' ? 1 : 0);
      if (profile === 'core-wiki') {
        const refused = await api('/api/runs');
        assert.equal(refused.status, 403);
        assert.equal((await refused.json()).code, 'FEATURE_DISABLED');
        await page.goto(runtime.baseUrl + '/app/runs/disabled-profile-probe');
        await page.getByRole('heading', { name: 'Feature unavailable', exact: true }).waitFor();
      }
      const latestHtml = await (await api('/app')).text();
      assert.ok(latestHtml.includes('Shell qualification workspace'));
      assert.ok(!latestHtml.includes('Name this workspace'));
      assert.deepEqual(failures, []);
      // The same generated transport cannot replay private data after logout.
      assert.ok(calls.length > 0);
      assert.equal((await api('/api/auth/logout', { method: 'POST' })).status, 204);
      const revoked = await fetch(calls.at(-1), { headers: { cookie, origin: runtime.baseUrl, 'x-tsr-serverFn': 'true', 'sec-fetch-site': 'same-origin' }, redirect: 'manual' });
      const revokedBody = await revoked.text();
      assert.ok(!revokedBody.includes(member.email) && !revokedBody.includes('Shell qualification workspace'));
      assert.match(revokedBody + revoked.headers.get('location'), /signin/);
      if (process.env.SHELL_EVIDENCE) await writeFile(path.join(process.env.SHELL_EVIDENCE, `${profile}-result.json`), JSON.stringify({ profile, failures, serverFunctionCalls: calls.length, actualOrigin: runtime.baseUrl, workerPid: runtime.child.pid, firstRunCompleted: true, widths: [1440, 390], closed: 'finally closes browser and runtime' }, null, 2));
    } catch (error) {
      if (page && process.env.SHELL_EVIDENCE) {
        await writeFile(path.join(process.env.SHELL_EVIDENCE, `${profile}-failure.txt`), await page.locator('body').ariaSnapshot());
        await writeFile(path.join(process.env.SHELL_EVIDENCE, `${profile}-failure-controls.json`), JSON.stringify(await page.locator('select').evaluateAll(elements => elements.map(element => ({ html: element.outerHTML, labels: [...element.labels].map(label => label.textContent), display: getComputedStyle(element).display, rectangle: element.getBoundingClientRect().toJSON() }))), null, 2));
        await page.screenshot({ path: path.join(process.env.SHELL_EVIDENCE, `${profile}-failure.jpg`), fullPage: true });
      }
      throw error;
    } finally {
      await browser?.close();
      if (runtime) await stop(runtime.child);
      await rm(state, { recursive: true, force: true });
    }
  });
}
