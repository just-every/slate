import {TemplateSnapshotPreview,type TemplatePreviewSnapshot} from './TemplateSnapshotPreview';
import {DeletedTemplateActions} from './DeletedTemplateActions';
import { TemplateActions } from "./TemplateActions";
import { useEffect, useState } from "react";
import { useResource } from "../../../../client/useResource";
import { mutate, operationKey } from "../../../../client/transport";
import { RequestState } from "../../../../app/ui/RequestState";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { TopBar } from "../../../../app/ui/header/TopBar";
import { PageTitle } from "../../../../app/ui/header/PageTitle";
interface Template {
  id: string;
  title: string;
  description: string;
  category: string;
  revisionId: string;
  deletedAt?:string|null;
  erasurePending?:boolean|number;
  permissions: {canManage:boolean;canApply:boolean;canDuplicate:boolean;canErase?:boolean};
  applyDestinations?: {containerId:string;parentPageId:string|null;label:string}[];
  snapshot?:TemplatePreviewSnapshot;
}
/** `embedded` puts only the templates inside another screen (a space's Templates tab), which already has a top bar and a title. */
export function TemplatesWorkspace({ templateId,defaultContainerId,embedded,creationDestination }: { templateId?: string;defaultContainerId?:string;embedded?:boolean;creationDestination?:{containerId:string;parentPageId:string|null} }) {
  const [state, setState] = useState("active");
  const [query, setQuery] = useState("");
  const [category,setCategory]=useState("");
  const [settledFilters,setSettledFilters]=useState({query:"",category:""});
  useEffect(()=>{
    const timer=setTimeout(()=>setSettledFilters({query,category}),200);
    return ()=>clearTimeout(timer);
  },[query,category]);
  const [container, setContainer] = useState(defaultContainerId??"");
  const containers = useResource<{ items: { id: string; name: string }[] }>(
    "/api/containers",
  );
  const items = useResource<{ items: Template[] }>(
    `/api/templates?state=${state}&query=${encodeURIComponent(settledFilters.query)}&category=${encodeURIComponent(settledFilters.category)}&containerId=${encodeURIComponent(container)}`,
  );
  const [selected, setSelected] = useState<string | undefined>(templateId);
  const preview = useResource<Template>(
    selected&&state!=="deleted" ? `/api/templates/${selected}` : null,
  );
  const [apply, setApply] = useState(false);
  const initialDestination = creationDestination ? preview.data?.applyDestinations?.findIndex(item =>
    item.containerId === creationDestination.containerId && item.parentPageId === creationDestination.parentPageId) : -1;
  const body = <>
        <div className="action-row template-filters">
          <label>
            Show
            <select
              value={state}
              onChange={(event) => {
                setState(event.target.value);
                setSelected(undefined);
              }}
            >
              <option value="active">Active templates</option>
              <option value="archived">Archived templates</option>
              <option value="deleted">Deleted templates</option>
            </select>
          </label>
          <label>
            Find a template
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
            />
          </label>
          <label>Category<input value={category} onChange={event=>setCategory(event.target.value)}/></label>
          <label>
            Collection
            <select
              value={container}
              onChange={(e) => setContainer(e.target.value)}
            >
              <option value="">Workspace templates</option>
              {containers.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <RequestState
          loading={items.loading}
          error={items.error}
          retry={items.reload}
        >
          <ul className="outcome-list">
            {items.data?.items.map((item) => (
              <li key={item.id}>
                <button className="template-choice" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
                  <span className="eyebrow">{item.category}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </button>
              </li>
            ))}
          </ul>
          {items.data?.items.length === 0 ? (
            <p className="muted">
              No templates match this search.
            </p>
          ) : null}
        </RequestState>
        {selected&&state==='deleted'&&items.data?.items.find(item=>item.id===selected)?<DeletedTemplateActions template={items.data.items.find(item=>item.id===selected)!} onChanged={async()=>{setSelected(undefined);await items.reload();}}/>:null}
        {selected&&state!=='deleted' ? (
          <section className="template-preview">
            <RequestState
              loading={preview.loading}
              error={preview.error}
              retry={preview.reload}
            >
              {preview.data ? (
                <>
                  <h2>{preview.data.title}</h2>
                  <TemplateActions
                    template={preview.data}
                    archived={state === "archived"}
                    onChanged={async () => {
                      await preview.reload();
                      await items.reload();
                    }}
                  />
                  <p>{preview.data.description}</p>
                  {preview.data.snapshot?<TemplateSnapshotPreview snapshot={preview.data.snapshot} templateId={preview.data.id} revisionId={preview.data.revisionId}/>:null}
                  <button
                    disabled={!preview.data.permissions?.canApply}
                    className="primary-button"
                    onClick={() => setApply(true)}
                  >
                    Use this template
                  </button>
                </>
              ) : null}
            </RequestState>
          </section>
        ) : null}
        {apply && preview.data ? (
          <ActionDialog
            title="Use this template"
            action="Create page"
            onClose={() => setApply(false)}
            onSubmit={async (form) => {
              const result = await mutate<{ value: { pageId: string } }>(
                `/api/templates/${preview.data!.id}/apply`,
                {
                  operationKey: operationKey(),
                  expectedRevisionId: preview.data!.revisionId,
                  containerId: preview.data!.applyDestinations![Number(form.get("destination"))].containerId,
                  parentPageId: preview.data!.applyDestinations![Number(form.get("destination"))].parentPageId ?? undefined,
                },
              );
              window.location.assign(`/app/pages/${result.value.pageId}`);
            }}
          >
            <label>
              Create in
              <select name="destination" required defaultValue={initialDestination !== undefined && initialDestination >= 0 ? String(initialDestination) : ""}>
                <option value="" disabled>
                  Choose a space
                </option>
                {preview.data.applyDestinations?.map((item,index)=><option key={`${item.containerId}:${item.parentPageId}`} value={index}>{item.label}</option>)}
              </select>
            </label>
            <p>
              This creates an editable copy. The original template stays
              unchanged.
            </p>
          </ActionDialog>
        ) : null}
  </>;
  if (embedded) return <section className="templates-workspace">{body}</section>;
  return (
    <>
      <TopBar trail={[{ label: "Templates" }]} />
      <section className="main templates-workspace">
        <PageTitle>Templates</PageTitle>
        <p className="page-lede">Reusable pages, with their structure intact. Create templates from a page’s More menu.</p>
        {body}
      </section>
    </>
  );
}
