import { editorBlocks, type DocumentView } from "../../../../client/content";
import { displayDate } from "../../../../app/ui/displayDate";
import { PageStatusBadge } from "./PageStatusBadge";
import { richTextToPlain } from "../../../editor/ui/types";
import { personInitials } from "../../../../shared/person-identity";

export function PageReadMetadata({ document }: { document: DocumentView }) {
  const page = document as DocumentView & { authorDisplayName?: string; ownerDisplayName?: string | null; updatedAt?: string };
  const text = editorBlocks(document.blocks).map(block => "text" in block ? richTextToPlain(block.text) : "code" in block ? block.code : "").join(" ").trim();
  const readingMinutes = Math.max(1, Math.ceil((text ? text.split(/\s+/u).length : 0) / 200));
  return <p className="page-byline">
    {"ownerDisplayName" in page ? <span className="byline-owner">{page.ownerDisplayName ? <span className="byline-avatar" aria-hidden="true">{personInitials(page.ownerDisplayName)}</span> : null}<span>Owner: {page.ownerDisplayName ?? "Unassigned"}</span></span> : null}
    {page.authorDisplayName ? <span className="byline-author">By {page.authorDisplayName}</span> : null}
    {document.policyProfile["page.status.v1"] === "open-vocabulary" ? <PageStatusBadge document={document} /> : null}
    <span className="byline-reading-time">{readingMinutes} min read</span>
    {page.updatedAt ? <time dateTime={page.updatedAt}>Updated {displayDate(page.updatedAt, false, "UTC")}</time> : null}
  </p>;
}
