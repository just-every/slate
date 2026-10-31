import type { FeatureContext } from "../../app/feature-context";
import { ApiProblem } from "../../app/problems";
import { currentSubject } from "../sharing/current-access";
import { readPage } from "../pages/service";
import { fileVisibility } from "../media/service";
import { database, fields } from "./repository";
import { pageAddresses } from "./addresses";
export async function listDatabases(ctx: FeatureContext, containerId?: string) {
  await currentSubject(ctx);
  const rows = await ctx.db
    .prepare(
      "SELECT d.id,d.page_id,d.revision_id,p.container_id FROM databases d JOIN pages p ON p.id=d.page_id WHERE d.workspace_id=? AND p.archived_at IS NULL AND p.trashed_at IS NULL AND p.deleted_at IS NULL AND (? IS NULL OR p.container_id=?) ORDER BY d.id",
    )
    .bind(ctx.actor.workspaceId, containerId ?? null, containerId ?? null)
    .all<{
      id: string;
      page_id: string;
      revision_id: string;
      container_id: string;
    }>();
  const items = [];
  for (const row of rows.results) {
    try {
      const page = await readPage(ctx, row.page_id);
      items.push({
        id: row.id,
        pageId: row.page_id,
        title: page.page.title,
        icon: page.properties.icon,
        containerId: row.container_id,
        revisionId: row.revision_id,
      });
    } catch (e) {
      if (!(e instanceof ApiProblem) || e.status !== 404) throw e;
    }
  }
  return { items };
}
export interface ReferenceLabel {
  id: string;
  label: string;
  kind: "person" | "file" | "record";
  url?: string;
  contentType?: string;
}
export async function resolveReferences(
  ctx: FeatureContext,
  input: { memberIds?: string[]; fileIds?: string[]; pageIds?: string[] },
) {
  await currentSubject(ctx);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiProblem(
      400,
      "INVALID_INPUT",
      "Reference lookup requires an object.",
    );
  const items: ReferenceLabel[] = [];
  for (const ids of [input.memberIds, input.fileIds, input.pageIds])
    if (
      ids &&
      (!Array.isArray(ids) ||
        ids.length > 500 ||
        ids.some((id) => typeof id !== "string"))
    )
      throw new ApiProblem(
        400,
        "REFERENCE_LIMIT",
        "Supply at most 500 identifiers per reference kind.",
      );
  for (const id of new Set(input.memberIds ?? [])) {
    const member = await ctx.db
      .prepare(
        "SELECT id,display_name FROM members WHERE workspace_id=? AND id=? AND status='active'",
      )
      .bind(ctx.actor.workspaceId, id)
      .first<{ id: string; display_name: string }>();
    if (member) items.push({ id, label: member.display_name, kind: "person" });
  }
  const records: ReferenceLabel[] = [];
  for (const id of new Set(input.pageIds ?? [])) {
    try {
      const p = await readPage(ctx, id);
      records.push({ id, label: p.page.title, kind: "record" });
    } catch (e) {
      if (!(e instanceof ApiProblem) || e.status !== 404) throw e;
    }
  }
  // SL1: a relation chip opens the related record's one address.
  const addresses = await pageAddresses(ctx, records.map((record) => record.id));
  items.push(...records.map((record) => ({ ...record, url: addresses.get(record.id) })));
  // File metadata follows the media door: a reader learns only of files they could open.
  const pages = new Map<string, ReturnType<typeof fileVisibility>>();
  for (const id of new Set(input.fileIds ?? [])) {
    const file = await ctx.db
      .prepare(
        "SELECT id,original_name,content_type,page_id FROM files WHERE workspace_id=? AND id=? AND deleted_at IS NULL",
      )
      .bind(ctx.actor.workspaceId, id)
      .first<{
        id: string;
        original_name: string;
        content_type: string;
        page_id: string | null;
      }>();
    if (!file?.page_id) continue;
    try {
      if (!pages.has(file.page_id)) pages.set(file.page_id, fileVisibility(ctx, file.page_id));
      if (!(await (await pages.get(file.page_id)!).allows(id))) continue;
      items.push({
        id,
        label: file.original_name,
        kind: "file",
        contentType: file.content_type,
        url: `/api/media/${id}`,
      });
    } catch (e) {
      if (!(e instanceof ApiProblem) || e.status !== 404) throw e;
    }
  }
  return { items };
}
export async function referenceOptions(
  ctx: FeatureContext,
  databaseId: string,
  fieldId: string,
  query = "",
) {
  await database(ctx, databaseId);
  const field = (await fields(ctx, databaseId)).find((f) => f.id === fieldId);
  if (!field || !["person", "file", "relation"].includes(field.type))
    throw new ApiProblem(
      400,
      "INVALID_REFERENCE_FIELD",
      "Choose a person, file or relation field.",
    );
  let ids: { memberIds?: string[]; fileIds?: string[]; pageIds?: string[] } =
    {};
  if (field.type === "person") {
    const rows = await ctx.db
      .prepare(
        "SELECT id FROM members WHERE workspace_id=? AND status='active' ORDER BY id",
      )
      .bind(ctx.actor.workspaceId)
      .all<{ id: string }>();
    ids.memberIds = rows.results.map((r) => r.id);
  } else if (field.type === "file") {
    const rows = await ctx.db
      .prepare(
        "SELECT id FROM files WHERE workspace_id=? AND deleted_at IS NULL ORDER BY id",
      )
      .bind(ctx.actor.workspaceId)
      .all<{ id: string }>();
    ids.fileIds = rows.results.map((r) => r.id);
  } else {
    await database(ctx, String(field.config.databaseId));
    const rows = await ctx.db
      .prepare(
        "SELECT r.page_id AS id FROM database_records r JOIN pages p ON p.id=r.page_id WHERE r.database_id=? AND p.archived_at IS NULL AND p.trashed_at IS NULL AND p.deleted_at IS NULL ORDER BY r.page_id",
      )
      .bind(String(field.config.databaseId))
      .all<{ id: string }>();
    const result: ReferenceLabel[] = [];
    for (let i = 0; i < rows.results.length; i += 500) {
      const resolved = await resolveReferences(ctx, {
        pageIds: rows.results.slice(i, i + 500).map((r) => r.id),
      });
      result.push(
        ...resolved.items.filter((item) =>
          item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        ),
      );
      if (result.length > 100)
        return { items: result.slice(0, 100), hasMore: true };
    }
    return { items: result, hasMore: false };
  }
  const allIds = ids.memberIds ?? ids.fileIds ?? [],
    matched: ReferenceLabel[] = [];
  for (let i = 0; i < allIds.length; i += 500) {
    const result = await resolveReferences(
      ctx,
      field.type === "person"
        ? { memberIds: allIds.slice(i, i + 500) }
        : { fileIds: allIds.slice(i, i + 500) },
    );
    matched.push(
      ...result.items.filter((item) =>
        item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    );
    if (matched.length > 100)
      return { items: matched.slice(0, 100), hasMore: true };
  }
  return { items: matched, hasMore: false };
}
