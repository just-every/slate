import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible} from './browser-evidence.mjs';
import {call,ok} from './two-people-support.mjs';
import {containerGrantsJourney} from './container-grants-journey.mjs';
import {memberRemovalJourney} from './member-removal-journey.mjs';
import {guestScopeJourney} from './guest-scope-journey.mjs';

/** Workspace administration and content grants remain separate authorities. */
export async function workspaceAuthorityJourney(state,width) {
  const {page,context,origin,api}=state,key=()=>randomUUID();
  const reader=await context.browser().newContext({viewport:page.viewportSize()});
  await reader.addCookies([{name:'slate_session',value:state.readerCookie.split('=')[1],url:origin}]);
  const read=route=>ok(reader,origin,'GET',route);
  try {
    assert.equal((await api('/api/members/current')).role,'owner');
    assert.equal((await read('/api/members/current')).role,'member');
    const workspace=await api('/api/workspace');
    const settings={operationKey:key(),expectedRevisionId:workspace.revisionId,name:workspace.name,mark:workspace.mark,description:'Workspace administration journey',guestAccess:workspace.guestAccess,publicLinkAccess:workspace.publicLinkAccess,anonymousAccess:workspace.anonymousAccess,policies:workspace.policies};
    assert.equal((await call(reader,origin,'PUT','/api/workspace',settings)).status,403);
    assert.deepEqual(await api('/api/workspace'),workspace,'Refused settings change leaves the workspace intact.');
    await ok(context,origin,'PUT','/api/workspace',settings);
    assert.equal((await api('/api/workspace')).description,settings.description);
    const current=await api('/api/workspace');
    const switches=Object.fromEntries(['guestAccess','publicLinkAccess','anonymousAccess'].map(name=>[name,current[name]==='allowed'?'forbidden':'allowed']));
    await ok(context,origin,'PUT','/api/workspace',{...settings,operationKey:key(),expectedRevisionId:current.revisionId,...switches});
    const switched=await api('/api/workspace');
    for(const [name,value] of Object.entries(switches))assert.equal(switched[name],value);
    await ok(context,origin,'PUT','/api/workspace',{...settings,operationKey:key(),expectedRevisionId:switched.revisionId});
    const groupsBefore=await api('/api/groups');
    assert.equal((await call(reader,origin,'POST','/api/groups',{operationKey:key(),name:'Unauthorized group',memberIds:[]})).status,403);
    assert.deepEqual(await api('/api/groups'),groupsBefore);
    assert.equal((await call(reader,origin,'GET','/api/guests')).status,403);
    assert.ok(Array.isArray((await api('/api/guests')).items));
    const membersBefore=await api('/api/members');
    assert.equal((await call(reader,origin,'POST','/api/members/remove',{operationKey:key(),memberId:'browser-owner'})).status,403);
    assert.deepEqual(await api('/api/members'),membersBefore);

    const privateSpace=(await ok(reader,origin,'POST','/api/containers',{operationKey:key(),name:'Member confidential work',visibility:'private'})).value.id;
    const privatePage=(await ok(reader,origin,'POST','/api/pages',{operationKey:key(),containerId:privateSpace,title:'Member confidential plan'})).value.pageId;
    const manageable=await api(`/api/containers/${privateSpace}`);
    assert.equal(manageable.permissions.canManage,true);
    assert.equal(manageable.permissions.canCreatePages,false);
    await ok(context,origin,'PATCH',`/api/containers/${privateSpace}`,{operationKey:key(),expectedRevisionId:manageable.revisionId,description:'Administered without joining'});
    assert.equal((await read(`/api/containers/${privateSpace}`)).description,'Administered without joining');
    assert.equal((await call(context,origin,'GET',`/api/pages/${privatePage}`)).status,404,'The owner role alone never grants page access.');

    const space=(await ok(context,origin,'POST','/api/containers',{operationKey:key(),name:'Group response guides',visibility:'private'})).value.id;
    const pageId=(await ok(context,origin,'POST','/api/pages',{operationKey:key(),containerId:space,title:'Group response checklist'})).value.pageId;
    assert.equal((await call(reader,origin,'GET',`/api/pages/${pageId}`)).status,404);
    await page.goto(origin+'/app/settings?section=members',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Create group',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Create group',exact:true});
    await dialog.getByRole('textbox',{name:'Name',exact:true}).fill('Response team');
    await dialog.getByRole('checkbox',{name:'Morgan Reader',exact:true}).check();
    const close=dialog.getByRole('button',{name:'Close dialog',exact:true});
    await page.keyboard.press('Tab');
    await close.focus();
    await expect.poll(()=>close.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
    await expect(close).toHaveAttribute('data-tooltip',/\S+\s+\S+/);
    await accessible(page,'group dialog keyboard tooltip');
    await dialog.getByRole('textbox',{name:'Name',exact:true}).focus();
    await page.mouse.move(0,0);
    await expect.poll(()=>close.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('0');
    await close.hover();
    await expect.poll(()=>close.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
    await accessible(page,'named group with selected member');
    await dialog.getByRole('button',{name:'Save group',exact:true}).click();
    await expect(dialog).toBeHidden();
    const group=(await api('/api/groups')).items.find(item=>item.name==='Response team');
    assert.deepEqual(group.memberIds,['browser-reader']);
    for(const [targetKind,targetId] of [['page',pageId],['container',space]]) {
      await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind,targetId,principalKind:'group',principalId:group.id,level:'view'});
    }
    assert.equal((await read(`/api/pages/${pageId}`)).page.title,'Group response checklist');
    assert.equal((await read(`/api/containers/${space}`)).name,'Group response guides');
    const activity=async()=>(await api('/api/activity?kind=group&action=group.save&limit=100')).items.filter(item=>item.target.id===group.id);
    const before=await activity();
    assert.equal((await call(reader,origin,'POST','/api/groups',{operationKey:key(),id:group.id,expectedRevisionId:group.revisionId,name:group.name,memberIds:[]})).status,403);
    assert.deepEqual((await api('/api/groups')).items.find(item=>item.id===group.id),group);
    const row=page.locator('.settings-list li').filter({has:page.getByText('Response team',{exact:true})});
    await row.getByRole('button',{name:'Edit',exact:true}).click();
    const edit=page.getByRole('dialog',{name:'Edit group',exact:true});
    await edit.getByRole('checkbox',{name:'Morgan Reader',exact:true}).uncheck();
    await edit.getByRole('button',{name:'Save group',exact:true}).click();
    await expect(edit).toBeHidden();
    const changed=(await api('/api/groups')).items.find(item=>item.id===group.id);
    assert.deepEqual(changed.memberIds,[]);
    assert.equal((await call(reader,origin,'GET',`/api/pages/${pageId}`)).status,404);
    assert.equal((await call(reader,origin,'GET',`/api/containers/${space}`)).status,404);
    assert.equal((await activity()).length,before.length+1,'One membership change writes one visible activity entry.');
    await accessible(page,'group membership removed and access revoked');
    const add={operationKey:key(),id:group.id,expectedRevisionId:changed.revisionId,name:group.name,memberIds:['browser-reader']};
    const saved=await ok(context,origin,'POST','/api/groups',add);
    await ok(context,origin,'POST','/api/groups',add);
    assert.equal((await activity()).length,before.length+2,'Replaying membership addition writes no second activity.');
    assert.equal((await read(`/api/pages/${pageId}`)).page.title,'Group response checklist');
    for(const [targetKind,targetId] of [['page',pageId],['container',space]]) {
      await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind,targetId,principalKind:'member',principalId:'browser-reader',level:'view'});
    }
    const grants=async()=>Promise.all([api(`/api/sharing/pages/${pageId}`),api(`/api/sharing/containers/${space}`)]);
    const personal=(await grants()).map(result=>result.items.filter(grant=>grant.principalKind==='member'));
    assert.equal((await call(reader,origin,'POST','/api/groups',{operationKey:key(),id:group.id,expectedRevisionId:saved.value.revisionId,name:group.name,memberIds:[],remove:true})).status,403);
    assert.ok((await api('/api/groups')).items.some(item=>item.id===group.id));
    await ok(context,origin,'POST','/api/groups',{operationKey:key(),id:group.id,expectedRevisionId:saved.value.revisionId,name:group.name,memberIds:[],remove:true});
    assert.ok(!(await api('/api/groups')).items.some(item=>item.id===group.id));
    await ok(context,origin,'POST','/api/groups',add);
    assert.ok(!(await api('/api/groups')).items.some(item=>item.id===group.id),'Replaying an earlier membership save cannot resurrect a deleted group.');
    const after=await grants();
    assert.deepEqual(after.map(result=>result.items.filter(grant=>grant.principalKind==='member')),personal);
    assert.ok(after.every(result=>!result.items.some(grant=>grant.principalKind==='group'&&grant.principalId===group.id)));
    assert.equal((await read(`/api/pages/${pageId}`)).page.title,'Group response checklist');
    assert.equal((await read(`/api/containers/${space}`)).name,'Group response guides');
    await page.reload({waitUntil:'networkidle'});
    await expect(page.getByText('Response team',{exact:true})).toHaveCount(0);
    if(width===390) {
      const more=page.getByRole('button',{name:'More settings sections',exact:true});
      await page.keyboard.press('Tab');
      await more.focus();
      await expect.poll(()=>more.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
      await expect(more).toHaveAttribute('data-tooltip',/\S+\s+\S+/);
    }
    await accessible(page,'deleted group leaves individual grants intact');
    await containerGrantsJourney(state,width);
    await memberRemovalJourney(state,width);
    await guestScopeJourney(state,width);
  } finally {await reader.close();}
}
