import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {ok} from './two-people-support.mjs';
import {accessible} from './browser-evidence.mjs';

/** The browser calls one unfiltered native search over every retained kind. */
export async function mixedSearchJourney(state) {
 const {page,context,origin,api}=state,query='Prismneedle';
 const mutate=(path,data)=>ok(context,origin,'POST','/api'+path,{operationKey:crypto.randomUUID(),...data});
 const createdSpace=await mutate('/containers',{name:'Cross-kind operations',description:'Purpose of the cross-kind search space',visibility:'default'});
 const space=createdSpace.value.id;
 await ok(context,origin,'PATCH','/api/containers/'+space,{operationKey:crypto.randomUUID(),expectedRevisionId:createdSpace.receipt.revisionId,description:query+' retained space description'});
 const create=async(title,text)=>(await mutate('/pages',{containerId:space,title,blocks:[{id:crypto.randomUUID(),blockType:'paragraph',treePosition:'a',content:{text:[{text}]}}]})).value.pageId;
 const titlePage=await create(query,'Title-only page with a distinct retained body.');
 const bodyPage=await create('Retained body guide',query+' retained page body for release preparation.');
 const database=(await mutate('/databases',{containerId:space,title:'Search corpus records'})).value;
 const field={id:crypto.randomUUID(),name:'Details',type:'text',config:{},position:0};
 await mutate('/databases/'+database.id+'/fields',{expectedRevisionId:database.revisionId,field});
 const record=(await mutate('/databases/'+database.id+'/records',{title:'Retained field record',values:{[field.id]:query+' retained field value'}})).value;
 const comment=(await mutate('/comments/page/'+titlePage,{body:[{text:query+' retained comment body'}]})).value;
 const template=(await mutate('/templates',{sourcePageId:bodyPage,includeChildren:false,containerId:space,title:query+' template',description:'Reusable retained description',category:'General'})).value;
 const expectedIds=[titlePage,bodyPage,record.pageId,space,comment.threadId,template.id].sort();
 const actual=await api('/api/search?'+new URLSearchParams({q:query}));
 assert.equal(actual.total,6);assert.deepEqual(actual.items.map(item=>item.id).sort(),expectedIds);
 await page.goto(origin+'/app/search',{waitUntil:'networkidle'});
 await page.getByRole('searchbox',{name:'Search your workspace',exact:true}).fill(query);
 await page.getByRole('button',{name:'Search',exact:true}).click();
 const results=page.locator('.search-results > li');
 await expect(results).toHaveCount(6);
 await expect.poll(async()=>(await results.locator('.eyebrow').allTextContents()).sort()).toEqual(['Comment','Page','Page','Record','Space','Template']);
 const titles=[query,'Retained body guide','Retained field record','Cross-kind operations','Comment on '+query,query+' template'].sort();
 await expect.poll(async()=>(await results.locator('h2').allTextContents()).sort()).toEqual(titles);
 for(const text of ['retained page body','retained field value','retained comment body'])await expect(results).toContainText([new RegExp(text)]);
 await expect(page.locator('main')).toContainText('6 results');
 await accessible(page,'mixed-kind global search');
 await page.reload({waitUntil:'networkidle'});
 await expect.poll(async()=>(await results.locator('h2').allTextContents()).sort()).toEqual(titles);
 assert.equal(new URL(page.url()).searchParams.get('q'),query);
}
