import type { FieldDto, ViewDto } from "../../../../client/records";
import { fieldView } from "../../../../client/records";
import type { FilterValue } from "./FilterBuilder";
import { filterOperators } from "./criteriaFields";

export function ViewCriteria({ view, fields, canClear, onClear }: {
  view: ViewDto;
  fields: FieldDto[];
  canClear: boolean;
  onClear: () => void;
}) {
  const name = (id?: string) => id === "$title" ? "Name" : fields.find(field => field.id === id)?.name ?? "Unavailable field";
  const displayValue = (fieldId: string | undefined, value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(item => displayValue(fieldId, item)).join(", ")}]`;
    if (typeof value === "boolean") return value ? "Checked" : "Unchecked";
    const field = fields.find(item => item.id === fieldId);
    const option = field && fieldView(field).options?.find(item => item.id === value);
    return option?.label ?? String(value ?? "");
  };
  const describe = (value: FilterValue): string => value.and
    ? `All of (${value.and.map(describe).join("; ")})`
    : value.or
      ? `Any of (${value.or.map(describe).join("; ")})`
      : `${name(value.field)} ${filterOperators.find(([op]) => op === (value.op ?? "eq"))?.[1] ?? value.op}${["empty", "not-empty"].includes(value.op ?? "") ? "" : ` ${displayValue(value.field, value.value)}`}`;
  if (!view.filters.length && !view.sorts.length) return null;
  return (
    <section className="view-criteria" aria-label="Applied view criteria">
      {view.filters.length ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span>Filters:</span>
          {(view.filters as FilterValue[]).map((filter, index) => <span key={index} className="rounded-control bg-sidebar-hover px-2 py-1 break-words">{describe(filter)}</span>)}
        </div>
      ) : null}
      {view.sorts.length ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span>Sort:</span>
          {view.sorts.map((sort, index) => <span key={index} className="rounded-control bg-sidebar-hover px-2 py-1 break-words">{index + 1}. {name(sort.field)} {sort.direction === "desc" ? "descending" : "ascending"}</span>)}
        </div>
      ) : null}
      {canClear ? <button type="button" onClick={onClear}>Clear filters and sorts</button> : null}
    </section>
  );
}
