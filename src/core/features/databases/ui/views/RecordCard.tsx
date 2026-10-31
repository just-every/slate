import { MoveRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  cn,
} from "../../../../ui";
import { FieldCell, FieldGlyph } from "../fields";
import { RecordIconMark } from "../RecordTitle";
import type { DatabaseField, DatabaseRecord } from "../types";
import type { RecordAnchor } from "./shared";

/** One record as a card, used by the board and the gallery layouts. */
export function RecordCard({
  record,
  fields,
  showRecordIcon,
  coverClass,
  moveTargets,
  link,
  onMove,
  onOpenLink,
  className,
}: {
  record: DatabaseRecord;
  /** The fields shown on the card, already in the view's order. */
  fields: readonly DatabaseField[];
  showRecordIcon: boolean;
  /** A stored gradient class for the gallery's cover area; no cover when null. */
  coverClass?: string | null;
  /** `DB-006`: the groups this record can be moved into, empty when the field forbids it. */
  moveTargets?: readonly { id: string; label: string }[];
  link: ReturnType<RecordAnchor>;
  onMove?: (groupId: string) => void;
  onOpenLink: (linkId: string) => void;
  className?: string;
}) {
  return (
    <article className={cn("flex flex-col overflow-hidden rounded-card border border-line bg-surface", className)}>
      {coverClass ? <div aria-hidden="true" className={cn("h-20 w-full", coverClass)} /> : null}
      <div className="flex flex-col gap-1.5 p-2">
        <div className="flex items-start justify-between gap-1">
          <a
            className="record-title flex min-w-0 items-start gap-1.5 text-left text-ui font-medium text-ink transition-colors hover:text-accent"
            {...link}
          >
            {showRecordIcon ? <RecordIconMark className="mt-0.5" icon={record.icon} /> : null}
            <span className="line-clamp-2">{record.title}</span>
          </a>
          {moveTargets && moveTargets.length > 0 && onMove ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Move ${record.title} to another group`}
                data-tooltip="Move group" data-tooltip-align="end"
                className="shrink-0 rounded-control p-1 text-ink-faint transition-colors hover:bg-sidebar-hover hover:text-ink"
              >
                <MoveRight aria-hidden="true" className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                {moveTargets.map((target) => (
                  <DropdownMenuItem key={target.id} onSelect={() => onMove(target.id)}>
                    {target.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {fields.map((field) => (
          <div className="flex min-w-0 items-center gap-1.5" key={field.id}>
            <FieldGlyph className="size-3 shrink-0 text-ink-faint" type={field.type} />
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
          </div>
        ))}
      </div>
    </article>
  );
}
