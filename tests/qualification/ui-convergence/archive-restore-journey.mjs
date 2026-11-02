import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {ok,call} from './two-people-support.mjs';
import {tap,checkpoint} from './touch-controls.mjs';

/** Actual restore controls operate on populated, retained native content at either width. */
export async function archiveRestoreJourney(state, touch) {
  const {page,context,origin,containerId}=touch;
  const api=(method,path,body)=>ok(context,origin,method,path,body);
  const member=(await state.api('/api/members/current')).id;
  const statuses=(await api('GET','/api/status')).items;
  const status=statuses.find(item=>!item.requiresVerification && !item.retiredAt)?.key;
  assert.ok(status,'Use an actual non-verifying status.');
  const create=async(title,parentPageId,treePosition=title)=>(await api('POST','/api/pages',{operationKey:randomUUID(),containerId,parentPageId,treePosition,title,properties:{statusKey:status},blocks:[{id:randomUUID(),blockType:'paragraph',treePosition:'1',content:{text:[{text:`Retained ${title}`}]}}]})).value.pageId;
  const parent=await create('Archive original location');
  const before=await create('Archive before',parent,'10'),root=await create('Archive populated subtree',parent,'20'),after=await create('Archive after',parent,'30');
  const child=await create('Archive nested child',root);
  const database=(await api('POST','/api/databases',{operationKey:randomUUID(),containerId,parentPageId:root,title:'Archive database'})).value;
  await api('POST',`/api/databases/${database.id}/fields`,{operationKey:randomUUID(),expectedRevisionId:database.revisionId,field:{id:'points',name:'Points',type:'number',config:{},position:0}});
  const record=(await api('POST',`/api/databases/${database.id}/records`,{operationKey:randomUUID(),title:'Archive record',values:{points:42}})).value.pageId;
  const ids=[root,child,database.pageId,record];
  for(const id of ids){
    let doc=await api('GET',`/api/pages/${id}`);
    if(!doc.blocks.length){
      await api('PUT',`/api/pages/${id}/blocks`,{operationKey:randomUUID(),expectedRevisionId:doc.page.revisionId,blocks:[{id:randomUUID(),blockType:'paragraph',treePosition:'1',content:{text:[{text:'Retained structured page body'}]}}]});
      doc=await api('GET',`/api/pages/${id}`);
    }
    await api('PATCH',`/api/pages/${id}`,{operationKey:randomUUID(),expectedRevisionId:doc.page.revisionId,properties:{title:doc.page.title+' revised'}});
    await api('POST',`/api/comments/page/${id}`,{operationKey:randomUUID(),body:[{text:`Archive retained comment ${id}`}]});
    await api('POST','/api/sharing',{operationKey:randomUUID(),targetKind:'page',targetId:id,principalKind:'member',principalId:member,level:'view'});
  }
  const retained=async()=>{
    const documents=[];
    for(const id of ids){
      const {updatedAt,...doc}=await api('GET',`/api/pages/${id}`);
      const history=await api('GET',`/api/revisions/${id}`);
      assert.ok(history.items.length>1,'Compare populated history.');
      const versions=[];
      for(const revision of history.items)versions.push(await api('GET',`/api/revisions/${id}/${revision.id}`));
      const comments=await api('GET',`/api/comments/page/${id}`);
      assert.equal(comments.threads.length,1);
      documents.push({doc,history,versions,comments,grants:await api('GET',`/api/sharing/pages/${id}`)});
    }
    return {documents,database:await api('GET',`/api/databases/${database.id}`),record:(await api('GET',`/api/databases/${database.id}/records/${record}`)).values};
  };
  const original=await retained();
  const revision=async id=>(await api('GET',`/api/pages/${id}`)).page.revisionId;
  const archive=async id=>api('POST',`/api/archive/${id}`,{operationKey:randomUUID(),expectedRevisionId:await revision(id),action:'archive'});
  const row=()=>page.locator('.archive-list li').filter({has:page.getByRole('heading',{name:'Archive populated subtree revised',exact:true})});
  await archive(root);
  await page.goto(origin+'/app/archive',{waitUntil:'networkidle'});
  await expect(row()).toBeVisible();
  await checkpoint(page,'archive populated subtree');
  const restore=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/archive/${root}`&&response.request().method()==='POST');
  await tap(row().getByRole('button',{name:'Restore',exact:true}));
  const response=await restore;assert.equal(response.status(),200,await response.text());
  const input=response.request().postDataJSON(),receipt=await response.json();
  await expect(row()).toHaveCount(0);
  assert.deepEqual(await api('POST',`/api/archive/${root}`,input),receipt);
  assert.deepEqual(await retained(),original,'Restore preserves every retained document and historical revision.');
  const siblings=(await api('GET',`/api/pages?containerId=${containerId}`)).items.filter(item=>item.parentPageId===parent).map(item=>item.id);
  assert.deepEqual(siblings,[before,root,after],'Restore returns to the exact prior position.');
  for(const id of ids){
    const reader=await state.api(`/api/pages/${id}`),expected=original.documents.find(item=>item.doc.page.id===id).doc;
    assert.equal(reader.page.id,id,'An independent reader opens retained content.');
    assert.equal(reader.page.title,expected.page.title);assert.deepEqual(reader.blocks,expected.blocks);assert.equal(reader.properties.statusKey,expected.properties.statusKey);
    assert.equal((await state.api(`/api/comments/page/${id}`)).threads.length,1);
  }
  assert.equal((await state.api(`/api/databases/${database.id}/records/${record}`)).values.points,42);
  await page.goto(`${origin}/app/pages/${root}`,{waitUntil:'networkidle'});
  await page.reload({waitUntil:'networkidle'});
  await expect(page.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Archive populated subtree revised');
  await expect(page.locator('[data-page-editor]')).toContainText('Retained Archive populated subtree');
  await checkpoint(page,'archive subtree restored with retained content');

  await archive(root);await archive(parent);
  const inventory=(await api('GET','/api/archive')).items;
  assert.equal(inventory.find(item=>item.id===root).restoreNeedsDestination,true);
  await page.goto(origin+'/app/archive',{waitUntil:'networkidle'});
  await tap(row().getByRole('button',{name:'Restore',exact:true}));
  const dialog=page.getByRole('dialog',{name:'Choose restore destination',exact:true});
  await expect(dialog.getByRole('button',{name:'Restore',exact:true})).toBeDisabled();
  const close=dialog.getByRole('button',{name:'Close dialog',exact:true});
  await dialog.getByRole('combobox',{name:'Destination space',exact:true}).focus();
  await page.keyboard.press('Shift+Tab');await expect(close).toBeFocused();
  assert.equal(await close.evaluate(element=>getComputedStyle(element,'::after').opacity),'1','Keyboard focus immediately shows the close tooltip.');
  await dialog.getByRole('combobox',{name:'Destination space',exact:true}).focus();await close.hover();
  await expect.poll(()=>close.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
  await checkpoint(page,'archive requires destination selection');
  await tap(dialog.getByRole('button',{name:'Cancel',exact:true}));
  assert.deepEqual((await api('GET','/api/archive')).items,inventory,'Cancellation leaves the archive inventory unchanged.');
  const missing=await call(context,origin,'POST',`/api/archive/${root}`,{operationKey:randomUUID(),expectedRevisionId:await revision(root),action:'restore'});
  assert.equal(missing.status,409);assert.equal(missing.body.code,'RESTORE_DESTINATION_REQUIRED');
  const invalid=await call(context,origin,'POST',`/api/archive/${root}`,{operationKey:randomUUID(),expectedRevisionId:await revision(root),action:'restore',containerId,parentPageId:parent});
  assert.ok(invalid.status>=400);assert.deepEqual((await api('GET','/api/archive')).items,inventory);
  const destination=await create('Archive selected destination');
  await tap(row().getByRole('button',{name:'Restore',exact:true}));
  await dialog.getByRole('combobox',{name:'Destination space',exact:true}).selectOption(containerId);
  await dialog.getByRole('combobox',{name:'Parent page',exact:true}).selectOption(destination);
  await checkpoint(page,'archive selected destination');
  await tap(dialog.getByRole('button',{name:'Restore',exact:true}));
  await expect(dialog).toBeHidden();await expect(row()).toHaveCount(0);
  const relocated=await retained();
  const relocatedRoot=relocated.documents.find(item=>item.doc.page.id===root);
  assert.equal(relocatedRoot.doc.parentPageId,destination);
  // Effective ancestor metadata changes with the explicitly selected parent; retained direct grants do not.
  relocatedRoot.doc.parentPageId=parent;
  assert.deepEqual(relocated,original);

  // Restore the database through its own native inventory row, including populated records.
  await archive(database.pageId);
  await page.reload({waitUntil:'networkidle'});
  const dbRow=page.locator('.archive-list li').filter({has:page.getByRole('heading',{name:'Archive database revised',exact:true})});
  await tap(dbRow.getByRole('button',{name:'Restore',exact:true}));await expect(dbRow).toHaveCount(0);
  assert.equal((await api('GET',`/api/databases/${database.id}/records/${record}`)).values.points,42);
  // Container restore is its existing Settings door and retains the same populated records.
  const space=await api('GET',`/api/containers/${containerId}`);
  await api('POST',`/api/containers/${containerId}/archive`,{operationKey:randomUUID(),expectedRevisionId:space.revisionId});
  await page.goto(`${origin}/app/containers/${containerId}`,{waitUntil:'networkidle'});
  await tap(page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Settings',exact:true}));
  await tap(page.getByRole('button',{name:'Restore space',exact:true}));
  const spaceDialog=page.getByRole('dialog',{name:'Restore this space',exact:true});
  await tap(spaceDialog.getByRole('button',{name:'Restore',exact:true}));await expect(spaceDialog).toBeHidden();
  assert.equal((await api('GET',`/api/containers/${containerId}`)).archivedAt,null);
  const containerRestored=await retained();
  containerRestored.documents.find(item=>item.doc.page.id===root).doc.parentPageId=parent;
  assert.deepEqual(containerRestored,original);
  assert.equal((await state.api(`/api/databases/${database.id}/records/${record}`)).values.points,42);
  await page.reload({waitUntil:'networkidle'});
  await checkpoint(page,'archive container restored');
  console.log('PROBE ARCH-003 1: native destination dialog cancel, missing and invalid destination -> unchanged inventory; explicit destination -> restored subtree');
  console.log('PROBE ARCH-003 2: native page, database and space Restore -> prior topology and retained identity, history, comments, grants and status; reader, reload and replay passed');
}
