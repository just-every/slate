import {ReadOnlyBlocks} from '../../../editor/ui/ReadOnlyBlocks';
import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey } from "../../../../client/transport";
import type { DocumentView } from "../../../../client/content";
import { editorBlocks } from "../../../../client/content";
import { RequestState } from "../../../../app/ui/RequestState";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { BlockView as RenderBlock } from "../../../editor/ui/blocks/BlockView";
import type { BlockView } from "../../../../shared/api/content";
interface Revision {
  id: string;
  origin: string;
  authorDisplayName?: string;
  createdAt: string;
  ordinal: number | null;
  label: string | null;
  deletedAt: string | null;
}
const revisionTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function displayRevisionTime(value: string) {
  return revisionTime.format(new Date(value));
}
export function PageHistory({
  document,
  revision,
  reload,
}: {
  document: DocumentView;
  revision: string;
  reload: () => void;
}) {
  const history = useResource<{ items: Revision[] }>(
    `/api/revisions/${document.page.id}`,
  );
  const search=useLocation({select:location=>location.searchStr});
  const params=new URLSearchParams(search),requestedRevision=params.get('revision'),requestedCompare=params.get('compare')??'';
  const [selected, setSelected] = useState<string | null>(requestedRevision);
  const [compare,setCompare]=useState<string>(requestedCompare);
  useEffect(()=>{setSelected(requestedRevision);setCompare(requestedCompare);},[requestedRevision,requestedCompare]);
  const [deleting,setDeleting]=useState(false);
  const comparison=useResource<{blocks:{id:string;change:string;before:BlockView|null;after:BlockView|null}[];properties:{before:unknown;after:unknown}}>(selected&&compare?`/api/revisions/${document.page.id}/compare/${selected}/${compare}`:null);
  const [restoring, setRestoring] = useState(false);
  const snapshot = useResource<{
    id: string;
    blocks?: BlockView[];
    properties?: {title?:string};
    deleted?: boolean;
    newerRevisionExists?: boolean;
  }>(selected ? `/api/revisions/${document.page.id}/${selected}` : null);
  const labelled = document.policyProfile["page.version.v1"] === "labelled";
  return (
    <section>
      <h2>Version history</h2>
      {selected ? <label>Compare with<select aria-label="Compare with" value={compare} onChange={e=>setCompare(e.target.value)}><option value="">Choose another revision</option>{history.data?.items.filter(r=>r.id!==selected&&!r.deletedAt).map(r=><option key={r.id} value={r.id}>{r.label ? `${r.label} · ` : ""}{displayRevisionTime(r.createdAt)}{r.authorDisplayName ? ` · ${r.authorDisplayName}` : ""}</option>)}</select></label>:null}
      {compare ? <RequestState loading={comparison.loading} error={comparison.error} retry={comparison.reload}><section aria-label="Revision comparison"><h3>Before and after</h3>{comparison.data?.blocks.map(item=><section key={item.id}><h4>{item.change}</h4><div className="conflict-columns">{[item.before,item.after].map((block,index)=><div key={index}><strong>{index===0?'Before':'After'}</strong>{block ? <RenderBlock block={editorBlocks([block])[0]} canEdit={false} onChange={()=>{}}/>:<p>No block</p>}</div>)}</div></section>)}<details><summary>Property changes</summary><pre>{JSON.stringify(comparison.data?.properties,null,2)}</pre></details></section></RequestState>:null}
      <RequestState
        loading={history.loading}
        error={history.error}
        retry={history.reload}
      >
        <ol className="history-list">
          {history.data?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selected === item.id}
                onClick={() => setSelected(item.id)}
              >
                <time dateTime={item.createdAt}>
                  {displayRevisionTime(item.createdAt)}
                </time>
                <span>{item.authorDisplayName ?? item.origin}</span>
                {labelled ? (
                  <span>
                    {item.ordinal ? `Version ${item.ordinal}` : ""} {item.label}
                  </span>
                ) : null}
                {item.deletedAt ? <span>Deleted revision</span> : null}
              </button>
            </li>
          ))}
        </ol>
      </RequestState>
      <RequestState
        loading={snapshot.loading}
        error={snapshot.error}
        retry={snapshot.reload}
      >
        {snapshot.data?.deleted ? (
          <p>
            This exact revision has been deleted. Its content is unavailable.
          </p>
        ) : snapshot.data?.blocks ? (
          <div className="revision-preview">
            {snapshot.data.properties?.title ? <h3>{snapshot.data.properties.title}</h3> : null}
            {snapshot.data.newerRevisionExists ? (
              <p className="muted">
                A newer revision exists. This is the exact selected version.
              </p>
            ) : null}
            <ReadOnlyBlocks blocks={editorBlocks(snapshot.data.blocks)}/>
            {labelled && document.permissions.canEdit && document.permissions.canShare && selected !== document.workingRevisionId && selected !== document.publishedRevisionId ? <button onClick={()=>setDeleting(true)}>Delete this intermediate revision</button>:null}
            {document.permissions.canEdit ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => setRestoring(true)}
              >
                Restore this revision
              </button>
            ) : null}
          </div>
        ) : null}
      </RequestState>
      {deleting && selected ? <ActionDialog title="Delete this intermediate revision?" action="Delete revision" onClose={()=>setDeleting(false)} onSubmit={async()=>{await mutate(`/api/revisions/${document.page.id}/${selected}`,{operationKey:operationKey()},"DELETE");await history.reload();await snapshot.reload();setCompare("");}}><p>This destroys the selected revision's body. Its numbered tombstone remains, and exact links will say it was deleted. Current and published content stay intact.</p></ActionDialog>:null}
      {restoring && selected ? (
        <ActionDialog
          title="Restore this revision?"
          action="Restore revision"
          onClose={() => setRestoring(false)}
          onSubmit={async () => {
            await mutate(
              `/api/revisions/${document.page.id}/${selected}/restore`,
              { operationKey: operationKey(), expectedRevisionId: revision },
            );
            await reload();await history.reload();await snapshot.reload();
          }}
        >
          <p>
            This creates a new revision with the selected content. Existing
            history remains available.
          </p>
        </ActionDialog>
      ) : null}
    </section>
  );
}
