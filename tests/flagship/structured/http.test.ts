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
  // The same native session door serves persisted calculations only after
  // current record access and the saved filter have both been applied.
  const base = `/api/databases/${body.value.id}`;
  const call = async (method: string, path: string, session: string, input?: unknown) => {
    const response = await SELF.fetch('http://localhost' + path, {
      method, headers: { cookie: session, origin: 'http://localhost', 'content-type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return response.json() as Promise<any>;
  };
  let revision = (await call('GET', base, cookie)).database.revision_id;
  for (const field of [
    { id: 'amount', name: 'Amount', type: 'number', config: {}, position: 0 },
    { id: 'included', name: 'Included', type: 'checkbox', config: {}, position: 1 },
  ]) revision = (await call('POST', base + '/fields', cookie, { operationKey: crypto.randomUUID(), expectedRevisionId: revision, field })).value.revisionId;
  const readerSession = await sessionFor(reader.actor.id);
  const grantInput = { operationKey: crypto.randomUUID(), targetKind: 'page', targetId: (await call('GET', base, cookie)).database.page_id, principalKind: 'member', principalId: reader.actor.id, level: 'view' };
  const granted = await call('POST', '/api/sharing', cookie, grantInput);
  const records: string[] = [];
  for (const [amount, included] of [[0, true], [6, true], [null, true], [-2, true], [8, true], [900, false]]) {
    const record = await call('POST', base + '/records', cookie, { operationKey: crypto.randomUUID(), title: 'synthetic-slate-' + records.length, values: { amount, included } });
    records.push(record.value.pageId);
  }
  const privatePage = await call('GET', '/api/pages/' + records[4], cookie);
  await call('POST', '/api/sharing', cookie, { operationKey: crypto.randomUUID(), targetKind: 'page', targetId: records[4], principalKind: 'member', principalId: ctx.actor.id, level: 'full' });
  await call('PUT', `/api/sharing/pages/${records[4]}/inheritance`, cookie, { operationKey: crypto.randomUUID(), expectedRevisionId: privatePage.page.revisionId, restricted: true });
  const view = { id: 'calculation-view', name: 'Included', layout: 'table', filters: [{ field: 'included', op: 'eq', value: true }], sorts: [], groups: [], display: {}, position: 0 };
  for (const [operation, ownerTotal, readerTotal] of [
    ['count', 5, 4], ['filled', 4, 3], ['empty', 1, 1], ['sum', 12, 4],
    ['average', 3, 4 / 3], ['minimum', -2, -2], ['maximum', 8, 6], ['range', 10, 8], ['percent', 80, 75],
  ] as const) {
    revision = (await call('POST', base + '/views', cookie, { operationKey: crypto.randomUUID(), expectedRevisionId: revision, view: { ...view, calculations: { amount: operation } } })).value.revisionId;
    for (const [session, total, ids] of [[cookie, ownerTotal, records.slice(0, 5)], [readerSession, readerTotal, records.slice(0, 4)]] as const) {
      const result = await call('GET', base + '/views/' + view.id, session);
      expect(result.records.map((item: { pageId: string }) => item.pageId).sort()).toEqual([...ids].sort());
      expect(result.calculations.amount).toBe(total);
      expect(result.view.calculations.amount).toBe(operation);
    }
  }
  const before = await call('GET', base + '/records/' + records[0], cookie);
  const refused = await SELF.fetch('http://localhost' + base + '/records/' + records[0], { method: 'PATCH', headers: { cookie: readerSession, origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ operationKey: crypto.randomUUID(), expectedRevisionId: before.revisionId, values: { amount: 100 } }) });
  expect(refused.status).toBe(404);
  expect(await call('GET', base + '/records/' + records[0], cookie)).toEqual(before);
  await call('POST', '/api/sharing', cookie, { ...grantInput, operationKey: crypto.randomUUID(), id: granted.value.id, revoke: true });
  await call('POST', '/api/sharing', cookie, grantInput);
  const revoked = await SELF.fetch('http://localhost' + base + '/views/' + view.id, { headers: { cookie: readerSession } });
  expect(revoked.status).toBe(404);
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
