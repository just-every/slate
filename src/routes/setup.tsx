import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { loadWorkspace } from "../core/app/loaders";
import { SetupShell } from "../core/app/ui/SetupShell";

export const Route = createFileRoute("/setup")({
  validateSearch: z.object({ step: z.coerce.number().int().min(1).max(3).optional().catch(undefined) }),
  beforeLoad: async () => {
    const workspace = await loadWorkspace();
    if ("canonical" in workspace || !workspace.setup.required || !workspace.setup.canComplete) throw redirect({ to: "/app" });
    return { workspace };
  },
  head: () => ({ meta: [{ title: "Set up your workspace — Slate" }], links: [{ rel: "stylesheet", href: "/rer-theme.css" }] }),
  component: Setup,
});

function Setup() {
  return <SetupShell snapshot={Route.useRouteContext().workspace} />;
}
