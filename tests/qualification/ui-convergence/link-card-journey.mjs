import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {call} from './two-people-support.mjs';

/** BLOCK-009: native clipboard, preview boundary, committed blocks and display switches. */
export async function linkCardJourney(state, width) {
  const {page,origin,api,context} = state;
  const container = (await api('/api/containers')).items.find(item=>item.name==='Handbook');
  const made = await call(context,origin,'POST','/api/pages',{operationKey:crypto.randomUUID(),containerId:container.id,title:'Pasted references',blocks:[{id:crypto.randomUUID(),blockType:'paragraph',treePosition:'00',content:{text:[{text:'Before replace after',marks:['bold']}]}}]});
  assert.equal(made.status,200); const id = made.body.value.pageId;
  await page.goto(origin+'/app/pages/'+id,{waitUntil:'networkidle'});
  const url = 'https://synthetic-slate-preview.test/Ready?encoded=%2f#KeepCase';
  const paragraph = page.getByRole('textbox',{name:'Paragraph',exact:true}).first();
  await paragraph.focus();
  await page.keyboard.press('Home');
  for(let i=0;i<7;i++)await page.keyboard.press('ArrowRight');
  for(let i=0;i<7;i++)await page.keyboard.press('Shift+ArrowRight');
  await page.evaluate(value=>navigator.clipboard.writeText(value),url);
  await page.keyboard.press('Control+V');
  const read = () => api('/api/pages/'+id);
  const cards = () => page.locator('[data-block-id]').filter({has:page.getByRole('group',{name:'How this link is shown'})});
  await expect(cards().first()).toContainText('Synthetic target reference');
  await expect(cards().first()).toContainText('A target description kept with the pasted link.');
  await expect.poll(async()=> (await read()).blocks.find(block=>block.blockType==='link-card')?.content.previewState).toBe('ready');
  let saved = await read(), card = saved.blocks.find(block=>block.blockType==='link-card');
  assert.equal(card.content.url,url);
  assert.equal(saved.blocks[0].content.text[0].text,'Before ');
  assert.deepEqual(saved.blocks[0].content.text[0].marks,['bold']);
  assert.equal(saved.blocks[2].content.text[0].text,'after');
  assert.match(card.content.preview.iconData,/^data:image\/svg\+xml;base64,/);
  const storedPreview = card.content.preview;
  await expect(cards().first().locator('img')).toBeVisible();
  assert.equal(await cards().first().locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),true);
  for (const [label,display] of [['Plain link','plain'],['Inline card','inline'],['Block card','card']]) {
    await cards().first().getByRole('button',{name:label,exact:true}).click();
    await expect.poll(async()=>(await read()).blocks.find(block=>block.id===card.id).content.display).toBe(display);
    await page.reload({waitUntil:'networkidle'});
    const retained = (await read()).blocks.find(block=>block.id===card.id).content;
    assert.equal(retained.url,url); assert.deepEqual(retained.preview,storedPreview);
    await expect(cards().first().getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(cards().first().getByRole('link')).toHaveAttribute('href',url);
    if(display==='plain')await expect(cards().first().getByRole('link')).toHaveText(url);
    else await expect(cards().first().getByRole('link')).toContainText('Synthetic target reference');
  }
  await page.screenshot({path:'.artifacts/ui-convergence/link-card-'+width+'.png',fullPage:true});
  // Rejected redirects and genuine remote failure keep the exact link and explanation after reload.
  for (const [path,stateName] of [['refused','refused'],['failed','failed']]) {
    const pasted = 'https://synthetic-slate-preview.test/'+path+'?keep=%2f#Original';
    const tail = page.getByRole('textbox',{name:'Paragraph',exact:true}).last();
    await tail.focus(); await page.keyboard.press('End');
    await page.evaluate(value=>navigator.clipboard.writeText(value),pasted); await page.keyboard.press('Control+V');
    await expect.poll(async()=>(await read()).blocks.find(block=>block.content.url===pasted)?.content.previewState).toBe(stateName);
    await page.reload({waitUntil:'networkidle'});
    const row=cards().filter({has:page.getByRole('link',{name:pasted,exact:true})});
    await expect(row.getByRole('status')).toContainText(stateName==='refused'?'Private and local destinations':'did not return a supported preview');
    await expect(row.getByRole('link')).toHaveAttribute('href',pasted);
    assert.equal((await read()).blocks.find(block=>block.content.url===pasted).content.url,pasted);
  }
  await page.screenshot({path:'.artifacts/ui-convergence/link-card-fallback-'+width+'.png',fullPage:true});
  const seen = await state.readLinkPreviewRequests();
  const target = seen.filter(item=>new URL(item.url).hostname==='synthetic-slate-preview.test');
  assert.deepEqual(target.map(item=>new URL(item.url).pathname),['/Ready','/icon.svg','/refused','/failed']);
  for(const request of seen) {
    assert.equal(request.method,'GET'); assert.equal(request.body,'');
    assert.equal(request.headers.cookie,undefined); assert.equal(request.headers.authorization,undefined);
    assert.equal(request.headers.referer,undefined);
    assert.ok(!JSON.stringify(request).includes('browser-owner'));
  }
  assert.ok(!seen.some(item=>new URL(item.url).hostname==='private.synthetic-slate-preview.test'));
}
