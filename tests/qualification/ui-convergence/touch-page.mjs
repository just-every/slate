import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {tap,type,reachable,checkpoint,touchReorder} from './touch-controls.mjs';

export async function touchWriteJourney({page,origin,api,containerName}) {
  await page.goto(origin+'/app',{waitUntil:'networkidle'});
  const navigation=page.getByRole('button',{name:'Open navigation',exact:true});
  if(await navigation.isVisible()) await tap(navigation);
  await tap(page.getByRole('button',{name:`Create page in ${containerName}`,exact:true}));
  await tap(page.getByRole('menuitem',{name:'Blank page',exact:true}));
  await page.waitForURL(url=>url.pathname.startsWith('/app/pages/'));
  const id=new URL(page.url()).pathname.split('/').at(-1);
  await type(page,page.getByRole('textbox',{name:'Page title',exact:true}),'Field response guide');
  const body=page.getByRole('textbox',{name:'Page body',exact:true});
  await tap(body);await page.keyboard.type('Confirm the response owner.');
  await expect.poll(async()=>JSON.stringify((await api(`/api/pages/${id}`)).blocks)).toContain('Confirm the response owner.');
  // Focus the editor first: the labeled insert control must remain reachable above the keyboard.
  await tap(page.getByRole('textbox',{name:'Paragraph',exact:true}).first());
  const add=page.getByRole('button',{name:/Add block/});
  await reachable(add);await tap(add);
  await tap(page.getByRole('option',{name:'Text',exact:true}));
  await expect(page.getByRole('textbox',{name:'Paragraph',exact:true})).toHaveCount(2);
  await type(page,page.getByRole('textbox',{name:'Paragraph',exact:true}).nth(1),'Notify the duty team.');
  await expect.poll(async()=>JSON.stringify((await api(`/api/pages/${id}`)).blocks)).toContain('Notify the duty team.');
  await checkpoint(page,'created and inserted page blocks');
  const rows=page.locator('[data-page-editor] [data-block-id]');
  const handle=rows.first().getByRole('button',{name:'Block actions for Confirm the response owner.',exact:true});
  assert.ok(await handle.evaluate(element=>Number(getComputedStyle(element.parentElement).opacity)>0),'The unfocused drag handle is visible without hover.');
  await touchReorder(page,handle,rows.nth(1));
  await expect.poll(async()=>(await api(`/api/pages/${id}`)).blocks.map(b=>(b.content.text??[]).map(s=>s.text).join('')))
    .toEqual(['Notify the duty team.','Confirm the response owner.']);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.reload({waitUntil:'networkidle'});
  await expect(page.getByRole('textbox',{name:'Paragraph',exact:true}).first()).toHaveText('Notify the duty team.');
  await checkpoint(page,'touch drag persists block order');
  console.log('NAV-006 touch create, type, insert and drag persisted');

  return id;
}

export async function touchCommentJourney({page,origin,api},id) {
  await page.goto(`${origin}/app/pages/${id}`,{waitUntil:'networkidle'});
  await tap(page.getByRole('button',{name:'Comments',exact:true}));
  await type(page,page.getByRole('textbox',{name:'Comment text',exact:true}),'Response ownership confirmed.');
  await reachable(page.getByRole('button',{name:'Send comment',exact:true}));
  await tap(page.getByRole('button',{name:'Send comment',exact:true}));
  await expect(page.locator('.comment-thread')).toContainText('Response ownership confirmed.');
  await tap(page.getByRole('button',{name:'Resolve',exact:true}));
  await expect.poll(async()=>(await api(`/api/comments/page/${id}`)).threads[0].state).toBe('resolved');
  await checkpoint(page,'comment resolved');
  console.log('NAV-006 touch comment and resolve persisted');
  await tap(page.getByRole('button',{name:'Close details ×',exact:true}));

}

export async function touchPublishShareJourney({page,origin,api},id) {
  await page.goto(`${origin}/app/pages/${id}`,{waitUntil:'networkidle'});
  // Delay the real access response, not a fixture: the page preview used to
  // enable Review before this response inserted content above its footer.
  let releaseAccess;
  const accessGate=new Promise(resolve=>{releaseAccess=resolve;});
  const accessRoute=`**/api/sharing/pages/${id}`;
  const holdAccess=async route=>{
    const response=await route.fetch();
    await accessGate;
    await route.fulfill({response});
  };
  const phone=page.viewportSize().width===390;
  if(phone)await page.route(accessRoute,holdAccess);
  const accessReady=phone?page.waitForRequest(request=>request.method()==='GET'&&new URL(request.url()).pathname===`/api/sharing/pages/${id}`,{timeout:15000}):null;
  try {
  await tap(page.getByRole('button',{name:'More',exact:true}));
  await tap(page.getByRole('menuitem',{name:'Publish workspace revision',exact:true}));
  const publication=page.getByRole('dialog',{name:'Publish this revision',exact:true});
  if(phone){
    await accessReady;
    await expect(publication.getByRole('button',{name:'Review publication',exact:true})).toBeDisabled();
    releaseAccess();
  }
  await expect(publication.getByRole('region',{name:'Workspace publication preview'})).toContainText('Notify the duty team.');
  await expect(publication.getByRole('region',{name:'Current publication access',exact:true})).toBeVisible();
  await reachable(publication.getByRole('button',{name:'Review publication',exact:true}));
  await checkpoint(page,'publication preview with current access');
  await tap(publication.getByRole('button',{name:'Review publication',exact:true}));
  await expect(publication.getByRole('region',{name:'Reviewed publication'})).toBeVisible();
  await checkpoint(page,'reviewed publication');
  await tap(publication.getByRole('button',{name:'Publish workspace revision',exact:true}));
  await expect(publication).not.toBeVisible();
  await expect.poll(async()=>(await api(`/api/pages/${id}`)).page.lifecycle).toBe('live');
  assert.ok((await api(`/api/pages/${id}`)).publishedRevisionId);

  await tap(page.getByRole('button',{name:'Share',exact:true}));
  const invite=page.getByRole('combobox',{name:'Invite someone',exact:true});
  await tap(invite);await invite.selectOption('member:browser-owner');
  const permission=page.getByRole('combobox',{name:'Permission',exact:true});
  await tap(permission);await permission.selectOption('view');
  await tap(page.getByRole('button',{name:'Share page',exact:true}));
  await expect.poll(async()=>(await api(`/api/sharing/pages/${id}`)).items.some(g=>g.principalId==='browser-owner'&&!g.revokedAt)).toBe(true);
  await checkpoint(page,'published and shared page');
  console.log('NAV-006 touch workspace publication and sharing persisted');
  return id;
  } finally {
    releaseAccess();
    if(phone)await page.unroute(accessRoute,holdAccess);
  }
}
