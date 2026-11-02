import { useRef, useState } from "react";
import { useResource } from "../../../client/useResource";
import { mutate, operationKey, errorMessage, ApiError } from "../../../client/transport";
import { RequestState } from "../../../app/ui/RequestState";
import { ActionDialog } from "../../../app/ui/ActionDialog";
import { TopBar } from "../../../app/ui/header/TopBar";
import { PageTitle } from "../../../app/ui/header/PageTitle";
interface Archived {
  id: string;
  containerId:string;
  title: string;
  revisionId: string;
  archivedAt: string | null;
  trashedAt: string | null;
  reason: string | null;
  restoreNeedsDestination: boolean;
  canRestore: boolean;
}
/** `embedded` puts the list inside a space's Trash tab, which already has its own top bar and title. */
export function WorkspaceArchive({containerId,embedded}:{containerId?:string;embedded?:boolean}={}) {
  const resource = useResource<{ items: Archived[] }>("/api/archive");
  const [tab, setTab] = useState(containerId?"trash":"archive");
  const [relocating, setRelocating] = useState<Archived>();
  const [selected, setSelected] = useState<Archived>();
  const [error, setError] = useState<unknown>();
  async function restore(item: Archived) {
    try {
      await mutate(`/api/archive/${item.id}`, {
        operationKey: operationKey(),
        expectedRevisionId: item.revisionId,
        action: "restore",
      });
      resource.reload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "RESTORE_DESTINATION_REQUIRED")
        setRelocating(item);
      else setError(cause);
    }
  }
  const tabs = (
    <div className="tabs" role="group" aria-label="Archive and trash">
      <button type="button" aria-pressed={tab === "archive"} onClick={() => setTab("archive")}>
        Archive
      </button>
      <button type="button" aria-pressed={tab === "trash"} onClick={() => setTab("trash")}>
        Trash
      </button>
    </div>
  );
  const body = <>
        <RequestState
          loading={resource.loading}
          error={resource.error}
          retry={resource.reload}
        >
          <ul className="archive-list">
            {resource.data?.items
              .filter((item) =>
                (!containerId||item.containerId===containerId) && (tab === "trash" ? item.trashedAt : !item.trashedAt),
              )
              .map((item) => (
                <li key={item.id}>
                  <div>
                    <h2>{item.title}</h2>
                    <p>{item.reason}</p>
                  </div>
                  <button className="secondary-button" type="button" disabled={!item.canRestore} onClick={() => item.restoreNeedsDestination ? setRelocating(item) : void restore(item)}>
                    Restore
                  </button>
                  {item.trashedAt ? (
                    <button className="secondary-button" type="button" onClick={() => setSelected(item)}>
                      Delete permanently
                    </button>
                  ) : null}
                </li>
              ))}
          </ul>
          {resource.data?.items.filter((item) =>
            tab === "trash" ? item.trashedAt : !item.trashedAt,
          ).length === 0 ? (
            <p>Nothing here.</p>
          ) : null}
        </RequestState>
        {error ? <p role="alert">{errorMessage(error)}</p> : null}
        {relocating ? <RestoreDestination item={relocating} onClose={() => setRelocating(undefined)} onDone={resource.reload} /> : null}
        {selected ? (
          <ActionDialog
            title={`Permanently delete ${selected.title}?`}
            action="Delete permanently"
            onClose={() => setSelected(undefined)}
            onSubmit={async (data) => {
              if (data.get("confirm") !== selected.title)
                throw new Error("Type the exact page title to confirm.");
              await mutate(`/api/archive/${selected.id}/permanent-delete`, {
                operationKey: operationKey(),
                confirmedPageIds: [selected.id],
              });
              resource.reload();
            }}
          >
            <p>
              This removes the page’s content and revision content permanently.
              If it has children, Slate will require confirmation of the full
              list before any deletion. For imported content, this also removes
              the retained source archive and its import recovery history. Other
              native pages remain, but that import can no longer be retried or undone.
            </p>
            <label>
              Type the page title
              <input name="confirm" required autoComplete="off" />
            </label>
          </ActionDialog>
        ) : null}
  </>;
  if (embedded) return <section className="archive-workspace">{tabs}{body}</section>;
  return (
    <>
      <TopBar trail={[{ label: "Archive & trash" }]} />
      <section className="main archive-workspace">
        <PageTitle>Archive & trash</PageTitle>
        {tabs}
        {body}
      </section>
    </>
  );
}

/** Use the same native destination controls as page transfer; no mutation until confirmation. */
function RestoreDestination({item, onClose, onDone}: {item: Archived; onClose: () => void; onDone: () => void}) {
  const spaces = useResource<{items: {id: string; name: string; permissions: {canCreatePages: boolean}}[]}>('/api/containers');
  const pages = useResource<{items: {id: string; title: string; containerId: string; permissions: {canEdit: boolean}}[]}>('/api/pages');
  const [space, setSpace] = useState('');
  const key = useRef(operationKey());
  return <ActionDialog title="Choose restore destination" action="Restore" onClose={onClose}
    submitDisabled={!space || spaces.loading || pages.loading || !!spaces.error || !!pages.error}
    onSubmit={async data => {
      await mutate(`/api/archive/${item.id}`, {operationKey: key.current, expectedRevisionId: item.revisionId, action: 'restore', containerId: space, parentPageId: String(data.get('parent')) || null});
      onDone();
    }}>
    <p>The original location of {item.title} is unavailable. Choose where to restore it and its children.</p>
    <RequestState loading={spaces.loading || pages.loading} error={spaces.error || pages.error} retry={() => {spaces.reload(); pages.reload();}}>
      <label>Destination space<select required value={space} onChange={event => setSpace(event.target.value)}>
        <option value="" disabled>Choose a space</option>
        {spaces.data?.items.filter(item => item.permissions.canCreatePages).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Parent page<select name="parent" key={space}>
        <option value="">At the top level</option>
        {pages.data?.items.filter(page => page.containerId === space && page.permissions.canEdit).map(page => <option key={page.id} value={page.id}>{page.title}</option>)}
      </select></label>
    </RequestState>
  </ActionDialog>;
}
