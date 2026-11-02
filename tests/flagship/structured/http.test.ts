import { env } from "cloudflare:test";
import { beforeEach, test, expect } from "vitest";
import { resetDeployment } from "../../e2e/setup/reset-deployment";
import {
  seedWorkspace,
  seedMember,
  seedContainer,
  seedContainerGrant,
} from "../../e2e/setup/fixtures";
import type { FeatureContext } from "../../../src/core/app/feature-context";
import { savedCriteriaCase } from "./criteria-case";

// Keep SELF module loading isolated from direct-service request contexts.
beforeEach(resetDeployment);

async function scenario() {
  const { workspaceId } = await seedWorkspace();
  const { memberId } = await seedMember(workspaceId, {
    role: "owner",
    email: `${workspaceId}@owner.invalid`,
    displayName: "Owner",
  });
  const { memberId: readerId } = await seedMember(workspaceId, {
    role: "member",
    email: `${workspaceId}@reader.invalid`,
    displayName: "Reader",
  });
  const { containerId } = await seedContainer(workspaceId, {
    ownerMemberId: memberId,
    visibility: "default",
  });
  await seedContainerGrant(containerId, {
    principalKind: "member",
    principalId: memberId,
    level: "full",
  });
  const ctx = {
    db: env.DB,
    files: env.FILES,
    jobs: env.JOBS,
    now: new Date().toISOString(),
    actor: {
      id: memberId,
      workspaceId,
      workspaceName: "Test",
      email: "owner@test.invalid",
      displayName: "Owner",
      initials: "OW",
      role: "owner",
    },
  } as FeatureContext;
  return {
    ctx,
    containerId,
    reader: {
      ...ctx,
      actor: { ...ctx.actor, id: readerId, role: "member" as const },
    },
  };
}

