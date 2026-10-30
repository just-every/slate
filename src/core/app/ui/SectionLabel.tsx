import type { ReactNode } from "react";

/** A section of a list screen: the label step with its count, and its own hairline to the right edge. */
export function SectionLabel({ children, count, id }: { children: ReactNode; count?: number | string; id?: string }) {
  return <h2 className="section-label" id={id}><span>{children}{count === undefined ? null : ` (${count})`}</span></h2>;
}
