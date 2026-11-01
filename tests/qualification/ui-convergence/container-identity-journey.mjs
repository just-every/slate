import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible} from './browser-evidence.mjs';
import {call,ok} from './two-people-support.mjs';

const VISIBILITIES=['default','open','closed','private'];
const SWITCHES=['guestAccess','publicLinkAccess','anonymousAccess'];
const IDENTITY=['id','key','icon','name','description','owners'];
const pick=(value,names)=>Object.fromEntries(names.map(name=>[name,value[name]]));

/** CONT-001 — one container carries every attribute and holds exactly its own tree, read back through the native doors. */
export async function containerIdentityJourney(state,width) {
  const {page,context,origin,api}=state,key=()=>randomUUID();
  const reader=await context.browser().newContext({viewport:page.viewportSize()});
  await reader.addCookies([{name:'slate_session',value:state.readerCookie.split('=')[1],url:origin}]);
  try {
    const owner=await api('/api/members/current'),morgan=await ok(reader,origin,'GET','/api/members/current');
    const created=(await ok(context,origin,'POST','/api/containers',{operationKey:key(),name:'Identity reconciliation',description:`Every attribute of one space at ${width}`,icon:'🧭',key:`IDR${width}`,visibility:'closed'})).value;
    const space=created.id,expected={id:space,key:`IDR${width}`,icon:'🧭',name:'Identity reconciliation',description:`Every attribute of one space at ${width}`,owners:[{memberId:owner.id,displayName:owner.displayName}]};
    const read=async(who=context)=>ok(who,origin,'GET',`/api/containers/${space}`);
    const seen=new Set(['closed']);
    let current=await read();
    assert.deepEqual(pick(current,IDENTITY),expected,'The read model names identifier, key, icon, name, description and owners.');
    assert.deepEqual((await api('/api/containers')).items.find(item=>item.id===space),current,'The index entry equals the container read.');
    assert.equal((await ok(context,origin,'GET','/api/containers?archived=true')).items.some(item=>item.id===space),false);
    const duplicate=await call(context,origin,'POST','/api/containers',{operationKey:key(),name:'Same key elsewhere',key:expected.key});
    assert.ok(duplicate.status>=400,'A key names exactly one container in the workspace.');
    assert.equal((await api('/api/containers')).items.filter(item=>item.key===expected.key).length,1);

    // All visibility values that a person may set, each with a different external-access switch off.
    const combos=[['forbidden','allowed','allowed'],['allowed','forbidden','allowed'],['allowed','allowed','forbidden'],['forbidden','forbidden','forbidden']];
    for(const [index,visibility] of VISIBILITIES.entries()) {
      const switches=Object.fromEntries(SWITCHES.map((name,at)=>[name,combos[index][at]]));
      await ok(context,origin,'POST','/api/sharing/container-settings',{operationKey:key(),id:space,expectedRevisionId:current.revisionId,visibility,...switches});
      const next=await read();
      assert.notEqual(next.revisionId,current.revisionId);
      assert.equal(next.visibility,visibility);
      seen.add(next.visibility);
      assert.deepEqual(pick(next,SWITCHES),switches,`Three external-access switches read back with ${visibility}.`);
      assert.deepEqual(pick(next,IDENTITY),expected,'Changing access leaves identity untouched.');
      current=next;
    }
    assert.equal((await call(context,origin,'POST','/api/sharing/container-settings',{operationKey:key(),id:space,expectedRevisionId:current.revisionId,visibility:'personal',guestAccess:'allowed',publicLinkAccess:'allowed',anonymousAccess:'allowed'})).status,400,'Personal is never chosen by hand.');
    assert.equal((await call(context,origin,'POST','/api/containers',{operationKey:key(),name:'Handmade personal',visibility:'personal'})).status,403);
    await ok(context,origin,'PATCH',`/api/containers/${space}`,{operationKey:key(),expectedRevisionId:current.revisionId,name:'Identity reconciled',description:'Edited description',icon:'🗺️',key:`IDX${width}`});
    Object.assign(expected,{name:'Identity reconciled',description:'Edited description',icon:'🗺️',key:`IDX${width}`});
    current=await read();
    assert.deepEqual(pick(current,IDENTITY),expected,'An identity edit changes only the named attributes and keeps the identifier and owners.');
    assert.equal(current.visibility,'private');

    // Personal containers arrive with native membership: owned, private, closed to every switch, never visible to another person.
    const personal=async(who,id)=>(await ok(who,origin,'GET','/api/containers')).items.filter(item=>item.visibility==='personal'&&item.owners.some(o=>o.memberId===id));
    const [mine]=await personal(context,owner.id),[theirs]=await personal(reader,morgan.id);
    for(const [item,person] of [[mine,owner],[theirs,morgan]]) {
      assert.ok(item,'Native membership produced a personal container.');
      seen.add(item.visibility);
      assert.deepEqual(item.owners,[{memberId:person.id,displayName:person.displayName}]);
      assert.equal(item.key,`personal:${person.id}`);
      assert.deepEqual(pick(item,SWITCHES),{guestAccess:'forbidden',publicLinkAccess:'forbidden',anonymousAccess:'forbidden'});
    }
    assert.notEqual(mine.id,theirs.id);
    assert.deepEqual((await ok(context,origin,'GET','/api/containers')).items.filter(item=>item.visibility==='personal').map(item=>item.id),[mine.id],'Another person\'s personal container is never listed, even to a workspace owner.');
    assert.equal((await call(context,origin,'GET',`/api/containers/${theirs.id}`)).status,404);
    assert.equal((await call(reader,origin,'GET',`/api/containers/${space}`)).status,404,'A private space stays unlisted for someone without a grant.');
    assert.equal((await call(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:mine.id,principalKind:'member',principalId:morgan.id,level:'view'})).status,403,'A personal container cannot be shared.');
    assert.deepEqual([...seen].sort(),['closed','default','open','personal','private'],'All five visibility values were read back.');

    const grantPage=await grantShape(state,space,morgan.id);
    const tree=await seedTree(state,space,{[created.homePageId]:null,[grantPage]:null});
    await reconcileTree(state,space,tree);
    await showIdentity(state,space,tree,width);
    await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,principalKind:'member',principalId:morgan.id,level:'view'});
    assert.equal((await read(reader)).name,'Identity reconciled');
    assert.deepEqual((await ok(reader,origin,'GET',`/api/containers/${space}`)).owners,expected.owners,'A granted member reads the same owners.');
    await reconcileTree(state,space,tree,reader);
    assert.equal((await ok(reader,origin,'GET',`/api/containers/${space}`)).permissions.canManage,false);
  } finally {await reader.close();}
}

