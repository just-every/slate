import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withWorkspace,setupWorkspace} from '../ui-convergence/browser-support.mjs';
import {ok} from '../ui-convergence/two-people-support.mjs';

// Explicit clock and scale journey, outside push Verify. Measure the complete
// HTTP response from Node so Worker clock coarsening cannot hide request work.
const seed=JSON.parse(await readFile('seed.json','utf8'));
const directory=resolve(process.env.QUAL_EVIDENCE??'.artifacts/search-capacity');
await mkdir(directory,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'','Commit the capacity journey before recording proof.');
const limits=seed.limits.capacityEstimate;
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const now='2026-01-15T12:00:00.000Z';
const report={head,runId:'search-capacity-'+head.slice(0,12)+'-'+Date.now(),node:process.version,startedAt:new Date().toISOString(),limits,transport:'Native emitted Worker and D1, loopback HTTP; Node wall time includes response body and JSON decoding.',samples:[],manifest:{},outcome:'pending'};
try {
 await withWorkspace({width:1440,height:1000},'core-wiki',async state=>{
  await setupWorkspace(state);
  const containers=(await state.api('/api/containers')).items;
  const container=containers.find(item=>item.visibility==='default').id;
  await ok(state.context,state.origin,'POST','/api/sharing',{operationKey:crypto.randomUUID(),targetKind:'container',targetId:container,principalKind:'member',principalId:'browser-reader',level:'view'});
  // Canonical fixture writes happen with the Worker stopped. No derived search
  // rows, result caches or application responses are supplied by the fixture.
  const pages=limits.pagesPerWorkspace,records=limits.recordsPerDatabase;
  const sequence=n=>`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<${n})`;
  const common=`'browser-workspace',${q(container)}`;
  await state.atRest(`${sequence(pages)} INSERT INTO pages(id,workspace_id,container_id,title,author_member_id,lifecycle,working_revision_id,published_revision_id,created_at,updated_at,revision_id)
   SELECT printf('capacity-page-%06d',i),${common},printf('Operations handbook %06d',i),'browser-owner','live','r','r',${q(now)},${q(now)},'r' FROM n;
   INSERT INTO page_blocks(id,page_id,block_type,content_json,tree_position,revision_id,created_at,updated_at)
   SELECT id||'-block',id,'paragraph',json_object('text',CASE WHEN CAST(substr(id,-6) AS INTEGER)%1000=0 THEN 'Capacityneedle ' ELSE '' END||'Retained procedure '||id||' explains customer escalation ownership, incident triage, release preparation and the decision record.'),'a','r',${q(now)},${q(now)} FROM pages WHERE id LIKE 'capacity-page-%';
   INSERT INTO databases(id,page_id,workspace_id,created_at,updated_at,revision_id) VALUES('capacity-db',(SELECT id FROM pages WHERE id='capacity-page-000001'),'browser-workspace',${q(now)},${q(now)},'r');
   INSERT INTO database_fields(id,database_id,name,field_type,config_json,position,created_at,updated_at,revision_id) VALUES('capacity-field','capacity-db','Details','text','{}',0,${q(now)},${q(now)},'r');
   ${sequence(records)} INSERT INTO pages(id,workspace_id,container_id,page_kind,title,author_member_id,lifecycle,working_revision_id,published_revision_id,created_at,updated_at,revision_id)
   SELECT printf('capacity-record-%06d',i),${common},'record',printf('Customer record %06d',i),'browser-owner','live','r','r',${q(now)},${q(now)},'r' FROM n;
   INSERT INTO database_records(page_id,database_id,field_values_json,created_at,updated_at,revision_id)
   SELECT id,'capacity-db',json_object('capacity-field',CASE WHEN CAST(substr(id,-6) AS INTEGER)%1000=0 THEN 'Capacityneedle ' ELSE '' END||'Retained customer context '||id),${q(now)},${q(now)},'r' FROM pages WHERE id LIKE 'capacity-record-%';`);
  const extra=limits.containersPerWorkspace-containers.filter(item=>item.visibility!=='personal').length;
  await state.atRest(`${sequence(extra)} INSERT INTO containers(id,workspace_id,name,description,created_at,updated_at,revision_id)
   SELECT printf('capacity-container-%03d',i),'browser-workspace',printf('Team space %03d',i),CASE WHEN i%10=0 THEN 'Capacityneedle retained space purpose' ELSE 'Retained space purpose' END,${q(now)},${q(now)},'r' FROM n;
   INSERT INTO container_grants(id,container_id,principal_kind,principal_id,level,created_at,updated_at)
   SELECT id||'-reader',id,'member','browser-reader','view',${q(now)},${q(now)} FROM containers WHERE id LIKE 'capacity-container-%';
   ${sequence(limits.commentsPerPage)} INSERT INTO comment_threads(id,workspace_id,page_id,kind,created_at,updated_at,revision_id)
   SELECT printf('capacity-thread-%04d',i),'browser-workspace','capacity-page-000001','page',${q(now)},${q(now)},'r' FROM n;
   INSERT INTO comments(id,thread_id,author_member_id,body_json,created_at,updated_at,revision_id)
   SELECT id||'-comment',id,'browser-owner',json_array(json_object('text',CASE WHEN CAST(substr(id,-4) AS INTEGER)%100=0 THEN 'Capacityneedle retained discussion' ELSE 'Retained discussion' END)),${q(now)},${q(now)},'r' FROM comment_threads WHERE id LIKE 'capacity-thread-%';
   ${sequence(100)} INSERT INTO knowledge_templates(id,workspace_id,title,description,category,snapshot_json,created_at,updated_at,revision_id)
   SELECT printf('capacity-template-%03d',i),'browser-workspace',printf('Reusable procedure %03d',i),'Retained template description','General',json_object('blocks',json_array(json_object('content',json_object('text',CASE WHEN i%10=0 THEN 'Capacityneedle retained template content' ELSE 'Retained template content' END)))),${q(now)},${q(now)},'r' FROM n;`);
  const [counts]=await state.atRest("SELECT (SELECT COUNT(*) FROM pages WHERE id LIKE 'capacity-page-%') AS ordinaryPages,(SELECT COUNT(*) FROM database_records WHERE database_id='capacity-db') AS recordPages,(SELECT COUNT(*) FROM containers WHERE visibility!='personal') AS containers,(SELECT COUNT(*) FROM comments WHERE id LIKE 'capacity-thread-%') AS retainedComments,(SELECT COUNT(*) FROM knowledge_templates WHERE id LIKE 'capacity-template-%') AS templates");
  const actualCounts=counts.results[0];
  console.log('Capacity canonical corpus',JSON.stringify(actualCounts));
  assert.deepEqual(actualCounts,{ordinaryPages:pages,recordPages:records,containers:limits.containersPerWorkspace,retainedComments:limits.commentsPerPage,templates:100});
  report.manifest={actualCounts,ordinaryPages:pages,recordPages:records,recordsPerDatabase:records,containers:limits.containersPerWorkspace,retainedComments:limits.commentsPerPage,templates:100,
   expectedMatchingKinds:{page:pages/1000,record:records/1000,container:Math.floor(extra/10),'comment-thread':Math.floor(limits.commentsPerPage/100),template:10},
   corpus:'Deterministic canonical IDs and distinct retained page bodies; scalar record fields; container descriptions; live retained comments; template body snapshots. No derived fixture rows.',
   workload:'Unfiltered mixed-kind first pages with 100 ordinary page hits, 50 record hits and retained metadata hits; independent selective title, body, field, description, comment and template lookups.'};
  const cookies=await state.context.cookies();
  const ownerCookie=cookies.map(c=>c.name+'='+c.value).join('; ');
  const request=async(query,cookie=state.readerCookie,timeout=30000)=>{
   const start=performance.now();
   const response=await fetch(state.origin+'/api/search?'+new URLSearchParams({q:query,limit:'20'}),{headers:{cookie},signal:AbortSignal.timeout(timeout)});
   const data=await response.json();return {status:response.status,data,ms:performance.now()-start};
  };
  // Drain canonical generations once before measuring the indexed-search door.
  // Record that cost separately; it is not silently folded into a warm sample.
  const indexing=await request('Capacityneedle',state.readerCookie,1200000);
  assert.equal(indexing.status,200,JSON.stringify(indexing.data));
  report.indexPreparationMs=indexing.ms;
  console.log('Capacity index preparation milliseconds',indexing.ms);
  const expected=Object.values(report.manifest.expectedMatchingKinds).reduce((a,b)=>a+b,0);
  assert.equal(indexing.data.total,expected);assert.deepEqual(indexing.data.facets.kind,report.manifest.expectedMatchingKinds);
  const workloads=[['Capacityneedle',expected],['"Operations handbook 000002"',1],['"Retained procedure capacity-page-000002"',1],['"Retained customer context capacity-record-000002"',1],['"Capacityneedle retained space purpose"',Math.floor(extra/10)],['"Capacityneedle retained discussion"',Math.floor(limits.commentsPerPage/100)],['"Capacityneedle retained template content"',10]];
  for(let round=0;round<20;round++)for(const [query,total]of workloads){
   const response=await request(query);assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.total,total,query);
   if(query==='Capacityneedle')assert.deepEqual(response.data.facets.kind,report.manifest.expectedMatchingKinds);
   report.samples.push({round,query,total,items:response.data.items.map(item=>item.id),ms:response.ms});
   if(query==='Capacityneedle'&&round%5===0)console.log('Capacity mixed first-page sample',round,response.ms);
  }
  // Cold process and owner context are measured separately and included in p95.
  await state.atRest('SELECT 1');
  for(const cookie of [state.readerCookie,ownerCookie]){
   const response=await request('Capacityneedle',cookie);assert.equal(response.status,200);assert.equal(response.data.total,cookie===ownerCookie?expected-Math.floor(extra/10):expected);
   report.samples.push({round:'restart',query:'Capacityneedle',total:response.data.total,items:response.data.items.map(item=>item.id),ms:response.ms});
  }
  const sorted=report.samples.map(sample=>sample.ms).sort((a,b)=>a-b);
  report.p95Ms=sorted[Math.ceil(sorted.length*.95)-1];report.maxMs=sorted.at(-1);
  const mixed=report.samples.filter(sample=>sample.query==='Capacityneedle').map(sample=>sample.ms).sort((a,b)=>a-b);
  report.mixedFirstPageP95Ms=mixed[Math.ceil(mixed.length*.95)-1];
  assert.ok(report.mixedFirstPageP95Ms<500,`Mixed first-page p95 ${report.mixedFirstPageP95Ms.toFixed(2)}ms must be below 500ms.`);
  report.byQuery=Object.fromEntries(workloads.map(([query])=>{
   const values=report.samples.filter(sample=>sample.query===query).map(sample=>sample.ms).sort((a,b)=>a-b);
   const p95Ms=values[Math.ceil(values.length*.95)-1];
   assert.ok(p95Ms<500,`${query} first-page p95 ${p95Ms.toFixed(2)}ms must be below 500ms.`);
   return [query,{samples:values.length,p95Ms,maxMs:values.at(-1)}];
  }));
  report.outcome='pass';
  assert.ok(report.p95Ms<500,`First-page p95 ${report.p95Ms.toFixed(2)}ms must be below 500ms.`);
 });
} catch(error) {report.outcome='fail';report.error=String(error.stack??error);throw error;}
finally {
 report.finishedAt=new Date().toISOString();
 await writeFile(resolve(directory,'capacity.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({head,outcome:report.outcome,p95Ms:report.p95Ms,samples:report.samples.length,receipt:resolve(directory,'capacity.json')}));
}
