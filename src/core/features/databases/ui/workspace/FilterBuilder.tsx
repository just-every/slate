import type { FieldDto } from "../../../../client/records";
import { FilterInput } from "./FilterInput";
import { criteriaFieldType, filterOperators, initialCondition } from "./criteriaFields";

export type FilterValue = {
  field?: string;
  op?: string;
  value?: unknown;
  and?: FilterValue[];
  or?: FilterValue[];
};

export function FilterBuilder({ filters, fields, databaseId, onChange, depth = 0 }: {
  filters: FilterValue[];
  fields: FieldDto[];
  databaseId: string;
  onChange: (value: FilterValue[]) => void;
  depth?: number;
}) {
  const change = (index: number, value: FilterValue) =>
    onChange(filters.map((old, i) => i === index ? value : old));
  return (
    <div className="filter-builder grid gap-3 text-sm">
      {filters.map((filter, index) => {
        const group = filter.and ?? filter.or;
        const field = fields.find(item => item.id === filter.field);
        const type = criteriaFieldType(field, fields);
        const operator = filter.op ?? "eq";
        const available = filterOperators.filter(([op]) =>
          op === operator || ["eq", "ne", "empty", "not-empty"].includes(op) ||
          op === "contains" && ["text", "array", "unknown"].includes(type ?? "") ||
          ["gt", "gte", "lt", "lte"].includes(op) && ["number", "date", "unknown"].includes(type ?? ""),
        );
        return (
          <fieldset key={index} className="rounded-control bg-sidebar-hover" style={{ padding: 12 }}>
            <legend>{group ? "Condition group" : "Condition"}</legend>
            {group ? (
              <>
                <label>
                  Match conditions
                  <select aria-label="Match conditions" value={filter.or ? "or" : "and"} onChange={event => change(index, { [event.target.value]: group })}>
                    <option value="and">All must match</option>
                    <option value="or">Any may match</option>
                  </select>
                </label>
                <FilterBuilder filters={group} fields={fields} databaseId={databaseId} depth={depth + 1} onChange={value => change(index, filter.or ? { or: value } : { and: value })} />
              </>
            ) : (
              <>
                <label>
                  Field
                  <select aria-label="Field" value={filter.field ?? ""} required onChange={event => change(index, initialCondition(fields.find(item => item.id === event.target.value), fields))}>
                    <option value="" disabled>Choose a field</option>
                    {fields.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label>
                  Condition
                  <select aria-label="Condition" value={operator} onChange={event => {
                    const op = event.target.value;
                    if (["empty", "not-empty"].includes(op)) {
                      change(index, { field: filter.field, op });
                      return;
                    }
                    const wasMultiple = type === "array" && operator !== "contains";
                    const isMultiple = type === "array" && op !== "contains";
                    const value = wasMultiple === isMultiple ? filter.value : isMultiple ? filter.value === "" ? [] : [filter.value] : Array.isArray(filter.value) ? filter.value[0] ?? "" : filter.value;
                    change(index, { ...filter, op, value });
                  }}>
                    {available.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {!["empty", "not-empty"].includes(operator) ? <FilterInput databaseId={databaseId} field={field} fields={fields} operator={operator} value={filter.value} onChange={value => change(index, { ...filter, value })} /> : null}
              </>
            )}
            <button type="button" onClick={() => onChange(filters.filter((_, i) => i !== index))}>{group ? "Remove condition group" : "Remove condition"}</button>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!fields.length || filters.length >= 100} onClick={() => onChange([...filters, initialCondition(fields[0], fields)])}>Add condition</button>
        {depth < 32 ? <button type="button" disabled={!fields.length || filters.length >= 100} onClick={() => onChange([...filters, { and: [] }])}>Add condition group</button> : null}
      </div>
    </div>
  );
}
