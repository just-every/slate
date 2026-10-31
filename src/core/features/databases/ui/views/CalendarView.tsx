import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn } from "../../../../ui";
import { knowledgeNoun } from "../../../../shared/knowledge/vocabulary";
import { RecordIconMark } from "../RecordTitle";
import type { CalendarDay } from "../types";
import type { RecordAnchor } from "./shared";

/**
 * `DB-004` calendar layout. The month, its weekday headings and its days arrive
 * already worked out, so nothing here computes a date.
 */
export function CalendarView({
  monthLabel,
  weekdayLabels,
  days,
  dateFieldName,
  showRecordIcon,
  recordLink,
  onPreviousMonth,
  onNextMonth,
  onToday,
  className,
}: {
  monthLabel: string;
  /** Seven labels, starting on the workspace's first day of the week. */
  weekdayLabels: readonly string[];
  days: readonly CalendarDay[];
  dateFieldName: string;
  showRecordIcon: boolean;
  recordLink: RecordAnchor;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui font-medium text-ink">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-tiny text-ink-muted">Dated by {dateFieldName}</span>
          <Button aria-label="Previous month" data-tooltip="Previous month" data-tooltip-align="end" onClick={onPreviousMonth} size="iconSm" variant="ghost">
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button onClick={onToday} size="sm" variant="ghost">
            Today
          </Button>
          <Button aria-label="Next month" data-tooltip="Next month" data-tooltip-align="end" onClick={onNextMonth} size="iconSm" variant="ghost">
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <div className="min-w-[42rem]">
          <div className="grid grid-cols-7">
            {weekdayLabels.map((label) => (
              <div className="px-2 py-1 text-tiny font-medium text-ink-muted" key={label}>
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 border-t border-l border-line">
            {days.map((day) => (
              <div
                className={cn(
                  "flex min-h-24 flex-col gap-1 border-r border-b border-line p-1",
                  day.inCurrentMonth ? "bg-canvas" : "bg-sidebar",
                )}
                key={day.id}
              >
                <span
                  className={cn(
                    "self-start rounded-control px-1 text-tiny",
                    day.isToday ? "bg-accent text-accent-ink font-medium" : "text-ink-muted",
                  )}
                >
                  {day.label}
                  {day.isToday ? <span className="sr-only"> — today</span> : null}
                </span>
                {day.records.map((record) => (
                  <a
                    className="record-title flex min-w-0 items-center gap-1 rounded-control bg-sidebar-hover px-1 py-0.5 text-left text-tiny text-ink transition-colors hover:bg-line"
                    key={record.id}
                    {...recordLink(record.id)}
                  >
                    {showRecordIcon ? <RecordIconMark className="size-3" icon={record.icon} /> : null}
                    <span className="truncate">{record.title}</span>
                  </a>
                ))}
                {day.records.length === 0 ? (
                  <span className="sr-only">No {knowledgeNoun("record")}s on this day</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
