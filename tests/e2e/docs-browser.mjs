import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Native documentation navigation over the emitted Worker; the phone run is separate browser proof. */
export async function docsBrowserJourney(origin, manifest, { width = 1440, proof = process.env.SLATE_DOCS_PROOF_DIR } = {}) {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  const page = await context.newPage();
  const pages = manifest.sections.flatMap(section => section.pages);
  const titles = new Map(await Promise.all(pages.map(async entry => [entry.source,
    /^# (.+)$/m.exec(await readFile(new URL('../../' + entry.source, import.meta.url), 'utf8'))[1],
  ])));
  const href = entry => entry.slug ? '/docs/' + entry.slug : '/docs';
  const requests = [], cookies = [], errors = [];
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  page.on('response', response => { if (response.headers()['set-cookie']) cookies.push(response.url()); });
  page.on('pageerror', error => errors.push(error.message));
  // The GitHub link is actually followed. Only that deliberate document navigation is substituted at the network edge.
  await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Source destination</title>' }));
  const arrive = async entry => {
    await expect(page).toHaveURL(origin + href(entry));
    await expect(page.locator('.docs-title')).toHaveText(titles.get(entry.source));
    await expect(page.locator('h1')).toHaveCount(1);
  };
  try {
    const response = await page.goto(origin + '/docs', { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    for (const [index, entry] of pages.entries()) {
      const navigation = page.locator(width < 861 ? '.docs-menu' : '.docs-sidebar');
      if (width < 861 && !await navigation.locator('details').evaluate(element => element.open)) await navigation.locator('summary').click();
      assert.deepEqual(await navigation.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href'))), pages.map(href));
      await navigation.getByRole('link', { name: entry.label, exact: true }).click();
      await arrive(entry);
      if (width < 861 && await navigation.locator('details').evaluate(element => element.open)) await navigation.locator('summary').click();
      await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute('href', href(entry));
      const toc = page.locator(width < 1200 ? '.docs-toc-compact' : '.docs-toc');
      if (width < 1200) await toc.locator('summary').click();
      const anchors = await toc.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')));
      assert.ok(anchors.length, entry.source + ' offers on-this-page navigation');
      const headings = await page.locator('.docs-prose :is(h2,h3)').evaluateAll(headings => headings.map(heading => '#' + heading.id));
      assert.deepEqual(anchors, headings.length ? headings : ['#' + await page.locator('h1').getAttribute('id')]);
      for (const anchor of anchors) {
        await toc.locator(`a[href="${anchor}"]`).click();
        await expect(page).toHaveURL(origin + href(entry) + anchor);
        await expect(page.locator(anchor)).toBeInViewport();
      }
      if (width < 1200) await toc.locator('summary').click();
      for (const table of await page.locator('.docs-prose table').all()) {
        const region = table.locator('..');
        await expect(region).toHaveAttribute('role', 'region');
        await expect(region).toHaveAttribute('aria-label', /\S+/);
        await expect(region).toHaveAttribute('tabindex', '0');
        assert.equal(await region.evaluate(element => getComputedStyle(element).overflowX), 'auto');
        await region.focus();
        await expect(region).toBeFocused();
      }
      const pager = page.getByRole('navigation', { name: 'Previous and next pages' });
      for (const [rel, neighbor] of [['prev', pages[index - 1]], ['next', pages[index + 1]]]) {
        const link = pager.locator(`a[rel="${rel}"]`);
        if (!neighbor) await expect(link).toHaveCount(0);
        else {
          await expect(link).toHaveAttribute('href', href(neighbor));
          await link.click();
          await arrive(neighbor);
          await page.goBack({ waitUntil: 'networkidle' });
          // Back restores the on-this-page fragment as well as the document.
          await expect(page.locator('.docs-source a')).toHaveAttribute('href', `https://github.com/just-every/run-slate/edit/main/${entry.source}`);
        }
      }
      const source = page.getByRole('link', { name: 'Edit this page on GitHub', exact: true });
      const destination = `https://github.com/just-every/run-slate/edit/main/${entry.source}`;
      await expect(source).toHaveAttribute('href', destination);
      await source.click();
      await expect(page).toHaveURL(destination);
      await page.goBack({ waitUntil: 'networkidle' });
      await expect(page.locator('.docs-title')).toBeVisible();
      await page.locator('.skip-link').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#docs-content')).toBeFocused();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), entry.source + ' fits the viewport');
      const accessibility = await new AxeBuilder({ page }).include('.slate-docs').analyze();
      assert.deepEqual(accessibility.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), [], entry.source + ' accessibility');
      assert.doesNotMatch(await page.content(), /Jamie Park|Aurora Android Launch|synthetic-slate-private/);
      if (proof) {
        await mkdir(proof, { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(proof, `${width}-${entry.slug || 'index'}.png`), fullPage: true });
      }
    }
    for (const unknown of ['/docs/unknown', '/docs/Install', '/docs/install/extra']) {
      const response = await page.goto(origin + unknown, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 404, unknown);
      await expect(page.getByRole('heading', { name: 'Not found', exact: true })).toBeVisible();
      await expect(page.locator('.slate-docs .site-header')).toBeVisible();
      await page.getByRole('link', { name: 'Back to documentation' }).click();
      await arrive(pages[0]);
    }
    assert.deepEqual(cookies, [], 'docs never set a cookie');
    assert.deepEqual(await context.cookies(), [], 'navigation creates no tracking or session cookie');
    assert.deepEqual(errors, [], 'native hydration has no browser error');
    for (const request of requests) {
      const url = new URL(request.url);
      if (url.origin === 'https://github.com') {
        assert.equal(request.type, 'document');
        assert.ok(pages.some(entry => url.href === `https://github.com/just-every/run-slate/edit/main/${entry.source}`));
      } else {
        assert.equal(url.origin, origin, 'all resources remain same-origin');
        assert.equal(request.method, 'GET', 'docs send no tracking or mutation request');
        assert.doesNotMatch(url.pathname, /^\/(?:api|auth|app)(?:\/|$)/, 'docs never request native private data');
      }
    }
    console.log(`PROBE DOCS-001 browser: ${pages.length} manifest pages at ${width}px; real menu, anchors, pager, source links, table regions, accessibility, 404 and tracking checks passed`);
  } finally { await context.close(); await browser.close(); }
}
