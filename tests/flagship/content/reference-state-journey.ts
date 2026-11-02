import {expect} from 'vitest';

type Request = (cookie:string,method:string,path:string,body?:unknown)=>Promise<any>;
/** Retained native references, read by an editor and a viewer through the HTTP doors. */
export async function referenceStateJourney(ok:Request,call:Request,owner:string,reader:string,readerId:string,containerId:string,origin:string) {
  const key=()=>crypto.randomUUID();
  const original='Reference target before rename',renamed='Reference target after rename',secret='Working title not published';
  const target=(await ok(owner,'POST','/api/pages',{operationKey:key(),containerId,title:original})).value.pageId;
  const href=`/app/pages/${target}`;
  const share=()=>ok(owner,'POST','/api/sharing',{operationKey:key(),targetKind:'page',targetId:target,principalKind:'member',principalId:readerId,level:'view'});
  let grant=(await share()).value.id;
  const blocks=[
    {id:key(),blockType:'paragraph',treePosition:'0',content:{text:[{text:original,mention:{kind:'page',id:target,label:original}},{text:original,link:{href}},{text:original,link:{href:origin+href}}]}},
    ...['plain','inline','card'].map((display,index)=>({id:key(),blockType:'link-card',treePosition:String(index+1),content:{url:href,display,previewState:'ready',preview:{title:original,description:'Retained preview must not disclose old content',iconLabel:'Private icon'}}})),
  ];
  const host=(await ok(owner,'POST','/api/pages',{operationKey:key(),containerId,title:'Retained reference index',blocks})).value.pageId;
  await ok(owner,'POST','/api/sharing',{operationKey:key(),targetKind:'page',targetId:host,principalKind:'member',principalId:readerId,level:'view'});
  const hostRevision=(await ok(owner,'GET',`/api/pages/${host}`)).workingRevisionId;
  const read=()=>ok(owner,'GET',`/api/pages/${target}`);
  const check=async(title:string,state:string)=>{
    for(const cookie of [owner,reader]) {
      const doc=await ok(cookie,'GET',`/api/pages/${host}`);
      expect(doc.mentions[target]).toMatchObject({label:title,state});
      expect(doc.blocks[0].content.text.map((span:any)=>span.text)).toEqual([title,title,title]);
      expect(doc.blocks[0].content.text[1].link.href).toBe(href);
      expect(doc.blocks[0].content.text[2].link.href).toBe(origin+href);
      for(const block of doc.blocks.slice(1))expect(block.content).toEqual(expect.objectContaining({url:href}));
      expect(JSON.stringify(doc.blocks)).not.toContain('Retained preview must not disclose');
      const card=await ok(cookie,'GET',`/api/pages/${target}/link-card`);
      expect(card).toMatchObject({title,state,href});
      if(state==='deleted')expect(Object.keys(card).sort()).toEqual(['href','state','title']);
      const historical=await ok(cookie,'GET',`/api/revisions/${host}/${hostRevision}`);
      expect(historical.blocks[0].content.text.map((span:any)=>span.text)).toEqual([title,title,title]);
    }
  };
  await check(original,'live');
  const update=async(title:string)=>ok(owner,'PATCH',`/api/pages/${target}`,{operationKey:key(),expectedRevisionId:(await read()).page.revisionId,properties:{title}});
  await update(renamed);
  await check(renamed,'live');
  const destination=(await ok(owner,'POST','/api/pages',{operationKey:key(),containerId,title:'Reference destination'})).value.pageId;
  const input={containerId,parentPageId:destination,treePosition:'reference-moved'};
  const preview=await ok(owner,'POST',`/api/pages/${target}/move-preview`,input);
  await ok(owner,'POST',`/api/pages/${target}/move`,{...input,operationKey:key(),expectedRevisionId:(await read()).page.revisionId,accessPreviewHash:preview.accessPreviewHash});
  expect((await read()).parentPageId).toBe(destination);
  await check(renamed,'live');
  const revision=(await read()).page.revisionId;
  for(const action of ['archive','restore','trash','restore'] as const) {
    await ok(owner,'POST',`/api/archive/${target}`,{operationKey:key(),expectedRevisionId:revision,action});
    await check(renamed,action==='restore'?'live':action==='archive'?'archived':'trashed');
  }
  // A current reader sees the published title while the editor sees working changes.
  const workspace=await ok(owner,'GET','/api/workspace');
  await ok(owner,'PUT','/api/workspace',{operationKey:key(),expectedRevisionId:workspace.revisionId,name:workspace.name,mark:workspace.mark,description:workspace.description,guestAccess:workspace.guestAccess,publicLinkAccess:workspace.publicLinkAccess,anonymousAccess:workspace.anonymousAccess,policies:{...workspace.policies,'page.lifecycle.v1':'draft-then-publish'}});
  await update(secret);
  expect((await ok(reader,'GET',`/api/pages/${target}/link-card`)).title).toBe(renamed);
  expect((await ok(owner,'GET',`/api/pages/${target}/link-card`)).title).toBe(secret);
  expect((await ok(reader,'GET',`/api/pages/${host}`)).mentions[target].label).toBe(renamed);
  await ok(owner,'POST','/api/sharing',{operationKey:key(),targetKind:'page',targetId:target,id:grant,principalKind:'member',principalId:readerId,level:'view',revoke:true});
  const denied=await call(reader,'GET',`/api/pages/${target}/link-card`);
  expect(denied.status).toBe(404);
  for(const path of [`/api/pages/${host}`,`/api/revisions/${host}/${hostRevision}`]) {
    const doc=await ok(reader,'GET',path);
    expect(JSON.stringify(doc)).not.toContain(renamed);
    expect(JSON.stringify(doc)).not.toContain(original);
    expect(JSON.stringify(doc)).not.toContain(secret);
    expect(doc.blocks[0].content.text.map((span:any)=>span.text)).toEqual(['Restricted page','Restricted page','Restricted page']);
  }
  grant=(await share()).value.id;
  const current=(await read()).page.revisionId;
  await ok(owner,'POST',`/api/archive/${target}`,{operationKey:key(),expectedRevisionId:current,action:'trash'});
  const deletion={operationKey:key(),confirmedPageIds:[target]};
  const receipt=await ok(owner,'POST',`/api/archive/${target}/permanent-delete`,deletion);
  expect(receipt.value.deletedPageIds).toEqual([target]);
  await ok(owner,'POST',`/api/archive/${target}/permanent-delete`,deletion);
  await check('Deleted page','deleted');
  const erased=await call(owner,'GET',`/api/pages/${target}`);
  expect(erased.status).toBe(404);
  expect(erased.body.code).toBe('PAGE_ERASED');
  // The deletion never turns the reader's later revoked grant into tombstone authority.
  // Native grant revocation is unavailable after erasure; the still-current grant is
  // exercised above, while the existing LINK-004 journey proves revocation and expiry.
  await ok(owner,'PUT','/api/workspace',{operationKey:key(),expectedRevisionId:(await ok(owner,'GET','/api/workspace')).revisionId,name:workspace.name,mark:workspace.mark,description:workspace.description,guestAccess:workspace.guestAccess,publicLinkAccess:workspace.publicLinkAccess,anonymousAccess:workspace.anonymousAccess,policies:workspace.policies});
}
