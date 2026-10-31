import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {TopBar} from "../core/app/ui/header/TopBar";
import {PageTitle} from "../core/app/ui/header/PageTitle";
import { AppShell } from "../core/app/ui/AppShell";
import { loadWorkspace } from "../core/app/loaders";

/**
 * The operator app layout. A raw anonymous `/app` request never reaches here:
 * `operatorDocumentGate` in the Worker answers it with the native 302 first.
 * This gate covers client navigation and a session that lapses mid-session, and
 * the identity RPC redirects to the safe `/app` entry. The native document gate
 * preserves the requested operator path and query when it issues a redirect.
 */
export const Route = createFileRoute("/app")({
  beforeLoad: async ({location,preload}) => {
    const panelNavigation = "slatePanelNavigation" in location.state && location.state.slatePanelNavigation === true;
    const workspace = await loadWorkspace({data:{path:location.pathname+location.searchStr,visit:!preload && !panelNavigation}});
    // SL1: one hop to a database's or record's one address; a client move keeps its fragment.
    if ("canonical" in workspace) throw redirect({ href: workspace.canonical + (location.hash ? `#${location.hash}` : ""), replace: true });
    if (workspace.setup.required && workspace.setup.canComplete) throw redirect({ to: "/setup" });
    return { workspace };
  },
  head: () => ({ meta: [{ title: "Workspace — Slate" }] }),
  component: AppLayout,
  notFoundComponent: () => <><TopBar trail={[{label:"Not found"}]}/><section className="main"><PageTitle>Not found</PageTitle><p>This address isn’t available.</p><a className="inline-flex min-h-11 items-center" href="/app">Go to Today</a></section></>,
});

function AppLayout() {
  const { workspace } = Route.useRouteContext();
  return (
    <AppShell snapshot={workspace}>
      <Outlet />
    </AppShell>
  );
}
