import { Plus } from "lucide-react";
import { knowledgeNoun } from "../../../../shared/knowledge/vocabulary";
import { FieldCell, FieldGlyph, fieldTypeLabel } from "../fields";
import { RecordTitle } from "../RecordTitle";
import type { CalculationKind, ColumnCalculation } from "../types";
import { CalculationFooterCell } from "./CalculationFooterCell";
import { TableScrollRegion } from "./TableScrollRegion";
import type { RecordViewProps } from "./shared";

/**
 * `DB-004` table layout. Typed columns each carrying their type glyph, inline
 * editing, and the per-column calculation footer `DB-007` describes. The grid
 * scrolls sideways inside its own container so the page never does.
 */
export function TableView({
  fields,
  records,
  showRecordIcon,
  canEditRecords,
  canEditStructure = canEditRecords,
  calculations,
  titleColumnLabel,
  lock = null,
  recordLink,
  onValueChange,
  onEditValue,
  onOpenLink,
  onNewRecord,
  onCalculationChange,
  className,
}: RecordViewProps & {
  canEditStructure?: boolean;
  calculations: Readonly<Record<string, ColumnCalculation>>;
  /** The name of the field that holds the record's title. */
  titleColumnLabel: string;
  onCalculationChange: (fieldId: string, kind: CalculationKind) => void;
}) {
  return (
    <TableScrollRegion className={className}>
      <table className="w-full table-fixed border-collapse text-ui" style={{minWidth:`${(fields.length+1)*144}px`}}>
        <thead>
          <tr className="border-b border-line">
            <th className={`${fields.length===1?"w-1/2":"w-64"} h-8 px-2 text-left text-tiny font-medium whitespace-nowrap text-ink-muted`} scope="col">
              <span className="flex items-center gap-1.5">
                <FieldGlyph className="size-3.5 text-ink-faint" type="text" />
                {titleColumnLabel}
              </span>
            </th>
            {fields.map((field) => (
              <th
                className="h-8 min-w-36 px-2 text-left text-tiny font-medium whitespace-nowrap text-ink-muted"
                key={field.id}
                scope="col"
              >
                <span className="flex items-center gap-1.5">
                  <FieldGlyph className="size-3.5 text-ink-faint" type={field.type} />
                  {field.name}
                  <span className="sr-only"> — {fieldTypeLabel[field.type]}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {records.map((record) => (
            <tr className="border-b border-line hover:bg-sidebar/60" key={record.id}>
              {/* No left padding: the record button carries its own inset, so the icon lands on the page's content edge. */}
              <td className="h-9 max-w-64 pr-2 pl-0 align-middle">
                <RecordTitle
                  className="w-full"
                  icon={record.icon}
                  link={recordLink(record.id)}
                  showIcon={showRecordIcon}
                  title={record.title}
                />
              </td>
              {fields.map((field) => (
                <td className="h-9 max-w-64 px-2 align-middle" key={field.id}>
                  <FieldCell
                    density="cell"
                    editable={canEditRecords && field.editable}
                    field={field}
                    onEdit={() => onEditValue(record.id, field.id)}
                    onOpenLink={onOpenLink}
                    onValueChange={(_fieldId, next) => onValueChange(record.id, field.id, next)}
                    value={record.values[field.id] ?? null}
                  />
                </td>
              ))}
            </tr>
          ))}

          <tr>
            <td className="p-0" colSpan={fields.length + 1}>
              <button
                className="flex h-9 w-full items-center gap-1.5 px-2 text-left text-ui text-ink-muted transition-colors hover:bg-sidebar-hover hover:text-ink disabled:opacity-50"
                disabled={!canEditRecords}
                onClick={onNewRecord}
                type="button"
              >
                <Plus aria-hidden="true" className="size-3.5" />
                New {knowledgeNoun("record")}
              </button>
            </td>
          </tr>
        </tbody>

        <tfoot className="border-t border-line">
          <tr>
            <td className="px-2">
              <span className="text-tiny text-ink-muted">
                {records.length} {knowledgeNoun("record")}
                {records.length === 1 ? "" : "s"}
              </span>
            </td>
            {fields.map((field) => (
              <td className="px-0" key={field.id}>
                <CalculationFooterCell
                  calculation={calculations[field.id]}
                  disabled={!canEditStructure || lock !== null}
                  fieldName={field.name}
                  onChange={(kind) => onCalculationChange(field.id, kind)}
                />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </TableScrollRegion>
  );
}
