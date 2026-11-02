import { assertActionScope, assertPageScope, scopedActionContext } from "./scope";
import { fields } from "../databases/repository";
import { automationActivity } from "./activity";
import type { FeatureContext } from "../../app/feature-context";
import { ApiProblem } from "../../app/problems";
import { mutationGuard } from "../../app/operations";
import { createUlid } from "../../shared/ulid";
import { currentSubject, requirePageLevel } from "../sharing/current-access";
import { authorizeRule } from "./service";
import type { RuleRow, AutomationEvent, RuleAction } from "./types";
import { matches } from "../databases/values";
import { openRecord } from "../databases/records";
import { readPage } from "../pages/service";
import {
  executeAction,
  prepareAction,
  type AutomationAdapters,
  type PreparedAction,
} from "./actions";
import {
  actorContext,
  defaultAutomationLimits,
  type AutomationLimits,
} from "./jobs";
async function skipAction(ctx: FeatureContext, runId: string, index: number, target: string, code: string) {
  await ctx.db.prepare(
    "INSERT INTO automation_action_receipts VALUES (?,?,?,'skipped',?,?) ON CONFLICT(run_id,action_index,target_id) DO UPDATE SET state='skipped',receipt_json=excluded.receipt_json WHERE automation_action_receipts.state NOT IN ('confirmed','skipped')",
  ).bind(runId, index, target, JSON.stringify({
    code, message: "Action skipped because current access does not permit it.",
  }), ctx.now).run();
}
export async function processAutomationJob(
  ctx: FeatureContext,
  jobId: string,
  adapters: AutomationAdapters,
  limits = defaultAutomationLimits,
) {
  const job = await ctx.db
    .prepare(
      "SELECT j.*,r.workspace_id,r.actor_member_id AS rule_actor_id FROM automation_jobs j JOIN automation_rules r ON r.id=j.rule_id WHERE j.id=? AND r.workspace_id=?",
    )
    .bind(jobId, ctx.actor.workspaceId)
    .first<{
      id: string;
      rule_actor_id: string;
      run_id: string;
      rule_id: string;
      state: string;
      cursor: number;
      payload_json: string;
      lease_until: string | null;
    }>();
  if (!job || !["queued", "running"].includes(job.state)) return;
  const token = new Date(Date.parse(ctx.now) + 60000).toISOString();
  const claimed = await ctx.db
    .prepare(
      "UPDATE automation_jobs SET state='running',cursor=cursor+1,lease_until=? WHERE id=? AND (state='queued' OR (state='running' AND lease_until<?))",
    )
    .bind(token, jobId, ctx.now)
    .run();
  if (!claimed.meta.changes) return;
  const payload = JSON.parse(job.payload_json) as {
    event: AutomationEvent;
    ruleRevisionId: string;
    targets?: string[];
  };
  let state = "success",
    detail: Record<string, unknown> = {},
    touched: string[] = [];
  await ctx.db
    .prepare(
      "UPDATE automation_runs SET state='running',started_at=? WHERE id=?",
    )
    .bind(ctx.now, job.run_id)
    .run();
  const priorReceipts = await ctx.db
    .prepare(
      "SELECT target_id,receipt_json FROM automation_action_receipts WHERE run_id=? AND state='confirmed'",
    )
    .bind(job.run_id)
    .all<{ target_id: string; receipt_json: string }>();
  for (const prior of priorReceipts.results) {
    if (prior.target_id) touched.push(prior.target_id);
    const result = JSON.parse(prior.receipt_json);
    if (result?.receipt?.entity?.kind === "page")
      touched.push(result.receipt.entity.id);
  }
  try {
    const rule = await ctx.db
      .prepare("SELECT * FROM automation_rules WHERE id=?")
      .bind(job.rule_id)
      .first<RuleRow>();
    if (!rule || rule.disabled_at) {
      state = "disabled";
    } else if (rule.revision_id !== payload.ruleRevisionId) {
      state = "configuration-changed";
    } else {
      const acting = await actorContext(ctx, rule);
      await authorizeRule(acting, rule, true);
      const event = payload.event;
      let values: Record<string, unknown> = {};
      let definitions: import("../databases/values").Field[] = [];
      if (event.pageId && !payload.targets) {
        await assertPageScope(acting, rule, event.pageId);
        const record = await ctx.db
          .prepare("SELECT page_id FROM database_records WHERE page_id=?")
          .bind(event.pageId)
          .first();
        if (event.databaseId) definitions = await fields(acting,event.databaseId);
        values = record
          ? (await openRecord(acting, event.pageId)).values
          : ((await readPage(acting, event.pageId))
              .properties as unknown as Record<string, unknown>);
      }
      if (
        !payload.targets && !JSON.parse(rule.conditions_json).every(
          (f: import("../databases/values").Filter) => matches(values, f, 0, definitions),
        )
      )
        state = "condition-not-met";
      else {
        const branch = rule.branch_json ? JSON.parse(rule.branch_json) : null;
        const targets: string[] = payload.targets ?? (branch
          ? Array.isArray(values[branch.relationField])
            ? (values[branch.relationField] as string[])
            : []
          : [event.pageId ?? ""]);
        if (targets.length > limits.targetsPerRun)
          throw new ApiProblem(
            429,
            "TARGET_LIMIT",
            "Rule branch exceeds its target limit.",
          );
        if (!targets.length) state = "no-action";
        const actions = JSON.parse(rule.actions_json) as RuleAction[];
        if (targets.length * actions.length > 100)
          throw new ApiProblem(
            429,
            "ACTION_LIMIT",
            "A run may perform at most 100 bounded actions.",
          );
        if (!actions.length) state = "no-action";
        if (!payload.targets) {
          payload.targets = targets;
          await ctx.db.prepare("UPDATE automation_jobs SET payload_json=? WHERE id=? AND lease_until=?").bind(JSON.stringify(payload),jobId,token).run();
        }
        for (const target of targets) {
          for (let index = 0; index < actions.length; index++) {
            const current = await ctx.db
              .prepare(
                "SELECT disabled_at,revision_id FROM automation_rules WHERE id=?",
              )
              .bind(rule.id)
              .first<{
                disabled_at: string | null;
                revision_id: string;
              }>();
            if (
              current?.disabled_at ||
              current?.revision_id !== rule.revision_id
            )
              throw new ApiProblem(
                409,
                "RULE_CHANGED",
                "Rule changed during execution.",
              );
            const fresh = { ...acting, now: new Date().toISOString() };
            await authorizeRule(fresh, rule, true);
            const receipt = await ctx.db
              .prepare(
                "SELECT state,receipt_json FROM automation_action_receipts WHERE run_id=? AND action_index=? AND target_id=?",
              )
              .bind(job.run_id, index, target)
              .first<{
                state: string;
                receipt_json: string;
              }>();
            if (receipt && ["confirmed", "skipped"].includes(receipt.state))
              continue;
            try {
              const prepared: PreparedAction = receipt
                ? JSON.parse(receipt.receipt_json)
                : await prepareAction(
                    fresh,
                    actions[index],
                    target,
                    `auto:${job.run_id}:${index}:${target || "root"}`,
                  );
              if (!receipt)
                await ctx.db
                  .prepare(
                    "INSERT INTO automation_action_receipts VALUES (?,?,?,'prepared',?,?)",
                  )
                  .bind(
                    job.run_id,
                    index,
                    target,
                    JSON.stringify(prepared),
                    fresh.now,
                  )
                  .run();
              // A committed semantic receipt is authoritative even if confirmation previously failed.
              const committed = await ctx.db.prepare("SELECT response_json FROM operation_receipts WHERE workspace_id=? AND actor_member_id=? AND operation_key=?").bind(fresh.actor.workspaceId,fresh.actor.id,prepared.operationKey).first<{response_json:string}>();
              let result: unknown;
              if (committed) result = JSON.parse(committed.response_json);
              else {
                await assertActionScope(fresh, rule, prepared.action, prepared.pageId);
                result = await executeAction(scopedActionContext(fresh,rule,prepared.action,prepared.pageId), prepared, adapters);
              }
              await ctx.db
                .prepare(
                  "UPDATE automation_action_receipts SET state='confirmed',receipt_json=? WHERE run_id=? AND action_index=? AND target_id=?",
                )
                .bind(JSON.stringify(result), job.run_id, index, target)
                .run();
              if (target) touched.push(target);
              if (result && typeof result === "object" && "receipt" in result) {
                const receipt = result.receipt as {
                  entity?: { kind: string; id: string };
                };
                if (receipt.entity?.kind === "page")
                  touched.push(receipt.entity.id);
              }
            } catch (e) {
              if (
                e instanceof ApiProblem &&
                [401, 403, 404].includes(e.status)
              ) {
                await skipAction(fresh, job.run_id, index, target, e.code);
                detail.skipped = true;
                continue;
              }
              throw e;
            }
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof ApiProblem && [403, 404].includes(e.status)) {
      // Access may disappear before conditions are read, or between effects.
      // Retain confirmed work and log every remaining known target as skipped.
      const rule = await ctx.db.prepare("SELECT actions_json FROM automation_rules WHERE id=?")
        .bind(job.rule_id).first<{ actions_json: string }>();
      const actions = rule ? JSON.parse(rule.actions_json) as RuleAction[] : [];
      const targets = payload.targets ?? (payload.event.pageId ? [payload.event.pageId] : [""]);
      for (const target of targets) for (let index = 0; index < actions.length; index++)
        await skipAction(ctx, job.run_id, index, target, e.code);
      state = "success";
      detail.skipped = true;
    } else {
      const transient = !(e instanceof ApiProblem) || e.status >= 500;
      state = transient && job.cursor < 2 ? "running" : e instanceof ApiProblem && e.status === 429 ? "throttled" : "failure";
      detail = {
        ...detail,
        error: e instanceof ApiProblem ? e.code : "ACTION_FAILED",
        message:
          e instanceof ApiProblem
            ? e.message
            : "An action failed; retained receipts identify committed work.",
      };
    }
  }
  if (state === "success") {
    const confirmed = await ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM automation_action_receipts WHERE run_id=? AND state='confirmed'",
      )
      .bind(job.run_id)
      .first<{ n: number }>();
    if (!confirmed?.n) state = "no-action";
  }
  await ctx.db.batch([
    mutationGuard(
      ctx.db,
      "SELECT lease_until=? FROM automation_jobs WHERE id=?",
      [token, jobId],
    ),
    ctx.db
      .prepare(
        "UPDATE automation_jobs SET state=?,lease_until=? WHERE id=? AND lease_until=?",
      )
      .bind(state, state === "running" ? new Date(Date.parse(ctx.now) + 60000 * 2 ** job.cursor).toISOString() : null, jobId, token),
    ctx.db
      .prepare(
        "UPDATE automation_runs SET state=?,records_json=?,detail_json=?,finished_at=? WHERE id=?",
      )
      .bind(
        state,
        JSON.stringify([...new Set(touched)]),
        JSON.stringify(detail),
        state === "running" ? null : new Date().toISOString(),
        job.run_id,
      ),
    ctx.db
      .prepare(
        "UPDATE automation_rules SET consecutive_failures=CASE WHEN ? THEN consecutive_failures+1 ELSE 0 END,disabled_at=CASE WHEN ? AND consecutive_failures+1>=? THEN ? ELSE disabled_at END,disabled_reason=CASE WHEN ? AND consecutive_failures+1>=? THEN ? ELSE disabled_reason END WHERE id=?",
      )
      .bind(
        +(state === "failure"),
        +(state === "failure"),
        limits.consecutiveFailures,
        ctx.now,
        +(state === "failure"),
        limits.consecutiveFailures,
        "Disabled after repeated failures.",
        job.rule_id,
      ),
    automationActivity(
      { ...ctx, now: new Date().toISOString() },
      job.run_id,
      job.rule_actor_id,
      state,
    ),
  ]);
  return { state, runId: job.run_id };
}
