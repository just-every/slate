import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { inbox, newOutboxLink } from './outbox-auth.mjs';

/** Follow the generated owner entry through the real form and native session. */
export async function signInHintFlow(origin) {
  const spec = JSON.parse(await readFile('management/integration/deployment-spec.json', 'utf8'));
  const entry = new URL(spec.surfaces.app.signIn.path, origin);
  assert.ok(spec.surfaces.app.signIn.loginHint, 'Owner entry supports email hints');
  const shots = process.env.SLATE_SIGNIN_SHOTS;
  const ownerEmail = process.env.SLATE_SIGNIN_EMAIL ?? 'owner@example.test';
  if (shots) await mkdir(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 } });
      try {
        const page = await context.newPage();
        let requests = 0;
        page.on('request', request => {
          if (new URL(request.url()).pathname === '/api/auth/magic') requests++;
        });
        const before = await inbox(origin);
        for (const hint of [null, 'invalid-address', ownerEmail]) {
          const url = new URL(entry);
          if (hint !== null) url.searchParams.set('login_hint', hint);
          await page.goto(url.href, { waitUntil: 'networkidle' });
          const email = page.getByLabel('Email address', { exact: true });
          assert.equal(await email.inputValue(), hint?.includes('@') ? hint : '');
        }
        for (const hint of ['invalid-address', ownerEmail]) {
          const target = new URL('/app', origin);
          target.searchParams.set('login_hint', hint);
          const response = await context.request.get(target.href, {maxRedirects: 0});
          assert.equal(response.status(), 302);
          const destination = new URL(response.headers().location, origin);
          assert.equal(destination.pathname, '/signin');
          assert.equal(destination.searchParams.get('login_hint'), hint === ownerEmail ? ownerEmail : null);
          await page.goto(target.href, {waitUntil: 'networkidle'});
          assert.equal(await page.getByLabel('Email address', {exact: true}).inputValue(), hint === ownerEmail ? ownerEmail : '');
        }
        assert.equal(requests, 0, 'Opening an owner entry never submits sign-in');
        assert.equal((await inbox(origin)).length, before.length, 'Prefill sends no mail');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (width === 1440) {
          assert.match(await page.getByRole('status').innerText(), /OIDC sign-in is not configured/);
          assert.equal(await page.getByRole('button', { name: /^Continue with / }).count(), 0);
        }
        if (shots) await page.screenshot({ path: path.join(shots, `login-hint-${width}.png`), fullPage: true });

        // The address remains editable. Only an explicit submit reaches the paid
        // mail edge; the existing emitted-Worker harness fakes that edge alone.
        await page.getByLabel('Email address', { exact: true }).fill('jamie@aurora.example');
        await page.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
        await page.goto(await newOutboxLink(origin, before));
        await page.getByRole('button', { name: 'Confirm', exact: true }).click();
        await page.waitForURL(url => ['/app', '/setup'].includes(url.pathname));
        const session = await context.request.get(origin + '/api/session');
        assert.equal(session.status(), 200);
        const { member } = await session.json();
        assert.equal(member.email, 'jamie@aurora.example');
        assert.equal(member.role, 'owner');
        for (const hint of [null, ownerEmail]) for (const next of [undefined, '/app?view=recent', 'https://outside.invalid/app', '//outside.invalid/app']) {
          const target = new URL('/signin', origin);
          if (hint !== null) target.searchParams.set('login_hint', hint);
          if (next !== undefined) target.searchParams.set('next', next);
          const expected = next?.startsWith('/app?') ? next : '/app';
          const response = await context.request.get(target.href, {maxRedirects: 0});
          assert.equal(response.status(), 307);
          assert.equal(response.headers().location, expected);
          await page.goto(target.href, {waitUntil: 'networkidle'});
          assert.equal(new URL(page.url()).origin, origin);
          // This fixture has not completed first-run setup: app admission must
          // still send it to the wizard after the sign-in route's safe redirect.
          assert.equal(new URL(page.url()).pathname, '/setup');
          assert.equal(await page.getByLabel('Email address', {exact: true}).count(), 0);
        }
        assert.equal(requests, 1, 'Only the explicit request sent a sign-in email');
        if (shots) await page.screenshot({ path: path.join(shots, `signed-in-${width}.png`), fullPage: true });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
