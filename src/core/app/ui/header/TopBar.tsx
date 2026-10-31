import type { MouseEvent, ReactNode } from "react";

/** `onClick` lets a crumb open its address in place (SL1: a record's database crumb keeps the list mounted). */
export type Crumb = { label: string; href?: string; suffix?: ReactNode; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };

/**
 * The one top bar of the signed-in app: where you are on the left, what you can do here on the right.
 * Every destination, page, database and record mounts it, so height, divider and edges never differ.
 */
export function TopBar({ trail, className, children }: { trail: readonly Crumb[]; className?: string; children?: ReactNode }) {
  return (
    <header className={className ? `topbar ${className}` : "topbar"}>
      <nav className="crumbs" aria-label="Location">
        <ol>
          {trail.map((crumb, index) => {
            const current = index === trail.length - 1;
            return (
              <li key={`${index}:${crumb.label}`}>
                {crumb.href && !current ? <a href={crumb.href} onClick={crumb.onClick}>{crumb.label}</a> : <span aria-current={current ? "page" : undefined}>{crumb.label}</span>}
                {crumb.suffix}
              </li>
            );
          })}
        </ol>
      </nav>
      {children ? <div className="tools">{children}</div> : null}
    </header>
  );
}
