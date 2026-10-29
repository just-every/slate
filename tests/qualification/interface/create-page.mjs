/**
 * A page is created at once from the global Create menu while its destination space is open, so the
 * space view supplies the destination. The default title arrives selected and is replaced by typing.
 */
export async function createPage(page, origin, containerId, title) {
  await page.goto(origin + '/app/containers/' + containerId, { waitUntil: 'networkidle' });
  const navigation=page.getByRole('button',{name:'Open navigation',exact:true});
  if(await navigation.isVisible())await navigation.click();
  await page.locator('aside.sidebar').getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('menu', { name: 'Create content', exact: true }).getByRole('menuitem', { name: 'Page', exact: true }).click();
  await page.waitForURL(url => url.pathname.startsWith('/app/pages/'));
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const field = page.getByRole('textbox', { name: 'Page title', exact: true });
  await field.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Page title');
  await page.keyboard.type(title);
  await field.press('Tab');
  await page.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
  return id;
}
