import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { openNavigation } from '../../qualification/ui-convergence/browser-support.mjs';
import { capture, control, separated, checkboxBeside, labelsDoNotOverlap, insideViewport } from './evidence.mjs';

import { waitForRenderedResourceReadiness } from './resource-readiness.mjs';
import { waitForScrollSettled } from './scroll-settle.mjs';
import { headingGap, filterAlignment, drawerDoesNotIntercept } from './layout.mjs';

export async function spacesJourney({ page }) {
  await openNavigation(page);
  await page.getByRole('navigation', { name: 'Workspace navigation', exact: true }).getByRole('link', { name: 'Spaces', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/containers/);
  const spaces = page.locator('.spaces-workspace');
  await expect(page.getByRole('heading', { name: 'Spaces', exact: true })).toHaveCount(1);
  const create = spaces.getByRole('button', { name: 'Create space', exact: true });
  await control(create, 'Create space');
  const primary = await create.evaluate(el => ({ primary: el.classList.contains('primary-button'), height: el.getBoundingClientRect().height, bg: getComputedStyle(el).backgroundColor }));
  assert.ok(primary.primary && primary.height <= 52 && primary.bg !== 'rgba(0, 0, 0, 0)', 'Create space is a visible 32–52px primary action');
  for (const label of ['Show archived spaces', 'My memberships', 'Personal spaces']) await checkboxBeside(spaces.getByRole('checkbox', { name: label, exact: true }), label);
  await filterAlignment(spaces, page.viewportSize().width);
  await capture(page, 'spaces-nav', { fullPage: true });
  const card = spaces.getByRole('button', { name: /Handbook.*Workspace access/ });
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  const unselected = await card.evaluate(el => ({ background:getComputedStyle(el).backgroundColor, border:getComputedStyle(el).borderColor }));
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const selected = await card.evaluate(el => ({ background:getComputedStyle(el).backgroundColor, border:getComputedStyle(el).borderColor }));
  assert.notDeepEqual(selected, unselected, 'Selected space card visibly differs from its unselected state');
  const other = spaces.locator('.space-choice[aria-pressed="false"]').first();
  await expect(other).toBeVisible();
  assert.notDeepEqual(selected, await other.evaluate(el => ({ background:getComputedStyle(el).backgroundColor, border:getComputedStyle(el).borderColor })), 'Selected card visibly differs from a neighboring unselected card');
  const tabs = page.getByRole('navigation', { name: 'Space navigation', exact: true });
  const names = ['Home', 'Content', 'Blog', 'Settings', 'Templates', 'Trash', 'Bulk'];
  const buttons = names.map(name => tabs.getByRole('button', { name, exact: true }));
  await expect(tabs.getByRole('button')).toHaveCount(names.length);
  for (let i = 0; i < buttons.length; i++) await control(buttons[i], names[i]);
  await separated(buttons, 'Space tabs');
  const favourite = spaces.getByRole('button', { name: /^(Add to|Remove from) favourites$/ });
  const exporting = spaces.getByRole('button', { name: 'Export space', exact: true });
  await control(favourite, 'Space Favourite'); await control(exporting, 'Export space'); await separated([favourite, exporting], 'Space actions');
  await capture(page, 'space', { fullPage: true });
  // Every tab changes the selected state and exposes its real application pane.
  const panes = [spaces.getByRole('region', { name: 'Space home', exact: true }), spaces.getByLabel('Filter page titles', { exact: true }), spaces.getByRole('region', { name: 'Blog', exact: true }), spaces.getByRole('heading', { name: 'Space settings', exact: true }), spaces.getByRole('button', { name: 'Filter templates', exact: true }), spaces.getByRole('group', { name: 'Archive and trash', exact: true }), spaces.getByRole('heading', { name: 'Bulk tools', exact: true })];
  for (let i = 0; i < names.length; i++) {
    if (names[i] === 'Templates') {
      const collectionRequest = page.waitForRequest(request => {
        const url = new URL(request.url());
        return request.method() === 'GET' && url.pathname === '/api/containers' && url.search === '';
      }, { timeout: 15_000 });
      await buttons[i].click();
      const response = await (await collectionRequest).response();
      assert.ok(response?.ok(), 'Templates receive collection options from their real resource response');
      const collections = await response.json();
      await spaces.getByRole('button', { name: 'Filter templates', exact: true }).click();
      const collection = spaces.getByRole('combobox', { name: 'Collection', exact: true });
      const expectedOptions = [
        { value: '', label: 'Workspace templates' },
        ...collections.items.map(item => ({ value: item.id, label: item.name })),
      ];
      await expect.poll(
        () => collection.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent.trim() }))),
        { timeout: 15_000 },
      ).toEqual(expectedOptions);
      await page.keyboard.press('Escape');
    } else {
      await buttons[i].click();
    }
    await expect(buttons[i]).toHaveAttribute('aria-pressed', 'true'); await expect(panes[i]).toBeVisible();
    for (let j = 0; j < buttons.length; j++) if (j !== i) await expect(buttons[j]).toHaveAttribute('aria-pressed', 'false');
    await capture(page, `space-${names[i].toLowerCase()}`, { fullPage: true });
  }
  await buttons[0].click();
}

