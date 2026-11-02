import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {inbox,newOutboxLink,signInWithOutbox} from '../../e2e/outbox-auth.mjs';
import {accessible} from './browser-evidence.mjs';
import {call,ok} from './two-people-support.mjs';

/** Native Settings admission, with only the outbound mail transport substituted. */
async function inviteFromSettings(state, page, email) {
  const {origin}=state,before=await inbox(origin);
  await page.goto(origin+'/app/settings?section=members',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Invite a member',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Invite a member',exact:true});
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill(email);
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/invitations'&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Send invitation',exact:true}).click();
  const response=await pending;
  assert.equal(response.status(),200);
  const receipt=await response.json();
  assert.equal(receipt.value.accepted,true);
  assert.ok(receipt.receipt.activityId);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText(email);
  await accessible(page,'member invitation sent from Settings');
  return newOutboxLink(origin,before);
}

async function acceptFromMail(state, context, link) {
  const page=await context.newPage();
  await page.goto(link,{waitUntil:'networkidle'});
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/invitation/accept'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
  assert.equal((await pending).status(),303);
  await page.waitForURL(url=>url.pathname==='/app');
  const session=await ok(context,state.origin,'GET','/api/session');
  const person=await ok(context,state.origin,'GET','/api/members/current');
  assert.equal(session.member.id,person.id);
  assert.equal(person.role,'member');
  assert.equal(person.isSetupOwner,false);
  const [{results:[invitation]}]=await state.atRest(`SELECT email,invited_by_member_id AS inviter,accepted_by_member_id AS member FROM invitations WHERE accepted_by_member_id='${person.id}' ORDER BY created_at LIMIT 1`);
  assert.equal(invitation.email,person.email);
  assert.equal(invitation.member,person.id);
  await page.reload({waitUntil:'networkidle'});
  await expect(page.getByRole('main')).toBeVisible();
  await page.close();
  return {person,inviter:invitation.inviter};
}

/** Request and consume a new native, session-bound email proof; never seed proof. */
async function confirmOwnerAction(state, context, wrongSession) {
  const {origin}=state,before=await inbox(origin);
  const response=await context.request.post(origin+'/auth/step-up',{headers:{origin},data:{action:'owner:transfer',returnTo:'/app/settings/members'}});
  assert.equal(response.status(),202);
  const link=await newOutboxLink(origin,before),confirmation=await context.newPage();
  try {
    if(wrongSession) {
      const members=await ok(context,origin,'GET','/api/members');
      const refused=await wrongSession.request.post(origin+'/auth/confirm',{headers:{origin},form:{token:new URL(link).searchParams.get('token')},maxRedirects:0});
      assert.equal(refused.status(),400,'Another owner cannot consume the setup member’s session-bound proof.');
      assert.deepEqual(await ok(context,origin,'GET','/api/members'),members);
      assert.equal((await ok(context,origin,'GET','/api/session')).member.id,'browser-owner');
    }
    await confirmation.goto(link,{waitUntil:'networkidle'});
    const pending=confirmation.waitForResponse(response=>new URL(response.url()).pathname==='/auth/confirm'&&response.request().method()==='POST');
    await confirmation.getByRole('button',{name:'Confirm',exact:true}).click();
    assert.equal((await pending).status(),303);
    await confirmation.waitForURL(url=>url.pathname==='/app/settings/members');
    const who=await ok(context,origin,'GET','/api/members/current');
    const [{results:proofs}]=await state.atRest(`SELECT p.used_at AS usedAt,s.proof_at AS proofAt,p.authority_version AS authorityVersion,s.proof_version AS proofVersion FROM auth_proofs p JOIN sessions s ON s.id=p.session_id WHERE p.member_id='${who.id}' AND p.kind='step_up' AND p.action='owner:transfer' AND p.used_at IS NOT NULL ORDER BY p.used_at DESC LIMIT 1`);
    assert.equal(proofs.length,1);
    assert.equal(proofs[0].usedAt,proofs[0].proofAt);
    assert.equal(proofs[0].authorityVersion,proofs[0].proofVersion);
  } finally {await confirmation.close();}
}

