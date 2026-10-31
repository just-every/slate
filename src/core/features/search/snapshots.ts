import seed from '../../../../seed.json';
import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import type { SearchDocument } from './documents';
import type { SearchInput } from './input';
import { groupNearDuplicates, minHashShingles } from './minhash';
import type { VisibleSearchRow } from './results';
import type { searchQuery } from './query';
type Query = Awaited<ReturnType<typeof searchQuery>>;
export interface SearchSnapshot { groups: string[][]; revisions: Record<string, string> }
const changed = () => new ApiProblem(409, 'SEARCH_CHANGED', 'Content or access changed during search. Start a fresh search.');
const documentSql = (alias: string) => `COALESCE(${alias}.document_json,(SELECT t.document_json FROM search_text t WHERE t.key=${alias}.key AND t.variant=${alias}.variant))`;
function ordering(input: SearchInput) {
  return input.sort === 'updated' ? 'updatedAt DESC,score DESC,trustRank ASC,id ASC' : input.sort === 'views' ? 'views DESC,score DESC,trustRank ASC,updatedAt DESC,id ASC' : 'score DESC,trustRank ASC,updatedAt DESC,id ASC';
}

/** Fetch only indexed metadata/sketches for the ACL-selected hits. Historical
 * derived rows without a sketch supply their indexed text once for hydration;
 * this never reads canonical bodies or invokes readPage for the corpus. */
export async function visibleSearchRows(ctx: FeatureContext, query: Query, input: SearchInput): Promise<VisibleSearchRow[]> {
  const doc = documentSql('v');
  const selected = await ctx.db.prepare(query.sql + ` SELECT (SELECT json_group_array(json_object(
    'key',key,'variant',variant,'id',id,'pageId',page_id,'kind',kind,'status',status,'containerId',containerId,'score',score,'updatedAt',updatedAt,
    'ownerId',ownerId,'ownerName',ownerName,'trustState',trustState,'expiresAt',expiresAt,'trustUpdatedAt',trustUpdatedAt,
    'icon',icon,'cover',json(cover),'coverFileId',coverFileId,
    'title',json_extract(${doc},'$.title'),'revisionId',json_extract(${doc},'$.revisionId'),
    'minHash',json_extract(${doc},'$._minHash'),
    'unsketchedText',CASE WHEN kind='page' AND json_extract(${doc},'$._minHash.version') IS NULL THEN json_extract(${doc},'$.text') END
    )) FROM (SELECT * FROM visible ORDER BY ${ordering(input)}) v) AS rows_json,(SELECT epoch FROM core_acl_epoch WHERE id=1) AS acl_epoch WHERE ${query.ready}`)
    .bind(...query.values).first<{ rows_json: string; acl_epoch: number }>();
  if (!selected) throw changed();
  query.ready = `(${query.ready}) AND (SELECT epoch FROM core_acl_epoch WHERE id=1)=${selected.acl_epoch}`;
  const rows = JSON.parse(selected.rows_json) as VisibleSearchRow[];
  const hydrate = rows.filter(row => row.kind === 'page' && !row.minHash);
  for (const row of hydrate) row.minHash = minHashShingles(row.unsketchedText!);
  for (let offset = 0; offset < hydrate.length; offset += 100) {
    const values = JSON.stringify(hydrate.slice(offset, offset + 100).map(row => ({ key: row.key, variant: row.variant, revisionId: row.revisionId, minHash: row.minHash })));
    await ctx.db.prepare(`UPDATE search_text AS t SET document_json=json_set(document_json,'$._minHash',json((SELECT json_extract(j.value,'$.minHash') FROM json_each(?1) j WHERE json_extract(j.value,'$.key')=t.key AND json_extract(j.value,'$.variant')=t.variant)))
      WHERE EXISTS(SELECT 1 FROM json_each(?1) j WHERE json_extract(j.value,'$.key')=t.key AND json_extract(j.value,'$.variant')=t.variant AND json_extract(j.value,'$.revisionId')=json_extract(t.document_json,'$.revisionId'))`)
      .bind(values).run();
  }
  return rows;
}

