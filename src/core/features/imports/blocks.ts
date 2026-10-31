import type {ImportedBlock,ImportedMedia,NormalizedImport} from './types';
import type {BlockInput} from '../pages/types';
import {safeUrl} from '../editor/validation';
import type {JsonValue} from '../../shared/api/common';
import {importedHref,importedText} from './inline-text';
import {canonicalContent} from './canonical-block';
import {importedTableContent} from './table-content';
/** Appended documents and child pages disclose the same unresolved links. */
export function resolveImportLinks(parsed:NormalizedImport,pageIdFor:(sourceId:string)=>string) {
 function visit(blocks:ImportedBlock[],pageId:string) {
  for(const block of blocks) {
   for(const link of block.links) {
    if(link.href.startsWith('#'))link.href=`/app/pages/${pageIdFor(pageId)}${link.href}`;
    if(!link.targetSourceId&&!safeUrl(link.href))parsed.report.unmapped.push({kind:'construct',sourceId:block.sourceId,label:link.href,detail:'Archive-relative target is not present as an imported record. Link text and original archive retained.'});
   }
   visit(block.children,pageId);
  }
 }
 for(const page of parsed.pages)visit(page.blocks,page.sourceId);
}
/** Source identities survive in mappings; editor block IDs are deterministic within the import. */
export function importBlocks(blocks:ImportedBlock[],idFor:(kind:string,id:string)=>string,media:ImportedMedia[]):BlockInput[]{const out:BlockInput[]=[];function visit(block:ImportedBlock,index:number,parent:string|null){const id=idFor('block',block.sourceId);if(block.canonicalBlock){const b=block.canonicalBlock;out.push({id,blockType:b.blockType,content:canonicalContent(block,idFor),parentBlockId:b.parentBlockId?idFor('block',b.parentBlockId):null,treePosition:b.treePosition});return;}const text=importedText(block,idFor);let type:string=block.kind,content:JsonValue={text};const href=importedHref(block.links[0],idFor);
 switch(block.kind){case'columns':content={count:block.children.length};break;case'column':content={};break;case'table-of-contents':content={...block.tableOfContents!};break;case'heading':content={text,level:Math.min(3,block.level??1)};break;case'bulleted-list':case'numbered-list':case'toggle':type='list';content={variant:block.kind==='bulleted-list'?'bulleted':block.kind==='numbered-list'?'numbered':'toggle',items:[{id:`${id}:item`,text}]};break;case'code':content={code:block.text??'',language:block.language??'text'};break;case'task':content={text,done:!!block.checked};break;case'divider':content={};break;case'callout':content={text,tone:'neutral'};break;case'expandable':content={summary:block.text??'',open:false,content:[]};break;case'table':content=importedTableContent(block.rows??[],id);break;case'media':{const file=media.find(m=>m.sourceId===block.mediaSourceId);if(file){const fileId=idFor('file',file.sourceId);content={kind:file.mediaType.startsWith('image/')?'image':file.mediaType.startsWith('video/')?'video':file.mediaType.startsWith('audio/')?'audio':'file',source:{url:`/api/media/${fileId}`,name:file.name,fileId,contentType:file.mediaType},caption:file.caption??'',alt:file.altText??''};}else{type='paragraph';content={text:[{text:(block.text??'')+(href?` (${href})`:'')}]};}break;}case'link':if(href&&safeUrl(href)){type='link-card';content={url:href,display:'plain',previewState:'refused'};}else{type='paragraph';content={text:[{text:(block.text??'')+(href?` (${href})`:'')}]};}break;}
 out.push({id,blockType:type,content,parentBlockId:parent,treePosition:String(out.length).padStart(8,'0')});block.children.forEach((child,n)=>visit(child,n,id));}blocks.forEach((b,n)=>visit(b,n,null));return out;}
