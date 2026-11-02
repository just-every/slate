import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible,openPageAction} from './browser-support.mjs';
import {call,grant,ok,restrictedPage} from './two-people-support.mjs';

/** Native Details reads populated content; a full member changes custody, never authority. */
export async function pageDetailsJourney(state,people) {
  const {page,context,origin,api}=state;
  const member=people.bob,view=member.page,width=page.viewportSize().width;
  const space=(await ok(context,origin,'POST','/api/containers',{operationKey:randomUUID(),name:'Response references',visibility:'private'})).value;
  const create=async(title,blocks=[],extra={})=>(await ok(context,origin,'POST','/api/pages',{
    operationKey:randomUUID(),containerId:space.id,title,blocks,...extra,
  })).value.pageId;
  const parentId=await create('Operations reference');
  await grant(context,origin,parentId,member.id,'comment');
  await ok(context,origin,'POST','/api/sharing',{operationKey:randomUUID(),targetKind:'container',targetId:space.id,principalKind:'member',principalId:member.id,level:'view'});
  const blockId=randomUUID();
  const pageId=await create('Response details',[
    {id:blockId,blockType:'paragraph',content:{text:[{text:'Initial response notes.'}]},treePosition:'a'},
    {id:randomUUID(),blockType:'table',content:{caption:'Handover',columns:['Task','Owner'],rows:[{id:randomUUID(),cells:['Review','Morgan']}]},treePosition:'b'},
  ],{parentPageId:parentId,treePosition:'details-position',properties:{icon:'📚',cover:{kind:'gallery',id:'forest'},labels:['operations','handover']}});
  await grant(context,origin,pageId,member.id,'full');
  // Two actual content edits populate both contributors, independently of ownership.
  for(const [actor,text] of [[context,'Owner prepared response.'],[member.context,'Confirm the duty owner.']]) {
    const current=await ok(actor,origin,'GET',`/api/pages/${pageId}`);
    await ok(actor,origin,'PATCH',`/api/pages/${pageId}/blocks/${blockId}`,{operationKey:randomUUID(),expectedRevisionId:current.blocks.find(block=>block.id===blockId).revisionId,content:{text:[{text}]}});
  }
  const statusKey=randomUUID();
  await ok(context,origin,'POST','/api/status',{operationKey:randomUUID(),key:statusKey,label:'In review',color:'#54735b',requiresVerification:false});
  const current=await api(`/api/pages/${pageId}`);
  await ok(context,origin,'POST',`/api/status/page/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:current.page.revisionId,statusKey});
  const link=()=>[{id:randomUUID(),blockType:'paragraph',content:{text:[{text:'Response reference',link:{href:`${origin}/app/pages/${pageId}`}}]},treePosition:'a'}];
  const readableId=await create('Readable response reference',link());
  const hidden=await restrictedPage(state,'Private response reference',['Private notes']);
  const hiddenDoc=await api(`/api/pages/${hidden.pageId}`);
  await ok(context,origin,'PUT',`/api/pages/${hidden.pageId}/blocks`,{operationKey:randomUUID(),expectedRevisionId:hiddenDoc.page.revisionId,blocks:link()});
  // Reload the actual document before entering Details, including its recorded visit.
  await view.goto(`${origin}/app/pages/${pageId}`,{waitUntil:'networkidle'});
  await view.reload({waitUntil:'networkidle'});
  await openPageAction(view,'Details');
  const panel=view.locator('.right'),field=label=>panel.locator('dt').filter({hasText:new RegExp(`^${label}$`)}).locator('+ dd');
  const document=await api(`/api/pages/${pageId}`);
  assert.equal(document.page.id,pageId);assert.equal(document.page.title,'Response details');
  assert.equal(document.page.containerId,space.id);assert.equal(document.parentPageId,parentId);
  assert.equal(document.page.lifecycle,'live');assert.ok(document.page.revisionId);
  const snapshot=await api(`/api/revisions/${pageId}/${document.workingRevisionId}`);
  assert.equal(snapshot.id,document.workingRevisionId);assert.deepEqual(snapshot.blocks,document.blocks);
  assert.equal(document.properties.icon,'📚');assert.deepEqual(document.properties.cover,{kind:'gallery',id:'forest'});
  assert.equal(document.properties.ownerMemberId,'browser-owner');
  assert.deepEqual(document.blocks.map(block=>block.pageId),[pageId,pageId]);
  const positions=(await api(`/api/pages?containerId=${space.id}`)).items.filter(item=>item.id===pageId);
  assert.equal(positions.length,1);assert.equal(positions[0].treePosition,'details-position');
  assert.equal(positions[0].parentPageId,parentId);

  assert.equal(document.authorMemberId,'browser-owner');
  assert.deepEqual(document.contributors.map(item=>item.id).sort(),['browser-owner','browser-reader']);
  assert.equal(document.permissions.level,'full');
  const memberDoc=await ok(member.context,origin,'GET',`/api/pages/${pageId}`);
  assert.equal(memberDoc.permissions.level,'full');
  await expect(field('Owner')).toContainText('Alex Owner');
  await expect(field('Created by')).toHaveText('Alex Owner');
  for(const name of ['Alex Owner','Morgan Reader'])await expect(field('Contributors')).toContainText(name);
  const formatted=async value=>view.evaluate(instant=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(instant)),value);
  assert.ok(Date.parse(document.updatedAt)>=Date.parse(document.createdAt));
  await expect(field('Created')).toHaveText(await formatted(document.createdAt));
  await expect(field('Updated')).toHaveText(await formatted(document.updatedAt));
  // Length includes the table caption, headings and cells as well as the paragraph.
  const text='Confirm the duty owner. Handover Task Owner Review Morgan';
  await expect(field('Length')).toHaveText(`9 words · ${text.length} characters`);
  const details=await ok(member.context,origin,'GET',`/api/pages/${pageId}/details`);
  assert.equal(details.wordCount,9);assert.equal(details.characterCount,text.length);
  await expect(field('Status')).toHaveText('In review');
  await expect(field('Labels')).toContainText('handover, operations');
  assert.deepEqual(details.linkedFrom,[{id:readableId,title:'Readable response reference'}]);
  await expect(panel.getByRole('link',{name:'Readable response reference',exact:true})).toHaveAttribute('href',`/app/pages/${readableId}`);
  await expect(panel).not.toContainText('Private response reference');
  const metrics=await ok(member.context,origin,'GET',`/api/analytics?pageId=${pageId}`);
  assert.equal(metrics.totalViews,2);assert.equal(metrics.uniqueViewers,1);
  await expect(panel.getByRole('region',{name:'Page readership',exact:true})).toContainText('2 views');
  await accessible(view,'populated page details');
  await panel.getByRole('region',{name:'Page readership',exact:true}).scrollIntoViewIfNeeded();
  await expect(panel.getByRole('region',{name:'Page readership',exact:true})).toBeVisible();
  await accessible(view,'page details backlinks and readership');
  const before=await api(`/api/sharing/pages/${pageId}`);
  assert.ok(before.items.some(item=>item.principalId===member.id&&item.level==='full'&&item.effective));
  assert.ok(before.inheritedItems.some(item=>item.origin.id===parentId&&item.level==='comment'&&item.effective));
  assert.ok(before.inheritedItems.some(item=>item.origin.id===space.id&&item.level==='view'&&item.effective));
  await panel.getByRole('button',{name:'Reassign owner',exact:true}).click();
  const dialog=view.getByRole('dialog',{name:'Reassign owner',exact:true});
  await expect(dialog.getByRole('combobox',{name:'Owner',exact:true})).toHaveValue('browser-owner');
  await dialog.getByRole('combobox',{name:'Owner',exact:true}).selectOption(member.id);
  await accessible(view,'full member reassigns page owner');
  const committed=view.waitForResponse(response=>new URL(response.url()).pathname===`/api/pages/${pageId}`&&response.request().method()==='PATCH'&&response.status()===200);
  await dialog.getByRole('button',{name:'Save details',exact:true}).click();
  const response=await committed,request=response.request().postDataJSON(),receipt=await response.json();
  await expect(dialog).toBeHidden();
  await expect(field('Owner')).toContainText('Morgan Reader');
  assert.equal((await api(`/api/pages/${pageId}`)).properties.ownerMemberId,member.id);
  assert.deepEqual(await api(`/api/sharing/pages/${pageId}`),before,'Ownership changes no direct or inherited grant.');
  const timeline=async()=> (await api(`/api/activity?${new URLSearchParams({actorId:member.id,action:'pages.update',kind:'page'})}`)).items;
  const entry=(await timeline()).filter(item=>item.operationKey===request.operationKey);
  assert.equal(entry.length,1);assert.equal(entry[0].target.id,pageId);
  assert.equal((await timeline()).filter(item=>item.target.id===pageId).length,1);
  const replay=await ok(member.context,origin,'PATCH',`/api/pages/${pageId}`,request);
  assert.deepEqual(replay.receipt,receipt.receipt);
  assert.deepEqual((await timeline()).filter(item=>item.target.id===pageId),entry,'Replaying the same owner change writes exactly one activity entry.');
  assert.deepEqual(await api(`/api/sharing/pages/${pageId}`),before);
  await view.reload({waitUntil:'networkidle'});
  if(!await panel.getByRole('heading',{name:'Page details',exact:true}).isVisible())await openPageAction(view,'Details');
  await expect(field('Owner')).toContainText('Morgan Reader');
  await accessible(view,'reassigned owner after reload');
  // The same member retains editing but loses full authority. Ownership is not a grant.
  const direct=before.items.find(item=>item.principalId===member.id&&item.level==='full');
  await ok(context,origin,'POST','/api/sharing',{operationKey:randomUUID(),targetKind:'page',targetId:pageId,id:direct.id,principalKind:'member',principalId:member.id,level:'edit'});
  await view.reload({waitUntil:'networkidle'});
  if(!await panel.getByRole('heading',{name:'Page details',exact:true}).isVisible())await openPageAction(view,'Details');
  await expect(panel.getByRole('button',{name:'Reassign owner',exact:true})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Edit labels',exact:true})).toBeVisible();
  const editDoc=await ok(member.context,origin,'GET',`/api/pages/${pageId}`);
  assert.equal(editDoc.permissions.level,'edit');
  const grantsBeforeRefusal=await api(`/api/sharing/pages/${pageId}`),activityBeforeRefusal=await timeline();
  const revisionsBeforeRefusal=await api(`/api/revisions/${pageId}`);
  const refused=await call(member.context,origin,'PATCH',`/api/pages/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:editDoc.page.revisionId,properties:{ownerMemberId:'browser-owner'}});
  assert.equal(refused.status,404);
  const staleReplay=await call(member.context,origin,'PATCH',`/api/pages/${pageId}`,request);
  assert.equal(staleReplay.status,404,'A captured full-access owner change cannot replay with edit-only authority.');
  assert.deepEqual(await ok(member.context,origin,'GET',`/api/pages/${pageId}`),editDoc,'Refusal leaves page content, owner and revision unchanged.');
  assert.deepEqual(await api(`/api/revisions/${pageId}`),revisionsBeforeRefusal);
  assert.deepEqual(await api(`/api/sharing/pages/${pageId}`),grantsBeforeRefusal);
  assert.deepEqual(await timeline(),activityBeforeRefusal);
  await accessible(view,'edit-only member cannot reassign owner');
  await editPageLabels(state,member,pageId,['handover','operations']);

  // A readable backlink opens its real target; the hidden source remains undisclosed.
  await panel.getByRole('link',{name:'Readable response reference',exact:true}).click();
  await expect(view).toHaveURL(`${origin}/app/pages/${readableId}`);
  await expect(view.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Readable response reference');
  console.log(`PAGE-007 Details, replay and edit-only refusal passed at ${width}px`);
}

