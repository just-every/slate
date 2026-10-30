/** Every Settings section has its own path, /app/settings/<id>; the old ?section=<id> address redirects there. */
export const settingsSections = [
  ["workspace", "Workspace"],
  ["members", "People"],
  ["saml", "SAML single sign-on"],
  ["developer", "Developer access"],
  ["appearance", "Appearance"],
  ["preferences", "Preferences"],
  ["activity", "Activity"],
  ["automation", "Automations"],
  ["statuses", "Statuses"],
  ["spaces", "Spaces"],
  ["chat", "Chat notifications"],
  ["connections", "Connections"],
  ["portability", "Import & export"],
] as const;
export type SettingsSection = (typeof settingsSections)[number][0];
/** A known section id, or Workspace for a missing or unknown one. */
export function settingsSection(value: unknown): SettingsSection {
  return settingsSections.find(([id]) => id === value)?.[0] ?? "workspace";
}
