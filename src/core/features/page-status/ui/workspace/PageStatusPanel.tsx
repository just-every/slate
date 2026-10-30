import {useWorkspace} from "../../../../app/ui/WorkspaceContext";
import { useEffect, useRef, useState } from "react";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey } from "../../../../client/transport";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { RequestState } from "../../../../app/ui/RequestState";
import { PageReviewRequests } from "./PageReviewRequests";
import { PageRuleFlags } from "../../rules/ui/PageRuleFlags";
import { VerifyDialog } from "./VerifyDialog";
import { reviewChanged } from "./ReviewQueue";
import { VerificationSummary, type VerificationView } from "./VerificationSummary";
export type StatusEntry = {
  key: string;
  label: string;
  color: string;
  requiresVerification: number | boolean;
  retiredAt: string | null;
};
export function PageStatusPanel({
  pageId,
  revision,
  workingRevisionId,
  canEdit,
  onSaved,
}: {
  pageId: string;
  revision: string;
  workingRevisionId:string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const {workspace,member}=useWorkspace();
  const verificationOnly=workspace.data?.policies["page.status.v1"] === "verification-only";
  const statuses = useResource<{ items: StatusEntry[] }>("/api/status");
  const verification = useResource<{ verification: null | VerificationView }>(`/api/status/page/${pageId}`);
  const [again, setAgain] = useState(false);
  // The page records its opening after this panel may have loaded; refresh so the dialog knows.
  useEffect(() => {
    const opened = () => { void verification.reload(); };
    window.addEventListener("slate:page-opened", opened);
    return () => window.removeEventListener("slate:page-opened", opened);
  }, [verification.reload]);
  const [custom,setCustom]=useState(false);
  useEffect(() => { if (verificationOnly) setCustom(false); }, [verificationOnly]);
  const [selected, setSelected] = useState<string | null>(null);
  const key = useRef("");
  const selectedStatus = statuses.data?.items.find(
    (item) => item.key === selected,
  );
  return (
    <section>
      <h3>Status & human verification</h3>
      <RequestState
        loading={statuses.loading || verification.loading}
        error={statuses.error || verification.error}
        retry={() => {
          statuses.reload();
          verification.reload();
        }}
      >
        {verification.data?.verification ? (
          <VerificationSummary pageId={pageId} verification={verification.data.verification} canEdit={canEdit} />
        ) : (
          <p>No human verification recorded.</p>
        )}
        <PageRuleFlags pageId={pageId} />
        {canEdit && verification.data?.verification?.state && verification.data.verification.state !== "current" ? (
          <button type="button" className="secondary-button" onClick={() => setAgain(true)}>Verify again</button>
        ) : null}
        {canEdit ? (
          <>
            <label>
              Set page status
              <select
                value=""
                onChange={(event) => {
                  key.current = operationKey();
                  setSelected(event.target.value);
                }}
              >
                <option value="" disabled>
                  Choose a status
                </option>
                {statuses.data?.items
                  .filter((item) => !item.retiredAt && (!verificationOnly || item.requiresVerification))
                  .map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                      {item.requiresVerification ? " · human verification" : ""}
                    </option>
                  ))}
                <option value="__clear">Clear status</option>
              </select>
            </label>
            {statuses.data?.items.length === 0 ? (
              <p>Workspace owners can create statuses in Settings.</p>
            ) : null}
          </>
        ) : null}
      </RequestState>
      <PageReviewRequests pageId={pageId} pageRevisionId={revision} onSaved={async()=>{await verification.reload();await onSaved();}}/>
      {!verificationOnly && canEdit && member.role==='owner'?<button onClick={()=>setCustom(true)}>Create a custom status</button>:null}
      {custom && !verificationOnly && canEdit && member.role==='owner'?<ActionDialog title="Create custom page status" action="Create and set status" onClose={()=>setCustom(false)} onSubmit={async data=>{const statusKey=crypto.randomUUID();await mutate('/api/status',{operationKey:operationKey(),key:statusKey,label:String(data.get('label')),color:String(data.get('color')),requiresVerification:false});await mutate(`/api/status/page/${pageId}`,{operationKey:operationKey(),expectedRevisionId:revision,statusKey});await statuses.reload();await onSaved();}}><label>Custom status label<input name="label" maxLength={20} required/></label><label>Status colour<input name="color" type="color" defaultValue="#54735b"/></label></ActionDialog>:null}
      {again && verification.data?.verification ? (
        <VerifyDialog
          pageId={pageId}
          statusKey={verification.data.verification.status_key}
          expectedRevisionId={revision}
          attestRevisionId={workingRevisionId}
          openedCurrent={verification.data.verification.openedCurrent && verification.data.verification.workingRevisionId === workingRevisionId}
          onClose={() => setAgain(false)}
          onVerified={async () => { await verification.reload(); await onSaved(); reviewChanged(); }}
        />
      ) : null}
      {selected && selectedStatus?.requiresVerification ? (
        <VerifyDialog
          pageId={pageId}
          statusKey={selected}
          expectedRevisionId={revision}
          attestRevisionId={workingRevisionId}
          openedCurrent={verification.data?.verification ? verification.data.verification.openedCurrent && verification.data.verification.workingRevisionId === workingRevisionId : undefined}
          onClose={() => setSelected(null)}
          onVerified={async () => { await verification.reload(); await onSaved(); reviewChanged(); }}
        />
      ) : selected ? (
        <ActionDialog
          title="Change page status"
          action="Set status"
          onClose={() => setSelected(null)}
          onSubmit={async () => {
            await mutate(`/api/status/page/${pageId}`, {
              operationKey: key.current,
              expectedRevisionId: revision,
              statusKey: selected === "__clear" ? null : selected,
            });
            await verification.reload();
            await onSaved();
          }}
        >
          <p>
            {selected === "__clear"
              ? "Remove the current status."
              : `Set the status to ${selectedStatus?.label}.`}
          </p>
        </ActionDialog>
      ) : null}
    </section>
  );
}
