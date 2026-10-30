import {useWorkspace} from '../../../../app/ui/WorkspaceContext';
import {ContainerWatch} from './ContainerWatch';
import {ContainerHome} from './ContainerHome';
import {ContainerBlog} from '../../../blog/ui/ContainerBlog';
import {ReadableExportDialog} from "../../../workspace-export/ui/ReadableExportDialog";
import { TreeCreatePage } from "../../../../app/ui/TreeCreatePage";
import {FavouriteControl} from "../../../navigation/ui/workspace/FavouriteControl";
import {ContainerBulk} from "./ContainerBulk";
import {WorkspaceArchive} from "../../../archive/ui/WorkspaceArchive";
import {TemplatesWorkspace} from "../../../templates/ui/workspace/TemplatesWorkspace";
import { useSearch } from "@tanstack/react-router";
import { useEffect,useRef, useState } from "react";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey, errorMessage } from "../../../../client/transport";
import { RequestState } from "../../../../app/ui/RequestState";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { PageTree, type TreePage } from "../../../../app/ui/PageTree";
import { AnalyticsPanel } from "../../../analytics/ui/workspace/AnalyticsPanel";
import { ContainerSettings } from "./ContainerSettings";
import { TopBar } from "../../../../app/ui/header/TopBar";
import { PageTitle } from "../../../../app/ui/header/PageTitle";
export type Container = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  key: string | null;
  visibility: string;
  revisionId: string;
  guestAccess: string;
  publicLinkAccess: string;
  anonymousAccess: string;
  archivedAt: string | null;
  memberCount: number;
  permissions: { canManage: boolean; canCreatePages: boolean };
};
function visibilityLabel(value: string) { return ({default:"Workspace access",open:"Open to the team",closed:"Members only",private:"Private",personal:"Personal"} as Record<string,string>)[value] ?? value; }
/** `embedded` shows only the spaces panel inside Settings, which supplies the top bar and title. */
export function ContainerWorkspace({containerId,embedded}:{containerId?:string;embedded?:boolean}={}) {
  const [archived, setArchived] = useState(false);
  // The router parses the query on the server and in the browser alike, so a first render never reads `window`.
  const search = useSearch({ strict: false }) as { container?: unknown; create?: unknown };
  const requestedContainer = containerId ?? (search.container == null ? null : String(search.container));
  const requestedCreate = String(search.create) === "true";
  const [selected, setSelected] = useState<string | null>(requestedContainer);
  const [create, setCreate] = useState(requestedCreate);
  const [visibility,setVisibility]=useState("");
  const [membership,setMembership]=useState(false);
  const [personal,setPersonal]=useState(false);
  const {navigation}=useWorkspace();
  useEffect(()=>{setSelected(requestedContainer);setCreate(requestedCreate);},[requestedContainer,requestedCreate]);
  const key = useRef(operationKey());
  const spaces = useResource<{ items: Container[] }>(
    containerId ? null : `/api/containers?archived=${archived}`,
  );
  const panel = (
    <section className="settings-panel spaces-workspace">
      {embedded ? <h2>Spaces</h2> : null}
      <div className="action-row page-rule">
        <button className="primary-button"
          onClick={() => {
            key.current = operationKey();
            setCreate(true);
          }}
        >
          Create space
        </button>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setSelected(null);
            }}
          />
          Show archived spaces
        </label>
      <label>Visibility<select value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="">All</option>{["default","open","closed","private","personal"].map(v=><option key={v} value={v}>{visibilityLabel(v)}</option>)}</select></label><label><input type="checkbox" checked={membership} onChange={e=>setMembership(e.target.checked)}/>My memberships</label><label><input type="checkbox" checked={personal} onChange={e=>setPersonal(e.target.checked)}/>Personal spaces</label></div>
      <RequestState
        loading={spaces.loading}
        error={spaces.error}
        retry={spaces.reload}
      >
        <ul className="settings-list row-list">
          {spaces.data?.items.filter(s=>(!visibility||s.visibility===visibility)&&(!personal||s.visibility==="personal")&&(!membership||navigation.data?.containers.some(c=>c.id===s.id))).map((space) => (
            <li key={space.id}>
              <button className="space-choice" aria-pressed={selected === space.id} onClick={() => setSelected(space.id)}>
                <strong>
                  {space.icon} {space.name}
                </strong>
                <p>
                  {visibilityLabel(space.visibility)} · {space.memberCount} {space.memberCount === 1 ? "member" : "members"}{space.description ? ` · ${space.description}` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </RequestState>
      {selected ? (
        <ContainerDetail id={selected} updated={spaces.reload} />
      ) : null}
      {create ? (
        <ActionDialog
          title="Create a space"
          action="Create space"
          onClose={() => setCreate(false)}
          onSubmit={async (data) => {
            const result = await mutate<{ value: { id: string } }>(
              "/api/containers",
              {
                operationKey: key.current,
                name: String(data.get("name")),
                description: String(data.get("description")),
                icon: String(data.get("icon")) || null,
                visibility: String(data.get("visibility")),
                key: String(data.get("key")) || null,
              },
            );
            spaces.reload();
            setSelected(result.value.id);
          }}
        >
          <label>Purpose<select onChange={e=>{const form=e.currentTarget.form;const visibility=form?.elements.namedItem("visibility") as unknown as HTMLSelectElement;if(visibility)visibility.value=e.target.value;}}><option value="private">Private project</option><option value="open">Open team knowledge</option><option value="closed">Restricted team</option></select></label>
          <label>Short key<input name="key"/></label>
          <label>
            Name
            <input name="name" required maxLength={200} />
          </label>
          <label>
            Description
            <textarea name="description" />
          </label>
          <label>
            Icon
            <input name="icon" placeholder="An emoji" />
          </label>
          <label>
            Visibility
            <select name="visibility" defaultValue="private">
              <option value="private">Private</option>
              <option value="closed">Closed</option>
              <option value="open">Open</option>
              <option value="default">Default workspace access</option>
            </select>
          </label>
        </ActionDialog>
      ) : null}
    </section>
  );
  if (containerId) return <><TopBar trail={[{label:'Spaces',href:'/app/containers'}]}/><section className="main"><ContainerDetail key={containerId} id={containerId} updated={spaces.reload}/></section></>;
  if (embedded) return panel;
  return (
    <>
      <TopBar trail={[{ label: "Spaces" }]} />
      <section className="main">
        <PageTitle>Spaces</PageTitle>
        {panel}
      </section>
    </>
  );
}
function ContainerDetail({ id, updated }: { id: string; updated: () => void }) {
  const resource = useResource<Container>(`/api/containers/${id}`);
  const pages = useResource<{ items: (TreePage&{labels?:string[]})[] }>(
    `/api/pages?containerId=${id}`,
  );
  const [query, setQuery] = useState("");
  const [label,setLabel]=useState('');
  const [exporting,setExporting]=useState(false);
  const [tab,setTab]=useState("home");
  useEffect(()=>setTab('home'),[id]);
  const available = pages.data?.items ?? [];
  const matched = new Set(
    available
      .filter((page) => page.title.toLowerCase().includes(query.toLowerCase())&&(!label||page.labels?.some(value=>value.toLocaleLowerCase()===label.toLocaleLowerCase())))
      .map((page) => page.id),
  );
  for (const page of available) {
    if (!matched.has(page.id)) continue;
    let parent = page.parentPageId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      matched.add(parent);
      parent = available.find((item) => item.id === parent)?.parentPageId;
    }
  }
  return (
    <RequestState
      loading={resource.loading}
      error={resource.error}
      retry={resource.reload}
    >
      {resource.data ? (
        <section className="space-detail">
          <h3>{resource.data.name}</h3><div className="space-actions"><FavouriteControl kind="container" id={id}/><ContainerWatch id={id}/><button className="secondary-button" onClick={()=>setExporting(true)}>Export space</button></div>{exporting?<ReadableExportDialog id={id} container onClose={()=>setExporting(false)}/>:null}
          <nav className="tabs" aria-label="Space navigation">{['home','content','blog','settings','templates','trash','bulk'].map(value=><button aria-pressed={tab===value} key={value} onClick={()=>setTab(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</nav>
          <a href={`/app/search?containerId=${id}`}>Search this space</a>
          {tab==='home'?<ContainerHome key={id} containerId={id} name={resource.data.name} onSaved={()=>{void resource.reload();void pages.reload();updated();}}/>:null}
          {tab==='blog'?<ContainerBlog containerId={id}/>:null}
          {tab==='templates'?<TemplatesWorkspace defaultContainerId={id} embedded/>:tab==='trash'?<WorkspaceArchive containerId={id} embedded/>:tab==='bulk'?<ContainerBulk pages={available} onSaved={pages.reload}/>:null}
          {tab==='content'?<>
          <p>{resource.data.description}</p>
          <label>
            Filter page titles
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>Filter labels<input type="search" value={label} list={`space-labels-${id}`} onChange={event=>setLabel(event.target.value)}/></label>
          <datalist id={`space-labels-${id}`}>{[...new Set(available.flatMap(page=>page.labels??[]))].sort().map(value=><option key={value} value={value}/>)}</datalist>
          {query||label?<button className="secondary-button" onClick={()=>{setQuery("");setLabel('');}}>Clear page filter</button>:null}<PageTree pages={available.filter((page) => matched.has(page.id))} />
          {resource.data.permissions.canCreatePages ? <TreeCreatePage containerId={id} name={resource.data.name} /> : null}
          </>:null}
          {tab==='settings'?<ContainerSettings
            container={resource.data}
            onSaved={async () => {
              await resource.reload();
              updated();
            }}
          />:null}
          <details>
            <summary>Readership</summary>
            <AnalyticsPanel containerId={id} />
          </details>
        </section>
      ) : null}
    </RequestState>
  );
}
