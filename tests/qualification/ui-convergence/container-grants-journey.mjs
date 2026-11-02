import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {expect} from '@playwright/test';
import {root} from '../../e2e/runtime-harness.mjs';
import {accessible} from './browser-evidence.mjs';
import {call,ok,caretAtEnd,elapsedUntil,withSecondPerson} from './two-people-support.mjs';

const key=()=>randomUUID();
async function openAccess(page,origin,id) {
  await page.goto(`${origin}/app/containers/${id}`,{waitUntil:'networkidle'});
  await page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();
  const disclosure=page.locator('.space-access-details');
  if(await disclosure.count())await disclosure.locator('summary').click();
  await expect(page.getByRole('button',{name:'Grant access',exact:true})).toBeVisible();
}

/** Native grant edits retain their exact receipt, grant snapshot and one activity under replay. */
async function saveAccess(actor,origin,space,{principal,level,id,revoke=false,expires=false},proof) {
  const {page,context}=actor;
  let previous;
  if(id) {
    const snapshot=await ok(context,origin,'GET',`/api/sharing/containers/${space}`);
    const row=snapshot.items.find(item=>item.id===id);
    previous=row;
    const label=row.principalKind==='workspace'?'Everyone in workspace':row.principalKind==='container'?'Space members':row.principalLabel;
    await page.locator('.space-detail .settings-list li').filter({hasText:label}).filter({has:page.getByRole('button',{name:'Edit access',exact:true})}).getByRole('button',{name:'Edit access',exact:true}).click();
  } else await page.getByRole('button',{name:'Grant access',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Space access grant',exact:true});
  if(principal)await dialog.getByRole('combobox',{name:'Person or group',exact:true}).selectOption(principal);
  await dialog.getByRole('combobox',{name:'Access',exact:true}).selectOption(level);
  if(expires) {
    await dialog.getByRole('textbox',{name:'Access expiry date and time',exact:true}).fill('30 Dec 2099, 15:45');
    await dialog.getByRole('textbox',{name:'Access expiry date and time',exact:true}).blur();
  }
  if(revoke)await dialog.getByRole('checkbox',{name:'Revoke this grant',exact:true}).check();
  if(principal?.startsWith('group:')) {
    const close=dialog.getByRole('button',{name:'Close dialog',exact:true});
    await page.keyboard.press('Tab');
    await close.focus();
    await expect.poll(()=>close.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
    await expect(close).toHaveAttribute('data-tooltip',/\S+\s+\S+/);
    await accessible(page,'container administrator selects a group');
  }
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sharing'&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Save access',exact:true}).click();
  const response=await saving,input=response.request().postDataJSON();
  assert.equal(response.status(),200,await response.text());
  const receipt=await response.json();
  await expect(dialog).toBeHidden();
  const snapshot=await ok(context,origin,'GET',`/api/sharing/containers/${space}`);
  const grant=snapshot.items.find(item=>item.id===receipt.value.id);
  assert.ok(grant);
  assert.deepEqual({kind:grant.principalKind,id:grant.principalId,level:grant.level,expiresAt:grant.expiresAt,revoked:!!grant.revokedAt},
    input.revoke?{kind:previous.principalKind,id:previous.principalId,level:previous.level,expiresAt:previous.expiresAt,revoked:true}:
      {kind:input.principalKind,id:input.principalId,level:input.level,expiresAt:input.expiresAt,revoked:false});
  assert.equal(receipt.receipt.operationKey,input.operationKey);
  const replay=await ok(context,origin,'POST','/api/sharing',input);
  assert.deepEqual(replay.receipt,receipt.receipt);
  assert.deepEqual(await ok(context,origin,'GET',`/api/sharing/containers/${space}`),snapshot,'Replaying the native action changes no grant or principal.');
  const activity=(await ok(context,origin,'GET','/api/activity?action=sharing.grant&kind=container&limit=100')).items.filter(item=>item.operationKey===input.operationKey);
  assert.equal(activity.length,1,'Each native grant change produces exactly one activity entry under replay.');
  assert.equal(activity[0].id,receipt.receipt.activityId);
  assert.deepEqual(activity[0].target,{kind:'container',id:space});
  proof.changes.push({input,receipt:receipt.receipt,grant,activity:activity[0]});
  return {id:grant.id,input,committedAt:Date.parse(receipt.receipt.committedAt)};
}

/** Container administrators select principals without receiving group administration or memberships. */
export async function containerGrantsJourney(state,width) {
  await withSecondPerson(state,width,async people=>{
    const {origin,context,page,api}=state,{bob}=people;
    const admin={page:bob.page,context:bob.context},owner={page,context};
    const proof={width,changes:[],deadlines:{}};
    const mutate=(actor,route,data,method='POST')=>ok(actor,origin,method,route,{operationKey:key(),...data});
    const space=(await mutate(context,'/api/containers',{name:'Container grant corpus',visibility:'private'})).value.id;
    const create=async(title,parentPageId)=> (await mutate(bob.context,'/api/pages',{containerId:space,parentPageId,title})).value.pageId;
    await mutate(context,'/api/sharing',{targetKind:'container',targetId:space,principalKind:'member',principalId:'browser-reader',level:'full'});
    const group=(await mutate(context,'/api/groups',{name:'Container grant reviewers',memberIds:['browser-owner']})).value;
    const existing=await create('Existing inherited root'),child=await create('Existing inherited child',existing);
    const restricted=await create('Restricted branch');
    await mutate(context,'/api/sharing',{targetKind:'page',targetId:restricted,principalKind:'member',principalId:'browser-reader',level:'full'});
    const restrictedDocument=await ok(bob.context,origin,'GET',`/api/pages/${restricted}`);
    await mutate(bob.context,`/api/sharing/pages/${restricted}/inheritance`,{expectedRevisionId:restrictedDocument.page.revisionId,restricted:true},'PUT');
    const restrictedChild=await create('Restricted descendant',restricted);
    const restrictedBefore=await ok(bob.context,origin,'GET',`/api/sharing/pages/${restricted}`);
    const original=(await api(`/api/sharing/containers/${space}`)).items.find(item=>item.principalId==='browser-owner');
    await mutate(context,'/api/sharing',{id:original.id,targetKind:'container',targetId:space,principalKind:'member',principalId:'browser-owner',level:'full',revoke:true});
    const projection=await ok(bob.context,origin,'GET',`/api/sharing/containers/${space}`);
    assert.deepEqual(projection.principals.find(item=>item.id===group.id),{kind:'group',id:group.id,label:group.name});
    assert.ok(projection.principals.every(item=>!('memberIds' in item)&&!('email' in item)&&!('revisionId' in item)),'Only grant-selection labels cross the container administration boundary.');
    assert.equal((await call(bob.context,origin,'GET','/api/groups')).status,403);
    assert.equal((await call(bob.context,origin,'POST','/api/groups',{operationKey:key(),id:group.id,expectedRevisionId:group.revisionId,name:group.name,memberIds:[]})).status,403);
    assert.deepEqual((await api('/api/groups')).items.find(item=>item.id===group.id),{id:group.id,name:group.name,revisionId:group.revisionId,memberIds:['browser-owner']});
    const principals=width===1440?['member:browser-owner',`group:${group.id}`,'workspace:browser-workspace',`container:${space}`]:[`group:${group.id}`];
    for(const [actorName,actor] of [['administrator',admin],['owner',owner]]) {
      await openAccess(actor.page,origin,space);
      for(const principal of principals) {
        const created=await saveAccess(actor,origin,space,{principal,level:'view',expires:true},proof);
        const later=await create(`Later descendant ${actorName} ${principal.split(':')[0]}`,child);
        const levels=width===1440?['view','comment','edit','full']:['view','edit'];
        for(const level of levels) {
          if(level!=='view')await saveAccess(actor,origin,space,{id:created.id,level},proof);
          for(const id of [existing,child,later]) {
            const document=await api(`/api/pages/${id}`);
            assert.equal(document.permissions.level,level,'Existing and later descendants use the current container level.');
            assert.equal(document.permissions.canEdit,['edit','full'].includes(level));
            const inherited=(await ok(bob.context,origin,'GET',`/api/sharing/pages/${id}`)).inheritedItems.find(item=>item.id===created.id);
            assert.ok(inherited?.effective);
            assert.equal(inherited.level,level);
            assert.equal(inherited.expiresAt,proof.changes.find(item=>item.grant.id===created.id).grant.expiresAt);
            assert.deepEqual(inherited.origin,{kind:'container',id:space,name:'Container grant corpus'});
          }
          for(const id of [restricted,restrictedChild])assert.equal((await call(context,origin,'GET',`/api/pages/${id}`)).status,404,'A container grant cannot cross a restricted branch.');
          assert.deepEqual(await ok(bob.context,origin,'GET',`/api/sharing/pages/${restricted}`),restrictedBefore,'Container edits preserve restrictions and direct grants.');
        }
        await actor.page.reload({waitUntil:'networkidle'});
        await actor.page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();
        const details=actor.page.locator('.space-access-details');
        if(await details.count())await details.locator('summary').click();
        if(principal.startsWith('group:'))await accessible(actor.page,`${actorName} container group grant persists`);
        await saveAccess(actor,origin,space,{id:created.id,level:levels.at(-1),revoke:true},proof);
        for(const id of [existing,child,later])assert.equal((await call(context,origin,'GET',`/api/pages/${id}`)).status,404);
        const revoked=await api(`/api/sharing/containers/${space}`);
        await ok(actor.context,origin,'POST','/api/sharing',created.input);
        assert.deepEqual(await api(`/api/sharing/containers/${space}`),revoked,'Replaying the original create cannot resurrect a revoked grant.');
      }
    }
    if(width===1440) {
      await refusalAndLiveChange(state,people,proof);
      const config=await api('/api/sharing/configuration');
      const changed=await mutate(context,'/api/sharing/configuration',{expectedRevisionId:config.revisionId,levels:['edit','view']},'PUT');
      await openAccess(bob.page,origin,space);
      await bob.page.getByRole('button',{name:'Grant access',exact:true}).click();
      const dialog=bob.page.getByRole('dialog',{name:'Space access grant',exact:true});
      assert.deepEqual(await dialog.getByRole('combobox',{name:'Access',exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value)),['view','edit']);
      await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
      const before=await api(`/api/sharing/containers/${space}`);
      assert.equal((await call(bob.context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,principalKind:'group',principalId:group.id,level:'comment'})).status,400);
      assert.deepEqual(await api(`/api/sharing/containers/${space}`),before);
      await mutate(context,'/api/sharing/configuration',{expectedRevisionId:changed.value.revisionId,levels:config.levels},'PUT');
    }
    const evidence=path.join(root,'.artifacts/ui-convergence');
    await mkdir(evidence,{recursive:true});
    await writeFile(path.join(evidence,`container-grants-${width}.json`),JSON.stringify(proof,null,2));
    console.log(`PROBE CONT-009 native controls ${width}: owner and non-owner administrator grant changes=${proof.changes.length}; replay and inherited snapshots pass; deadlines=${JSON.stringify(proof.deadlines)}`);
  });
}

