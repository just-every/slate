import type { FieldDto, ViewDto } from "../../../../client/records";

export function SortBuilder({ sorts, fields, onChange }: {
  sorts: ViewDto["sorts"];
  fields: FieldDto[];
  onChange: (sorts: ViewDto["sorts"]) => void;
}) {
  const change = (index: number, patch: Partial<ViewDto["sorts"][number]>) =>
    onChange(sorts.map((sort, i) => i === index ? { ...sort, ...patch } : sort));
  const move = (index: number, offset: number) => {
    const next = [...sorts];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <fieldset aria-label="Sort order">
      <legend>Sort order</legend>
      {sorts.map((sort, index) => (
        <fieldset key={index} className="rounded-control bg-sidebar-hover" style={{ padding: 12 }}>
          <legend>Sort {index + 1}</legend>
          <label>
            Sort field
            <select aria-label="Sort field" value={sort.field} onChange={event => change(index, { field: event.target.value })}>
              <option value="$title">Name</option>
              {fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
            </select>
          </label>
          <label>
            Sort direction
            <select aria-label="Sort direction" value={sort.direction} onChange={event => change(index, { direction: event.target.value as "asc" | "desc" })}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-label="Move sort up" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button>
            <button type="button" aria-label="Move sort down" disabled={index === sorts.length - 1} onClick={() => move(index, 1)}>Move down</button>
            <button type="button" onClick={() => onChange(sorts.filter((_, i) => i !== index))}>Remove sort</button>
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={() => onChange([...sorts, { field: "$title", direction: "asc" }])}>Add sort</button>
    </fieldset>
  );
}
