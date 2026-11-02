import {runFoldCases} from '../fold-cases';
import { automationHttpAuthority } from './automation-http';
import {resetDeployment as resetFoldDeployment} from '../../e2e/setup/reset-deployment';
import { resetDeployment } from "../../e2e/setup/reset-deployment";
import { env } from "cloudflare:test";
import { test,expect } from "vitest";
import { setup,databaseWith,field } from "./repair-fixture";
import { seedContainer,seedContainerGrant,seedMember } from "../../e2e/setup/fixtures";
import { saveRule,listRules } from "../../../src/core/features/automation/service";
import { enqueueAutomationEvent,processAutomationJob,runAutomationSchedule } from "../../../src/core/features/automation/jobs";
import { createRecord } from "../../../src/core/features/databases/service";
import { readPage } from "../../../src/core/features/pages/service";
import { archivePage } from "../../../src/core/features/archive/service";
import { registerAutomationActivity } from "../../../src/core/features/automation/activity";
import { activity } from "../../../src/core/features/activity/service";
import type { AutomationAdapters } from "../../../src/core/features/automation/actions";
const adapters:AutomationAdapters={archive:(ctx,id,input)=>archivePage(ctx,id,{...input,action:"archive"}),notify:async()=>{throw Error("Unused notification adapter");}};
test("automation admission, resumed effects and schedules preserve current scope and exactly-once recovery", async () => {
  await resetDeployment();
  await automationHttpAuthority();
  await resetDeployment();
  await runFoldCases([
{name:"AUTO-002 admission, movement, branch and resumed actions enforce current container scope and private definitions",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {

  // Original variant: AUTO-002 source/container admission rejects out-of-scope destinations; site definitions and activity are private
  await (async () => {
 const {ctx,reader,containerId}=await setup();const a=await databaseWith(ctx,containerId,"scope-a",[]);
 const {containerId:other}=await seedContainer(ctx.actor.workspaceId,{ownerMemberId:ctx.actor.id,visibility:"default"});
 await seedContainerGrant(other,{principalKind:"member",principalId:ctx.actor.id,level:"full"});
 const b=await databaseWith(ctx,other,"scope-b",[]);
 const action={type:"create-record" as const,databaseId:b.id,title:"Confidential future title",values:{}};
 for(const scope of ["source","container"] as const)await expect(saveRule(ctx,{operationKey:`scope-rule-${scope}`,name:scope,scope,sourceDatabaseId:a.id,containerId,trigger:{event:"record-created"},conditions:[],actions:[action]})).rejects.toMatchObject({code:"AUTOMATION_SCOPE"});
 const site=await saveRule(ctx,{operationKey:"scope-rule-site",name:"Private",scope:"site",trigger:{event:"record-created"},conditions:[],actions:[action]});
 expect((await listRules(reader)).items).toEqual([]);
 const guest=await seedMember(ctx.actor.workspaceId,{role:"member",isGuest:true,email:`${ctx.actor.workspaceId}@guest.invalid`,displayName:"Guest"});
 expect((await listRules({...reader,actor:{...reader.actor,id:guest.memberId}})).items).toEqual([]);
 const trigger=await createRecord(ctx,a.id,{operationKey:"site-scope-trigger",title:"Trigger",values:{}});
 const jobs=await enqueueAutomationEvent(ctx,{key:"site-scope-event",event:"record-created",databaseId:a.id,containerId,pageId:trigger.value.pageId});
 await processAutomationJob(ctx,jobs.jobIds[0],adapters);
 expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM database_records WHERE database_id=?").bind(b.id).first<{n:number}>())?.n).toBe(1);
 expect((await listRules(ctx)).items.map(r=>r.id)).toContain(site.value.id);
 registerAutomationActivity();
 expect((await activity(ctx,{kind:"automation-rule"})).items.map(i=>i.target.id)).toContain(site.value.id);
 expect((await activity(reader,{kind:"automation-rule"})).items).toEqual([]);
 expect((await activity(ctx,{kind:"automation-run"})).items.length).toBeGreaterThan(0);
 expect((await activity(reader,{kind:"automation-run"})).items).toEqual([]);
 await env.DB.prepare("DELETE FROM container_grants WHERE container_id=?").bind(other).run();
 await env.DB.prepare("DELETE FROM container_owners WHERE container_id=?").bind(other).run();
 expect((await listRules(ctx)).items.map(r=>r.id)).not.toContain(site.value.id);

  })();
  await resetDeployment();
  // Original variant: AUTO-002 current container movement blocks an admitted action
  await (async () => {
 const {ctx,containerId}=await setup();const db=await databaseWith(ctx,containerId,"moved",[]);
 const record=await createRecord(ctx,db.id,{operationKey:"moved-create-record",title:"Unchanged",values:{}});
 await saveRule(ctx,{operationKey:"moved-save-rule",name:"Scoped",scope:"container",containerId,trigger:{event:"record-created"},conditions:[],actions:[{type:"comment",body:"Should not appear"}]});
 const queued=await enqueueAutomationEvent(ctx,{key:"moved-event",event:"record-created",pageId:record.value.pageId,databaseId:db.id,containerId});
 const {containerId:other}=await seedContainer(ctx.actor.workspaceId,{ownerMemberId:ctx.actor.id,visibility:"default"});
 await env.DB.prepare("UPDATE pages SET container_id=?,parent_page_id=NULL WHERE id=?").bind(other,record.value.pageId).run();
 await processAutomationJob(ctx,queued.jobIds[0],adapters);
 const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM comments c JOIN comment_threads t ON t.id=c.thread_id WHERE t.page_id=?").bind(record.value.pageId).first<{n:number}>();expect(count?.n).toBe(0);

  })();
  await resetDeployment();
  // Original variant: AUTO-002 branch targets and prepared resumed actions recheck current container scope
  await (async () => {
 const {ctx,containerId}=await setup();const db=await databaseWith(ctx,containerId,"branch",[]);
 const {containerId:other}=await seedContainer(ctx.actor.workspaceId,{ownerMemberId:ctx.actor.id,visibility:"default"});
 await seedContainerGrant(other,{principalKind:"member",principalId:ctx.actor.id,level:"full"});
 const foreign=await databaseWith(ctx,other,"branch-foreign",[]);
 const {saveField}=await import("../../../src/core/features/databases/service");
 await saveField(ctx,db.id,{operationKey:"branch-rel-field",expectedRevisionId:db.revisionId,field:field("branch-rel","relation",{databaseId:foreign.id})});
 const target=await createRecord(ctx,foreign.id,{operationKey:"branch-target",title:"Outside",values:{}});
 const source=await createRecord(ctx,db.id,{operationKey:"branch-source",title:"Inside",values:{"branch-rel":[target.value.pageId]}});
 await expect(saveRule(ctx,{operationKey:"branch-source-rule",name:"Source",scope:"source",sourceDatabaseId:db.id,trigger:{event:"record-created"},conditions:[],branch:{relationField:"branch-rel"},actions:[{type:"comment",body:"Forbidden"}]})).rejects.toMatchObject({code:"AUTOMATION_SCOPE"});
 const rule=await saveRule(ctx,{operationKey:"branch-container-rule",name:"Container",scope:"container",containerId,trigger:{event:"record-created"},conditions:[],branch:{relationField:"branch-rel"},actions:[{type:"comment",body:"Forbidden"}]});
 const queued=await enqueueAutomationEvent(ctx,{key:"branch-event",event:"record-created",pageId:source.value.pageId,databaseId:db.id,containerId});
 await processAutomationJob(ctx,queued.jobIds[0],adapters);
 const skipped=await env.DB.prepare("SELECT state FROM automation_action_receipts WHERE target_id=?").bind(target.value.pageId).first<{state:string}>();expect(skipped?.state).toBe("skipped");
 const {prepareAction}=await import("../../../src/core/features/automation/actions");
 const admitted=await enqueueAutomationEvent(ctx,{key:"branch-resume",event:"record-created",pageId:source.value.pageId,databaseId:db.id,containerId});
 const job=await env.DB.prepare("SELECT run_id,payload_json FROM automation_jobs WHERE id=?").bind(admitted.jobIds[0]).first<{run_id:string;payload_json:string}>();
 const prepared=await prepareAction(ctx,{type:"comment",body:"Prepared forbidden"},target.value.pageId,`auto:${job!.run_id}:0:${target.value.pageId}`);
 await env.DB.prepare("INSERT INTO automation_action_receipts VALUES (?,?,?,'prepared',?,?)").bind(job!.run_id,0,target.value.pageId,JSON.stringify(prepared),ctx.now).run();
 await env.DB.prepare("UPDATE automation_jobs SET payload_json=? WHERE id=?").bind(JSON.stringify({...JSON.parse(job!.payload_json),targets:[target.value.pageId]}),admitted.jobIds[0]).run();
 await processAutomationJob(ctx,admitted.jobIds[0],adapters);
 expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM comment_threads WHERE page_id=?").bind(target.value.pageId).first<{n:number}>())?.n).toBe(0);
 expect(rule.value.id).toBeTruthy();

  })();

} finally {}
}},
{name:"AUTO-003 durable recovery before and after commit retains admitted conditions and completes ordered effects exactly once",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {

  // Original variant: AUTO-003 durable recovery reconciles commit-before-confirm and completes ordered actions exactly once
  await (async () => {
 const {ctx,containerId}=await setup();const db=await databaseWith(ctx,containerId,"retry",[]);
 await saveRule(ctx,{operationKey:"retry-rule-save",name:"Retry",scope:"source",sourceDatabaseId:db.id,trigger:{event:"schedule",startsAt:ctx.now,intervalMinutes:60},conditions:[],actions:[{type:"create-record",databaseId:db.id,title:"One",values:{}},{type:"create-record",databaseId:db.id,title:"Two",values:{}}]});
 const fault={...ctx,db:confirmationFailure(ctx.db)};await runAutomationSchedule(fault,adapters);
 let records=await env.DB.prepare("SELECT page_id FROM database_records WHERE database_id=?").bind(db.id).all();expect(records.results).toHaveLength(1);
 await runAutomationSchedule({...ctx,now:new Date(Date.parse(ctx.now)+120000).toISOString()},adapters);
 records=await env.DB.prepare("SELECT page_id FROM database_records WHERE database_id=?").bind(db.id).all();expect(records.results).toHaveLength(2);
 const job=await env.DB.prepare("SELECT state,cursor FROM automation_jobs WHERE rule_id IN (SELECT id FROM automation_rules WHERE workspace_id=?)").bind(ctx.actor.workspaceId).first<{state:string;cursor:number}>();expect(job).toMatchObject({state:"success",cursor:2});
 const receipts=await env.DB.prepare("SELECT state FROM automation_action_receipts WHERE run_id IN (SELECT id FROM automation_runs WHERE workspace_id=?)").bind(ctx.actor.workspaceId).all();expect(receipts.results).toEqual([{state:"confirmed"},{state:"confirmed"}]);

  })();
  await resetDeployment();
  // Original variant: AUTO-003 transient failure before commit resumes admitted conditions after an earlier field edit
  await (async () => {
 const {ctx,containerId}=await setup();const db=await databaseWith(ctx,containerId,"precommit",[field("pre-n","number")]);
 const record=await createRecord(ctx,db.id,{operationKey:"precommit-record",title:"Retry target",values:{"pre-n":1}});
 await saveRule(ctx,{operationKey:"precommit-rule",name:"Retry",scope:"source",sourceDatabaseId:db.id,trigger:{event:"schedule",startsAt:ctx.now,intervalMinutes:60},conditions:[{field:"pre-n",op:"eq",value:1}],actions:[{type:"edit-fields",values:{"pre-n":2}},{type:"archive"}]});
 let failures=0;
 await runAutomationSchedule(ctx,{...adapters,archive:async(...args)=>{if(failures++===0)throw Error("Injected transient before archive commit");return adapters.archive(...args);}});
 expect((await readPage(ctx,record.value.pageId)).page.lifecycle).toBe("live");
 await runAutomationSchedule({...ctx,now:new Date(Date.parse(ctx.now)+120000).toISOString()},adapters);
 expect((await readPage(ctx,record.value.pageId)).page.lifecycle).toBe("archived");
 // The semantic activity rows are the actual committed-effect count.
 const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM activity_entries WHERE target_id=? AND action='databases.record.update'").bind(record.value.pageId).first<{n:number}>();expect(count?.n).toBe(1);

  })();

} finally {}
}},
{name:"AUTO-001 source schedules target current records for edit, comment and archive with typed date conditions",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {

 const {ctx,containerId}=await setup();const db=await databaseWith(ctx,containerId,"schedule-target",[field("n","number"),field("date","date")]);
 const record=await createRecord(ctx,db.id,{operationKey:"schedule-target-record",title:"Target",values:{n:1,date:"2026-09-27T00:30:00+10:00"}});
 await saveRule(ctx,{operationKey:"schedule-target-rule",name:"Daily",scope:"source",sourceDatabaseId:db.id,trigger:{event:"schedule",startsAt:ctx.now,intervalMinutes:60},conditions:[{field:"date",op:"lt",value:"2026-09-26T15:00:00Z"}],actions:[{type:"edit-fields",values:{n:2}},{type:"comment",body:"Scheduled comment"},{type:"archive"}]});
 await runAutomationSchedule(ctx,adapters);
 const page=await readPage(ctx,record.value.pageId);expect(page.page.lifecycle).toBe("archived");
 const row=await env.DB.prepare("SELECT field_values_json FROM database_records WHERE page_id=?").bind(record.value.pageId).first<{field_values_json:string}>();expect(JSON.parse(row!.field_values_json).n).toBe(2);
 const comments=await env.DB.prepare("SELECT COUNT(*) AS n FROM comments c JOIN comment_threads t ON t.id=c.thread_id WHERE t.page_id=?").bind(record.value.pageId).first<{n:number}>();expect(comments?.n).toBe(1);

} finally {}
}}
  ]);
});

function confirmationFailure(db:D1Database) {
 let failed=false;
 function wrap(statement:D1PreparedStatement,sql:string):D1PreparedStatement {
  return new Proxy(statement,{get(target,key){if(key==="bind")return (...args:unknown[])=>wrap(target.bind(...args),sql);if(key==="run")return async()=>{if(!failed&&sql.includes("SET state='confirmed'")){failed=true;throw Error("Injected transient confirmation failure");}return target.run();};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 }
 return new Proxy(db,{get(target,key){if(key==="prepare")return(sql:string)=>wrap(target.prepare(sql),sql);const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
}