/** Invite twice before joining, then remove through Settings with both sessions live. */
export async function memberRemovalJourney(state,width) {
  const {page,context,origin,api}=state,key=()=>randomUUID(),email=['casey',`removal-${width}.invalid`].join('@');
  const links=[];
  for(let index=0;index<2;index++) {
    const before=await inbox(origin);
    if(index===0)links.push(await inviteFromSettings(state,page,email));
    else {
      await ok(context,origin,'POST','/api/invitations',{operationKey:key(),email,kind:'member'});
      links.push(await newOutboxLink(origin,before));
    }
  }
  const colleague=await context.browser().newContext({viewport:page.viewportSize()}),second=await context.browser().newContext();
  try {
    const {person,inviter}=await acceptFromMail(state,colleague,links[0]);
    assert.equal(inviter,'browser-owner');
    const profile=await ok(colleague,origin,'GET',`/api/people/${person.id}`);
    await ok(colleague,origin,'PUT',`/api/people/${person.id}`,{operationKey:key(),expectedRevisionId:profile.revisionId,displayName:'Casey Chen'});
    const session=await signInWithOutbox(origin,email);
    await second.addCookies([{name:'slate_session',value:session.cookie.split('=')[1],url:origin}]);
    const privateSpace=(await ok(colleague,origin,'GET','/api/containers')).items.find(item=>item.visibility==='personal');
    const personal=(await ok(colleague,origin,'POST','/api/pages',{operationKey:key(),containerId:privateSpace.id,title:'Casey private notes',blocks:[{id:key(),blockType:'paragraph',content:{text:[{text:'Private departure notes remain private.'}]},treePosition:'0'}]})).value.pageId;
    const space=(await ok(context,origin,'POST','/api/containers',{operationKey:key(),name:'Departure handover',visibility:'private'})).value.id;
    await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,principalKind:'member',principalId:person.id,level:'full'});
    const pages=[];
    for(const title of ['Support handover','Release handover']) {
      const id=(await ok(colleague,origin,'POST','/api/pages',{operationKey:key(),containerId:space,title})).value.pageId;
      await ok(colleague,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'page',targetId:id,principalKind:'member',principalId:'browser-owner',level:'full'});
      const direct=(await ok(colleague,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'page',targetId:id,principalKind:'member',principalId:person.id,level:'full'})).value.id;
      assert.ok((await ok(colleague,origin,'GET',`/api/sharing/pages/${id}`)).items.some(grant=>grant.id===direct&&grant.effective));
      pages.push({id,title});
    }
    assert.equal((await call(context,origin,'GET',`/api/pages/${personal}`)).status,404);
    const beforeActivity=(await api(`/api/activity?actorId=${person.id}&limit=100`)).items;
    assert.ok(beforeActivity.some(item=>item.action==='pages.create'&&item.actor.displayName==='Casey Chen'));
    const membersBefore=await api('/api/members');
    const memberPage=await colleague.newPage();
    await memberPage.goto(origin+'/app/settings?section=members',{waitUntil:'networkidle'});
    await expect(memberPage.getByRole('button',{name:/^Remove/})).toHaveCount(0);
    await memberPage.close();
    assert.equal((await call(colleague,origin,'POST','/api/members/remove',{operationKey:key(),memberId:person.id})).status,403);
    assert.deepEqual(await api('/api/members'),membersBefore,'Refused ordinary self-removal preserves every member.');
    assert.equal((await call(colleague,origin,'POST','/api/members/remove',{operationKey:key(),memberId:'browser-reader'})).status,403);
    assert.deepEqual(await api('/api/members'),membersBefore,'Refused ordinary removal preserves every member.');
    assert.equal((await ok(colleague,origin,'GET','/api/session')).member.id,person.id);
    await page.goto(origin+'/app/settings?section=members',{waitUntil:'networkidle'});
    const row=page.locator('.settings-list li').filter({has:page.getByText('Casey Chen',{exact:true})});
    await row.getByRole('button',{name:'Remove',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Remove Casey Chen?',exact:true});
    await accessible(page,'member removal confirmation');
    await dialog.getByRole('button',{name:'Remove member',exact:true}).click();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
    await accessible(page,'removed member absent from settings');
    for(const actor of [colleague,second]) {
      assert.equal((await call(actor,origin,'GET','/api/session')).status,401);
      assert.equal((await call(actor,origin,'GET',`/api/pages/${pages[0].id}`)).status,401);
    }
    const unused=await second.request.get(links[1],{maxRedirects:0});
    assert.equal(unused.status(),400,'The unused invitation cannot restore removed membership.');
    for(const [kind,id] of [['containers',space],...pages.map(item=>['pages',item.id])]) {
      const grants=await api(`/api/sharing/${kind}/${id}`);
      assert.ok(grants.items.filter(grant=>grant.principalId===person.id).every(grant=>grant.revokedAt),'Removed personal grants are inactive.');
    }
    assert.equal((await call(context,origin,'GET',`/api/pages/${personal}`)).status,404);
    assert.ok(!(await api('/api/containers?archived=true')).items.some(item=>item.id===privateSpace.id),'Archived personal content is never exposed to the owner.');
    const [{results:[stored]}]=await state.atRest(`SELECT c.archived_at AS archivedAt,p.lifecycle,p.deleted_at AS deletedAt,b.content_json AS content FROM containers c JOIN pages p ON p.container_id=c.id JOIN page_blocks b ON b.page_id=p.id WHERE c.id='${privateSpace.id}' AND p.id='${personal}'`);
    assert.ok(stored.archivedAt,'Removal archives the personal space rather than deleting it.');
    assert.equal(stored.lifecycle,'archived');
    assert.equal(stored.deletedAt,null);
    assert.equal(JSON.parse(stored.content).text[0].text,'Private departure notes remain private.');
    for(const {id} of pages)assert.equal((await api(`/api/pages/${id}`)).properties.ownerMemberId,null);
    const retained=(await api(`/api/activity?actorId=${person.id}&limit=100`)).items;
    for(const item of beforeActivity) {
      assert.equal(retained.find(entry=>entry.id===item.id)?.actor?.displayName,'Casey Chen','Removal keeps existing activity attribution.');
    }
    await page.goto(origin+'/app/settings?section=spaces',{waitUntil:'networkidle'});
    await page.locator('.space-choice').filter({hasText:'Departure handover'}).click();
    await page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Bulk',exact:true}).click();
    for(const {title} of pages)await page.getByRole('checkbox',{name:title,exact:true}).check();
    await page.getByRole('button',{name:'Change owner',exact:true}).click();
    const bulk=page.getByRole('dialog',{name:'owner 2 selected pages',exact:true});
    await bulk.getByRole('combobox',{name:'New owner',exact:true}).selectOption('browser-owner');
    await accessible(page,'bulk reassignment of removed member pages');
    await bulk.getByRole('button',{name:'Apply to selected pages',exact:true}).click();
    await expect(bulk).toBeHidden();
    await expect(page.getByRole('list',{name:'Bulk results',exact:true})).toContainText('Saved');
    for(const {id} of pages)assert.equal((await api(`/api/pages/${id}`)).properties.ownerMemberId,'browser-owner');
    await accessible(page,'removed member pages reassigned in bulk');
    assert.equal((await call(colleague,origin,'GET','/api/session')).status,401);
    await ok(context,origin,'POST','/api/members/remove',{operationKey:key(),memberId:person.id,erase:true});
    const anonymized=(await api('/api/activity?limit=100')).items;
    for(const item of beforeActivity)assert.equal(anonymized.find(entry=>entry.id===item.id)?.actor,null,'Personal-data erasure anonymizes retained activity.');
    for(const link of links)assert.equal((await second.request.get(link,{maxRedirects:0})).status(),400);
    const lastOwnerBefore=await api('/api/members');
    const refused=await call(context,origin,'POST','/api/members/remove',{operationKey:key(),memberId:'browser-owner'});
    assert.equal(refused.status,409,'The last owner cannot remove themselves.');
    assert.equal((await api('/api/members/current')).role,'owner');
    assert.deepEqual(await api('/api/members'),lastOwnerBefore,'Refused last-owner removal changes no member.');
  } finally {await colleague.close();await second.close();}
}

