import {useEffect,useState} from 'react';
import {Button} from '../../../../ui';
import {request} from '../../../../client/transport';
import type {FileCardBlockData} from '../types';
import {fileProviderLabels,type FileCardState} from '../../file-cards/reference';
import {useTaskPage} from './TaskPageContext';
/** Metadata belongs to this reader's mounted view, never to the editable block. */
export function FileCardBlock({block}:{block:FileCardBlockData}){
 const page=useTaskPage();
 const [value,setValue]=useState<FileCardState>();
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  setValue(undefined);
  if(!page||page.revisionId==='')return;
  const abort=new AbortController();
  request<FileCardState>(`/api/pages/${encodeURIComponent(page.pageId)}/file-cards/${encodeURIComponent(block.id)}`,{signal:abort.signal})
   .then(value=>{const expected={provider:block.provider,fileId:block.fileId,url:block.url};setValue(value.state==='readable'&&JSON.stringify(value.reference)!==JSON.stringify(expected)?{state:'failed'}:value);}).catch(()=>{if(!abort.signal.aborted)setValue({state:'failed'});});
  return ()=>abort.abort();
 },[page?.pageId,page?.revisionId,block.id,block.provider,block.fileId,block.url,refresh]);
 return <section aria-label={`${fileProviderLabels[block.provider]} file card`} className="my-2 min-w-0 rounded-card border border-line bg-surface p-3">
  <p className="text-tiny text-ink-muted">{fileProviderLabels[block.provider]}</p>
  {value?.state==='readable'?<>
   <a href={block.url} rel="noreferrer" target="_blank" className="block break-words text-ui font-medium text-accent underline">{value.metadata.title}</a>
   <dl className="mt-2 grid min-w-0 gap-1 text-small">
    <div><dt className="inline text-ink-muted">Owner: </dt><dd className="inline break-words">{value.metadata.owner}</dd></div>
    <div><dt className="inline text-ink-muted">Modified: </dt><dd className="inline"><time dateTime={value.metadata.modifiedAt}>{new Date(value.metadata.modifiedAt).toLocaleString()}</time></dd></div>
    <div><dt className="inline text-ink-muted">Type: </dt><dd className="inline break-all">{value.metadata.type}</dd></div>
   </dl><p className="mt-2 text-small">You can open this file.</p>
  </>:value?.state==='request-access'?<>
   <a href={block.url} rel="noreferrer" target="_blank" className="text-accent underline">Request access</a>
   {value.connect?<p className="text-small"><a href="/app/settings/portability" className="text-accent underline">Connect to view</a></p>:null}
  </>:value?.state==='unavailable'?<p>File unavailable.</p>:value?.state==='failed'?<p role="status">File access could not be checked.</p>:<p role="status">Checking file access…</p>}
  <Button variant="ghost" size="sm" onClick={()=>setRefresh(n=>n+1)}>Refresh file</Button>
 </section>;
}
