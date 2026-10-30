import { Link, useLocation } from "@tanstack/react-router";
import { useFlagshipEnabled } from "./LaunchProfile";
import { isFlagshipPath } from "../../platform/config/launch-profile";
import {ScheduledPublication} from './ScheduledPublication';
import {mutate,operationKey,errorMessage} from "../../client/transport";
import { type TreePage } from "./PageTree";
import {
  CalendarDays,
  Inbox,
  Folder,
  Compass,
  Search,
  Settings,
  Archive,
  ArrowUp,
  LayoutTemplate,
  X,
  ShieldCheck,
  ListTodo,
} from "lucide-react";
import { lazy, Suspense, useEffect,useState } from "react";
import { NavigationCreate } from "./NavigationCreate";
import { ExtensionSlot } from "../ext-client";
import type { PageResult } from "../../shared/api/common";
import { useResource } from "../../client/useResource";
import { useWorkspace } from "./WorkspaceContext";
const CreateDatabaseDialog=lazy(()=>import("../../features/databases/ui/workspace/CreateDatabaseDialog").then(module=>({default:module.CreateDatabaseDialog})));
import { useCreatePage } from "./useCreatePage";
import { useInferredSpace } from "./useInferredSpace";
import { DEFAULT_PAGE_TITLE, type SpaceChoice } from "./pageDestination";
import { SidebarHeader } from "./SidebarHeader";
import { SpaceTrees, type NavigationDatabases } from "./SpaceTrees";
import { AccountMenu } from "./AccountMenu";

const destinationIcons: Record<string, typeof Search> = {"/app":CalendarDays,"/app/search":Search,"/app/inbox":Inbox,"/app/tasks":ListTodo,"/app/review":ShieldCheck,"/app/containers":Folder,"/app/templates":LayoutTemplate,"/app/archive":Archive,"/app/settings":Settings};

export function AppNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { member } = useWorkspace();
  return <MemberNavigation key={`${member.workspaceId}:${member.id}`} onNavigate={onNavigate} />;
}

function MemberNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { member, workspace, navigation } = useWorkspace();
  const flagship = useFlagshipEnabled();
  const pages = useResource<PageResult<TreePage>>("/api/pages");
  const databases = useResource<NavigationDatabases>(
    "/api/databases",
  );
  useEffect(() => {
    const refreshRecents = () => { void navigation.reload(); };
    const refreshTree = () => { refreshRecents(); void pages.reload(); void databases.reload(); };
    window.addEventListener("slate:page-opened", refreshRecents);
    window.addEventListener("slate:navigation-changed", refreshTree);
    return () => {
      window.removeEventListener("slate:page-opened", refreshRecents);
      window.removeEventListener("slate:navigation-changed", refreshTree);
    };
  }, [navigation.reload, pages.reload, databases.reload]);
  const containers=useResource<{items:SpaceChoice[]}>(navigation.data?.isGuest ? null : "/api/containers");
  const review=useResource<{count:number}>("/api/status/review/count");
  useEffect(()=>{const refresh=()=>{void review.reload();};window.addEventListener("slate:review-changed",refresh);return()=>window.removeEventListener("slate:review-changed",refresh);},[review.reload]);
  const { pathname } = useLocation();
  const viewed = /^\/app\/(pages|containers)\/([^/]+)$/.exec(pathname);
  const currentSpace = viewed?.[1] === "containers" ? decodeURIComponent(viewed[2]) : viewed ? pages.data?.items.find((page) => page.id === decodeURIComponent(viewed[2]))?.containerId : null;
  const destination = useInferredSpace(currentSpace, containers);
  const creation = useCreatePage();
  const [createDatabase, setCreateDatabase] = useState(false);
  const [error,setError]=useState<unknown>();
  const collapsed = navigation.data?.preferences.value.sidebarCollapsed === true;
  function toggleSidebar() {
    if (!navigation.data) return;
    const { revisionId, value } = navigation.data.preferences;
    void mutate("/api/navigation/preferences",{operationKey:operationKey(),expectedRevisionId:revisionId,value:{...value,sidebarCollapsed:!value.sidebarCollapsed}},"PUT").then(navigation.reload).catch(setError);
  }
  return (
    <aside className="sidebar" data-collapsed={navigation.data?.preferences.value.sidebarCollapsed}>
      <SidebarHeader name={workspace.data?.name ?? member.workspaceName} collapsed={collapsed} onToggle={toggleSidebar} />
      <div className="sidebar-content">
      <nav
        className="primary"
        aria-label="Workspace navigation"
        onClick={onNavigate}
      >
        {navigation.data?.configuration?.destinations.filter(item=>item.visible && (flagship || !isFlagshipPath(item.href))).map(item=><Link key={item.id} className="navlink" to={item.href} activeOptions={{ exact: item.href === "/app" }} activeProps={{ className: "" }}>{(() => { const Icon = destinationIcons[item.href] ?? Compass; return <Icon aria-hidden="true"/>; })()}<span>{item.label}</span>{item.href==='/app/search'?<span className="shortcut">⌘ K</span>:null}{item.href==='/app/review'&&review.data?.count?<span className="nav-count"><span aria-hidden="true">{review.data.count}</span><span className="sr-only">{`, ${review.data.count} ${review.data.count===1?'page needs':'pages need'} your review`}</span></span>:null}</Link>)}
      </nav>
      {navigation.data?.favourites.length ? (
        <nav className="favourites" aria-label="Favourites">
          <p className="sidebar-label">Favourites</p>
          {navigation.data.favourites
            .map((item) => (
              <div key={item.id} className="favourite-row"><a className="navlink" href={item.href}><span>{item.title}</span><ScheduledPublication page={item}/></a><button className="icon-action" aria-label={`Move ${item.title} up`} data-tooltip="Move favourite" data-tooltip-align="end" onClick={()=>{const at=navigation.data!.favourites.findIndex(f=>f.id===item.id);if(at<1)return;void mutate("/api/navigation/favourites",{operationKey:operationKey(),kind:item.kind,id:item.id,enabled:true,position:at-1},"PUT").then(navigation.reload).catch(setError);}}><ArrowUp aria-hidden="true"/></button><button className="icon-action" aria-label={`Unfavourite ${item.title}`} data-tooltip="Remove favourite" data-tooltip-align="end" onClick={()=>void mutate("/api/navigation/favourites",{operationKey:operationKey(),kind:item.kind,id:item.id,enabled:false},"PUT").then(navigation.reload).catch(setError)}><X aria-hidden="true"/></button></div>
            ))}
        </nav>
      ) : null}
      {!navigation.data?.isGuest ? <NavigationCreate pageDestination={destination.space === undefined ? undefined : destination.space?.name ?? null} pending={creation.pending} onPage={() => void creation.create(async () => ({ containerId: (await destination.resolve())?.id ?? null, title: DEFAULT_PAGE_TITLE }))} onDatabase={() => setCreateDatabase(true)} /> : null}
      {creation.error ? <p role="alert">{errorMessage(creation.error)}</p>:null}
      {error ? <p role="alert">{errorMessage(error)}</p>:null}
      <p className="sidebar-label pagesbar">Pages</p>
      <SpaceTrees pages={pages} containers={containers} databases={databases} navigation={navigation} onError={setError} onNavigate={onNavigate} />
      <ExtensionSlot id="workspace.navigation.after.v1" />
      <AccountMenu />
      </div>
      {createDatabase ? (
        <Suspense fallback={null}><CreateDatabaseDialog onClose={() => setCreateDatabase(false)} /></Suspense>
      ) : null}
      {creation.prompt}
    </aside>
  );
}
