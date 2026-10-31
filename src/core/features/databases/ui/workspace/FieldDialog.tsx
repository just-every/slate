import { useState } from "react";
import { useResource } from "../../../../client/useResource";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { RequestState } from "../../../../app/ui/RequestState";
import type { FieldDto, DatabaseDto } from "../../../../client/records";
import { FormulaBuilder, type Expression } from "./FormulaBuilder";
const types = [
  ["text", "Text"],
  ["number", "Number"],
  ["checkbox", "Checkbox"],
  ["date", "Date"],
  ["select", "Select"],
  ["multi-select", "Multi-select"],
  ["status", "Status"],
  ["person", "Person"],
  ["file", "File"],
  ["url", "URL"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["place", "Place"],
  ["relation", "Relation"],
  ["rollup", "Rollup"],
  ["formula", "Formula"],
  ["created-at", "Created time"],
  ["updated-at", "Updated time"],
  ["identifier", "Identifier"],
];
export function FieldDialog({
  field,
  fields,
  onSave,
  onRemove,
  onClose,
  allowedTypes,
}: {
  field: FieldDto;
  allowedTypes?: string[];
  fields: FieldDto[];
  onSave: (field: FieldDto) => Promise<void>;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [type, setType] = useState(field.type);
  const [expression, setExpression] = useState<Expression>(
    (field.config.expression as Expression | undefined) ?? { literal: 0 },
  );
  const [relation, setRelation] = useState(
    String(field.config.relationField ?? ""),
  );
  const [databaseId, setDatabaseId] = useState(
    String(field.config.databaseId ?? ""),
  );
  const databases = useResource<{ items: { id: string; title: string }[] }>(
    type === "relation" ? "/api/databases" : null,
  );
  const related = fields.find((item) => item.id === relation);
  const target = useResource<DatabaseDto>(
    type === "rollup" && related?.config.databaseId
      ? `/api/databases/${related.config.databaseId}`
      : null,
  );
  return (
    <ActionDialog
      title="Field settings"
      action="Save field"
      onClose={onClose}
      onSubmit={async (form) => {
        const config: Record<string, unknown> = { ...field.config };
        if (["select", "multi-select", "status"].includes(type))
          config.options = String(form.get("options"))
            .split("\n")
            .map((text) => text.trim())
            .filter(Boolean);
        if (type === "formula") config.expression = expression;
        if (type === "relation") config.databaseId = databaseId;
        if (type === "rollup") {
          config.relationField = relation;
          config.targetField = String(form.get("targetField"));
          config.calculation = String(form.get("calculation"));
        }
        await onSave({
          ...field,
          name: String(form.get("name")),
          type,
          config,
        });
      }}
    >
      <label>
        Name
        <input name="name" required defaultValue={field.name} />
      </label>
      <label>
        Type
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          {types.filter(([value]) => !allowedTypes || allowedTypes.includes(value)).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {["select", "multi-select", "status"].includes(type) ? (
        <label>
          Options, one per line
          <textarea
            name="options"
            defaultValue={(Array.isArray(field.config.options)
              ? field.config.options
              : []
            )
              .map((option) =>
                typeof option === "string"
                  ? option
                  : (option as { label: string }).label,
              )
              .join("\n")}
          />
        </label>
      ) : null}
      {type === "formula" ? (
        <FormulaBuilder
          value={expression}
          onChange={setExpression}
          fields={fields.filter((item) => item.id !== field.id)}
        />
      ) : null}
      {type === "relation" ? (
        <RequestState
          loading={databases.loading}
          error={databases.error}
          retry={databases.reload}
        >
          <label>
            Related database
            <select
              aria-label="Related database"
              required
              value={databaseId}
              onChange={(e) => setDatabaseId(e.target.value)}
            >
              <option value="">Choose database</option>
              {databases.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        </RequestState>
      ) : null}
      {type === "rollup" ? (
        <>
          <label>
            Relation
            <select
              aria-label="Relation"
              required
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
            >
              <option value="">Choose relation</option>
              {fields
                .filter((item) => item.type === "relation")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <RequestState
            loading={target.loading}
            error={target.error}
            retry={target.reload}
          >
            <label>
              Related field
              <select
                aria-label="Related field"
                required
                name="targetField"
                defaultValue={String(field.config.targetField ?? "")}
              >
                <option value="">Choose field</option>
                {target.data?.fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </RequestState>
          <label>
            Calculation
            <select
              name="calculation"
              defaultValue={String(field.config.calculation ?? "count")}
            >
              {[
                "count",
                "filled",
                "empty",
                "sum",
                "average",
                "minimum",
                "maximum",
                "range",
                "percent",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {onRemove ? (
        <button type="button" className="tool" onClick={onRemove}>
          Remove field
        </button>
      ) : null}
    </ActionDialog>
  );
}
