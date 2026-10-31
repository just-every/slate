import { InitialResourcesProvider } from "../../client/InitialResources";
import {EditorMount} from "./EditorMount";
import { LaunchProfileProvider } from "./LaunchProfile";
import {AccessRequestHandler} from "../../features/sharing/ui/AccessRequestHandler";
import {RoutedSearchHighlight} from "../../features/search/ui/workspace/SearchHighlight";
import { KeyboardReference } from "./KeyboardReference";
import { PublicDuplicate } from "./PublicDuplicate";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import type { WorkspaceSnapshot } from "./workspaceSnapshot";
import { AppNavigation } from "./AppNavigation";
import { WorkspaceGate } from "./WorkspaceGate";
import { WorkspaceProvider } from "./WorkspaceContext";
import { useAppearance } from "../../client/useAppearance";
import { TooltipDismissal } from "../../ui/tooltip";

/** A database and its records share one shell, so the list stays mounted while its records open and close (SL1). */
const shellScope = (path?: string) => path?.replace(/^(\/app\/databases\/[^/]+)\/records\/[^/]+$/, "$1");

export function AppShell({
  snapshot,
  children,
}: {
  snapshot: WorkspaceSnapshot;
  children: ReactNode;
}) {
  const { member } = snapshot;
  useAppearance(snapshot.resources?.["/api/members/current"] as import("../../shared/api/workspace").MemberView | undefined);
  const [shortcuts, setShortcuts] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(()=>setOpen(false),[snapshot.resourcePath]);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        window.location.assign("/app/search");
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShortcuts(true);
      }
      if (event.key === "Escape" && !document.querySelector("dialog[open], [role=dialog]")) {
        setOpen(current => {
          if (current) navigationTrigger.current?.focus();
          return false;
        });
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  return (
    <LaunchProfileProvider initial={snapshot.profile}><WorkspaceProvider snapshot={snapshot}>
      {snapshot.editorEnabled && member.role === 'owner' ? <EditorMount ownerId={member.id} /> : null}
      <InitialResourcesProvider key={shellScope(snapshot.resourcePath)} resources={snapshot.resources ?? {}}><WorkspaceGate>
        <div className="slate-app">
          <TooltipDismissal />
          <PublicDuplicate />
          {shortcuts ? (
            <KeyboardReference onClose={() => setShortcuts(false)} />
          ) : null}
          <a className="skip-link" href="#workspace-content" onClick={event=>{
            const content=window.document.getElementById("workspace-content");
            if(!content)return;
            event.preventDefault();
            window.history.replaceState(window.history.state, "", "#workspace-content");
            content.focus();
            content.scrollIntoView({block:"start"});
          }}>
            Skip to content
          </a>
          <div className="mobile-bar">
            <button
              ref={navigationTrigger}
              type="button"
              aria-label={open ? "Close navigation" : "Open navigation"}
              data-tooltip={open ? "Close navigation" : "Open navigation"} data-tooltip-align="right"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
            <span data-rer-name>{member.workspaceName}</span>
          </div>
          <div className="app" data-navigation-open={open}>
            {open ? <button className="navigation-backdrop" aria-label="Close navigation" onClick={() => {setOpen(false);navigationTrigger.current?.focus();}} /> : null}
            <AppNavigation onNavigate={() => setOpen(false)} />
            <main className="center" id="workspace-content" tabIndex={-1}>
              <AccessRequestHandler /><RoutedSearchHighlight />
              {children}
            </main>
          </div>
        </div>
      </WorkspaceGate></InitialResourcesProvider>
    </WorkspaceProvider></LaunchProfileProvider>
  );
}
