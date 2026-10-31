import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { applyMigrations, localDevelopmentVars, seedAuroraFixture, startEmittedWorker, stop } from './runtime-harness.mjs';
import { inbox, newOutboxLink } from './outbox-auth.mjs';
import { unavailableOidcIssuer } from '../helpers/oidc-edge.mjs';

/** WORK-015: built sign-in identifies a real failed provider attempt and completes native email sign-in. */
export async function providerFallbackFlow() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'slate-provider-fallback-'));
  const shots = process.env.SLATE_SIGNIN_SHOTS;
  let runtime, browser;
  try {
    await applyMigrations(directory);
    await seedAuroraFixture(directory);
    runtime = await startEmittedWorker(directory, { ...localDevelopmentVars, SSO_ENABLED: 'true',
      IDENTITY_ISSUER_URL: unavailableOidcIssuer, IDENTITY_CLIENT_ID: 'synthetic-slate-711', IDENTITY_CLIENT_SECRET: 'synthetic-slate-712',
      IDENTITY_AUTHORIZATION_ENDPOINT: unavailableOidcIssuer + '/authorize', IDENTITY_TOKEN_ENDPOINT: unavailableOidcIssuer + '/token',
      IDENTITY_JWKS_URI: unavailableOidcIssuer + '/keys', IDENTITY_TRANSACTION_SECRET: 'synthetic-slate-713-transaction-secret' });
    const origin = runtime.baseUrl;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const proof = async name => {
        if (!shots) return;
        await mkdir(shots, { recursive: true });
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
          await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      };
      await page.goto(origin + '/signin', { waitUntil: 'networkidle' });
      const before = await inbox(origin);
      await page.getByRole('button', { name: 'Continue with ' + new URL(unavailableOidcIssuer).hostname, exact: true }).click();
      await page.waitForURL(url => url.pathname === '/signin' && url.searchParams.get('provider') === 'identity');
      await page.getByRole('status').filter({ hasText: new URL(unavailableOidcIssuer).hostname }).waitFor();
      assert.match(await page.getByRole('status').innerText(), /unavailable/);
      assert.equal(await page.getByLabel('Email address', { exact: true }).isEnabled(), true);
      assert.equal((await context.request.get(origin + '/api/session')).status(), 401);
      const observed = (await readFile(path.join(directory, 'oidc-requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(observed, [{ method: 'GET', path: '/.well-known/openid-configuration' }]);
      assert.equal((await inbox(origin)).length, before.length);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const textSizes = await page.locator('.paper-body label, .paper-body button, .paper-body p').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
      assert.ok(textSizes.every(size => size >= 13));
      await proof('provider-unavailable');
      // No provider is repaired or application response substituted before email confirmation.
      await page.getByLabel('Email address', { exact: true }).fill(['jamie', 'aurora.example'].join('@'));
      await page.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
      await page.goto(await newOutboxLink(origin, before));
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await page.waitForURL(url => ['/app', '/setup'].includes(url.pathname));
      const session = await context.request.get(origin + '/api/session');
      assert.equal(session.status(), 200);
      assert.equal((await session.json()).member.email, ['jamie', 'aurora.example'].join('@'));
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal((await context.request.get(origin + '/api/session')).status(), 200);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  } finally {
    if (browser) await browser.close();
    if (runtime) await stop(runtime.child);
    await rm(directory, { recursive: true, force: true });
  }
}
