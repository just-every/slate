import { useState } from 'react';
import { useResource } from '../../../../client/useResource';
import { mutate, operationKey, errorMessage } from '../../../../client/transport';
import { RequestState } from '../../../../app/ui/RequestState';
import { SectionLabel } from '../../../../app/ui/SectionLabel';
import { displayDate } from '../../../../app/ui/displayDate';
interface Update {id:string;event:string;title:string|null;href:string;createdAt:string;readAt:string|null}
export function Following() {
 const resource=useResource<{items:Update[]}>('/api/navigation/following');
 const [error,setError]=useState<unknown>();
 return <section aria-label="Following"><SectionLabel>Following</SectionLabel>
  <RequestState loading={resource.loading} error={resource.error} retry={resource.reload}>
   <ul className="outcome-list">{resource.data?.items.map(item=><li key={item.id}><a href={item.href} onClick={event=>{event.preventDefault();void mutate('/api/notifications/actions',{operationKey:operationKey(),action:'read',id:item.id}).then(()=>window.location.assign(item.href)).catch(setError);}}>
    <span className="outcome-kind">{item.event.replaceAll('-',' ')}{item.readAt?'':' · Unread'}</span><h3>{item.title}</h3><time dateTime={item.createdAt}>{displayDate(item.createdAt,true)}</time>
   </a></li>)}</ul>
   {resource.data?.items.length===0?<p>No updates yet. Watch a page or space to follow its activity.</p>:null}
  </RequestState>{error?<p role="alert">{errorMessage(error)}</p>:null}
 </section>;
}
