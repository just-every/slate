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

  // Layout recovery still relies on server-side field, authority and lock checks.
  const base = `/api/databases/${body.value.id}`;
  const call = async (method: string, path: string, actor = cookie, input?: unknown) => {
    const response = await SELF.fetch("http://localhost" + path, {
      method, headers: {cookie: actor, origin: "http://localhost", "content-type": "application/json"},
      ...(input ? {body: JSON.stringify(input)} : {}),
    });
    return {status: response.status, body: await response.json() as any};
  };
  const structure = async () => (await call("GET", base)).body;
  const blank = await structure();
  const makeView = (layout: string) => ({
    id: `layout-${layout}`, name: layout, layout, filters: [], sorts: [], groups: [],
    calculations: {}, display: {}, position: 0,
  });
  for (const layout of ["board", "calendar", "timeline"]) {
    const refused = await call("POST", base + "/views", cookie, {
      operationKey: `case:missing-${layout}`, expectedRevisionId: blank.database.revision_id, view: makeView(layout),
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("FIELD_REQUIRED");
    expect(await structure()).toEqual(blank);
  }
  const fields = [
    {id: "stage", name: "Stage", type: "select", config: {options: ["Open", "Done"]}, position: 0},
    {id: "due", name: "Due date", type: "date", config: {}, position: 1},
  ];
  for (const field of fields) {
    const current = await structure();
    const saved = await call("POST", base + "/fields", cookie, {
      operationKey: `case:create-${field.id}`, expectedRevisionId: current.database.revision_id, field,
    });
    expect(saved.status).toBeLessThan(300);
  }
  const record = (await call("POST", base + "/records", cookie, {
    operationKey: "case:layout-record", title: "Response planning", values: {stage: "Open", due: "2026-03-15"},
  })).body.value;
  const recordBefore = (await call("GET", base + "/records/" + record.pageId)).body;
  for (const [position, layout] of ["table", "board", "list", "gallery", "calendar", "timeline"].entries()) {
    const current = await structure();
    const view = {...makeView(layout), position,
      groups: layout === "board" ? [{field: "stage", hideEmpty: false}] : [],
      display: ["calendar", "timeline"].includes(layout) ? {dateField: "due"} : {},
    };
    const saved = await call("POST", base + "/views", cookie, {
      operationKey: `case:valid-${layout}`, expectedRevisionId: current.database.revision_id, view,
    });
    expect(saved.status).toBeLessThan(300);
    const query = (await call("GET", base + "/views/" + view.id)).body;
    expect(query.view.layout).toBe(layout);
    expect(query.view.groups).toEqual(view.groups);
    expect(query.view.display).toEqual(view.display);
    expect(query.records.map((item: {pageId: string}) => item.pageId)).toEqual([record.pageId]);
    expect(query.records[0].values).toEqual({stage: "Open", due: "2026-03-15"});
  }
  expect((await call("GET", base + "/records/" + record.pageId)).body).toEqual(recordBefore);
  await seedContainerGrant(containerId, {principalKind: "member", principalId: reader.actor.id, level: "view"});
  const viewer = await sessionFor(reader.actor.id);
  const beforeDenied = await structure();
  for (const [suffix, input] of [
    ["/fields", {field: {...fields[0], name: "Denied rename"}}],
    ["/views", {view: {...makeView("list"), name: "Denied rename"}}],
  ] as const) {
    const denied = await call("POST", base + suffix, viewer, {
      operationKey: `case:denied-${suffix.slice(1)}`, expectedRevisionId: beforeDenied.database.revision_id, ...input,
    });
    expect(denied.status).toBe(404);
    expect(await structure()).toEqual(beforeDenied);
  }
  expect((await call("POST", base + "/lock", cookie, {
    operationKey: "case:layout-lock", expectedRevisionId: beforeDenied.database.revision_id, locked: true,
  })).status).toBeLessThan(300);
  const locked = await structure();
  for (const [suffix, input] of [
    ["/fields", {field: {...fields[1], name: "Locked rename"}}],
    ["/views", {view: {...makeView("list"), name: "Locked rename"}}],
  ] as const) {
    const refused = await call("POST", base + suffix, cookie, {
      operationKey: `case:locked-${suffix.slice(1)}`, expectedRevisionId: locked.database.revision_id, ...input,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("STRUCTURE_LOCKED");
    expect(await structure()).toEqual(locked);
  }
  expect((await call("GET", base + "/records/" + record.pageId)).body).toEqual(recordBefore);
});

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
