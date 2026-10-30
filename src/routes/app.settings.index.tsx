import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { settingsSection } from "../core/features/settings/ui/workspace/settingsSections";
/** Settings opens on its first section; an old ?section= address lands on that section's own path. */
export const Route = createFileRoute("/app/settings/")({
  validateSearch: z.object({ section: z.string().optional() }),
  beforeLoad: ({ search }) => { throw redirect({ to: "/app/settings/$section", params: { section: settingsSection(search.section) }, replace: true }); },
});
