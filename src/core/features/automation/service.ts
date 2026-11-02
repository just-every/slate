import { assertActionScope, validateRuleScope } from "./scope";
import type { FeatureContext } from "../../app/feature-context";
import { ApiProblem } from "../../app/problems";
import { commitOperation, mutationGuard } from "../../app/operations";
import {
  requireContainerLevel,
  requireWorkspaceOwner,
  currentSubject,
  requirePageLevel,
} from "../sharing/current-access";
import { database, revision } from "../databases/repository";
import { createUlid } from "../../shared/ulid";
import type { RuleDefinition, RuleRow } from "./types";
export async function authorizeRule(
  ctx: FeatureContext,
  rule: Pick<RuleRow, "scope" | "source_database_id" | "container_id">,
  edit = false,
) {
  await currentSubject(ctx);
  if (rule.scope === "source") {
    if (!rule.source_database_id)
      throw new ApiProblem(400, "INVALID_SCOPE", "Source database required.");
    await database(ctx, rule.source_database_id, edit ? "edit" : "view");
  } else if (rule.scope === "container") {
    if (!rule.container_id)
      throw new ApiProblem(400, "INVALID_SCOPE", "Container required.");
    await requireContainerLevel(ctx, rule.container_id, edit ? "edit" : "view");
  } else await requireWorkspaceOwner(ctx);
}
export async function ruleRow(ctx: FeatureContext, id: string, edit = false) {
  const r = await ctx.db
    .prepare("SELECT * FROM automation_rules WHERE id=? AND workspace_id=?")
    .bind(id, ctx.actor.workspaceId)
    .first<RuleRow>();
  if (!r) throw new ApiProblem(404, "NOT_FOUND", "Not found.");
  await authorizeRule(ctx, r, edit);
  if (!edit) await authorizeDefinition(ctx,r);
  return r;
}
export function validateRule(rule: RuleDefinition) {
  if (
    !rule.name?.trim() ||
    !["source", "container", "site"].includes(rule.scope) ||
    !Array.isArray(rule.conditions) ||
    !Array.isArray(rule.actions) ||
    rule.actions.length > 50
  )
    throw new ApiProblem(400, "INVALID_RULE", "Invalid rule configuration.");
  if (
    ![
      "created",
      "properties",
      "blocks",
      "published",
      "record-created",
      "record-updated",
      "schedule",
    ].includes(rule.trigger?.event)
  )
    throw new ApiProblem(400, "INVALID_TRIGGER", "Unsupported trigger.");
  if (
    rule.trigger.event === "schedule" &&
    (!Number.isInteger(rule.trigger.intervalMinutes) ||
      rule.trigger.intervalMinutes! < 1 ||
      !rule.trigger.startsAt ||
      !Number.isFinite(Date.parse(rule.trigger.startsAt)))
  )
    throw new ApiProblem(
      400,
      "INVALID_SCHEDULE",
      "Choose a valid start and positive interval in minutes.",
    );
  for (const a of rule.actions) {
    if ((rule.scope === "source" && (a.type === "create-page" || a.type === "create-record" && a.databaseId !== rule.sourceDatabaseId)) ||
        (rule.scope === "container" && (a.type === "create-page" || a.type === "move") && a.containerId !== rule.containerId))
      throw new ApiProblem(403,"AUTOMATION_SCOPE","Action destination is outside the declared rule scope.");
    if (
      ![
        "edit-fields",
        "create-page",
        "create-record",
        "move",
        "archive",
        "comment",
        "notify",
      ].includes(a.type)
    )
      throw new ApiProblem(
        400,
        "FORBIDDEN_AUTOMATION_ACTION",
        "Automation cannot execute this action.",
      );
  }
}
export async function saveRule(
  ctx: FeatureContext,
  input: RuleDefinition & {
    operationKey: string;
    expectedRevisionId?: string;
  },
) {
  validateRule(input);
  return commitOperation(ctx, {
    operationKey: input.operationKey,
    action: "automation.configure",
    request: input,
    authorize: async () => {
      if (input.id) {
        const r = await ruleRow(ctx, input.id, true);
        if (r.actor_member_id !== ctx.actor.id)
          throw new ApiProblem(
            403,
            "ACTOR_REQUIRED",
            "Only the rule actor can change its delegated actions.",
          );
      }
      await authorizeRule(
        ctx,
        {
          scope: input.scope,
          source_database_id: input.sourceDatabaseId ?? null,
          container_id: input.containerId ?? null,
        },
        true,
      );
    },
    prepare: async ({ revisionId }) => {
      await validateRuleScope(ctx, input);
      const id = input.id ?? createUlid(),
        statements = input.id
          ? [
              mutationGuard(
                ctx.db,
                "SELECT revision_id=? FROM automation_rules WHERE id=?",
                [input.expectedRevisionId ?? "", id],
              ),
            ]
          : [];
      statements.push(
        ctx.db
          .prepare(
            "INSERT INTO automation_rules (id,workspace_id,source_database_id,container_id,scope,name,trigger_json,conditions_json,branch_json,actions_json,actor_member_id,disabled_at,created_at,updated_at,revision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_database_id=excluded.source_database_id,container_id=excluded.container_id,scope=excluded.scope,name=excluded.name,trigger_json=excluded.trigger_json,conditions_json=excluded.conditions_json,branch_json=excluded.branch_json,actions_json=excluded.actions_json,disabled_at=excluded.disabled_at,disabled_reason=NULL,consecutive_failures=0,updated_at=excluded.updated_at,revision_id=excluded.revision_id",
          )
          .bind(
            id,
            ctx.actor.workspaceId,
            input.sourceDatabaseId ?? null,
            input.containerId ?? null,
            input.scope,
            input.name,
            JSON.stringify(input.trigger),
            JSON.stringify(input.conditions),
            input.branch ? JSON.stringify(input.branch) : null,
            JSON.stringify(input.actions),
            ctx.actor.id,
            input.disabled ? ctx.now : null,
            ctx.now,
            ctx.now,
            revisionId,
          ),
        revision(ctx, revisionId, "automation-rule", id, input),
        ctx.db
          .prepare(
            "INSERT INTO automation_runs (id,rule_id,workspace_id,actor_member_id,state,trigger_json,created_at,finished_at) VALUES (?,?,?,?,'configuration-changed','{}',?,?)",
          )
          .bind(
            createUlid(),
            id,
            ctx.actor.workspaceId,
            ctx.actor.id,
            ctx.now,
            ctx.now,
          ),
      );
      return {
        entity: { id, kind: "automation-rule", revisionId },
        value: { id, revisionId },
        statements,
      };
    },
  });
}
export async function listRules(ctx: FeatureContext) {
  await currentSubject(ctx);
  const rows = await ctx.db
    .prepare(
      "SELECT * FROM automation_rules WHERE workspace_id=? ORDER BY name,id",
    )
    .bind(ctx.actor.workspaceId)
    .all<RuleRow>();
  const items: RuleRow[] = [];
  for (const r of rows.results) {
    try {
      await authorizeRule(ctx, r);
      await authorizeDefinition(ctx,r);
      items.push(r);
    } catch (e) {
      if (!(e instanceof ApiProblem) || ![403, 404].includes(e.status)) throw e;
    }
  }
  return { items };
}
export async function runLog(ctx: FeatureContext, id: string) {
  const rule = await ruleRow(ctx, id);
  const rows = await ctx.db
    .prepare(
      "SELECT * FROM automation_runs WHERE rule_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
    )
    .bind(id)
    .all<Record<string, unknown>>();
  const items = [];
  for (const row of rows.results) {
    const readable: string[] = [];
    for (const pageId of JSON.parse(String(row.records_json)) as string[]) {
      try {
        await requirePageLevel(ctx, pageId, "view");
        readable.push(pageId);
      } catch (e) {
        if (!(e instanceof ApiProblem) || e.status !== 404) throw e;
      }
    }
    const trigger = JSON.parse(String(row.trigger_json));
    if (trigger.pageId) {
      try {
        await requirePageLevel(ctx, trigger.pageId, "view");
      } catch (e) {
        if (!(e instanceof ApiProblem) || e.status !== 404) throw e;
        delete trigger.pageId;
        delete trigger.databaseId;
        delete trigger.containerId;
      }
    }
    const storedReceipts =
      rule.actor_member_id === ctx.actor.id
        ? (
            await ctx.db
              .prepare(
                "SELECT action_index AS actionIndex,target_id AS targetId,state,receipt_json AS receipt FROM automation_action_receipts WHERE run_id=? ORDER BY action_index,target_id",
              )
              .bind(row.id)
              .all<{
                actionIndex: number;
                targetId: string;
                state: string;
                receipt: string;
              }>()
          ).results
        : [];
    const receipts = [];
    const currentAccess = new Map<string, boolean>();
    const canRead = async (pageId: string) => {
      if (!currentAccess.has(pageId)) {
        try {
          await requirePageLevel(ctx, pageId, "view");
          currentAccess.set(pageId, true);
        } catch (e) {
          if (!(e instanceof ApiProblem) || e.status !== 404) throw e;
          currentAccess.set(pageId, false);
        }
      }
      return currentAccess.get(pageId)!;
    };
    for (const stored of storedReceipts) {
      const targetReadable = !stored.targetId || await canRead(stored.targetId);
      const receipt = JSON.parse(stored.receipt);
      if (stored.state === "skipped") {
        // A skipped action is still a visible outcome. Its target and payload
        // must not reveal a page the actor can no longer read.
        receipts.push({ ...stored, targetId: targetReadable ? stored.targetId : "", receipt: {
          code: receipt.code,
          message: "Action skipped because current access does not permit it.",
        } });
      } else if (targetReadable) {
        const resultPage = receipt?.receipt?.entity?.kind === "page" ? receipt.receipt.entity.id : undefined;
        if (!resultPage || await canRead(resultPage)) receipts.push({ ...stored, receipt });
      }
    }
    items.push({
      ...row,
      records_json: JSON.stringify(readable),
      trigger_json: JSON.stringify(trigger),
      receipts,
    });
  }
  return { items };
}

/** Delegated literal payloads belong to the actor, and remain gated by current destinations. */
export async function authorizeDefinition(ctx: FeatureContext, rule: RuleRow) {
  if (rule.actor_member_id !== ctx.actor.id) throw new ApiProblem(403,"RULE_AUDIENCE","Rule definitions are private to their delegated actor.");
  for (const action of JSON.parse(rule.actions_json)) await assertActionScope(ctx,rule,action);
}
