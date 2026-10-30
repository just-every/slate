import { DeveloperAccess } from './DeveloperAccess';
import { useFlagshipEnabled } from "../../../../app/ui/LaunchProfile";
import { ChatNotifications } from "./ChatNotifications";
import { ContainerWorkspace } from "../../../containers/ui/workspace/ContainerWorkspace";
import { StatusSettings } from "../../../page-status/ui/workspace/StatusSettings";
import { AutomationWorkspace } from "../../../automation/ui/workspace/AutomationWorkspace";
import { ActivityWorkspace } from "../../../activity/ui/workspace/ActivityWorkspace";
import { PersonalPreferences } from "../../../navigation/ui/workspace/PersonalPreferences";
import { useEffect, useRef, useState } from "react";
import { ConnectionsPanel } from "../../../connectors/ui/workspace/ConnectionsPanel";
import { WorkspacePreferences } from "./WorkspacePreferences";
import { AppearancePanel } from "./AppearancePanel";
import { PortabilityPanel } from "./PortabilityPanel";
import { MembersPanel } from "./MembersPanel";
import { SamlSettings } from "./SamlSettings";
import { TopBar } from "../../../../app/ui/header/TopBar";
import { PageTitle } from "../../../../app/ui/header/PageTitle";
import { Link, useParams } from "@tanstack/react-router";
import { settingsSection, settingsSections } from "./settingsSections";
export function SettingsWorkspace() {
  const tabs = useRef<HTMLElement>(null);
  const [scrollReady, setScrollReady] = useState(false);
  // Links work from the server HTML; these controls need their React handlers.
  useEffect(() => setScrollReady(true), []);
  const flagship = useFlagshipEnabled();
  const section = settingsSection(useParams({ from: "/app/settings/$section" }).section);
  return (
    <>
      <TopBar trail={[{ label: "Settings" }]}>
        <a href="/app">Back to workspace</a>
      </TopBar>
      <section className="main settings-workspace">
        <PageTitle>Settings</PageTitle>
        <div className="settings-layout">
        <div className="settings-section-navigation" data-portability={section === "portability"}>
        <nav ref={tabs} className="section-list settings-tabs" aria-label="Settings sections">
          {settingsSections.filter(([id]) => flagship || id !== "connections").map(([id, label]) => (
            <Link
              key={id}
              to="/app/settings/$section"
              params={{ section: id }}
              replace
              aria-current={section === id ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="settings-scroll-controls">
          <button type="button" className="secondary-button" aria-label="Previous settings sections" data-tooltip="Previous settings sections" disabled={!scrollReady} onClick={() => tabs.current?.scrollBy({ left: -260, behavior: "smooth" })}>←</button>
          <span>Scroll for more sections</span>
          <button type="button" className="secondary-button" aria-label="More settings sections" data-tooltip="More settings sections" data-tooltip-align="end" disabled={!scrollReady} onClick={() => tabs.current?.scrollBy({ left: 260, behavior: "smooth" })}>→</button>
        </div>
        </div>
        <div className="settings-section">
        {section === "developer" ? <DeveloperAccess /> : section === "chat" ? (
          <ChatNotifications />
        ) : section === "spaces" ? (
          <ContainerWorkspace embedded />
        ) : section === "statuses" ? (
          <StatusSettings />
        ) : section === "automation" ? (
          <AutomationWorkspace />
        ) : section === "activity" ? (
          <ActivityWorkspace />
        ) : section === "preferences" ? (
          <PersonalPreferences />
        ) : section === "members" ? (
          <MembersPanel />
        ) : section === "saml" ? (
          <SamlSettings />
        ) : section === "appearance" ? (
          <AppearancePanel />
        ) : section === "connections" ? (
          flagship ? <ConnectionsPanel /> : <p role="status">Connections are unavailable in the core-wiki profile.</p>
        ) : section === "portability" ? (
          <PortabilityPanel />
        ) : (
          <WorkspacePreferences />
        )}
        </div>
        </div>
      </section>
    </>
  );
}
