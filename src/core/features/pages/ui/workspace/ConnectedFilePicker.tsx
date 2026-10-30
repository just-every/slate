import {useEffect,useState} from 'react';
import {ActionDialog} from '../../../../app/ui/ActionDialog';
import {request,errorMessage} from '../../../../client/transport';
import {fileProviderLabels,type FileReference} from '../../../editor/file-cards/reference';
import type {PickedFile} from '../../../editor/file-cards/providers';
interface Connection {id:string;provider:FileReference['provider'];label:string;state:string}
export function ConnectedFilePicker({onPick,onClose}:{onPick:(reference:FileReference)=>void;onClose:()=>void}){
 const [connections,setConnections]=useState<Connection[]>();
 const [connection,setConnection]=useState(''),[folder,setFolder]=useState('root');
 const [items,setItems]=useState<PickedFile[]>([]),[selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false),[more,setMore]=useState(false),[error,setError]=useState<unknown>();
 useEffect(()=>{const abort=new AbortController();request<{connections:Connection[]}>('/api/imports/provider-folders',{signal:abort.signal}).then(value=>{setConnections(value.connections.filter(item=>item.state==='connected'));}).catch(cause=>{if(!abort.signal.aborted)setError(cause);});return ()=>abort.abort();},[]);
 async function browse(folderId=folder){
  setBusy(true);setError(undefined);setItems([]);setSelected('');
  try{const value=await request<{items:PickedFile[];more:boolean}>(`/api/imports/provider-folders/files?${new URLSearchParams({connectionId:connection,folderId})}`);setItems(value.items);setMore(value.more);setFolder(folderId);}
  catch(cause){setError(cause);}finally{setBusy(false);}
 }
 return <ActionDialog title="Insert connected file" action="Insert reference" onClose={onClose} onSubmit={async()=>{
  const item=items.find(item=>item.fileId===selected&&!item.folder);if(!item)throw new Error('Choose a file first.');
  onPick({provider:item.provider,fileId:item.fileId,url:item.url});
 }}>
  <p>The file stays with its provider. Each reader uses their own connected account.</p>
  {connections?.length?<>
   <label>Connected account<select aria-label="Connected account" value={connection} onChange={event=>{setConnection(event.target.value);setItems([]);setSelected('');setFolder('root');}} required><option value="">Choose an account</option>{connections.map(item=><option key={item.id} value={item.id}>{fileProviderLabels[item.provider]} · {item.label}</option>)}</select></label>
   <label>Folder ID<input value={folder} onChange={event=>setFolder(event.target.value)} required/></label>
   <button type="button" disabled={!connection||busy} onClick={()=>void browse()}>{busy?'Loading files…':'Browse files'}</button>
   <div className="verify-expiry grid max-h-64 min-w-0 gap-2 overflow-y-auto" role="group" aria-label="Provider files">
    {items.map(item=>item.folder?<button className="break-words text-left" key={item.fileId} type="button" onClick={()=>void browse(item.provider==='sharepoint'?item.fileId.split('/')[1]:item.fileId)}>Open folder: {item.title}</button>:<label key={item.fileId} className="min-w-0"><input type="radio" name="file" value={item.fileId} checked={selected===item.fileId} onChange={()=>setSelected(item.fileId)}/><span className="break-words">{item.title}</span></label>)}
   </div>
   {more?<p>More files exist. Open a folder or enter its ID to narrow the selection.</p>:null}
  </>:connections?<p>No connected file accounts. <a href="/app/settings/portability">Connect your account</a></p>:<p role="status">Loading your accounts…</p>}
  {error?<p role="alert">{errorMessage(error)}</p>:null}
 </ActionDialog>;
}
