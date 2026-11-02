import {ReadOnlyBlocks} from '../../../editor/ui/ReadOnlyBlocks';
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey } from "../../../../client/transport";
import type { DocumentView } from "../../../../client/content";
import { editorBlocks } from "../../../../client/content";
import { RequestState } from "../../../../app/ui/RequestState";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { BlockView as RenderBlock } from "../../../editor/ui/blocks/BlockView";
import type { BlockView } from "../../../../shared/api/content";
interface ComparedBlock {
  id: string;
  change: string;
  before: BlockView | null;
  after: BlockView | null;
}

function ComparisonSide({ items, side }: { items: ComparedBlock[]; side: "before" | "after" }) {
  // Each side keeps its own committed order: an insertion or move must not be
  // appended in the other revision's order.
  const blocks = items.flatMap(item => item[side] ? [item[side]!] : [])
    .sort((a, b) => a.treePosition < b.treePosition ? -1 : a.treePosition > b.treePosition ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const rendered = editorBlocks(blocks);
  const changes = new Map(items.map(item => [item.id, item.change]));
  return (
    <section aria-label={side === "before" ? "Before revision" : "After revision"}>
      <h4>{side === "before" ? "Before" : "After"}</h4>
      {blocks.map((block, index) => (
        <section key={block.id} data-comparison-block={block.id} data-tree-position={block.treePosition} data-parent-block-id={block.parentBlockId ?? ""}>
          <h5>{changes.get(block.id)}</h5>
          <div data-comparison-content style={{ marginInlineStart: `${(rendered[index].indent ?? 0) * 20}px` }}>
            <RenderBlock block={rendered[index]} canEdit={false} onChange={() => {}} />
          </div>
        </section>
      ))}
      {!blocks.length ? <p>No blocks</p> : null}
    </section>
  );
}

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
  const comparison=useResource<{blocks:ComparedBlock[];properties:{before:unknown;after:unknown}}>(selected&&compare?`/api/revisions/${document.page.id}/compare/${selected}/${compare}`:null);
  const [restoring, setRestoring] = useState(false);
  const snapshot = useResource<{
    id: string;
    blocks?: BlockView[];
    properties?: {title?:string};
    deleted?: boolean;
    newerRevisionExists?: boolean;
  }>(selected ? `/api/revisions/${document.page.id}/${selected}` : null);
  const preview=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(requestedRevision && selected===requestedRevision && snapshot.data?.id===requestedRevision)
      preview.current?.scrollIntoView({block:'start'});
  },[requestedRevision,selected,snapshot.data?.id]);
  const labelled = document.policyProfile["page.version.v1"] === "labelled";
  return (
    <section>
      <h2>Version history</h2>
      {selected ? <label>Compare with<select aria-label="Compare with" value={compare} onChange={e=>setCompare(e.target.value)}><option value="">Choose another revision</option>{history.data?.items.filter(r=>r.id!==selected&&!r.deletedAt).map(r=><option key={r.id} value={r.id}>{r.label ? `${r.label} · ` : ""}{displayRevisionTime(r.createdAt)}{r.authorDisplayName ? ` · ${r.authorDisplayName}` : ""}</option>)}</select></label>:null}
      {compare ? (
        <RequestState loading={comparison.loading} error={comparison.error} retry={comparison.reload}>
          {comparison.data ? (
            <section aria-label="Revision comparison">
              <h3>Before and after</h3>
              <div className="conflict-columns">
                <ComparisonSide items={comparison.data.blocks} side="before" />
                <ComparisonSide items={comparison.data.blocks} side="after" />
              </div>
              <details><summary>Property changes</summary><pre>{JSON.stringify(comparison.data.properties, null, 2)}</pre></details>
            </section>
          ) : null}
        </RequestState>
      ) : null}
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
          <div className="revision-preview" ref={preview}>
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
