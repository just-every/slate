import { X } from "lucide-react";
import { useState } from "react";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import type { DocumentView } from "../../../../client/content";
import { mutate, operationKey } from "../../../../client/transport";
import { CreateDecisionDialog } from "../../../decisions/ui/CreateDecisionDialog";
import { ReadableExportDialog } from "../../../workspace-export/ui/ReadableExportDialog";
import { SaveTemplateDialog } from "../../../templates/ui/workspace/SaveTemplateDialog";
import { PageAppearanceDialog } from "./PageAppearanceDialog";
import { PageTransferDialog } from "./PageTransferDialog";
import { WorkspacePublicationDialog } from "./WorkspacePublicationDialog";

/** The dialogs the page's More menu opens. */
export type PageDialog = "export" | "decision" | "move" | "duplicate" | "template" | "icon" | "cover" | "publish" | "cancel-schedule" | "discard-changes" | "archive" | "trash";

/** Renders the dialog the menu asked for, and the notice a saved template leaves behind. */
export function PageActionDialogs({
  dialog,
  document,
  revision,
  reload,
  onClose,
}: {
  dialog: PageDialog | null;
  document: DocumentView;
  revision: string;
  reload: () => void;
  onClose: () => void;
}) {
  const [templateSaved, setTemplateSaved] = useState(false);
  const id = document.page.id;
  async function perform(path: string, extra: object = {}) {
    await mutate(path, { operationKey: operationKey(), expectedRevisionId: revision, ...extra });
    await reload();
    window.dispatchEvent(new Event("slate:navigation-changed"));
  }
  return (
    <>
      {templateSaved ? (
        <p role="status" className="page-notice">
          Template saved. <a href="/app/templates">Open templates</a>
          <button type="button" aria-label="Dismiss" data-tooltip="Dismiss notice" onClick={() => setTemplateSaved(false)}>
            <X aria-hidden="true" />
          </button>
        </p>
      ) : null}
      {dialog === "export" ? <ReadableExportDialog id={id} onClose={onClose} /> : null}
      {dialog === "decision" ? <CreateDecisionDialog pageId={id} onClose={onClose} /> : null}
      {dialog === "move" || dialog === "duplicate" ? (
        <PageTransferDialog pageId={id} revision={revision} kind={dialog} onClose={onClose} onDone={(next) => window.location.assign(`/app/pages/${next}`)} />
      ) : null}
      {dialog === "template" ? (
        <SaveTemplateDialog sourcePageId={id} title={document.page.title} onClose={onClose} onSaved={() => setTemplateSaved(true)} />
      ) : null}
      {dialog === "icon" || dialog === "cover" ? (
        <PageAppearanceDialog
          document={document}
          revision={revision}
          kind={dialog}
          onClose={onClose}
          onSaved={() => {
            reload();
            window.dispatchEvent(new Event("slate:navigation-changed"));
          }}
        />
      ) : null}
      {dialog === "publish" ? <WorkspacePublicationDialog document={document} revision={revision} onClose={onClose} onSaved={reload} /> : null}
      {dialog === "archive" || dialog === "trash" || dialog === "cancel-schedule" || dialog === "discard-changes" ? (
        <ActionDialog
          title={dialog === "archive" ? "Archive this page?" : dialog === "trash" ? "Move this page to trash?" : "Confirm this page change"}
          action="Confirm"
          onClose={onClose}
          onSubmit={async (data) => {
            if (dialog === "archive" || dialog === "trash") await perform(`/api/archive/${id}`, { action: dialog, reason: String(data.get("reason") ?? "") });
            else await perform(`/api/pages/${id}/${dialog}`);
          }}
        >
          <p>This changes the page for everyone who can access it. Its history is retained.</p>
          <label>
            Reason
            <input name="reason" />
          </label>
        </ActionDialog>
      ) : null}
    </>
  );
}
