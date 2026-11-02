import {devKeyHeaders} from '../e2e/dev-key.mjs';
import {inbox} from '../e2e/outbox-auth.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {runtime,signIn,api,ownerEmail,root} from './runtime.mjs';
import {populatedFixture,attachments,pageIds} from './fixture.mjs';
import {equivalent,unpack} from './equivalence.mjs';
import {bootstrapAuditPredicate} from '../../src/core/features/portability/bootstrap-audit.ts';

test('BASE-DATA-001 PORT-001 PORT-002 PORT-005 — actual native ZIP backup/restore/backup preserves populated D1 and original R2 bytes in a separate empty deployment',{timeout:240000},async t=>{
  const scratch=await mkdtemp(path.join(path.dirname(root),'portability-'));
  let source,target;
  try{
    await mkdir(path.join(scratch,'source'));await mkdir(path.join(scratch,'target'));
    source=await runtime(path.join(scratch,'source'));await source.start();
    let sourceCookie=await signIn(source);
    const owner=(await(await api(source,sourceCookie,'/api/session')).json()).member;
    await source.close();await source.sql(populatedFixture(owner));await source.start();
    const originals=[];
    for(const attachment of attachments){
      const form=new FormData();form.set('operationKey',randomUUID());form.set('pageId','archive-root');form.set('file',new Blob([attachment.bytes],{type:attachment.type}),attachment.name);
      const uploaded=await(await api(source,sourceCookie,'/api/media',{method:'POST',body:form})).json();
      originals.push({id:uploaded.value.id,...attachment});
      const downloaded=await api(source,sourceCookie,`/api/media/${uploaded.value.id}`);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),attachment.bytes);
    }
    await api(source,sourceCookie,'/api/publishing/archive-root',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID(),expectedRevisionId:'archive-root-current',host:new URL(source.origin).host,slug:'research/portable',theme:'dark',indexable:false,socialPreview:{title:'Portable knowledge',description:'Retain publication settings'}})});
    const published=await fetch(source.origin+'/p/research/portable');assert.equal(published.status,200);assert.match(await published.text(),/Restorable research/);
    const get = async (instance, cookie, route) => (await api(instance,cookie,route)).json();
    const mutate = async (instance, cookie, method, route, data) => {
      const response=await fetch(new URL(route,instance.origin),{method,headers:{Cookie:cookie,Origin:instance.origin,'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID(),...data})});
      assert.ok(response.ok,`${method} ${route} succeeds: ${await response.clone().text()}`);
      return (await response.json()).value;
    };
    const database = await mutate(source,sourceCookie,'POST','/api/databases',{containerId:'archive-container',title:'Portable record database'});
    const base = `/api/databases/${database.id}`;
    await mutate(source,sourceCookie,'POST',base+'/fields',{expectedRevisionId:database.revisionId,field:{id:'portable-quantity',name:'Quantity',type:'number',config:{},position:0}});
    const record = await mutate(source,sourceCookie,'POST',base+'/records',{title:'Portable populated record',values:{'portable-quantity':17}});
    const recordPath = base+'/records/'+record.pageId;
    const pagePath = '/api/pages/'+record.pageId;
    await mutate(source,sourceCookie,'PATCH',pagePath,{expectedRevisionId:record.revisionId,properties:{icon:'📚'}});
    await mutate(source,sourceCookie,'PUT',pagePath+'/blocks',{expectedRevisionId:(await get(source,sourceCookie,pagePath)).page.revisionId,
      blocks:[{id:'portable-record-body',blockType:'paragraph',treePosition:'a',content:{text:[{text:'Imported record body remains intact'}]}}]});
    const earlierRecord = await get(source,sourceCookie,recordPath);
    await mutate(source,sourceCookie,'PATCH',pagePath+'/blocks/portable-record-body',{expectedRevisionId:earlierRecord.page.blocks[0].revisionId,
      content:{text:[{text:'Imported record body remains intact after an edit'}]}});
    const earlierSnapshot=await get(source,sourceCookie,'/api/revisions/'+record.pageId+'/'+earlierRecord.revisionId);
    assert.equal(earlierSnapshot.blocks[0].content.text[0].text,'Imported record body remains intact');
    const retainedRecord = await get(source,sourceCookie,recordPath);
    const recordHistory = await get(source,sourceCookie,'/api/revisions/'+record.pageId);
    const recordPlacement=(await get(source,sourceCookie,'/api/pages?containerId=archive-container')).items.find(item=>item.id===record.pageId);
    assert.equal(recordPlacement.parentPageId,database.pageId);
    assert.ok(recordPlacement.treePosition);
    const storedRecord = value => ({page:value.page.page,properties:value.page.properties,blocks:value.page.blocks,values:value.values});
    const switchParity = async (instance,cookie,value) => {
      const current=await get(instance,cookie,'/api/workspace');
      const {name,mark,description,guestAccess,publicLinkAccess,anonymousAccess}=current;
      await mutate(instance,cookie,'PUT','/api/workspace',{expectedRevisionId:current.revisionId,name,mark,description,guestAccess,publicLinkAccess,anonymousAccess,policies:{...current.policies,'record.page-parity.v1':value}});
    };
    await switchParity(source,sourceCookie,'record-is-row');
    assert.deepEqual(storedRecord(await get(source,sourceCookie,recordPath)),storedRecord(retainedRecord));
    const first=path.join(scratch,'source.zip'),second=path.join(scratch,'restored.zip');
    const exportReceipt=await source.cli('export',first,sourceCookie);const before=unpack(await readFile(first));
    assert.equal(exportReceipt.counts.pages,5);assert.equal(before.manifest.tables.containers.length,2);assert.equal(before.manifest.tables.page_revisions.filter(row=>pageIds.includes(row.page_id)).length,6);assert.equal(before.manifest.tables.comments.length,2);assert.equal(before.manifest.tables.files.length,2);assert.equal(before.manifest.tables.groups.length,1);assert.equal(before.manifest.tables.members.length,3);assert.equal(before.manifest.tables.public_exposures.length,1);assert.equal(before.manifest.tables.public_exposures[0].revoked_at,null);
    assert.deepEqual(before.manifest.tables.database_records.map(row=>({pageId:row.page_id,values:JSON.parse(row.field_values_json)})),[{pageId:record.pageId,values:{'portable-quantity':17}}]);
    assert.ok(before.manifest.tables.notification_outbox.length > 0,'Native record mutations produce retained delivery candidates.');
    assert.ok(before.manifest.tables.page_blocks.some(row=>row.page_id===record.pageId&&row.id==='portable-record-body'));
    await source.close();
    target=await runtime(path.join(scratch,'target'));
    assert.notEqual(target.persist,source.persist);
    const [empty]=await target.sql('SELECT (SELECT COUNT(*) FROM workspaces) AS workspaces,(SELECT COUNT(*) FROM members) AS members,(SELECT COUNT(*) FROM containers) AS containers,(SELECT COUNT(*) FROM pages) AS pages,(SELECT COUNT(*) FROM files) AS files');
    assert.deepEqual(empty.results,[{workspaces:0,members:0,containers:0,pages:0,files:0}]);
    await target.start();const bootstrapCookie=await signIn(target);
    // rer dev runs this handler while the newcomer is still on first-run setup.
    await target.scheduled();
    await target.close();
    const [bootstrap]=await target.sql('SELECT (SELECT COUNT(*) FROM workspaces) AS workspaces,(SELECT COUNT(*) FROM members) AS members,(SELECT COUNT(*) FROM containers) AS containers,(SELECT COUNT(*) FROM pages) AS pages,(SELECT COUNT(*) FROM files) AS files,(SELECT COUNT(*) FROM status_entries) AS statuses');
    assert.deepEqual(bootstrap.results,[{workspaces:1,members:1,containers:0,pages:0,files:0,statuses:4}],'Native mailbox bootstrap leaves no product content; only its default vocabulary exists.');
    const [heartbeat]=await target.sql("SELECT COUNT(*) AS count FROM core_job_failures WHERE state='succeeded'");
    assert.equal(heartbeat.results[0].count,1,'Cron recorded its genuine empty-installation heartbeat.');
    await target.sql("INSERT INTO core_job_failures VALUES('keep-failed-job','content',1,'failed','JOB_DISPATCH_FAILED','2026-10-16T00:00:00Z')");
    await target.start();
    await assert.rejects(target.cli('import',first,bootstrapCookie),/RESTORE_NOT_EMPTY/,'Actual job failures are preserved, not discarded with a successful heartbeat.');
    await target.close();
    const [failed]=await target.sql("SELECT COUNT(*) AS count FROM core_job_failures WHERE id='keep-failed-job' AND state='failed'");
    assert.equal(failed.results[0].count,1);
    await target.sql("DELETE FROM core_job_failures WHERE id='keep-failed-job'");
    await target.sql("UPDATE status_entries SET label='Customized target vocabulary' WHERE key='rough-draft'");
    await target.start();
    await assert.rejects(target.cli('import',first,bootstrapCookie),/RESTORE_NOT_EMPTY/,'Custom target vocabulary is product data, never disposable bootstrap.');
    await target.close();await target.sql("UPDATE status_entries SET label='Rough draft' WHERE key='rough-draft'");
    await target.sql("INSERT INTO members(id,workspace_id,email,display_name,initials,role,member_kind,status,created_at,updated_at) SELECT 'extra-target-member',id,'extra-target@example.invalid','Additional member','AM','member','member','active',created_at,updated_at FROM workspaces");
    await target.start();
    await assert.rejects(target.cli('import',first,bootstrapCookie),/RESTORE_NOT_EMPTY/,'An extra target identity is preserved rather than overwritten as bootstrap.');
    await target.close();await target.sql("DELETE FROM members WHERE id='extra-target-member'");
    await target.start();
    const emptySearch=await(await api(target,bootstrapCookie,'/api/search?query=unmatched')).json();
    assert.equal(emptySearch.items.length,0,'A normal search before restore adds no product content.');
    await target.close();await target.start({localOwner:true});
    // The first-run page uses the real gated dev entry, not an emailed proof.
    const localCookie=await signIn(target);
    const form=new FormData();form.set('operationKey',randomUUID());form.set('file',new Blob([await readFile(first)],{type:'application/zip'}),'workspace.zip');
    const staged=await fetch(target.origin+'/api/exports/jobs/restore',{method:'POST',headers:{Cookie:localCookie,Origin:target.origin},body:form});
    const restoreJob=await staged.json();
    assert.equal(staged.status,202,JSON.stringify(restoreJob));
    const imported=await(await api(target,localCookie,`/api/exports/jobs/${restoreJob.id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
    assert.equal(imported.state,'completed');assert.equal(imported.counts.pages,5);assert.equal(imported.counts.files,2);
    assert.equal((await fetch(target.origin+'/api/session',{headers:{Cookie:bootstrapCookie,...devKeyHeaders}})).status,401,'Restore revokes the original target session.');
    await target.close();
    const [index]=await target.sql('SELECT (SELECT COUNT(DISTINCT page_id) FROM search_text WHERE page_id IS NOT NULL) AS indexed,(SELECT COUNT(*) FROM search_dirty) AS pending');
    assert.deepEqual(index.results,[{indexed:5,pending:0}],'Search is already rebuilt before a page or search request can repair it.');
    await target.start();const targetCookie=await signIn(target);
    const outboxBefore=await inbox(target.origin);
    for(const email of ['archive-member@example.invalid','archive-guest@example.invalid']){
      const inactive=await fetch(target.origin+'/api/auth/magic',{method:'POST',headers:{Origin:target.origin,'Content-Type':'application/json'},body:JSON.stringify({email,requestKey:randomUUID()})});
      assert.equal(inactive.status,200);assert.equal((await inactive.json()).accepted,true);
    }
    assert.deepEqual(await inbox(target.origin),outboxBefore,'Imported member and guest cannot obtain fresh sign-in mail before an invitation.');
    for(const pageId of pageIds){const page=await(await api(target,targetCookie,`/api/pages/${pageId}`)).json();assert.equal(page.page.id,pageId);assert.equal(page.workingRevisionId,`${pageId}-current`);assert.equal(page.blocks[0].id,`${pageId}-block`);assert.deepEqual(page.properties.labels,['portable','research']);}
    for(const original of originals){const restored=await api(target,targetCookie,`/api/media/${original.id}`);assert.deepEqual(Buffer.from(await restored.arrayBuffer()),original.bytes);}
    // Use the source publication Host: a different target Host alone cannot prove unpublication.
    const {requestWithHost}=await import('../e2e/runtime-harness.mjs');
    assert.equal((await requestWithHost(target.origin,'/p/research/portable',new URL(source.origin).host)).status,404);
    const restoredRecord = await get(target,targetCookie,recordPath);
    assert.equal(restoredRecord.parity,'record-is-row');
    assert.equal(restoredRecord.page.page.id,record.pageId);
    assert.deepEqual(storedRecord(restoredRecord),storedRecord(retainedRecord));
    assert.deepEqual(await get(target,targetCookie,'/api/revisions/'+record.pageId),recordHistory);
    assert.deepEqual(await get(target,targetCookie,'/api/revisions/'+record.pageId+'/'+earlierRecord.revisionId),earlierSnapshot);
    const reexport=await target.cli('export',second,targetCookie);const after=unpack(await readFile(second));
    await target.close();
    const [bootstrapAudit]=await target.sql(`SELECT a.* FROM activity_entries a WHERE ${bootstrapAuditPredicate};
      CREATE TABLE portability_unregistered_record(id TEXT PRIMARY KEY,body TEXT);
      INSERT INTO portability_unregistered_record VALUES ('unregistered','must not silently disappear')`);
    t.diagnostic(JSON.stringify(equivalent(before,after,ownerEmail,reexport.id,bootstrapAudit.results,imported.completedAt)));
    await target.start();
    for(const parity of ['record-is-row','record-is-page','record-is-row','record-is-page']){
      await switchParity(target,targetCookie,parity);
      const restored=await get(target,targetCookie,recordPath);
      assert.equal(restored.parity,parity);
      assert.equal(restored.page.page.id,record.pageId);
      assert.deepEqual(storedRecord(restored),storedRecord(retainedRecord));
      assert.deepEqual(await get(target,targetCookie,'/api/revisions/'+record.pageId),recordHistory);
      assert.deepEqual(await get(target,targetCookie,'/api/revisions/'+record.pageId+'/'+earlierRecord.revisionId),earlierSnapshot);
      const pages=(await get(target,targetCookie,'/api/pages?containerId=archive-container')).items.filter(item=>item.id===record.pageId);
      const search=await get(target,targetCookie,'/api/search?kind=page&query='+encodeURIComponent('Portable populated record'));
      assert.equal(pages.length,parity==='record-is-page'?1:0);
      assert.deepEqual(search.items.map(item=>item.id),parity==='record-is-page'?[record.pageId]:[]);
      if(pages.length){assert.equal(pages[0].parentPageId,database.pageId);assert.equal(pages[0].treePosition,recordPlacement.treePosition);assert.equal(pages[0].icon,'📚');}
    }
    t.diagnostic('PROBE DB-010 4 imported-body: actual row-policy ZIP restored into separate empty deployment; record and page IDs, body block, icon, numeric field, revisions and tree placement survive both policy switches; exact page search follows parity.');
    const refused=await fetch(target.origin+'/api/exports/workspace',{method:'POST',headers:{Cookie:targetCookie,Origin:target.origin,'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID()})});
    assert.equal(refused.status,409);assert.equal((await refused.json()).code,'UNREGISTERED_PORTABLE_TABLE','Populated unknown tables still fail closed.');
  }finally{
    const cleanup=await Promise.allSettled([source?.close(),target?.close()]);
    await rm(scratch,{recursive:true,force:true});
    const failures=cleanup.filter(result=>result.status==='rejected');
    if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Portability Worker cleanup failed.');
  }
});
