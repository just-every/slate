import {editorLeaf} from "../editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { TemplatesWorkspace } from "../core/features/templates/ui/workspace/TemplatesWorkspace";
export const Route = createFileRoute("/app/templates/")({
  validateSearch: (search: Record<string, unknown>) => ({
    containerId: typeof search.containerId === "string" ? search.containerId : undefined,
    parentPageId: typeof search.parentPageId === "string" ? search.parentPageId : undefined,
  }),
  component: editorLeaf(TemplatesPage),
});
function TemplatesPage() {
  const { containerId, parentPageId } = Route.useSearch();
  return <TemplatesWorkspace creationDestination={containerId ? { containerId, parentPageId: parentPageId ?? null } : undefined} />;
}
