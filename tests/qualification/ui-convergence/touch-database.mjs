import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {ok} from './two-people-support.mjs';
import {tap,type,checkpoint} from './touch-controls.mjs';

export async function touchDatabaseJourney({page,context,origin,api},containerId) {
  const mutate=(route,data)=>ok(context,origin,'POST',route,{operationKey:randomUUID(),...data});
  const database=(await mutate('/api/databases',{containerId,title:'Response planning'})).value;
  const base=`/api/databases/${database.id}`;
  const fields=[
    {id:randomUUID(),name:'Notes',type:'text',config:{},position:0},
    {id:randomUUID(),name:'Stage',type:'status',config:{options:['Open','Done']},position:1},
    {id:randomUUID(),name:'Date',type:'date',config:{},position:2},
  ];
  let revision=database.revisionId;
  for(const field of fields) revision=(await mutate(base+'/fields',{expectedRevisionId:revision,field})).value.revisionId;
  for(const [position,layout] of ['table','board','list','gallery','calendar','timeline'].entries()) {
    const view={id:randomUUID(),name:`Response ${layout}`,layout,filters:[],sorts:[],
      groups:layout==='board'?[{field:fields[1].id,hideEmpty:false}]:[],calculations:{},
      display:{dateField:fields[2].id},position};
    revision=(await mutate(base+'/views',{expectedRevisionId:revision,view})).value.revisionId;
  }
  const record=(await mutate(base+'/records',{title:'Incident response',values:{
    [fields[0].id]:'Initial notes',[fields[1].id]:'Open',[fields[2].id]:new Date().toISOString().slice(0,10),
  }})).value;
  // Leaving a page unmounts it and cancels its collaboration poll. Each poll runs three seconds apart, so leave right
  // after one real read completes, including its body.
  const settled=async pageId=>{
    const collaboration=await page.waitForResponse(response=>response.request().method()==='GET'
      &&new URL(response.url()).pathname===`/api/collaboration/${pageId}`);
    assert.equal(collaboration.status(),200);
    assert.equal(await collaboration.finished(),null,'The collaboration read completes before leaving its page.');
  };
  await page.goto(`${origin}/app/databases/${database.id}`,{waitUntil:'networkidle'});
  for(const layout of ['table','board','list','gallery','calendar','timeline']) {
    await tap(page.getByRole('navigation',{name:'Saved views'}).getByRole('button',{name:`Response ${layout}`,exact:true}));
    await checkpoint(page,`${layout} layout`);
    // SL1: the title links the record's one address, which opens in place beside the list's index.
    await settled(database.pageId);
    await tap(page.getByRole('main').getByRole('link',{name:'Incident response',exact:true}));
    const index=page.getByRole('navigation',{name:'Response planning records',exact:true});
    await expect(index.getByRole('link',{name:/^Incident response/})).toHaveAttribute('aria-current','true');
    await expect(page).toHaveURL(url=>url.pathname===`/app/databases/${database.id}/records/${record.pageId}`);
    const field=page.locator('.record-field').filter({has:page.getByText('Notes',{exact:true})});
    await tap(field.getByRole('button',{name:'Edit',exact:true}));
    const dialog=page.getByRole('dialog',{name:'Edit Notes',exact:true});
    await type(page,dialog.getByRole('textbox',{name:'Notes',exact:true}),`Edited from ${layout}`);
    await tap(dialog.getByRole('button',{name:'Save value',exact:true}));
    await expect(dialog).not.toBeVisible();
    await expect.poll(async()=>(await api(base+'/records/'+record.pageId)).values[fields[0].id]).toBe(`Edited from ${layout}`);
    await checkpoint(page,`${layout} record edited`);
    console.log(`NAV-006 touch ${layout} layout record edit persisted`);
    await settled(record.pageId);
    await tap(index.getByRole('link',{name:'Response planning',exact:true}));
    await expect(page).toHaveURL(url=>url.pathname===`/app/databases/${database.id}`);
    await expect(page.getByRole('main').getByRole('link',{name:'Incident response',exact:true})).toBeFocused();
  }
  assert.equal((await api(base+'/records/'+record.pageId)).values[fields[0].id],'Edited from timeline');
}
