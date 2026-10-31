import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { mutate, operationKey } from "../../../../client/transport";
import { FieldDialog } from "./FieldDialog";
import { RecordValueDialog } from "./RecordValueDialog";
import { ReferenceValueDialog } from "./ReferenceValueDialog";
import { RemoveFieldDialog } from "./RemoveFieldDialog";
import { ViewDialog } from "./ViewDialog";
import type { DatabaseDialog } from "./DatabaseList";
import type { DatabaseList } from "./useDatabaseList";

/** The dialogs the list, its toolbar and the record index open. They sit outside the list, which hides while a record shows. */
export function DatabaseDialogs({ list, dialog, onDialog }: { list: DatabaseList; dialog: DatabaseDialog | null; onDialog: (next: DatabaseDialog | null) => void }) {
  const data = list.resource.data, view = list.view;
  if (!data || !dialog) return null;
  const onClose = () => onDialog(null);
  const revision = data.database.revision_id;
  if (dialog.kind === "field") {
    return (
      <FieldDialog
        field={dialog.field}
        fields={list.fields}
        onRemove={list.fields.some((field) => field.id === dialog.field.id) ? () => onDialog({ kind: "remove-field", field: dialog.field }) : undefined}
        onClose={onClose}
        onSave={async (field) => {
          const { evaluationState: _evaluationState, readOnly: _readOnly, ...input } = field;
          await mutate(`${list.path}/fields`, { operationKey: operationKey(), expectedRevisionId: revision, field: input });
          await list.reload();
        }}
      />
    );
  }
  if (dialog.kind === "remove-field") {
    return (
      <RemoveFieldDialog field={dialog.field} onClose={onClose} onRemove={async () => {
        const { evaluationState: _evaluationState, readOnly: _readOnly, ...field } = dialog.field;
        await mutate(`${list.path}/fields`, { operationKey: operationKey(), expectedRevisionId: revision, field, delete: true });
        await list.reload();
      }} />
    );
  }
  if (dialog.kind === "view") return view ? <ViewDialog view={view} fields={list.fields} onSave={list.saveView} onClose={onClose} /> : null;
  if (dialog.kind === "delete-view") {
    return view ? (
      <ActionDialog title="Delete this saved view?" action="Delete view" onClose={onClose} onSubmit={async () => {
        const { revisionId: _revisionId, ...input } = view;
        await mutate(`${list.path}/views`, { operationKey: operationKey(), expectedRevisionId: revision, view: input, delete: true });
        list.showView(undefined);
        if (!(await list.resource.reload())) throw new Error("The view was deleted. Reload the database to see its remaining views.");
      }}>
        <p>Delete “{view.name}”. Its records and other saved views remain available.</p>
      </ActionDialog>
    ) : null;
  }
  if (dialog.kind === "new") {
    return (
      <ActionDialog title="New record" action="Create record" onClose={onClose} onSubmit={async (form) => {
        await mutate(`${list.path}/records`, { operationKey: operationKey(), title: String(form.get("title")), values: {} });
        await list.query.reload();
      }}>
        <label>
          Name
          <input name="title" required autoFocus />
        </label>
      </ActionDialog>
    );
  }
  const record = list.query.data?.records.find((item) => item.pageId === dialog.recordId);
  if (!record) return null;
  const save = (value: unknown) => list.saveValue(record, dialog.field, value);
  return ["relation", "person", "file"].includes(dialog.field.type)
    ? <ReferenceValueDialog databaseId={data.database.id} field={dialog.field} value={record.values[dialog.field.id]} onClose={onClose} onSave={save} />
    : <RecordValueDialog field={dialog.field} value={record.values[dialog.field.id]} onClose={onClose} onSave={save} />;
}
