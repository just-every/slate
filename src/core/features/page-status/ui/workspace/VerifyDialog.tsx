import { useRef, useState } from "react";
import { usePageRevisionSave } from "../../../../client/usePagePropertySave";
import { PagePropertyConflict } from "../../../pages/ui/workspace/PagePropertyConflict";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import type { VerificationExpiryChoice } from "../types";

const choices: { value: VerificationExpiryChoice; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "date", label: "On a date" },
  { value: "none", label: "No expiry" },
];

/** A chosen date lasts to the end of that day where the verifier is. */
const endOfDay = (date: string) => new Date(`${date}T23:59:59.999`).toISOString();
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };

/**
 * STAT-003: one person attests the exact revision they opened, with an expiry of 7, 30
 * or 90 days (counted by the server), a date, or none. The server refuses an unopened or
 * outdated revision; the dialog shows its reason.
 */
export function VerifyDialog({ pageId, statusKey, expectedRevisionId, attestRevisionId, openedCurrent, reviewRequest, onClose, onVerified }: {
  pageId: string;
  statusKey: string;
  expectedRevisionId: string;
  attestRevisionId: string;
  openedCurrent?: boolean;
  reviewRequest?: { id: string; assignmentGeneration: number; expectedRevisionId: string };
  onClose: () => void;
  onVerified: () => void | Promise<void>;
}) {
  const [choice, setChoice] = useState<VerificationExpiryChoice>("90");
  const pending = usePageRevisionSave(expectedRevisionId);
  const reviewed = useRef({ attestRevisionId, reviewRequest });
  return (
    <ActionDialog
      title="Verify this exact revision"
      action="I reviewed this revision"
      onClose={onClose}
      onSubmit={async (data) => {
        const date = String(data.get("expiryDate") ?? "");
        if (choice === "date" && !date) throw new Error("Choose the date the verification expires.");
        await pending.save(`/api/status/page/${pageId}`, {
          statusKey,
          attestRevisionId: reviewed.current.attestRevisionId,
          ...(reviewed.current.reviewRequest ? { reviewRequest: reviewed.current.reviewRequest } : {}),
          ...(choice === "date" ? { expiresAt: endOfDay(date) } : choice === "none" ? { expiresAt: null } : { expiresInDays: Number(choice) }),
        });
        // The attestation is saved. A pending queue refresh must not keep the
        // successful action open or later dismiss a newly opened dialog.
        onClose();
        await onVerified();
        return false;
      }}
    >
      {pending.conflict ? <PagePropertyConflict/> : null}
      <p>
        You confirm that you read this page as it is now and that it is right.
        Slate records you as its verifier. No automated check can do this for you.
      </p>
      {openedCurrent === false ? (
        <p className="verify-warning">
          The visit to this revision is not confirmed yet. Refresh the page,
          review the current content, then verify it again.
        </p>
      ) : null}
      <fieldset className="verify-expiry">
        <legend>Verification expires after</legend>
        {choices.map((item) => (
          <label key={item.value}>
            <input type="radio" name="expiry" value={item.value} checked={choice === item.value} onChange={() => setChoice(item.value)} />
            {item.label}
          </label>
        ))}
        {choice === "date" ? (
          <label>
            Expiry date
            <input name="expiryDate" type="date" min={today()} required />
          </label>
        ) : null}
      </fieldset>
    </ActionDialog>
  );
}
