import {editorLeaf} from "../editor-leaf";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsWorkspace } from "../core/features/settings/ui/workspace/SettingsWorkspace";
import { settingsSection } from "../core/features/settings/ui/workspace/settingsSections";
export const Route = createFileRoute("/app/settings/$section")({
  beforeLoad: ({ params }) => { if (settingsSection(params.section) !== params.section) throw redirect({ to: "/app/settings/$section", params: { section: "workspace" }, replace: true }); },
  component: editorLeaf(SettingsWorkspace),
});
