import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-support.mjs';
import { ok, call, restrictedPage } from './two-people-support.mjs';

/** Real timeline links retain page versions, comment threads and individual grants through reload. */
export async function activityContextJourney(state) {
 const {page,context,origin,api}=state;
 const {pageId}=await restrictedPage(state,'Activity context guide',['synthetic-slate-original-context-body']);
 const mutate=(method,path,input)=>ok(context,origin,method,path,{operationKey:randomUUID(),...input});
 const current=await api(`/api/pages/${pageId}`);
 const edited=await mutate('PUT',`/api/pages/${pageId}/blocks`,{expectedRevisionId:current.page.revisionId,blocks:[{id:randomUUID(),blockType:'paragraph',treePosition:'1',content:{text:[{text:'synthetic-slate-referenced-version-body'}]}}]});
 const versionId=edited.receipt.revisionId;
 await mutate('PUT',`/api/pages/${pageId}/blocks`,{expectedRevisionId:versionId,blocks:[{id:randomUUID(),blockType:'paragraph',treePosition:'1',content:{text:[{text:'synthetic-slate-current-body'}]}}]});
 const comment=await mutate('POST',`/api/comments/page/${pageId}`,{body:[{text:'synthetic-slate-referenced-comment'}]});
 const resolved=await mutate('POST',`/api/comments/thread/${comment.value.threadId}/resolve`,{expectedRevisionId:comment.value.revisionId,resolved:true});
 const grant=await mutate('POST','/api/sharing',{targetKind:'page',targetId:pageId,principalKind:'member',principalId:'browser-reader',level:'view'});
 const entries=(await api('/api/activity?limit=100')).items;
 const cases=[
  {receipt:edited.receipt,params:{detail:'history',revision:versionId},check:async()=>{await expect(page.locator('.revision-preview')).toContainText('synthetic-slate-referenced-version-body');await expect(page.locator('.revision-preview')).not.toContainText('synthetic-slate-current-body');}},
  {receipt:comment.receipt,params:{detail:'comments',comment:comment.value.id},check:async()=>{await expect(page.locator(`#comment-${comment.value.id}`)).toContainText('synthetic-slate-referenced-comment');}},
  {receipt:resolved.receipt,params:{detail:'comments',thread:comment.value.threadId},check:async()=>{await expect(page.locator(`#thread-${comment.value.threadId}`)).toContainText('Resolved');}},
  {receipt:grant.receipt,params:{detail:'share',grant:grant.value.id},check:async()=>{const selected=page.locator(`#grant-${grant.value.id}`);await expect(selected).toHaveAttribute('aria-current','true');await expect(selected).toContainText('Referenced grant');await expect(selected).toContainText('Morgan Reader');await expect(selected.getByRole('combobox',{name:'Access for Morgan Reader',exact:true})).toHaveValue('view');}},
 ];
 const retained=cases.map(item=>entries.find(entry=>entry.id===item.receipt.activityId));
 assert.ok(retained.every(Boolean),'Every native receipt names a timeline entry.');
 for(const item of cases){
  await page.goto(origin+'/app/settings?section=activity',{waitUntil:'networkidle'});
  const link=page.locator(`[data-activity-id="${item.receipt.activityId}"]`).getByRole('link',{name:/Open page/});
  const href=await link.getAttribute('href'),url=new URL(href,origin);
  assert.equal(url.pathname,`/app/pages/${pageId}`);
  assert.deepEqual(Object.fromEntries(url.searchParams),item.params);
  await link.click();await item.check();
  await page.reload({waitUntil:'networkidle'});await item.check();
  await accessible(page,`activity-context-${item.params.detail}-${item.params.comment?'comment':item.params.thread?'thread':item.params.grant?'grant':'revision'}`);
 }
 const after=(await api('/api/activity?limit=100')).items;
 for(const entry of retained)assert.deepEqual(after.find(row=>row.id===entry.id),entry,'Opening and reloading retains the complete activity entry.');
 await state.switchIdentity('reader');
 assert.equal((await call(context,origin,'GET',`/api/pages/${pageId}`)).status,200);
 assert.ok((await api('/api/activity?limit=100')).items.some(row=>row.id===comment.receipt.activityId));
 await state.switchIdentity('owner');
 await mutate('POST','/api/sharing',{targetKind:'page',targetId:pageId,id:grant.value.id,principalKind:'member',principalId:'browser-reader',level:'view',revoke:true});
 await state.switchIdentity('reader');
 try {
  const denied=await api('/api/activity?limit=100');
  assert.ok(!denied.items.some(row=>retained.some(entry=>entry.id===row.id)),'Revoked access hides every referenced entry.');
  for(const item of cases){
   assert.equal((await call(context,origin,'GET',`/api/pages/${pageId}`)).status,404);
   const query=new URLSearchParams(item.params);
   await page.goto(`${origin}/app/pages/${pageId}?${query}`,{waitUntil:'networkidle'});
   await expect(page.locator('body')).not.toContainText(/synthetic-slate-(referenced|current)/);
  }
 } finally {await state.switchIdentity('owner');}
 // Following a retained grant entry after revocation must identify it without restoring it.
 const beforeGrantRead=await api(`/api/sharing/pages/${pageId}`);
 await page.goto(origin+'/app/settings?section=activity',{waitUntil:'networkidle'});
 await page.locator(`[data-activity-id="${grant.receipt.activityId}"]`).getByRole('link',{name:/Open page/}).click();
 const revoked=page.locator(`#grant-${grant.value.id}`);
 await expect(revoked).toContainText('Referenced grant');await expect(revoked).toContainText('Revoked');
 await page.reload({waitUntil:'networkidle'});await expect(revoked).toContainText('Revoked');
 assert.deepEqual(await api(`/api/sharing/pages/${pageId}`),beforeGrantRead,'Reading the exact revoked grant cannot regrant access.');
 await state.switchIdentity('reader');
 try {assert.equal((await call(context,origin,'GET',`/api/pages/${pageId}`)).status,404);}
 finally {await state.switchIdentity('owner');}
}
