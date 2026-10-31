import { ChevronLeft, Plus, Search } from "lucide-react";
import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { fieldView, recordView } from "../../../../client/records";
import { knowledgeNoun } from "../../../../shared/knowledge/vocabulary";
import type { DatabaseField, FieldValue } from "../types";
import type { RecordAnchor } from "../views/shared";
import type { DatabaseList } from "./useDatabaseList";

/** A value as one plain line of text: the index's meta line shows no tags (H16). */
function plainValue(field: DatabaseField, value: FieldValue | null): string {
  if (!value) return "";
  switch (value.kind) {
    case "options": return value.optionIds.map((id) => field.options?.find((option) => option.id === id)?.label ?? id).join(", ");
    case "text": return value.text;
    case "link": case "place": return value.label;
    case "people": return value.people.map((person) => person.name).join(", ");
    case "files": return value.files.map((file) => file.name).join(", ");
    case "relation": return value.links.map((link) => link.label).join(", ");
    case "checkbox": return "";
    default: return "display" in value ? value.display : "";
  }
}

/**
 * Option C's index (SL1): beside an open record from 1280 px, the view's rows as a name over one quiet line, the open one
 * filled. It is the list's own state, so a pick keeps its scroll, the Find text, the view and the calendar month.
 */
export function RecordIndex({
  list,
  title,
  backHref,
  onBack,
  openId,
  recordLink,
  canEdit,
  onNewRecord,
}: {
  list: DatabaseList;
  title: string;
  backHref: string;
  onBack: (event: MouseEvent<HTMLAnchorElement>) => void;
  openId: string;
  recordLink: RecordAnchor;
  canEdit: boolean;
  onNewRecord: () => void;
}) {
  const scroller = useRef<HTMLElement>(null);
  const fields = list.shown.map(fieldView);
  const rows = list.records.map((record) => recordView(record, list.fields, list.references));
  // A deep link shows its row; a pick from the index never moves it.
  useLayoutEffect(() => {
    const box = scroller.current, row = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box || !row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) box.scrollTop = top - (box.clientHeight - row.offsetHeight) / 2;
  }, []);
  return (
    <nav ref={scroller} className="record-index" aria-label={`${title} records`}>
      <a className="record-back" href={backHref} onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
        <span>{title}</span>
      </a>
      <p className="record-index-count">{rows.length} {knowledgeNoun("record")}{rows.length === 1 ? "" : "s"}</p>
      {list.views.length > 1 ? (
        <label className="record-index-view">
          <span className="sr-only">Saved view</span>
          <select value={list.view?.id} onChange={(event) => list.selectView(event.target.value)}>
            {list.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className="db-find record-index-find">
        <Search aria-hidden="true" />
        <span className="sr-only">Find in this view</span>
        <input type="search" value={list.find} placeholder="Find in this view" onChange={(event) => list.setFind(event.target.value)} />
      </label>
      <ul className="record-index-rows">
        {rows.map((record) => {
          const meta = fields.map((field) => plainValue(field, record.values[field.id] ?? null)).find(Boolean);
          return (
            <li key={record.id}>
              <a {...recordLink(record.id)} aria-current={record.id === openId ? "true" : undefined}>
                <span className="record-index-name">{record.title || "Untitled"}</span>
                {meta ? <span className="record-index-meta">{meta}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <button className="record-index-new" type="button" onClick={onNewRecord}>
          <Plus aria-hidden="true" />
          New {knowledgeNoun("record")}
        </button>
      ) : null}
    </nav>
  );
}