test("Worker HTTP rejects missing expired revoked and denied sessions and persists authorized input", async () => {
  const { SELF } = await import("cloudflare:test");
  const { sessionFor } = await import("../../e2e/setup/fixtures");
  const { ctx, containerId, reader } = await scenario();
  const input = {
    operationKey: "case:031",
    containerId,
    title: "HTTP database",
  };
  const send = (cookie?: string) =>
    SELF.fetch("http://localhost/api/databases", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(input),
    });
  expect((await send()).status).toBe(401);
  expect(
    (
      await send(
        await sessionFor(ctx.actor.id, { expiresAt: "2020-01-01T00:00:00Z" }),
      )
    ).status,
  ).toBe(401);
  expect(
    (await send(await sessionFor(ctx.actor.id, { revokedAt: ctx.now }))).status,
  ).toBe(401);
  expect((await send(await sessionFor(reader.actor.id))).status).toBe(404);
  const cookie = await sessionFor(ctx.actor.id),
    response = await send(cookie);
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    value: {
      id: string;
    };
  };
  const read = await SELF.fetch(
    `http://localhost/api/databases/${body.value.id}`,
    { headers: { cookie } },
  );
  expect(read.status).toBe(200);
  expect(
    (
      (await read.json()) as {
        database: {
          id: string;
        };
      }
    ).database.id,
  ).toBe(body.value.id);

  // Follow the same native session into a populated record, including the
  // allowed edit, computed-field refusal and subsequent viewer downgrade.
  const call = async (method: string, path: string, actor = cookie, data?: unknown) => {
    const response = await SELF.fetch(`http://localhost/api${path}`, {
      method, headers: {cookie: actor, origin: "http://localhost", "content-type": "application/json"},
      ...(data ? {body: JSON.stringify(data)} : {}),
    });
    return {status: response.status, body: await response.json() as any};
  };
  let operation = 0;
  const mutate = async (method: string, path: string, data: object, actor = cookie) => {
    const result = await call(method, path, actor, {operationKey: `case:record-detail-${++operation}`, ...data});
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
    return result.body.value;
  };
  const base = `/databases/${body.value.id}`;
  const definitions = [
    {id: "notes", name: "Notes", type: "text", config: {}, position: 2},
    {id: "quantity", name: "Quantity", type: "number", config: {}, position: 0},
    {id: "double", name: "Double quantity", type: "formula", config: {expression: {op: "multiply", args: [{field: "quantity"}, {literal: 2}]}}, position: 1},
    {id: "created", name: "Created", type: "created-at", config: {}, position: 3},
    {id: "updated", name: "Updated", type: "updated-at", config: {}, position: 4},
    {id: "identifier", name: "Record identifier", type: "identifier", config: {}, position: 5},
  ];
  let structure = (await call("GET", base)).body.database.revision_id;
  for (const field of definitions) structure = (await mutate("POST", base + "/fields", {expectedRevisionId: structure, field})).revisionId;
  const record = await mutate("POST", base + "/records", {title: "Populated record", values: {notes: "Retained notes", quantity: 7}});
  const recordPath = base + "/records/" + record.pageId;
  await mutate("PUT", `/pages/${record.pageId}/blocks`, {expectedRevisionId: record.revisionId,
    blocks: [{id: "record-body", blockType: "paragraph", treePosition: "a", content: {text: [{text: "Original retained record body"}]}}]});
  const earlier = (await call("GET", recordPath)).body;
  await mutate("POST", `/comments/page/${record.pageId}`, {body: [{text: "Retained record discussion"}]});
  await mutate("POST", "/sharing", {targetKind: "page", targetId: (await call("GET", base)).body.database.page_id, principalKind: "member", principalId: reader.actor.id, level: "edit"});
  const memberCookie = await sessionFor(reader.actor.id);
  const opened = (await call("GET", recordPath, memberCookie)).body;
  expect(opened.fields.map((field: any) => field.id)).toEqual(["quantity", "double", "notes", "created", "updated", "identifier"]);
  expect(opened.fields.filter((field: any) => field.editable).map((field: any) => field.id)).toEqual(["quantity", "notes"]);
  expect(opened.values).toMatchObject({quantity: 7, double: 14, notes: "Retained notes", identifier: record.pageId});
  const edit = {operationKey: "case:record-inline-edit", expectedRevisionId: opened.revisionId, values: {quantity: 11}};
  expect((await call("PATCH", recordPath, memberCookie, edit)).status).toBe(200);
  const edited = (await call("GET", recordPath, memberCookie)).body;
  expect(edited.values).toMatchObject({quantity: 11, double: 22, notes: "Retained notes"});
  for (const values of [{double: 99}, {created: "2026-01-01"}, {updated: "2026-01-01"}, {identifier: "other-record"}]) {
    const denied = await call("PATCH", recordPath, memberCookie, {operationKey: `case:readonly-${++operation}`, expectedRevisionId: edited.revisionId, values});
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe("double" in values ? "COMPUTED_FIELD" : "READ_ONLY_FIELD");
    expect((await call("GET", recordPath, memberCookie)).body).toEqual(edited);
  }
  const dbPage = (await call("GET", base)).body.database.page_id;
  const memberGrant = (await call("GET", `/sharing/pages/${dbPage}`)).body.items.find((item: any) => item.principalId === reader.actor.id);
  await mutate("POST", "/sharing", {id: memberGrant.id, targetKind: "page", targetId: dbPage, principalKind: "member", principalId: reader.actor.id, level: "view"});
  const viewer = (await call("GET", recordPath, memberCookie)).body;
  expect(viewer.fields.every((field: any) => !field.editable)).toBe(true);
  expect(viewer.values).toEqual(edited.values);
  const history = (await call("GET", `/revisions/${record.pageId}`, memberCookie)).body;
  expect(history.items.some((item: any) => item.id === earlier.revisionId)).toBe(true);
  const exact = (await call("GET", `/revisions/${record.pageId}/${earlier.revisionId}`, memberCookie)).body;
  expect(exact.properties.databaseFields.quantity).toBe(7);
  expect(exact.blocks[0].content.text[0].text).toBe("Original retained record body");
  expect((await call("GET", `/comments/page/${record.pageId}`, memberCookie)).body.comments[0].body[0].text).toBe("Retained record discussion");
  expect((await call("PATCH", recordPath, memberCookie, {...edit, operationKey: "case:viewer-record-write", expectedRevisionId: viewer.revisionId, values: {quantity: 99}})).status).toBe(404);
  expect((await call("PATCH", recordPath, memberCookie, edit)).status).toBe(404);
  expect((await call("GET", recordPath, memberCookie)).body).toEqual(viewer);
  expect((await call("GET", `/revisions/${record.pageId}`)).body).toEqual(history);
  const workspace = (await call("GET", "/workspace")).body;
  for (const parity of ["record-is-row", "record-is-page"]) {
    const current = (await call("GET", "/workspace")).body;
    const {name, mark, description, guestAccess, publicLinkAccess, anonymousAccess} = current;
    await mutate("PUT", "/workspace", {expectedRevisionId: current.revisionId, name, mark, description, guestAccess, publicLinkAccess, anonymousAccess,
      policies: {...workspace.policies, "record.page-parity.v1": parity}});
    const retained = (await call("GET", recordPath, memberCookie)).body;
    expect(retained.parity).toBe(parity);
    expect(retained.presentation.body).toBe(parity === "record-is-page");
    expect(retained.page.blocks).toEqual(edited.page.blocks);
    expect(retained.values).toEqual(edited.values);
  }
  await savedCriteriaCase({ call, ownerCookie: cookie, memberCookie,
    ownerId: ctx.actor.id, memberId: reader.actor.id, ownerEmail: ctx.actor.email, containerId });
}, 120_000);

