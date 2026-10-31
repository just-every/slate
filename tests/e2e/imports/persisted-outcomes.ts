import {expect} from 'vitest';
import {env} from 'cloudflare:test';
import {parseImport,type ImportFormat} from '../../../src/core/features/imports';
import type {ImportedBlock,ImportReportEntry} from '../../../src/core/features/imports/types';
import {createApi} from '../../../src/core/app/hono';
import {syntheticConfluenceArchive} from './fixtures/synthetic';
import {strToU8,unzipSync,zipSync} from 'fflate';

type Api=ReturnType<typeof createApi>;
export function importDoor(app:Api,cookie:string){
 const request=(path:string,body?:unknown)=>app.request(`https://slate.example/api${path}`,{
  method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined||body instanceof FormData?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),
 },env);
 const json=async(path:string,body?:unknown)=>{const response=await request(path,body),data=await response.json() as any;expect(response.status,JSON.stringify(data)).toBe(200);return data;};
 return {request,json};
}
type Door=ReturnType<typeof importDoor>;

/** Read every retained report page, including the rows omitted by its summary. */
export async function completeReport(door:Door,job:any,section:string):Promise<ImportReportEntry[]>{
 const descriptor=job.report.sections?.[section];
 if(!descriptor)return job.report[section]??[];
 const items:ImportReportEntry[]=[];
 for(let page=0;page<descriptor.pages;page++){
  const result=await door.json(`/imports/${job.id}/report/${section}?page=${page}`);
  expect(result).toMatchObject({page,pages:descriptor.pages,total:descriptor.count});
  expect(result.items.length).toBeGreaterThan(0);items.push(...result.items);
 }
 expect(items).toHaveLength(descriptor.count);
 expect(items.slice(0,job.report[section].length)).toEqual(job.report[section]);
 return items;
}
const flatten=(blocks:ImportedBlock[]):ImportedBlock[]=>blocks.flatMap(block=>[block,...flatten(block.children)]);
const spans=(value:any):string=>Array.isArray(value)?value.map(span=>span.text??'').join(''):'';
const hrefs=(value:unknown):string[]=>{
 if(Array.isArray(value))return value.flatMap(hrefs);
 if(!value||typeof value!=='object')return [];
 return Object.entries(value).flatMap(([key,item])=>(key==='href'||key==='url')&&typeof item==='string'?[item]:hrefs(item));
};

/** Expectations come from the retained source and the independent fixture
 * assertions below. All observations use the same doors a member reads. */
