import assert from 'node:assert/strict';
import {randomUUID as key} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible} from './browser-evidence.mjs';
import {call,grant,ok} from './two-people-support.mjs';

/** References are retained before every lifecycle transition, never rebuilt afterward. */
export async function referenceStateJourney(state,people) {
  const {origin}=state,{alice,bob}=people;
  const api=(method,path,data)=>ok(alice.context,origin,method,path,data);
  const space=(await api('POST','/api/containers',{operationKey:key(),name:'Reference lifecycle source',visibility:'private'})).value.id;
  const destination=(await api('POST','/api/containers',{operationKey:key(),name:'Reference lifecycle destination',visibility:'private'})).value.id;
  const original='Supplier reference before rename',renamed='Supplier reference after rename',secret='Unpublished supplier reference';
  const target=(await api('POST','/api/pages',{operationKey:key(),containerId:space,title:original})).value.pageId;
  let allowed=(await grant(alice.context,origin,target,bob.id,'view')).value.id;
  const href=`/app/pages/${target}`;
  const mentionId=key(),linkId=key();
  const cards=['plain','inline','card'].map((display,index)=>({id:key(),blockType:'link-card',treePosition:String(index+2),content:{url:href,display,previewState:'ready',preview:{title:original,description:'Stale supplier preview',iconLabel:'Stale icon'}}}));
  const blocks=[
    {id:mentionId,blockType:'paragraph',treePosition:'0',content:{text:[{text:original,mention:{kind:'page',id:target,label:original}}]}},
    {id:linkId,blockType:'paragraph',treePosition:'1',content:{text:[{text:original,link:{href}},{text:' and '},{text:original,link:{href:origin+href},marks:['bold']}]}},
    ...cards,
  ];
  const host=(await api('POST','/api/pages',{operationKey:key(),containerId:space,title:'Retained native references',blocks})).value.pageId;
  await grant(alice.context,origin,host,bob.id,'view');
  const hostBefore=await api('GET',`/api/pages/${host}`);
  const check=async(title,lifecycle,{readerTitle=title,shot=false}={})=>{
    for(const [person,expected] of [[alice,title],[bob,readerTitle]]) {
      await person.page.goto(`${origin}/app/pages/${host}`,{waitUntil:'networkidle'});
      await person.page.reload({waitUntil:'networkidle'});
      const body=person.page.locator('[data-page-editor]');
      const mention=body.locator(`[data-block-id="${mentionId}"]`).first().locator('[data-mention-kind=page]');
      await expect(mention).toContainText(expected);
      if(lifecycle!=='live')await expect(mention).toContainText(lifecycle);
      const inline=body.locator(`[data-block-id="${linkId}"]`).first();
      await expect(inline.getByRole('link',{name:expected,exact:true})).toHaveCount(2);
      await expect(inline.getByRole('link').nth(0)).toHaveAttribute('href',href);
      await expect(inline.getByRole('link').nth(1)).toHaveAttribute('href',origin+href);
      for(const block of cards) {
        const card=body.locator(`[data-block-id="${block.id}"]`).first();
        await expect(card.getByRole('link',{name:expected,exact:true})).toHaveAttribute('href',href);
        if(lifecycle!=='live')await expect(card).toContainText(lifecycle);
        await expect(card).not.toContainText('Stale supplier preview');
      }
      const projected=await ok(person.context,origin,'GET',`/api/pages/${host}`);
      const {label,available,state:projectedState}=projected.mentions[target];
      assert.deepEqual({label,available,state:projectedState},{label:expected,available:!['trashed','deleted'].includes(lifecycle),state:lifecycle});
      assert.equal(projected.blocks[0].content.text[0].mention.id,target);
      const card=await ok(person.context,origin,'GET',`/api/pages/${target}/link-card`);
      assert.deepEqual({title:card.title,href:card.href,state:card.state},{title:expected,href,state:lifecycle});
      if(lifecycle==='deleted') {
        assert.deepEqual(Object.keys(card).sort(),['href','state','title']);
        for(const text of [original,renamed,secret])await expect(body).not.toContainText(text);
      }
      await accessible(person.page,`retained references ${lifecycle}`);
    }
    if(shot)await people.shot('bob',`retained references ${lifecycle}`);
    console.log(`PROBE LINK-003 ${lifecycle}: retained mention, rich links and three card forms -> ${title}; permanent target unchanged`);
  };
  await check(original,'live');
  const read=()=>api('GET',`/api/pages/${target}`);
  const rename=async title=>api('PATCH',`/api/pages/${target}`,{operationKey:key(),expectedRevisionId:(await read()).page.revisionId,properties:{title}});
  await rename(renamed);
  await check(renamed,'live');
  const placement={containerId:destination,parentPageId:null,treePosition:'reference-destination'};
  const preview=await api('POST',`/api/pages/${target}/move-preview`,placement);
  await api('POST',`/api/pages/${target}/move`,{operationKey:key(),expectedRevisionId:(await read()).page.revisionId,...placement,accessPreviewHash:preview.accessPreviewHash});
  assert.equal((await read()).page.containerId,destination);
  await check(renamed,'live');
  const revision=(await read()).page.revisionId;
  for(const [action,lifecycle] of [['archive','archived'],['restore','live'],['trash','trashed'],['restore','live']]) {
    await api('POST',`/api/archive/${target}`,{operationKey:key(),expectedRevisionId:revision,action});
    await check(renamed,lifecycle,{shot:lifecycle!=='live'});
  }
  // Separate working and published titles without allowing the index to disclose a draft.
  const w=await api('GET','/api/workspace');
  const workspace=async policies=>api('PUT','/api/workspace',{operationKey:key(),expectedRevisionId:(await api('GET','/api/workspace')).revisionId,name:w.name,mark:w.mark,description:w.description,guestAccess:w.guestAccess,publicLinkAccess:w.publicLinkAccess,anonymousAccess:w.anonymousAccess,policies});
  await workspace({...w.policies,'page.lifecycle.v1':'draft-then-publish'});
  await rename(secret);
  await check(secret,'live',{readerTitle:renamed});
  await grant(alice.context,origin,target,bob.id,'view',{id:allowed,revoke:true});
  await bob.page.reload({waitUntil:'networkidle'});
  const body=bob.page.locator('[data-page-editor]');
  await expect(body.locator('[data-mention-kind=page]')).toContainText('Restricted page');
  for(const block of cards)await expect(body.locator(`[data-block-id="${block.id}"]`).first()).toContainText('Access needed');
  await expect(body.locator('[data-page-reference]')).toHaveCount(2);
  for(const text of [original,renamed,secret,'Stale icon'])await expect(body).not.toContainText(text);
  assert.equal((await call(bob.context,origin,'GET',`/api/pages/${target}/link-card`)).status,404);
  await people.shot('bob','retained references revoked');
  allowed=(await grant(alice.context,origin,target,bob.id,'view')).value.id;
  await api('POST',`/api/archive/${target}`,{operationKey:key(),expectedRevisionId:(await read()).page.revisionId,action:'trash'});
  const deletion={operationKey:key(),confirmedPageIds:[target]};
  assert.deepEqual((await api('POST',`/api/archive/${target}/permanent-delete`,deletion)).value.deletedPageIds,[target]);
  await api('POST',`/api/archive/${target}/permanent-delete`,deletion);
  await check('Deleted page','deleted',{shot:true});
  const hostAfter=await api('GET',`/api/pages/${host}`);
  assert.equal(hostAfter.workingRevisionId,hostBefore.workingRevisionId,'The retained references were never repointed or rewritten.');
  assert.deepEqual(hostAfter.blocks.map(block=>block.id),hostBefore.blocks.map(block=>block.id));
  await workspace(w.policies);
  people.record('referenceLifecycle',{target,host,states:['live','renamed','moved','archived','restored','trashed','restored','restricted','deleted'],receipt:deletion.operationKey});
}
