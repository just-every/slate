import type { FieldDto } from "../../../../client/records";
import { fieldView } from "../../../../client/records";
import { criteriaFieldType } from "./criteriaFields";
import { FilterReferenceInput } from "./FilterReferenceInput";

export function FilterInput({ databaseId, field, fields, operator, value, onChange }: {
  databaseId: string;
  field?: FieldDto;
  fields: FieldDto[];
  operator: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const type = criteriaFieldType(field, fields);
  const multiple = type === "array" && operator !== "contains";
  if (field && ["person", "file", "relation"].includes(field.type))
    return <FilterReferenceInput key={`${field.id}-${multiple}`} databaseId={databaseId} field={field} value={value} multiple={multiple} onChange={onChange} />;
  if (field && ["select", "status", "multi-select"].includes(field.type)) {
    const selected = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
    return (
      <label>
        Value
        <select aria-label="Value" multiple={multiple} size={multiple ? 4 : undefined} required={!multiple} value={multiple ? selected : selected[0] ?? ""} onChange={event => onChange(multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value)}>
          {!multiple ? <option value="">Choose an option</option> : null}
          {fieldView(field).options?.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  const effectiveType = type === "unknown" || type === "null"
    ? Array.isArray(value) ? "array" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text"
    : type;
  return (
    <>
      {type === "unknown" || type === "null" ? (
        <label>
          Value type
          <select value={effectiveType} onChange={event => onChange(event.target.value === "number" ? 0 : event.target.value === "boolean" ? false : event.target.value === "array" ? [] : "")}>
            <option value="text">Text</option><option value="number">Number</option><option value="boolean">Checkbox</option><option value="array">List</option>
          </select>
        </label>
      ) : null}
      <label>
        Value
        {effectiveType === "boolean" ? (
          <select aria-label="Value" value={String(value === true)} onChange={event => onChange(event.target.value === "true")}>
            <option value="true">Checked</option><option value="false">Unchecked</option>
          </select>
        ) : effectiveType === "array" && operator !== "contains" ? (
          <textarea aria-label="Value" placeholder="One value per line" value={Array.isArray(value) ? value.join("\n") : String(value ?? "")} onChange={event => onChange(event.target.value ? event.target.value.split("\n") : [])} />
        ) : (
          <input
            aria-label="Value"
            required
            type={effectiveType === "number" ? "number" : effectiveType === "date" ? "date" : "text"}
            step={effectiveType === "number" ? "any" : undefined}
            value={effectiveType === "date" ? String(value ?? "").slice(0, 10) : String(value ?? "")}
            onChange={event => onChange(effectiveType === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
          />
        )}
      </label>
    </>
  );
}
