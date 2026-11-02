import { validateFormulas } from "./formulas";
import { recordValues } from "./evaluation";
export { recordValues } from "./evaluation";
import { validateFilter } from "./validation";
import type { FeatureContext } from "../../app/feature-context";
import { commitOperation, mutationGuard } from "../../app/operations";
import { ApiProblem } from "../../app/problems";
import { requirePageLevel } from "../sharing/current-access";
import { readPage } from "../pages/service";
import { database, fields, revision, unlocked } from "./repository";
import {
  evaluateFields,
  matches,
  compare,
  aggregate,
  type Filter,
  type Values,
} from "./values";
export interface View {
  id: string;
  name: string;
  layout: "table" | "board" | "list" | "gallery" | "calendar" | "timeline";
  filters: Filter[];
  sorts: {
    field: string;
    direction: "asc" | "desc";
  }[];
  groups: {
    field: string;
    hideEmpty?: boolean;
  }[];
  calculations: Record<string, string>;
  display: Record<string, unknown>;
  position: number;
}
export async function saveView(
  ctx: FeatureContext,
  id: string,
  input: {
    operationKey: string;
    expectedRevisionId: string;
    view: View;
    delete?: boolean;
  },
) {
  return commitOperation(ctx, {
    operationKey: input.operationKey,
    action: "databases.view",
    request: { id, ...input },
    authorize: async () => {
      unlocked(await database(ctx, id, "edit"));
    },
    prepare: async ({ revisionId }) => {
      const v = input.view,
        fs = await fields(ctx, id);
      if (
        !v.name ||
        !["table", "board", "list", "gallery", "calendar", "timeline"].includes(
          v.layout,
        )
      )
        throw new ApiProblem(400, "INVALID_VIEW", "Invalid view.");
      if (
        !Array.isArray(v.filters) ||
        !Array.isArray(v.sorts) ||
        !Array.isArray(v.groups) ||
        !v.calculations ||
        !v.display ||
        !Number.isInteger(v.position) ||
        v.position < 0
      )
        throw new ApiProblem(
          400,
          "INVALID_VIEW",
          "Invalid view configuration.",
        );
      for (const filter of v.filters) validateFilter(filter, fs);
      for (const [field, op] of Object.entries(v.calculations)) {
        if (!fs.some((f) => f.id === field))
          throw new ApiProblem(
            400,
            "UNKNOWN_FIELD",
            "Calculation field is missing.",
          );
        aggregate([], op);
        if (["sum","average","minimum","maximum","range"].includes(op) && validateFormulas(fs).get(field) !== "number")
          throw new ApiProblem(400,"CALCULATION_TYPE","This calculation requires a numeric field.");
      }
      for (const group of v.groups)
        if (
          !fs.some(
            (f) =>
              f.id === group.field &&
              ["select", "status", "person", "checkbox", "date"].includes(
                f.type,
              ),
          )
        )
          throw new ApiProblem(
            400,
            "INVALID_GROUP",
            "Choose a groupable field.",
          );
      if (v.layout === "board" && !v.groups.length)
        throw new ApiProblem(
          400,
          "FIELD_REQUIRED",
          "Create or select a grouping field.",
          { type: "status" },
        );
      if (
        ["calendar", "timeline"].includes(v.layout) &&
        !fs.some((f) => f.id === v.display.dateField && f.type === "date")
      )
        throw new ApiProblem(
          400,
          "FIELD_REQUIRED",
          "Create or select a date field.",
          { type: "date" },
        );
      for (const s of v.sorts)
        if (
          (s.field !== "$title" && !fs.some((f) => f.id === s.field)) ||
          !["asc", "desc"].includes(s.direction)
        )
          throw new ApiProblem(400, "INVALID_SORT", "Unknown sort.");
      const prior = await ctx.db
        .prepare("SELECT database_id FROM database_views WHERE id=?")
        .bind(v.id)
        .first<{
          database_id: string;
        }>();
      if (prior && prior.database_id !== id)
        throw new ApiProblem(
          409,
          "VIEW_ID_CONFLICT",
          "View identifier already exists.",
        );
      return {
        entity: { id, kind: "database", revisionId },
        value: { id, revisionId, view: v },
        statements: [
          mutationGuard(
            ctx.db,
            "SELECT revision_id=? AND structure_locked_at IS NULL FROM databases WHERE id=?",
            [input.expectedRevisionId, id],
          ),
          input.delete
            ? ctx.db
                .prepare(
                  "DELETE FROM database_views WHERE id=? AND database_id=?",
                )
                .bind(v.id, id)
            : ctx.db
                .prepare(
                  "INSERT INTO database_views (id,database_id,name,layout,filters_json,sorts_json,groups_json,calculations_json,display_json,position,created_at,updated_at,revision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,layout=excluded.layout,filters_json=excluded.filters_json,sorts_json=excluded.sorts_json,groups_json=excluded.groups_json,calculations_json=excluded.calculations_json,display_json=excluded.display_json,position=excluded.position,updated_at=excluded.updated_at,revision_id=excluded.revision_id",
                )
                .bind(
                  v.id,
                  id,
                  v.name,
                  v.layout,
                  JSON.stringify(v.filters),
                  JSON.stringify(v.sorts),
                  JSON.stringify(v.groups),
                  JSON.stringify(v.calculations),
                  JSON.stringify(v.display),
                  v.position,
                  ctx.now,
                  ctx.now,
                  revisionId,
                ),
          ctx.db
            .prepare(
              "UPDATE databases SET revision_id=?,updated_at=? WHERE id=?",
            )
            .bind(revisionId, ctx.now, id),
          revision(ctx, revisionId, "database-view", v.id, input),
        ],
      };
    },
  });
}
export async function listViews(ctx: FeatureContext, id: string) {
  await database(ctx, id);
  const rows = await ctx.db
    .prepare(
      "SELECT * FROM database_views WHERE database_id=? ORDER BY position,id",
    )
    .bind(id)
    .all<Record<string, unknown>>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    layout: r.layout,
    filters: JSON.parse(r.filters_json as string),
    sorts: JSON.parse(r.sorts_json as string),
    groups: JSON.parse(r.groups_json as string),
    calculations: JSON.parse(r.calculations_json as string),
    display: JSON.parse(r.display_json as string),
    position: r.position,
    revisionId: r.revision_id,
  })) as (View & {
    revisionId: string;
  })[];
}
export async function queryView(
  ctx: FeatureContext,
  id: string,
  viewId: string,
  embedded?: {
    pageId: string;
    filters?: Filter[];
    sorts?: View["sorts"];
  },
) {
  const db = await database(ctx, id);
  if (embedded) await requirePageLevel(ctx, embedded.pageId, "view");
  const view = (await listViews(ctx, id)).find((v) => v.id === viewId);
  if (!view) throw new ApiProblem(404, "NOT_FOUND", "Not found.");
  const raw = await ctx.db
    .prepare(
      "SELECT r.page_id,r.field_values_json,p.created_at,p.updated_at,p.revision_id FROM database_records r JOIN pages p ON p.id=r.page_id WHERE r.database_id=? AND p.archived_at IS NULL AND p.trashed_at IS NULL AND p.deleted_at IS NULL ORDER BY r.page_id",
    )
    .bind(id)
    .all<{
      page_id: string;
      field_values_json: string;
      created_at: string;
      updated_at: string;
      revision_id: string;
    }>();
  const fs = await fields(ctx, id),
    records: {
      pageId: string;
      revisionId: string;
      title: string;
      icon: string | null;
      values: Values;
    }[] = [];
  for (const r of raw.results) {
    try {
      const p = await readPage(ctx, r.page_id);
      const values =
        !p.permissions.canEdit &&
        p.publishedRevisionId &&
        p.publishedRevisionId !== p.workingRevisionId
          ? { ...(p.properties.databaseFields ?? {}) }
          : JSON.parse(r.field_values_json);
      for (const f of fs) {
        if (f.type === "created-at") values[f.id] = r.created_at;
        if (f.type === "updated-at") values[f.id] = r.updated_at;
        if (f.type === "identifier") values[f.id] = r.page_id;
      }
      const computed = await recordValues(ctx, id, values, fs);
      if (
        [...view.filters, ...(embedded?.filters ?? [])].every((f) =>
          matches(computed, f, 0, fs),
        )
      )
        records.push({
          pageId: r.page_id,
          revisionId: r.revision_id,
          title: p.page.title,
          icon: p.properties.icon,
          values: computed,
        });
    } catch (e) {
      if (!(e instanceof ApiProblem) || e.status !== 404) throw e;
    }
  }
  records.sort((a, b) => {
    for (const s of embedded?.sorts ?? view.sorts) {
      const field = fs.find((f) => f.id === s.field);
      const av = a.values[s.field],
        bv = b.values[s.field];
      const c =
        // The record's name belongs to the page, outside its typed field map.
        s.field === "$title" ? a.title.localeCompare(b.title) : field &&
        validateFormulas(fs).get(field.id) === "date" &&
        av != null &&
        bv != null
          ? Date.parse(String(av)) - Date.parse(String(bv))
          : compare(av, bv);
      if (c) return s.direction === "desc" ? -c : c;
    }
    return a.pageId.localeCompare(b.pageId);
  });
  const groups = view.groups.map((g) => {
    const buckets = new Map<string, typeof records>();
    for (const r of records) {
      const value = r.values[g.field] ?? null;
      for (const key of Array.isArray(value) ? value : [value]) {
        const k = JSON.stringify(key);
        buckets.set(k, [...(buckets.get(k) ?? []), r]);
      }
    }
    if (!g.hideEmpty) {
      const f = fs.find((f) => f.id === g.field);
      for (const key of (f?.config.options as unknown[]) ??
        (f?.type === "checkbox" ? [true, false] : [])) {
        const k = JSON.stringify(key);
        if (!buckets.has(k)) buckets.set(k, []);
      }
    }
    return {
      field: g.field,
      groups: [...buckets].map(([key, rows]) => ({
        value: JSON.parse(key),
        count: rows.length,
        pageIds: rows.map((r) => r.pageId),
      })),
    };
  });
  return {
    database: db,
    view,
    fields: fs,
    records,
    groups,
    calculations: Object.fromEntries(
      Object.entries(view.calculations).map(([field, op]) => [
        field,
        aggregate(
          records.map((r) => r.values[field]),
          op,
        ),
      ]),
    ),
  };
}
export async function chart(
  ctx: FeatureContext,
  id: string,
  viewId: string,
  group: string,
  numeric?: string,
  calculation = "count",
) {
  const result = await queryView(ctx, id, viewId);
  if (
    !result.fields.some((f) => f.id === group) ||
    (numeric &&
      !result.fields.some(
        (f) =>
          f.id === numeric && validateFormulas(result.fields).get(f.id) === "number",
      ))
  )
    throw new ApiProblem(400, "INVALID_CHART", "Choose valid chart fields.");
  const groups = new Map<string, unknown[]>();
  for (const r of result.records) {
    const key = JSON.stringify(r.values[group] ?? null);
    groups.set(key, [
      ...(groups.get(key) ?? []),
      numeric ? r.values[numeric] : 1,
    ]);
  }
  return {
    viewId,
    viewName: result.view.name,
    series: [...groups].map(([label, values]) => ({
      label: JSON.parse(label),
      value: aggregate(values, calculation),
    })),
  };
}
