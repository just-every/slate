import { PageMovePicker, type PageMoveDestination } from "../PageMovePicker";
import { ApiError, errorMessage } from "../../../../client/transport";
import { useRef, useState } from "react";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey } from "../../../../client/transport";
import { usePageRevisionSave } from "../../../../client/usePagePropertySave";
import { PagePropertyConflict } from "./PagePropertyConflict";
type Plan = {
  containerId: string;
  parentPageId: string | null;
  orderPreviewHash: string;
  accessPreviewHash: string;
  changes: {
    pageId: string;
    memberId: string | null;
      audience?: 'public-link';
    before: string | null;
    after: string | null;
  }[];
};
export function PageTransferDialog({
  pageId,
  revision,
  kind,
  onClose,
  onDone,
  publicSource,
}: {
  pageId: string;
  revision?: string;
  kind: "move" | "duplicate";
  onClose: () => void;
  onDone: (id: string) => void;
  publicSource?: { host: string; slug: string };
}) {
  const spaces = useResource<{ items: { id: string; name: string }[] }>(
    "/api/containers",
  );
  const pages = useResource<{
    items: { id: string; title: string; containerId: string; parentPageId?: string | null }[];
  }>("/api/pages");
  const members = useResource<{ items: { id: string; displayName: string }[] }>(
    "/api/members",
  );
  const [spaceQuery,setSpaceQuery]=useState("");
  const [parentQuery,setParentQuery]=useState("");
  const [moveQuery, setMoveQuery] = useState("");
  const [selectedMove, setSelectedMove] = useState<string | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState<unknown>();
  const [destination, setDestination] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const advancing = useRef(false);
  const key = useRef(operationKey());
  const pending = usePageRevisionSave(revision ?? "");
  if (plan)
    return (
      <ActionDialog
        title="Review changed access"
        action="Move page"
        onClose={onClose}
        onSubmit={async () => {
          await pending.save(`/api/pages/${pageId}/move`, {
            operationKey: key.current,
            containerId: plan.containerId,
            parentPageId: plan.parentPageId,
            atEnd:true,
            orderPreviewHash:plan.orderPreviewHash,
            accessPreviewHash: plan.accessPreviewHash,
          });
          onDone(pageId);
        }}
      >
        {pending.conflict ? <PagePropertyConflict/> : null}
        <p>
          {pages.data?.items.some((page) => page.parentPageId === pageId) ? "The page and its children will move together." : "The page will move; it has no child pages."} Current access changes:
        </p>
        {plan.changes.length ? (
          <ul>
            {plan.changes.map((change, index) => (
              <li key={index}>
                {change.audience === "public-link" ? "Signed-in public link readers" : change.memberId === null ? "Anonymous readers" : members.data?.items.find(
                  (member) => member.id === change.memberId,
                )?.displayName ?? "Workspace member"}{" "}
                ·{" "}
                {pages.data?.items.find((page) => page.id === change.pageId)
                  ?.title ?? "Child page"}
                : {change.before ?? "No access"} → {change.after ?? "No access"}
              </li>
            ))}
          </ul>
        ) : (
          <p>No member access changes were found.</p>
        )}
        <button
          type="button"
          onClick={() => {
            advancing.current = false;
            setPlan(null);
          }}
        >
          Choose another destination
        </button>
      </ActionDialog>
    );
  if (kind === "move") {
    const descendants = new Set([pageId]);
    for (let changed = true; changed;) {
      changed = false;
      for (const page of pages.data?.items ?? []) if (page.parentPageId && descendants.has(page.parentPageId) && !descendants.has(page.id)) { descendants.add(page.id); changed = true; }
    }
    const destinations: PageMoveDestination[] = [
      ...(spaces.data?.items ?? []).map(space => ({id:`container:${space.id}`,label:space.name,path:"",kind:"container" as const})),
      ...(pages.data?.items ?? []).filter(page => !descendants.has(page.id)).map(page => ({id:`page:${page.id}`,label:page.title,path:spaces.data?.items.find(space => space.id === page.containerId)?.name ?? "",kind:"page" as const})),
    ].filter(destination => `${destination.path} ${destination.label}`.toLocaleLowerCase().includes(moveQuery.toLocaleLowerCase()));
    const failure = spaces.error || pages.error || moveError;
    const state = failure ? failure instanceof ApiError && failure.status === 403 ? "denied" : "error" : spaces.loading || pages.loading || movePending ? "loading" : destinations.length ? "ready" : "empty";
    return <><PageMovePicker open onOpenChange={open => {if (!open && !movePending) onClose();}} pageTitle={pages.data?.items.find(page => page.id === pageId)?.title ?? "Page"} currentPath={spaces.data?.items.find(space => space.id === pages.data?.items.find(page => page.id === pageId)?.containerId)?.name ?? "Current space"} childCount={descendants.size-1} destinations={destinations} state={state} query={moveQuery} onQueryChange={setMoveQuery} selectedDestinationId={selectedMove} onSelectDestination={setSelectedMove} onRetry={() => {setMoveError(undefined);void spaces.reload();void pages.reload();}} onConfirm={() => {
      if (state !== "ready" || !selectedMove) return;
      const selected = destinations.find(item => item.id === selectedMove);
      if (!selected) return;
      const parent = selected.kind === "page" ? pages.data?.items.find(page => `page:${page.id}` === selected.id) : null;
      const containerId = parent?.containerId ?? selected.id.slice("container:".length);
      const parentPageId = parent?.id ?? null;
      setMovePending(true);setMoveError(undefined);
      void mutate<Pick<Plan,"changes"|"accessPreviewHash"|"orderPreviewHash">>(`/api/pages/${pageId}/move-preview`, {containerId,parentPageId,atEnd:true}).then(preview => setPlan({...preview,containerId,parentPageId})).catch(setMoveError).finally(() => setMovePending(false));
    }} />{moveError ? <p role="alert">{errorMessage(moveError)}</p> : null}</>;
  }
  return (
    <ActionDialog
      title="Duplicate page"
      action="Create copy"
      onClose={() => {
        if (!advancing.current) onClose();
      }}
      onSubmit={async (data) => {
        const parentPageId = String(data.get("parent")) || null;
          const result = await mutate<{ value: { pageId: string } }>(
            `/api/pages/${pageId}/duplicate`,
            {
              operationKey: key.current,
              containerId: destination,
              parentPageId,
              includeChildren: data.get("children") === "on",
              publicSource,
            },
          );
          onDone(result.value.pageId);

      }}
    >
      <label>Find a space<input type="search" value={spaceQuery} onChange={event=>setSpaceQuery(event.target.value)}/></label>
      <label>
        Destination space
        <select
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          required
        >
          <option value="" disabled>
            Choose a space
          </option>
          {spaces.data?.items.filter(space=>space.id===destination||space.name.toLocaleLowerCase().includes(spaceQuery.toLocaleLowerCase())).map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <label>Find a parent page<input type="search" value={parentQuery} onChange={event=>setParentQuery(event.target.value)}/></label>
      <label>
        Parent page
        <select key={destination} name="parent">
          <option value="">At the top level</option>
          {pages.data?.items
            .filter(
              (page) => page.containerId === destination && page.id !== pageId && page.title.toLocaleLowerCase().includes(parentQuery.toLocaleLowerCase()),
            )
            .map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
        </select>
      </label>
      {!publicSource ? (
        <label>
          <input type="checkbox" name="children" />
          Include child pages
        </label>
      ) : null}
      {publicSource ? (
        <p>
          This copies only the published page you were permitted to duplicate.
        </p>
      ) : null}
    </ActionDialog>
  );
}