/** The container grant list has the page grant list's row shape and grants are real native rows. */
async function grantShape({context,origin,api},space,memberId) {
  const key=()=>randomUUID();
  const pageId=(await ok(context,origin,'POST','/api/pages',{operationKey:key(),containerId:space,title:'Grant shape page'})).value.pageId;
  await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'page',targetId:pageId,principalKind:'member',principalId:memberId,level:'comment'});
  await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,principalKind:'member',principalId:memberId,level:'edit'});
  const container=await api(`/api/sharing/containers/${space}`),pageGrants=await api(`/api/sharing/pages/${pageId}`);
  const row=list=>list.items.find(item=>item.principalKind==='member'&&item.principalId===memberId);
  assert.deepEqual(Object.keys(row(container)).sort(),Object.keys(row(pageGrants)).sort(),'A container grant row has a page grant row\'s shape.');
  assert.equal(row(container).level,'edit');
  assert.equal(row(container).status,'active');
  assert.equal(row(pageGrants).level,'comment');
  assert.ok(container.items.some(item=>item.principalKind==='member'&&item.level==='full'),'The owner holds a full grant.');
  await ok(context,origin,'POST','/api/sharing',{operationKey:key(),targetKind:'container',targetId:space,id:row(container).id,principalKind:'member',principalId:memberId,level:'edit',revoke:true});
  assert.equal(row(await api(`/api/sharing/containers/${space}`)).status,'revoked');
  return pageId;
}

