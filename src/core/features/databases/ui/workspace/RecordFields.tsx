import { fieldValue, fieldView, type FieldDto } from "../../../../client/records";
import type { useRecordReferences } from "../../../../client/useRecordReferences";
import { FieldDisplay } from "../fields/FieldDisplay";

/** A record's properties as a quiet two-column list; each editable property keeps its Edit button. */
export function RecordFields({
  fields,
  values,
  references,
  canEdit,
  onEdit,
  onOpenLink,
}: {
  fields: FieldDto[];
  values: Record<string, unknown>;
  references: ReturnType<typeof useRecordReferences>;
  canEdit: boolean;
  onEdit: (field: FieldDto) => void;
  /** Opens a relation chip's record. */
  onOpenLink: (pageId: string) => void;
}) {
  return (
    <dl className="record-fields-list">
      {fields.map((field) => (
        <div key={field.id} className="record-field">
          <dt>{field.name}</dt>
          <dd>
            <FieldDisplay density="detail" field={fieldView(field)} value={fieldValue(field, values[field.id], references)} onOpenLink={onOpenLink} />
            {canEdit && !field.readOnly ? <button onClick={() => onEdit(field)}>Edit</button> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
