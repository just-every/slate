import type { FeatureContext } from "../../app/feature-context";
import { ApiProblem } from "../../app/problems";
import { requirePageLevel } from "../sharing/current-access";
import { pageRow, writable } from "../pages/repository";
import type { Field } from "./values";
export interface DatabaseRow {
  id: string;
  page_id: string;
  revision_id: string;
  structure_locked_at: string | null;
  structure_locked_by_member_id: string | null;
  structure_locked_by_name: string | null;
}
export async function database(
  ctx: FeatureContext,
  id: string,
  level: "view" | "edit" | "full" = "view",
) {
  const row = await ctx.db
    .prepare(
      "SELECT d.*,m.display_name AS structure_locked_by_name FROM databases d LEFT JOIN members m ON m.id=d.structure_locked_by_member_id WHERE d.id=? AND d.workspace_id=?",
    )
    .bind(id, ctx.actor.workspaceId)
    .first<DatabaseRow>();
  if (!row) throw new ApiProblem(404, "NOT_FOUND", "Not found.");
  await requirePageLevel(ctx, row.page_id, level);
  // Structure, templates and records follow the backing page's read-only lifecycle.
  if (level !== "view") writable(await pageRow(ctx, row.page_id));
  return row;
}
export async function fields(
  ctx: FeatureContext,
  id: string,
): Promise<Field[]> {
  const rows = await ctx.db
    .prepare(
      "SELECT id,name,field_type,config_json,position FROM database_fields WHERE database_id=? ORDER BY position",
    )
    .bind(id)
    .all<{
      id: string;
      name: string;
      field_type: Field["type"];
      config_json: string;
      position: number;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.field_type,
    config: JSON.parse(r.config_json),
    position: r.position,
    readOnly: [
      "formula",
      "rollup",
      "created-at",
      "updated-at",
      "identifier",
    ].includes(r.field_type),
    ...(["formula", "rollup"].includes(r.field_type)
      ? {
          evaluationState: (
            r.field_type === "formula"
              ? !!JSON.parse(r.config_json).expression
              : !!JSON.parse(r.config_json).relationField
          )
            ? ("current" as const)
            : ("retained-not-recomputed" as const),
        }
      : {}),
  }));
}
export function revision(
  ctx: FeatureContext,
  id: string,
  kind: string,
  entity: string,
  snapshot: unknown,
) {
  return ctx.db
    .prepare("INSERT INTO structured_revisions VALUES (?,?,?,?,?,?,?)")
    .bind(
      id,
      ctx.actor.workspaceId,
      kind,
      entity,
      JSON.stringify(snapshot),
      ctx.actor.id,
      ctx.now,
    );
}
export function unlocked(row: DatabaseRow) {
  if (row.structure_locked_at)
    throw new ApiProblem(
      409,
      "STRUCTURE_LOCKED",
      "Database structure is locked.",
      { lockedBy: row.structure_locked_by_member_id },
    );
}
export async function requireRecordDatabase(
  ctx: FeatureContext,
  databaseId: string,
  pageId: string,
) {
  await database(ctx, databaseId);
  if (
    !(await ctx.db
      .prepare(
        "SELECT page_id FROM database_records WHERE page_id=? AND database_id=?",
      )
      .bind(pageId, databaseId)
      .first())
  )
    throw new ApiProblem(404, "NOT_FOUND", "Not found.");
}
