import type { SearchDocument } from './documents';
import type { ShingleMinHash } from './minhash';
import type { PageTrust } from './trust-types';
import { snippetText } from './snippets';
export interface SimilarPage { id: string; title: string; href: string; trust?: PageTrust }
export interface SearchResult extends Omit<SearchDocument, 'text' | 'contributors'> {
  snippet: string; highlights: string[]; href: string; score: number; trust?: PageTrust; similarPages?: SimilarPage[];
}
export interface VisibleSearchRow {
  key: string; variant: string; id: string; pageId: string | null; kind: string; title: string;
  revisionId: string; status: string | null; containerId: string | null; score: number; updatedAt: string;
  ownerId: string | null; ownerName: string | null; trustState: PageTrust['state'] | null; expiresAt: string | null; trustUpdatedAt: string | null;
  minHash?: ShingleMinHash; unsketchedText?: string | null;
}
export function resultTrust(row: VisibleSearchRow): PageTrust | undefined {
  return row.pageId && row.trustState ? { state: row.trustState, owner: row.ownerId ? { id: row.ownerId, displayName: row.ownerName ?? 'Former member' } : null, expiresAt: row.expiresAt, updatedAt: row.trustUpdatedAt! } : undefined;
}
/** `addresses` holds each page's one address (SL1): a database's page opens the database, a record its record address. */
export function searchResult(document: SearchDocument & { _minHash?: ShingleMinHash }, row: VisibleSearchRow, terms: string[], similar: VisibleSearchRow[], addresses: ReadonlyMap<string, string>): SearchResult {
  const { text: _, contributors: __, _minHash: ___, ...rest } = document;
  const trust = resultTrust(row);
  const page = (id: string) => addresses.get(id) ?? `/app/pages/${id}`;
  return { ...rest, status: row.status, updatedAt: row.updatedAt, snippet: snippetText(document.text, terms), highlights: terms,
    href: document.kind === 'container' ? `/app/containers/${document.id}` : document.kind === 'template' ? `/app/templates/${document.id}` : `${page(document.pageId!)}${document.kind === 'comment-thread' ? `?thread=${document.id}` : ''}`,
    score: row.score, ...(trust ? { trust } : {}), ...(similar.length ? { similarPages: similar.map(item => ({ id: item.id, title: item.title, href: page(item.id), trust: resultTrust(item) })) } : {}) };
}
