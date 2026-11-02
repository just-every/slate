import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible} from './browser-support.mjs';
import {call,ok} from './two-people-support.mjs';

/** A populated native timeline, not a list of successful filter responses. */
export async function activityRetrievalJourney(state,width){
 const {page,context,origin,api}=state;
 const mutate=(method,path,data)=>ok(context,origin,method,path,{operationKey:randomUUID(),...data});
 const space=(await mutate('POST','/api/containers',{name:'Timeline handbook',visibility:'private'})).value.id;
 const other=(await mutate('POST','/api/containers',{name:'Timeline projects',visibility:'private'})).value.id;
 const access=await mutate('POST','/api/sharing',{targetKind:'container',targetId:space,principalKind:'member',principalId:'browser-reader',level:'edit'});
 const events=[];
 const remember=(result,time)=>{events.push({id:result.receipt.activityId,time});return result;};
 const first=remember(await mutate('POST','/api/pages',{containerId:space,title:'Timeline opening guide'}),'2000-01-02T12:00:00.000Z');
 const pageId=first.value.pageId;
 const elsewhere=remember(await mutate('POST','/api/pages',{containerId:other,title:'Timeline project notes'}),'2000-01-02T12:01:00.000Z');
 await state.switchIdentity('reader');
 const reader=remember(await mutate('POST','/api/pages',{containerId:space,title:'Timeline member notes'}),'2000-01-02T12:02:00.000Z');
 await state.switchIdentity('owner');
 const discussion=remember(await mutate('POST',`/api/comments/page/${pageId}`,{body:[{text:'Confirm the next handover.'}]}),'2000-01-02T12:03:00.000Z');
 const edits=[];
 let revision=first.value.revisionId;
 for(let index=0;index<(width===1440?61:2);index++){
  const result=remember(await mutate('PATCH',`/api/pages/${pageId}`,{expectedRevisionId:revision,properties:{title:`Timeline guide edition ${index+1}`}}),new Date(Date.UTC(2000,0,2,12,4+index)).toISOString());
  revision=result.value.revisionId;edits.push(result);
 }
 // The records and their audit entries were created through native HTTP. Only
 // historical clock values change, with the Worker stopped during the fixture.
 await page.goto('about:blank');
 await state.atRest(events.map(event=>`UPDATE activity_entries SET occurred_at='${event.time}' WHERE id='${event.id}';`).join('\n'));
 await page.goto(`${origin}/app/settings?section=activity`,{waitUntil:'networkidle'});
 const panel=page.locator('.settings-panel').filter({has:page.getByRole('heading',{name:'What changed.',exact:true})});
 const rows=panel.getByRole('list',{name:'Activity timeline'}).locator('li');
 const localDate=iso=>page.evaluate(value=>{const date=new Date(value),part=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${part(date.getMonth()+1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;},iso);
 const filter=async(values={})=>{
  for(const name of ['Person','Space','Kind'])await panel.getByRole('combobox',{name,exact:true}).selectOption(values[name]??'');
  for(const name of ['Action','From','Until'])await panel.getByLabel(name,{exact:true}).fill(values[name]??'');
  const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/activity'&&response.status()===200);
  await panel.getByRole('button',{name:'Filter activity',exact:true}).click();await loaded;
 };
 const check=async(expected)=>{await expect.poll(()=>rows.evaluateAll(elements=>elements.map(element=>element.dataset.activityId))).toEqual(expected.map(result=>result.receipt.activityId));};
 const start=await localDate('2000-01-02T12:00:00.000Z'),end=await localDate('2000-01-02T14:00:00.000Z');
 await filter({From:start,Until:end,Action:'pages.create'});
 await check([reader,elsewhere,first]);
 await accessible(page,'populated activity retrieval');
 if(width===390)return;
 await filter({From:start,Until:end,Person:'browser-reader'});await check([reader]);
 await filter({From:start,Until:end,Space:other});await check([elsewhere]);
 await filter({From:start,Until:end,Kind:'comment-thread'});await check([discussion]);
 await expect(rows).toContainText('comment thread');
 await filter({From:await localDate('2000-01-02T12:02:00.000Z'),Until:end,Action:'pages.create'});await check([reader]);
 await filter({From:start,Until:await localDate('2000-01-02T12:01:00.000Z'),Action:'pages.create'});await check([elsewhere,first]);
 await filter({Person:'browser-owner',Space:space,Kind:'page',Action:'pages.create',From:start,Until:await localDate('2000-01-02T12:02:00.000Z')});await check([first]);
 // Three cursor pages retain the original matching events while native edits
 // arrive after each page. Expected identities come from committed receipts.
 await filter({From:start,Action:'pages.update',Kind:'page',Space:space});
 const expected=[...edits].reverse(),seen=[];
 for(let index=0;index<3;index++){
  const slice=expected.slice(index*30,index*30+30);await check(slice);
  seen.push(...await rows.evaluateAll(elements=>elements.map(element=>element.dataset.activityId)));
  const arriving=await mutate('PATCH',`/api/pages/${pageId}`,{expectedRevisionId:revision,properties:{title:`Timeline arriving edition ${index+1}`}});revision=arriving.value.revisionId;
  if(index<2){const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/activity'&&response.status()===200);await panel.getByRole('button',{name:'Earlier activity',exact:true}).click();await loaded;}
 }
 assert.deepEqual(seen,expected.map(result=>result.receipt.activityId));assert.equal(new Set(seen).size,61);
 await expect(panel.getByRole('button',{name:'Earlier activity',exact:true})).toHaveCount(0);
 await panel.getByRole('button',{name:'Newest activity',exact:true}).click();
 await expect.poll(()=>rows.count()).toBe(30);
 // A readable matching event opens the exact native page. Revoke that access
 // while a stale link is on screen and prove both open and retrieval refuse it.
 await state.switchIdentity('reader');
 await page.reload({waitUntil:'networkidle'});
 await filter({From:start,Until:await localDate('2000-01-02T12:00:00.000Z'),Action:'pages.create'});await check([first]);
 const link=rows.getByRole('link',{name:'Open page',exact:true});
 await expect(link).toHaveAttribute('href',`/app/pages/${pageId}?${new URLSearchParams({detail:'history',revision:first.value.revisionId})}`);
 await link.click();await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Timeline arriving edition 3');
 await page.goBack({waitUntil:'networkidle'});
 await filter({From:start,Until:await localDate('2000-01-02T12:00:00.000Z'),Action:'pages.create'});await check([first]);
 await state.switchIdentity('owner');
 await mutate('POST','/api/sharing',{id:access.value.id,targetKind:'container',targetId:space,principalKind:'member',principalId:'browser-reader',level:'edit',revoke:true});
 await state.switchIdentity('reader');
 assert.equal((await call(context,origin,'GET',`/api/pages/${pageId}`)).status,404);
 await link.click();await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveCount(0);
 await page.goto(`${origin}/app/settings?section=activity`,{waitUntil:'networkidle'});
 await filter({From:start,Until:end,Action:'pages.create'});
 await expect.poll(()=>rows.evaluateAll(elements=>elements.map(element=>element.dataset.activityId))).not.toContain(first.receipt.activityId);
 await expect(panel.locator(`a[href^="/app/pages/${pageId}"]`)).toHaveCount(0);
 await state.switchIdentity('owner');
 const retained=await api(`/api/activity?${new URLSearchParams({from:'2000-01-02T12:00:00.000Z',to:'2000-01-02T12:00:00.000Z',action:'pages.create'})}`);
 assert.deepEqual(retained.items.map(item=>item.id),[first.receipt.activityId]);
}
