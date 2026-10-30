import { expect } from '@playwright/test';
import { accessible, openNavigation } from './browser-support.mjs';

export async function secondaryCreateDestinations({ page, origin }) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Database', exact: true }).click();
  const database = page.getByRole('dialog', { name: 'Create a database', exact: true });
  await expect(database.getByRole('combobox', { name: 'Space', exact: true })).toBeVisible();
  await expect(database).not.toContainText(/\bContainers?\b/);
  await accessible(page, 'create database');
  await database.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Space', exact: true }).click();
  const space = page.getByRole('dialog', { name: 'Create a space', exact: true });
  await expect(space).toBeVisible();
  await expect(space).not.toContainText(/\bContainers?\b/);
  await accessible(page, 'create space');
  await space.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto(origin + '/app', { waitUntil: 'networkidle' });
  await openNavigation(page);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Page from template', exact: true }).click();
  await expect(page).toHaveURL(origin + '/app/templates');
  await expect(page.locator('.topbar').getByText('Templates', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter templates', exact: true })).toBeVisible();
  await accessible(page, 'page from template destination');
  await page.goto(origin + '/app', { waitUntil: 'networkidle' });
  await openNavigation(page);
}
