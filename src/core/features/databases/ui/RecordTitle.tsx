import { FileText } from "lucide-react";
import { cn } from "../../../ui";
import type { RecordIcon } from "./types";
import type { RecordAnchor } from "./views/shared";

/**
 * `DB-010` — the per-record icon, shown under `record-is-page` and hidden under
 * `record-is-row`. It is stored either way; only the display changes.
 */
export function RecordIconMark({ icon, className }: { icon: RecordIcon; className?: string }) {
  if (icon === null) {
    return <FileText aria-hidden="true" className={cn("size-3.5 shrink-0 text-ink-faint", className)} />;
  }
  if (icon.kind === "image") {
    return <img alt="" className={cn("size-4 shrink-0 rounded-[0.1875rem] object-cover", className)} src={icon.url} />;
  }
  return (
    <span aria-hidden="true" className={cn("shrink-0 text-[0.8125rem] leading-none", className)}>
      {icon.emoji}
    </span>
  );
}

export function RecordTitle({
  title,
  icon,
  showIcon,
  link,
  className,
}: {
  title: string;
  icon: RecordIcon;
  showIcon: boolean;
  link: ReturnType<RecordAnchor>;
  className?: string;
}) {
  return (
    <a
      className={cn(
        "record-title flex min-w-0 items-center gap-1.5 rounded-control text-left text-ui text-ink transition-colors hover:text-accent",
        className,
      )}
      {...link}
    >
      {showIcon ? <RecordIconMark icon={icon} /> : null}
      <span className="truncate font-medium">{title}</span>
    </a>
  );
}
