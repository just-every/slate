import { expect } from "vitest";
import { env, fixture, createUlid } from "../../qualification/backend/fixture";
import { runAutomationMaintenance } from "../../../src/core/features/automation/events";
import { scheduledDiscovery } from "../../../src/core/features/notifications/jobs";
import type { FeatureContext } from "../../../src/core/app/feature-context";

/** Native sessions, HTTP commands, committed outbox and native effect adapters. */
export async function automationHttpAuthority() {
  const previous = env.SLATE_PROFILE;
  env.SLATE_PROFILE = "core-wiki";
  try {
    const f = await fixture();
    // Match the local native scheduler's Notify people admission, without an external provider.
    f.ctx.localDevelopment = true;
    const call = async (method: string, path: string, input?: unknown, actor = f.ownerId) => {
      const response = await f.request(method, path, input, actor);
      expect(response.status, JSON.stringify(response)).toBeGreaterThanOrEqual(200);
      expect(response.status, JSON.stringify(response)).toBeLessThan(300);
      return response.data;
    };
    const grant = (targetId: string, level: string, id?: string, revoke = false) =>
      call("POST", "/api/sharing", { operationKey: createUlid(), targetKind: "page", targetId,
        principalKind: "member", principalId: f.readerId, level, id, revoke });
    const db = (await call("POST", "/api/databases", {
      operationKey: createUlid(), containerId: f.containerId, title: "synthetic-slate-authority",
    })).value;
    await call("POST", `/api/databases/${db.id}/fields`, {
      operationKey: createUlid(), expectedRevisionId: db.revisionId,
      field: { id: "synthetic-slate-number", name: "Count", type: "number", config: {}, position: 0 },
    });
    await grant(db.pageId, "edit");
    const ruleInput = {
      name: "synthetic-slate-actor", scope: "source", sourceDatabaseId: db.id,
      trigger: { event: "record-created" }, conditions: [],
      actions: [
        { type: "edit-fields", values: { "synthetic-slate-number": 2 } },
        { type: "comment", body: "synthetic-slate-allowed-comment" },
        { type: "notify", recipientMemberIds: [f.ownerId], message: "synthetic-slate-notice" },
        { type: "archive" },
      ],
    };
    const rule = (await call("POST", "/api/automation", {
      ...ruleInput, operationKey: createUlid(),
    }, f.readerId)).value;
    expect((await call("GET", "/api/automation", undefined, f.readerId)).items[0])
      .toMatchObject({ id: rule.id, actor_member_id: f.readerId });
    const snapshot = async () => {
      const tables = ["pages", "page_revisions", "page_grants", "container_grants", "containers", "workspaces",
        "members", "automation_rules", "automation_runs", "automation_jobs", "operation_receipts", "activity_entries"];
      return Promise.all(tables.map(async table => (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
    };
    const before = await snapshot();
    for (const type of ["publish", "unpublish", "grant", "external-access", "verify", "permanent-delete", "manage-members"]) {
      for (const actor of [f.readerId, f.ownerId]) {
        const refused = await f.request("POST", "/api/automation", {
          ...ruleInput, operationKey: createUlid(), actions: [{ type, pageId: db.pageId, memberId: f.readerId }],
        }, actor);
        expect(refused.status, type).toBe(400);
      }
    }
    expect(await snapshot()).toEqual(before);
    console.info("PROBE AUTO-002 1: native rule admission as member and owner -> seven privileged action families refused 400; canonical state unchanged");

    const record = async () => {
      const created = await call("POST", `/api/databases/${db.id}/records`, {
        operationKey: createUlid(), title: "synthetic-slate-target", values: { "synthetic-slate-number": 1 },
      });
      const id = created.value.pageId;
      const published = await call("POST", `/api/pages/${id}/publish`, {
        operationKey: createUlid(), expectedRevisionId: created.value.revisionId,
      });
      await call("POST", "/api/sharing", { operationKey: createUlid(), targetKind: "page", targetId: id,
        principalKind: "member", principalId: f.ownerId, level: "full" });
      await call("PUT", `/api/sharing/pages/${id}/inheritance`, {
        operationKey: createUlid(), expectedRevisionId: published.value.revisionId, restricted: true,
      });
      const access = await grant(id, "edit");
      return { id, grantId: access.value.id };
    };
    const log = async (id: string) => (await call("GET", `/api/automation/${rule.id}/runs`, undefined, f.readerId))
      .items.find((run: any) => JSON.parse(run.trigger_json).pageId === id);
    const receipts = async (runId: string) => (await env.DB.prepare(
      "SELECT action_index,state,receipt_json FROM automation_action_receipts WHERE run_id=? ORDER BY action_index",
    ).bind(runId).all<{ action_index: number; state: string; receipt_json: string }>()).results;
    const document = (id: string) => call("GET", `/api/databases/${db.id}/records/${id}`);
    const comments = async (id: string) => (await call("GET", `/api/comments/page/${id}`)).comments;
    const successful = await record();
    // The actor can do the same field edit and comment by hand before delegating.
    await call("PATCH", `/api/databases/${db.id}/records/${successful.id}`, {
      operationKey: createUlid(), expectedRevisionId: (await document(successful.id)).revisionId,
      values: { "synthetic-slate-number": 3 },
    }, f.readerId);
    await call("POST", `/api/comments/page/${successful.id}`, {
      operationKey: createUlid(), body: [{ text: "synthetic-slate-manual-comment" }],
    }, f.readerId);
    await runAutomationMaintenance({ ...f.ctx, now: new Date().toISOString() });
    await scheduledDiscovery(env);
    const allowed = await log(successful.id);
    expect(allowed.state).toBe("success");
    expect(allowed.actor_member_id).toBe(f.readerId);
    expect(allowed.receipts.map((r: any) => r.state)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"]);
    expect((await document(successful.id)).values["synthetic-slate-number"]).toBe(2);
    expect((await document(successful.id)).page.page.lifecycle).toBe("archived");
    expect((await comments(successful.id)).map((c: any) => JSON.stringify(c.body)))
      .toContain(JSON.stringify([{ text: "synthetic-slate-allowed-comment" }]));
    const canonical = await receipts(allowed.id);
    expect(allowed.receipts.map((r: any) => r.receipt)).toEqual(canonical.map(r => JSON.parse(r.receipt_json)));
    for (const r of canonical) {
      const receipt = JSON.parse(r.receipt_json).receipt;
      expect(await env.DB.prepare("SELECT id FROM activity_entries WHERE id=? AND actor_member_id=? AND operation_key=?")
        .bind(receipt.activityId, f.readerId, receipt.operationKey).first()).not.toBeNull();
    }
    const notificationRows = (await env.DB.prepare("SELECT * FROM notification_outbox WHERE event='maintenance'").all()).results;
    expect((await call("GET", "/api/notifications")).items
      .some((item: any) => item.pageId === successful.id && item.event === "maintenance"), JSON.stringify(notificationRows)).toBe(true);

    // Storage only supplies a deterministic pause after a real commit. Revocation is native HTTP.
    const pause = (condition: () => Promise<boolean>, change: () => Promise<unknown>): FeatureContext => {
      let changed = false;
      const db = new Proxy(f.ctx.db, { get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (!changed && await condition()) { changed = true; await change(); }
          return result;
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }});
      return { ...f.ctx, db, now: new Date().toISOString() };
    };
    const queued = await record();
    const queuedBefore = await document(queued.id);
    await runAutomationMaintenance(pause(async () => !!await env.DB.prepare(
      "SELECT id FROM automation_jobs WHERE state='queued' AND json_extract(payload_json,'$.event.pageId')=?",
    ).bind(queued.id).first(), () => grant(queued.id, "view", queued.grantId)));
    const skipped = await log(queued.id);
    expect(skipped.state).toBe("no-action");
    expect(skipped.receipts.map((r: any) => r.state)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect((await receipts(skipped.id)).map(r => r.state)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(await document(queued.id)).toEqual(queuedBefore);
    expect(await comments(queued.id)).toEqual([]);
    const manual = await f.request("POST", `/api/comments/page/${queued.id}`, {
      operationKey: createUlid(), body: [{ text: "synthetic-slate-refused" }],
    }, f.readerId);
    expect(manual.status).toBe(404);

    const hidden = await record();
    const hiddenBefore = await document(hidden.id);
    await runAutomationMaintenance(pause(async () => !!await env.DB.prepare(
      "SELECT id FROM automation_jobs WHERE state='queued' AND json_extract(payload_json,'$.event.pageId')=?",
    ).bind(hidden.id).first(), () => grant(hidden.id, "edit", hidden.grantId, true)));
    const hiddenRun = await env.DB.prepare("SELECT id,state FROM automation_runs WHERE rule_id=? AND json_extract(trigger_json,'$.pageId')=?")
      .bind(rule.id, hidden.id).first<{ id: string; state: string }>();
    expect(hiddenRun!.state).toBe("no-action");
    expect((await receipts(hiddenRun!.id)).map(r => r.state)).toEqual(["skipped", "skipped", "skipped", "skipped"]);
    expect(await document(hidden.id)).toEqual(hiddenBefore);
    expect(await comments(hidden.id)).toEqual([]);
    const hiddenLog = (await call("GET", `/api/automation/${rule.id}/runs`, undefined, f.readerId)).items
      .find((item: any) => item.id === hiddenRun!.id);
    expect(JSON.stringify(hiddenLog)).not.toContain(hidden.id);
    expect(hiddenLog.receipts.map((r: any) => r.state)).toEqual(["skipped", "skipped", "skipped", "skipped"]);

    const interrupted = await record();
    await runAutomationMaintenance(pause(async () => !!await env.DB.prepare(
      "SELECT id FROM operation_receipts WHERE actor_member_id=? AND target_id=? AND operation_key LIKE 'auto:%'",
    ).bind(f.readerId, interrupted.id).first(), () => grant(interrupted.id, "edit", interrupted.grantId, true)));
    const run = await env.DB.prepare("SELECT id,state FROM automation_runs WHERE rule_id=? AND json_extract(trigger_json,'$.pageId')=?")
      .bind(rule.id, interrupted.id).first<{ id: string; state: string }>();
    expect(run!.state).toBe("success");
    expect((await receipts(run!.id)).map(r => r.state)).toEqual(["confirmed", "skipped", "skipped", "skipped"]);
    expect((await document(interrupted.id)).values["synthetic-slate-number"]).toBe(2);
    expect((await document(interrupted.id)).page.page.lifecycle).not.toBe("archived");
    expect(await comments(interrupted.id)).toEqual([]);
    expect((await f.request("GET", `/api/pages/${interrupted.id}`, undefined, f.readerId)).status).toBe(404);
    const publicLog = (await call("GET", `/api/automation/${rule.id}/runs`, undefined, f.readerId)).items
      .find((item: any) => item.id === run!.id);
    expect(JSON.stringify(publicLog)).not.toContain(interrupted.id);
    expect(publicLog.receipts.map((r: any) => r.state)).toEqual(["skipped", "skipped", "skipped"]);
    const retained = await snapshot();
    const retainedReceipts = await receipts(run!.id);
    await runAutomationMaintenance({ ...f.ctx, now: new Date().toISOString() });
    await runAutomationMaintenance({ ...f.ctx, now: new Date().toISOString() });
    expect(await receipts(run!.id)).toEqual(retainedReceipts);
    expect(await snapshot()).toEqual(retained);
    const erased = await record();
    await runAutomationMaintenance(pause(async () => !!await env.DB.prepare(
      "SELECT id FROM automation_jobs WHERE state='queued' AND json_extract(payload_json,'$.event.pageId')=?",
    ).bind(erased.id).first(), () => call("POST", "/api/members/remove", {
      operationKey: createUlid(), memberId: f.readerId, erase: true,
    })));
    expect((await f.request("GET", "/api/automation", undefined, f.readerId)).status).toBe(401);
    expect((await document(erased.id)).values["synthetic-slate-number"]).toBe(1);
    expect(await comments(erased.id)).toEqual([]);
    const afterErasure = await snapshot();
    await runAutomationMaintenance({ ...f.ctx, now: new Date().toISOString() });
    expect(await snapshot()).toEqual(afterErasure);
    console.info("PROBE AUTO-002 2: native outbox as non-owner -> manual-equivalent effects confirmed; queued downgrade skips all effects; mid-run revocation keeps first effect and skips later effects; safe run log and replay agree with canonical receipts");
  } finally {
    env.SLATE_PROFILE = previous;
  }
}
