import { useState } from 'react';
import { useResource } from '../../../../client/useResource';
import { mutate, operationKey } from '../../../../client/transport';
import { RequestState } from '../../../../app/ui/RequestState';
import { ActionDialog } from '../../../../app/ui/ActionDialog';
import type { GuestView } from '../../../workspace/guests';
import type { GuestPolicy } from '../../../workspace/guest-policy';
const date=(value:string|null)=>value?new Date(value).toLocaleString():'Not recorded';
const localDate=(value:string|null)=>value?new Date(Date.parse(value)-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
export function GuestsPanel({onInvited}:{onInvited:()=>Promise<boolean>}) {
  const guests=useResource<{items:GuestView[]}>('/api/guests');
  const policy=useResource<GuestPolicy>('/api/guests/policy');
  const pages=useResource<{items:{id:string;title:string}[]}>('/api/pages');
  const [selected,setSelected]=useState<string[]>([]),[dialog,setDialog]=useState<'policy'|'revoke'|'invite'>();
  const [notice,setNotice]=useState('');
  const [expiryGuest,setExpiryGuest]=useState<GuestView>();
  return <section aria-label="Guest management">
    <h3>Guests</h3>
    <p>See each guest’s current pages, inviter, last activity and access expiry.</p>
    <button onClick={()=>setDialog('invite')}>Invite a guest</button>{' '}
    <button disabled={!policy.data} onClick={()=>setDialog('policy')}>Guest settings</button>{' '}
    <button disabled={!selected.length} onClick={()=>setDialog('revoke')}>Revoke selected guests</button>
    {notice?<p role="status">{notice}</p>:null}
    <RequestState loading={guests.loading} error={guests.error} retry={guests.reload}>
      {!guests.data?.items.length?<p>No guests yet.</p>:<ul className="settings-list">
        {guests.data?.items.map(guest=><li key={guest.id}>
          <div><label><input type="checkbox" checked={selected.includes(guest.id)} onChange={event=>setSelected(event.target.checked?[...selected,guest.id]:selected.filter(id=>id!==guest.id))}/>{guest.displayName}</label>
            <p>{guest.email}</p><p>Invited by: {guest.invitedBy??'Not recorded'} · Last active: {date(guest.lastActiveAt)}</p>
            <p>Guest expiry: {guest.expiresAt?date(guest.expiresAt):'No expiry'}</p>
            <button onClick={()=>setExpiryGuest(guest)}>Set expiry for {guest.displayName}</button>
            {guest.access.length?<ul>{guest.access.map(access=><li key={access.id}><a href={`/app/pages/${access.id}`}>{access.title}</a> · {access.expiresAt?`Expires ${date(access.expiresAt)}`:'No expiry'}</li>)}</ul>:<p>No current page access.</p>}
          </div>
        </li>)}
      </ul>}
    </RequestState>
    {expiryGuest?<ActionDialog title={`Guest expiry for ${expiryGuest.displayName}`} action="Save guest expiry" onClose={()=>setExpiryGuest(undefined)} onSubmit={async form=>{
      const value=String(form.get('expiry'));
      await mutate(`/api/guests/${expiryGuest.id}/expiry`,{operationKey:operationKey(),expiresAt:value?new Date(value).toISOString():null},'PUT');guests.reload();setNotice('Guest expiry saved.');
    }}>
      <label>Expiry (your local time)<input type="datetime-local" name="expiry" defaultValue={localDate(expiryGuest.expiresAt)}/></label>
      <p>This deadline ends all of this guest’s access, including authored pages. Leave blank for no guest-wide expiry; individual page and space grants still expire as set.</p>
    </ActionDialog>:null}
    {dialog==='policy'&&policy.data?<ActionDialog title="Guest settings" action="Save guest settings" onClose={()=>setDialog(undefined)} onSubmit={async form=>{
      const domains=(name:string)=>String(form.get(name)).split(/[\s,]+/).filter(Boolean);
      await mutate('/api/guests/policy',{operationKey:operationKey(),defaultExpiryDays:form.get('days')?Number(form.get('days')):null,allowedDomains:domains('allowed'),deniedDomains:domains('denied')},'PUT');policy.reload();setNotice('Guest settings saved.');
    }}>
      <label>Default guest expiry (days)<input name="days" type="number" min="1" max="3650" defaultValue={policy.data.defaultExpiryDays??''}/></label>
      <p>Applies to new invitations without an explicit expiry. Leave blank for no default expiry.</p>
      <label>Allowed email domains<textarea name="allowed" defaultValue={policy.data.allowedDomains.join('\n')}/></label>
      <label>Denied email domains<textarea name="denied" defaultValue={policy.data.deniedDomains.join('\n')}/></label>
      <p>Separate exact domains with commas or new lines. A denied domain always wins. An empty allow list permits other domains. Settings apply when inviting and accepting; existing guests keep their access.</p>
    </ActionDialog>:null}
    {dialog==='revoke'?<ActionDialog title="Revoke selected guests?" action="Revoke guests" onClose={()=>setDialog(undefined)} onSubmit={async()=>{
      await mutate('/api/guests/revoke',{operationKey:operationKey(),memberIds:selected});setSelected([]);guests.reload();setNotice('Selected guests revoked. Their sessions have ended.');
    }}><p>Remove {selected.length} guests and end their open sessions. Their authored content and history remain.</p></ActionDialog>:null}
    {dialog==='invite'?<ActionDialog title="Invite a guest" action="Send invitation" onClose={()=>setDialog(undefined)} onSubmit={async form=>{
      await mutate('/api/invitations',{operationKey:operationKey(),kind:'guest',email:String(form.get('email')),pageId:String(form.get('pageId'))});setNotice(`Invitation requested for ${String(form.get('email'))}. Check delivery below.`);await onInvited();
    }}>

      <label>Guest email<input type="email" name="email" required/></label>
      <label>Page to share<select name="pageId" required defaultValue=""><option value="" disabled>Choose a page</option>{pages.data?.items.map(page=><option key={page.id} value={page.id}>{page.title}</option>)}</select></label>
      <p>Guests receive view access to this page. The workspace’s default expiry applies.</p>
    </ActionDialog>:null}
  </section>;
}
