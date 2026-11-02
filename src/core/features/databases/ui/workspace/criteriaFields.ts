import type { FieldDto } from "../../../../client/records";
import { validateFormulas } from "../../formulas";
import type { Field } from "../../values";

export const filterOperators = [
  ["eq", "is"],
  ["ne", "is not"],
  ["contains", "contains"],
  ["gt", "greater than"],
  ["gte", "at least"],
  ["lt", "less than"],
  ["lte", "at most"],
  ["empty", "is empty"],
  ["not-empty", "is not empty"],
] as const;

export function criteriaFieldType(field: FieldDto | undefined, fields: FieldDto[]) {
  return field ? validateFormulas(fields as Field[]).get(field.id) : "text";
}

export function initialCondition(field: FieldDto | undefined, fields: FieldDto[]) {
  const type = criteriaFieldType(field, fields);
  return {
    field: field?.id,
    op: type === "array" ? "contains" : "eq",
    value: type === "boolean" ? false : type === "number" ? 0 : "",
  };
}
