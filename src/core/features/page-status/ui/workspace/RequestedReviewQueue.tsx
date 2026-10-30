import { useState } from 'react';
import { useResource } from '../../../../client/useResource';
import { RequestState } from '../../../../app/ui/RequestState';
import type { ReviewRequestQueue } from '../../request-types';
import { ReviewRequestList } from './ReviewRequestList';
import { reviewChanged } from './ReviewQueue';
import { SectionLabel } from '../../../../app/ui/SectionLabel';

export function RequestedReviewQueue() {
 const [view, setView] = useState<'assigned' | 'requested'>('assigned');
 const [state, setState] = useState('pending');
 const [cursors, setCursors] = useState<string[]>([]), cursor = cursors.at(-1);
 const resource = useResource<ReviewRequestQueue>(`/api/status/requests/queue?view=${view}&state=${state}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
 return <section aria-label="Review requests">
  <SectionLabel>Review requests</SectionLabel>
  <div className="control-row"><div className="tabs" role="group" aria-label="Review request queues">
   <button type="button" aria-pressed={view === 'assigned'} onClick={() => {setView('assigned'); setCursors([]);}}>Assigned to me{resource.data ? ` (${resource.data.counts.assigned})` : ''}</button>
   <button type="button" aria-pressed={view === 'requested'} onClick={() => {setView('requested'); setCursors([]);}}>Requested by me{resource.data ? ` (${resource.data.counts.requested})` : ''}</button>
  </div>
  <label className="inline-field">Request state<select value={state} onChange={e => {setState(e.target.value); setCursors([]);}}><option value="pending">Pending</option><option value="all">All states</option><option value="verified">Verified</option><option value="changes_requested">Changes requested</option><option value="cancelled">Cancelled</option></select></label></div>
  <RequestState loading={resource.loading} error={resource.error} retry={resource.reload}>
   {resource.data?.items.length ? <ReviewRequestList items={resource.data.items} onSaved={async () => {await resource.reload(); reviewChanged();}}/> : <p>{view === 'assigned' ? 'No review requests assigned to you.' : 'No matching reviews requested by you.'}</p>}
   {cursors.length || resource.data?.nextCursor ? <div className="list-paging">
    {cursors.length ? <button type="button" className="text-button" onClick={() => setCursors([])}>First page of requests</button> : null}
    {resource.data?.nextCursor ? <button type="button" className="text-button" onClick={() => setCursors([...cursors, resource.data!.nextCursor!])}>Next page of requests</button> : null}
   </div> : null}
  </RequestState>
 </section>;
}
