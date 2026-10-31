import {compareTreePages} from './treePosition';
import type {TreeDestination} from './TreeMoveDialog';
const TreeMoveDialog=lazy(()=>import('./TreeMoveDialog').then(module=>({default:module.TreeMoveDialog})));
import {ScheduledPublication} from './ScheduledPublication';
import {StoredIcon, StoredCover, type PageAppearanceView} from "../../features/pages/ui/workspace/PageAppearance";
import {useResource} from "../../client/useResource";
import {mutate, operationKey, errorMessage} from "../../client/transport";
import {useCreatePage} from "./useCreatePage";
import {DEFAULT_PAGE_TITLE} from "./pageDestination";
import { lazy, Suspense, useState } from "react";
import { ArrowUpDown, ChevronRight, Database, FileText, Plus } from "lucide-react";
import type { PageRef } from "../../shared/api/content";
export type TreePage = PageRef & PageAppearanceView & {
  databaseId?: string;
  parentPageId?: string | null;
  treePosition?: string|null;
  icon?: string | null;
  containerLabel?: string;
  sharedWithMe?: boolean;
  permissions?: { level: string; canEdit: boolean };
};
export function PageTree({
  pages,
  parentId = null,
  ancestors = [],
  activePath,
  visibleIds,
}: {
  pages: TreePage[];
  parentId?: string | null;
  ancestors?: string[];
  /** The path being viewed, so the row for the open page is marked as current. */
  activePath?: string;
  /** A temporary title filter never changes persisted expansion. */
  visibleIds?: Set<string>;
}) {
  const ids = new Set(pages.map((page) => page.id));
  const children = pages
    .filter((page) =>
      parentId
        ? page.parentPageId === parentId
        : !page.parentPageId || !ids.has(page.parentPageId),
    )
    .sort(compareTreePages);
  return (
    <ul className="page-tree">
      {children
        .filter((page) => !ancestors.includes(page.id) && (!visibleIds || visibleIds.has(page.id)))
        .map((page) => (
          <TreeItem
            key={page.id}
            page={page}
            pages={pages}
            ancestors={ancestors}
            activePath={activePath}
            visibleIds={visibleIds}
          />
        ))}
    </ul>
  );
}
function TreeItem({
  page,
  pages,
  ancestors,
  activePath,
  visibleIds,
}: {
  page: TreePage;
  pages: TreePage[];
  ancestors: string[];
  activePath?: string;
  /** A temporary title filter never changes persisted expansion. */
  visibleIds?: Set<string>;
}) {
  const hasChildren = pages.some((item) => item.parentPageId === page.id && (!visibleIds || visibleIds.has(item.id)));
  const expansion = useResource<{expanded:boolean}>(hasChildren ? `/api/pages/${page.id}/expansion` : null);
  const open = visibleIds !== undefined || (expansion.data?.expanded ?? false);
  const [move,setMove]=useState<{page:TreePage;destination?:TreeDestination}|null>(null);
  const creation = useCreatePage();
  const [error,setError] = useState<unknown>();
  const canMove = page.permissions?.canEdit === true;
  return (
    <li>
      <div className="tree-row" draggable={canMove} onDragStart={event=>{if(!canMove){event.preventDefault();return;}event.dataTransfer.setData("application/x-slate-page",page.id);event.dataTransfer.effectAllowed="move";}} onDragOver={event=>{if(event.dataTransfer.types.includes("application/x-slate-page")){event.preventDefault();event.dataTransfer.dropEffect="move";}}} onDrop={event=>{event.preventDefault();const source=pages.find(item=>item.id===event.dataTransfer.getData("application/x-slate-page"));if(!source||!source.permissions?.canEdit||source.id===page.id)return;const box=event.currentTarget.getBoundingClientRect();const before=event.clientY<box.top+box.height/3,after=event.clientY>box.bottom-box.height/3;setMove({page:source,destination:{containerId:page.containerId,parentPageId:before||after?page.parentPageId??null:page.id,...(before?{beforeId:page.id}:after?{afterId:page.id}:{})}});}}>
        {hasChildren ? (
          <button
            className="iconbutton"
            aria-label={`${open ? "Collapse" : "Expand"} ${page.title}`}
            data-tooltip={open ? "Collapse page" : "Expand page"} data-tooltip-align="right"
            aria-expanded={open}
            disabled={visibleIds !== undefined || expansion.loading || expansion.error !== undefined}
            onClick={(event) => {
              event.stopPropagation();
              void mutate(`/api/pages/${page.id}/expansion`, {operationKey:operationKey(),expanded:!open}).then(expansion.reload).catch(setError);
            }}
          >
            <ChevronRight aria-hidden="true"
              style={{ transform: open ? "rotate(90deg)" : undefined }}
            />
          </button>
        ) : (
          <span className="tree-spacer" />
        )}
        <a className="navlink" href={page.databaseId ? `/app/databases/${page.databaseId}` : `/app/pages/${page.id}`} aria-current={activePath === (page.databaseId ? `/app/databases/${page.databaseId}` : `/app/pages/${page.id}`) ? "page" : undefined}>
          {page.icon ? <StoredIcon icon={page.icon}/> : page.databaseId ? <Database aria-hidden="true" /> : <FileText aria-hidden="true" />}
          <span>{page.title || "Untitled"}<ScheduledPublication page={page}/></span>
        </a>
        {page.cover || page.coverFileId ? <span className="tree-cover"><StoredCover key={JSON.stringify([page.cover, page.coverFileId])} cover={page.cover} coverFileId={page.coverFileId} compact /></span> : null}
        <button className="iconbutton tree-action" aria-label={`Move ${page.title} in tree`} data-tooltip="Move page" data-tooltip-align="end" disabled={!canMove} onClick={()=>setMove({page})}><ArrowUpDown aria-hidden="true"/></button>
        <button className="iconbutton tree-action" aria-label={`Create child of ${page.title}`} data-tooltip="Add child" data-tooltip-align="end" disabled={!canMove} aria-busy={creation.pending||undefined} onClick={event=>{event.stopPropagation();void creation.create(async()=>({containerId:page.containerId,parentPageId:page.id,title:DEFAULT_PAGE_TITLE}));}}><Plus aria-hidden="true"/></button>
      </div>
      {move?<Suspense fallback={null}><TreeMoveDialog page={move.page} pages={pages} initial={move.destination} onClose={()=>setMove(null)}/></Suspense>:null}
      {creation.error ? <p role="alert">{errorMessage(creation.error)}</p> : null}
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
      {expansion.error ? <p role="alert">{errorMessage(expansion.error)} <button onClick={() => void expansion.reload()}>Retry tree expansion</button></p> : null}
      {open ? (
        <PageTree
          pages={pages}
          parentId={page.id}
          ancestors={[...ancestors, page.id]}
          activePath={activePath}
          visibleIds={visibleIds}
        />
      ) : null}
    </li>
  );
}
