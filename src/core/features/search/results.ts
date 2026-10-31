import type { SearchDocument } from './documents';
import type { ShingleMinHash } from './minhash';
import type { PageTrust } from './trust-types';
import { snippetText } from './snippets';
import type { PageCover } from '../pages/appearance';
export interface SimilarPage { id: string; title: string; href: string; trust?: PageTrust }
export interface SearchResult extends Omit<SearchDocument, 'text' | 'contributors'> {
  icon?: string | null; cover?: PageCover | null; coverFileId?: string | null;
  snippet: string; highlights: string[]; href: string; score: number; trust?: PageTrust; similarPages?: SimilarPage[];
}
export interface VisibleSearchRow {
  icon?: string | null; cover?: PageCover | null; coverFileId?: string | null;
  key: string; variant: string; id: string; pageId: string | null; kind: string; title: string;
  revisionId: string; status: string | null; containerId: string | null; score: number; updatedAt: string;
  ownerId: string | null; ownerName: string | null; trustState: PageTrust['state'] | null; expiresAt: string | null; trustUpdatedAt: string | null;
  minHash?: ShingleMinHash; unsketchedText?: string | null;
}
export function resultTrust(row: VisibleSearchRow): PageTrust | undefined {
  return row.pageId && row.trustState ? { state: row.trustState, owner: row.ownerId ? { id: row.ownerId, displayName: row.ownerName ?? 'Former member' } : null, expiresAt: row.expiresAt, updatedAt: row.trustUpdatedAt! } : undefined;
}
export function searchResult(document: SearchDocument & { _minHash?: ShingleMinHash }, row: VisibleSearchRow, terms: string[], similar: VisibleSearchRow[]): SearchResult {
  const { text: _, contributors: __, _minHash: ___, ...rest } = document;
  const trust = resultTrust(row);
  return { ...rest, icon: row.icon ?? null, cover: row.cover ?? null, coverFileId: row.coverFileId ?? null, status: row.status, updatedAt: row.updatedAt, snippet: snippetText(document.text, terms), highlights: terms,
    href: document.kind === 'container' ? `/app/containers/${document.id}` : document.kind === 'template' ? `/app/templates/${document.id}` : `/app/pages/${document.pageId}${document.kind === 'comment-thread' ? `?thread=${document.id}` : ''}`,
    score: row.score, ...(trust ? { trust } : {}), ...(similar.length ? { similarPages: similar.map(page => ({ id: page.id, title: page.title, href: `/app/pages/${page.id}`, trust: resultTrust(page) })) } : {}) };
}