// Traverse the visible application affordances; automatic locator scrolling
// would conceal a broken Previous/More button on a narrow viewport.
async function settingsTab(page, tabs, name, width) {
  const tab = tabs.getByRole('link', { name, exact: true });
  await expect(tab).toBeVisible();
  if (width === 390) {
    const position = () => tab.evaluate(el => {
      const r = el.getBoundingClientRect(), parent = el.closest('nav').getBoundingClientRect();
      return r.left < parent.left - 1 ? 'previous' : r.right > parent.right + 1 ? 'more' : 'inside';
    });
    for (let step = 0; step < 12 && await position() !== 'inside'; step++) {
      const direction = await position();
      const scroll = page.getByRole('button', { name: direction === 'previous' ? 'Previous settings sections' : 'More settings sections', exact: true });
      const before = await tabs.evaluate(el => el.scrollLeft);
      await scroll.click();
      await expect.poll(() => tabs.evaluate(el => el.scrollLeft)).not.toBe(before);
      // Smooth scrolling must finish before deciding whether another click is needed.
      let previous;
      await expect.poll(async () => {
        const current = await tabs.evaluate(el => el.scrollLeft);
        const settled = current === previous;
        previous = current;
        return settled;
      }).toBe(true);
    }
    assert.equal(await position(), 'inside', `${name}: settings scroll controls reach the entire tab`);
  }
  await insideViewport(page, tab, name);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  // aria-current changes before navigation's final render/scroll restoration.
  // Finish its network work as well as rendered resource work before leaving
  // this helper; capture preparation must follow navigation readiness.
  await page.waitForLoadState('networkidle');
  // The panel's resources load after the click and move the page; later scrolling must start from the settled layout.
  await waitForRenderedResourceReadiness(page);
  await waitForScrollSettled(page);
  return tab;
}

