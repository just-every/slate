import {appendFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function initializeSearchAiEdge(directory){await writeFile(path.join(directory,'search-ai-requests.jsonl'),'');}
export async function readSearchAiRequests(directory){return (await readFile(path.join(directory,'search-ai-requests.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);}
/** Only the provider network edge is substituted; search always reaches native D1. */
export async function searchAiEdge(request,directory,ResponseClass){
 const url=new URL(request.url);if(url.hostname!=='api.openai.com')return null;
 await appendFile(path.join(directory,'search-ai-requests.jsonl'),JSON.stringify({method:request.method,path:url.pathname})+'\n');
 return new ResponseClass('Synthetic provider unavailable',{status:503});
}
