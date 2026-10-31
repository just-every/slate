import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { InitialResourcesProvider } from "../../../../client/InitialResources";
import { RequestState } from "../../../../app/ui/RequestState";
import { TopBar } from "../../../../app/ui/header/TopBar";
import { PageWorkspace } from "../../../pages/ui/workspace/PageWorkspace";
import { usePageTrail } from "../../../pages/ui/workspace/usePageTrail";
import { databaseAddress, recordAddress } from "../../../../shared/knowledge/addresses";
import { DatabaseDialogs } from "./DatabaseDialogs";
import { DatabaseList, type DatabaseDialog } from "./DatabaseList";
import { RecordIndex } from "./RecordIndex";
import { RecordLayoutMenu, useBesideWidth, useRecordLayout } from "./RecordLayoutMenu";
import { RecordWorkspace } from "./RecordWorkspace";
import { useDatabaseList } from "./useDatabaseList";

/** A plain click opens in place; a modified click keeps the browser's own (a new tab or window). */
const inPlace = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;

/**
 * SL1, option C: one database at one address, each record at its own. At rest the database's page carries its title,
 * description and page tools above its list. With a record open the record is the page: beside an index of the list from
 * 1280 px (or centred over the list, or a full page, as Record layout chooses), and its own page under 1280 px. The list
 * stays mounted throughout, so its view, Find text, scroll and calendar month survive opening and closing records.
 */
export function DatabaseWorkspace({ id, recordId }: { id: string; recordId?: string }) {
  const router = useRouter();
  const { workspace } = useRouteContext({ from: "/app" });
  const list = useDatabaseList(id);
  const [layout, setLayout] = useRecordLayout();
  const wide = useBesideWidth();
  const [dialog, setDialog] = useState<DatabaseDialog | null>(null);
  const [error, setError] = useState<unknown>();
  const page = list.page.data;
  const title = page?.page.title ?? "";
  const trail = usePageTrail(page);
  const listHref = databaseAddress(id, list.viewParam);
  const centred = wide && layout === "centred";
  // Where the list was when a record opened from it, so closing the record returns there (scroll ±0, focus on the row).
  const rest = useRef(0);
  const shown = useRef(recordId);

  function openRecord(record: string) {
    if (!recordId) rest.current = window.scrollY;
    void router.navigate({ href: recordAddress(id, record, list.viewParam), resetScroll: !centred });
  }
  const closeRecord = useCallback(() => void router.navigate({ href: listHref, resetScroll: false }), [router, listHref]);
  const recordLink = (record: string) => ({
    href: recordAddress(id, record, list.viewParam),
    "data-record-id": record,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => { if (inPlace(event)) { event.preventDefault(); openRecord(record); } },
  });
  const back = (event: MouseEvent<HTMLAnchorElement>) => { if (inPlace(event)) { event.preventDefault(); closeRecord(); } };
  // A relation chip opens the related record at its one address; one of this database's opens beside the list.
  function openLink(pageId: string) {
    const href = list.references.get(pageId)?.url ?? `/app/pages/${encodeURIComponent(pageId)}`;
    const record = new RegExp(`^/app/databases/${encodeURIComponent(id)}/records/([^/?]+)$`).exec(href);
    if (record) openRecord(decodeURIComponent(record[1]));
    else void router.navigate({ href });
  }

  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = recordId;
    if (recordId || !previous) return;
    if (!centred) window.scrollTo(0, rest.current);
    window.document.querySelector<HTMLElement>(`.database-list [data-record-id="${CSS.escape(previous)}"]`)?.focus({ preventScroll: true });
  }, [recordId]);
  // Escape closes the record unless a field, the editor, a menu, a dialog or an open panel takes it first.
  useEffect(() => {
    if (!recordId) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [data-slate-editable], [role="menu"], [role="dialog"], dialog')) return;
      if (window.document.querySelector('dialog[open], [role="dialog"], [role="menu"], .database-route .right')) return;
      closeRecord();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [recordId, closeRecord]);
  // A renamed or trashed record, or a renamed database, updates the list and the trail in place.
  useEffect(() => {
    const changed = () => { void list.query.reload(); void list.page.reload(); };
    window.addEventListener("slate:navigation-changed", changed);
    return () => window.removeEventListener("slate:navigation-changed", changed);
  }, [list.query.reload, list.page.reload]);

  const data = list.resource.data;
  if (!data || !page) {
    return (
      <>
        <TopBar trail={trail} />
        <section className="main">
          <RequestState loading={list.resource.loading || list.page.loading} error={list.resource.error ?? list.page.error} retry={() => void list.reload().catch(setError)} />
        </section>
      </>
    );
  }
  const listHidden = !!recordId && !centred;
  const resources = workspace.resources ?? {};
  const lead = (
    <div className="record-lead">
      <a className="record-back" href={listHref} onClick={back}>
        <ChevronLeft aria-hidden="true" />
        <span>{title}</span>
      </a>
      <RecordLayoutMenu layout={layout} onLayout={setLayout} />
    </div>
  );
  return (
    <div className="database-route" data-record-layout={recordId ? layout : undefined}>
      {recordId ? (
        <InitialResourcesProvider key={`record:${recordId}`} resources={resources}>
          <RecordWorkspace databaseId={id} id={recordId} trail={[...trail, { label: title, href: listHref, onClick: back }]} lead={lead} onSaved={() => void list.query.reload()} />
        </InitialResourcesProvider>
      ) : (
        <InitialResourcesProvider key="database" resources={resources}>
          <PageWorkspace pageId={data.database.page_id} host={{ database: true, topBarClassName: "database-topbar", address: databaseAddress(id) }} />
        </InitialResourcesProvider>
      )}
      {recordId ? (
        <RecordIndex list={list} title={title} backHref={listHref} onBack={back} openId={recordId} recordLink={recordLink} canEdit={page.permissions.canEdit} onNewRecord={() => setDialog({ kind: "new" })} />
      ) : null}
      <section className="main database-workspace database-list" data-layout="wide" hidden={listHidden} inert={listHidden}>
        <DatabaseList list={list} title={title} canEdit={page.permissions.canEdit} canShare={page.permissions.canShare} parity={page.policyProfile["record.page-parity.v1"]} recordLink={recordLink} onOpenLink={openLink} onDialog={setDialog} error={error} onError={setError} />
      </section>
      <DatabaseDialogs list={list} dialog={dialog} onDialog={setDialog} />
    </div>
  );
}
