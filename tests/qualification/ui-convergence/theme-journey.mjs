import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { signInWithOutbox } from '../../e2e/outbox-auth.mjs';
import { accessible } from './browser-evidence.mjs';
import { ok } from './two-people-support.mjs';

const labels = { light: 'Light', dark: 'Dark', system: 'Match device' };
const appearance = '/app/settings?section=appearance';
const luminance = rgb => rgb.slice(0, 3).map(value => {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);

/** Check the painted surface and text, including inherited editor backgrounds. */
async function paintedTheme(view, theme, target = view.getByRole('main').locator('.main').first()) {
  await view.bringToFront();
  await expect(view.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(target).toBeVisible();
  let palette;
  await expect.poll(async () => {
    palette = await target.evaluate(element => {
      // Client navigation can replace the locator's node before evaluation.
      // Sample its connected successor instead of parsing an empty style as black.
      if (!element.isConnected) return null;
      // Keep real motion enabled. Poll only color transitions that paint this
      // surface; an unrelated control cannot leave an unbounded finished promise.
      for (let node = element; node; node = node.parentElement) {
        if (node.getAnimations().some(animation => animation instanceof CSSTransition
          && ['color', 'background-color'].includes(animation.transitionProperty)
          && animation.playState !== 'finished')) return null;
      }
      let parser;
      const rgba = color => {
        const rgb = /^rgba?\(([^)]+)\)$/.exec(color);
        const channels = rgb?.[1].split(',').map(Number);
        if (channels && [3, 4].includes(channels.length) && channels.every(Number.isFinite)) {
          return [...channels.slice(0, 3), Math.round((channels[3] ?? 1) * 255)];
        }
        // Retain support for any CSS color syntax without repeated GPU reads.
        if (!parser) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          parser = canvas.getContext('2d', { willReadFrequently: true });
        }
        parser.clearRect(0, 0, 1, 1);
        parser.fillStyle = color;
        parser.fillRect(0, 0, 1, 1);
        return [...parser.getImageData(0, 0, 1, 1).data];
      };
      let surface = element;
      while (surface.parentElement && rgba(getComputedStyle(surface).backgroundColor)[3] === 0) surface = surface.parentElement;
      return { background: rgba(getComputedStyle(surface).backgroundColor), ink: rgba(getComputedStyle(element).color) };
    }, undefined, { timeout: 5000 });
    return palette !== null;
  }, { message: 'Inspect the connected route surface after its color transitions settle.' }).toBe(true);
  assert.equal(palette.background[3], 255, 'The visible surface has an opaque background.');
  const background = luminance(palette.background), ink = luminance(palette.ink);
  assert.ok(theme === 'light' ? background > .5 : background < .1, `${view.url()}: ${theme} paints the actual surface: ${JSON.stringify(palette)}`);
  assert.ok((Math.max(background, ink) + .05) / (Math.min(background, ink) + .05) >= 4.5, `${view.url()}: ${theme} text remains readable on its painted surface: ${JSON.stringify(palette)}`);
}

/** Full-page scans and captures also inspect controls outside the main surface. */
async function settledColors(view) {
  await expect.poll(() => view.evaluate(() => document.getAnimations().filter(animation =>
    animation instanceof CSSTransition && ['color', 'background-color'].includes(animation.transitionProperty)
    && animation.playState === 'running').length), { message: 'Full-page color transitions settle.' }).toBe(0);
}

async function choose(view, origin, theme) {
  await view.goto(origin + appearance, { waitUntil: 'networkidle' });
  const choice = view.getByRole('radio', { name: labels[theme], exact: true });
  if (!await choice.isChecked()) {
    // The controlled radio reflects the committed response, rather than the
    // synchronous native toggle that Playwright check() requires.
    const [response] = await Promise.all([
      view.waitForResponse(response => new URL(response.url()).pathname === '/api/members/current/theme' && response.request().method() === 'PUT'),
      choice.click(),
    ]);
    assert.equal(response.status(), 200, await response.text());
    assert.equal((await response.json()).value.theme, theme);
  }
  await expect(choice).toBeChecked();
  assert.equal((await ok(view.context(), origin, 'GET', '/api/members/current')).theme, theme, 'The native member record stores the selected preference.');
}

async function operatorDestination(view, origin, route, inNavigation) {
  if (route.startsWith('/app/settings?') && new URL(view.url()).pathname === '/app/settings') {
    // Exercise the same native section links a member uses, retaining the
    // document-door check without rebuilding the whole browser document.
    const response = await view.context().request.get(origin + route);
    const link = view.getByRole('navigation', { name: 'Settings sections', exact: true }).locator(`a[href="${route}"]`);
    await link.click();
    await expect(view).toHaveURL(origin + route);
    await expect(link).toHaveAttribute('aria-current', 'page');
    return response;
  }
  if (inNavigation) {
    // Cover the persistent operator shell as well as each document door.
    const response = await view.context().request.get(origin + route);
    const trigger = view.getByRole('button', { name: 'Open navigation', exact: true });
    if (await trigger.isVisible()) await trigger.click();
    const link = view.locator('nav[aria-label="Workspace navigation"]').locator(`a[href="${route}"]`);
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(view).toHaveURL(origin + route);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await view.waitForLoadState('networkidle');
    return response;
  }
  return view.goto(origin + route, { waitUntil: 'networkidle' });
}