export async function persistedOutcomes(door:Door,job:any,format:ImportFormat,name:string,bytes:Uint8Array){
 const parsed=parseImport(format,{name,bytes});
 const creations=await completeReport(door,job,'created');
 const target=(kind:string,sourceId:string)=>{const entries=creations.filter(item=>item.kind===kind&&item.sourceId===sourceId);expect(entries).toHaveLength(1);expect(entries[0]!.targetId).toBeTruthy();return entries[0]!.targetId!;};
 const tree=(await door.json('/pages')).items;
 const importedIds=creations.filter(item=>item.kind==='page').map(item=>item.targetId);
 const imported=tree.filter((page:any)=>importedIds.includes(page.id));
 expect(imported).toHaveLength(parsed.pages.length);
 expect(imported.map((page:any)=>page.title)).toEqual(parsed.pages.map(page=>page.title));
 if(format==='confluence-space')expect(creations.filter(item=>item.kind==='version')).toHaveLength(job.counts.versions);
 const documents=new Map<string,any>();
 const statuses=(await door.json('/status')).items;
 for(const page of parsed.pages){
  const id=target('page',page.sourceId),document=await door.json(`/pages/${id}`);
  documents.set(page.title,document);
  expect(document.page.containerId).toBe(target('container',page.containerSourceId));
  expect(document.parentPageId).toBe(page.parentSourceId?target('page',page.parentSourceId):null);
  expect(document.page.lifecycle).toBe(page.lifecycle);
  expect(document.properties.title).toBe(page.title);
  expect(document.properties.labels).toEqual(page.labels);
  expect(document.properties.statusKey).toBe(statuses.some((status:any)=>status.key===page.status&&!status.requiresVerification&&!status.retiredAt)?page.status:null);
  expect(imported.find((row:any)=>row.id===id)).toMatchObject({parentPageId:document.parentPageId,labels:page.labels,lifecycle:page.lifecycle});
  if(page.lifecycle==='draft')expect(document.publishedRevisionId).toBeNull();
  else expect(document.publishedRevisionId).toBeTruthy();
  const checkBody=async(blocks:any[],source:ImportedBlock[])=>{
   const expected=flatten(source);expect(blocks).toHaveLength(expected.length);
   for(const [index,block] of expected.entries()){
    const actual=blocks[index]!;
    if(['paragraph','heading','quote','callout','task'].includes(block.kind))expect(spans(actual.content.text)).toBe(block.text??'');
    if(block.kind==='heading')expect(actual.content.level).toBe(Math.min(3,block.level??1));
    if(block.kind==='code')expect(actual.content.code).toBe(block.text??'');
    if(block.kind==='table'){
     const canonical=block.canonicalBlock?.content as any;
     expect(actual.content.columns).toEqual(canonical?.columns??block.rows?.[0]);
     expect(actual.content.rows.map((row:any)=>row.cells)).toEqual(canonical?.rows.map((row:any)=>row.cells)??block.rows?.slice(1));
    }
    for(const link of block.links){
     if(link.targetSourceId){
      const attachment=link.kind==='attachment';
      const href=attachment?`/api/media/${target('file',link.targetSourceId)}`:`/app/pages/${target('page',link.targetSourceId)}`;
      expect(hrefs(actual.content)).toContain(href);
      const response=await door.request(attachment?href.slice(4):`/pages/${target('page',link.targetSourceId)}`);
      expect(response.status).toBe(200);
      if(attachment){const media=parsed.media.find(item=>item.sourceId===link.targetSourceId)!;expect(new Uint8Array(await response.arrayBuffer())).toEqual(media.bytes);}
     }
    }
   }
  };
  const working=page.lifecycle==='live-with-unpublished-changes'?page.revisions.findLast(revision=>revision.origin==='autosave'):undefined;
  await checkBody(document.blocks,working?.blocks??page.blocks);
  const history=(await door.json(`/revisions/${id}`)).items;
  expect(history).toHaveLength(page.revisions.length+1);
  for(const revision of page.revisions){
   const revisionId=target('version',revision.sourceId);
   expect(history.find((row:any)=>row.id===revisionId)).toMatchObject({ordinal:revision.ordinal??null,origin:revision.origin,statusKey:revision.status??null,label:revision.label&&revision.comment?`${revision.label} — ${revision.comment}`:revision.label??revision.comment??null,deletedAt:null});
   const snapshot=await door.json(`/revisions/${id}/${revisionId}`);
   expect(snapshot.properties).toMatchObject({title:revision.title??page.title,labels:revision.labels??page.labels,statusKey:revision.status??null});
   await checkBody(snapshot.blocks,revision.blocks);
  }
  if(format==='confluence-space'&&page.revisions.some(revision=>revision.sourceId.startsWith('confluence-version:')&&revision.sourceId.includes(':draft'))){
   expect(document.workingRevisionId).not.toBe(document.publishedRevisionId);
   const published=page.revisions.findLast(revision=>revision.origin==='publish')!;
   expect(document.publishedRevisionId).toBe(target('version',published.sourceId));
  }
 }
 const losses=await completeReport(door,job,'unmapped');
 const warnings=await completeReport(door,job,'warnings');
 expect(losses).toEqual(expect.arrayContaining(parsed.report.unmapped));
 expect(warnings).toEqual(expect.arrayContaining(parsed.report.warnings));
 if(name==='confluence-space-export.zip'){
  expect([...documents.keys()]).toEqual(['Overview','Getting started in Confluence','Pizza Restaurant Launch Plan']);
  expect([...documents.values()].map(document=>document.page.lifecycle)).toEqual(['live','live','live-with-unpublished-changes']);
  expect([...documents.values()].flatMap(document=>document.properties.labels)).toEqual([]);
  expect(losses.filter(item=>item.label.startsWith('Confluence image is hosted outside the archive'))).toHaveLength(12);
  expect(losses).toEqual(expect.arrayContaining([expect.objectContaining({label:'Confluence whiteboard canvas payload was not imported'})]));
 }
 if(name==='synthetic-slate-1.zip'){
  expect([...documents.keys()]).toEqual(['Overview','Child','Legacy folder','Private draft']);
  expect(documents.get('Overview').properties.labels).toEqual(['team']);
  expect(documents.get('Overview').properties.statusKey).toBe('current');
  expect(documents.get('Legacy folder').blocks).toEqual([]);
  expect(documents.get('Child').parentPageId).toBe(documents.get('Legacy folder').page.id);
  expect(documents.get('Private draft').page.lifecycle).toBe('draft');
  expect(documents.get('Private draft').publishedRevisionId).toBeNull();
  const history=(await door.json(`/revisions/${documents.get('Overview').page.id}`)).items;
  expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ordinal:3,label:'Published',origin:'publish'})]));
  expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ordinal:4,label:'Overview — Current release',statusKey:'current',origin:'publish'})]));
  expect(losses.filter(item=>item.label==='Unsupported Confluence Whiteboard').map(item=>item.sourceId).sort()).toEqual(Array.from({length:55},(_,n)=>`confluence:whiteboard-${n}`).sort());
  expect(losses).toEqual(expect.arrayContaining(['Unsupported Confluence Calendar','Unsupported Confluence BlogPost','Confluence folder imported as an empty-body page'].map(label=>expect.objectContaining({label}))));
  expect(job.report.sections.unmapped.pages).toBeGreaterThan(1);
 }
 return {documents,losses,warnings,creations};
}

