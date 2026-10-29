import {PeopleDirectory} from '../../../settings/ui/workspace/PeopleDirectory';
import { displayDate } from "../../../../app/ui/displayDate";
import {useState} from 'react';
import type {DocumentView} from '../../../../client/content';
import {useResource} from '../../../../client/useResource';
import {mutate,operationKey} from '../../../../client/transport';
import {ActionDialog} from '../../../../app/ui/ActionDialog';
import {AnalyticsPanel} from '../../../analytics/ui/workspace/AnalyticsPanel';
import {PageStatusPanel} from '../../../page-status/ui/workspace/PageStatusPanel';
interface Details extends DocumentView {authorDisplayName:string;createdAt:string;updatedAt:string;contributors:{id:string;displayName:string}[];properties:NonNullable<DocumentView['properties']>&{ownerMemberId?:string|null;statusKey?:string|null}}
export function PageMetadata({document,revision,reload}:{document:DocumentView;revision:string;reload:()=>void}){
 const page=document as Details;
 const details=useResource<{owner:{id:string;displayName:string}|null;linkedFrom:{id:string;title:string}[];wordCount:number;characterCount:number;readingMinutes:number}>(`/api/pages/${document.page.id}/details?revision=${revision}`);
 const members=useResource<{items:{id:string;displayName:string}[]}>(document.permissions.canShare ? '/api/members' : null);
 const statuses=useResource<{items:{key:string;label:string}[]}>('/api/status');
 const [people,setPeople]=useState(false);
 const [edit,setEdit]=useState<'owner'|'labels'|null>(null);
 return <section><h2>Page details</h2><dl><dt>Owner</dt><dd>{details.data?.owner?.displayName??'Unassigned'}{document.permissions.canEdit&&document.permissions.canShare?<button onClick={()=>setEdit('owner')}>Reassign owner</button>:null}</dd><dt>Created by</dt><dd>{page.authorDisplayName}</dd><dt>Contributors</dt><dd>{page.contributors?.map(m=>m.displayName).join(', ')||'No other contributors'}</dd><dt>Created</dt><dd>{page.createdAt?displayDate(page.createdAt, true):''}</dd><dt>Updated</dt><dd>{page.updatedAt?displayDate(page.updatedAt, true):''}</dd><dt>Length</dt><dd>{details.data?`${details.data.wordCount} words · ${details.data.characterCount} characters`:'Loading…'}</dd><dt>Status</dt><dd>{page.properties?.statusKey?statuses.data?.items.find(status=>status.key===page.properties?.statusKey)?.label??'Loading…':'No status'}</dd><dt>Labels</dt><dd>{page.properties?.labels?.join(', ')||'No labels'}{document.permissions.canEdit?<button onClick={()=>setEdit('labels')}>Edit labels</button>:null}</dd></dl>
 <button type="button" onClick={()=>setPeople(!people)}>{people?"Close page people":"People on this page"}</button>{people?<PeopleDirectory pageId={document.page.id}/>:null}
 <h3>Linked from</h3><ul>{details.data?.linkedFrom.map(p=><li key={p.id}><a href={`/app/pages/${p.id}`}>{p.title}</a></li>)}</ul>
 <PageStatusPanel pageId={document.page.id} revision={revision} workingRevisionId={document.workingRevisionId} canEdit={document.permissions.canEdit} onSaved={reload}/><AnalyticsPanel pageId={document.page.id}/>
 {edit?<ActionDialog title={edit==='owner'?'Reassign owner':'Edit page labels'} action="Save details" onClose={()=>setEdit(null)} onSubmit={async data=>{await mutate(`/api/pages/${document.page.id}`,{operationKey:operationKey(),expectedRevisionId:revision,properties:edit==='owner'?{ownerMemberId:String(data.get('owner'))||null}:{labels:String(data.get('labels')).split(',').map(s=>s.trim()).filter(Boolean)}},'PATCH');await reload();}}>{edit==='owner'?<label>Owner<select name="owner" defaultValue={page.properties?.ownerMemberId??''}><option value="">Unassigned</option>{members.data?.items.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>:<label>Labels, separated by commas<input name="labels" defaultValue={page.properties?.labels?.join(', ')}/></label>}</ActionDialog>:null}
 </section>;
}
