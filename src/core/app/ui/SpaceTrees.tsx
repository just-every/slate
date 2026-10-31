import { TreeCreatePage } from "./TreeCreatePage";
import { useLocation } from "@tanstack/react-router";
import type { TreePage } from "./PageTree";
import { FilteredPageTree } from "./FilteredPageTree";
import { RequestState } from "./RequestState";
import { mutate, operationKey } from "../../client/transport";
import type { Resource } from "../../client/useResource";
import type { PageResult } from "../../shared/api/common";
import type { WorkspaceSnapshot } from "./workspaceSnapshot";

type Named = { items: { id: string; name: string; permissions?: { canCreatePages?: boolean } }[] };
export type NavigationDatabases = { items: { id: string; title: string; pageId: string; containerId: string }[] };

/** The Pages section: one disclosure row per space, with its pages and databases beneath. */
export function SpaceTrees({
  pages,
  containers,
  databases,
  navigation,
  onError,
  onNavigate,
}: {
  pages: Resource<PageResult<TreePage>>;
  containers: Resource<Named>;
  databases: Resource<NavigationDatabases>;
  navigation: Resource<WorkspaceSnapshot["navigation"]>;
  onError: (cause: unknown) => void;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const preferences = navigation.data?.preferences;
  const treePages = pages.data?.items ?? [];
  const sharedPages = treePages.filter(page => page.sharedWithMe);
  const regularPages = treePages.filter(page => !page.sharedWithMe);
  const sharedIds = new Set(sharedPages.map(page => page.id));
  const sharedSpaceIds = new Set(sharedPages.map(page => page.containerId));
  const spaceIds = new Set([
    ...regularPages.map(page => page.containerId),
    ...(containers.data?.items.filter(space => space.permissions?.canCreatePages).map(space => space.id) ?? []),
    ...(databases.data?.items.filter(database => !sharedIds.has(database.pageId)).map(database => database.containerId) ?? []),
  ]);
  function toggle(id: string) {
    if (!preferences) return;
    const collapsed = preferences.value.collapsedContainers;
    void mutate("/api/navigation/preferences", {
      operationKey: operationKey(),
      expectedRevisionId: preferences.revisionId,
      value: { ...preferences.value, collapsedContainers: collapsed.includes(id) ? collapsed.filter((value) => value !== id) : [...collapsed, id] },
    }, "PUT").then(navigation.reload).catch(onError);
  }
  function spaceTree(id: string, shared: boolean) {
    const groupPages = (shared ? sharedPages : regularPages).filter(page => page.containerId === id);
    const space = containers.data?.items.find(item => item.id === id);
    const name = groupPages[0]?.containerLabel ?? containers.data?.items.find(item => item.id === id)?.name ?? '';
    return <details key={`${shared ? 'shared' : 'space'}:${id}`} className="space-group" open={!preferences?.value.collapsedContainers.includes(id)}>
      <summary onClick={event => { event.preventDefault(); toggle(id); }}>{name}</summary>
      <FilteredPageTree pages={groupPages} spaceName={shared ? `Shared with me · ${name}` : name} activePath={pathname} />
      {!shared && space?.permissions?.canCreatePages ? <TreeCreatePage containerId={id} name={name} /> : null}
    </details>;
  }
  return (
    <nav className="page-links" aria-label="Pages" onClick={event => { if ((event.target as HTMLElement).closest("a[href]")) onNavigate?.(); }}>
      <RequestState loading={pages.loading || databases.loading} error={pages.error ?? databases.error} retry={async () => { await Promise.all([pages.reload(), databases.reload()]); }}>
        {[...spaceIds].map(id => spaceTree(id, false))}
        {sharedPages.length ? <section aria-label="Shared with me">
          <h2 className="sidebar-label">Shared with me</h2>
          {[...sharedSpaceIds].map(id => spaceTree(id, true))}
        </section> : null}
        {pages.data?.items.length === 0 && databases.data?.items.length === 0 ? <p className="empty-tree">Your first page starts here.</p> : null}
      </RequestState>
    </nav>
  );
}
