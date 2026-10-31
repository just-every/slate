import { FilterBuilder, type FilterValue } from "./FilterBuilder";
import { useState } from "react";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import type { ViewDto, FieldDto } from "../../../../client/records";
export function ViewDialog({
  view,
  fields,
  onSave,
  onClose,
}: {
  view: ViewDto;
  fields: FieldDto[];
  onSave: (view: ViewDto) => Promise<void>;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState(view.layout);
  const [filters, setFilters] = useState(view.filters as FilterValue[]);
  return (
    <ActionDialog
      title="View settings"
      action="Save view"
      onClose={onClose}
      onSubmit={async (form) => {
        const sort = String(form.get("sortField") ?? "");
        const group = String(form.get("groupField") ?? "");
        await onSave({
          ...view,
          name: String(form.get("name")),
          layout,
          filters,
          sorts: sort
            ? [
                {
                  field: sort,
                  direction: String(form.get("direction")) as "asc" | "desc",
                },
              ]
            : [],
          groups: group
            ? [{ field: group, hideEmpty: form.get("hideEmpty") === "on" }]
            : [],
          display: {
            ...view.display,
            dateField: String(form.get("dateField") ?? ""),
            visibleFieldIds: form.getAll("visible").map(String),
          },
        });
      }}
    >
      <label>
        Name
        <input name="name" required defaultValue={view.name} />
      </label>
      <label>
        Layout
        <select
          value={layout}
          onChange={(e) => setLayout(e.target.value as ViewDto["layout"])}
        >
          {["table", "board", "list", "gallery", "calendar", "timeline"].map(
            (value) => (
              <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>
            ),
          )}
        </select>
      </label>
      {["calendar", "timeline"].includes(layout) ? (
        <label>
          Date field
          <select
            name="dateField"
            required
            defaultValue={String(view.display.dateField ?? "")}
          >
            <option value="">Choose date field</option>
            {fields
              .filter((field) => field.type === "date")
              .map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <label>
        Group by
        <select name="groupField" defaultValue={view.groups[0]?.field ?? ""}>
          <option value="">No grouping</option>
          {fields
            .filter(
              (field) => ["select", "status", "person", "checkbox", "date"].includes(field.type),
            )
            .map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          name="hideEmpty"
          defaultChecked={view.groups[0]?.hideEmpty}
        />
        Hide empty groups
      </label>
      <label>
        Sort by
        <select name="sortField" defaultValue={view.sorts[0]?.field ?? ""}>
          <option value="">No sort</option>
          <option value="$title">Name</option>
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Direction
        <select
          name="direction"
          defaultValue={view.sorts[0]?.direction ?? "asc"}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
      <FilterBuilder filters={filters} fields={fields} onChange={setFilters} />
      <fieldset>
        <legend>Visible fields</legend>
        {fields.map((field) => (
          <label key={field.id}>
            <input
              name="visible"
              type="checkbox"
              value={field.id}
              defaultChecked={
                !Array.isArray(view.display.visibleFieldIds) ||
                view.display.visibleFieldIds.includes(field.id)
              }
            />
            {field.name}
          </label>
        ))}
      </fieldset>
    </ActionDialog>
  );
}
