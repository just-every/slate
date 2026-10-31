import { ArrowLeftRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../../../../ui";

/** Keep wide tables contained and make their additional columns discoverable. */
export function TableScrollRegion({ children, className }: { children: ReactNode; className?: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    // A list hidden behind an open record measures nothing; keep its hint as it was, so returning moves no row (SL1).
    const measure = () => { if (node.clientWidth) setOverflowing(node.scrollWidth > node.clientWidth + 1); };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div className={cn("database-table", className)}>
      {overflowing ? <p className="database-table-scroll-hint" id={hintId}>
        <ArrowLeftRight aria-hidden="true" /> Scroll horizontally to see more fields
      </p> : null}
      <div
        ref={scroll}
        className="relative w-full overflow-x-auto"
        role="region"
        aria-label="Records table"
        aria-describedby={overflowing ? hintId : undefined}
        tabIndex={overflowing ? 0 : undefined}
      >
        {children}
      </div>
    </div>
  );
}
