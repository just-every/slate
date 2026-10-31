/** The title every instantly created page starts with; the creator renames it in place. */
export const DEFAULT_PAGE_TITLE = "Untitled";

/** One-shot query flag telling the page view it was just created, so it selects the title once. */
export const NEW_PAGE_PARAM = "new";

export interface SpaceChoice {
  id: string;
  name: string;
  permissions?: { canCreatePages?: boolean };
}

/**
 * Where a page goes when nobody is asked: the space being viewed, then the space of the newest
 * recent page, then the first space. Only spaces the server reports as accepting new pages count;
 * the server still authorizes the destination on creation.
 */
export function inferPageSpace({
  current,
  recents,
  spaces,
}: {
  current?: string | null;
  recents?: readonly { containerId: string }[];
  spaces: readonly SpaceChoice[];
}): SpaceChoice | null {
  const writable = spaces.filter((space) => space.permissions?.canCreatePages === true);
  const find = (id: string | null | undefined) => (id ? writable.find((space) => space.id === id) : undefined);
  return find(current) ?? recents?.map((recent) => find(recent.containerId)).find(Boolean) ?? writable[0] ?? null;
}

/** A creation entry point carries its exact destination into the template picker. */
export function templateCreationHref(containerId: string, parentPageId?: string) {
  const query = new URLSearchParams({ containerId });
  if (parentPageId) query.set("parentPageId", parentPageId);
  return `/app/templates?${query}`;
}
