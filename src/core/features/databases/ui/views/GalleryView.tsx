import { Plus } from "lucide-react";
import { Button, cn } from "../../../../ui";
import { knowledgeNoun } from "../../../../shared/knowledge/vocabulary";
import { RecordCard } from "./RecordCard";
import type { RecordViewProps } from "./shared";

/**
 * `DB-004` gallery layout: a grid of cards. A record's cover is a stored value; a
 * record with none renders without one rather than borrowing an image.
 */
export function GalleryView({
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
    <div className={cn("flex flex-col gap-3 p-3", className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {records.map((record) => (
          <RecordCard
            coverClass={record.coverClass ?? null}
            fields={fields}
            key={record.id}
            link={recordLink(record.id)}
            onOpenLink={onOpenLink}
            record={record}
            showRecordIcon={showRecordIcon}
          />
        ))}
      </div>
      <div>
        <Button disabled={!canEditRecords} onClick={onNewRecord} size="sm" variant="ghost">
          <Plus aria-hidden="true" className="size-3.5" />
          New {knowledgeNoun("record")}
        </Button>
      </div>
    </div>
  );
}
