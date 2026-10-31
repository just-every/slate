import { useEffect, useState } from "react";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useRecordReferences } from "../../../../client/useRecordReferences";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey } from "../../../../client/transport";
import { storedValue, type DatabaseDto, type FieldDto, type QueryDto, type RecordDto, type ViewDto } from "../../../../client/records";
import type { DocumentView } from "../../../../client/content";
import type { FieldValue } from "../types";
import type { DatabaseMode } from "./DatabaseToolbar";

/** A database's list state, kept while its records open and close: the view (`?view=`, omitted for the first), the Find text, the mode and the rows. */
export function useDatabaseList(id: string) {
  const router = useRouter();
  const search = useSearch({ strict: false }) as { view?: unknown };
  const path = `/api/databases/${encodeURIComponent(id)}`;
  const resource = useResource<DatabaseDto>(path);
  const page = useResource<DocumentView>(resource.data ? `/api/pages/${encodeURIComponent(resource.data.database.page_id)}` : null);
  const requested = search.view == null ? undefined : String(search.view);
  const [active, setActive] = useState(requested);
  // The address wins when it changes on its own (Back, a link); a pick sets both at once.
  useEffect(() => setActive(requested), [requested]);
  const views = resource.data?.views ?? [];
  const view = views.find((item) => item.id === active) ?? views[0];
  const viewParam = view && view.id !== views[0]?.id ? view.id : undefined;
  const query = useResource<QueryDto>(view ? `${path}/views/${encodeURIComponent(view.id)}` : null);
  const [mode, setMode] = useState<DatabaseMode>("records");
  const [find, setFind] = useState("");
  const fields = resource.data?.fields ?? [];
  const references = useRecordReferences(fields, query.data?.records ?? []);
  const records = (query.data?.records ?? []).filter((record) => record.title.toLocaleLowerCase().includes(find.toLocaleLowerCase()));
  const shown = fields.filter((field) => !Array.isArray(view?.display.visibleFieldIds) || view.display.visibleFieldIds.includes(field.id));

  function showView(next: string | undefined) {
    setActive(next);
    const url = new URL(window.location.href);
    if (next && next !== views[0]?.id) url.searchParams.set("view", next);
    else url.searchParams.delete("view");
    // The view is list state in the address: no new history entry, no visit and no scroll move.
    void router.navigate({ href: `${url.pathname}${url.search}${url.hash}`, replace: true, resetScroll: false, state: (previous) => ({ ...previous, slatePanelNavigation: true }) });
  }
  function selectView(next: string) {
    setMode("records");
    showView(next);
  }
  async function reload() {
    if (!(await resource.reload())) throw new Error("The change was saved, but the database could not be refreshed. Reload it before editing again.");
    await query.reload();
  }
  async function saveView(next: ViewDto) {
    if (!resource.data) return;
    const { revisionId: _revisionId, ...input } = next;
    await mutate(`${path}/views`, { operationKey: operationKey(), expectedRevisionId: resource.data.database.revision_id, view: input });
    showView(next.id);
    await reload();
  }
  async function saveValue(record: RecordDto, field: FieldDto, value: unknown) {
    await mutate(`${path}/records/${encodeURIComponent(record.pageId)}`, { operationKey: operationKey(), expectedRevisionId: record.revisionId, values: { [field.id]: value } }, "PATCH");
    await query.reload();
  }
  function cellValue(recordId: string, fieldId: string, value: FieldValue | null) {
    const record = query.data?.records.find((item) => item.pageId === recordId), field = fields.find((item) => item.id === fieldId);
    if (!record || !field) return Promise.resolve();
    let stored = storedValue(value);
    if (["select", "status"].includes(field.type) && Array.isArray(stored)) stored = stored[0] ?? null;
    return saveValue(record, field, stored);
  }
  return { path, resource, page, views, view, viewParam, query, mode, setMode, find, setFind, fields, shown, records, references, selectView, showView, reload, saveView, saveValue, cellValue };
}

export type DatabaseList = ReturnType<typeof useDatabaseList>;
