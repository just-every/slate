import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

export function unpack(bytes){const entries=unzipSync(bytes);return {manifest:JSON.parse(new TextDecoder().decode(entries['manifest.json'])),entries};}
const stable=row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));

/** Every table and retained field is compared; recovery changes are checked explicitly. */
export function equivalent(before,after,ownerEmail,newExportId,bootstrapAuditRows){
  assert.equal(bootstrapAuditRows.length,1,'Fresh owner sign-in adds exactly one bootstrap audit row.');
  const a=before.manifest,b=after.manifest;
  assert.equal(a.version,1);assert.equal(b.version,a.version);
  assert.match(a.createdAt,/^\d{4}-\d{2}-\d{2}T/);assert.match(b.createdAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(b.columns,a.columns);assert.deepEqual(b.reconnect,a.reconnect);
  assert.deepEqual(Object.keys(b.tables).sort(),Object.keys(a.tables).sort());
  const blobKeys=new Map();
  const owner=a.tables.members.find(member=>member.email===ownerEmail);
  assert.ok(owner);
  for(const file of a.tables.files){
    const restored=b.tables.files.find(row=>row.id===file.id);assert.ok(restored,`File identity ${file.id} retained.`);
    blobKeys.set(file.storage_key,restored.storage_key);
    const originalBlob=a.blobs.find(blob=>blob.key===file.storage_key),restoredBlob=b.blobs.find(blob=>blob.key===restored.storage_key);
    assert.ok(originalBlob);assert.ok(restoredBlob);
    assert.equal(restoredBlob.hash,originalBlob.hash);assert.equal(restoredBlob.size,originalBlob.size);
    assert.deepEqual(after.entries[restoredBlob.entry],before.entries[originalBlob.entry],`Exact original bytes ${file.original_name}.`);
    assert.equal(createHash('sha256').update(after.entries[restoredBlob.entry]).digest('hex'),originalBlob.hash);
  }
  assert.equal(b.blobs.length,a.blobs.length,'No originals omitted or added.');
  let compared=0;
  for(const [table,rows]of Object.entries(a.tables)){
    const actual=[...b.tables[table]];
    for(const original of rows){
      const expected={...original};
      if(table==='members'){
        const owner=String(expected.email).toLowerCase()===ownerEmail;
        expected.status=owner?'active':'historical';expected.is_setup_owner=owner?1:0;if(owner)expected.role='owner';
      }
      if(table==='files')expected.storage_key=blobKeys.get(expected.storage_key);
      if(table==='automation_rules'){
        const restored=actual.find(row=>row.id===expected.id);assert.ok(restored);
        assert.match(restored.disabled_at,/^\d{4}-\d{2}-\d{2}T/,'Restored rules retain no active execution authority.');
        assert.equal(restored.disabled_reason,'Restored: owner must re-enable authority.');
        expected.disabled_at=restored.disabled_at;expected.disabled_reason=restored.disabled_reason;
      }
      if(table==='automation_jobs')expected.state='failed';
      if(table==='public_exposures'){
        const restored=actual.find(row=>row.id===expected.id);assert.ok(restored);
        assert.match(restored.revoked_at,/^\d{4}-\d{2}-\d{2}T/,'Restored public link is explicitly revoked.');
        expected.revoked_at=original.revoked_at??restored.revoked_at;
      }
      if(table==='federation_exports'){
        expected.archive_key=null;if(['queued','running'].includes(expected.state))expected.state='failed';
        expected.report_json=JSON.stringify({...JSON.parse(expected.report_json),recovery:{archiveOmitted:true,note:'Prior derived export archive omitted; create a new export from restored records.'}});
      }
      const index=actual.findIndex(row=>stable(row)===stable(expected));assert.notEqual(index,-1,`Every retained field survives ${table}/${original.id??stable(original)}.`);
      actual.splice(index,1);compared++;
    }
    if(table==='activity_entries'){
      // The restored owner must sign in again; match the exact live-session
      // bootstrap row selected by the same predicate as restore admission.
      for(const bootstrap of bootstrapAuditRows){
        const index=actual.findIndex(row=>stable(row)===stable(bootstrap));
        assert.notEqual(index,-1,'Fresh owner sign-in audit survives unchanged.');
        actual.splice(index,1);
      }
    }
    if(['federation_exports','activity_entries','core_entity_revisions'].includes(table)){
      assert.equal(actual.length,1,`Only this command's new export adds one ${table} row.`);
      const added=actual[0];
      assert.equal(added.workspace_id,owner.workspace_id);
      // The archive snapshots this command after its lease starts, before completion.
      if(table==='federation_exports'){assert.equal(added.id,newExportId);assert.equal(added.actor_id,owner.id);assert.equal(added.state,'running');assert.equal(added.archive_key,null);assert.deepEqual(JSON.parse(added.counts_json),{});assert.deepEqual(JSON.parse(added.report_json),{});assert.match(added.created_at,/^\d{4}-\d{2}-\d{2}T/);assert.ok(added.updated_at>=added.created_at);}
      if(table==='activity_entries'){assert.equal(added.actor_member_id,owner.id);assert.equal(added.target_id,newExportId);assert.equal(added.target_kind,'export');assert.equal(added.action,'exports.workspace');assert.equal(added.feature,'exports');assert.deepEqual(JSON.parse(added.detail_json),{});assert.ok(added.operation_key);}
      if(table==='core_entity_revisions'){assert.equal(added.author_member_id,owner.id);assert.equal(added.entity_id,newExportId);assert.equal(added.entity_kind,'export');assert.deepEqual(JSON.parse(added.content_json),{state:'queued'});assert.equal(added.id,b.tables.federation_exports.find(row=>row.id===newExportId).revision_id);}
    }else assert.equal(actual.length,0,`No unaccounted-for changes in ${table}.`);
  }
  for(const forbidden of ['sessions','magic_links','invitations','operation_receipts','rer_mail_development_outbox'])assert.equal(b.tables[forbidden],undefined,`${forbidden} never enters portable data.`);
  return {tables:Object.keys(a.tables).length,records:compared,attachments:b.blobs.length};
}