/** Finish authority proof after all journeys that still need the setup owner's session. */
export async function setupMemberRemovalJourney(state,width,reader) {
  const {page,context,origin,api}=state,key=()=>randomUUID();
  const memberPage=await reader.newPage(),otherOwner=await context.browser().newContext({viewport:page.viewportSize()});
  try {
    const email=[`taylor-owner-${width}`,'test.invalid'].join('@');
    const link=await inviteFromSettings(state,memberPage,email);
    await expect(memberPage.getByRole('button',{name:/^Remove/})).toHaveCount(0);
    const {person,inviter}=await acceptFromMail(state,otherOwner,link);
    assert.equal(inviter,'browser-reader','An ordinary member can invite a new workspace member.');
    assert.ok((await api('/api/members')).items.some(item=>item.id===person.id&&item.email===email));
    await confirmOwnerAction(state,context);
    const promoted=await ok(context,origin,'PUT',`/api/members/${person.id}/role`,{operationKey:key(),expectedRole:'member',role:'owner'});
    assert.equal(promoted.value.role,'owner');
    const session=await signInWithOutbox(origin,email);
    await otherOwner.addCookies([{name:'slate_session',value:session.cookie.split('=')[1],url:origin}]);
    const owners=(await api('/api/members')).items.filter(item=>item.role==='owner');
    assert.deepEqual(owners.map(item=>item.id).sort(),['browser-owner',person.id].sort());
    assert.equal(owners.find(item=>item.id==='browser-owner').isSetupOwner,true);
    const otherPage=await otherOwner.newPage();
    await otherPage.goto(origin+'/app/settings?section=members',{waitUntil:'networkidle'});
    const setupRow=otherPage.locator('.settings-list li').filter({has:otherPage.getByText('Alex Owner',{exact:true})});
    await expect(setupRow.getByRole('button',{name:'Remove',exact:true})).toHaveCount(0);
    const before=await api('/api/members');
    const refused=await call(otherOwner,origin,'POST','/api/members/remove',{operationKey:key(),memberId:'browser-owner'});
    assert.equal(refused.status,403);
    assert.equal(refused.body.code,'SETUP_OWNER');
    assert.deepEqual(await api('/api/members'),before,'Another owner cannot change setup membership.');
    await accessible(otherPage,'another owner cannot remove the setup member');
    await otherPage.close();

    await confirmOwnerAction(state,context,otherOwner);
    await page.goto(origin+'/app/settings?section=members',{waitUntil:'networkidle'});
    const ownRow=page.locator('.settings-list li').filter({has:page.getByText('Alex Owner',{exact:true})});
    await ownRow.getByRole('button',{name:'Remove yourself',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Remove Alex Owner?',exact:true});
    await accessible(page,'setup member self-removal with another owner');
    const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/members/remove'&&response.request().method()==='POST');
    await dialog.getByRole('button',{name:'Remove member',exact:true}).click();
    const response=await pending;
    assert.equal(response.status(),200);
    const removalKey=response.request().postDataJSON().operationKey;
    await page.waitForURL(url=>url.pathname==='/signin');
    assert.equal((await call(context,origin,'GET','/api/session')).status,401);
    const remaining=await ok(otherOwner,origin,'GET','/api/members');
    assert.ok(!remaining.items.some(item=>item.id==='browser-owner'));
    assert.equal(remaining.items.find(item=>item.id===person.id).role,'owner');
    assert.equal((await ok(otherOwner,origin,'GET','/api/session')).member.id,person.id);
    // Navigation intentionally retires the signed-in document, so read the
    // native durable receipt rather than a discarded browser body buffer.
    const [{results:[stored]},{results:[operation]},{results:entries}]=await state.atRest(`SELECT status,is_setup_owner AS setup FROM members WHERE id='browser-owner'; SELECT response_status AS status,response_json AS response FROM operation_receipts WHERE actor_member_id='browser-owner' AND operation_key='${removalKey}'; SELECT id,action,target_id AS target FROM activity_entries WHERE operation_key='${removalKey}'`);
    assert.deepEqual(stored,{status:'removed',setup:0});
    assert.equal(operation.status,200);
    const removed=JSON.parse(operation.response);
    assert.equal(removed.value.removed,true);
    assert.equal(removed.receipt.operationKey,removalKey);
    assert.equal(entries.length,1);
    assert.deepEqual(entries[0],{id:removed.receipt.activityId,action:'member.remove',target:'browser-owner'});
    assert.equal((await call(otherOwner,origin,'POST','/api/members/remove',{operationKey:key(),memberId:person.id})).status,409);
    assert.deepEqual(await ok(otherOwner,origin,'GET','/api/members'),remaining,'The surviving last owner stays active.');
    await page.goto(origin+'/app/settings?section=members',{waitUntil:'networkidle'});
    assert.equal(new URL(page.url()).pathname,'/signin');
    await accessible(page,'removed setup member cannot reopen Settings');
  } finally {await memberPage.close();await otherOwner.close();}
}
