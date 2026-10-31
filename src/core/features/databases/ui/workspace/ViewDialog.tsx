import { FilterBuilder, type FilterValue } from "./FilterBuilder";
import { useState } from "react";
import { FieldDialog } from "./FieldDialog";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import type { ViewDto, FieldDto } from "../../../../client/records";
export function ViewDialog({
  view,
  fields,
  onSave,
  onSaveField,
  onClose,
}: {
  view: ViewDto;
  fields: FieldDto[];
  onSave: (view: ViewDto) => Promise<void>;
  onSaveField: (field: FieldDto) => Promise<void>;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState(view.layout);
  const [filters, setFilters] = useState(view.filters as FilterValue[]);
  const [groupField, setGroupField] = useState(view.groups[0]?.field ?? "");
  const [dateField, setDateField] = useState(String(view.display.dateField ?? ""));
  const [creatingField, setCreatingField] = useState<FieldDto>();
  const groupFields = fields.filter(field =>
    ["select", "status", "person", "checkbox", "date"].includes(field.type));
  const dateFields = fields.filter(field => field.type === "date");
  const needsDate = layout === "calendar" || layout === "timeline";
  const missingGroup = layout === "board" && !groupFields.some(field => field.id === groupField);
  const missingDate = needsDate && !dateFields.some(field => field.id === dateField);
  function createField(type: "select" | "date") {
    setCreatingField({
      id: crypto.randomUUID(), name: type === "date" ? "Date" : "Group",
      type, config: {}, position: fields.length,
    });
  }
  return (
    <>
    <ActionDialog
      title="View settings"
      action="Save view"
      submitDisabled={missingGroup || missingDate || !!creatingField}
      onClose={onClose}
      onSubmit={async (form) => {
        const sort = String(form.get("sortField") ?? "");
        const group = groupField;
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
            dateField: needsDate ? dateField : view.display.dateField ?? "",
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
      {needsDate ? (
        <>
        <label>
          Date field
          <select
            name="dateField"
            required
            value={dateField}
            onChange={event => setDateField(event.target.value)}
          >
            <option value="">Choose date field</option>
            {dateFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
          </select>
        </label>
        {missingDate ? <p>Choose or create a date field before saving this layout.</p> : null}
        <button type="button" className="tool" onClick={() => createField("date")}>Create a date field</button>
        </>
      ) : null}
      <label>
        Group by
        <select name="groupField" required={layout === "board"} value={groupField}
          onChange={event => setGroupField(event.target.value)}>
          <option value="">No grouping</option>
          {groupFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
        </select>
      </label>
      {layout === "board" ? <>
        {missingGroup ? <p>Choose or create a grouping field before saving this board.</p> : null}
        <button type="button" className="tool" onClick={() => createField("select")}>Create a grouping field</button>
      </> : null}
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
    {creatingField ? <FieldDialog
      field={creatingField}
      fields={fields}
      allowedTypes={[creatingField.type]}
      onClose={() => setCreatingField(undefined)}
      onSave={async field => {
        await onSaveField(field);
        if (creatingField.type === "date") setDateField(field.id);
        else setGroupField(field.id);
      }}
    /> : null}
    </>
  );
}
