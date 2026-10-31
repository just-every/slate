import {PageMetadata} from "./PageMetadata";
import type {PageSelection} from "./selection";
import type { DocumentView } from "../../../../client/content";
import { PageComments } from "./PageComments";
import { PageHistory } from "./PageHistory";
import { PageSharing } from "./PageSharing";
import { PageAsk } from "./PageAsk";
import { PageDisplay } from "./PageDisplay";
import { PagePublication } from "./PagePublication";
import { AnalyticsPanel } from "../../../analytics/ui/workspace/AnalyticsPanel";
import { PageStatusPanel } from "../../../page-status/ui/workspace/PageStatusPanel";

/** The side panels of a page, by the `detail` they are opened with, and the name each region carries. */
export const panelTitles: Record<string, string> = {
  details: "Details",
  comments: "Comments",
  history: "History",
  share: "Share page",
  ask: "Ask",
  status: "Page status",
  readership: "Readership & contributors",
  display: "Display settings",
  publication: "Public access",
};

/** The panels a page opens beside it; each is chosen from the top bar or from the More menu. */
export function PageDetails({
  kind,
  selection,
  document,
  revision,
  onClose,
  reload,
  onCommentSent,
  address,
}: {
  kind: string;
  selection?: PageSelection;
  document: DocumentView;
  revision: string;
  onClose: () => void;
  reload: () => void;
  onCommentSent: () => void;
  /** The page's one address, for Copy page link. */
  address?: string;
}) {
  return (
    <>
      <button className="detail-close" type="button" onClick={onClose}>
        Close details ×
      </button>
      {kind === "details" ? <PageMetadata document={document} revision={revision} reload={reload}/> : kind === "comments" ? (
        <PageComments title="Comments" document={document} selection={selection} onSent={onCommentSent} />
      ) : kind === "history" ? (
        <PageHistory document={document} revision={revision} reload={reload} />
      ) : kind === "share" ? (
        <PageSharing document={document} address={address} />
      ) : kind === "ask" ? (
        <PageAsk document={document} selection={selection} />
      ) : kind === "status" ? (
        <section>
          <h2>Page status</h2>
          <PageStatusPanel pageId={document.page.id} revision={revision} workingRevisionId={document.workingRevisionId} canEdit={document.permissions.canEdit} onSaved={reload}/>
        </section>
      ) : kind === "readership" ? (
        <section>
          <h2>Readership & contributors</h2>
          <AnalyticsPanel pageId={document.page.id} />
        </section>
      ) : kind === "display" ? (
        <PageDisplay document={document} revision={revision} reload={reload} />
      ) : kind === "publication" ? (
        <section>
          <h2>Public access</h2>
          <PagePublication document={document} revision={revision} />
        </section>
      ) : null}
    </>
  );
}