async function refusalAndLiveChange(state,people,proof) {
  const {origin,context,page,api}=state,{bob}=people,owner={page,context};
  const space=(await ok(context,origin,'POST','/api/containers',{operationKey:key(),name:'Current container authority',visibility:'private'})).value.id;
  const block=key(),marker=`synthetic-slate-${key().slice(0,8)}`;
  const existing=(await ok(context,origin,'POST','/api/pages',{operationKey:key(),containerId:space,title:marker,blocks:[{id:block,blockType:'paragraph',treePosition:'0',content:{text:[{text:'Persisted content.'}]}}]})).value.pageId;
  const listing=()=>api(`/api/sharing/containers/${space}`);
  await openAccess(page,origin,space);
  const access=await saveAccess(owner,origin,space,{principal:'member:browser-reader',level:'edit'},proof);
  for(const level of ['edit','view']) {
    if(level==='view')await saveAccess(owner,origin,space,{id:access.id,level},proof);
    assert.equal((await ok(bob.context,origin,'GET',`/api/pages/${existing}`)).permissions.level,level);
    const before=await listing(),activity=await api('/api/activity?action=sharing.grant&kind=container&limit=100');
    assert.ok([403,404].includes((await call(bob.context,origin,'GET',`/api/sharing/containers/${space}`)).status));
    for(const input of [{principalKind:'group',principalId:before.principals.find(item=>item.kind==='group').id},{id:access.id,principalKind:'member',principalId:'browser-reader',revoke:true}]) {
      assert.ok([403,404].includes((await call(bob.context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,level:'full',...input})).status));
    }
    assert.deepEqual(await listing(),before);
    assert.deepEqual(await api('/api/activity?action=sharing.grant&kind=container&limit=100'),activity,'Refused administration writes no activity.');
    await bob.page.goto(`${origin}/app/containers/${space}`,{waitUntil:'networkidle'});
    await bob.page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();
    await expect(bob.page.getByRole('button',{name:'Grant access',exact:true})).toHaveCount(0);
  }
  const personal=(await api('/api/containers')).items.find(item=>item.visibility==='personal');
  const personalBefore=await api(`/api/sharing/containers/${personal.id}`);
  assert.deepEqual(personalBefore.principals,[]);
  assert.equal((await call(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:personal.id,principalKind:'member',principalId:'browser-reader',level:'view'})).status,403);
  assert.deepEqual(await api(`/api/sharing/containers/${personal.id}`),personalBefore);
  await page.goto(`${origin}/app/containers/${personal.id}`,{waitUntil:'networkidle'});
  await page.getByRole('navigation',{name:'Space navigation',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByText('Your personal space stays private.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Grant access',exact:true})).toHaveCount(0);
  await openAccess(page,origin,space);
  const visible=async()=>{
    const [document,tree,search,inbox]=await Promise.all([
      call(bob.context,origin,'GET',`/api/pages/${existing}`),
      ok(bob.context,origin,'GET','/api/pages'),
      ok(bob.context,origin,'GET',`/api/search?q=${marker}`),
      ok(bob.context,origin,'GET','/api/notifications'),
    ]);
    return {page:document.status===200,tree:tree.items.some(item=>item.id===existing),search:search.items.some(item=>item.id===existing),inbox:inbox.items.some(item=>item.pageId===existing)};
  };
  for(const [name,revoke] of [['narrowed',false],['revoked',true]]) {
    await saveAccess(owner,origin,space,{id:access.id,level:'edit'},proof);
    // A real page notification proves the populated inbox loses the target after revocation.
    await ok(context,origin,'POST',`/api/comments/page/${existing}`,{operationKey:key(),kind:'page',body:[{text:'Read this '},{text:'Morgan Reader',mention:{kind:'person',id:'browser-reader',label:'Morgan Reader'}}]});
    assert.deepEqual(await visible(),{page:true,tree:true,search:true,inbox:true});
    await bob.page.goto(`${origin}/app/pages/${existing}`,{waitUntil:'networkidle'});
    await caretAtEnd(bob.page,block);
    let held;
    const matches=url=>url.pathname===`/api/pages/${existing}/blocks/${block}`;
    const hold=route=>{if(route.request().method()==='PATCH')held=route;else void route.continue();};
    await bob.page.route(matches,hold);
    const unsent=` Unsent container ${name}`;
    try {
      await bob.page.keyboard.type(unsent);
      await expect.poll(()=>!!held).toBe(true);
      const changed=await saveAccess(owner,origin,space,{id:access.id,level:'view',revoke},proof);
      const since=changed.committedAt;
      const response=await held.fetch({maxRetries:0});
      assert.ok([403,404].includes(response.status()),'The next native write after a container change is refused.');
      await held.fulfill({response});
      held=undefined;
      const measured={writeStatus:response.status()};
      measured.editorMs=await elapsedUntil(async()=>!(await bob.page.locator(`[data-block-id="${block}"] [contenteditable="true"]`).count()),{timeout:5000,since});
      measured.projectionsMs=await elapsedUntil(async()=>{
        const current=await visible();
        return Object.values(current).every(value=>value===!revoke);
      },{timeout:5000,since});
      assert.ok(measured.editorMs<=5000&&measured.projectionsMs<=5000);
      const draft=bob.page.getByRole('region',{name:'Your unsaved text'});
      await expect(draft).toContainText(unsent.trim());
      await expect(draft).toContainText('It was not saved to the workspace');
      if(revoke)await expect(bob.page.getByRole('heading',{name:'Access needed',exact:true})).toBeVisible();
      else await expect(bob.page.getByText('This page is read-only with your current access.',{exact:true})).toBeVisible();
      const durable=await api(`/api/pages/${existing}`);
      assert.equal(durable.blocks[0].content.text[0].text,'Persisted content.');
      assert.ok(!(await api(`/api/search?q=${encodeURIComponent(unsent.trim())}`)).items.some(item=>item.id===existing));
      await accessible(bob.page,`container grant ${name} retains unsaved text`);
      await draft.getByRole('button',{name:'Discard',exact:true}).click();
      await bob.page.reload({waitUntil:'networkidle'});
      if(revoke)await expect(bob.page.getByRole('heading',{name:'Access needed',exact:true})).toBeVisible();
      else await expect(bob.page.getByRole('textbox',{name:'Page title',exact:true})).toHaveAttribute('readonly','');
      proof.deadlines[name]=measured;
    } finally {
      await held?.abort().catch(()=>{});
      await bob.page.unroute(matches,hold);
    }
  }
}
