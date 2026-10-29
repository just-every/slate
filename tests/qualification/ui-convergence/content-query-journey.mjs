import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect} from '@playwright/test';
import {accessible} from './browser-evidence.mjs';
import {call,grant,ok,withSecondPerson} from './two-people-support.mjs';

/** Native criteria, live results and current authority share the existing writing registration. */
export async function contentQueryJourney(state, width) {
  const {page,context,origin,api}=state;
  const mutate=(method,path,data,actor=context)=>ok(actor,origin,method,path,{operationKey:randomUUID(),...data});
  const space=(await mutate('POST','/api/containers',{name:'Query sources',visibility:'default'})).value.id;
  const elsewhere=(await mutate('POST','/api/containers',{name:'Other query sources',visibility:'default'})).value.id;
  await mutate('POST','/api/status',{key:'query-ready',label:'Query ready',color:'#145a3d',requiresVerification:false});
  const create=async(title,{parentPageId,containerId=space,statusKey='query-ready',actor=context}={})=>{
    const blockId=randomUUID();
    const created=(await mutate('POST','/api/pages',{containerId,parentPageId,title,properties:{statusKey},blocks:[{id:blockId,blockType:'paragraph',treePosition:'a',content:{text:[{text:'Initial query source'}]}}]},actor)).value;
    const doc=await ok(actor,origin,'GET',`/api/pages/${created.pageId}`);
    await mutate('PATCH',`/api/pages/${created.pageId}/blocks/${blockId}`,{expectedRevisionId:doc.blocks[0].revisionId,content:{text:[{text:'Committed contribution to '+title}]}},actor);
    return created.pageId;
  };
  const source=await create('Query source ancestor');
  const alpha=await create('Alpha query page',{parentPageId:source});
  const bravo=await create('Bravo private query page',{parentPageId:source});
  const zulu=await create('Zulu query page',{parentPageId:source});
  const wrongStatus=await create('Other status query page',{parentPageId:source,statusKey:null});
  const outside=await create('Outside ancestor query page');
  const otherSpace=await create('Other space query page',{containerId:elsewhere});
  const target=await create('Live content query report',{containerId:(await api('/api/containers')).items.find(item=>item.name==='Handbook').id,statusKey:null});
  await grant(context,origin,bravo,'browser-owner','full');
  await mutate('PUT',`/api/sharing/pages/${bravo}/inheritance`,{expectedRevisionId:(await api(`/api/pages/${bravo}`)).page.revisionId,restricted:true});
  const workspace=await api('/api/workspace');
  const policies=async value=>{
    const current=await api('/api/workspace');
    const {name,mark,description,guestAccess,publicLinkAccess,anonymousAccess}=current;
    await mutate('PUT','/api/workspace',{expectedRevisionId:current.revisionId,name,mark,description,guestAccess,publicLinkAccess,anonymousAccess,policies:value});
  };
  await withSecondPerson(state,width,async({bob})=>{
    const wrongContributor=await create('Morgan contributed query page',{parentPageId:source,actor:bob.context});
    const database=(await mutate('POST','/api/databases',{containerId:space,title:'Query record source'})).value;
    const record=(await mutate('POST',`/api/databases/${database.id}/records`,{title:'Query database record',values:{}})).value.pageId;
    let ownerDraft,readerDraft;
    try {
      await policies({...workspace.policies,'page.lifecycle.v1':'draft-then-publish'});
      ownerDraft=await create('Author private draft query page',{parentPageId:source});
      readerDraft=await create('Morgan private draft query page',{parentPageId:source,actor:bob.context});
      assert.equal((await api(`/api/pages/${ownerDraft}`)).page.lifecycle,'draft');
      assert.equal((await ok(bob.context,origin,'GET',`/api/pages/${readerDraft}`)).page.lifecycle,'draft');
    } finally {await policies(workspace.policies);}
    await grant(context,origin,target,bob.id,'view');
    // A restricted ancestor lets revocation remove source access independently of the report.
    await grant(context,origin,source,'browser-owner','full');
    await grant(context,origin,source,bob.id,'view');
    await mutate('PUT',`/api/sharing/pages/${source}/inheritance`,{expectedRevisionId:(await api(`/api/pages/${source}`)).page.revisionId,restricted:true});

    const endpoint=`/api/pages/${target}/query`;
    const query=view=>view.getByRole('region',{name:'Content query',exact:true});
    const responseFor=view=>{
      // Match a newly started request rather than a late response from the page
      // being left, and retain its body before a navigation can discard it.
      const pending=view.waitForRequest(request=>new URL(request.url()).pathname===endpoint&&request.method()==='POST').then(async request=>{
        const response=await request.response();
        assert.ok(response,'The native query request receives a response.');
        return {status:response.status(),body:await response.text()};
      });
      void pending.catch(()=>{});
      return pending;
    };
    const checkResponse=async(view,pending,expected)=>{
      const response=await pending;
      assert.equal(response.status,200,response.body);
      const result=JSON.parse(response.body);
      assert.ok(Number.isFinite(Date.parse(result.ranAt)),'The native query records a valid last-run instant.');
      assert.deepEqual(result.items.map(item=>item.id),expected,'The native response has the exact ordered readable results.');
      await expect(query(view).locator('tbody tr button')).toHaveText(result.items.map(item=>item.title));
      const stamp=await view.evaluate(value=>new Date(value).toLocaleString(),result.ranAt);
      await expect(query(view).locator('footer')).toHaveText(`Ran ${stamp} · ${expected.length} ${expected.length===1?'item':'items'}`);
      for(const id of [ownerDraft,readerDraft])assert.ok(!result.items.some(item=>item.id===id),'Every draft, including the current author’s own, is excluded.');
      return result;
    };
    const reopen=async(view,expected)=>{
      const response=responseFor(view);
      await view.goto(`${origin}/app/pages/${target}`,{waitUntil:'networkidle'});
      return checkResponse(view,response,expected);
    };
    await page.goto(`${origin}/app/pages/${target}`,{waitUntil:'networkidle'});
    const added=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/pages/${target}/blocks`&&response.request().method()==='PUT');
    await page.getByRole('button',{name:/Add block/}).click();
    await page.getByPlaceholder('Type to search').fill('Content query');
    await page.getByRole('option',{name:'Content query',exact:true}).click();
    assert.equal((await added).status(),200);
    await expect(page.locator('.editor-save-status')).toHaveText('Saved');
    let definition={container:space,ancestor:source,pageType:'page',status:'query-ready',contributor:'browser-owner',dateRange:'2000-01-01/2099-12-31',orderBy:'title',limit:2};
    let criteriaCaptured=false;
    const edit=async(changes,expected)=>{
      definition={...definition,...changes};
      await query(page).getByRole('button',{name:'Edit the query',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Edit content query'});
      for(const [label,key]of [['Space','container'],['Under page','ancestor'],['Page type','pageType'],['Status','status'],['Contributor','contributor'],['Order','orderBy']])await dialog.getByLabel(label,{exact:true}).selectOption(definition[key]??'');
      const [from='',through='']=(definition.dateRange??'').split('/');
      await dialog.getByLabel('Updated from',{exact:true}).fill(from);
      await dialog.getByLabel('Updated through',{exact:true}).fill(through);
      await dialog.getByLabel('Maximum results',{exact:true}).fill(String(definition.limit));
      const response=responseFor(page);
      await dialog.getByRole('button',{name:'Save query',exact:true}).click();
      await expect(dialog).toBeHidden();
      await checkResponse(page,response,expected);
      const stored=(await api(`/api/pages/${target}`)).blocks.find(block=>block.blockType==='content-query').content.definition;
      assert.deepEqual(stored,Object.fromEntries(Object.entries(definition).filter(([,value])=>value!==''&&value!==undefined)),'Native controls persist the complete criteria.');
      await query(page).getByRole('button',{name:'Edit the query',exact:true}).click();
      for(const [label,key]of [['Space','container'],['Under page','ancestor'],['Page type','pageType'],['Status','status'],['Contributor','contributor'],['Order','orderBy']])await expect(dialog.getByLabel(label,{exact:true})).toHaveValue(definition[key]??'');
      await expect(dialog.getByLabel('Updated from',{exact:true})).toHaveValue(from);
      await expect(dialog.getByLabel('Updated through',{exact:true})).toHaveValue(through);
      await expect(dialog.getByLabel('Maximum results',{exact:true})).toHaveValue(String(definition.limit));
      if(!criteriaCaptured){
        const close=dialog.getByRole('button',{name:'Close dialog',exact:true});
        await close.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(close).toBeFocused();
        await expect.poll(()=>close.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
        await dialog.getByLabel('Space',{exact:true}).focus();
        await close.hover();
        await expect.poll(()=>close.evaluate(element=>getComputedStyle(element,'::after').opacity)).toBe('1');
        await accessible(page,'content query retained native criteria');criteriaCaptured=true;
      }
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    };
    await edit({},[alpha,bravo]);
    await reopen(page,[alpha,bravo]);
    await accessible(page,'content query criteria and ordered results');
    await reopen(bob.page,[alpha,zulu]);
    await expect(query(bob.page).getByRole('button',{name:'Edit the query',exact:true})).toHaveCount(0);
    await expect(query(bob.page)).not.toContainText('Bravo private query page');
    await query(bob.page).getByRole('button',{name:'Alpha query page',exact:true}).click();
    await bob.page.waitForURL(`${origin}/app/pages/${alpha}`);
    await edit({limit:100},[alpha,bravo,zulu]);
    await edit({status:''},[alpha,bravo,wrongStatus,zulu]);
    await edit({status:'query-ready',contributor:bob.id},[wrongContributor]);
    assert.equal((await call(bob.context,origin,'GET',`/api/pages/${readerDraft}`)).status,200,'Morgan can read their own draft directly.');
    await reopen(bob.page,[wrongContributor]);
    await edit({contributor:'browser-owner',ancestor:'',container:elsewhere},[otherSpace]);
    await edit({container:space,pageType:'record',status:'',contributor:''},[record]);
    await edit({pageType:'page',status:'query-ready',contributor:'browser-owner',ancestor:source,dateRange:'1980-01-01/1990-12-31'},[]);
    await edit({dateRange:'2098-01-01/2099-12-31'},[]);
    await edit({dateRange:'2000-01-01/2099-12-31',orderBy:'updated',limit:2},[bravo,zulu]);
    // A real title commit changes both ordering and the visible result after reopening.
    await mutate('PATCH',`/api/pages/${alpha}`,{expectedRevisionId:(await api(`/api/pages/${alpha}`)).page.revisionId,properties:{title:'Omega updated query page'}});
    await reopen(page,[alpha,bravo]);
    await expect(query(page).getByRole('button',{name:'Omega updated query page',exact:true})).toBeVisible();
    await edit({orderBy:'title',limit:100},[bravo,alpha,zulu]);
    await reopen(bob.page,[alpha,zulu]);
    await expect(query(bob.page).getByRole('button',{name:'Omega updated query page',exact:true})).toBeVisible();
    const rerun=responseFor(bob.page);
    await query(bob.page).getByRole('button',{name:'Run it again',exact:true}).click();
    await checkResponse(bob.page,rerun,[alpha,zulu]);

    const unavailable=async(view,action)=>{
      const response=responseFor(view);
      await action();
      const refused=await response;
      assert.equal(refused.status,404);
      assert.equal(JSON.parse(refused.body).code,'QUERY_SOURCE_UNAVAILABLE');
      await expect(query(view).getByText('The query source is unavailable.',{exact:true})).toBeVisible();
      await expect(query(view).locator('tbody tr')).toHaveCount(0);
    };
    const sourceGrant=(await api(`/api/sharing/pages/${source}`)).items.find(item=>item.principalId===bob.id);
    await mutate('POST','/api/sharing',{id:sourceGrant.id,targetKind:'page',targetId:source,principalKind:'member',principalId:bob.id,level:'view',revoke:true});
    await unavailable(bob.page,()=>bob.page.reload({waitUntil:'networkidle'}));
    await unavailable(bob.page,()=>query(bob.page).getByRole('button',{name:'Run it again',exact:true}).click());
    await grant(context,origin,source,bob.id,'view');
    await reopen(bob.page,[alpha,zulu]);
    await page.goto(`${origin}/app/pages/${source}`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.getByRole('menuitem',{name:'Move to trash',exact:true}).click();
    const trash=page.getByRole('dialog',{name:'Move this page to trash?'});
    const beforeTrash=await api(`/api/pages/${source}`);
    const denied=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/archive/${source}`&&response.request().method()==='POST');
    await trash.getByRole('button',{name:'Confirm',exact:true}).click();
    assert.equal((await denied).status(),404,'The source cannot be trashed while Morgan’s private draft is not shared with Alex.');
    assert.deepEqual(await api(`/api/pages/${source}`),beforeTrash,'Refused trash leaves the source unchanged.');
    await trash.getByRole('button',{name:'Cancel',exact:true}).click();
    await grant(bob.context,origin,readerDraft,'browser-owner','full');
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.getByRole('menuitem',{name:'Move to trash',exact:true}).click();
    const removed=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/archive/${source}`&&response.request().method()==='POST');
    await trash.getByRole('button',{name:'Confirm',exact:true}).click();
    assert.equal((await removed).status(),200);
    assert.equal((await call(context,origin,'GET',`/api/pages/${source}`)).status,404);
    for(const view of [page,bob.page]){
      await unavailable(view,()=>view.goto(`${origin}/app/pages/${target}`,{waitUntil:'networkidle'}));
      await unavailable(view,()=>query(view).getByRole('button',{name:'Run it again',exact:true}).click());
    }
    await query(page).getByRole('button',{name:'Edit the query',exact:true}).click();
    const missing=page.getByRole('dialog',{name:'Edit content query'});
    await expect(missing.getByLabel('Under page',{exact:true})).toHaveValue(source);
    await missing.getByRole('button',{name:'Save query',exact:true}).click();
    await expect(missing).toBeHidden();
    assert.equal((await api(`/api/pages/${target}`)).blocks.find(block=>block.blockType==='content-query').content.definition.ancestor,source,'Saving other criteria never silently broadens a query with a missing source.');
    await unavailable(page,()=>query(page).getByRole('button',{name:'Run it again',exact:true}).click());
    await accessible(page,'content query deleted source without stale results');
    // Keep the seed corpus explicit: these negatives must exist rather than testing an empty workspace.
    assert.equal((await api(`/api/pages/${outside}`)).page.title,'Outside ancestor query page');
  });
}
