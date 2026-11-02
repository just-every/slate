import { useState } from "react";
import type { FieldDto } from "../../../../client/records";
import { useResource } from "../../../../client/useResource";
import { RequestState } from "../../../../app/ui/RequestState";

export function FilterReferenceInput({ databaseId, field, value, multiple, onChange }: {
  databaseId: string;
  field: FieldDto;
  value: unknown;
  multiple: boolean;
  onChange: (value: unknown) => void;
}) {
  const [search, setSearch] = useState("");
  const choices = useResource<{ items: { id: string; label: string }[]; hasMore: boolean }>(
    `/api/databases/${databaseId}/references/${field.id}?query=${encodeURIComponent(search)}`,
  );
  const selected = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  const items = choices.data?.items ?? [];
  return (
    <div className="grid gap-2">
      <label>
        Find {field.name}
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <RequestState loading={choices.loading} error={choices.error} retry={choices.reload}>
        <label>
          Value
          <select
            aria-label="Value"
            multiple={multiple}
            required={!multiple}
            size={multiple ? 5 : undefined}
            value={multiple ? selected : selected[0] ?? ""}
            onChange={event => onChange(multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value)}
          >
            {!multiple ? <option value="">Choose a value</option> : null}
            {selected.filter(id => !items.some(item => item.id === id)).map(id => <option key={id} value={id}>{id}</option>)}
            {items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {choices.data?.hasMore ? <p className="text-sm">Narrow your search to see more choices.</p> : null}
        {choices.data?.items.length === 0 ? <p className="text-sm">No accessible matches.</p> : null}
      </RequestState>
    </div>
  );
}
