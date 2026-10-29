import { AccessExpiry } from "../../../../app/ui/AccessExpiry";
import { displayDate } from "../../../../app/ui/displayDate";
import { useEffect, useState } from "react";
import { useResource } from "../../../../client/useResource";
import {
  mutate,
  operationKey,
  errorMessage,
} from "../../../../client/transport";
import type { DocumentView } from "../../../../client/content";
import type { MemberView, GroupView } from "../../../../shared/api/workspace";
import { RequestState } from "../../../../app/ui/RequestState";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
interface Grant {
  id: string;
  principalKind: string;
  principalId: string;
  level: string;
  expiresAt: string | null;
  revokedAt: string | null;
  principalLabel?:string;
  origin?:{kind:string;id:string|null;name:string};
  inherited?:boolean;
  status?:string;
  effective?:boolean;
  invitationId?:string;
  invitationEmail?:string;
  invitationExpiresAt?:string;

}
function accessLabel(level: string) { return ({view:"View",comment:"Comment",edit:"Edit",full:"Manage access"} as Record<string,string>)[level] ?? level; }
export function PageSharing({ document }: { document: DocumentView }) {
  const { workspace, localDevelopment, member } = useWorkspace();
  const grants = useResource<{ items: Grant[]; inheritedItems?:Grant[]; effectiveItems?:Grant[];levels?:string[];container?:{id:string;name:string};restricted?:boolean }>(
    document.permissions.canShare
      ? `/api/sharing/pages/${document.page.id}`
      : null,
  );
  const members = useResource<{ items: MemberView[] }>(
    document.permissions.canShare ? "/api/members" : null,
  );
  const guests = useResource<{items:MemberView[]}>(document.permissions.canShare && member.role === "owner" ? "/api/guests" : null);
  const groups = useResource<{ items: GroupView[] }>(
    document.permissions.canShare && member.role === "owner" ? "/api/groups" : null,
  );
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [invited,setInvited]=useState("");
  const referencedGrant = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("grant");
  useEffect(() => { if (referencedGrant) window.document.getElementById(`grant-${referencedGrant}`)?.scrollIntoView({block:"center"}); }, [referencedGrant, grants.data]);
  async function save(value: Partial<Grant> & { revoke?: boolean }) {
    setPending(true);
    setError(undefined);
    try {
      await mutate("/api/sharing", {
        operationKey: operationKey(),
        targetKind: "page",
        targetId: document.page.id,
        id: value.id,
        principalKind: value.principalKind,
        principalId: value.principalId,
        level: value.level,
        expiresAt: value.expiresAt,
        revoke: value.revoke,
      });
      grants.reload();
      window.dispatchEvent(new Event('slate:navigation-changed'));
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }
  function name(grant: Grant) {
    if(grant.principalLabel)return grant.principalLabel;
    if(grant.invitationEmail)return grant.invitationEmail;
    if (grant.principalKind === "workspace")
      return "Everyone in this workspace";
    if (grant.principalKind === "container")
      return `Everyone in ${grants.data?.container?.name ?? "this space"}`;
    return (
      members.data?.items.find((item) => item.id === grant.principalId)
        ?.displayName ??
      groups.data?.items.find((item) => item.id === grant.principalId)?.name ??
      "Former member or group"
    );
  }
  return (
    <section>
      <h2>Share this page</h2>
      <p className="muted">Invite people to this page. Copying its link does not change who can access it.</p>
      <p className="muted">Access changes stay in <a href="/app/settings?section=activity">Activity</a>; reviewing them does not restore access.</p>
      <button className="secondary-button"
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(`${window.location.origin}/app/pages/${document.page.id}`)
            .then(() => setCopied(true))
            .catch(setError);
        }}
      >
        {copied ? "Link copied" : "Copy page link"}
      </button>
      {!document.permissions.canShare ? (
        <p>You need full access to change who can read this page.</p>
      ) : (
        <RequestState
          loading={grants.loading}
          error={grants.error}
          retry={grants.reload}
        >
          <section aria-label="Who has access"><h3>Who has access</h3>
          {grants.data?.inheritedItems?.length ? (
            <section aria-label="Inherited access">
              <h3>Inherited access</h3>
              <ul className="inherited-grant-list">
                {grants.data.inheritedItems.map(grant => (
                  <li key={grant.id} data-grant-id={grant.id}>
                    {name(grant)} · {accessLabel(grant.level)} · {grant.status} · From {grant.origin?.name}
                    {grant.expiresAt ? ` · ${grant.status === "expired" ? "Expired" : "Expires"} ${displayDate(grant.expiresAt, true)}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ul className="grant-list">
            {grants.data?.items.map((grant) => (
              <li key={grant.id} data-grant-id={grant.id} id={`grant-${grant.id}`} aria-current={referencedGrant === grant.id ? "true" : undefined}>
                {referencedGrant === grant.id ? <strong>Referenced grant</strong> : null}
                <span>{name(grant)}{grant.invitationId ? ` · ${grant.status??"Pending"} invitation` : ""}{grant.expiresAt ? ` · ${new Date(grant.expiresAt)<new Date()?"Expired":"Expires"} ${displayDate(grant.expiresAt, true)}` : ""}</span>
                {grant.revokedAt ? (
                  <span>Revoked {!grant.invitationId?<button disabled={pending} onClick={()=>void save({...grant,expiresAt:null})}>Regrant access</button>:null}</span>
                ) : (
                  <>
                    <select
                      aria-label={`Access for ${name(grant)}`}
                      value={grant.level}
                      disabled={pending || !!grant.invitationId}
                      onChange={(event) =>
                        void save({ ...grant, level: event.target.value })
                      }
                    >
                      {!grants.data?.levels?.includes(grant.level)?<option value={grant.level} disabled>{grant.level} (stored)</option>:null}
                      {(grants.data?.levels ?? []).map((level) => (
                        <option key={level} value={level}>{accessLabel(level)}</option>
                      ))}
                    </select>
                    {grant.status==='expired'&&!grant.invitationId?<button disabled={pending} onClick={()=>void save({...grant,expiresAt:null})}>Regrant access</button>:null}
                    <details><summary>Expiry & removal</summary>{!grant.invitationId ? <label>Access expires<AccessExpiry value={grant.expiresAt} onSave={expiresAt => {if(expiresAt!==grant.expiresAt)void save({...grant,expiresAt});}}/></label> : null}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void save({ ...grant, revoke: true })}
                    >
                      Remove access
                    </button></details>
                  </>
                )}
              </li>
            ))}
          </ul>
          </section>
          <form
            className="detail-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const [principalKind, principalId] = String(
                data.get("principal"),
              ).split(":");
              void save({
                principalKind,
                principalId,
                level: String(data.get("level")),
                expiresAt:data.get("expiresAt") ? new Date(String(data.get("expiresAt"))).toISOString():null,
              });
            }}
          >
            <label>
              Invite someone
              <select name="principal" required defaultValue="">
                <option value="" disabled>
                  Choose a person or group
                </option>
                {[...(members.data?.items??[]),...(guests.data?.items??[])].map((member) => (
                  <option key={member.id} value={`member:${member.id}`}>
                    {member.displayName}
                  </option>
                ))}
                {groups.data?.items.map((group) => (
                  <option key={group.id} value={`group:${group.id}`}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Permission
              <select name="level" defaultValue="view">
                {(grants.data?.levels ?? []).map((level) => (
                  <option key={level} value={level}>{accessLabel(level)}</option>
                ))}
              </select>
            </label>
            <details><summary>Set an access expiry</summary><label>Access expires (optional)<AccessExpiry name="expiresAt"/></label></details>
            <button className="primary-button" type="submit" disabled={pending}>
              Share page
            </button>
          </form>
          <details><summary>Invite by email</summary><form className="detail-form" onSubmit={async event=>{event.preventDefault();const data=new FormData(event.currentTarget);setPending(true);setError(undefined);try{await mutate("/api/invitations",{operationKey:operationKey(),email:String(data.get("email")),kind:"guest",pageId:document.page.id,level:String(data.get("level")),expiresAt:data.get("expires")?new Date(String(data.get("expires"))).toISOString():null});setInvited(String(data.get("email")));grants.reload();}catch(error){setError(error);}finally{setPending(false);}}}><label>Email address<input name="email" type="email" required/></label><label>Invitation access<select name="level" defaultValue="view">{grants.data?.levels?.map(level=><option key={level} value={level}>{accessLabel(level)}</option>)}</select></label><details><summary>Set an access expiry</summary><label>Guest access expires<AccessExpiry name="expires"/></label></details><p>Sending creates a pending invitation. Access begins only when it is accepted; the invitation expires after 7 days.</p><button disabled={pending}>Send invitation</button>{invited?<p role="status">{`Invitation sent to ${invited}`}</p>:null}</form></details>
          <details className="advanced-access"><summary>Advanced access</summary>
          <p>{document.permissions.level === "full" ? "You can manage access to this page." : `You can ${accessLabel(document.permissions.level).toLowerCase()} ${document.permissions.level === "comment" ? "on " : ""}this page.`}</p><p>{grants.data?.restricted?'Only people invited directly can access this page.':'People with access to the parent page or space can also access this page.'}</p>
          <div className="action-row">
          <button disabled={pending} onClick={async()=>{setPending(true);setError(undefined);try{await mutate(`/api/sharing/pages/${document.page.id}/inheritance`,{operationKey:operationKey(),expectedRevisionId:document.page.revisionId,restricted:!grants.data?.restricted},'PUT');grants.reload();window.dispatchEvent(new Event('slate:navigation-changed'));window.dispatchEvent(new CustomEvent('slate:page-mutated',{detail:{pageId:document.page.id}}));}catch(error){setError(error);}finally{setPending(false);}}}>{grants.data?.restricted?'Restore inherited access':'Restrict inherited access'}</button>
          {document.page.lifecycle !== "draft" &&
          document.page.lifecycle !== "scheduled" &&
          workspace.data ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                void save({
                  principalKind:
                    document.policyProfile["page.access.v1"] ===
                    "workspace-general"
                      ? "workspace"
                      : "container",
                  principalId:
                    document.policyProfile["page.access.v1"] ===
                    "workspace-general"
                      ? workspace.data!.id
                      : document.page.containerId,
                  level: "view",
                })
              }
            >
              Allow general read access
            </button>
          ) : (
            <p>Private drafts have no general access.</p>
          )}
          </div>
          </details>
        </RequestState>
      )}
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
    </section>
  );
}
