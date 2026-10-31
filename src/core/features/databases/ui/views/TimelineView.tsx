import { cn } from "../../../../ui";
import { RecordIconMark } from "../RecordTitle";
import type { TimelineBar } from "../types";
import type { RecordAnchor } from "./shared";

/**
 * `DB-004` timeline layout. Each bar's position and width arrive as percentages
 * of the window the caller chose, so nothing here computes a date.
 */
export function TimelineView({
  bars,
  columnLabels,
  dateFieldName,
  showRecordIcon,
  recordLink,
  className,
}: {
  bars: readonly TimelineBar[];
  /** The headings across the top — weeks, months or quarters, as the caller chose. */
  columnLabels: readonly string[];
  dateFieldName: string;
  showRecordIcon: boolean;
  recordLink: RecordAnchor;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 p-3", className)}>
      <p className="text-tiny text-ink-muted">Dated by {dateFieldName}</p>
      <div className="w-full overflow-x-auto">
        <div className="min-w-[48rem]">
          <div className="flex border-b border-line">
            <div className="w-48 shrink-0 px-2 py-1 text-tiny font-medium text-ink-muted">Name</div>
            <div className="flex flex-1">
              {columnLabels.map((label) => (
                <div className="flex-1 border-l border-line px-2 py-1 text-tiny font-medium text-ink-muted" key={label}>
                  {label}
                </div>
              ))}
            </div>
          </div>

          <ul>
            {bars.map((bar) => (
              <li className="flex items-center border-b border-line last:border-b-0" key={bar.record.id}>
                <div className="w-48 shrink-0 px-2 py-2">
                  <a
                    className="record-title flex min-w-0 items-center gap-1.5 text-left text-ui text-ink transition-colors hover:text-accent"
                    {...recordLink(bar.record.id)}
                  >
                    {showRecordIcon ? <RecordIconMark icon={bar.record.icon} /> : null}
                    <span className="truncate">{bar.record.title}</span>
                  </a>
                </div>
                <div className="relative h-9 flex-1 border-l border-line">
                  <div
                    className="absolute top-1.5 flex h-6 items-center rounded-control bg-accent-soft px-2 text-tiny text-accent"
                    style={{ left: `${bar.startPercent}%`, width: `${bar.widthPercent}%` }}
                  >
                    <span className="truncate">{bar.rangeLabel}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
