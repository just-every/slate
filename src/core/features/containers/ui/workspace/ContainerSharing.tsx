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
  principalLabel?: string;
};
export function ContainerSharing({ id }: { id: string }) {
  const { member,workspace } = useWorkspace();
  const grantLed=workspace.data?.policies["container.access.v1"]==="grant-led";
  const [tab,setTab]=useState("member");
  const grants = useResource<{ items: Grant[]; levels: string[] }>(
    `/api/sharing/containers/${id}`,
  );
  const members = useResource<{ items: { id: string; displayName: string }[] }>(
    "/api/members",
  );
  const groups = useResource<{ items: { id: string; name: string }[] }>(
    member.role === "owner" ? "/api/groups" : null,
  );
  const [editing, setEditing] = useState<Grant | "new" | null>(null);
  const key = useRef("");
  const [error, setError] = useState<unknown>();
  const name = (grant: Grant) =>
    grant.principalLabel ?? (grant.principalKind === "workspace"
      ? "Everyone in workspace"
      : grant.principalKind === "container"
        ? "Space members"
        : (members.data?.items.find((person) => person.id === grant.principalId)
            ?.displayName ??
          groups.data?.items.find((group) => group.id === grant.principalId)
            ?.name ??
          "Unavailable person or group"));
  return (
    <section>
      <h4>Who has access</h4>{grantLed?<nav className="tabs" aria-label="Access principals">{["member","group","guest"].map(value=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value}s</button>)}</nav>:null}
      <RequestState
        loading={grants.loading}
        error={grants.error}
        retry={grants.reload}
      >
        <ul className="settings-list">
          {grants.data?.items.filter(grant=>!grantLed||grant.principalKind===tab).map((grant) => (
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
            if (!data.get("level") && data.get("revoke") !== "on") throw new Error("Choose an available access level.");
            await mutate("/api/sharing", {
              operationKey: key.current,
              targetKind: "container",
              targetId: id,
              id: editing === "new" ? undefined : editing.id,
              principalKind,
              principalId,
              level: String(data.get("level") || (editing === "new" ? "" : editing.level)),
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
              {members.data?.items.map((person) => (
                <option key={person.id} value={`member:${person.id}`}>
                  {person.displayName}
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
            Access
            <select
              name="level"
              required={editing === "new"}
              defaultValue={editing === "new" ? (grants.data?.levels.at(-1) ?? "") : (grants.data?.levels.includes(editing.level) ? editing.level : "")}
            >
              {editing !== "new" && !grants.data?.levels.includes(editing.level) ? <option value="" disabled>Stored access retained</option> : null}
              {(grants.data?.levels ?? []).map((level) => (
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
