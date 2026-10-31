import type { FeatureContext } from "../../app/feature-context";
import { resolveCurrentAccessMany } from "../sharing/bulk-access";
import { pageAddress, type PageAddressTarget } from "../../shared/knowledge/addresses";

interface AddressRow { pageId: string; kind: "database" | "record"; databaseId: string; databasePageId: string }

/**
 * SL1: which pages are a database's page or a record, read from rows (`databases.page_id`, `database_records.page_id`),
 * never from `page_kind`. A page that is both is the database's (it is the larger resource and lists the record).
 */
async function addressRows(ctx: FeatureContext, ids: string[]) {
  const rows = new Map<string, AddressRow>();
  if (!ids.length) return rows;
  const json = JSON.stringify(ids);
  const result = await ctx.db.prepare(`SELECT d.page_id AS pageId,'database' AS kind,d.id AS databaseId,d.page_id AS databasePageId FROM databases d WHERE d.workspace_id=? AND d.page_id IN (SELECT value FROM json_each(?))
    UNION ALL SELECT r.page_id,'record',r.database_id,d.page_id FROM database_records r JOIN databases d ON d.id=r.database_id WHERE d.workspace_id=? AND r.page_id IN (SELECT value FROM json_each(?))`)
    .bind(ctx.actor.workspaceId, json, ctx.actor.workspaceId, json).all<AddressRow>();
  for (const row of result.results) if (!rows.has(row.pageId) || row.kind === "database") rows.set(row.pageId, row);
  return rows;
}

/**
 * What each page the reader may already open is, for its address. A record shows under its database only for a reader
 * who may also open that database; anyone else keeps its page address, so no address names a database they cannot see.
 */
export async function pageTargets(ctx: FeatureContext, readableIds: readonly string[]) {
  const ids = [...new Set(readableIds)];
  const rows = await addressRows(ctx, ids);
  const databasePages = [...new Set([...rows.values()].filter(row => row.kind === "record").map(row => row.databasePageId))];
  const access = await resolveCurrentAccessMany(ctx, databasePages);
  return new Map(ids.map((id): [string, PageAddressTarget | null] => {
    const row = rows.get(id);
    if (!row || (row.kind === "record" && access.get(row.databasePageId)?.decision.allowed !== true)) return [id, null];
    return [id, { kind: row.kind, databaseId: row.databaseId }];
  }));
}

/** The one address of each page the reader may already open. */
export async function pageAddresses(ctx: FeatureContext, readableIds: readonly string[]) {
  const targets = await pageTargets(ctx, readableIds);
  return new Map([...targets].map(([id, target]) => [id, pageAddress(id, target)]));
}

/**
 * An old address of a database's page or a record, or a record path under the wrong database, answers one hop to the
 * page's one address with the same search string. An unknown page and one the reader may not open get no hop, so a
 * Location never tells them apart.
 */
export async function canonicalLocation(ctx: FeatureContext, url: URL) {
  const match = /^\/app\/pages\/([^/]+)$/.exec(url.pathname) ?? /^\/app\/databases\/[^/]+\/records\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  let id: string;
  try { id = decodeURIComponent(match[1]); } catch { return null; }
  const row = (await addressRows(ctx, [id])).get(id);
  if (!row) return null;
  const access = await resolveCurrentAccessMany(ctx, [...new Set([id, row.databasePageId])]);
  if (access.get(id)?.decision.allowed !== true) return null;
  const shown = row.kind === "database" || access.get(row.databasePageId)?.decision.allowed === true;
  const target = pageAddress(id, shown ? { kind: row.kind, databaseId: row.databaseId } : null);
  return target === url.pathname ? null : target + url.search;
}
