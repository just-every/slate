import { AccessExpiry } from "../../../../app/ui/AccessExpiry";
import { displayDate } from "../../../../app/ui/displayDate";
import { useRef, useState } from "react";
import { useResource } from "../../../../client/useResource";
import {
  mutate,
  operationKey,
  errorMessage,
} from "../../../../client/transport";
import { RequestState } from "../../../../app/ui/RequestState";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
type Grant = {
  id: string;
  principalKind: string;
  principalId: string;
  level: string;
  expiresAt: string | null;
  revokedAt: string | null;
  principalLabel: string;
};
type Principal = {kind: "member" | "group"; id: string; label: string; memberKind?: "member" | "guest"};
export function ContainerSharing({ id }: { id: string }) {
  const { member,workspace } = useWorkspace();
  const grantLed=workspace.data?.policies["container.access.v1"]==="grant-led";
  const [tab,setTab]=useState("member");
  const grants = useResource<{ items: Grant[]; principals: Principal[]; levels: string[] }>(
    `/api/sharing/containers/${id}`,
  );
  const [editing, setEditing] = useState<Grant | "new" | null>(null);
  const key = useRef("");
  const [error, setError] = useState<unknown>();
  const name = (grant: Grant) =>
    grant.principalKind === "workspace"
      ? "Everyone in workspace"
      : grant.principalKind === "container"
        ? "Space members"
        : grant.principalLabel;
  const principals = grants.data?.principals ?? [];
  return (
    <section>
      <h4>Who has access</h4>{grantLed?<nav className="tabs" aria-label="Access principals">{["member","group","guest"].map(value=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value}s</button>)}</nav>:null}
      <RequestState
        loading={grants.loading}
        error={grants.error}
        retry={grants.reload}
      >
        <ul className="settings-list">
          {grants.data?.items.filter(grant=>!grantLed||(grant.principalKind==="member"?principals.find(person=>person.kind==="member"&&person.id===grant.principalId)?.memberKind??"member":grant.principalKind)===tab).map((grant) => (
            <li key={grant.id}>
              <span>
                {name(grant)} · {grant.revokedAt ? "Revoked" : grant.level}
                {grant.expiresAt
                  ? ` · Until ${displayDate(grant.expiresAt, true)}`
                  : ""}
              </span>
              {!grant.revokedAt ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    key.current = operationKey();
                    setEditing(grant);
                  }}
                >
                  Edit access
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </RequestState>
      <button
        className="secondary-button"
        onClick={() => {
          key.current = operationKey();
          setEditing("new");
        }}
      >
        Grant access
      </button>
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
      {editing ? (
        <ActionDialog
          title="Space access grant"
          action="Save access"
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            const [principalKind, principalId] = String(
              data.get("principal"),
            ).split(":");
            await mutate("/api/sharing", {
              operationKey: key.current,
              targetKind: "container",
              targetId: id,
              id: editing === "new" ? undefined : editing.id,
              principalKind,
              principalId,
              level: String(data.get("level")),
              expiresAt: data.get("expires")
                ? new Date(String(data.get("expires"))).toISOString()
                : null,
              revoke: data.get("revoke") === "on",
            });
            grants.reload();
          }}
        >
          <label>
            Person or group
            <select
              name="principal"
              required
              defaultValue={
                editing === "new"
                  ? ""
                  : `${editing.principalKind}:${editing.principalId}`
              }
            >
              <option value="" disabled>
                Choose access principal
              </option>
              <option value={`workspace:${member.workspaceId}`}>
                Everyone in workspace
              </option>
              <option value={`container:${id}`}>Space members</option>
              {principals.filter(person=>person.kind==="member").map((person) => (
                <option key={person.id} value={`member:${person.id}`}>
                  {person.label}
                </option>
              ))}
              {principals.filter(person=>person.kind==="group").map((group) => (
                <option key={group.id} value={`group:${group.id}`}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Access
            <select
              name="level"
              defaultValue={editing === "new" ? (grants.data?.levels.includes("view") ? "view" : grants.data?.levels[0]) : editing.level}
            >
              {["view", "comment", "edit", "full"].filter(level=>grants.data?.levels.includes(level)).map((level) => (
                <option key={level} value={level}>{({view:"View",comment:"Comment",edit:"Edit",full:"Manage access"} as Record<string,string>)[level]}</option>
              ))}
            </select>
          </label>
          <label>
            Expires (optional)
            <AccessExpiry name="expires" value={editing === "new" ? null : editing.expiresAt} />
          </label>
          {editing !== "new" ? (
            <label>
              <input type="checkbox" name="revoke" />
              Revoke this grant
            </label>
          ) : null}
        </ActionDialog>
      ) : null}
    </section>
  );
}
