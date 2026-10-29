import {runFoldCases} from '../fold-cases';
import {resetDeployment as resetFoldDeployment} from '../../e2e/setup/reset-deployment';
import { env } from 'cloudflare:test';
import { describe,test,expect } from 'vitest';
import { seedWorkspace,seedMember,seedContainer,seedPage,seedPageGrant,seedGroup } from '../../e2e/setup/fixtures';
import { requirePageLevel,requireWorkspaceOwner } from '../../../src/core/features/sharing/current-access';
import { commitOperation,mutationGuard } from '../../../src/core/app/operations';
import { completeFirstRun } from '../../../src/core/features/workspace/bootstrap';
import { removeMember } from '../../../src/core/features/workspace/members';
import { setTheme } from '../../../src/core/features/workspace/members';
import type { FeatureContext } from '../../../src/core/app/feature-context';
async function fixture(){const {workspaceId}=await seedWorkspace();const {memberId}=await seedMember(workspaceId,{role:'owner',email:`${workspaceId}@test.invalid`,displayName:'Owner',isSetupOwner:true});const actor={id:memberId,workspaceId,workspaceName:'Test',email:'owner@test.invalid',displayName:'Owner',initials:'OW',role:'owner' as const};return {db:env.DB,files:env.FILES,jobs:env.JOBS,actor,now:new Date().toISOString()} as FeatureContext;}
describe('core durable authority',()=>{
 test("first-run, operation replay, atomic rollback and membership policies preserve authority", async () => {
  await runFoldCases([
{name:"core durable authority WORK-013 first run has exactly three domain records and cannot repeat",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {
const ctx=await fixture();const result=await completeFirstRun(ctx,{operationKey:'case:001',workspaceName:'Team',containerName:'Handbook',pageTitle:'Welcome'});expect(result.value.pageId).toBeTruthy();expect((await env.DB.prepare('SELECT count(*) AS n FROM containers WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{n:number}>())!.n).toBe(1);expect((await env.DB.prepare('SELECT count(*) AS n FROM pages WHERE workspace_id=?').bind(ctx.actor.workspaceId).first<{n:number}>())!.n).toBe(1);expect(await completeFirstRun(ctx,{operationKey:'case:001',workspaceName:'Team',containerName:'Handbook',pageTitle:'Welcome'})).toEqual(result);await expect(completeFirstRun(ctx,{operationKey:'case:002',workspaceName:'Team',containerName:'Other',pageTitle:'Again'})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
} finally {}
}},
{name:"core durable authority same key/body commits once; changed body conflicts and revoked membership denies replay",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {
const ctx=await fixture();const input={operationKey:'case:003',theme:'dark' as const};const [a,b]=await Promise.all([setTheme({...ctx},input),setTheme({...ctx},input)]);expect(a).toEqual(b);expect((await env.DB.prepare('SELECT count(*) AS n FROM activity_entries WHERE operation_key=? AND workspace_id=?').bind(input.operationKey,ctx.actor.workspaceId).first<{n:number}>())!.n).toBe(1);await expect(setTheme(ctx,{...input,theme:'light'})).rejects.toMatchObject({code:'OPERATION_KEY_CONFLICT'});await env.DB.prepare("UPDATE members SET status='removed' WHERE id=?").bind(ctx.actor.id).run();await expect(setTheme(ctx,input)).rejects.toMatchObject({status:401});
} finally {}
}},
{name:"core durable authority failed CAS rolls back mutation receipt and activity atomically",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {
const ctx=await fixture();await expect(commitOperation(ctx,{operationKey:'case:004',action:'workspace.test',request:{},authorize:()=>requireWorkspaceOwner(ctx),prepare:async({revisionId})=>({entity:{id:ctx.actor.workspaceId,kind:'workspace',revisionId},value:{},statements:[env.DB.prepare("UPDATE workspaces SET name='Bad' WHERE id=?").bind(ctx.actor.workspaceId),mutationGuard(env.DB,'SELECT 0',[])]})})).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect((await env.DB.prepare('SELECT name FROM workspaces WHERE id=?').bind(ctx.actor.workspaceId).first<{name:string}>())!.name).toBe('Aurora');expect(await env.DB.prepare('SELECT id FROM operation_receipts WHERE operation_key=?').bind('case:004').first()).toBeNull();expect(await env.DB.prepare('SELECT id FROM activity_entries WHERE workspace_id=? AND operation_key=?').bind(ctx.actor.workspaceId,'case:004').first()).toBeNull();
} finally {}
}},
{name:"core durable authority WORK-007 last owner and setup owner survive unauthorized removal",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {
const ctx=await fixture();await expect(removeMember(ctx,{operationKey:'case:005',memberId:ctx.actor.id})).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect((await env.DB.prepare('SELECT status FROM members WHERE id=?').bind(ctx.actor.id).first<{status:string}>())!.status).toBe('active');
} finally {}
}},
{name:"core durable authority ACL revocation racing an authorized preparation aborts the batch",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {
const ctx=await fixture();await expect(commitOperation(ctx,{operationKey:'case:006',action:'workspace.test',request:{},authorize:()=>requireWorkspaceOwner(ctx),prepare:async({revisionId})=>{await env.DB.prepare("UPDATE members SET role='member' WHERE id=?").bind(ctx.actor.id).run();return {entity:{id:ctx.actor.workspaceId,kind:'workspace',revisionId},value:{},statements:[env.DB.prepare("UPDATE workspaces SET name='Denied' WHERE id=?").bind(ctx.actor.workspaceId)]};}})).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect((await env.DB.prepare('SELECT name FROM workspaces WHERE id=?').bind(ctx.actor.workspaceId).first<{name:string}>())!.name).toBe('Aurora');
} finally {}
}},
{name:"WORK-011 all eight policy values save with immutable identity revision and stale update denied",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {
const {readWorkspace,updateWorkspace}=await import('../../../src/core/features/workspace/settings');const ctx=await fixture();const before=await readWorkspace(ctx);const input={operationKey:'case:007',expectedRevisionId:before.revisionId,name:'Revised',mark:'R',description:'Team',guestAccess:'forbidden' as const,publicLinkAccess:'allowed' as const,anonymousAccess:'forbidden' as const,policies:{...before.policies,'page.lifecycle.v1':'draft-then-publish' as const,'automation.scope.v1':'site' as const}};const result=await updateWorkspace(ctx,input);expect((await readWorkspace(ctx)).policies['automation.scope.v1']).toBe('site');expect(await env.DB.prepare('SELECT id FROM core_entity_revisions WHERE id=?').bind(result.receipt.revisionId).first()).toBeTruthy();await expect(updateWorkspace(ctx,{...input,operationKey:'case:008'})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
} finally {}
}},
{name:"WORK-003 ordinary members cannot remove themselves or another member",before:async()=>{await resetFoldDeployment();},run:async()=>{
try {
const owner=await fixture();const {memberId}=await seedMember(owner.actor.workspaceId,{role:'member',email:'ordinary-removal@test.invalid',displayName:'Member'});const ctx={...owner,actor:{...owner.actor,id:memberId,role:'member' as const}};await expect(removeMember(ctx,{operationKey:'case:009',memberId})).rejects.toMatchObject({status:403});await expect(removeMember(ctx,{operationKey:'case:010',memberId:owner.actor.id})).rejects.toMatchObject({status:403});expect((await env.DB.prepare('SELECT status FROM members WHERE id=?').bind(memberId).first<{status:string}>())!.status).toBe('active');
} finally {}
}}
  ]);
});




});
