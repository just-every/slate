import { useState } from "react";
import { useResource } from "../../../../client/useResource";
import { RequestState } from "../../../../app/ui/RequestState";
import { TopBar } from "../../../../app/ui/header/TopBar";
import { PageTitle } from "../../../../app/ui/header/PageTitle";
import { displayDate } from "../../../../app/ui/displayDate";
import { SectionLabel } from "../../../../app/ui/SectionLabel";
import type { ReviewCounts, ReviewFilter, ReviewItem } from "../../review";
import { BulkVerifyDialog } from "./BulkVerifyDialog";
import { RequestedReviewQueue } from "./RequestedReviewQueue";
import { VerifyDialog } from "./VerifyDialog";

interface ReviewResponse { items: ReviewItem[]; total: number; counts: ReviewCounts; canBulkVerify: boolean; nextCursor?: string }

const stateLabel: Record<ReviewItem["state"], string> = {
  lapsed: "Lapsed",
  changed: "Changed since verified",
  expiring: "Expires soon",
  current: "Verified",
};

/** Tells the sidebar count that a verification changed. */
export const reviewChanged = () => window.dispatchEvent(new Event("slate:review-changed"));

function expiryText(item: ReviewItem) {
  if (!item.expiresAt) return "No expiry";
  return `${item.state === "lapsed" ? "Lapsed" : "Expires"} ${displayDate(item.expiresAt, true)}`;
}

function changesText(item: ReviewItem) {
  if (item.verifiedRevisionId === item.workingRevisionId) return "No changes since it was verified";
  if (!item.revisionsSince) return "Changed since it was verified";
  return `${item.revisionsSince} ${item.revisionsSince === 1 ? "revision" : "revisions"} since it was verified${item.editorsSince.length ? ` by ${item.editorsSince.join(", ")}` : ""}`;
}

/**
 * STAT-003/STAT-004 as a list a team lead works through: lapsed, expiring within 14
 * days, changed since verified, and (for workspace owners) verified by someone who left.
 * Each row is one page; reviewing and verifying again stay one person's own actions.
 */
export function ReviewQueue() {
  const [filter, setFilter] = useState<ReviewFilter>("everyone");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const resource = useResource<ReviewResponse>(`/api/status/review?filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<ReviewItem[]>();
  const [verifying, setVerifying] = useState<ReviewItem>();
  const counts = resource.data?.counts;
  const choose = (next: ReviewFilter) => { setFilter(next); setCursors([]); setSelected([]); };
  const tab = (value: ReviewFilter, label: string, count?: number | null) => (
    <button type="button" aria-pressed={filter === value} onClick={() => choose(value)}>
      {label}{count === undefined || count === null ? "" : ` (${count})`}
    </button>
  );
  return (
    <>
      <TopBar trail={[{ label: "Needs review" }]} />
      <section className="main review-workspace">
        <PageTitle>Needs review</PageTitle>
        <p className="page-lede">Pages whose verification has lapsed, lapses within 14 days, or predates their last change.</p>
        <RequestedReviewQueue/>
        <SectionLabel>Verification health</SectionLabel>
        <div className="tabs" role="group" aria-label="Whose verifications">
          {tab("mine", "Mine", counts?.mine)}
          {tab("everyone", "Everyone", counts?.everyone)}
          {counts?.noVerifier !== null && counts?.noVerifier !== undefined ? tab("no-verifier", "No active verifier", counts.noVerifier) : null}
        </div>
        {resource.data?.canBulkVerify && selected.length ? <div className="control-row"><button type="button" className="secondary-button" onClick={() => setBulk(resource.data!.items.filter(i => selected.includes(i.pageId) && i.canVerify && i.openedCurrent))}>Verify selected opened revisions</button></div> : null}
        <RequestState loading={resource.loading} error={resource.error} retry={resource.reload}>
          {resource.data?.items.length ? (
            <ul className="archive-list review-list row-list">
              {resource.data.items.map((item) => (
                <li key={item.pageId} data-state={item.state}>
                  {resource.data?.canBulkVerify ? <label><input type="checkbox" aria-label={`Select ${item.title}`} disabled={!item.canVerify || !item.openedCurrent} checked={selected.includes(item.pageId)} onChange={e => setSelected(e.target.checked ? [...selected, item.pageId] : selected.filter(id => id !== item.pageId))}/>Select</label> : null}
                  <div>
                    <h2><a href={`/app/pages/${encodeURIComponent(item.pageId)}`}>{item.title}</a></h2>
                    <p className="review-facts">
                      <span className="page-status-chip" data-state={item.state}>{stateLabel[item.state]}</span>
                      {item.containerName ? <span>{item.containerName}</span> : null}
                      <span>Verified by {item.verifier.displayName}{item.verifier.active ? "" : " (no longer a member)"} on {displayDate(item.verifiedAt)}</span>
                      <span>{expiryText(item)}</span>
                    </p>
                    <p className="muted">{changesText(item)}</p>
                  </div>
                  <a className="secondary-button" href={item.reviewHref}>Review</a>
                  {item.canVerify && item.openedCurrent ? (
                    <button type="button" className="secondary-button" onClick={() => setVerifying(item)}>Verify again</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>{filter === "mine" ? "None of your verifications needs review." : filter === "no-verifier" ? "Every verified page has an active verifier." : "Nothing needs review."}</p>
          )}
          {cursors.length || resource.data?.nextCursor ? <div className="list-paging">
            {cursors.length ? <button type="button" className="text-button" onClick={() => setCursors([])}>First page</button> : null}
            {resource.data?.nextCursor ? <button type="button" className="text-button" onClick={() => setCursors([...cursors, resource.data!.nextCursor!])}>Next page</button> : null}
          </div> : null}
        </RequestState>
        {bulk?.length ? <BulkVerifyDialog items={bulk} onClose={() => setBulk(undefined)} onSaved={async () => { setSelected([]); await resource.reload(); reviewChanged(); }}/> : null}
        {verifying ? (
          <VerifyDialog
            pageId={verifying.pageId}
            statusKey={verifying.statusKey}
            expectedRevisionId={verifying.pageRevisionId}
            attestRevisionId={verifying.workingRevisionId}
            openedCurrent={verifying.openedCurrent}
            onClose={() => setVerifying(undefined)}
            onVerified={async () => { await resource.reload(); reviewChanged(); }}
          />
        ) : null}
      </section>
    </>
  );
}
