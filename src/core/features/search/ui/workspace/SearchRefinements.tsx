import {useResource} from '../../../../client/useResource';
import {recordDate} from '../../../../client/recordDates';
import type {FilterChip} from '../../../../app/ui/FilterMenu';
export type Refinements={containerId:string;contributorId:string;status:string;label:string;sort:string;updatedFrom:string;updatedTo:string;includeTrashed:boolean};
export const emptyRefinements:Refinements={containerId:'',contributorId:'',status:'',label:'',sort:'',updatedFrom:'',updatedTo:'',includeTrashed:false};
export const lookIn:Record<string,string>={page:'Pages',record:'Records',container:'Spaces',template:'Templates','comment-thread':'Comments'};
export function useSearchOptions() {
 const spaces=useResource<{items:{id:string;name:string}[]}>('/api/containers');const members=useResource<{items:{id:string;displayName:string}[]}>('/api/members');const statuses=useResource<{items:{key:string;label:string}[]}>('/api/status');
 return {spaces,members,statuses};
}
type SearchOptions=ReturnType<typeof useSearchOptions>;
export interface SearchScope {kind:string;archived:boolean;value:Refinements}

/** Every filter in force, as removable chips beside the Filter control; sort orders results and is not a filter. */
export function searchFilterChips({kind,archived,value}:SearchScope,options:SearchOptions,change:(next:Partial<SearchScope>&{value?:Refinements})=>void):FilterChip[] {
 const refine=(patch:Partial<Refinements>)=>change({value:{...value,...patch}});
 const chips:FilterChip[]=[];
 if(kind)chips.push({key:'kind',label:lookIn[kind]??kind,remove:'Remove type filter',onRemove:()=>change({kind:''})});
 if(value.containerId)chips.push({key:'space',label:'In: '+(options.spaces.data?.items.find(item=>item.id===value.containerId)?.name??'unavailable'),remove:'Remove space filter',onRemove:()=>refine({containerId:''})});
 if(value.contributorId)chips.push({key:'contributor',label:'By: '+(options.members.data?.items.find(item=>item.id===value.contributorId)?.displayName??'unavailable'),remove:'Remove contributor filter',onRemove:()=>refine({contributorId:''})});
 if(value.status)chips.push({key:'status',label:'Status: '+(options.statuses.data?.items.find(item=>item.key===value.status)?.label??'unavailable'),remove:'Remove status filter',onRemove:()=>refine({status:''})});
 if(value.label)chips.push({key:'label',label:'Label: '+value.label,remove:'Remove label filter',onRemove:()=>refine({label:''})});
 if(value.updatedFrom)chips.push({key:'from',label:'Updated from '+recordDate(value.updatedFrom),remove:'Remove from date',onRemove:()=>refine({updatedFrom:''})});
 if(value.updatedTo)chips.push({key:'until',label:'Updated until '+recordDate(value.updatedTo),remove:'Remove until date',onRemove:()=>refine({updatedTo:''})});
 if(archived)chips.push({key:'archive',label:'Including archive',remove:'Remove archive filter',onRemove:()=>change({archived:false})});
 if(value.includeTrashed)chips.push({key:'trash',label:'Including trash',remove:'Remove trash filter',onRemove:()=>refine({includeTrashed:false})});
 return chips;
}

/** The fields inside the Filter menu: where to look, then the refinements, then what else to include. */
export function SearchFilterFields({scope:{kind,archived,value},options,disabled=false,onChange}:{scope:SearchScope;options:SearchOptions;disabled?:boolean;onChange:(next:Partial<SearchScope>&{value?:Refinements})=>void}) {
 const {spaces,members,statuses}=options;
 const refine=(patch:Partial<Refinements>)=>onChange({value:{...value,...patch}});
 return <>
  <label>Look in<select disabled={disabled} value={kind} onChange={event=>onChange({kind:event.target.value})}><option value="">Everything you can read</option>{Object.entries(lookIn).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
  <label>Space<select disabled={disabled} value={value.containerId} onChange={event=>refine({containerId:event.target.value})}><option value="">All accessible spaces</option>{spaces.data?.items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  <label>Contributor<select disabled={disabled} value={value.contributorId} onChange={event=>refine({contributorId:event.target.value})}><option value="">Anyone</option>{members.data?.items.map(item=><option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
  <label>Status<select disabled={disabled} value={value.status} onChange={event=>refine({status:event.target.value})}><option value="">Any status</option>{statuses.data?.items.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
  <label>Label<input disabled={disabled} value={value.label} onChange={event=>refine({label:event.target.value})} placeholder="Any label"/></label>
  <label>Sort<select aria-label="Sort results" disabled={disabled} value={value.sort} onChange={event=>refine({sort:event.target.value})}><option value="">Relevance</option><option value="updated">Last updated</option><option value="views">Most viewed</option></select></label>
  <label>Updated from<input disabled={disabled} type="date" value={value.updatedFrom} onChange={event=>refine({updatedFrom:event.target.value})}/></label>
  <label>Updated until<input disabled={disabled} type="date" value={value.updatedTo} onChange={event=>refine({updatedTo:event.target.value})}/></label>
  <label><input disabled={disabled} type="checkbox" checked={archived} onChange={event=>onChange({archived:event.target.checked})}/>Include archive</label>
  <label><input disabled={disabled} type="checkbox" checked={value.includeTrashed} onChange={event=>refine({includeTrashed:event.target.checked})}/>Include trash</label>
 </>;
}
