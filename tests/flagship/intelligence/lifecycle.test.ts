import {nativeProposalCase} from './native-proposal.case';
import {attentionJourney} from './attention-journey';
import {claimsCase} from './claims.case';
import {reservationPrerequisitesCase} from './reservation-prerequisites.case';
import {runFoldCases} from '../fold-cases';
import {resetDeployment as resetFoldDeployment} from '../../e2e/setup/reset-deployment';
import {env} from 'cloudflare:test';
import {test,expect,vi,afterEach} from 'vitest';
import {fixture} from './measured-fixture';
import {runFlowCase,sessionDoor,type RunFlow} from './run-flow';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {controlRun} from '../../../src/core/features/runs/service';
import {consumeIntelligenceJob,scheduleIntelligence} from '../../../src/core/features/runs/worker';
import {requireRun} from '../../../src/core/features/runs/repository';
import type {AppBindings} from '../../../src/core/app/types';
import {issueAgentCredential,authenticateExternalAgent} from '../../../src/core/features/external-agent/credentials';
import {invokeAgentTool} from '../../../src/core/features/external-agent/tools';
afterEach(()=>vi.unstubAllGlobals());
const response=(answer:unknown)=>Response.json({id:'provider-fixture-receipt',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(answer)}]}],usage:{input_tokens:100,output_tokens:30,total_tokens:130}});
const answer={statements:[{text:'The handoff is open.',evidenceIds:['E1'],kind:'observation',limitations:[]}],unresolved:['Handoff'],proposedChanges:[],researchPlan:null,hypothesisAssessment:null};
test("run lifecycle, source claims, native proposals, external-agent reads and reservations preserve current authority", async () => {
  await runFoldCases([
{name:"Signed-in run lifecycle exposes failure, pause, resume and terminal outcomes through the run API",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {

  const cases:RunFlow[]=[
    {title:'AI-009 semantic failure has one attempt, visible failure and no partial proposal',execute:async(f,door)=>{
      const run=await door.start(f.ask);
      let calls=0;
      vi.stubGlobal('fetch',async()=>{calls++;return response({...answer,statements:[{...answer.statements[0],evidenceIds:['E999']}]});});
      await consumeIntelligenceJob({...env,AI_API_KEY:'test-only'} as AppBindings,{kind:'intelligence.run',runId:run.value.id,workspaceId:f.workspaceId});
      const stored=await requireRun(f.context(),run.value.id);
      expect(stored.status).toBe('failed');
      expect(stored.failure_reason).toBe('INVALID_MODEL_EVIDENCE');
      expect(stored.output_json).toBeNull();
      expect(calls).toBe(1);
      await consumeIntelligenceJob({...env,AI_API_KEY:'test-only'} as AppBindings,{kind:'intelligence.run',runId:run.value.id,workspaceId:f.workspaceId});
      const inbox=await door.request('GET','/api/notifications');expect(inbox.status).toBe(200);
      expect((await inbox.json<any>()).items.filter((item:any)=>item.detail?.runId===run.value.id)).toMatchObject([{event:'run-failed'}]);
      return {id:run.value.id,status:'failed',pendingReason:'INVALID_MODEL_EVIDENCE',output:null};
    }},
    {title:'AI-009 transport retries stop at three and retain conservative unknown spend',execute:async(f,door)=>{
      const run=await door.start(f.ask);
      let calls=0;
      vi.stubGlobal('fetch',async()=>{calls++;return new Response('temporary outage',{status:503});});
      for(let i=0;i<3;i++){await env.DB.prepare('UPDATE intelligence_runs SET next_at=NULL WHERE id=?').bind(run.value.id).run();await consumeIntelligenceJob({...env,AI_API_KEY:'test-only'} as AppBindings,{kind:'intelligence.run',runId:run.value.id,workspaceId:f.workspaceId});}
      const stored=await requireRun(f.context(),run.value.id);
      expect(calls).toBe(3);
      expect(stored.status).toBe('failed');
      expect(stored.attempts).toBe(3);
      expect(stored.cost_micros).toBe(0);
      expect(stored.uncertain_cost_micros).toBeGreaterThan(0);
      return {id:run.value.id,status:'failed',cost:0,uncertainCostLiability:stored.uncertain_cost_micros};
    }},
    {title:'Pause releases reservation and concurrent resume has one fresh reservation',execute:async(f,door)=>{
      const run=await door.start(f.ask);
      const paused=await door.control({id:run.value.id,operationKey:'pause-budget-001',expectedRevisionId:run.value.revisionId,action:'pause'});
      expect((await env.DB.prepare('SELECT count(*) n FROM intelligence_budgets WHERE run_id=? AND released_at IS NULL').bind(run.value.id).first<{n:number}>())!.n).toBe(0);
      const input={id:run.value.id,operationKey:'resume-budget-001',expectedRevisionId:paused.value.revisionId,action:'resume' as const};
      const outcomes=await Promise.allSettled([door.control(input),door.control({...input,operationKey:'resume-budget-002'})]);
      expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
      expect((await env.DB.prepare('SELECT count(*) n FROM intelligence_budgets WHERE run_id=? AND released_at IS NULL').bind(run.value.id).first<{n:number}>())!.n).toBe(1);
      return {id:run.value.id,status:'queued',availableActions:['pause','cancel']};
    }},
    {title:'Resume cannot recapture funds spent by another run while paused',execute:async(f,door)=>{
      const first=await door.start(f.ask);
      const paused=await door.control({id:first.value.id,operationKey:'pause-release-001',expectedRevisionId:first.value.revisionId,action:'pause'});
      await env.DB.prepare('UPDATE workspaces SET ai_monthly_budget_micros=110000 WHERE id=?').bind(f.workspaceId).run();
      await door.start({...f.ask,operationKey:'second-spend-001',question:'Which security review remains incomplete?'});
      await expect(controlRun(f.context(),{id:first.value.id,operationKey:'resume-no-budget',expectedRevisionId:paused.value.revisionId,action:'resume'})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
      expect((await requireRun(f.context(),first.value.id)).status).toBe('paused');
      await expect(door.control({id:first.value.id,operationKey:'resume-no-budget',expectedRevisionId:paused.value.revisionId,action:'resume'})).rejects.toMatchObject({status:409,code:'REVISION_CONFLICT'});
      return {id:first.value.id,status:'paused',availableActions:['resume','cancel']};
    }},
    {title:'Ten-minute expiry is terminal and crash-after-dispatch remains uncertain',execute:async(f,door)=>{
      const run=await door.start(f.ask);
      await env.DB.prepare("UPDATE intelligence_runs SET status='running',deadline_at='2000-01-01T00:00:00.000Z',lease_id='crashed' WHERE id=?").bind(run.value.id).run();
      await scheduleIntelligence(env as AppBindings);
      expect((await requireRun(f.context(),run.value.id)).status).toBe('failed');
      await expect(door.control({id:run.value.id,operationKey:'resume-expired-001',expectedRevisionId:run.value.revisionId,action:'resume'})).rejects.toMatchObject({status:409,code:'TERMINAL_RUN'});
      return {id:run.value.id,status:'failed',availableActions:['successor']};
    }},
    {title:'Read-only grounded answer completes without a human review and releases unused budget',execute:async(f,door)=>{
      const run=await door.start(f.ask);
      vi.stubGlobal('fetch',async()=>response(answer));
      await consumeIntelligenceJob({...env,AI_API_KEY:'test-only'} as AppBindings,{kind:'intelligence.run',runId:run.value.id,workspaceId:f.workspaceId});
      const stored=await requireRun(f.context(),run.value.id);
      expect(stored.status).toBe('completed');
      expect(stored.cost_micros).toBe(130);
      expect((await env.DB.prepare('SELECT count(*) n FROM intelligence_budgets WHERE run_id=? AND released_at IS NULL').bind(run.value.id).first<{n:number}>())!.n).toBe(0);
      expect((await env.DB.prepare("SELECT count(*) n FROM notification_outbox WHERE json_extract(detail_json,'$.runId')=? AND event='run-review'").bind(run.value.id).first<{n:number}>())!.n).toBe(0);
      const inbox=await door.request('GET','/api/notifications');expect(inbox.status).toBe(200);
      expect((await inbox.json<any>()).items.filter((item:any)=>item.detail?.runId===run.value.id)).toEqual([]);
      return {id:run.value.id,status:'completed',cost:130,output:{answer},availableActions:['successor']};
    }},
  ];
  for(const entry of cases)await runFlowCase(entry.title,entry.execute);
  await resetFoldDeployment();
  await attentionJourney();

} finally {{await (vi.unstubAllGlobals());}}
}},
{name:"External-agent same semantic read has exact source scope and revocation",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {

  await resetDeployment();
  const f=await fixture();
  const issued=await issueAgentCredential(f.context(),{operationKey:'agent-issue-test',subjectId:f.reader,expiresAt:'2099-01-01T00:00:00.000Z',scope:{tools:['read_evidence'],sourceIds:[f.page.pageId],audience:[f.reader],grantIds:[]}});
  const headers=new Headers({authorization:`Bearer ${issued.token}`});
  const request=await sessionDoor(f.reader);
  const read=await request('POST','/api/agent/tools/read_evidence',{refs:f.refs,audience:[f.reader]},headers);
  expect(read.status).toBe(200);
  expect(await read.json()).toHaveLength(1);
  const denied=await request('POST','/api/agent/tools/ask',{...f.ask,audience:[f.reader]},headers);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({code:'AGENT_SCOPE'});
  expect((await authenticateExternalAgent(env.DB,headers))?.id).toBe(f.reader);
  expect(await invokeAgentTool(f.context(f.reader),headers,'read_evidence',{refs:f.refs,audience:[f.reader]},{})).toHaveLength(1);
  await expect(invokeAgentTool(f.context(f.reader),headers,'ask',{...f.ask,audience:[f.reader]},{})).rejects.toMatchObject({code:'AGENT_SCOPE'});
  await env.DB.prepare('UPDATE intelligence_agent_credentials SET revoked_at=? WHERE id=?').bind(new Date().toISOString(),issued.value.id).run();
  expect(await authenticateExternalAgent(env.DB,headers)).toBeNull();
  await expect(invokeAgentTool(f.context(f.reader),headers,'read_evidence',{refs:f.refs,audience:[f.reader]},{})).rejects.toMatchObject({code:'CREDENTIAL_REVOKED'});
  const revoked=await request('POST','/api/agent/tools/read_evidence',{refs:f.refs,audience:[f.reader]},headers);
  expect(revoked.status).toBe(401);
  expect(await revoked.json()).toMatchObject({code:'CREDENTIAL_REVOKED'});

} finally {{await (vi.unstubAllGlobals());}}
}}
  ,
{name:"INQ-005 identical concurrent authorized intents retain one run and one reservation",before:async()=>{await resetFoldDeployment();},run:reservationPrerequisitesCase}
,
{name:"Scoped claims preserve exact passages and unknown scope; only an exact accepted decision supplies a named approver",before:async()=>{await resetFoldDeployment();},run:claimsCase}
,
{name:"Exact native review derives source boundaries, refuses stale approval and content expansion, and revokes unsent work",before:async()=>{await resetFoldDeployment();},run:nativeProposalCase}
]);
});
