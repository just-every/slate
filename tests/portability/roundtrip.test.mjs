import {devKeyHeaders} from '../e2e/dev-key.mjs';
import {inbox,newOutboxLink,signInWithOutbox} from '../e2e/outbox-auth.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {runtime,signIn,api,ownerEmail,root} from './runtime.mjs';
import {populatedFixture,attachments,pageIds,secretValues,excludedCredentialTables,providerCredentialTables} from './fixture.mjs';
import {equivalent,unpack,excludesCredentials} from './equivalence.mjs';
import {bootstrapAuditPredicate} from '../../src/core/features/portability/bootstrap-audit.ts';

test('BASE-DATA-001 PORT-001 PORT-002 PORT-005 — actual native ZIP round trip preserves populated D1 and original R2 bytes in a separate empty deployment',{timeout:360000},async t=>{
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
    await api(source,sourceCookie,'/api/publishing/archive-root',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID(),expectedRevisionId:'archive-root-current',host:new URL(source.origin).host,slug:['research','portable'].join('/'),theme:'dark',indexable:false,socialPreview:{title:'Portable knowledge',description:'Retain publication settings'}})});
    const published=await fetch(source.origin+'/p/research/portable');assert.equal(published.status,200);assert.match(await published.text(),/Restorable research/);
    const memberEmail='archive-member\x40example.invalid';
    const memberCookie=(await signInWithOutbox(source.origin,memberEmail)).cookie;
    let messages=await inbox(source.origin);
    await api(source,sourceCookie,'/api/auth/magic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:memberEmail,requestKey:randomUUID()})});
    const pendingSignIn=new URL(await newOutboxLink(source.origin,messages));
    const magicPreview=await fetch(pendingSignIn);assert.equal(magicPreview.status,200);
    assert.match(await magicPreview.text(),/Confirm sign-in/,'Source proof is genuinely usable before backup.');
    messages=await inbox(source.origin);
    await api(source,sourceCookie,'/api/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID(),email:'pending-member\x40example.invalid',kind:'member'})});
    const pendingInvitation=new URL(await newOutboxLink(source.origin,messages));
    const invitationPreview=await fetch(pendingInvitation);assert.equal(invitationPreview.status,200);
    assert.match(await invitationPreview.text(),/Accept your invitation/,'Source invitation is pending before backup.');
    await source.close();
    const custodyTables=[...excludedCredentialTables.filter(name=>name!=='rer_mail_development_outbox'),...providerCredentialTables];
    const custody=await source.sql(custodyTables.map(name=>`SELECT * FROM ${name}`).join(';'));
    for(const [i,result]of custody.entries())assert.ok(result.results.length>0,`${custodyTables[i]} is populated before export.`);
    const storedSecrets=custody.flatMap(result=>result.results.flatMap(row=>Object.entries(row).filter(([column,value])=>value&&/^(token_digest|token_hash|hash|credential_ciphertext|response_json)$/.test(column)).map(([,value])=>String(value))));
    await source.start();
    const secrets=[...secretValues,...storedSecrets,...[sourceCookie,memberCookie].map(cookie=>cookie.slice(cookie.indexOf('=')+1)),pendingSignIn.searchParams.get('token'),pendingInvitation.searchParams.get('token')];
    const first=path.join(scratch,'source.zip'),second=path.join(scratch,'restored.zip');
    const exportReceipt=await source.cli('export',first,sourceCookie);const before=unpack(await readFile(first));
    excludesCredentials(before,secrets);
    assert.equal(exportReceipt.counts.pages,3);assert.equal(before.manifest.tables.containers.length,2);assert.equal(before.manifest.tables.page_revisions.length,6);assert.equal(before.manifest.tables.comments.length,2);assert.equal(before.manifest.tables.files.length,2);assert.equal(before.manifest.tables.groups.length,1);assert.equal(before.manifest.tables.members.length,3);assert.equal(before.manifest.tables.public_exposures.length,1);assert.equal(before.manifest.tables.public_exposures[0].revoked_at,null);
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
    await target.sql("INSERT INTO members(id,workspace_id,email,display_name,initials,role,member_kind,status,created_at,updated_at) SELECT 'extra-target-member',id,'extra-target\x40example.invalid','Additional member','AM','member','member','active',created_at,updated_at FROM workspaces");
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
    assert.equal(imported.state,'completed');assert.equal(imported.counts.pages,3);assert.equal(imported.counts.files,2);
    assert.equal((await fetch(target.origin+'/api/session',{headers:{Cookie:bootstrapCookie,...devKeyHeaders}})).status,401,'Restore revokes the original target session.');
    await target.close();
    const [index]=await target.sql('SELECT (SELECT COUNT(DISTINCT page_id) FROM search_text WHERE page_id IS NOT NULL) AS indexed,(SELECT COUNT(*) FROM search_dirty) AS pending');
    assert.deepEqual(index.results,[{indexed:3,pending:0}],'Search is already rebuilt before a page or search request can repair it.');
    await target.start();const targetCookie=await signIn(target);
    const activeMembers=await(await api(target,targetCookie,'/api/members')).json();
    assert.equal(activeMembers.items.length,1);
    assert.equal(activeMembers.items[0].email,ownerEmail);assert.equal(activeMembers.items[0].role,'owner');
    assert.deepEqual((await(await api(target,targetCookie,'/api/guests')).json()).items,[]);
    const snapshotSql='SELECT * FROM members ORDER BY id; SELECT * FROM sessions ORDER BY id; SELECT * FROM public_exposures ORDER BY id';
    await target.close();const authorityBefore=(await target.sql(snapshotSql)).map(result=>result.results);
    assert.deepEqual(authorityBefore[0].filter(member=>member.status==='active').map(member=>({id:member.id,role:member.role,setup:member.is_setup_owner})),[{id:owner.id,role:'owner',setup:1}]);
    assert.ok(authorityBefore[0].filter(member=>member.id!==owner.id).every(member=>member.status==='historical'&&member.is_setup_owner===0));
    await target.start();
    const outboxBefore=await inbox(target.origin);
    for(const email of ['archive-member\x40example.invalid','archive-guest\x40example.invalid']){
      const inactive=await fetch(target.origin+'/api/auth/magic',{method:'POST',headers:{Origin:target.origin,'Content-Type':'application/json'},body:JSON.stringify({email,requestKey:randomUUID()})});
      assert.equal(inactive.status,200);assert.equal((await inactive.json()).accepted,true);
    }
    assert.deepEqual(await inbox(target.origin),outboxBefore,'Imported member and guest cannot obtain fresh sign-in mail before an invitation.');
    for(const cookie of [sourceCookie,memberCookie,bootstrapCookie]){
      const session=await fetch(target.origin+'/api/session',{headers:{Cookie:cookie}});
      assert.equal(session.status,401,'An old session cannot activate a restored identity.');
      const publishing=await fetch(target.origin+'/api/publishing/archive-root',{method:'POST',headers:{Cookie:cookie,Origin:target.origin,'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID(),expectedRevisionId:'archive-root-current',host:new URL(source.origin).host,slug:['research','portable'].join('/'),theme:'dark',indexable:false,socialPreview:{}})});
      assert.equal(publishing.status,401,'Old authority cannot republish restored content.');
    }
    for(const link of [pendingSignIn,pendingInvitation])for(const method of ['GET','POST']){
      const response=await fetch(target.origin+link.pathname+(method==='GET'?link.search:''),{method,redirect:'manual',headers:{Origin:target.origin,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:new URLSearchParams({token:link.searchParams.get('token')})}:{})});
      assert.equal(response.status,400,`Archived ${link.pathname} cannot activate on ${method}.`);
      assert.equal(response.headers.get('set-cookie'),null,'Refusal issues no session.');
      assert.doesNotMatch(await response.text(),/Restorable research|durable body|Keep the exact inline anchor/);
    }
    await target.close();const authorityAfter=(await target.sql(snapshotSql)).map(result=>result.results);
    assert.deepEqual(authorityAfter,authorityBefore,'Unsafe activation and publication attempts change no member, session or exposure.');
    await target.start();
    for(const pageId of pageIds){const page=await(await api(target,targetCookie,`/api/pages/${pageId}`)).json();assert.equal(page.page.id,pageId);assert.equal(page.workingRevisionId,`${pageId}-current`);assert.equal(page.blocks[0].id,`${pageId}-block`);assert.deepEqual(page.properties.labels,['portable','research']);}
    for(const original of originals){const restored=await api(target,targetCookie,`/api/media/${original.id}`);assert.deepEqual(Buffer.from(await restored.arrayBuffer()),original.bytes);}
    // Use the source publication Host: a different target Host alone cannot prove unpublication.
    const {requestWithHost}=await import('../e2e/runtime-harness.mjs');
    const anonymous=await requestWithHost(target.origin,'/p/research/portable',new URL(source.origin).host);
    assert.equal(anonymous.status,404);
    assert.doesNotMatch(anonymous.body,/Restorable research|durable body|Keep the exact inline anchor/,'Anonymous refusal is content-free on the original publication host.');
    t.diagnostic('PROBE PORT-005 1: native restore, member readback and unsafe session, link, invitation and publishing doors -> sole active setup owner; historical actors; unchanged authority; content-free anonymous 404.');
    const reexport=await target.cli('export',second,targetCookie);const after=unpack(await readFile(second));
    excludesCredentials(after,secrets);
    t.diagnostic('PROBE PORT-005 2: native ZIP export and re-export with populated authentication, response and provider custody -> excluded tables absent, provider definitions credential-free, no secret in any decompressed member.');
    await target.close();
    const [bootstrapAudit]=await target.sql(`SELECT a.* FROM activity_entries a WHERE ${bootstrapAuditPredicate};
      CREATE TABLE portability_unregistered_record(id TEXT PRIMARY KEY,body TEXT);
      INSERT INTO portability_unregistered_record VALUES ('unregistered','must not silently disappear')`);
    t.diagnostic(JSON.stringify(equivalent(before,after,ownerEmail,reexport.id,bootstrapAudit.results)));
    await target.start();
    const refused=await fetch(target.origin+'/api/exports/workspace',{method:'POST',headers:{Cookie:targetCookie,Origin:target.origin,'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID()})});
    assert.equal(refused.status,409);assert.equal((await refused.json()).code,'UNREGISTERED_PORTABLE_TABLE','Populated unknown tables still fail closed.');
    // Only a fresh invitation from the restored owner reactivates an actor.
    const messagesBeforeInvitation=await inbox(target.origin);
    await api(target,targetCookie,'/api/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationKey:randomUUID(),email:memberEmail,kind:'member'})});
    const freshInvitation=new URL(await newOutboxLink(target.origin,messagesBeforeInvitation));
    const accepted=await fetch(target.origin+freshInvitation.pathname,{method:'POST',redirect:'manual',headers:{Origin:target.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:freshInvitation.searchParams.get('token')})});
    assert.equal(accepted.status,303);
    const invitedCookie=accepted.headers.get('set-cookie')?.split(';',1)[0];assert.ok(invitedCookie);
    const invited=(await(await api(target,invitedCookie,'/api/session')).json()).member;
    assert.equal(invited.id,'archive-member');assert.equal(invited.role,'member');
    const stillPrivate=await requestWithHost(target.origin,'/p/research/portable',new URL(source.origin).host);
    assert.equal(stillPrivate.status,404,'A fresh member invitation never republishes content.');
  }finally{
    const cleanup=await Promise.allSettled([source?.close(),target?.close()]);
    await rm(scratch,{recursive:true,force:true});
    const failures=cleanup.filter(result=>result.status==='rejected');
    if(failures.length)throw new AggregateError(failures.map(result=>result.reason),'Portability Worker cleanup failed.');
  }
});
