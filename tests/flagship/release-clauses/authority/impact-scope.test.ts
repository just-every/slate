import {runFoldCases} from '../../fold-cases';
import {resetDeployment as resetFoldDeployment} from '../../../e2e/setup/reset-deployment';
import {env} from 'cloudflare:test';
import {test,expect,vi,afterEach} from 'vitest';
import {fixture,refuseNetwork,effects,receipts} from './fixture';
import {seedContainer,seedPage,seedPageGrant} from '../../../e2e/setup/fixtures';
import {linkDependency,rehearseImpact,recordImpact} from '../../../../src/core/features/impact/service';
import {saveDecision,acceptDecision,getDecision} from '../../../../src/core/features/decisions/service';
import {replaceBlocks} from '../../../../src/core/features/editor/service';
import {saveGrant} from '../../../../src/core/features/sharing/grants';
afterEach(()=>vi.unstubAllGlobals());
test("EFFECT-003 — scoped rehearsal and pinned maintenance require exact current authority", async () => {
  await runFoldCases([
{name:"EFFECT-003 — scoped rehearsal hides a currently inaccessible dependency and records one read-only impact on replay",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {

 const calls=refuseNetwork(),f=await fixture();
 const decision=await saveDecision(f.context(),{operationKey:'scoped-decision',pageId:f.page.pageId,question:'Which account policy?',options:['Keep','Change'],outcome:'Keep',rationale:'Immutable accepted account policy',ownerId:f.owner,decidedAt:null,reviewAt:null,citations:f.refs});
 await acceptDecision(f.context(),{operationKey:'scoped-accept',id:decision.value.id,expectedRevisionId:decision.value.revisionId});
 const snapshot=(await getDecision(f.context(),decision.value.id)).accepted_snapshot_json;
 const {containerId}=await seedContainer(f.workspaceId,{ownerMemberId:f.owner,visibility:'closed'}),target=await seedPage(containerId,{authorMemberId:f.owner,title:'Confidential repair target'});
 await seedPageGrant(target.pageId,{principalKind:'member',principalId:f.owner,level:'full'});
 const targetGrant=await seedPageGrant(target.pageId,{principalKind:'member',principalId:f.reader,level:'view'});
 const accepted=await linkDependency(f.context(),{operationKey:'dependency-affected',source:f.refs[0]!,targetKind:'decision',targetId:decision.value.id,pageId:f.page.pageId,scope:{accountIds:['account-a'],audience:[f.owner,f.reader]}});
 const hidden=await linkDependency(f.context(),{operationKey:'dependency-hidden',source:f.refs[0]!,targetKind:'page',targetId:target.pageId,pageId:target.pageId,scope:{accountIds:['account-a'],audience:[f.owner,f.reader]}});
 const exception=await linkDependency(f.context(),{operationKey:'dependency-exception',source:f.refs[0]!,targetKind:'page',targetId:f.page.pageId,pageId:f.page.pageId,scope:{accountIds:['account-exception'],audience:[f.owner,f.reader]}});
 const edited=await replaceBlocks(f.context(),f.page.pageId,{operationKey:'impact-source-edit',expectedRevisionId:f.page.revisionId,blocks:[{id:'block-'+f.workspaceId,blockType:'paragraph',treePosition:'0',content:{text:[{text:'Changed scoped policy'}]}}]});
 const input={source:f.refs[0]!,newRevisionId:edited.value.revisionId,accountId:'account-a'};
 expect((await rehearseImpact(f.context(f.reader),input)).items.map(x=>x.dependencyId).sort()).toEqual([accepted.value.id,hidden.value.id].sort());
 await saveGrant(f.context(),{operationKey:'target-reader-revoke',targetKind:'page',targetId:target.pageId,id:targetGrant.grantId,principalKind:'member',principalId:f.reader,level:'view',revoke:true});
 const before=await receipts(f.workspaceId),rehearsal=await rehearseImpact(f.context(f.reader),input);
 expect(rehearsal).toMatchObject({simulated:true,liveWrites:false});expect(rehearsal.items).toHaveLength(1);expect(rehearsal.items[0]).toMatchObject({dependencyId:accepted.value.id,requiresAuthority:true,liveWrites:false,scope:{accountIds:['account-a'],audience:[f.owner,f.reader]}});
 expect(JSON.stringify(rehearsal)).not.toContain(target.pageId);expect(JSON.stringify(rehearsal)).not.toContain(exception.value.id);expect(await receipts(f.workspaceId)).toEqual(before);
 expect(await env.DB.prepare('SELECT count(*) n FROM intelligence_impacts WHERE workspace_id=?').bind(f.workspaceId).first<number>('n')).toBe(0);
 const request={...input,operationKey:'record-scoped-impact'},recorded=await recordImpact(f.context(f.reader),request);expect(await recordImpact(f.context(f.reader),request)).toEqual(recorded);
 const rows=(await env.DB.prepare('SELECT * FROM intelligence_impacts WHERE workspace_id=?').bind(f.workspaceId).all()).results;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({dependency_id:accepted.value.id,state:'pending'});
 expect((await getDecision(f.context(),decision.value.id)).accepted_snapshot_json).toBe(snapshot);expect(await effects(f.workspaceId)).toEqual([]);expect(calls).toEqual([]);

} finally {{await (vi.unstubAllGlobals());}}
}},
{name:"EFFECT-003 — evaluated pinned maintenance waits for a current exact grant and applies one attributable repair",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {

 const {maintenanceFixture}=await import('./maintenance-fixture');
 const {tryGrantedMaintenance}=await import('../../../../src/core/features/impact/maintenance');
 const {issueGrant,revokeGrant}=await import('../../../../src/core/features/effects/grants');
 const {readPage}=await import('../../../../src/core/features/pages/service');
 const {requestHash}=await import('../../../../src/core/app/operations');
 const f=await maintenanceFixture(),before=await readPage(f.context(),f.page.pageId);
 const scope={operations:['page.maintain'],targets:[f.page.pageId],accounts:[],sourceIds:[f.page.pageId],audience:['workspace'],maxCostMicros:0,contentHash:await requestHash(f.proposedChanges),conditions:{skillRevisionId:f.skill.value.revisionId,revisionId:before.page.revisionId},acceptNonAtomicProvider:false};
 expect(await tryGrantedMaintenance(f.context(),f.run.value.id)).toBeNull();
 const stale=await issueGrant(f.context(),{operationKey:'maintenance-stale',subjectId:f.owner,kind:'effect',expiresAt:'2099-01-01T00:00:00.000Z',scope:{...scope,conditions:{...scope.conditions,revisionId:'obsolete-revision'}}});
 expect(await tryGrantedMaintenance(f.context(),f.run.value.id)).toBeNull();
 const revoked=await issueGrant(f.context(),{operationKey:'maintenance-revoked',subjectId:f.owner,kind:'effect',expiresAt:'2099-01-01T00:00:00.000Z',scope});await revokeGrant(f.context(),{id:revoked.value.id,operationKey:'revoke-maintenance'});
 expect(await tryGrantedMaintenance(f.context(),f.run.value.id)).toBeNull();expect(await readPage(f.context(),f.page.pageId)).toEqual(before);
 expect(await env.DB.prepare('SELECT count(*) n FROM intelligence_reviews WHERE run_id=?').bind(f.run.value.id).first<number>('n')).toBe(0);
 const valid=await issueGrant(f.context(),{operationKey:'maintenance-current',subjectId:f.owner,kind:'effect',expiresAt:'2099-01-01T00:00:00.000Z',scope});expect(valid.value.id).not.toBe(stale.value.id);
 const repair=await tryGrantedMaintenance(f.context(),f.run.value.id);expect(repair).not.toBeNull();
 const after=await readPage(f.context(),f.page.pageId);expect(after.page.revisionId).not.toBe(before.page.revisionId);expect(JSON.stringify(after.blocks)).toContain('Determinate local repair');
 expect(JSON.stringify(after.blocks)).toContain('Related granted follow-through');
 expect(await tryGrantedMaintenance(f.context(),f.run.value.id)).toBeNull();expect(await readPage(f.context(),f.page.pageId)).toEqual(after);
 const {sessionDoor}=await import('../../intelligence/run-flow');
 const door=await sessionDoor(f.owner);
 const inbox=await door('GET','/api/notifications');expect(inbox.status).toBe(200);
 const notices=(await inbox.json<any>()).items.filter((item:any)=>item.detail?.runId===f.run.value.id);
 expect(notices.map((item:any)=>item.event).sort()).toEqual(['maintenance','run-review']);
 const outcome=notices.find((item:any)=>item.event==='maintenance');expect(outcome).toMatchObject({href:`/app/runs/${f.run.value.id}`,detail:{outcome:'Applied 1 granted page change.'}});
 const today=await door('GET','/api/notifications/today');expect(today.status).toBe(200);
 const grouped=await today.json<any>();expect(grouped.decisions).toEqual([]);expect(grouped.outcomes).toHaveLength(1);expect(grouped.outcomes[0].count).toBe(1);
 const inspected=await door('GET',`/api/runs/${f.run.value.id}`);expect(inspected.status).toBe(200);expect(JSON.stringify(await inspected.json())).toContain('Related granted follow-through');
 const reviews=(await env.DB.prepare('SELECT * FROM intelligence_reviews WHERE run_id=?').bind(f.run.value.id).all()).results;expect(reviews).toHaveLength(1);expect(reviews[0]).toMatchObject({actor_id:f.owner,outcome:'accepted'});
 const receipt=await env.DB.prepare('SELECT request_hash FROM operation_receipts WHERE workspace_id=? AND operation_key=?').bind(f.workspaceId,'granted-maintenance:'+f.run.value.id).first<{request_hash:string}>();
 expect(receipt!.request_hash).toBe(await requestHash({action:'runs.granted-changes',request:{runId:f.run.value.id,operationKey:'granted-maintenance:'+f.run.value.id,expectedRevisionId:f.row.revision_id,selections:f.proposedChanges.map((_,index)=>({index,pageId:f.page.pageId,expectedPageRevisionId:before.page.revisionId,mode:'insert-below'})),standingGrantId:valid.value.id}}));
 expect(await effects(f.workspaceId)).toEqual([]);expect(f.calls).toHaveLength(3);

} finally {{await (vi.unstubAllGlobals());}}
}}
  ]);
});
