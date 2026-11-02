import {useEffect,useState} from 'react';
import {useResource} from '../../../../client/useResource';
import type {PageTrust} from '../../../search/trust-types';

function pageLink(value:string) {
  try {
    const url=new URL(value,'https://slate.invalid');
    const match=/^\/app\/pages\/([^/]+)\/?$/.exec(url.pathname);
    return match?{id:decodeURIComponent(match[1]!),revision:url.searchParams.get('revision'),origin:value.startsWith('/')&&!value.startsWith('//')?null:url.origin}:null;
  }catch{return null;}
}
/** Stored preview claims never supply an internal page's title or verification. */
export function usePageLinkCard(url:string) {
  const target=pageLink(url);
  const [checked,setChecked]=useState<{url:string;local:boolean}>();
  useEffect(()=>{setChecked({url,local:!!target&&(target.origin===null||target.origin===window.location.origin)});},[url]);
  const local=target?.origin===null?true:checked?.url===url?checked.local:undefined;
  const resource=useResource<{title:string;href:string;state:string;trust?:PageTrust}>(target&&local?`/api/pages/${encodeURIComponent(target.id)}/link-card${target.revision!==null?`?revision=${encodeURIComponent(target.revision)}`:''}`:null);
  return {internal:!!target&&local!==false,checking:!!target&&local===undefined,resource};
}
