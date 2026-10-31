import { recordNoResultSearch } from '../analytics/no-result-searches';
import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import { requestHash } from '../../app/operations';
import { createUlid } from '../../shared/ulid';
import { currentSubject } from '../sharing/current-access';
import { refreshSearchIndex } from './index';
import { searchQuery } from './query';
import { decodeCursor, encodeCursor } from './pagination';
import { nameSnippetMembers } from './snippets';
import { validateSearch, type SearchInput } from './input';
import { parseAdvancedSearch, searchHighlights } from './language';
import { searchResult } from './results';
import { createSearchSnapshot, saveSearchSnapshot, searchFacets, selectedSearchDocuments, snapshotGroups, visibleSearchRows, type SearchSnapshot } from './snapshots';
export { validateSearch } from './input';
export type { SearchInput } from './input';
export type { SearchResult } from './results';
export function queryTerms(query: string): string[] { return searchHighlights(parseAdvancedSearch(query)); }

export async function search(ctx: FeatureContext, raw: SearchInput) {
  const subject = await currentSubject(ctx), input = validateSearch(raw), language = parseAdvancedSearch(input.query), terms = searchHighlights(language);
  const { cursor: _, limit: __, ...filters } = input;
  const queryHash = await requestHash(filters), cursor = decodeCursor<{ snapshot: string; offset: number }>(input.cursor);
  if (cursor && (typeof cursor.snapshot !== 'string' || !Number.isInteger(cursor.offset) || cursor.offset < 0)) throw new ApiProblem(400, 'INVALID_CURSOR', 'Invalid search cursor.');
  const snapshotId = cursor?.snapshot ?? createUlid();
  let snapshot: SearchSnapshot | undefined;
  if (cursor) {
    const saved = await ctx.db.prepare('SELECT search_summary_json FROM discovery_snapshots WHERE id=? AND workspace_id=? AND member_id=? AND query_hash=? AND expires_at>?')
      .bind(snapshotId, ctx.actor.workspaceId, ctx.actor.id, queryHash, ctx.now).first<{ search_summary_json: string }>();
    if (!saved) throw new ApiProblem(409, 'SEARCH_EXPIRED', 'Search changed or expired. Start a fresh search.');
    snapshot = JSON.parse(saved.search_summary_json) as SearchSnapshot;
  }
  await refreshSearchIndex(ctx);
  const query = await searchQuery(ctx, subject, input, language, cursor ? snapshotId : undefined);
  const rows = await visibleSearchRows(ctx, query, input);
  if (!snapshot) {
    snapshot = createSearchSnapshot(rows);
    await saveSearchSnapshot(ctx, snapshotId, queryHash, rows, snapshot, query);
  }
  const groups = snapshotGroups(snapshot, rows), remaining = groups.filter(group => group.position >= (cursor?.offset ?? 0));
  const selected = remaining.slice(0, input.limit!);
  if (!cursor && !groups.length) await recordNoResultSearch(ctx, input.query, input.containerId);
  // The last live ACL query covers every disclosed similar-page member, not
  // merely the representative whose snippet is displayed.
  const documents = await selectedSearchDocuments(ctx, query, selected.flatMap(group => group.rows));
  const items = await nameSnippetMembers(ctx, selected.map(group => {
    const row = group.rows[0]!;
    return searchResult(documents.get(row.key)!, row, terms, group.rows.slice(1));
  }));
  return { items, total: groups.length, facets: searchFacets(groups), filters,
    nextCursor: remaining.length > selected.length ? encodeCursor({ snapshot: snapshotId, offset: selected.at(-1)!.position + 1 }) : undefined };
}
/** Retained IDs and workspace are the two bindings. Reuse this predicate in
 * the completion write so a stale or unrelated projection cannot admit it. */
export const incompleteImportSearchSql = `SELECT 1 FROM json_each(?) i
  LEFT JOIN pages p ON p.id=i.value AND p.workspace_id=? AND p.deleted_at IS NULL
  WHERE p.id IS NULL OR NOT EXISTS(
    SELECT 1 FROM search_text s WHERE s.workspace_id=p.workspace_id AND s.page_id=p.id
      AND s.key=(CASE WHEN p.page_kind='record' THEN 'record:' ELSE 'page:' END)||p.id
      AND s.kind=CASE WHEN p.page_kind='record' THEN 'record' ELSE 'page' END
      AND s.id=p.id AND s.variant='working'
      AND json_extract(s.document_json,'$.revisionId')=p.revision_id
  ) OR EXISTS(SELECT 1 FROM search_dirty d WHERE d.workspace_id=p.workspace_id AND d.key IN ('page:'||p.id,'record:'||p.id))`;
/** Import completion proves every requested canonical ID has a clean indexed generation. */
export async function verifySearchable(ctx: FeatureContext, pageIds: string[], bounds?: import('./index').SearchRefreshBounds) {
  await refreshSearchIndex(ctx, bounds);
  return !!await ctx.db.prepare(`SELECT NOT EXISTS(${incompleteImportSearchSql}) AS ready`).bind(JSON.stringify(pageIds), ctx.actor.workspaceId).first<number>('ready');
}
