import type { ReferenceLabel } from "./useRecordReferences";
import { displayDate } from "../app/ui/displayDate";
import { recordDate } from "./recordDates";
import type {
  DatabaseField,
  DatabaseRecord,
  FieldValue,
  DatabaseFieldType,
} from "../features/databases/ui/types";
export interface FieldDto {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  position: number;
  evaluationState?: "current" | "retained-not-recomputed";
  readOnly?: boolean;
}
export interface ViewDto {
  id: string;
  name: string;
  layout: "table" | "board" | "list" | "gallery" | "calendar" | "timeline";
  filters: unknown[];
  sorts: { field: string; direction: "asc" | "desc" }[];
  groups: { field: string; hideEmpty?: boolean }[];
  calculations: Record<string, string>;
  display: Record<string, unknown>;
  position: number;
  revisionId: string;
}
export interface RecordDto {
  pageId: string;
  revisionId: string;
  title: string;
  icon?: string | null;
  values: Record<string, unknown>;
}
export interface DatabaseDto {
  database: {
    id: string;
    page_id: string;
    revision_id: string;
    structure_locked_by_member_id: string | null;
    structure_locked_at: string | null;
    structure_locked_by_name: string | null;
  };
  fields: FieldDto[];
  views: ViewDto[];
}
export interface QueryDto {
  records: RecordDto[];
  groups: {
    field: string;
    groups: { value: unknown; count: number; pageIds: string[] }[];
  }[];
  calculations: Record<string, unknown>;
}
export function fieldView(field: FieldDto): DatabaseField {
  return {
    id: field.id,
    name: field.name,
    type: (field.type === "created-at"
      ? "created-time"
      : field.type === "updated-at"
        ? "updated-time"
        : field.type) as DatabaseFieldType,
    editable:
      !field.readOnly &&
      !["formula", "rollup", "created-at", "updated-at", "identifier"].includes(
        field.type,
      ),
    options: Array.isArray(field.config.options)
      ? field.config.options.map((option: unknown) =>
          typeof option === "string"
            ? { id: option, label: option, colour: "neutral" }
            : (option as { id: string; label: string; colour: "neutral" }),
        )
      : undefined,
    expression:
      typeof field.config.expression === "string"
        ? field.config.expression
        : undefined,
    evaluationState: field.evaluationState,
  };
}
export function fieldValue(
  field: FieldDto,
  value: unknown,
  references?: Map<string, ReferenceLabel>,
): FieldValue | null {
  if (value == null) return null;
  switch (field.type) {
    case "number":
      return { kind: "number", number: Number(value), display: String(value) };
    case "checkbox":
      return { kind: "checkbox", checked: value === true };
    case "date":
      return { kind: "date", display: recordDate(String(value)), stored: String(value) };
    case "select":
    case "status":
      return { kind: "options", optionIds: [String(value)] };
    case "multi-select":
      return { kind: "options", optionIds: value as string[] };
    case "url":
    case "email":
    case "phone":
      return {
        kind: "link",
        href:
          field.type === "email"
            ? `mailto:${value}`
            : field.type === "phone"
              ? `tel:${value}`
              : String(value),
        label: String(value),
      };
    case "relation":
      return {
        kind: "relation",
        links: (value as string[]).map((id) => ({
          id,
          label: references?.get(id)?.label ?? "Unavailable record",
        })),
      };
    case "file":
      return {
        kind: "files",
        files: (value as string[]).map((id) => ({
          id,
          name: references?.get(id)?.label ?? "Unavailable file",
        })),
      };
    case "person":
      return {
        kind: "people",
        people: (value as string[]).map((id) => ({
          id,
          name: references?.get(id)?.label ?? "Unavailable member",
        })),
      };
    case "place":
      return { kind: "place", label: String(value) };
    case "formula":
    case "rollup":
      return { kind: "carried", display: String(value) };
    case "created-at":
    case "updated-at":
      return {
        kind: "metadata",
        display: displayDate(String(value), true),
      };
    case "identifier":
      return { kind: "identifier", display: String(value) };
    default:
      return { kind: "text", text: String(value) };
  }
}
export function recordView(
  record: RecordDto,
  fields: FieldDto[],
  references?: Map<string, ReferenceLabel>,
): DatabaseRecord {
  return {
    id: record.pageId,
    title: record.title,
    icon: record.icon
      ? record.icon.startsWith("file:")
        ? { kind: "image", url: `/api/media/${encodeURIComponent(record.icon.slice(5))}?display=inline` }
        : { kind: "emoji", emoji: record.icon }
      : null,
    values: Object.fromEntries(
      fields.map((field) => [
        field.id,
        fieldValue(field, record.values[field.id], references),
      ]),
    ),
  };
}
export function storedValue(value: FieldValue | null): unknown {
  if (value === null) return null;
  switch (value.kind) {
    case "number":
      return value.number;
    case "checkbox":
      return value.checked;
    case "text":
      return value.text;
    case "date":
      if (value.stored === undefined)
        throw new Error("A displayed date cannot be saved without its stored value.");
      return value.stored;
    case "options":
      return [...value.optionIds];
    case "people":
      return value.people.map((x) => x.id);
    case "files":
      return value.files.map((x) => x.id);
    case "relation":
      return value.links.map((x) => x.id);
    case "link":
      return value.label;
    case "place":
      return value.label;
    default:
      return value.display;
  }
}
