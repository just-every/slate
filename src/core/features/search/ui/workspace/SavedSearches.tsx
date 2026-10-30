import {useState} from 'react';
import {useResource} from '../../../../client/useResource';
import {mutate,operationKey,errorMessage} from '../../../../client/transport';
import type {Refinements} from './SearchRefinements';
export type SearchQuery=Partial<Refinements>&{query?:string;kind?:string;includeArchived?:boolean};
/** The member's saved searches, in the Filter menu's foot: run one, or remove it. */
export function SavedSearches({onChoose,version}:{onChoose:(query:SearchQuery)=>void;version:number}) {
 const resource=useResource<{items:{id:string;name:string;query:SearchQuery;revisionId:string}[]}>(`/api/search/saved?updated=${version}`);const [error,setError]=useState<unknown>();
 return <section className="saved-searches" aria-labelledby="saved-searches-label"><h3 id="saved-searches-label">Saved searches</h3>
  {resource.data?.items.length?<ul>{resource.data.items.map(item=><li key={item.id}><button type="button" className="text-button" onClick={()=>onChoose(item.query)}>{item.name}</button><button type="button" className="text-button" aria-label={`Remove saved search ${item.name}`} onClick={async()=>{try{await mutate(`/api/search/saved/${item.id}`,{operationKey:operationKey(),expectedRevisionId:item.revisionId},'DELETE');resource.reload();}catch(cause){setError(cause);}}}>Remove</button></li>)}</ul>:null}
  {resource.data?.items.length===0?<p className="meta">No saved searches.</p>:null}{error||resource.error?<p role="alert">{errorMessage(error||resource.error)}</p>:null}</section>;
}
