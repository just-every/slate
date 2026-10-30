import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useResource } from '../../../client/useResource';
import { mutate, operationKey, errorMessage } from '../../../client/transport';
import { RequestState } from '../../../app/ui/RequestState';
import { SectionLabel } from '../../../app/ui/SectionLabel';
interface Reminder {id:string;pageId:string;blockId:string|null;date:string;time:string;timezone:string;offsetMinutes:number;deliveredAt:string|null;cancelledAt:string|null}
export function PersonalReminders() {
  const resource=useResource<{items:Reminder[]}>('/api/reminders');
  const [error,setError]=useState<unknown>();
  useEffect(()=>{const reload=()=>void resource.reload();window.addEventListener('slate:reminders-changed',reload);return()=>window.removeEventListener('slate:reminders-changed',reload);},[resource.reload]);
  const active=resource.data?.items.filter(item=>!item.cancelledAt&&!item.deliveredAt);
  return <section className="reminders" aria-labelledby="reminders-label"><SectionLabel id="reminders-label" count={active?.length}>Your reminders</SectionLabel><RequestState loading={resource.loading} error={resource.error} retry={resource.reload}>
    {active?.length?<ul className="reminder-list row-list">{active.map(item=><li key={item.id}><a href={`/app/pages/${item.pageId}${item.blockId?`#block-${item.blockId}`:''}`}>{new Date(`${item.date}T00:00:00`).toLocaleDateString()} · {item.time} · {item.timezone}{item.offsetMinutes?` · ${item.offsetMinutes/60} hours before`:''}</a><button type="button" className="text-button" onClick={()=>void mutate(`/api/reminders/${item.id}`,{operationKey:operationKey()},'DELETE').then(resource.reload).catch(setError)}>Cancel reminder</button></li>)}</ul>
      :active?<p className="list-hint"><Bell aria-hidden="true"/>Set a reminder from a page’s More menu or a task.</p>:null}
  </RequestState>{error?<p role="alert">{errorMessage(error)}</p>:null}</section>;
}