export async function documentImportJourney(app:Api,cookie:string,format:'docx'|'google-docx',name:string,bytes:Uint8Array){
 const door=importDoor(app,cookie),form=new FormData(),operationKey=crypto.randomUUID();
 form.set('file',new File([new Uint8Array(bytes)],name));form.set('format',format);form.set('operationKey',operationKey);
 const upload=await door.json('/imports',form);
 let job=await door.json(`/imports/${upload.id}/run`,{});
 for(let attempt=0;job.state!=='completed'&&attempt<100;attempt++)job=await door.json(`/imports/${job.id}/resume`,{});
 expect(job.state).toBe('completed');
 const {documents,losses}=await persistedOutcomes(door,job,format,name,bytes);
 expect(documents.size).toBe(1);
 const document=[...documents.values()][0];
 expect(document.parentPageId).toBeNull();expect(document.page.lifecycle).toBe('live');
 expect(document.publishedRevisionId).toBe(document.workingRevisionId);
 if(format==='google-docx'){
  expect(document.properties.title).toBe('google-docs-download');
  expect(document.blocks.map((block:any)=>[block.blockType,spans(block.content.text)])).toEqual([
   ['paragraph','Building a plan for launching my pizza resturant'],
   ['paragraph','This is where a document would be if I wrote one'],
  ]);
  expect(losses).toEqual([]);
 }else{
  expect(document.properties.title).toBe('Final stage impact assessment');
  expect(document.blocks.reduce((counts:Record<string,number>,block:any)=>{counts[block.blockType]=(counts[block.blockType]??0)+1;return counts;},{})).toEqual({heading:30,paragraph:28,list:3,table:6,'link-card':8});
  expect(document.blocks.filter((block:any)=>block.blockType==='heading').map((block:any)=>spans(block.content.text))).toEqual(expect.arrayContaining(['1. Summary of proposal','Evidence base','Risks and assumptions']));
  expect(hrefs(document.blocks.map((block:any)=>block.content))).toEqual(parseImport(format,{name,bytes}).pages[0]!.blocks.flatMap(block=>block.links.map(link=>link.href)));
  expect(losses).toHaveLength(2);
 }
 const tree=await door.json('/pages'),history=await door.json(`/revisions/${document.page.id}`);
 expect(new Uint8Array(await (await door.request(`/imports/${job.id}/original`)).arrayBuffer())).toEqual(bytes);
 expect((await door.json('/imports',form)).id).toBe(job.id);
 expect((await door.json(`/imports/${job.id}/run`,{})).state).toBe('completed');
 expect(await door.json('/pages')).toEqual(tree);
 expect(await door.json(`/revisions/${document.page.id}`)).toEqual(history);
 expect(await door.json(`/pages/${document.page.id}`)).toEqual(document);
 const conflict=new FormData();conflict.set('file',new File(['different'],'synthetic-slate-2.txt'));conflict.set('format','text');conflict.set('operationKey',operationKey);
 const response=await door.request('/imports',conflict);expect(response.status).toBe(409);
 expect(await door.json('/pages')).toEqual(tree);
}

/** Supplemental entities exercise constructs absent from the genuine Cloud
 * export. The original incumbent archives and their provenance stay intact. */
export function supplementalConfluenceArchive(){
 const files=unzipSync(syntheticConfluenceArchive());
 let xml=new TextDecoder().decode(files['entities.xml']);
 xml=xml.replace('<property name="title">Overview</property>','<property name="title">Overview</property><property name="version">4</property><property name="versionComment">Current release</property><property name="contentStatus">current</property>');
 xml=xml.replace('<property name="parentId">page-1</property><property name="title">Child','<property name="parentId">folder-1</property><property name="title">Child');
 xml=xml.replace('<h1>Overview</h1>','<h1>Overview</h1><p><ac:link><ri:attachment ri:filename="diagram.png"/></ac:link></p>');
 const extra=`<object class="Page"><property name="id">draft-1</property><property name="spaceId">space-1</property><property name="title">Private draft</property><property name="contentStatus">draft</property><property name="body"><![CDATA[<p>Unpublished source body</p>]]></property></object><object class="Calendar"><property name="id">calendar-1</property></object>`+Array.from({length:55},(_,n)=>`<object class="Whiteboard"><property name="id">whiteboard-${n}</property></object>`).join('');
 files['entities.xml']=strToU8(xml.replace('</hibernate-generic>',extra+'</hibernate-generic>'));
 return zipSync(files);
}
