import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Funnel, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The one Filter control of a list screen. Its menu opens in place (no portal), so its fields keep the app's field styles,
 * and its open state is owned by the screen, so the results refreshing behind it never close it. Applied filters show
 * beside it as {@link FilterChips}.
 */
export function FilterMenu({ open, onOpenChange, label, disabled = false, children, foot }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Two to four words, starting with "Filter": the control's accessible name, its tooltip and its menu's name. */
  label: string;
  /** Until the screen's handlers and state are ready, the control takes no input. */
  disabled?: boolean;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger type="button" className="filter-button" aria-label={label} data-tooltip={label} disabled={disabled}>
        <Funnel aria-hidden="true" />
        <span>Filter</span>
        <ChevronDown aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Content className="filter-menu" aria-label={label} align="start" sideOffset={8} collisionPadding={16}>
        <div className="filter-menu-fields">{children}</div>
        {foot ? <div className="filter-menu-foot">{foot}</div> : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Root>
  );
}

export interface FilterChip { key: string; label: string; remove: string; onRemove: () => void }

/** Applied filters as chips; each x names what it removes, as its accessible name and its tooltip. */
export function FilterChips({ items, className }: { items: readonly FilterChip[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={className ? `chips ${className}` : "chips"} aria-label="Applied filters">
      {items.map(item => (
        <li key={item.key} className="chip">
          <span>{item.label}</span>
          <button type="button" aria-label={item.remove} data-tooltip={item.remove} onClick={item.onRemove}><X aria-hidden="true" /></button>
        </li>
      ))}
    </ul>
  );
}
