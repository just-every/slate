import assert from 'node:assert/strict';
import {api,op} from './support.mjs';
import {writeFile} from 'node:fs/promises';
export async function discoveryBrowserChecks({r,owner,context,check}){
 const container=(await api(r,'/api/containers',owner)).data.items.find(c=>c.visibility==='default');assert.ok(container);
 const created=await api(r,'/api/pages',owner,{operationKey:op(),containerId:container.id,title:'Browser search qualification sentinel'});assert.equal(created.status,200);const id=created.data.value.pageId;
 const page=await context.newPage();const probe=(clauses,id,fn)=>check(clauses,id,async()=>{try{await fn();}catch(error){await writeFile(r.directory+'/'+id+'-failure.txt',await page.locator('body').ariaSnapshot());await page.screenshot({path:r.directory+'/'+id+'-failure.png',fullPage:true});throw error;}});try{
 await probe(['SEARCH-006'],'container-entry-prefills-visible-search-scope',async()=>{
 await page.goto(r.origin+'/app/containers/'+container.id);await page.getByRole('link',{name:'Search this space',exact:true}).click();await page.waitForURL('**/app/search?containerId=*');await page.getByRole('button',{name:'Filter results',exact:true}).click();await page.getByRole('combobox',{name:'Space',exact:true}).locator(`option[value="${container.id}"]`).waitFor({state:'attached'});assert.equal(await page.getByRole('combobox',{name:'Space',exact:true}).inputValue(),container.id);
 });
 await probe(['SEARCH-001'],'search-result-marks-and-routed-text-highlight',async()=>{
 await page.getByRole('searchbox',{name:'Search your workspace',exact:true}).fill('Browser search qualification sentinel');await page.getByRole('button',{name:'Search',exact:true}).click();const result=page.locator('.search-results a').filter({hasText:'Browser search qualification sentinel'});await result.waitFor();assert.ok(await result.locator('mark').count()>0);await result.click();await page.waitForURL('**/app/pages/'+id+'?highlight=*');await page.locator('[data-search-context]').waitFor();await page.waitForFunction(()=>CSS.highlights?.get('search-match')?.size>0);assert.equal((await api(r,'/api/pages/'+id,owner)).data.page.title,'Browser search qualification sentinel');await page.screenshot({path:r.directory+'/search-highlight-page.png',fullPage:true});
 });
 await probe(['SEARCH-007'],'no-results-restates-query-filters-clear-and-creates-persisted-page',async()=>{
 await page.goto(r.origin+'/app/search?containerId='+container.id);await page.getByRole('button',{name:'Filter results',exact:true}).click();await page.getByRole('combobox',{name:'Look in',exact:true}).selectOption('page');const title='Absent qualification browser page';await page.getByRole('searchbox',{name:'Search your workspace',exact:true}).fill(title);await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('No matches for “'+title+'”.',{exact:true}).waitFor();assert.match(await page.getByText(/^Filters:/).innerText(),/page.*containerId:/);
 await page.getByRole('button',{name:'Clear all filters',exact:true}).click();await page.getByText('Filters: None',{exact:true}).waitFor();assert.equal(await page.getByRole('searchbox',{name:'Search your workspace',exact:true}).inputValue(),title);
 await page.getByRole('button',{name:'Create a page titled “'+title+'”',exact:true}).click();await page.waitForURL('**/app/pages/*');const newId=new URL(page.url()).pathname.split('/').at(-1);const created=(await api(r,'/api/pages/'+newId,owner)).data;assert.equal(created.page.title,title);assert.equal((await api(r,'/api/containers',owner)).data.items.find(item=>item.id===created.page.containerId)?.permissions.canCreatePages,true);await page.screenshot({path:r.directory+'/search-created-page.png',fullPage:true});
 });
 await probe(['ACT-004'],'activity-create-entry-navigates-to-actual-originating-page',async()=>{
 await page.goto(r.origin+'/app/settings?section=activity');await page.getByRole('heading',{name:'What changed.',exact:true}).waitFor();const item=page.locator('.settings-list > li').filter({hasText:'pages create'}).filter({has:page.locator(`a[href^="/app/pages/${id}?"]`)});const link=item.getByRole('link',{name:'Open page',exact:true});await link.waitFor();assert.match(await item.innerText(),/pages create/);assert.ok(await item.locator('time').getAttribute('datetime'));await link.click();await page.waitForURL(url=>url.pathname==='/app/pages/'+id);assert.equal((await api(r,'/api/pages/'+id,owner)).data.page.title,'Browser search qualification sentinel');
 });
 }finally{await page.close();}
}