/** Native member preferences, new sign-ins and public exposure documents; no application response is faked. */
export async function themeJourney(state, width) {
  const { page, context, origin, api } = state;
  const browser = context.browser(), viewport = page.viewportSize();
  const shot = async (view, label) => {
    await settledColors(view);
    await view.screenshot({ path: `.artifacts/ui-convergence/theme-${width}-${label}.png`, fullPage: false });
  };
  const member = await api('/api/members/current');
  const space = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  assert.ok(space);
  const mutate = (route, data) => ok(context, origin, 'POST', route, { operationKey: randomUUID(), ...data });
  const marker = 'A readable response plan.';
  const { value: { pageId } } = await mutate('/api/pages', { containerId: space.id, title: 'Theme response plan', blocks: [{ id: randomUUID(), blockType: 'paragraph', treePosition: 'a0', content: { text: [{ text: marker }] } }] });
  const database = (await mutate('/api/databases', { containerId: space.id, title: 'Theme response tracker' })).value;
  const field = { id: randomUUID(), name: 'Response notes', type: 'text', config: {}, position: 0 };
  const structure = (await mutate(`/api/databases/${database.id}/fields`, { expectedRevisionId: database.revisionId, field })).value;
  await mutate(`/api/databases/${database.id}/views`, { expectedRevisionId: structure.revisionId, view: { id: randomUUID(), name: 'Response table', layout: 'table', filters: [], sorts: [], groups: [], calculations: {}, display: {}, position: 0 } });
  const record = (await mutate(`/api/databases/${database.id}/records`, { title: 'Theme response record', values: { [field.id]: marker } })).value;
  const pagePath = `/app/pages/${pageId}`, databasePath = `/app/databases/${database.id}`;
  const recordPath = `${databasePath}/records/${record.pageId}`;

  // Each exposure is real published content with its own explicit theme.
  const exposures = [];
  for (const theme of ['light', 'dark']) {
    const created = await mutate('/api/pages', { containerId: space.id, title: `Published ${theme} response plan`, blocks: [{ id: randomUUID(), blockType: 'paragraph', treePosition: 'a0', content: { text: [{ text: marker }] } }] });
    const id = created.value.pageId, document = await api(`/api/pages/${id}`);
    const slug = `theme-${theme}-${randomUUID()}`;
    await mutate(`/api/publishing/${id}`, { expectedRevisionId: document.page.revisionId, host: new URL(origin).host, slug, theme });
    exposures.push({ theme, path: `/p/${slug}`, title: `Published ${theme} response plan` });
  }

  const reader = await browser.newContext({ viewport, colorScheme: 'light' });
  const anonymous = await browser.newContext({ viewport, colorScheme: 'dark' });
  const publicMember = await context.newPage();
  try {
    await reader.addCookies([{ name: 'slate_session', value: state.readerCookie.split('=')[1], url: origin }]);
    const readerMember = await ok(reader, origin, 'GET', '/api/members/current');
    const readerSession = await signInWithOutbox(origin, readerMember.email);
    assert.notEqual(readerSession.cookie, state.readerCookie, 'The second member also receives a newly issued native session.');
    await reader.clearCookies();
    await reader.addCookies([{ name: 'slate_session', value: readerSession.cookie.split('=')[1], url: origin }]);
    const other = await reader.newPage(), publicAnonymous = await anonymous.newPage();
    await choose(other, origin, 'dark');
    await paintedTheme(other, 'dark');
    assert.equal((await anonymous.request.get(origin + '/api/members/current')).status(), 401, 'Published-page proof uses an unsigned browser.');

    await page.goto(origin + appearance, { waitUntil: 'networkidle' });
    const settingsPaths = await page.getByRole('navigation', { name: 'Settings sections', exact: true }).locator('a').evaluateAll(links => links.map(link => new URL(link.href).pathname + new URL(link.href).search));
    const destinations = (await api('/api/navigation')).configuration.destinations.filter(item => item.visible).map(item => item.href);
    const routes = [...new Set([...destinations, ...settingsPaths, pagePath, databasePath, recordPath])];

    for (const preference of ['light', 'dark', 'system']) {
      // An explicit choice must defeat an opposing device setting.
      await page.emulateMedia({ colorScheme: preference === 'dark' ? 'light' : 'dark' });
      await choose(page, origin, preference);
      const resolved = preference === 'system' ? 'dark' : preference;
      await paintedTheme(page, resolved);
      await settledColors(page);
      await accessible(page, `appearance ${preference}`);
      await shot(page, `appearance-${preference}`);
      for (const [index, route] of routes.entries()) {
        console.log(`Theme route ${width}px ${preference}: ${route}`);
        const response = await operatorDestination(page, origin, route, destinations.includes(route));
        assert.equal(response.status(), 200, `Operator destination ${route} is served.`);
        await expect(page.getByRole('main')).toHaveCount(1);
        await paintedTheme(page, resolved);
        if (route === pagePath || route === recordPath) {
          const title = page.getByRole('textbox', { name: 'Page title', exact: true });
          await expect(title).toBeEditable();
          await paintedTheme(page, resolved, title);
          if (route === recordPath) {
            const property = page.locator('.record-field').filter({ has: page.getByText(field.name, { exact: true }) });
            await property.getByRole('button', { name: 'Edit', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: `Edit ${field.name}`, exact: true });
            const value = dialog.getByRole('textbox', { name: field.name, exact: true });
            await expect(value).toHaveValue(marker);
            await expect(value).toBeEditable();
            await paintedTheme(page, resolved, value);
            if (preference === 'system') {
              await page.emulateMedia({ colorScheme: 'light' });
              await paintedTheme(page, 'light', value);
              await page.emulateMedia({ colorScheme: 'dark' });
              await paintedTheme(page, 'dark', value);
            }
            if (preference === 'dark') await shot(page, 'record-value-editor');
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
          }
          if (route === pagePath) {
            const paragraph = page.getByRole('textbox', { name: 'Paragraph', exact: true });
            await expect(paragraph).toHaveText(marker);
            await expect(paragraph).toBeEditable();
            await paintedTheme(page, resolved, paragraph);
          }
        }
        if (route === databasePath) {
          const notes = page.getByRole('textbox', { name: field.name, exact: true });
          await expect(notes).toHaveValue(marker);
          await expect(notes).toBeEditable();
          await paintedTheme(page, resolved, notes);
        }
        if (preference === 'system') {
          await page.emulateMedia({ colorScheme: 'light' });
          await paintedTheme(page, 'light');
          await page.emulateMedia({ colorScheme: 'dark' });
          await paintedTheme(page, 'dark');
        }
        if (preference === 'dark') await shot(page, `operator-${index}`);
      }
      await page.reload({ waitUntil: 'networkidle' });
      await paintedTheme(page, resolved);
      assert.equal((await api('/api/members/current')).theme, preference);

      // No storage state, local storage or old session is copied to this device.
      const session = await signInWithOutbox(origin, member.email);
      assert.notEqual(session.cookie.split('=')[1], (await context.cookies(origin)).find(cookie => cookie.name === 'slate_session').value);
      const device = await browser.newContext({ viewport: { width: width === 1440 ? 390 : 1440, height: width === 1440 ? 844 : 1000 }, colorScheme: preference === 'light' ? 'dark' : 'light' });
      try {
        await device.addCookies([{ name: 'slate_session', value: session.cookie.split('=')[1], url: origin }]);
        const fresh = await device.newPage();
        await fresh.goto(origin + appearance, { waitUntil: 'networkidle' });
        await expect(fresh.getByRole('radio', { name: labels[preference], exact: true })).toBeChecked();
        const stored = await ok(device, origin, 'GET', '/api/members/current');
        assert.equal(stored.id, member.id);
        assert.equal(stored.theme, preference);
        await paintedTheme(fresh, preference === 'system' ? 'light' : preference);
        await fresh.reload({ waitUntil: 'networkidle' });
        await paintedTheme(fresh, preference === 'system' ? 'light' : preference);
        await fresh.emulateMedia({ colorScheme: 'dark' });
        await paintedTheme(fresh, preference === 'system' ? 'dark' : preference);
      } finally { await device.close(); }
      await other.reload({ waitUntil: 'networkidle' });
      await expect(other.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
      await paintedTheme(other, 'dark');
      assert.equal((await ok(reader, origin, 'GET', '/api/members/current')).theme, 'dark', 'Changing one member never writes the other member preference.');

      for (const exposure of exposures) for (const view of [publicMember, publicAnonymous]) {
        await view.emulateMedia({ colorScheme: 'light' });
        const response = await view.goto(origin + exposure.path, { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200);
        await expect(view.getByRole('heading', { name: exposure.title, exact: true })).toBeVisible();
        await expect(view.locator('.page-body')).toContainText(marker);
        await expect(view.locator('.slate-app')).toHaveCount(0);
        await paintedTheme(view, exposure.theme, view.locator('body'));
        await view.emulateMedia({ colorScheme: 'dark' });
        await paintedTheme(view, exposure.theme, view.locator('body'));
        await view.reload({ waitUntil: 'networkidle' });
        await paintedTheme(view, exposure.theme, view.locator('body'));
        if (preference === 'system' && view === publicAnonymous) await shot(view, `published-${exposure.theme}`);
      }
    }
    await choose(other, origin, 'light');
    await paintedTheme(other, 'light');
    assert.equal((await api('/api/members/current')).theme, 'system', 'A member change also leaves the owner preference independent.');
    await paintedTheme(page, 'dark');
    console.log(`WORK-012 native themes, new sessions, independent members and anonymous exposures passed at ${width}px`);
  } finally {
    await publicMember.close();
    await reader.close();
    await anonymous.close();
    await page.emulateMedia({ colorScheme: 'light' });
  }
}
