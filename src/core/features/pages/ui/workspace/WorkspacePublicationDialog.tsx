import type {PublicationPreviewResponse} from '../../../lifecycle/publication-preview';
import {PublicationReviewPanel} from './PublicationReviewPanel';
import {useState} from 'react';
import {ActionDialog} from '../../../../app/ui/ActionDialog';
import {RequestState} from '../../../../app/ui/RequestState';
import {useResource} from '../../../../client/useResource';
import {mutate,operationKey} from '../../../../client/transport';
import {editorBlocks,type DocumentView} from '../../../../client/content';
import {BlockView} from '../../../editor/ui/blocks/BlockView';

type Preview = DocumentView & {parentPageId?:string|null;treePosition?:string};
export function WorkspacePublicationDialog({document,onClose,onSaved}:{document:DocumentView;revision:string;onClose:()=>void;onSaved:()=>void}){
 const preview=useResource<Preview>(`/api/pages/${document.page.id}`);
 const members=useResource<{items:{id:string;displayName:string}[]}>('/api/members');
 const spaces=useResource<{items:{id:string;name:string}[]}>('/api/containers');
 const pages=useResource<{items:{id:string;title:string;containerId:string}[]}>('/api/pages');
 const sharing=useResource<{levels:string[];restricted:boolean;items:{id:string;principalLabel?:string;principalKind:string;level:string;status:string}[];inheritedItems:{id:string;principalLabel?:string;level:string;status:string;origin?:{name:string}}[]}>(document.permissions.canShare?`/api/sharing/pages/${document.page.id}`:null);
 const [move,setMove]=useState(false),[destination,setDestination]=useState(document.page.containerId),[general,setGeneral]=useState('keep');
 const [review,setReview]=useState<{response:PublicationPreviewResponse;input:Record<string,unknown>}|null>(null);
 const current=preview.data;
 // Access arrives independently of the page. Inserting its summary after the
 // preview is usable moves Review below the phone viewport during a touch.
 const loading=preview.loading||sharing.loading;
 const generalKind=current?.policyProfile['page.access.v1']==='container-general'?'container':'workspace';
 return <ActionDialog title="Publish this revision" action={review?"Publish workspace revision":"Review publication"} submitDisabled={loading||Boolean(preview.error??sharing.error)} onClose={onClose} onSubmit={async data=>{
  if(review){await mutate(`/api/pages/${document.page.id}/publish`,{...review.input,operationKey:operationKey(),previewFingerprint:review.response.previewFingerprint});await onSaved();window.dispatchEvent(new Event("slate:navigation-changed"));return;}
  if(!current||loading||preview.error||sharing.error)throw new Error('Wait for the publication preview and current access to load.');
  const input={
   operationKey:operationKey(),expectedRevisionId:current.page.revisionId,label:String(data.get('label')??''),
   ...(data.get('publishAt')?{publishAt:new Date(String(data.get('publishAt'))).toISOString()}:{}),
   ...(data.get('attribution')?{publishAsMemberId:String(data.get('attribution'))}:{}),
   ...(move?{destination:{containerId:destination,parentPageId:String(data.get('parent'))||null,treePosition:current.treePosition??'99999999'}}:{}),
   ...(general==='keep'?{}:{generalAccess:{kind:general,...(general==='restricted'?{}:{level:String(data.get('level'))})}}),
  };const response=await mutate<PublicationPreviewResponse>(`/api/pages/${document.page.id}/publish-preview`,input);setReview({response,input});return false;
 }}><p>Review what the workspace audience will see. Web publishing is managed separately.</p>
 <div hidden={!!review}><RequestState loading={loading} error={preview.error??sharing.error} retry={()=>{void preview.reload();void sharing.reload();}}>{current?<>
 <section aria-label="Workspace publication preview"><h2>{current.page.title}</h2>{editorBlocks(current.blocks).map(block=><BlockView key={block.id} block={block} canEdit={false} onChange={()=>{}}/>)}</section>
 <p className="muted">Preview of the saved working revision. Any later change requires a new preview before publishing.</p>
 {current.policyProfile['page.version.v1']==='labelled'?<label>Version label<input name="label"/></label>:null}
 <label><input type="checkbox" disabled={!current.permissions.canShare} checked={move} onChange={event=>setMove(event.target.checked)}/>Change destination when publishing</label>
 {move?<><label>Publish in space<select value={destination} onChange={event=>setDestination(event.target.value)}>{spaces.data?.items.map(space=><option key={space.id} value={space.id}>{space.name}</option>)}</select></label><label>Publish under page<select name="parent" key={destination} defaultValue={destination===current.page.containerId?current.parentPageId??'':''}><option value="">At the top of this space</option>{pages.data?.items.filter(page=>page.containerId===destination&&page.id!==current.page.id).map(page=><option key={page.id} value={page.id}>{page.title}</option>)}</select></label></>:null}
 <label>General access when published<select disabled={!current.permissions.canShare} value={general} onChange={event=>setGeneral(event.target.value)}><option value="keep">Keep current access</option><option value="restricted">Restricted — named grants only</option><option value={generalKind}>{generalKind==='container'?'Everyone in the destination space':'Everyone in this workspace'}</option></select></label>
 {general!=='keep'&&general!=='restricted'?<label>General access level<select name="level" defaultValue={sharing.data?.levels.at(-1) ?? ""}>{sharing.data?.levels.map(level=><option key={level} value={level}>{level}</option>)}</select></label>:null}
 <p>{general==='keep'?'The current access settings will be retained.':general==='restricted'?'General and inherited access will be blocked; named grants will remain.':general==='container'?'Members of the destination space will receive the selected access level.':'Workspace members will receive the selected access level.'}</p>
 {sharing.data?<section aria-label="Current publication access"><h3>Current access</h3><p>{sharing.data.restricted?'Inherited access is restricted.':'Access inherits from the parent and space.'}</p><ul>{sharing.data.items.map(grant=><li key={grant.id}>{grant.principalLabel??grant.principalKind} · {grant.level} · {grant.status}</li>)}{sharing.data.inheritedItems.map(grant=><li key={grant.id}>{grant.principalLabel??'Inherited grant'} · {grant.level} · {grant.status} · From {grant.origin?.name}</li>)}</ul></section>:null}
 <p>The author keeps full access; existing named grants are retained. Scheduling an already-live page makes it private until publication and retains the scheduler’s full access. A scheduled publication applies the selected destination and general access only when it becomes due.</p>
 <label>Publish as<select name="attribution"><option value="">Myself</option>{members.data?.items.map(person=><option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
 <label>Schedule (optional)<input type="datetime-local" name="publishAt"/></label>
 </>:null}</RequestState></div>
 {review?<PublicationReviewPanel review={review.response} onChange={()=>{void preview.reload().then(()=>setReview(null));}}/>:null}
 </ActionDialog>;
}
