import { SharingLevels } from "./SharingLevels";
import {GroupMentionSettings} from './GroupMentionSettings';
import {NavigationSettings} from "./NavigationSettings";
import { useState } from "react";
import { useWorkspace } from "../../../../app/ui/WorkspaceContext";
import { RequestState } from "../../../../app/ui/RequestState";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { mutate, operationKey } from "../../../../client/transport";
const policies = [
  [
    "page.lifecycle.v1",
    "Publishing",
    [
      ["always-live", "Changes are live"],
      ["draft-then-publish", "Draft, then publish"],
    ],
  ],
  [
    "page.access.v1",
    "General access",
    [
      ["workspace-general", "Workspace members"],
      ["container-general", "Space members"],
    ],
  ],
  [
    "page.public-access.v1",
    "Public pages",
    [
      ["site", "Published site"],
      ["link", "Individual public links"],
    ],
  ],
  [
    "page.version.v1",
    "History",
    [
      ["autosnapshot", "Automatic snapshots"],
      ["labelled", "Labelled versions"],
    ],
  ],
  [
    "page.status.v1",
    "Page status",
    [
      ["verification-only", "Human verification"],
      ["open-vocabulary", "Custom statuses"],
    ],
  ],
  [
    "record.page-parity.v1",
    "Records",
    [
      ["record-is-page", "Every record is a page"],
      ["record-is-row", "Records live in tables"],
    ],
  ],
  [
    "automation.scope.v1",
    "Automation boundaries",
    [
      ["source", "Source"],
      ["container", "Space"],
      ["site", "Workspace"],
    ],
  ],
  [
    "container.access.v1",
    "Space access",
    [
      ["class-led", "Open, closed or private"],
      ["grant-led", "Explicit grants"],
    ],
  ],
] as const;
export function WorkspacePreferences() {
  const { workspace, member } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const data = workspace.data;
  return (
    <section className="settings-panel">
      <h2>Workspace settings</h2>
      <RequestState
        loading={workspace.loading}
        error={workspace.error}
        retry={workspace.reload}
      >
        {data ? (
          <>
            {member.role === "owner"?<><NavigationSettings/><GroupMentionSettings/><SharingLevels/></>:null}
            <h3>{data.name}</h3>
            <p>{data.description || "No description yet."}</p>
            <dl className="settings-facts">
              {policies.map(([id, label, options]) => (
                <div key={id}>
                  <dt>{label}</dt>
                  <dd>
                    {
                      options.find(
                        ([value]) => value === data.policies[id],
                      )?.[1]
                    }
                  </dd>
                </div>
              ))}
            </dl>
            {member.role === "owner" ? (
              <button className="secondary-button" onClick={() => setEditing(true)}>
                Edit workspace & policies
              </button>
            ) : (
              <p className="muted">
                Your workspace owner manages these policies.
              </p>
            )}
            {editing ? (
              <ActionDialog
                title="Workspace settings"
                action="Save settings"
                onClose={() => setEditing(false)}
                onSubmit={async (form) => {
                  await mutate(
                    "/api/workspace",
                    {
                      operationKey: operationKey(),
                      expectedRevisionId: data.revisionId,
                      name: String(form.get("name")),
                      mark: String(form.get("mark")),
                      description: String(form.get("description")),
                      guestAccess: String(form.get("guestAccess")),
                      publicLinkAccess: String(form.get("publicLinkAccess")),
                      anonymousAccess: String(form.get("anonymousAccess")),
                      policies: Object.fromEntries(
                        policies.map(([id]) => [id, String(form.get(id))]),
                      ),
                    },
                    "PUT",
                  );
                  workspace.reload();
                }}
              >
                <label>
                  Name
                  <input name="name" defaultValue={data.name} required />
                </label>
                <label>
                  Mark
                  <input name="mark" defaultValue={data.mark} />
                </label>
                <label>
                  Description
                  <textarea
                    name="description"
                    defaultValue={data.description}
                  />
                </label>
                {policies.map(([id, label, options]) => (
                  <label key={id}>
                    {label}
                    <select name={id} defaultValue={data.policies[id]}>
                      {options.map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {(
                  [
                    ["guestAccess", "Guest access"],
                    ["publicLinkAccess", "Public links"],
                    ["anonymousAccess", "Anonymous access"],
                  ] as const
                ).map(([id, label]) => (
                  <label key={id}>
                    {label}
                    <select name={id} defaultValue={data[id]}>
                      <option value="allowed">Allowed</option>
                      <option value="forbidden">Forbidden</option>
                    </select>
                  </label>
                ))}
                <p>
                  Changes affect how pages are shared and published across this
                  workspace. Existing history remains available.
                </p>
              </ActionDialog>
            ) : null}
          </>
        ) : null}
      </RequestState>
    </section>
  );
}