/** A branching tree and a database in one container, with a second container holding nodes that must never mix in. */
async function seedTree({context,origin},space,others) {
  const key=()=>randomUUID(),make=async(containerId,title,parentPageId)=>(await ok(context,origin,'POST','/api/pages',{operationKey:key(),containerId,title,parentPageId})).value.pageId;
  const other=(await ok(context,origin,'POST','/api/containers',{operationKey:key(),name:'Neighbouring space'})).value.id;
  const root=await make(space,'Tree root'),left=await make(space,'Left branch',root),leaf=await make(space,'Deep leaf',left),right=await make(space,'Right branch',root),lone=await make(space,'Second root');
  const database=(await ok(context,origin,'POST','/api/databases',{operationKey:key(),containerId:space,title:'Tree database',parentPageId:right})).value;
  const foreign=[await make(other,'Neighbour root'),await make(other,'Neighbour tree database child')];
  await ok(context,origin,'POST','/api/databases',{operationKey:key(),containerId:other,title:'Neighbour database'});
  for(const id of [root,left,right])await ok(context,origin,'POST',`/api/pages/${id}/expansion`,{operationKey:key(),expanded:true});
  const parents={...others,[root]:null,[left]:root,[leaf]:left,[right]:root,[lone]:null,[database.pageId]:right};
  return {parents,database,foreign,other};
}

async function reconcileTree({context,origin},space,tree,who=context) {
  const listing=async id=>(await ok(who,origin,'GET',`/api/pages?containerId=${id}`)).items;
  const read=async()=>{const items=await listing(space);return Object.fromEntries(items.map(item=>[item.id,item.parentPageId??null]));};
  assert.deepEqual((await read()),tree.parents,'The container lists exactly its own nodes with canonical identifiers and parents.');
  const kinds=Object.fromEntries((await listing(space)).map(item=>[item.id,item.pageKind]));
  assert.equal(kinds[tree.database.pageId],'database','The database sits in the tree.');
  const record=(await ok(who,origin,'GET',`/api/databases/${tree.database.id}`)).database;
  assert.equal(record.page_id,tree.database.pageId,'The database record names its tree node.');
  assert.equal(record.container_id??space,space);
  for(const id of tree.foreign)assert.ok(!(id in tree.parents));
  assert.ok((await listing(tree.other)).every(item=>!(item.id in tree.parents)),'Another container\'s tree shares no node.');
}

async function showIdentity({page,origin},space,tree,width) {
  await page.goto(`${origin}/app/containers/${space}`,{waitUntil:'networkidle'});
  const nav=page.getByRole('navigation',{name:'Space navigation',exact:true});
  await nav.getByRole('button',{name:'Settings',exact:true}).click();
  const card=page.getByRole('region',{name:'Space identity',exact:true});
  const fact=async name=>(await card.locator('dt',{hasText:new RegExp(`^${name}$`)}).locator('xpath=following-sibling::dd[1]').textContent());
  expect(await fact('Identifier')).toBe(space);
  expect(await fact('Key')).toBe(`IDX${width}`);
  expect(await fact('Icon')).toBe('🗺️');
  expect(await fact('Name')).toBe('Identity reconciled');
  expect(await fact('Description')).toBe('Edited description');
  expect(await fact('Owners')).toBe('Alex Owner');
  expect(await fact('Visibility')).toBe('private');
  for(const name of ['Guest access','Public link access','Anonymous access'])expect(await fact(name)).toBe('Forbidden');
  await accessible(page,'space identity card');
  await nav.getByRole('button',{name:'Content',exact:true}).click();
  const links=page.locator('.space-detail .page-tree a');
  await expect(links).toHaveCount(Object.keys(tree.parents).length);
  const rendered=async()=>page.locator('.space-detail .page-tree a').evaluateAll(anchors=>Object.fromEntries(anchors.map(a=>{
    const parent=a.closest('li').parentElement.closest('li')?.querySelector(':scope > .tree-row a');
    const own=new URL(a.href).pathname;return [own,parent?new URL(parent.href).pathname:null];
  })));
  const href=id=>`/app/pages/${id}`;
  const expectedDom=Object.fromEntries(Object.entries(tree.parents).map(([id,parent])=>[href(id),parent?href(parent):null]));
  assert.deepEqual(await rendered(),expectedDom,'The rendered tree matches canonical identifiers and parentage.');
  await page.reload({waitUntil:'networkidle'});
  await nav.getByRole('button',{name:'Content',exact:true}).click();
  await expect(page.locator('.space-detail .page-tree a')).toHaveCount(Object.keys(tree.parents).length);
  assert.deepEqual(await rendered(),expectedDom,'The same tree after reload.');
  await expect(page.locator('.space-detail .page-tree').first()).not.toContainText('Neighbour');
  await accessible(page,'space tree after reload');
}
