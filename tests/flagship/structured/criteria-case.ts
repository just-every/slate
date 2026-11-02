import { expect } from "vitest";
import type { Field, Filter, Values } from "../../../src/core/features/databases/values";
import type { View } from "../../../src/core/features/databases/views";

type HttpCall = (
  method: string,
  path: string,
  actor?: string,
  data?: unknown,
) => Promise<{ status: number; body: any }>;

// Invoked by the existing native Worker journey: all product state below is
// written and read through SELF, against its real D1 and R2 bindings.
export async function savedCriteriaCase(input: {
  call: HttpCall;
  ownerCookie: string;
  memberCookie: string;
  ownerId: string;
  memberId: string;
  ownerEmail: string;
  containerId: string;
}) {
  const { call, ownerCookie, memberCookie, ownerId, memberId, ownerEmail, containerId } = input;
  let operation = 0;
  const operationKey = () => `synthetic-slate-${++operation}`;
  const read = async (path: string, actor = ownerCookie) => {
    const result = await call("GET", path, actor);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  };
  const write = async (path: string, data: object, actor = ownerCookie) => {
    const result = await call("POST", path, actor, { operationKey: operationKey(), ...data });
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
    return result.body.value;
  };
  const related = await write("/databases", { containerId, title: "Criteria relation source" });
  const relatedBase = `/databases/${related.id}`;
  await write(`${relatedBase}/fields`, {
    expectedRevisionId: related.revisionId,
    field: { id: "synthetic-slate-related-number", name: "Related number", type: "number", config: {}, position: 0 },
  });
  const target = await write(`${relatedBase}/records`, {
    title: "Criteria related record", values: { "synthetic-slate-related-number": 4 },
  });
  const database = await write("/databases", { containerId, title: "Saved criteria" });
  const base = `/databases/${database.id}`;
  const id = (kind: string) => `synthetic-slate-${kind}`;
  const kinds: Field["type"][] = [
    "text", "number", "checkbox", "date", "select", "multi-select", "status",
    "person", "file", "url", "email", "phone", "place", "relation", "rollup",
    "formula", "created-at", "updated-at", "identifier",
  ];
  let revisionId = database.revisionId;
  for (const [position, type] of kinds.entries()) {
    const config = ["select", "multi-select", "status"].includes(type)
      ? { options: ["Ready", "Later", "Open", "Paused", "Closed"] }
      : type === "relation" ? { databaseId: related.id }
      : type === "rollup" ? { relationField: id("relation"), targetField: "synthetic-slate-related-number", calculation: "sum" }
      : type === "formula" ? { expression: { op: "multiply", args: [{ field: id("number") }, { literal: 2 }] } }
      : {};
    revisionId = (await write(`${base}/fields`, {
      expectedRevisionId: revisionId, field: { id: id(type), name: type, type, config, position },
    })).revisionId;
  }

  // Use the native multipart upload door for the file-valued criterion.
  const { SELF } = await import("cloudflare:test");
  const form = new FormData();
  form.set("operationKey", operationKey());
  form.set("pageId", database.pageId);
  form.set("file", new File(["synthetic-slate-1"], "synthetic-slate-1.txt", { type: "text/plain" }));
  const upload = await SELF.fetch("http://localhost/api/media", {
    method: "POST", headers: { cookie: ownerCookie, origin: "http://localhost" }, body: form,
  });
  expect(upload.status).toBe(200);
  const file = (await upload.json() as { value: { id: string } }).value;

  const common: Values = {
    [id("text")]: "keep this record", [id("checkbox")]: true,
    [id("select")]: "Ready", [id("multi-select")]: ["Ready", "Later"],
    [id("status")]: "Open", [id("person")]: [ownerId], [id("file")]: [file.id],
    [id("url")]: "https://example.invalid/synthetic-slate-1", [id("email")]: ownerEmail,
    [id("phone")]: "synthetic-slate-1", [id("place")]: "North room",
    [id("relation")]: [target.pageId],
  };
  const early = "2026-05-31T23:00:00Z";
  const offsetEarly = "2026-06-01T01:00:00+02:00";
  const fixtures = [
    { title: "Alpha", values: { ...common, [id("number")]: 20, [id("date")]: early } },
    { title: "Zulu", values: { ...common, [id("number")]: 10, [id("date")]: early } },
    { title: "Bravo", values: { ...common, [id("number")]: 10, [id("date")]: offsetEarly } },
    { title: "Bravo", values: { ...common, [id("number")]: 10, [id("date")]: early } },
    { title: "Gamma", values: { ...common, [id("number")]: 10, [id("date")]: "2026-06-01T00:00:00Z" } },
    { title: "Delta", values: { ...common, [id("number")]: 30, [id("date")]: early, [id("select")]: "Later", [id("status")]: "Paused" } },
    { title: "Excluded", values: {
      [id("text")]: "excluded", [id("number")]: 10, [id("checkbox")]: false,
      [id("date")]: "2027-01-01T00:00:00Z", [id("select")]: "Ready",
      [id("multi-select")]: ["Later"], [id("status")]: "Closed", [id("person")]: [memberId],
      [id("file")]: [], [id("url")]: "https://example.invalid/synthetic-slate-2",
      [id("email")]: null, [id("phone")]: "synthetic-slate-2", [id("place")]: "South room", [id("relation")]: [],
    } },
    { title: "Empty", values: {} },
  ];
  const records: { pageId: string }[] = [];
  for (const fixture of fixtures) records.push(await write(`${base}/records`, fixture));
  const ids = (indexes: number[]) => indexes.map(index => records[index]!.pageId).sort();
  const snapshots = () => Promise.all(records.map(record => read(`${base}/records/${record.pageId}`)));
  const before = await snapshots();
  const main = [0, 1, 2, 3, 4, 5];
  const probes: { kind: Field["type"]; op: Filter["op"]; value: unknown; indexes: number[] }[] = [
    { kind: "text", op: "contains", value: "keep", indexes: main },
    { kind: "number", op: "lte", value: 20, indexes: [0, 1, 2, 3, 4, 6] },
    { kind: "checkbox", op: "eq", value: true, indexes: main },
    { kind: "date", op: "lt", value: "2026-06-01T01:00:00Z", indexes: main },
    { kind: "select", op: "eq", value: "Ready", indexes: [0, 1, 2, 3, 4, 6] },
    { kind: "multi-select", op: "contains", value: "Ready", indexes: main },
    { kind: "status", op: "eq", value: "Open", indexes: [0, 1, 2, 3, 4] },
    { kind: "person", op: "contains", value: ownerId, indexes: main },
    { kind: "file", op: "contains", value: file.id, indexes: main },
    { kind: "url", op: "contains", value: "synthetic-slate-1", indexes: main },
    { kind: "email", op: "eq", value: ownerEmail, indexes: main },
    { kind: "phone", op: "eq", value: "synthetic-slate-1", indexes: main },
    { kind: "place", op: "contains", value: "North", indexes: main },
    { kind: "relation", op: "contains", value: target.pageId, indexes: main },
    { kind: "rollup", op: "eq", value: 4, indexes: main },
    { kind: "formula", op: "lte", value: 40, indexes: [0, 1, 2, 3, 4, 6] },
    ...(["created-at", "updated-at"] as const).map(kind => {
      const value = before[0]!.values[id(kind)];
      expect(typeof value).toBe("string");
      return { kind, op: "eq" as const, value,
        indexes: before.flatMap((snapshot, index) => snapshot.values[id(kind)] === value ? [index] : []) };
    }),
    { kind: "identifier", op: "eq", value: records[0]!.pageId, indexes: [0] },
  ];
  const view: View = {
    id: "synthetic-slate-criteria-view", name: "Saved criteria", layout: "table",
    filters: [], sorts: [], groups: [], calculations: {}, display: {}, position: 0,
  };
  const viewPath = `${base}/views/${view.id}`;
  const save = async (next: View, actor = ownerCookie) => {
    const result = await write(`${base}/views`, { expectedRevisionId: revisionId, view: next }, actor);
    revisionId = result.revisionId;
    return result;
  };
  for (const probe of probes) {
    const next = { ...view, filters: [{ field: id(probe.kind), op: probe.op, value: probe.value }] };
    await save(next);
    const result = await read(viewPath);
    expect(result.view.filters, probe.kind).toEqual(next.filters);
    expect(result.records.map((record: any) => record.pageId), probe.kind).toEqual(ids(probe.indexes));
  }
  console.log('PROBE DB-005 field kinds: 19 native saved filter configurations and exact matching record sets passed');

  const criteria: View = {
    ...view,
    filters: [{ and: [
      { field: id("checkbox"), op: "eq", value: true },
      { or: [
        { and: [{ field: id("select"), op: "eq", value: "Ready" }, { field: id("number"), op: "lte", value: 20 }] },
        { and: [{ field: id("status"), op: "eq", value: "Paused" }, { field: id("date"), op: "lt", value: "2026-06-01T00:00:00Z" }] },
      ] },
    ] }],
    sorts: [{ field: id("number"), direction: "asc" }, { field: id("date"), direction: "asc" }, { field: "$title", direction: "desc" }],
  };
  await save(criteria);
  const expectedOrder = [
    records[1]!.pageId, ...ids([2, 3]), records[4]!.pageId, records[0]!.pageId, records[5]!.pageId,
  ];
  const ownerResult = await read(viewPath);
  expect(ownerResult.view).toEqual({ ...criteria, revisionId });
  expect(ownerResult.records.map((record: any) => record.pageId)).toEqual(expectedOrder);
  // A separately authorized native session observes the durable criteria and
  // exact order, including the final stable record-id tie breaker.
  const grant = await write("/sharing", { targetKind: "page", targetId: database.pageId, principalKind: "member", principalId: memberId, level: "view" });
  await write("/sharing", { targetKind: "page", targetId: related.pageId, principalKind: "member", principalId: memberId, level: "view" });
  const memberResult = await read(viewPath, memberCookie);
  expect(memberResult.view).toEqual(ownerResult.view);
  expect(memberResult.records).toEqual(ownerResult.records);
  expect((await read(base, memberCookie)).views).toEqual([{ ...criteria, revisionId }]);

  const attempted = { operationKey: operationKey(), expectedRevisionId: revisionId, view: { ...criteria, filters: [], sorts: [] } };
  expect((await call("POST", `${base}/views`, memberCookie, attempted)).status).toBe(404);
  expect(await read(viewPath)).toEqual(ownerResult);
  expect(await snapshots()).toEqual(before);

  // Capture a successful editor request, clear both criteria in one mutation,
  // then revoke authority and replay that exact previously successful request.
  await write("/sharing", { id: grant.id, targetKind: "page", targetId: database.pageId, principalKind: "member", principalId: memberId, level: "edit" });
  const captured = { operationKey: operationKey(), expectedRevisionId: revisionId, view: criteria };
  const capturedSave = await call("POST", `${base}/views`, memberCookie, captured);
  expect(capturedSave.status, JSON.stringify(capturedSave.body)).toBe(200);
  revisionId = capturedSave.body.value.revisionId;
  const cleared = { ...criteria, filters: [], sorts: [] };
  await save(cleared);
  const clearedResult = await read(viewPath);
  expect(clearedResult.view).toEqual({ ...cleared, revisionId });
  expect(clearedResult.records.map((record: any) => record.pageId)).toEqual(ids([0, 1, 2, 3, 4, 5, 6, 7]));
  expect((await read(viewPath, memberCookie)).view).toEqual(clearedResult.view);
  expect(await snapshots()).toEqual(before);
  await write("/sharing", { id: grant.id, targetKind: "page", targetId: database.pageId, principalKind: "member", principalId: memberId, level: "edit", revoke: true });
  const revokedSnapshot = await read(viewPath);
  const revokedDatabase = await read(base);
  expect((await call("GET", viewPath, memberCookie)).status).toBe(404);
  expect((await call("POST", `${base}/views`, memberCookie, captured)).status).toBe(404);
  expect(await read(viewPath)).toEqual(revokedSnapshot);
  expect(await read(base)).toEqual(revokedDatabase);
  expect(await snapshots()).toEqual(before);
  console.log('PROBE DB-005 authority and clear: exact shared configuration and order, viewer refusal, combined clear and revoked replay preserve all eight records');
}