/** Details authoring keeps the same populated page and refuses invalid or viewer writes unchanged. */
export async function editPageLabels(state,member,pageId,initial){
  const {context,origin,api}=state,view=member.page,panel=view.locator('.right');
  const grants=await api(`/api/sharing/pages/${pageId}`);
  const write=async(labels,valid)=>{
    const before=await api(`/api/pages/${pageId}`),history=await api(`/api/revisions/${pageId}`);
    await panel.getByRole('button',{name:'Edit labels',exact:true}).click();
    const dialog=view.getByRole('dialog',{name:'Edit page labels',exact:true});
    await dialog.getByLabel('Labels, separated by commas',{exact:true}).fill(labels.join(', '));
    const pending=view.waitForResponse(response=>new URL(response.url()).pathname===`/api/pages/${pageId}`&&response.request().method()==='PATCH');
    await dialog.getByRole('button',{name:'Save details',exact:true}).click();
    const response=await pending,submitted=response.request().postDataJSON(),receipt=await response.json();
    assert.equal(response.status(),valid?200:400);
    if(valid){
      assert.equal(receipt.receipt.operationKey,submitted.operationKey);
      assert.deepEqual(receipt.receipt.entity,{kind:'page',id:pageId,revisionId:receipt.value.revisionId});
      await expect(dialog).toBeHidden();
      const after=await api(`/api/pages/${pageId}`);assert.deepEqual([...after.properties.labels].sort(),[...labels].sort());
      assert.equal(after.page.revisionId,receipt.value.revisionId);assert.deepEqual(after.blocks,before.blocks);
      assert.equal(after.createdAt,before.createdAt);assert.equal(after.properties.ownerMemberId,before.properties.ownerMemberId);
      assert.deepEqual(await api(`/api/sharing/pages/${pageId}`),grants);
      await view.reload({waitUntil:'networkidle'});if(!await panel.getByRole('heading',{name:'Page details',exact:true}).isVisible())await openPageAction(view,'Details');
      await expect(panel.locator('dt').filter({hasText:/^Labels$/}).locator('+ dd')).toContainText(labels.join(', '));
    }else{
      await expect(dialog.getByRole('alert')).toBeVisible();
      assert.deepEqual(await api(`/api/pages/${pageId}`),before);assert.deepEqual(await api(`/api/revisions/${pageId}`),history);
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    }
    return submitted;
  };
  const retained=[...initial,'response'];await write(retained,true);
  await write(['handover','response'],true);
  await write(['handover','handover'],false);await write(['x'.repeat(81)],false);
  const before=await api(`/api/pages/${pageId}`);
  const blank=await call(member.context,origin,'PATCH',`/api/pages/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:before.page.revisionId,properties:{labels:[' ']}});
  assert.equal(blank.status,400);assert.deepEqual(await api(`/api/pages/${pageId}`),before);
  await accessible(view,'authored page labels retained after reload');
  const direct=grants.items.find(item=>item.principalId===member.id&&item.level==='edit');
  await ok(context,origin,'POST','/api/sharing',{operationKey:randomUUID(),targetKind:'page',targetId:pageId,id:direct.id,principalKind:'member',principalId:member.id,level:'view'});
  await view.reload({waitUntil:'networkidle'});if(!await panel.getByRole('heading',{name:'Page details',exact:true}).isVisible())await openPageAction(view,'Details');
  await expect(panel.getByRole('button',{name:'Edit labels',exact:true})).toHaveCount(0);
  const current=await api(`/api/pages/${pageId}`),history=await api(`/api/revisions/${pageId}`);
  const refused=await call(member.context,origin,'PATCH',`/api/pages/${pageId}`,{operationKey:randomUUID(),expectedRevisionId:current.page.revisionId,properties:{labels:['viewer-write']}});
  assert.equal(refused.status,404);assert.deepEqual(await api(`/api/pages/${pageId}`),current);assert.deepEqual(await api(`/api/revisions/${pageId}`),history);
  await accessible(view,'viewer cannot change page labels');
  console.log(`PROBE PAGE-001 1: Details at ${view.viewportSize().width}px -> edit-only add and remove persisted; duplicate, long, blank and viewer writes refused unchanged`);
}
