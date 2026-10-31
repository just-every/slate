import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { accessible } from './browser-evidence.mjs';
import { call, ok, withSecondPerson } from './two-people-support.mjs';

const seeded = [
  ['in-progress', 'In progress', '#4488cc', 0],
  ['ready-for-review', 'Ready for review', '#cc9900', 0],
  ['rough-draft', 'Rough draft', '#8b9098', 0],
  ['verified', 'Verified', '#228855', 1],
];
const vocabularyRecord = items => items.map(s => [s.key, s.label, s.color, Number(s.requiresVerification)]).sort((a,b) => a[0].localeCompare(b[0]));
const retained = document => ({page:document.page,blocks:document.blocks,properties:document.properties,workingRevisionId:document.workingRevisionId,publishedRevisionId:document.publishedRevisionId,verification:document.verification});

/** Native Settings, page verification and the shared container bulk-status action. */
export async function statusVocabularyJourney(state, width) {
  const {page,context,origin,api}=state;
  const originalProfile=(await api('/api/workspace')).policies['page.status.v1'];
  const space=(await api('/api/containers')).items.find(s=>s.name==='Handbook');
  const shot = label => page.screenshot({path:`.artifacts/ui-convergence/status-vocabulary-${width}-${label}.png`,fullPage:false});
  const settings = async () => {
    await page.goto(origin+'/app/settings?section=statuses',{waitUntil:'networkidle'});
    await expect(page.getByRole('heading',{name:'Name the state of the work.'})).toBeVisible();
  };
  const profile = async value => {
    await page.goto(origin+'/app/settings',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Edit workspace & policies',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Workspace settings',exact:true});
    await dialog.getByLabel('Page status',{exact:true}).selectOption(value);
    await dialog.getByRole('button',{name:'Save settings',exact:true}).click();
    await expect(dialog).toHaveCount(0);
  };
  const saveEntry = async ({label,color,retire=false}, existingLabel) => {
    if(existingLabel) await page.locator('.settings-list li').filter({hasText:existingLabel}).getByRole('button',{name:'Edit',exact:true}).click();
    else await page.getByRole('button',{name:'Add status',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:existingLabel?'Edit status':'Add status',exact:true});
    await dialog.getByLabel('Name',{exact:true}).fill(label);
    await dialog.getByLabel('Colour',{exact:true}).fill(color);
    await dialog.getByLabel('Require a human to verify the exact revision').check();
    if(retire) await dialog.getByLabel('Retire this status',{exact:true}).check();
    await dialog.getByRole('button',{name:'Save status',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    return (await api('/api/status')).items.find(s=>s.label===label);
  };
  try {
    for(const [index,value] of ['verification-only','open-vocabulary'].entries()) {
      await profile(value);
      const beforeVocabulary=(await api('/api/status')).items;
      assert.deepEqual(vocabularyRecord(beforeVocabulary.filter(s=>seeded.some(([key])=>key===s.key))),seeded);
      await settings();
      for(const [,label] of seeded) await expect(page.locator('.settings-list li').filter({hasText:label})).toBeVisible();
      const label=`Review ${index+1}`, renamed=`Reviewed ${index+1}`;
      const added=await saveEntry({label,color:'#654321'});
      assert.ok(added.key);
      assert.equal(added.requiresVerification,1);
      const ids=[];
      for(let n=1;n<=2;n++) {
        const {value:{pageId}}=await ok(context,origin,'POST','/api/pages',{operationKey:randomUUID(),containerId:space.id,title:`Vocabulary ${index+1} page ${n}`,blocks:[{id:randomUUID(),blockType:'paragraph',treePosition:'1',content:{text:[{text:'Retain this content and its status until an explicit change.'}]}}]});
        ids.push(pageId);
        await page.goto(`${origin}/app/pages/${pageId}?detail=status`,{waitUntil:'networkidle'});
        await page.getByLabel('Set page status',{exact:true}).selectOption(added.key);
        const verify=page.getByRole('dialog',{name:'Verify this exact revision',exact:true});
        await verify.getByLabel('No expiry',{exact:true}).check();
        await verify.getByRole('button',{name:'I reviewed this revision',exact:true}).click();
        await expect(verify).toHaveCount(0);
        assert.equal((await api(`/api/pages/${pageId}`)).properties.statusKey,added.key);
      }
      await settings();
      const updated=await saveEntry({label:renamed,color:'#2468ac'},label);
      assert.equal(updated.key,added.key);
      assert.equal(updated.color,'#2468ac');
      assert.equal(updated.requiresVerification,1);
      const snapshots=await Promise.all(ids.map(async id=>({document:retained(await api(`/api/pages/${id}`)),history:await api(`/api/revisions/${id}`)})));
      await saveEntry({label:renamed,color:'#2468ac',retire:true},renamed);
      const retired=(await api('/api/status')).items.find(s=>s.key===added.key);
      assert.ok(retired.retiredAt);
      assert.equal(retired.label,renamed);
      for(const [n,id] of ids.entries()) {
        assert.deepEqual(retained(await api(`/api/pages/${id}`)),snapshots[n].document,'Retirement preserves assigned status, content and revision.');
        assert.deepEqual(await api(`/api/revisions/${id}`),snapshots[n].history,'Retirement writes no page revision.');
      }
      await page.reload({waitUntil:'networkidle'});
      const row=page.locator('.settings-list li').filter({hasText:renamed});
      await expect(row).toContainText('Retired');
      await expect(row.getByRole('button',{name:'Change assigned pages',exact:true})).toBeVisible();
      await shot(`${value}-retired-settings`);
      await page.goto(`${origin}/app/pages/${ids[0]}?detail=status`,{waitUntil:'networkidle'});
      await expect(page.locator('.page-status-chip')).toContainText(renamed);
      await expect(page.getByLabel('Set page status',{exact:true}).locator(`option[value="${added.key}"]`)).toHaveCount(0);
      await shot(`${value}-retained-page`);
      if(width===1440) {
        await withSecondPerson(state,width,async people=>{
          await people.bob.page.goto(origin+'/app/settings?section=statuses',{waitUntil:'networkidle'});
          await expect(people.bob.page.getByRole('button',{name:'Add status',exact:true})).toHaveCount(0);
          await expect(people.bob.page.getByRole('button',{name:'Edit',exact:true})).toHaveCount(0);
          const before=await api('/api/status');
          for(const mutation of [
            {key:randomUUID(),label:'Unauthorized add',color:'#123456',requiresVerification:false},
            {key:added.key,label:'Unauthorized rename',color:'#2468ac',requiresVerification:true},
            {key:added.key,label:renamed,color:'#112233',requiresVerification:true},
            {key:'verified',label:'Verified',color:'#228855',requiresVerification:true,retire:true},
          ]) {
            const refused=await call(people.bob.context,origin,'POST','/api/status',{operationKey:randomUUID(),...mutation});
            assert.equal(refused.status,403);
            assert.deepEqual(await api('/api/status'),before,'A non-owner vocabulary attempt changes nothing.');
          }
          for(const [n,id] of ids.entries()) assert.deepEqual(retained(await api(`/api/pages/${id}`)),snapshots[n].document);
        });
      }
      await settings();
      await page.locator('.settings-list li').filter({hasText:renamed}).getByRole('button',{name:'Change assigned pages',exact:true}).click();
      const bulk=page.getByRole('region',{name:`Pages carrying ${renamed}`,exact:true});
      for(let n=1;n<=2;n++) await bulk.getByLabel(`Vocabulary ${index+1} page ${n}`,{exact:true}).check();
      await bulk.getByRole('button',{name:'Change status',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'status 2 selected pages',exact:true});
      await expect(dialog.getByLabel('New status').locator(`option[value="${added.key}"]`)).toHaveCount(0);
      await dialog.getByLabel('New status').selectOption('in-progress');
      await shot(`${value}-explicit-bulk`);
      const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/pages/bulk'&&r.request().method()==='POST');
      await dialog.getByRole('button',{name:'Apply to selected pages',exact:true}).click();
      const response=await responsePromise,receipt=await response.json();
      assert.equal(response.status(),200);
      assert.deepEqual(receipt.items.map(r=>[r.id,r.success]).sort(),ids.map(id=>[id,true]).sort());
      assert.deepEqual((await ok(context,origin,'POST','/api/pages/bulk',response.request().postDataJSON())).items,receipt.items,'Replaying a committed bulk request returns the original per-page receipts.');
      await expect(dialog).toHaveCount(0);
      for(const [n,id] of ids.entries()) {
        const after=await api(`/api/pages/${id}`);
        assert.equal(after.properties.statusKey,'in-progress');
        assert.deepEqual(after.blocks,snapshots[n].document.blocks);
        assert.notEqual(after.page.revisionId,snapshots[n].document.page.revisionId);
      }
      await page.reload({waitUntil:'networkidle'});
      await page.locator('.settings-list li').filter({hasText:renamed}).getByRole('button',{name:'Change assigned pages',exact:true}).click();
      await expect(page.getByRole('region',{name:`Pages carrying ${renamed}`,exact:true}).locator('.bulk-page-list li')).toHaveCount(0);
      await accessible(page,'status vocabulary and explicit bulk change');
      console.log(`PROBE STAT-001 profile=${value}: native owner controls, retained pages, non-owner refusals and explicit bulk receipts passed at ${width}px`);
    }
  } finally { await profile(originalProfile); }
}
