import { Plus } from "lucide-react";
import { Button, cn } from "../../../../ui";
import { knowledgeNoun } from "../../../../shared/knowledge/vocabulary";
import { FieldCell } from "../fields";
import { RecordTitle } from "../RecordTitle";
import type { RecordViewProps } from "./shared";

/** `DB-004` list layout: one line per record with the view's fields trailing it. */
export function ListView({
  fields,
  records,
  showRecordIcon,
  canEditRecords,
  recordLink,
  onOpenLink,
  onNewRecord,
  className,
}: RecordViewProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <ul className="flex flex-col">
        {records.map((record) => (
          <li
            className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 hover:bg-sidebar/60"
            key={record.id}
          >
            <RecordTitle
              className="min-w-0 flex-1"
              icon={record.icon}
              link={recordLink(record.id)}
              showIcon={showRecordIcon}
              title={record.title}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              {fields.map((field) => (
                <span className="flex min-w-0 items-center gap-1" key={field.id}>
                  <span className="sr-only">{field.name}: </span>
                  <FieldCell
                    density="cell"
                    editable={false}
                    field={field}
                    onEdit={() => undefined}
                    onOpenLink={onOpenLink}
                    onValueChange={() => undefined}
                    value={record.values[field.id] ?? null}
                  />
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="px-3 py-2">
        <Button className="justify-start" disabled={!canEditRecords} onClick={onNewRecord} size="sm" variant="ghost">
          <Plus aria-hidden="true" className="size-3.5" />
          New {knowledgeNoun("record")}
        </Button>
      </div>
    </div>
  );
}
