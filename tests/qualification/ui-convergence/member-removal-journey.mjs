import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {inbox,newOutboxLink,signInWithOutbox} from '../../e2e/outbox-auth.mjs';
import {accessible} from './browser-evidence.mjs';
import {call,ok} from './two-people-support.mjs';

/** Invite twice before joining, then remove through Settings with both sessions live. */
export async function memberRemovalJourney(state,width) {
  const {page,context,origin,api}=state,key=()=>randomUUID(),email=['casey',`removal-${width}.invalid`].join('@');
  const links=[];
  for(let index=0;index<2;index++) {
    const before=await inbox(origin);
    await ok(context,origin,'POST','/api/invitations',{operationKey:key(),email,kind:'member'});
    links.push(await newOutboxLink(origin,before));
  }
  const colleague=await context.browser().newContext({viewport:page.viewportSize()}),second=await context.browser().newContext(),reader=await context.browser().newContext();
  await reader.addCookies([{name:'slate_session',value:state.readerCookie.split('=')[1],url:origin}]);
  try {
    const accepted=await colleague.request.post(origin+'/api/auth/invitation/accept',{headers:{origin},form:{token:new URL(links[0]).searchParams.get('token')},maxRedirects:0});
    assert.equal(accepted.status(),303);
    const person=await ok(colleague,origin,'GET','/api/members/current');
    const profile=await ok(colleague,origin,'GET',`/api/people/${person.id}`);
    await ok(colleague,origin,'PUT',`/api/people/${person.id}`,{operationKey:key(),expectedRevisionId:profile.revisionId,displayName:'Casey Chen'});
    const session=await signInWithOutbox(origin,email);
    await second.addCookies([{name:'slate_session',value:session.cookie.split('=')[1],url:origin}]);
    const privateSpace=(await ok(colleague,origin,'GET','/api/containers')).items.find(item=>item.visibility==='personal');
    assert.ok(privateSpace);
    for(let repeat=0;repeat<3;repeat++) {
      const members=await Promise.all([colleague,second].map(actor=>ok(actor,origin,'GET','/api/members/current')));
      assert.ok(members.every(member=>member.id===person.id));
      const spaces=(await ok(colleague,origin,'GET','/api/containers')).items.filter(item=>item.visibility==='personal');
      assert.deepEqual(spaces.map(item=>item.id),[privateSpace.id],'Repeated member reads retain exactly one personal container.');
      assert.equal(spaces[0].key,`personal:${person.id}`);
    }
    const personal=(await ok(colleague,origin,'POST','/api/pages',{operationKey:key(),containerId:privateSpace.id,title:'Casey private notes',blocks:[{id:key(),blockType:'paragraph',content:{text:[{text:'Private departure notes remain private.'}]},treePosition:'0'}]})).value.pageId;
    const group=(await ok(context,origin,'POST','/api/groups',{operationKey:key(),name:'Personal privacy readers',memberIds:['browser-owner','browser-reader']})).value.id;
    const privateGrants=()=>Promise.all([
      ok(colleague,origin,'GET',`/api/sharing/containers/${privateSpace.id}`),
      ok(colleague,origin,'GET',`/api/sharing/pages/${personal}`)
    ]);
    const beforeGrants=await privateGrants();
    const principals=[['member','browser-reader'],['member','browser-owner'],['group',group],['workspace','browser-workspace'],['container',privateSpace.id]];
    for(const [targetKind,targetId] of [['container',privateSpace.id],['page',personal]]) {
      for(const [principalKind,principalId] of principals) {
        const refused=await call(colleague,origin,'POST','/api/sharing',{operationKey:key(),targetKind,targetId,principalKind,principalId,level:'view'});
        assert.equal(refused.status,403);
        assert.equal(refused.body.code,'PERSONAL_PRIVATE');
        assert.deepEqual(await privateGrants(),beforeGrants,'Refused personal sharing changes no direct or inherited grant.');
      }
    }
    for(const actor of [context,reader]) {
      for(const route of [`/api/containers/${privateSpace.id}`,`/api/pages/${personal}`,`/api/sharing/containers/${privateSpace.id}`,`/api/sharing/pages/${personal}`]) {
        assert.equal((await call(actor,origin,'GET',route)).status,404,'Neither another member nor a workspace owner can read personal content or grants.');
      }
      assert.ok(!(await ok(actor,origin,'GET','/api/containers')).items.some(item=>item.id===privateSpace.id));
      assert.ok(!(await ok(actor,origin,'GET','/api/pages')).items.some(item=>item.id===personal));
    }
    console.log('PROBE CONT-005 personal privacy: repeated native member reads and personal grant mutations -> one container, ten refusals, unchanged grants, owner and member denied');
    const space=(await ok(context,origin,'POST','/api/containers',{operationKey:key(),name:'Departure handover',visibility:'private'})).value.id;
    const beforeMove=await ok(colleague,origin,'GET',`/api/pages/${personal}`);
    assert.equal((await call(colleague,origin,'POST',`/api/pages/${personal}/move-preview`,{containerId:space,parentPageId:null})).status,404);
    assert.equal((await call(colleague,origin,'POST',`/api/pages/${personal}/move`,{operationKey:key(),expectedRevisionId:beforeMove.page.revisionId,containerId:space,parentPageId:null,treePosition:'0',accessPreviewHash:'synthetic-slate-0'})).status,404);
    assert.deepEqual(await ok(colleague,origin,'GET',`/api/pages/${personal}`),beforeMove,'An unauthorized destination leaves personal content and its location unchanged.');
    assert.deepEqual(await privateGrants(),beforeGrants,'A refused move cannot change personal grants.');
    await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,principalKind:'member',principalId:person.id,level:'full'});
    const destinationGrant=(await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,principalKind:'member',principalId:'browser-reader',level:'view'})).value.id;
    const moved=(await ok(colleague,origin,'POST','/api/pages',{operationKey:key(),containerId:privateSpace.id,title:'Casey shared handover',blocks:[{id:key(),blockType:'paragraph',content:{text:[{text:'Reviewed handover can leave the personal space.'}]},treePosition:'0'}]})).value.pageId;
    for(const actor of [context,reader])assert.equal((await call(actor,origin,'GET',`/api/pages/${moved}`)).status,404);
    const document=await ok(colleague,origin,'GET',`/api/pages/${moved}`);
    const preview=await ok(colleague,origin,'POST',`/api/pages/${moved}/move-preview`,{containerId:space,parentPageId:null});
    assert.ok(preview.changes.some(change=>change.pageId===moved&&change.memberId==='browser-reader'&&change.before===null&&change.after==='view'));
    await ok(colleague,origin,'POST',`/api/pages/${moved}/move`,{operationKey:key(),expectedRevisionId:document.page.revisionId,containerId:space,parentPageId:null,treePosition:'0',accessPreviewHash:preview.accessPreviewHash});
    const movedRead=await ok(reader,origin,'GET',`/api/pages/${moved}`);
    assert.equal(movedRead.page.containerId,space);
    assert.equal(movedRead.page.title,'Casey shared handover');
    assert.equal(movedRead.blocks[0].content.text[0].text,'Reviewed handover can leave the personal space.');
    assert.equal(movedRead.permissions.canEdit,false,'The destination view grant does not become edit authority.');
    const movedGrants=await ok(colleague,origin,'GET',`/api/sharing/pages/${moved}`);
    assert.ok(movedGrants.effectiveItems.some(grant=>grant.id===destinationGrant&&grant.inherited&&grant.origin.id===space));
    assert.equal((await call(reader,origin,'GET',`/api/pages/${personal}`)).status,404,'Moving one page leaves retained personal notes private.');
    const colleaguePage=await colleague.newPage();
    await colleaguePage.goto(origin+`/app/pages/${personal}`,{waitUntil:'networkidle'});
    await expect(colleaguePage.getByRole('textbox',{name:'Page title',exact:true})).toHaveValue('Casey private notes');
    await accessible(colleaguePage,'personal notes remain private after authorized handover');
    await colleaguePage.close();
    console.log('PROBE CONT-005 destination access: native move preview and move into granted container -> retained body, inherited view access, remaining notes private');
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
    assert.equal((await call(colleague,origin,'POST','/api/members/remove',{operationKey:key(),memberId:person.id})).status,403);
    assert.equal((await call(colleague,origin,'POST','/api/members/remove',{operationKey:key(),memberId:'browser-reader'})).status,403);
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
    assert.equal((await call(context,origin,'GET',`/api/containers/${privateSpace.id}`)).status,404);
    assert.equal((await call(reader,origin,'GET',`/api/pages/${personal}`)).status,404);
    assert.equal((await ok(reader,origin,'GET',`/api/pages/${moved}`)).page.containerId,space,'The moved handover remains readable under destination access after removal.');
    console.log('PROBE CONT-005 acceptance 1 and 2: native Settings member removal -> archived container and page, retained private body, revoked sessions, no owner exposure');
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
    const refused=await call(context,origin,'POST','/api/members/remove',{operationKey:key(),memberId:'browser-owner'});
    assert.equal(refused.status,409,'The last owner cannot remove themselves.');
    assert.equal((await api('/api/members/current')).role,'owner');
  } finally {await colleague.close();await second.close();await reader.close();}
}
