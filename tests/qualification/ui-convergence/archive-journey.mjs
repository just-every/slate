import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {ok} from './two-people-support.mjs';
import {tap,type,checkpoint} from './touch-controls.mjs';

/** The native page, database and space controls archive complete populated trees. */
export async function archiveJourney(touch, templatePage, templateLifecycle) {
  const {page,context,origin,api,containerId}=touch;
  const actor=(await api('/api/members/current')).id;
  const create=async(title,parentPageId)=> (await ok(context,origin,'POST','/api/pages',{
    operationKey:randomUUID(),containerId,title,parentPageId,
    blocks:[{id:randomUUID(),blockType:'paragraph',treePosition:'a',content:{text:[{text:title+' retained content'}]}}],
  })).value;
  const child=await create('Archived meeting follow-up',templatePage);
  const database=(await ok(context,origin,'POST','/api/databases',{operationKey:randomUUID(),containerId,parentPageId:child.pageId,title:'Archived meeting actions'})).value;
  const records=[];
  for(const title of ['First archived action','Second archived action'])records.push((await ok(context,origin,'POST',`/api/databases/${database.id}/records`,{operationKey:randomUUID(),title,values:{}})).value.pageId);
  const leaf=await create('Archived action notes',records[0]);
  const sibling=await create('Retained active meeting');
  const databaseIds=[database.pageId,...records,leaf.pageId].sort();
  const subtreeIds=[templatePage,child.pageId,...databaseIds].sort();
  const before=(await api(`/api/pages?containerId=${containerId}`)).items;
  const documents=new Map(await Promise.all(before.map(async item=>[item.id,await api(`/api/pages/${item.id}`)])));
  const audit=async action=>(await api(`/api/activity?${new URLSearchParams({action})}`)).items;
  const assertArchive=async(ids,receipt,reason)=>{
    const archived=(await api('/api/archive')).items.filter(item=>ids.includes(item.id)).sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(archived.map(item=>item.id),ids);
    for(const item of archived){
      const prior=before.find(row=>row.id===item.id),document=documents.get(item.id);
      assert.equal(item.actorMemberId,actor);
      assert.equal(item.archivedAt,receipt.committedAt);
      assert.equal(item.occurredAt,receipt.committedAt);
      assert.equal(item.reason,reason);
      assert.equal(item.priorContainerId,containerId);
      assert.equal(item.priorParentId,document.parentPageId);
      assert.equal(item.priorPosition,prior.treePosition);
      assert.equal(item.priorLifecycle,document.page.lifecycle);
      const read=await api(`/api/pages/${item.id}`);
      assert.equal(read.page.lifecycle,'archived');
      assert.equal(read.page.revisionId,document.page.revisionId);
      assert.deepEqual(read.blocks,document.blocks);
      assert.deepEqual(read.properties,document.properties);
      assert.equal(read.permissions.canEdit,false);
    }
    const active=(await api(`/api/pages?containerId=${containerId}`)).items;
    assert.deepEqual(active.map(item=>item.id).sort(),before.filter(item=>!ids.includes(item.id)).map(item=>item.id).sort());
    const untouched=await api(`/api/pages/${sibling.pageId}`);
    if(!ids.includes(sibling.pageId))assert.deepEqual(untouched,documents.get(sibling.pageId));
    assert.deepEqual(archived,(await api('/api/archive')).items.filter(item=>ids.includes(item.id)).sort((a,b)=>a.id.localeCompare(b.id)));
  };
  const replay=async(response,path,action)=>{
    const result=await response.json(),input=response.request().postDataJSON();
    const first=(await audit(action)).filter(item=>item.id===result.receipt.activityId);
    assert.equal(first.length,1);
    assert.equal(first[0].actor.id,actor);
    assert.equal(first[0].occurredAt,result.receipt.committedAt);
    assert.equal(first[0].operationKey,input.operationKey);
    assert.deepEqual(await ok(context,origin,'POST',path,input),result);
    assert.deepEqual((await audit(action)).filter(item=>item.id===result.receipt.activityId),first);
    return result.receipt;
  };
  async function archivePage(id,reason){
    await tap(page.getByRole('button',{name:'More',exact:true}));
    await tap(page.getByRole('menuitem',{name:'Archive page',exact:true}));
    const archive=page.getByRole('dialog',{name:'Archive this page?',exact:true});
    if(reason)await type(page,archive.getByRole('textbox',{name:'Reason',exact:true}),reason);
    const committed=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/archive/${id}`&&response.request().method()==='POST');
    await tap(archive.getByRole('button',{name:'Confirm',exact:true}));
    const response=await committed;
    assert.equal(response.status(),200);
    await expect(archive).toBeHidden();
    return replay(response,`/api/archive/${id}`,'archive.archive');
  }
  await page.goto(`${origin}/app/pages/${templatePage}`,{waitUntil:'networkidle'});
  const pageReceipt=await archivePage(templatePage,'Meeting completed.');
  await assertArchive(subtreeIds,pageReceipt,'Meeting completed.');
  await page.goto(origin+'/app/archive',{waitUntil:'networkidle'});
  await page.reload({waitUntil:'networkidle'});
  const row=page.locator('.archive-list li').filter({has:page.getByRole('heading',{name:'Meeting notes',exact:true})});
  await expect(row).toContainText('Meeting completed.');
  for(const title of ['Archived meeting follow-up','Archived meeting actions','First archived action','Second archived action','Archived action notes'])await expect(page.locator('.archive-list li').filter({has:page.getByRole('heading',{name:title,exact:true})})).toHaveCount(1);
  await checkpoint(page,'archive populated');
  await tap(row.getByRole('button',{name:'Restore',exact:true}));
  await expect(row).toHaveCount(0);
  assert.equal((await api(`/api/pages/${templatePage}`)).page.lifecycle,templateLifecycle);
  assert.equal((await api('/api/archive')).items.some(item=>subtreeIds.includes(item.id)),false);
  await checkpoint(page,'archive restored');

  await page.goto(`${origin}/app/databases/${database.id}`,{waitUntil:'networkidle'});
  const about=page.getByRole('link',{name:'About this database',exact:true});
  await expect(about).toHaveAttribute('data-tooltip','About this database');
  await about.focus();
  await expect.poll(()=>about.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
  await tap(about);
  const databaseReceipt=await archivePage(database.pageId);
  await assertArchive(databaseIds,databaseReceipt,'');
  await page.goto(origin+'/app/archive',{waitUntil:'networkidle'});
  await page.reload({waitUntil:'networkidle'});
  const dbRow=page.locator('.archive-list li').filter({has:page.getByRole('heading',{name:'Archived meeting actions',exact:true})});
  await expect(dbRow).toHaveCount(1);
  await checkpoint(page,'archived database records');
  await tap(dbRow.getByRole('button',{name:'Restore',exact:true}));
  await expect(dbRow).toHaveCount(0);
  assert.equal((await api('/api/archive')).items.some(item=>databaseIds.includes(item.id)),false);

  const allIds=before.map(item=>item.id).sort();
  await page.goto(`${origin}/app/containers/${containerId}`,{waitUntil:'networkidle'});
  await tap(page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Settings',exact:true}));
  await tap(page.getByRole('button',{name:'Archive space',exact:true}));
  const spaceDialog=page.getByRole('dialog',{name:'Archive this space',exact:true});
  await type(page,spaceDialog.getByRole('textbox',{name:'Reason',exact:true}),'Space work completed.');
  const committed=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/containers/${containerId}/archive`&&response.request().method()==='POST');
  await tap(spaceDialog.getByRole('button',{name:'Archive',exact:true}));
  const spaceResponse=await committed;
  assert.equal(spaceResponse.status(),200);
  await expect(spaceDialog).toBeHidden();
  const spaceReceipt=await replay(spaceResponse,`/api/containers/${containerId}/archive`,'containers.archive');
  await assertArchive(allIds,spaceReceipt,'Space work completed.');
  assert.equal((await api(`/api/containers/${containerId}`)).archivedAt,spaceReceipt.committedAt);
  assert.equal((await api('/api/containers')).items.some(item=>item.id===containerId),false);
  assert.equal((await api('/api/containers?archived=true')).items.some(item=>item.id===containerId),true);
  await page.goto(origin+'/app/archive',{waitUntil:'networkidle'});
  await page.reload({waitUntil:'networkidle'});
  await expect(page.locator('.archive-list li').filter({has:page.getByRole('heading',{name:'Retained active meeting',exact:true})})).toHaveCount(1);
  await checkpoint(page,'archived space inventory');
  // Return this shared journey's space through its native restore control.
  await page.goto(`${origin}/app/containers/${containerId}`,{waitUntil:'networkidle'});
  await tap(page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Settings',exact:true}));
  await tap(page.getByRole('button',{name:'Restore space',exact:true}));
  const restore=page.getByRole('dialog',{name:'Restore this space',exact:true});
  await tap(restore.getByRole('button',{name:'Restore',exact:true}));
  await expect(restore).toBeHidden();
  await expect.poll(async()=>(await api(`/api/containers/${containerId}`)).archivedAt).toBeNull();
  assert.equal((await api('/api/archive')).items.some(item=>allIds.includes(item.id)),false);
  console.log(`PROBE ARCH-001 browser ${page.viewportSize().width}: native page, database and space controls -> complete metadata and descendant inventory after reload, one activity under replay, unchanged sibling, restored identifiers and bodies`);
}
