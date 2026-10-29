import {refreshSearchIndex} from '../features/search/index';
import {dispatchCommittedNotifications} from '../features/notifications/dispatch';
import type { FeatureContext } from './feature-context';
import { ApiProblem } from './problems';
import type { EntityRef, JsonValue, MutationReceipt } from '../shared/api/common';
import { createUlid } from '../shared/ulid';
import { requestHash } from './request-hash';
export { requestHash } from './request-hash';
interface GuardCheck { select: string; values: (string | number | null)[]; recheck?: { select: string; values: (string | number | null)[]; pageId?: string } }
const guardChecks = new WeakMap<D1PreparedStatement, GuardCheck>();
export interface MutationPlan<T> { statements: D1PreparedStatement[]; entity: EntityRef; value: T; detail?: JsonValue; feature?: string; noChange?: boolean }
/** Domain callers must include immutable revision writes and SQL CAS guards in statements. */
export async function commitOperation<T>(ctx: FeatureContext, input: {
  operationKey: string; action: string; request: unknown;
  commit?: (statements:D1PreparedStatement[]) => Promise<unknown>;
  authorize: () => Promise<void>;
  prepare: (receipt: { revisionId: string; activityId: string }) => Promise<MutationPlan<T>>;
}): Promise<{ value: T; receipt: MutationReceipt }> {
  if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(input.operationKey)) throw new ApiProblem(400,'INVALID_OPERATION_KEY','Supply an operation key of 8–160 safe characters.');
  ctx.authorizationEpoch = undefined;
  const lookup = async () => ctx.db.prepare('SELECT request_hash,response_json,expires_at FROM operation_receipts WHERE workspace_id=? AND actor_member_id=? AND operation_key=?').bind(ctx.actor.workspaceId,ctx.actor.id,input.operationKey).first<{request_hash:string;response_json:string;expires_at:string}>();
  const replay = (row: {request_hash:string;response_json:string;expires_at:string}) => {
    if (row.request_hash !== hash || row.expires_at <= ctx.now) throw new ApiProblem(409,'OPERATION_KEY_CONFLICT','This operation key cannot be reused.');
    return JSON.parse(row.response_json) as {value:T;receipt:MutationReceipt};
  };
  const [,previous]=await Promise.all([input.authorize(),lookup()]);
  const authorizationEpoch=ctx.authorizationEpoch;
  const hash=await requestHash({action:input.action,request:input.request});
  if (previous) { if(input.action!=='pages.open')await refreshAfterCommit(ctx); return replay(previous); }
  const revisionId = createUlid(), activityId = createUlid();
  const plan = await input.prepare({revisionId,activityId});
  const receipt: MutationReceipt = {operationKey:input.operationKey,entity:plan.entity,revisionId:plan.entity.revisionId,activityId:plan.noChange?null:activityId,committedAt:ctx.now,...(plan.noChange?{unchanged:true as const}:{})};
  const result = {value:plan.value,receipt};
  const detail = plan.detail === undefined || (plan.detail && typeof plan.detail === 'object' && !Array.isArray(plan.detail))
    ? { revisionId: plan.entity.revisionId, ...(plan.detail as Record<string, JsonValue> | undefined) } : plan.detail;
  const expires = new Date(Date.parse(ctx.now)+86400000).toISOString();
  const statements = [
      ctx.db.prepare('INSERT INTO operation_receipts (id,workspace_id,actor_member_id,operation_key,request_hash,target_kind,target_id,response_status,response_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,200,?,?,?)').bind(createUlid(),ctx.actor.workspaceId,ctx.actor.id,input.operationKey,hash,plan.entity.kind,plan.entity.id,JSON.stringify(result),ctx.now,expires),
      ...(authorizationEpoch === undefined ? [] : [mutationGuard(ctx.db, 'SELECT epoch=? FROM core_acl_epoch WHERE id=1',[authorizationEpoch])]),
      ...(ctx.credentialGuard ? [ctx.credentialGuard()] : []),
      mutationGuard(ctx.db, "SELECT status='active' FROM members WHERE id=? AND workspace_id=?", [ctx.actor.id,ctx.actor.workspaceId]),
      ...(ctx.stepUp ? [freshProofGuard(ctx)] : []),
      ...(ctx.operationStatements?.before ?? []),
      ...plan.statements,
      ...(plan.noChange?[]:[ctx.db.prepare('INSERT INTO activity_entries (id,workspace_id,actor_member_id,feature,action,target_kind,target_id,detail_json,operation_key,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(activityId,ctx.actor.workspaceId,ctx.actor.id,plan.feature ?? input.action.split('.')[0],input.action,plan.entity.kind,plan.entity.id,JSON.stringify(detail),input.operationKey,ctx.now)]),
      ...(ctx.operationStatements?.after ?? []),
    ];
  try {
    await (input.commit ?? (statements=>ctx.db.batch(statements)))(statements);
  } catch (cause) {
    const raced = await lookup(); if (raced) { await input.authorize(); if(input.action!=='pages.open')await refreshAfterCommit(ctx); return replay(raced); }
    if (String(cause).includes('core_write_guards') || String(cause).includes('CHECK constraint')) {
      if (await rejectedByPageLock(ctx, statements)) throw new ApiProblem(409,'PAGE_LOCKED','This page is locked. Unlock it before editing.');
      throw new ApiProblem(409,'REVISION_CONFLICT','The record changed. Reload before saving.');
    }
    if(String(cause).includes('UNIQUE constraint')) throw new ApiProblem(409,'ENTITY_CONFLICT','An existing record conflicts with this change.');
    throw cause;
  }
  // Visits change personal read state only; they do not dirty search content
  // or create notification candidates. Content mutations still drain both.
  if(input.action!=='pages.open') {
    await Promise.all([refreshAfterCommit(ctx),dispatchCommittedNotifications(ctx)]);
  }
  return result;
}
/** Repeat Base's accepted proof, including its gated local dev session, at commit. */
export function freshProofGuard(ctx: FeatureContext): D1PreparedStatement {
  const proof = ctx.stepUp!;
  const authority = 'COALESCE((SELECT version FROM member_authority WHERE member_id=m.id),1)';
  const emailProof = `s.proof_at>=? AND s.proof_version=${authority}`;
  const localDev = ctx.localDevelopment === true;
  const accepted = localDev
    ? `(s.kind='dev' AND s.expires_at>? AND s.authority_version=${authority}) OR (${emailProof})`
    : emailProof;
  return mutationGuard(ctx.db, `SELECT EXISTS(SELECT 1 FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.id=? AND s.member_id=? AND m.status='active' AND s.revoked_at IS NULL AND (${accepted}))`, [proof.sessionId, ctx.actor.id, ...(localDev ? [ctx.now] : []), proof.since]);
}
/** Guard SELECT must return a boolean scalar. It executes inside the same atomic D1 batch as writes. */
export function mutationGuard(db: D1Database, select: string, values: (string | number | null)[], recheck?: GuardCheck['recheck']): D1PreparedStatement {
  if (!/^SELECT\s/i.test(select)) throw new Error('Mutation guard requires a SELECT.');
  const statement = db.prepare(`INSERT INTO core_write_guards (id,accepted) VALUES (?, COALESCE((${select}),0))`).bind(createUlid(),...values);
  guardChecks.set(statement, {select, values, recheck});
  return statement;
}

/** The receipt is already committed. Dirty rows retain failed work; the next read/replay drains them. */
async function refreshAfterCommit(ctx:FeatureContext):Promise<void> {
  try { await refreshSearchIndex(ctx); }
  catch(error) { console.error('Search refresh pending; canonical mutation committed.',error); }
}

/** Do not relabel unrelated CAS/ACL failures, and never retry a rejected write. */
async function rejectedByPageLock(ctx: FeatureContext, statements: D1PreparedStatement[]) {
  let locked = false;
  for (const statement of statements) {
    const check = guardChecks.get(statement);
    if (!check || await ctx.db.prepare(`SELECT COALESCE((${check.select}),0) AS accepted`).bind(...check.values).first<number>('accepted')) continue;
    if (!check.recheck || !await ctx.db.prepare(`SELECT COALESCE((${check.recheck.select}),0) AS accepted`).bind(...check.recheck.values).first<number>('accepted')) return false;
    if (check.recheck.pageId) {
      const page = await ctx.db.prepare('SELECT locked_at FROM pages WHERE id=? AND workspace_id=? AND deleted_at IS NULL').bind(check.recheck.pageId,ctx.actor.workspaceId).first<{locked_at:string|null}>();
      if (!page?.locked_at) return false;
      locked = true;
    }
  }
  return locked;
}
