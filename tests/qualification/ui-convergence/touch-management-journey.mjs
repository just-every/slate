import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {tap,type,checkpoint} from './touch-controls.mjs';

/** Owner-only settings stay owner-only; their interaction is still tested by touch. */
export async function touchManagementJourney(state,touch){
 const {page,origin,api,containerId}=touch;
 await page.goto(`${origin}/app/containers/${containerId}`,{waitUntil:'networkidle'});
 const navigation=page.getByRole('navigation',{name:'Space navigation',exact:true});
 await tap(navigation.getByRole('button',{name:'Settings',exact:true}));
 await tap(page.getByRole('button',{name:'Edit details',exact:true}));
 const details=page.getByRole('dialog',{name:'Space details',exact:true});
 await type(page,details.getByRole('textbox',{name:'Description',exact:true}),'Response guides maintained by the duty team.');
 await checkpoint(page,'space details edit');
 await tap(details.getByRole('button',{name:'Save settings',exact:true}));
 await expect(details).toBeHidden();
 await expect.poll(async()=>(await api(`/api/containers/${containerId}`)).description).toBe('Response guides maintained by the duty team.');
 await checkpoint(page,'space details saved');

 await page.goto(origin+'/app/templates',{waitUntil:'networkidle'});
 await tap(page.getByRole('button',{name:'Filter templates',exact:true}));
 await type(page,page.getByRole('textbox',{name:'Category',exact:true}),'Meetings');
 await page.keyboard.press('Escape');
 await tap(page.locator('.template-choice').filter({has:page.getByRole('heading',{name:'Meeting notes',exact:true})}));
 await expect(page.locator('.template-preview')).toContainText('Action items');
 await checkpoint(page,'template preview');
 await tap(page.getByRole('button',{name:'Use this template',exact:true}));
 const use=page.getByRole('dialog',{name:'Use this template',exact:true});
 await tap(use.getByRole('combobox',{name:/^Create in/}));
 await use.getByRole('combobox',{name:/^Create in/}).selectOption({label:touch.containerName});
 await tap(use.getByRole('button',{name:'Create page',exact:true}));
 await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Meeting notes');
 const templatePage=new URL(page.url()).pathname.split('/').at(-1);
 const templateDocument=await api(`/api/pages/${templatePage}`);
 assert.ok(templateDocument.blocks.some(block=>block.blockType==='task'));
 const templateLifecycle=templateDocument.page.lifecycle;
 await checkpoint(page,'template used by touch');
 // Archive this real template copy, then restore it through the archive surface.
 await tap(page.getByRole('button',{name:'More',exact:true}));
 await tap(page.getByRole('menuitem',{name:'Archive page',exact:true}));
 const archive=page.getByRole('dialog',{name:'Archive this page?',exact:true});
 await type(page,archive.getByRole('textbox',{name:'Reason',exact:true}),'Meeting completed.');
 await tap(archive.getByRole('button',{name:'Confirm',exact:true}));
 await expect(archive).toBeHidden();
 await page.goto(origin+'/app/archive',{waitUntil:'networkidle'});
 const row=page.locator('.archive-list li').filter({hasText:'Meeting notes'});
 await expect(row).toContainText('Meeting completed.');
 await checkpoint(page,'archive populated');
 await tap(row.getByRole('button',{name:'Restore',exact:true}));
 await expect(row).toHaveCount(0);
 assert.equal((await api(`/api/pages/${templatePage}`)).page.lifecycle,templateLifecycle);
 await checkpoint(page,'archive restored');

 const ownerContext=await state.context.browser().newContext({viewport:page.viewportSize(),hasTouch:true,isMobile:page.viewportSize().width===390,storageState:await state.context.storageState(),locale:'en-US'});
 const errors=[];
 try{
  const owner=await ownerContext.newPage();
  owner.on('pageerror',cause=>errors.push(String(cause)));
  owner.on('requestfailed',request=>errors.push(request.failure()?.errorText));
  owner.on('response',response=>{if(response.status()>=400)errors.push(`${new URL(response.url()).pathname}: ${response.status()}`);});
  owner.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const who=await ownerContext.request.get(origin+'/api/members/current');assert.equal((await who.json()).role,'owner');
  const before=await state.api('/api/workspace');
  await owner.goto(origin+'/app/settings?section=workspace',{waitUntil:'networkidle'});
  await tap(owner.getByRole('button',{name:'Edit workspace & policies',exact:true}));
  const settings=owner.getByRole('dialog',{name:'Workspace settings',exact:true});
  await type(owner,settings.getByRole('textbox',{name:'Description',exact:true}),'A handbook for the response team.');
  await checkpoint(owner,'workspace settings edit');
  await tap(settings.getByRole('button',{name:'Save settings',exact:true}));
  await expect(settings).toBeHidden();
  await expect.poll(async()=>(await state.api('/api/workspace')).description).toBe('A handbook for the response team.');
  await checkpoint(owner,'workspace settings saved');
  assert.deepEqual(errors,[],'Owner touch settings have no browser errors or failed requests.');
  // Return just the authored description so unrelated desktop settings steps retain their fixture.
  const current=await state.api('/api/workspace');
  await ownerContext.request.put(origin+'/api/workspace',{data:{operationKey:randomUUID(),expectedRevisionId:current.revisionId,name:current.name,mark:current.mark,description:before.description,guestAccess:current.guestAccess,publicLinkAccess:current.publicLinkAccess,anonymousAccess:current.anonymousAccess,policies:current.policies}}).then(async response=>assert.equal(response.status(),200,await response.text()));
 }finally{await ownerContext.close();}
 console.log('NAV-006 touch space management, templates, archive and owner workspace settings passed');
}
