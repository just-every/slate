import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {tap,type,checkpoint} from './touch-controls.mjs';
import {ok} from './two-people-support.mjs';
import {randomUUID} from 'node:crypto';

/** The database's remaining modes use the same member and records as its six layouts. */
export async function touchDatabaseToolsJourney(state,touch){
 const {page,origin,api}=touch;
 const database=(await api('/api/databases')).items.find(item=>item.title==='Response planning');
 assert.ok(database);
 const base=`/api/databases/${database.id}`,document=await api(base);
 const stage=document.fields.find(field=>field.name==='Stage');
 await page.goto(`${origin}/app/databases/${database.id}`,{waitUntil:'networkidle'});
 await tap(page.getByRole('navigation',{name:'Saved views'}).getByRole('button',{name:'Chart',exact:true}));
 await tap(page.getByRole('combobox',{name:'Group',exact:true}));
 await page.getByRole('combobox',{name:'Group',exact:true}).selectOption(stage.id);
 const chart=page.getByRole('figure',{name:'Chart of the current filtered view',exact:true});
 await expect(chart.locator('.chart-row').filter({hasText:'Open'}).locator('strong')).toHaveText('1');
 await checkpoint(page,'database chart configured');
 await tap(page.getByRole('navigation',{name:'Saved views'}).getByRole('button',{name:'Templates',exact:true}));
 await tap(page.getByRole('button',{name:'New template',exact:true}));
 const template=page.getByRole('dialog',{name:'New record template',exact:true});
 await type(page,template.getByRole('textbox',{name:'Template name',exact:true}),'Duty response');
 await type(page,template.getByRole('textbox',{name:'New record name',exact:true}),'Response from a touch template');
 await type(page,template.getByRole('textbox',{name:'Body',exact:true}),'Confirm the response checklist.');
 await checkpoint(page,'database template editor');
 await tap(template.getByRole('button',{name:'Save template',exact:true}));
 await expect(template).toBeHidden();
 const card=page.locator('.record-template-list > li').filter({has:page.getByRole('heading',{name:'Duty response',exact:true})});
 await tap(card.getByRole('button',{name:'Use template',exact:true}));
 const view=document.views[0];
 await expect.poll(async()=>(await api(`${base}/views/${view.id}`)).records.some(record=>record.title==='Response from a touch template')).toBe(true);
 await checkpoint(page,'database template used');
 await tap(page.getByRole('navigation',{name:'Saved views'}).getByRole('button',{name:'Automations',exact:true}));
 await tap(page.getByRole('button',{name:'New automation',exact:true}));
 const automation=page.getByRole('dialog',{name:'Create automation',exact:true});
 await type(page,automation.getByRole('textbox',{name:'Name',exact:true}),'Confirm response intake');
 await tap(automation.getByRole('combobox',{name:'When',exact:true}));
 await automation.getByRole('combobox',{name:'When',exact:true}).selectOption('record-created');
 await tap(automation.getByRole('button',{name:'Add action',exact:true}));
 await type(page,automation.getByRole('textbox',{name:'Comment',exact:true}),'The duty team should review this response.');
 await checkpoint(page,'database automation editor');
 await tap(automation.getByRole('button',{name:'Save automation',exact:true}));
 await expect(automation).toBeHidden();
 const rule=page.locator('.settings-list > li').filter({hasText:'Confirm response intake'});
 await expect(rule).toContainText('Enabled');
 await tap(page.getByRole('button',{name:'New record',exact:true}));
 const record=page.getByRole('dialog',{name:'New record',exact:true});
 await type(page,record.getByRole('textbox',{name:'Name',exact:true}),'Touch automation intake');
 await tap(record.getByRole('button',{name:'Create record',exact:true}));
 await expect(record).toBeHidden();
 await state.runScheduled();
 await tap(rule.getByRole('button',{name:'Run log',exact:true}));
 await expect(page.getByRole('heading',{name:'Run log',exact:true}).locator('..')).toContainText('success');
 const created=(await api(`${base}/views/${view.id}`)).records.find(item=>item.title==='Touch automation intake');
 assert.ok(created);
 const comments=await api(`/api/comments/page/${created.pageId}`);
 assert.equal(comments.comments.filter(comment=>JSON.stringify(comment.body).includes('The duty team should review this response.')).length,1);
 await checkpoint(page,'database automation completed');
 // Keep the native rule readable while removing the actor's mutation authority.
 // The rule's public run log must show the skipped action after a reload.
 const saved=(await api('/api/automation')).items.find(item=>item.name==='Confirm response intake');
 assert.equal(saved.actor_member_id,'browser-reader');
 const blocked=(await ok(touch.context,origin,'POST',`${base}/records`,{
   operationKey:randomUUID(),title:'synthetic-slate-read-only-target',values:{},
 })).value;
 const grant=async(member,level)=>ok(touch.context,origin,'POST','/api/sharing',{
   operationKey:randomUUID(),targetKind:'page',targetId:blocked.pageId,
   principalKind:'member',principalId:member,level,
 });
 await grant('browser-owner','full');
 await grant('browser-reader','view');
 await ok(touch.context,origin,'PUT',`/api/sharing/pages/${blocked.pageId}/inheritance`,{
   operationKey:randomUUID(),expectedRevisionId:blocked.revisionId,restricted:true,
 });
 await state.runScheduled();
 await page.reload({waitUntil:'networkidle'});
 await tap(page.getByRole('navigation',{name:'Saved views'}).getByRole('button',{name:'Automations',exact:true}));
 await tap(rule.getByRole('button',{name:'Run log',exact:true}));
 const log=page.getByRole('heading',{name:'Run log',exact:true}).locator('..');
 await expect(log).toContainText('Action 1: skipped');
 const runs=(await api(`/api/automation/${saved.id}/runs`)).items;
 const skipped=runs.find(item=>JSON.parse(item.trigger_json).pageId===blocked.pageId);
 assert.equal(skipped.state,'no-action');
 assert.deepEqual(skipped.receipts.map(item=>item.state),['skipped']);
 assert.equal((await api(`/api/comments/page/${blocked.pageId}`)).comments.length,0);
 await state.runScheduled();
 assert.deepEqual((await api(`/api/automation/${saved.id}/runs`)).items,runs);
 await log.getByText('Action 1: skipped',{exact:true}).scrollIntoViewIfNeeded();
 await checkpoint(page,'database automation skips current read-only target');
 console.log('NAV-006 touch database charts, templates and automations passed');
}
