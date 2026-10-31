import {editorLeaf} from "../editor-leaf";
import { createFileRoute, useMatch } from "@tanstack/react-router";
import { DatabaseWorkspace } from "../core/features/databases/ui/workspace/DatabaseWorkspace";
/** One database and its records share this layout, so the list stays mounted while records open and close (SL1). */
export const Route = createFileRoute("/app/databases/$databaseId")({
  component: editorLeaf(Page),
});
function Page() {
  const { databaseId } = Route.useParams();
  const record = useMatch({ from: "/app/databases/$databaseId/records/$recordId", shouldThrow: false });
  return <DatabaseWorkspace key={databaseId} id={databaseId} recordId={record?.params.recordId} />;
}