export async function settingsJourney({ page, origin }, width) {
  await page.goto(origin + '/app/settings?section=appearance', { waitUntil: 'domcontentloaded' });
  const tabs = page.getByRole('navigation', { name: 'Settings sections', exact: true });
  const names = ['Workspace', 'People', 'SAML single sign-on', 'Developer access', 'Appearance', 'Preferences', 'Activity', 'Automations', 'Statuses', 'Spaces', 'Chat notifications', 'Connections', 'Import & export'];
  await expect(tabs.getByRole('link')).toHaveCount(names.length);
  const appearance = tabs.getByRole('link', { name: 'Appearance', exact: true });
  await expect(appearance).toHaveAttribute('aria-current', 'page');
  await settingsTab(page, tabs, 'Developer access', width);
  assert.equal(new URL(page.url()).pathname, '/app/settings/developer');
  await expect(page.getByRole('heading', { name: 'Developer access', exact: true })).toBeVisible();
  await settingsTab(page, tabs, 'Import & export', width);
  await expect(page.getByRole('button', { name: 'Export workspace', exact: true })).toBeVisible();
  const links = names.map(name => tabs.getByRole('link', { name, exact: true }));
  for (let i = 0; i < names.length; i++) await control(links[i], names[i]);
  await separated(links, 'Settings tabs');
  if (width === 1440) for (const link of links) await insideViewport(page, link, await link.innerText());
  else {
    const affordance = await tabs.evaluate(el => {
      const r = el.getBoundingClientRect();
      const clipped = [...el.querySelectorAll('a')].some(a => { const q = a.getBoundingClientRect(); return q.left < r.right && q.right > r.right; });
      const marker = el.parentElement.querySelector('.settings-scroll-controls, [aria-label*="Scroll"], [aria-label*="scroll"], .settings-scroll-hint');
      return { overflow: el.scrollWidth > el.clientWidth, clipped, marker: marker && marker.getBoundingClientRect().width > 0 };
    });
    assert.ok(affordance.overflow && (affordance.clipped || affordance.marker), 'Mobile settings expose an obvious clipped tab or visible scroll cue');
    for (const name of ['Previous settings sections', 'More settings sections']) await control(page.getByRole('button', { name, exact: true }), name);
  }
  await labelsDoNotOverlap(page.locator('.settings-workspace'));
  await capture(page, 'settings', { fullPage: true });
  await settingsTab(page, tabs, 'Import & export', width);
  assert.equal(new URL(page.url()).pathname, '/app/settings/portability');
  const restore = page.locator('summary').filter({ hasText: /^Restore into an empty deployment$/ });
  await expect(restore).toBeVisible();
  await capture(page, 'settings-portability', { fullPage: true, prepare: () => restore.scrollIntoViewIfNeeded(), requiredControls: ['Export workspace', 'Restore into an empty deployment'] });
  await restore.click();
  await expect(page.getByRole('button', { name: 'Restore workspace', exact: true })).toBeVisible();
  await capture(page, 'settings-portability-expanded', { fullPage: true, prepare: () => page.getByRole('button', { name: 'Restore workspace', exact: true }).scrollIntoViewIfNeeded(), requiredControls: ['Restore workspace'] });
  await settingsTab(page, tabs, 'Preferences', width);
  const prefs = page.locator('.settings-panel');
  await expect(prefs.getByRole('textbox', { name: /Timezone/ })).toBeVisible();
  await checkboxBeside(prefs.getByRole('checkbox', { name: 'Keep routine activity quiet', exact: true }), 'Quiet activity');
  await checkboxBeside(prefs.getByRole('checkbox', { name: 'Start with compact navigation', exact: true }), 'Compact navigation');
  await labelsDoNotOverlap(prefs);
  await control(prefs.getByRole('button', { name: 'Save preferences', exact: true }), 'Save preferences');
  await capture(page, 'settings-preferences', { fullPage: true });
  await settingsTab(page, tabs, 'Workspace', width);
  const edit = page.getByRole('button', { name: 'Edit workspace & policies', exact: true });
  await headingGap(edit, 'Edit workspace & policies');
  await headingGap(page.getByRole('button', { name: 'Configure navigation', exact: true }), 'Configure navigation');
  await control(edit, 'Edit workspace policies'); await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Workspace settings', exact: true });
  await expect(dialog).toBeVisible();
  await labelsDoNotOverlap(dialog); await capture(page, 'settings-edit-rows', { fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function navigationAndSearch(argumentsState, width) {
  const { page, origin } = argumentsState;
  await page.goto(origin + '/app', { waitUntil: 'networkidle' });
  await openNavigation(page);
  if (width === 1440) {
    const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
    // The collapse control is an icon-only button with a tooltip, in the header row beside the workspace name.
    assert.equal((await collapse.innerText()).trim(), '', 'Collapse sidebar is icon-only');
    await expect(collapse).toHaveAttribute('data-tooltip', 'Collapse sidebar');
    await expect(page.locator('.sidebar-header').getByTestId('workspace-name')).toBeVisible();
    await expect(page.locator('.sidebar-header').getByRole('button', { name: 'Collapse sidebar', exact: true })).toBeVisible();
    await collapse.click();
    await expect(page.locator('.sidebar')).toHaveAttribute('data-collapsed', 'true');
    const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
    await expect(expand).toBeVisible();
    await control(expand, 'Collapsed Expand sidebar');
    await expect.poll(async () => (await argumentsState.api('/api/navigation')).preferences.value.sidebarCollapsed).toBe(true);
    await capture(page, 'nav-collapsed');
    await expand.click();
    await expect(page.locator('.sidebar')).toHaveAttribute('data-collapsed', 'false');
    await expect(collapse).toBeVisible();
    await expect.poll(async () => (await argumentsState.api('/api/navigation')).preferences.value.sidebarCollapsed).toBe(false);
    // Both controls are keyboard operable: focus, then Enter to collapse and Space to expand.
    await collapse.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.sidebar')).toHaveAttribute('data-collapsed', 'true');
    await expand.focus(); await page.keyboard.press('Space');
    await expect(page.locator('.sidebar')).toHaveAttribute('data-collapsed', 'false');
    await expect.poll(async () => (await argumentsState.api('/api/navigation')).preferences.value.sidebarCollapsed).toBe(false);
  }
  await capture(page, 'nav-open');
  const create = page.locator('.navigation-create').getByRole('button', { name: 'Create', exact: true });
  await create.click();
  const createMenu = page.getByRole('menu', { name: 'Create content', exact: true });
  await expect(create).toHaveAttribute('aria-expanded', 'true');
  const choices = ['Page', 'Database'].map(name => createMenu.getByRole('menuitem', { name, exact: true }));
  for (let i = 0; i < choices.length; i++) await control(choices[i], ['Page', 'Database'][i]);
  await separated(choices, 'Create menu choices');
  await capture(page, 'nav-create', { requiredControls: ['Page', 'Database'] });
  await page.keyboard.press('Escape');
  await expect(createMenu).toHaveCount(0);
  await expect(create).toHaveAttribute('aria-expanded', 'false');
  await expect(create).toBeFocused();
  const owner = page.locator('.sidebar .workrow');
  await owner.click();
  const ownerMenu = page.getByRole('menu', { name: 'Account', exact: true });
  const database = ownerMenu.getByRole('menuitem', { name: 'Sign out', exact: true });
  await expect(owner).toHaveAttribute('aria-expanded', 'true');
  await control(owner, 'Owner menu trigger');
  await control(database, 'Sign out');
  await separated([owner, database], 'Owner menu choices');
  await capture(page, 'nav-owner', { requiredControls: ['Sign out'] });
  await owner.click();
  await expect(owner).toHaveAttribute('aria-expanded', 'false');
  await expect(ownerMenu).toHaveCount(0);
  if (width === 390) {
    const backdrop = page.locator('.navigation-backdrop');
    await expect(backdrop).toBeVisible();
    const appearance = await backdrop.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, opacity: Number(getComputedStyle(el).opacity) }));
    assert.ok(appearance.bg !== 'rgba(0, 0, 0, 0)' && appearance.opacity > 0, 'Drawer backdrop is visibly shaded');
    await drawerDoesNotIntercept(page);
    const r = await backdrop.boundingBox(); assert.ok(r);
    await page.mouse.click(r.x + r.width - 4, r.y + r.height / 2);
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(backdrop).toHaveCount(0);
    await capture(page, 'nav-closed');
  }
  for (const theme of ['light', 'dark']) {
    await page.goto(origin + '/app/settings?section=appearance', { waitUntil: 'networkidle' });
    const choice = page.getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true });
    // This controlled radio updates after the real member write and resource reload.
    await choice.click();
    await expect(choice).toBeChecked();
    await expect.poll(async () => (await argumentsState.api('/api/members/current')).theme).toBe(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.goto(origin + '/app/search', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const input = page.getByRole('searchbox', { name: 'Search your workspace', exact: true });
    await input.fill('Welcome');
    const clear = page.getByRole('button', { name: 'Clear search', exact: true });
    await control(clear, 'Clear search', { padding: 6 });
    const palette = await clear.evaluate(el => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    assert.notEqual(palette.color, palette.bg, `${theme}: search clear icon contrasts with its surface`);
    await capture(page, `search-${theme}`);
    await clear.click(); await expect(input).toHaveValue(''); await expect(clear).toHaveCount(0);
    await capture(page, `search-${theme}-cleared`);
  }
  await page.goto(origin + '/app/settings?section=appearance', { waitUntil: 'networkidle' });
  const light = page.getByRole('radio', { name: 'Light', exact: true });
  await light.click();
  await expect(light).toBeChecked();
  await expect.poll(async () => (await argumentsState.api('/api/members/current')).theme).toBe('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}
