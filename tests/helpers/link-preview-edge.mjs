import {appendFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const hostname = 'synthetic-slate-preview.test';
export async function initializeLinkPreviewEdge(directory) { await writeFile(path.join(directory,'link-preview-requests.jsonl'),''); }
export async function readLinkPreviewRequests(directory) { return (await readFile(path.join(directory,'link-preview-requests.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse); }
/** Only DNS and remote HTTP are substituted; native preview and page routes stay real. */
export async function linkPreviewEdge(request,directory,ResponseClass) {
  const url = new URL(request.url);
  const dns = url.hostname === 'cloudflare-dns.com' && url.searchParams.get('name')?.endsWith(hostname);
  if (!dns && url.hostname !== hostname) return null;
  await appendFile(path.join(directory,'link-preview-requests.jsonl'),JSON.stringify({url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body:await request.text()})+'\n');
  if (dns) return new ResponseClass(JSON.stringify({Answer:[{type:1,data:url.searchParams.get('name').startsWith('private.')?'169.254.169.254':'8.8.8.8'}]}),{headers:{'content-type':'application/json'}});
  if (url.pathname === '/refused') return new ResponseClass(null,{status:302,headers:{location:'https://private.'+hostname+'/metadata'}});
  if (url.pathname === '/failed') return new ResponseClass(null,{status:503});
  if (url.pathname === '/icon.svg') return new ResponseClass('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#3366cc" d="M0 0h16v16H0z"/></svg>',{headers:{'content-type':'image/svg+xml'}});
  return new ResponseClass('<title>Synthetic target reference</title><meta name="description" content="A target description kept with the pasted link."><link rel="icon" href="/icon.svg">',{headers:{'content-type':'text/html'}});
}