export function createSearchSnapshot(rows: VisibleSearchRow[]): SearchSnapshot {
  // This is the source-controlled owner configuration, shared with KEEP-004.
  // The property is added by the integrating lane alongside this implementation.
  const threshold = (seed.limits as typeof seed.limits & { nearDuplicateSimilarity?: number }).nearDuplicateSimilarity;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new ApiProblem(503, 'INVALID_SEARCH_CONFIGURATION', 'limits.nearDuplicateSimilarity must be greater than zero and at most one.');
  return { groups: groupNearDuplicates(rows, threshold), revisions: Object.fromEntries(rows.filter(row => row.kind === 'page').map(row => [row.key, `${row.variant}:${row.revisionId}`])) };
}
export async function saveSearchSnapshot(ctx: FeatureContext, id: string, queryHash: string, rows: VisibleSearchRow[], snapshot: SearchSnapshot, query: Query) {
  const parameter = query.values.length;
  const saved = await ctx.db.prepare(`INSERT INTO discovery_snapshots(id,workspace_id,member_id,query_hash,ids_json,expires_at,search_summary_json)
    SELECT ?${parameter + 1},?${parameter + 2},?${parameter + 3},?${parameter + 4},?${parameter + 5},?${parameter + 6},?${parameter + 7} WHERE ${query.ready} RETURNING id`)
    .bind(...query.values, id, ctx.actor.workspaceId, ctx.actor.id, queryHash, JSON.stringify(rows.map(row => row.key)), new Date(Date.parse(ctx.now) + 3600000).toISOString(), JSON.stringify(snapshot)).first();
  if (!saved) throw changed();
}
export function snapshotGroups(snapshot: SearchSnapshot, rows: VisibleSearchRow[]) {
  const byKey = new Map(rows.map(row => [row.key, row]));
  if (!Array.isArray(snapshot.groups) || !snapshot.revisions) throw new ApiProblem(409, 'SEARCH_EXPIRED', 'Search changed or expired. Start a fresh search.');
  // An ACL-only change simply removes inaccessible members. A revision change
  // requires a fresh grouping, rather than reordering or misgrouping a cursor.
  for (const row of rows) if (row.kind === 'page' && snapshot.revisions[row.key] !== `${row.variant}:${row.revisionId}`) throw changed();
  return snapshot.groups.map((keys, position) => ({ position, rows: keys.flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []) })).filter(group => group.rows.length);
}
export function searchFacets(groups: ReturnType<typeof snapshotGroups>) {
  const kind: Record<string, number> = {}, container: Record<string, number> = {}, status: Record<string, number> = {};
  for (const group of groups) {
    const row = group.rows[0]!;
    kind[row.kind] = (kind[row.kind] ?? 0) + 1;
    if (row.containerId) container[row.containerId] = (container[row.containerId] ?? 0) + 1;
    if (row.status) status[row.status] = (status[row.status] ?? 0) + 1;
  }
  return { kind, container, status };
}
export async function selectedSearchDocuments(ctx: FeatureContext, query: Query, rows: VisibleSearchRow[]): Promise<Map<string, SearchDocument>> {
  if (!rows.length) return new Map();
  const parameter = query.values.length, doc = documentSql('v');
  const result = await ctx.db.prepare(query.sql + ` SELECT v.key,${doc} AS document_json FROM json_each(?${parameter + 1}) selected JOIN visible v ON v.key=selected.value WHERE ${query.ready}`)
    .bind(...query.values, JSON.stringify(rows.map(row => row.key))).all<{ key: string; document_json: string }>();
  if (result.results.length !== rows.length) throw changed();
  const expected = new Map(rows.map(row => [row.key, row]));
  return new Map(result.results.map(row => {
    const document = JSON.parse(row.document_json) as SearchDocument;
    if (document.revisionId !== expected.get(row.key)!.revisionId) throw changed();
    return [row.key, document];
  }));
}
