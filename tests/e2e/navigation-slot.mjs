import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { root } from './runtime-harness.mjs';
import { command, safeEnvironment } from '../qualification/local/process.mjs';

const fixture = `import type { ClientSlots } from "../core/app/ext-client";
export const slateClientSlots: ClientSlots = {
  "workspace.navigation.after.v1": () => (
    <nav aria-label="Buyer navigation"><a href="/app/search">Response library</a></nav>
  ),
};
`;

async function javascript(directory) {
  const chunks = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) chunks.push(await javascript(file));
    else if (/\.m?js$/.test(entry.name)) chunks.push(await readFile(file, 'utf8'));
  }
  return chunks.join('\n');
}

export async function navigationSlotJourney() {
  const checkout = await mkdtemp(path.join(os.tmpdir(), 'slate-navigation-slot-'));
  let browser;
  try {
    await command('rsync', ['-a',
      ...['node_modules', 'dist', 'delivery-artifact', '.artifacts', '.wrangler', '.tanstack', '.cache', '.git', '.env*', '.dev.vars*'].flatMap(value => ['--exclude', value]),
      root + '/', checkout + '/',
    ], { cwd: root, env: safeEnvironment() });
    await symlink(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
    await writeFile(path.join(checkout, 'src/ext/index.client.tsx'), fixture);
    await command('nice', ['-n', '15', 'pnpm', 'exec', 'vite', 'build'], {
      cwd: checkout, env: safeEnvironment(), timeout: 240000,
    });
    const server = await javascript(path.join(checkout, 'dist/server'));
    assert.ok(!server.includes('Response library'), 'The buyer contribution stays outside server JavaScript.');
    assert.ok(!server.includes('ext/index.client'), 'The server does not import the buyer client mount.');
    const client = await javascript(path.join(checkout, 'dist/client'));
    assert.ok(client.includes('Response library'), 'The buyer contribution is compiled into browser JavaScript.');
    const harness = await import(pathToFileURL(path.join(checkout, 'tests/e2e/runtime-harness.mjs')).href);
    const { navigationJourney } = await import('../qualification/ui-convergence/sidebar-journey.mjs');
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'],
    });
    for (const width of [1440, 390]) {
      const persistPath = await mkdtemp(path.join(checkout, 'navigation-state-'));
      let runtime, context;
      try {
        await harness.applyMigrations(persistPath);
        await harness.seedAuroraFixture(persistPath);
        runtime = await harness.startEmittedWorker(persistPath, harness.localDevelopmentVars);
        const origin = runtime.baseUrl;
        const { cookie } = await harness.signInLocally(origin);
        const ssr = await fetch(origin + '/app', { headers: { cookie } });
        assert.equal(ssr.status, 200);
        const html = await ssr.text();
        assert.ok(!html.includes('Response library'), 'The buyer contribution appears only after hydration.');
        context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 } });
        await context.addCookies(cookie.split('; ').map(item => {
          const index = item.indexOf('=');
          return { name: item.slice(0, index), value: item.slice(index + 1), url: origin };
        }));
        const page = await context.newPage();
        const api = async route => {
          const response = await context.request.get(origin + route);
          assert.equal(response.status(), 200, route);
          return response.json();
        };
        await page.goto(origin + '/app', { waitUntil: 'networkidle' });
        await navigationJourney({ page, context, origin, api }, width, { buyerSlot: true });
      } finally {
        try { if (context) await context.close(); }
        finally {
          try { if (runtime) await harness.stop(runtime.child); }
          finally { await rm(persistPath, { recursive: true, force: true }); }
        }
      }
    }
  } finally {
    try { if (browser) await browser.close(); }
    finally { await rm(checkout, { recursive: true, force: true }); }
  }
}