test("database file references list only attachments the reader could open", async () => {
  const { SELF } = await import("cloudflare:test");
  const { sessionFor } = await import("../../e2e/setup/fixtures");
  const { createPage } = await import("../../../src/core/features/pages/service");
  const { uploadMedia } = await import("../../../src/core/features/media/service");
  const { ctx, containerId, reader } = await scenario();
  await seedContainerGrant(containerId, { principalKind: "member", principalId: reader.actor.id, level: "view" });
  const owner = await sessionFor(ctx.actor.id), viewer = await sessionFor(reader.actor.id);
  const call = async (method: string, path: string, cookie: string, body?: unknown) => {
    const response = await SELF.fetch(`http://localhost/api${path}`, { method, headers: { cookie, origin: "http://localhost", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, text, data: text ? JSON.parse(text) : null };
  };
  const db = (await call("POST", "/databases", owner, { operationKey: "case:file-references-db", containerId, title: "Vendor files" })).data.value;
  expect((await call("POST", `/databases/${db.id}/fields`, owner, { operationKey: "case:file-references-field", expectedRevisionId: db.revisionId, field: { id: "attachment", name: "Attachment", type: "file", config: {}, position: 0 } })).status).toBeLessThan(300);
  const page = await createPage(ctx, { operationKey: "case:file-references-page", containerId, title: "Vendor notes" });
  const hidden = await uploadMedia(ctx, { operationKey: "case:file-references-upload", pageId: page.value.pageId, name: "unreleased-pricing.txt", contentType: "text/plain", bytes: new TextEncoder().encode("synthetic-slate-unreleased") });
  expect((await call("GET", `/media/${hidden.value.id}`, viewer)).status).toBe(404);
  const options = await call("GET", `/databases/${db.id}/references/attachment`, viewer);
  expect(options.status, options.text).toBe(200);
  expect(options.text).not.toContain("unreleased-pricing.txt");
  const resolved = await call("POST", "/databases/references", viewer, { fileIds: [hidden.value.id] });
  expect(resolved.status, resolved.text).toBe(200);
  expect(resolved.text).not.toContain("unreleased-pricing.txt");
  expect((await call("GET", `/databases/${db.id}/references/attachment`, owner)).text).toContain("unreleased-pricing.txt");
});
