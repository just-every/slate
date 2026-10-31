import { Plus } from "lucide-react";
import { Button, Switch, cn } from "../../../../ui";
import { knowledgeNoun } from "../../../../shared/knowledge/vocabulary";
import type { DatabaseField, RecordGroup } from "../types";
import { recordColourDotClass } from "../types";
import { RecordCard } from "./RecordCard";
import type { RecordAnchor } from "./shared";

/**
 * `DB-006` board layout: one column per group of the grouping field, the count in
 * each header, a card per record, a move control where the field permits it, and
 * a control that hides empty groups.
 */
export function BoardView({
  groups,
  groupFieldName,
  cardFields,
  showRecordIcon,
  canEditRecords,
  canEditStructure = canEditRecords,
  canMoveBetweenGroups,
  hideEmptyGroups,
  onHideEmptyGroupsChange,
  recordLink,
  onMoveRecord,
  onOpenLink,
  onNewRecordInGroup,
  className,
}: {
  groups: readonly RecordGroup[];
  groupFieldName: string;
  cardFields: readonly DatabaseField[];
  showRecordIcon: boolean;
  canEditRecords: boolean;
  canEditStructure?: boolean;
  /** `DB-006`: a record moves between groups only where the grouping field permits it. */
  canMoveBetweenGroups: boolean;
  hideEmptyGroups: boolean;
  onHideEmptyGroupsChange: (next: boolean) => void;
  recordLink: RecordAnchor;
  onMoveRecord: (recordId: string, groupId: string) => void;
  onOpenLink: (linkId: string) => void;
  onNewRecordInGroup: (groupId: string) => void;
  className?: string;
}) {
  const shown = hideEmptyGroups ? groups.filter((group) => group.count > 0) : groups;
  const hiddenCount = groups.length - shown.length;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3">
        <p className="text-tiny text-ink-muted">
          Grouped by {groupFieldName}
          {hiddenCount > 0 ? ` · ${hiddenCount} empty group${hiddenCount === 1 ? "" : "s"} hidden` : ""}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-tiny text-ink-muted" id="board-hide-empty">
            Hide empty groups
          </span>
          <Switch disabled={!canEditStructure} aria-labelledby="board-hide-empty" checked={hideEmptyGroups} onCheckedChange={onHideEmptyGroupsChange} />
        </div>
      </div>

      <div className="w-full overflow-x-auto px-3 pb-3">
        <div className="flex min-w-min items-start gap-3">
          {shown.map((group) => (
            <section aria-label={group.label} className="flex w-64 shrink-0 flex-col gap-2" key={group.id}>
              <header className="flex items-center gap-1.5 px-1">
                <span aria-hidden="true" className={cn("size-2 rounded-full", recordColourDotClass[group.colour])} />
                <h3 className="truncate text-ui font-medium text-ink">{group.label}</h3>
                <span className="text-tiny text-ink-faint">{group.count}</span>
              </header>

              <div className="flex flex-col gap-2">
                {group.records.map((record) => (
                  <RecordCard
                    fields={cardFields}
                    key={record.id}
                    moveTargets={
                      canMoveBetweenGroups
                        ? groups
                            .filter((target) => target.id !== group.id)
                            .map((target) => ({ id: target.id, label: target.label }))
                        : []
                    }
                    onMove={(groupId) => onMoveRecord(record.id, groupId)}
                    link={recordLink(record.id)}
                    onOpenLink={onOpenLink}
                    record={record}
                    showRecordIcon={showRecordIcon}
                  />
                ))}
                {group.records.length === 0 ? (
                  <p className="rounded-card border border-dashed border-line px-2 py-3 text-tiny text-ink-faint">
                    No {knowledgeNoun("record")}s in this group.
                  </p>
                ) : null}
              </div>

              <Button
                className="justify-start"
                disabled={!canEditRecords}
                onClick={() => onNewRecordInGroup(group.id)}
                size="sm"
                variant="ghost"
              >
                <Plus aria-hidden="true" className="size-3.5" />
                New in {group.label}
              </Button>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
