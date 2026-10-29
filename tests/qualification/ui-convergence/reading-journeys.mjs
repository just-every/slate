import assert from 'node:assert/strict';
import {themeJourney} from './theme-journey.mjs';
import {activityContextJourney} from './activity-context-journey.mjs';
import {guestConsoleJourney} from './guest-console-journey.mjs';
import { expect } from '@playwright/test';
import { accessible } from './browser-support.mjs';
import { compactPage } from './browser-evidence.mjs';
import {searchFiltersJourney} from './search-filters-journey.mjs';
import {mixedSearchJourney} from './mixed-search-journey.mjs';

export async function searchJourney(state, pageId) {
  const {page,origin,journeyTitle,searchTerm}=state;
  await page.goto(origin + '/app/search', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).not.toContainText(/A thought away\.|FIND SOMETHING WORTH KEEPING/);
  await page.getByRole('searchbox', { name: 'Search your workspace', exact: true }).fill(searchTerm);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const result = page.locator('.search-results a').filter({ has: page.getByRole('heading', { name: journeyTitle, exact: true }) });
  await expect(result).toBeVisible();
  await expect(result.locator('p')).toContainText('Second block: record the next action.');
  await expect(result.locator('p mark')).toContainText(searchTerm);
  await expect(result.locator('.eyebrow')).toHaveText('Page');
  const markColor = await result.locator('mark').first().evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(markColor, 'rgb(255, 255, 0)', 'Search matches use the application highlight treatment.');
  await page.locator('.search-options summary').first().click();
  const archive = page.getByLabel('Include archive', { exact: true });
  await expect(archive).toBeVisible();
  const checkboxLayout = await archive.evaluate(element => { const label = element.closest('label'); return { display: getComputedStyle(label).display, gap: parseFloat(getComputedStyle(label).gap), height: label.getBoundingClientRect().height }; });
  assert.ok(['flex', 'inline-flex'].includes(checkboxLayout.display) && checkboxLayout.gap >= 4, 'Archive checkbox is separated and styled.');
  const saveSearch = await page.getByRole('button', { name: 'Save this search', exact: true }).boundingBox();
  assert.ok(saveSearch && saveSearch.height >= 32, 'Save search has a button affordance.');
  const searchLayout = await page.evaluate(() => ({
    input: document.querySelector('.search-form').getBoundingClientRect().bottom,
    result: document.querySelector('.search-results').getBoundingClientRect().top,
    options: document.querySelector('.search-options').getBoundingClientRect().top,
  }));
  assert.ok(searchLayout.result >= searchLayout.input && searchLayout.result < searchLayout.options, 'Results follow the search input before options disclosures.');
  await accessible(page, 'search results');
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/app/pages/${pageId}\\?`));
  await expect(page.getByRole('status').filter({ hasText: /Matches highlighted/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => CSS.highlights.get('search-match')?.size ?? 0)).toBeGreaterThan(0);
  await compactPage(page);
  await accessible(page, 'opened search match');
  await page.getByRole('button', { name: 'Clear highlights', exact: true }).click();
  await expect(page.locator('[data-search-context]')).toHaveCount(0);
  await page.goBack({ waitUntil: 'networkidle' });
  await expect(page.getByRole('searchbox', { name: 'Search your workspace', exact: true })).toHaveValue(searchTerm);
  assert.equal(new URL(page.url()).searchParams.get('q'), searchTerm);
  await expect(result).toBeVisible();
  await accessible(page, 'search Back preserves query');
  await page.getByRole('searchbox', { name: 'Search your workspace', exact: true }).fill(`nomatches${searchTerm}`);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.search-empty')).toContainText('Filters: None');
  await expect(page.getByRole('button', { name: 'Clear all filters', exact: true })).toHaveCount(0);
  const create = page.getByRole('button', { name: /Create a page titled/ });
  assert.ok(await create.evaluate(element => element.classList.contains('primary-button')));
  await accessible(page, 'search no match');
  await searchFiltersJourney(state);
  await mixedSearchJourney(state);
}

export async function settingsJourney(state, width) {
  const {page,origin}=state;
  await page.goto(origin + '/app/settings', { waitUntil: 'networkidle' });
  const tabs = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Workspace', exact: true })).toHaveAttribute('aria-current', 'page');
  const headingLayout = await page.locator('.settings-panel').evaluate(panel => {
    // The ad-hoc eyebrow above the heading is gone (one shared header system); the heading still sits clear of the line after it.
    const heading = panel.querySelector('h2').getBoundingClientRect();
    const content = panel.querySelector('h3').getBoundingClientRect();
    return heading.bottom <= content.top;
  });
  assert.ok(headingLayout, 'Settings heading and adjacent lines do not overlap.');
  if (width === 390) {
    const lines = await tabs.locator('a').evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().top))).size);
    assert.ok(lines <= 2, 'Mobile settings navigation avoids a four-row tab wall.');
  }
  await accessible(page, 'workspace settings');
  await tabs.getByRole('link', { name: 'Workspace', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(tabs.getByRole('link', { name: 'People', exact: true })).toBeFocused();
  const focusStyle = await tabs.getByRole('link', { name: 'People', exact: true }).evaluate(element => ({
    width: parseFloat(getComputedStyle(element).outlineWidth), style: getComputedStyle(element).outlineStyle,
  }));
  assert.ok(focusStyle.width > 0 && focusStyle.style !== 'none', 'Settings keyboard focus is visible.');
  await tabs.getByRole('link', { name: 'Spaces', exact: true }).click();
  await expect(tabs.getByRole('link', { name: 'Spaces', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.spaces-workspace').getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/\bContainers?\b/);
  await accessible(page, 'space settings');
  await guestConsoleJourney(state);
  await themeJourney(state, width);
  if(width===1440)await activityContextJourney(state);
}
