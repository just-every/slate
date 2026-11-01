/**
 * SL1: a database and each of its records have one address each. A saved view is list state, so it rides in the search
 * string and is omitted for the first view. Every other page keeps its page address.
 */
export type PageAddressTarget = { kind: "database" | "record"; databaseId: string };

/** A colon is a legal path character and the importers' ids carry them, so it stays literal as the page tree's links always had it. */
const segment = (id: string) => encodeURIComponent(id).replaceAll("%3A", ":");

const view = (viewId?: string | null) => (viewId ? `?view=${encodeURIComponent(viewId)}` : "");

export function databaseAddress(databaseId: string, viewId?: string | null) {
  return `/app/databases/${segment(databaseId)}${view(viewId)}`;
}

export function recordAddress(databaseId: string, recordId: string, viewId?: string | null) {
  return `/app/databases/${segment(databaseId)}/records/${segment(recordId)}${view(viewId)}`;
}

export function pageAddress(pageId: string, target?: PageAddressTarget | null) {
  if (target?.kind === "database") return databaseAddress(target.databaseId);
  if (target?.kind === "record") return recordAddress(target.databaseId, pageId);
  return `/app/pages/${segment(pageId)}`;
}
