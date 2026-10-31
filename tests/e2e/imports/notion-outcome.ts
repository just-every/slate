import {expect} from 'vitest';
import {env} from 'cloudflare:test';
import {parseImport} from '../../../src/core/features/imports';
import {readZipArchive} from '../../../src/core/features/imports/archive';
import type {ImportedBlock,ImportReportEntry} from '../../../src/core/features/imports/types';

type Read = (path:string)=>Promise<any>;
type Request = (path:string,authenticated?:boolean)=>Promise<Response>;
const flatten=(blocks:ImportedBlock[]):ImportedBlock[]=>blocks.flatMap(block=>[block,...flatten(block.children)]);
const sorted=(items:unknown[])=>items.map(item=>JSON.stringify(item)).sort();
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');

/** Reconcile source semantics with persisted public reads. The independently
 * asserted incumbent parser corpus in real-exports.test.ts guards the source
 * oracle; this helper deliberately never calls the native block or SQL planners. */
export async function notionOutcome(bytes:ArrayBuffer,job:any,read:Read,request:Request){
 const source=parseImport('notion-workspace',{name:'notion-workspace-export.zip',bytes:new Uint8Array(bytes)});
 const archive=readZipArchive(new Uint8Array(bytes));
 expect(archive.size).toBe(57);
 expect([source.pages.length,source.databases.length,source.records.length,source.media.length]).toEqual([35,7,22,15]);
 // Titles are checked against the actual Markdown heading as well as the
 // retained parser regression's emoji and duplicate-title assertions.
 expect(sorted(source.pages.map(page=>page.title))).toEqual(sorted([...archive].filter(([path])=>path.endsWith('.md')).map(([,content])=>new TextDecoder().decode(content).split(/\r?\n/)[0]!.slice(2))));
 const section=async(kind:string)=>{
  const entries:ImportReportEntry[]=[];
  for(let page=0;page<job.report.sections[kind].pages;page++){
   const response=await read(`/imports/${job.id}/report/${kind}?page=${page}`);
   expect(response).toMatchObject({page,pages:job.report.sections[kind].pages,total:job.report.sections[kind].count});
   entries.push(...response.items);
  }
  expect(entries).toHaveLength(job.report.sections[kind].count);
  return entries;
 };
 const created=await section('created');
 expect(job.report.sections.created.pages).toBeGreaterThan(1);
 const target=(kind:string,sourceId:string)=>{
  const matches=created.filter(entry=>entry.kind===kind&&entry.sourceId===sourceId);
  expect(matches,`${kind} ${sourceId}`).toHaveLength(1);
  expect(matches[0]!.targetId).toBeTruthy();return matches[0]!.targetId!;
 };
 const nativePages=(await read('/pages')).items;
 const nativeDatabases=(await read('/databases')).items;
 expect(nativePages).toHaveLength(46); // 35 source pages, 7 database hosts, 4 row-only pages.
 expect(nativeDatabases).toHaveLength(7);
 expect([...new Set(nativePages.map((page:any)=>page.containerId))]).toEqual([target('container',source.containers[0]!.sourceId)]);
 expect(sorted(nativePages.map((page:any)=>page.id))).toEqual(sorted(created.filter(entry=>entry.kind==='page').map(entry=>entry.targetId)));
 const documents=new Map<string,any>();
 for(const page of nativePages){
  const document=await read(`/pages/${page.id}`);documents.set(page.id,document);
  expect(document.page).toMatchObject({id:page.id,title:page.title,lifecycle:'live'});
  expect(document.publishedRevisionId).toBeTruthy();
  expect(document.publishedRevisionId).toBe(document.workingRevisionId);
  expect((await request(`/pages/${page.id}`,false)).status).toBe(401);
 }
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM public_exposures').first('n')).toBe(0);
 const files=(await env.DB.prepare('SELECT id,page_id,original_name,content_type,size_bytes,storage_key FROM files WHERE deleted_at IS NULL').all<{id:string;page_id:string;original_name:string;content_type:string;size_bytes:number;storage_key:string}>()).results;
 const scopedFiles=new Map<string,string>();
 const expectedFiles:{pageId:string;name:string;type:string;size:number}[]=[];
 for(const media of source.media){
  const owners=source.pages.filter(page=>page.coverMediaSourceId===media.sourceId||flatten(page.blocks).some(block=>block.mediaSourceId===media.sourceId||block.links.some(link=>link.targetSourceId===media.sourceId)));
  if(!owners.length)owners.push(source.pages[0]!);
  for(const owner of owners){
   const pageId=target('page',owner.sourceId);
   const matches=files.filter(file=>file.page_id===pageId&&file.original_name===media.name);
   expect(matches).toHaveLength(1);const file=matches[0]!;
   scopedFiles.set(`${owner.sourceId}:${media.sourceId}`,file.id);
   expectedFiles.push({pageId,name:media.name,type:media.mediaType,size:media.bytes.byteLength});
   const response=await request(`/media/${file.id}`);
   expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe(media.mediaType);
   expect(await digest(new Uint8Array(await response.arrayBuffer()))).toBe(await digest(media.bytes));
   const stored=await env.FILES.get(file.storage_key);expect(stored).toBeTruthy();
   expect(await digest(new Uint8Array(await stored!.arrayBuffer()))).toBe(await digest(archive.get(media.archivePath!)!));
   expect((await request(`/media/${file.id}`,false)).status).toBe(401);
  }
 }
 expect(sorted(files.map(file=>({pageId:file.page_id,name:file.original_name,type:file.content_type,size:file.size_bytes})))).toEqual(sorted(expectedFiles));
 expect(sorted(files.map(file=>file.id))).toEqual(sorted(created.filter(entry=>entry.kind==='file').map(entry=>entry.targetId)));
 const href=(link:ImportedBlock['links'][number],pageSourceId:string):string|undefined=>{
  if(link.targetSourceId){
   if(link.kind==='attachment')return `/api/media/${scopedFiles.get(`${pageSourceId}:${link.targetSourceId}`)}`;
   if(link.kind==='database')return `/app/databases/${target('database',link.targetSourceId)}`;
   return `/app/pages/${target('page',link.targetSourceId)}`;
  }
  return /^(https?:|mailto:|\/app\/|\/api\/)/i.test(link.href)?link.href:undefined;
 };
 const canonicalBlocks=(sourceBlocks:ImportedBlock[],native:any[],pageSourceId:string)=>{
  const expected=flatten(sourceBlocks);expect(native).toHaveLength(expected.length);
  expect(new Set(native.map(block=>block.id)).size).toBe(native.length);
  const ids=new Map(expected.map((block,index)=>[block.sourceId,native[index].id]));
  const parents=new Map<string,string>();for(const block of expected)for(const child of block.children)parents.set(child.sourceId,block.sourceId);
  for(const [index,block] of expected.entries()){
   const actual=native[index],content=actual.content;
   expect(actual.parentBlockId).toBe(parents.has(block.sourceId)?ids.get(parents.get(block.sourceId)!):null);
   expect(actual.treePosition).toBe(String(index).padStart(8,'0'));
   const list=['bulleted-list','numbered-list','toggle'].includes(block.kind);
   const url=block.links[0]?href(block.links[0],pageSourceId):undefined;
   expect(actual.blockType).toBe(list?'list':block.kind==='link'?(url?'link-card':'paragraph'):block.kind);
   const spans=list?content.items[0].text:content.text;
   if(block.kind==='media'){
    const media=source.media.find(media=>media.sourceId===block.mediaSourceId)!;
    const fileId=scopedFiles.get(`${pageSourceId}:${media.sourceId}`);
    expect(content).toMatchObject({kind:'image',source:{url:`/api/media/${fileId}`,name:media.name,fileId,contentType:media.mediaType},caption:media.caption??'',alt:media.altText??''});
   }else if(block.kind==='link'){
    if(url)expect(content.url).toBe(url);
    else expect(content.text.map((span:any)=>span.text).join('')).toBe((block.text??'')+(block.links[0]?.href?` (${block.links[0].href})`:''));
   }else if(block.kind==='divider')expect(content).toEqual({});
   else{
    expect(spans.map((span:any)=>span.text).join('')).toBe(block.text??'');
    expect(spans.flatMap((span:any)=>span.link?[span.link.href]:[])).toEqual(block.links.map(link=>href(link,pageSourceId)).filter(Boolean));
    if(block.kind==='heading')expect(content.level).toBe(block.level);
    if(block.kind==='task')expect(content.done).toBe(!!block.checked);
    if(list){expect(content.variant).toBe(block.kind==='bulleted-list'?'bulleted':block.kind==='numbered-list'?'numbered':'toggle');expect(content.items).toHaveLength(1);}
   }
  }
 };
 const expectedTree:{id:string;title:string;parentPageId:string|null}[]=[];
 for(const page of source.pages){
  const id=target('page',page.sourceId),document=documents.get(id);
  const parentPageId=page.parentSourceId?target('page',page.parentSourceId):null;
  expectedTree.push({id,title:page.title,parentPageId});
  expect(document.parentPageId).toBe(parentPageId);
  expect(document.properties).toMatchObject({title:page.title,icon:page.icon??null,coverFileId:page.coverMediaSourceId?scopedFiles.get(`${page.sourceId}:${page.coverMediaSourceId}`):null});
  canonicalBlocks(page.blocks,document.blocks,page.sourceId);
 }
 const manual=documents.get(target('page',source.pages.find(page=>page.title==='manual')!.sourceId));
 const resources=manual.blocks.find((block:any)=>block.content.text?.map((span:any)=>span.text).join('').startsWith('The example resources are recorded in '));
 expect(resources.content.text.filter((span:any)=>span.link).map((span:any)=>({text:span.text,href:span.link.href}))).toEqual([
  {text:'🚀\u00a0Fixture Notes',href:'https://fixture.example.test/landings/fixture-notes?utm_source=lead+magnet&utm_medium=template&utm_campaign=free+templates'},
  {text:'🌲\u00a0Fixture Guide',href:'https://fixture.example.test/landings/fixture-guide?utm_source=lead+magnet&utm_medium=template&utm_campaign=free+templates'},
 ]);
 expect(resources.content.text[0]).toEqual({text:'The example resources are recorded in '});
 expect(resources.content.text.at(-1)).toEqual({text:'. The fixture describes how to:'});
 let recordCount=0;
 for(const database of source.databases){
  const id=target('database',database.sourceId),native=nativeDatabases.find((item:any)=>item.id===id)!;
  const document=await read(`/databases/${id}`);
  const parentPageId=database.parentSourceId?target('page',database.parentSourceId):null;
  expectedTree.push({id:native.pageId,title:database.title,parentPageId});
  expect(documents.get(native.pageId).parentPageId).toBe(parentPageId);
  expect(document.fields.map((field:any)=>({name:field.name,type:field.type,options:field.config.options??null}))).toEqual(database.fields.map(field=>({name:field.name,type:field.type==='title'?'text':field.type,options:field.options??null})));
  expect(document.views.length).toBeGreaterThan(0);
  const view=await read(`/databases/${id}/views/${document.views[0].id}`);
  const records=source.records.filter(record=>record.databaseSourceId===database.sourceId);
  expect(view.records).toHaveLength(records.length);
  const expectedValues=records.map(record=>Object.fromEntries(database.fields.map(field=>[document.fields.find((native:any)=>native.name===field.name).id,record.fields[field.name]??null])));
  expect(sorted(view.records.map((record:any)=>record.values))).toEqual(sorted(expectedValues));
  for(const record of records){
   const values=Object.fromEntries(database.fields.map(field=>[document.fields.find((native:any)=>native.name===field.name).id,record.fields[field.name]??null]));
   const matches=view.records.filter((native:any)=>JSON.stringify(native.values)===JSON.stringify(values));
   expect(matches).toHaveLength(1);const native=matches[0]!;
   if(record.pageSourceId)expect(native.pageId).toBe(target('page',record.pageSourceId));
   else expectedTree.push({id:native.pageId,title:String(Object.values(record.fields)[0]),parentPageId:null});
   const opened=await read(`/databases/${id}/records/${native.pageId}`);
   expect(opened.values).toEqual(values);
   expect(opened.page.page).toMatchObject({id:native.pageId,title:String(Object.values(record.fields)[0]),lifecycle:'live'});
   expect(sorted(opened.page.blocks)).toEqual(sorted(documents.get(native.pageId).blocks));
   recordCount++;
  }
 }
 expect(recordCount).toBe(22);
 expect(sorted(nativePages.map((page:any)=>({id:page.id,title:page.title,parentPageId:page.parentPageId})))).toEqual(sorted(expectedTree));
 const unmapped=await section('unmapped'),warnings=await section('warnings');
 const additionalLosses:ImportReportEntry[]=[];
 for(const page of source.pages)for(const block of flatten(page.blocks))for(const link of block.links)if(!link.targetSourceId&&!href(link,page.sourceId))additionalLosses.push({kind:'construct',sourceId:block.sourceId,label:link.href,detail:'Archive-relative target is not present as an imported record. Link text and original archive retained.'});
 for(const record of source.records){const database=source.databases.find(database=>database.sourceId===record.databaseSourceId)!;for(const [key,value] of Object.entries(record.fields))if(!database.fields.some(field=>field.name===key||field.sourceId===key))additionalLosses.push({kind:'construct',sourceId:record.sourceId,label:key,detail:`Unmapped record value: ${JSON.stringify(value)}`});}
 expect(sorted(unmapped)).toEqual(sorted([...source.report.unmapped,...additionalLosses]));
 expect(sorted(warnings)).toEqual(sorted([...source.report.warnings,...source.pages.filter(page=>Object.keys(page.properties).length).map(page=>({kind:'page',sourceId:page.sourceId,label:page.title,detail:`Source property ledger retained in report: ${JSON.stringify(page.properties)}`}))]));
 for(const [kind,count] of Object.entries(job.counts))expect(created.filter(entry=>entry.kind===({containers:'container',pages:'page',databases:'database',records:'record',files:'file',versions:'version'} as Record<string,string>)[kind])).toHaveLength(count as number);
 console.info(`PROBE IMP-002 1: native completed import -> ${nativePages.length} live pages, authenticated reads, no public exposure, ${unmapped.length} omissions and ${warnings.length} warnings fully paged`);
 console.info('PROBE IMP-002 2: retained incumbent archive -> 57 entries; committed provenance and parser regression retained');
 console.info(`PROBE IMP-002 3: native page, database, record and media reads -> complete tree and blocks, 7 typed databases, 22 records, ${source.media.length} supplied media with exact R2 bytes`);
}
