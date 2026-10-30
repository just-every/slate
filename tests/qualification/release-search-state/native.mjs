import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {createRuntime} from '../local/runtime.mjs';
import {fixtureFirstOwner} from '../local/first-owner.mjs';
import {api, op, actor, pageFixture} from '../core/support.mjs';
import {traceSearch} from './trace.mjs';

const receipts=[];let r,browser,flush;
async function check(id,run) {
 try {await run();receipts.push({id,outcome:'pass'});}
 catch(error) {receipts.push({id,outcome:'fail',error:error.stack});process.exitCode=1;}
 console.log(receipts.at(-1));
}
try {
 r=await createRuntime({root:process.env.QUAL_ROOT??process.cwd(),evidence:process.env.QUAL_EVIDENCE,appPort:Number(process.env.QUAL_APP_PORT),inspectorPort:Number(process.env.QUAL_INSPECTOR_PORT)});
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 flush=await traceSearch(context,r.directory);
 await fixtureFirstOwner(r,context);const owner=(await context.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
 const container=(await api(r,'/api/containers',owner)).data.items.find(item=>item.visibility==='default');
 const title='Hydration & search + retained / title';
 await check('SEARCH-003 SEARCH-007: early native search input survives hydration and creates exactly its title',async()=>{
  const page=await context.newPage();let release;
  const held=new Promise(resolve=>release=resolve);
  const delayScripts=async route=>{if(route.request().resourceType()==='script')await held;await route.continue();};
  await page.route('**/assets/**',delayScripts);
  try {
   const ready=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/search/saved' && response.status()===200);
   await page.goto(r.origin+'/app/search?containerId='+container.id,{waitUntil:'commit'});
   const query=page.getByRole('searchbox',{name:'Search your workspace',exact:true});
   await query.waitFor();
   // The kind sits in the Filter menu, which opens once its handlers exist; the query is typed early.
   const earlyActions=query.fill(title);
   // Exercise a slow real script delivery. No response is replaced and no product deadline changes.
   await new Promise(resolve=>setTimeout(resolve,250));release();
   await earlyActions;
   await page.getByRole('button',{name:'Filter results',exact:true}).click();
   await page.getByRole('combobox',{name:'Look in',exact:true}).selectOption('page');
   await ready;
   await page.getByRole('button',{name:'Search',exact:true}).click();
   await expect(query).toHaveValue(title);
   await expect(page.locator('.search-filter-summary')).toContainText('Pages');
   await page.getByText('No matches for “'+title+'”.',{exact:true}).waitFor();
   assert.match(await page.getByText(/^Filters:/).innerText(),/page.*containerId:/);
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:r.directory+'/no-results-'+width+'.jpg',fullPage:true});
   }
   await page.getByRole('button',{name:'Clear all filters',exact:true}).click();
   await page.getByText('Filters: None',{exact:true}).waitFor();
   await expect(query).toHaveValue(title);
   assert.deepEqual([...new URL(page.url()).searchParams], [['q',title]]);
   await page.getByRole('button',{name:'Create a page titled “'+title+'”',exact:true}).click();
   await page.waitForURL('**/app/pages/*');
   const id=new URL(page.url()).pathname.split('/').at(-1);
   const created=(await api(r,'/api/pages/'+id,owner)).data;
   assert.equal(created.page.title,title);
   assert.equal(created.page.containerId,container.id);
   assert.equal((await api(r,'/api/containers',owner)).data.items.find(item=>item.id===created.page.containerId)?.permissions.canCreatePages,true);
   assert.equal((await api(r,'/api/search?q='+encodeURIComponent('"'+title+'"'),owner)).data.total,1);
  } catch(error) {
   await writeFile(r.directory+'/early-input-failure.txt',await page.locator('body').ariaSnapshot());
   await page.screenshot({path:r.directory+'/early-input-failure.png',fullPage:true});throw error;
  } finally {release();await page.unroute('**/assets/**',delayScripts);await page.close();}
 });
 await check('SEARCH-003 SEARCH-005: URL filters persist through reload and back/forward without authority fields',async()=>{
  const page=await context.newPage();
  try {
   const query='Qualification first page';
   const params=new URLSearchParams({q:query,kind:'page',containerId:container.id,contributorId:'qualification-owner',includeArchived:'true',updatedFrom:'2020-01-01',updatedTo:'2099-01-01',includeTrashed:'true',isAdmin:'true',results:'forged private text'});
   await page.goto(r.origin+'/app/search?'+params);
   const result=page.locator('.search-results a').filter({hasText:query});await result.waitFor();
   await page.getByRole('button',{name:'Filter results',exact:true}).click();
   await expect(page.getByRole('searchbox',{name:'Search your workspace',exact:true})).toHaveValue(query);
   await expect(page.getByRole('combobox',{name:'Look in',exact:true})).toHaveValue('page');
   await expect(page.getByRole('checkbox',{name:'Include archive',exact:true})).toBeChecked();
   await expect(page.getByRole('combobox',{name:'Space',exact:true})).toHaveValue(container.id);
   await expect(page.getByRole('combobox',{name:'Contributor',exact:true})).toHaveValue('qualification-owner');
   await expect(page.getByLabel('Updated from',{exact:true})).toHaveValue('2020-01-01');
   await expect(page.getByLabel('Updated until',{exact:true})).toHaveValue('2099-01-01');
   await expect(page.getByRole('checkbox',{name:'Include trash',exact:true})).toBeChecked();
   const retained=page.url();assert.equal(new URL(retained).searchParams.has('isAdmin'),false);assert.equal(new URL(retained).searchParams.has('results'),false);
   await page.reload();await result.waitFor();assert.equal(page.url(),retained);
   await result.click();await page.waitForURL('**/app/pages/*?highlight=*');const destination=page.url();
   await page.goBack();await result.waitFor();assert.equal(page.url(),retained);
   await expect(page.getByRole('searchbox',{name:'Search your workspace',exact:true})).toHaveValue(query);
   await page.getByRole('button',{name:'Filter results',exact:true}).click();
   await expect(page.getByRole('combobox',{name:'Look in',exact:true})).toHaveValue('page');
   await page.goForward();await page.waitForURL(destination);
  } finally {await page.close();}
 });
 await check('SEARCH-005: retained URL does not recover revoked read access or enable flagship answers',async()=>{
  const reader=await actor(r,'search-state-reader');
  const restricted='search-state-private';await pageFixture(r,restricted,{title:'Private search state sentinel',restricted:true});
  const grant=await api(r,'/api/sharing',owner,{operationKey:op(),targetKind:'page',targetId:restricted,principalKind:'member',principalId:'search-state-reader',level:'view'});assert.equal(grant.status,200);
  const readerContext=await browser.newContext();
  await readerContext.addCookies([{name:'slate_session',value:reader.slice('slate_session='.length),url:r.origin}]);
  const page=await readerContext.newPage();
  try {
   const url=r.origin+'/app/search?'+new URLSearchParams({q:'Private search state sentinel',kind:'page',isAdmin:'true',results:'Private search state sentinel'});
   await page.goto(url);await page.locator('.search-results a').filter({hasText:'Private search state sentinel'}).waitFor();
   const revoke=await api(r,'/api/sharing',owner,{operationKey:op(),targetKind:'page',targetId:restricted,id:grant.data.value.id,principalKind:'member',principalId:'search-state-reader',level:'view',revoke:true});assert.equal(revoke.status,200);
   await page.reload();await page.getByText('No matches for “Private search state sentinel”.',{exact:true}).waitFor();
   assert.equal(await page.locator('.search-results').count(),0);
   assert.equal((await api(r,'/api/search?q=Private&isAdmin=true',reader)).data.total,0);
   assert.equal(await page.getByRole('button',{name:'Ask',exact:true}).count(),0);
   assert.equal((await api(r,'/api/search?q=Private','')).status,401);
  } finally {await readerContext.close();}
 });
 await writeFile(r.directory+'/native.json',JSON.stringify({artifact:r.artifact.artifactHash,commit:r.artifact.commit,receipts,limits:'Real local Worker/D1/browser; synthetic identity and content fixtures only; no provider delivery or release acceptance.'},null,2));
 console.log(r.directory);
}finally{await browser?.close();await flush?.();await r?.close();}
