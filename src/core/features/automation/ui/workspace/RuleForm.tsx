import {localDateTime} from "../../../../app/ui/localDateTime";
import { useRef, useState } from "react";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey } from "../../../../client/transport";
import type { DatabaseDto } from "../../../../client/records";
import { FilterBuilder } from "../../../databases/ui/workspace/FilterBuilder";
import { RuleActionsEditor } from "./RuleActionsEditor";
import { ruleDraft, type RuleRow } from "./automationTypes";
export function RuleForm({
  rule,
  sourceId,
  sourceOnly,
  onClose,
  onSaved,
}: {
  rule?: RuleRow;
  sourceId?:string;
  sourceOnly?:boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => ({...ruleDraft(rule),...(!rule&&sourceId?{scope:"source" as const,sourceDatabaseId:sourceId}:{})}));
  const key = useRef(operationKey());
  const spaces = useResource<{ items: { id: string; name: string }[] }>(
    "/api/containers",
  );
  const databases = useResource<{ items: { id: string; title: string }[] }>(
    "/api/databases",
  );
  const source = useResource<DatabaseDto>(
    draft.sourceDatabaseId ? `/api/databases/${draft.sourceDatabaseId}` : null,
  );
  return (
    <ActionDialog
      title={rule ? "Edit automation" : "Create automation"}
      action="Save automation"
      onClose={onClose}
      onSubmit={async () => {
        if (!draft.actions.length) throw new Error("Add at least one action.");
        await mutate("/api/automation", {
          operationKey: key.current,
          id: rule?.id,
          expectedRevisionId: rule?.revision_id,
          ...draft,
        });
        onSaved();
      }}
    >
      <label>
        Name
        <input
          required
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      {!sourceOnly ? <label>
        Run across
        <select
          value={draft.scope}
          onChange={(event) =>
            setDraft({
              ...draft,
              scope: event.target.value as typeof draft.scope,
              sourceDatabaseId: undefined,
              containerId: undefined,
              conditions: [],
              branch: undefined,
            })
          }
        >
          <option value="source">One database</option>
          <option value="container">One space</option>
          <option value="site">Workspace</option>
        </select>
      </label> : null}
      {draft.scope === "source" ? (
        <label>
          Database
          <select
            required
            disabled={sourceOnly && !!sourceId}
            value={draft.sourceDatabaseId ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                sourceDatabaseId: event.target.value,
                conditions: [],
                branch: undefined,
              })
            }
          >
            <option value="" disabled>
              Choose a database
            </option>
            {databases.data?.items.map((database) => (
              <option key={database.id} value={database.id}>
                {database.title}
              </option>
            ))}
          </select>
        </label>
      ) : draft.scope === "container" ? (
        <label>
          Space
          <select
            required
            value={draft.containerId ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, containerId: event.target.value })
            }
          >
            <option value="" disabled>
              Choose a space
            </option>
            {spaces.data?.items.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        When
        <select
          value={draft.trigger.event}
          onChange={(event) =>
            setDraft({
              ...draft,
              trigger: {
                event: event.target.value,
                ...(event.target.value === "schedule"
                  ? { intervalMinutes: 60 }
                  : {}),
              },
            })
          }
        >
          {[
            ["created", "Page created"],
            ["properties", "Page properties changed"],
            ["blocks", "Page body edited"],
            ["published", "Page published"],
            ["record-created", "Record created"],
            ["record-updated", "Record fields changed"],
            ["schedule", "On a schedule"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {draft.trigger.event === "schedule" ? (
        <>
          <label>
            Every (minutes)
            <input
              required
              type="number"
              min={1}
              value={draft.trigger.intervalMinutes ?? 60}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  trigger: {
                    ...draft.trigger,
                    intervalMinutes: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            Start at
            <input
              type="datetime-local"
              value={
                draft.trigger.startsAt
                  ? localDateTime(draft.trigger.startsAt)
                  : ""
              }
              onChange={(event) =>
                setDraft({
                  ...draft,
                  trigger: {
                    ...draft.trigger,
                    startsAt: event.target.value
                      ? new Date(event.target.value).toISOString()
                      : undefined,
                  },
                })
              }
            />
          </label>
        </>
      ) : null}
      <h3>Only when</h3>
      <FilterBuilder
        databaseId={draft.sourceDatabaseId}
        filters={draft.conditions}
        fields={source.data?.fields ?? []}
        onChange={(conditions) => setDraft({ ...draft, conditions })}
      />
      {draft.scope !== "source" ? (
        <p className="muted">
          Field conditions need a specific database. Space and workspace rules
          follow their selected event.
        </p>
      ) : null}
      {!sourceOnly ? <label>
        Apply actions to
        <select
          value={draft.branch?.relationField ?? ""}
          onChange={(event) =>
            setDraft({
              ...draft,
              branch: event.target.value
                ? { relationField: event.target.value }
                : undefined,
            })
          }
        >
          <option value="">The triggering page or record</option>
          {source.data?.fields
            .filter((field) => field.type === "relation")
            .map((field) => (
              <option key={field.id} value={field.id}>
                Related records through {field.name}
              </option>
            ))}
        </select>
      </label> : null}
      <h3>Do</h3>
      <RuleActionsEditor
        actions={draft.actions}
        sourceId={draft.sourceDatabaseId}
        onChange={(actions) => setDraft({ ...draft, actions })}
      />
      <label>
        <input
          type="checkbox"
          checked={draft.disabled}
          onChange={(event) =>
            setDraft({ ...draft, disabled: event.target.checked })
          }
        />
        Keep this automation disabled
      </label>
      <p className="muted">
        Actions run with your current access. A later loss of access or budget
        stops the affected work; the run log records its result.
      </p>
    </ActionDialog>
  );
}
