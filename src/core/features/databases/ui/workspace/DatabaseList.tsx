import { AutomationWorkspace } from "../../../automation/ui/workspace/AutomationWorkspace";
import { RequestState } from "../../../../app/ui/RequestState";
import { mutate, operationKey, errorMessage } from "../../../../client/transport";
import { fieldView, recordView, type FieldDto, type ViewDto } from "../../../../client/records";
import type { RecordAnchor } from "../views/shared";
import { DatabaseChart } from "./DatabaseChart";
import { FieldsMenu, ViewMenu } from "./DatabaseMenus";
import { DatabaseToolbar } from "./DatabaseToolbar";
import { ExportViewCsv } from "./ExportViewCsv";
import { RecordLayouts } from "./RecordLayouts";
import { RecordTemplates } from "./RecordTemplates";
import { ViewCriteria } from "./ViewCriteria";
import type { DatabaseList as List } from "./useDatabaseList";

export type DatabaseDialog = { kind: "new" } | { kind: "view" } | { kind: "delete-view" } | { kind: "field"; field: FieldDto } | { kind: "remove-field"; field: FieldDto } | { kind: "value"; recordId: string; field: FieldDto };

/** The database's view tabs, toolbar and records, as they are at its address; the dialogs they open live beside them. */
export function DatabaseList({
  list,
  title,
  canEdit,
  canShare,
  parity,
  recordLink,
  onOpenLink,
  onDialog,
  error,
  onError,
}: {
  list: List;
  title: string;
  canEdit: boolean;
  canShare: boolean;
  parity?: string;
  recordLink: RecordAnchor;
  onOpenLink: (pageId: string) => void;
  onDialog: (dialog: DatabaseDialog) => void;
  error: unknown;
  onError: (cause: unknown) => void;
}) {
  const { resource, view, query, mode, fields } = list;
  const data = resource.data;
  if (!data) return null;
  const locked = !!data.database.structure_locked_at;
  const newView = (position: number): ViewDto => ({ id: crypto.randomUUID(), name: "New view", layout: "table", filters: [], sorts: [], groups: [], calculations: {}, display: {}, position, revisionId: "" });
  return (
    <>
      {canEdit && view?.display.tableOrigin ? <button className="secondary-button" onClick={()=>{void mutate<{value:{pageId:string}}>(`${list.path}/to-table`,{operationKey:operationKey(),expectedRevisionId:data.database.revision_id,viewId:view.id,expectedViewRevisionId:view.revisionId}).then(result=>window.location.assign(`/app/pages/${result.value.pageId}`)).catch(onError);}}>Convert back to table</button>:null}
      <DatabaseToolbar views={data.views} activeViewId={view?.id} onSelectView={list.selectView} mode={mode} onMode={list.setMode} search={list.find} onSearch={list.setFind}>
        {canEdit ? (
          <ViewMenu
            hasView={!!view}
            locked={locked}
            onSettings={() => onDialog({ kind: "view" })}
            onAdd={() => void list.saveView(newView(data.views.length)).catch(onError)}
            onDuplicate={() => view && void list.saveView({ ...view, id: crypto.randomUUID(), name: `${view.name} copy`, position: data.views.length, revisionId: "" }).catch(onError)}
            onDelete={() => onDialog({ kind: "delete-view" })}
          />
        ) : null}
        <FieldsMenu
          fields={fields}
          canEdit={canEdit}
          canShare={canShare}
          locked={locked}
          onAddField={() => onDialog({ kind: "field", field: { id: crypto.randomUUID(), name: "", type: "text", config: {}, position: fields.length } })}
          onEditField={(field) => onDialog({ kind: "field", field })}
          onToggleLock={() => void mutate(`${list.path}/lock`, { operationKey: operationKey(), expectedRevisionId: data.database.revision_id, locked: !data.database.structure_locked_at }).then(list.reload).catch(onError)}
        />
        {mode === "records" && view ? <ExportViewCsv databaseId={data.database.id} viewId={view.id} title={title} search={list.find} onError={onError} /> : null}
        {canEdit ? (
          <button className="tool tool-primary" type="button" onClick={() => onDialog({ kind: "new" })}>
            New record
          </button>
        ) : null}
      </DatabaseToolbar>
      {mode === "automations" ? <AutomationWorkspace sourceId={data.database.id}/> : mode === "templates" ? <RecordTemplates databaseId={data.database.id} fields={fields} canEdit={canEdit} onCreated={query.reload}/> : <>
        {view ? <ViewCriteria view={view} fields={fields} canClear={canEdit && !locked} onClear={() => void list.saveView({ ...view, filters: [] }).catch(onError)}/> : null}
        {locked ? <p className="muted">Structure locked by {data.database.structure_locked_by_name ?? "a workspace member"}. Record values remain editable.</p> : null}
        {mode === "chart" && view ? <DatabaseChart databaseId={data.database.id} viewId={view.id} fields={fields} /> : null}
        {error ? <p role="alert">{errorMessage(error)}</p> : null}
        {mode === "records" ? <RequestState loading={query.loading} error={query.error} retry={query.reload}>
          {view && query.data ? (
            <RecordLayouts
              canEditStructure={canEdit && !locked}
              view={view}
              onCreateRequiredField={type => onDialog({ kind: "field", field: { id: crypto.randomUUID(), name: type === "date" ? "Date" : "Group", type, config: {}, position: fields.length } })}
              query={query.data}
              rawFields={fields}
              rawRecords={list.records}
              props={{
                fields: list.shown.map(fieldView),
                records: list.records.map((record) => recordView(record, fields, list.references)),
                showRecordIcon: parity === "record-is-page",
                canEditRecords: canEdit,
                recordLink,
                onValueChange: (recordId, fieldId, value) => void list.cellValue(recordId, fieldId, value).catch(onError),
                onEditValue: (recordId, fieldId) => {
                  const field = fields.find((item) => item.id === fieldId);
                  if (field) onDialog({ kind: "value", recordId, field });
                },
                onOpenLink,
                onNewRecord: () => onDialog({ kind: "new" }),
              }}
              onGroupMove={(recordId, value) => {
                const record = list.records.find((item) => item.pageId === recordId), field = fields.find((item) => item.id === view.groups[0]?.field);
                if (record && field) void list.saveValue(record, field, value).catch(onError);
              }}
              onHideEmpty={(hide) => void list.saveView({ ...view, groups: view.groups.map((group, index) => (index ? group : { ...group, hideEmpty: hide })) }).catch(onError)}
              onCalculation={(fieldId, kind) => void list.saveView({ ...view, calculations: { ...view.calculations, [fieldId]: kind } }).catch(onError)}
            />
          ) : null}
          {query.data?.records.length === 0 ? <p className="muted">No records match this view.</p> : null}
        </RequestState> : null}
      </>}
    </>
  );
}
