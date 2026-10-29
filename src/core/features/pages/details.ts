import type { FeatureContext } from '../../app/feature-context';
import type { BlockView } from '../../shared/api/content';
import { requirePageLevel,resolveCurrentAccessMany } from '../sharing/current-access';
import { pageRow,revisionRow } from './repository';
import { plainContent } from '../editor/validation';
import { labelForReader } from './mentions';

/** True when a page body links to or mentions `pageId`; the one scan for "cites" (STAT-007). */
export function linksTo(value:unknown,pageId:string,appOrigin?:string):boolean {
  if(Array.isArray(value))return value.some(item=>linksTo(item,pageId,appOrigin));
  if(!value||typeof value!=='object')return false;
  const object=value as Record<string,any>;
  if(object.mention?.kind==='page'&&object.mention.id===pageId)return true;
  for(const link of [object.link?.href,object.url]) {
    if(typeof link!=='string')continue;
    try {
      const url=new URL(link,appOrigin??'https://slate.invalid');
      if(url.origin!==new URL(appOrigin??'https://slate.invalid').origin)continue;
      if(url.pathname===`/app/pages/${encodeURIComponent(pageId)}`)return true;
    } catch { /* Invalid historical links cannot identify another page. */ }
  }
  return Object.values(object).some(item=>linksTo(item,pageId,appOrigin));
}
/** Read details independently so live editor snapshots do not repeatedly scan backlink candidates. */
export async function pageDetails(ctx:FeatureContext,pageId:string,appOrigin?:string) {
  const access=await requirePageLevel(ctx,pageId,'view'),page=await pageRow(ctx,pageId);
  const revision=await revisionRow(ctx,pageId,['edit','full'].includes(access.decision.level!)?page.working_revision_id:page.published_revision_id??page.working_revision_id);
  const owner=page.owner_member_id?await ctx.db.prepare('SELECT id,display_name AS displayName FROM members WHERE id=? AND workspace_id=?').bind(page.owner_member_id,ctx.actor.workspaceId).first<{id:string;displayName:string}>():null;
  const rows=(await ctx.db.prepare(`SELECT p.id,p.working_revision_id,p.published_revision_id,w.body_json AS workingBody,w.properties_json AS workingProperties,pub.body_json AS publishedBody,pub.properties_json AS publishedProperties FROM pages p JOIN page_revisions w ON w.id=p.working_revision_id AND w.page_id=p.id AND w.deleted_at IS NULL LEFT JOIN page_revisions pub ON pub.id=p.published_revision_id AND pub.page_id=p.id AND pub.deleted_at IS NULL WHERE p.workspace_id=? AND p.id!=? AND p.deleted_at IS NULL AND p.trashed_at IS NULL AND (instr(w.body_json,?)>0 OR instr(pub.body_json,?)>0) ORDER BY p.id`).bind(ctx.actor.workspaceId,pageId,pageId,pageId).all<{id:string;working_revision_id:string;published_revision_id:string|null;workingBody:string;workingProperties:string;publishedBody:string|null;publishedProperties:string|null}>()).results;
  const allowed=await resolveCurrentAccessMany(ctx,rows.map(row=>row.id));
  const linkedFrom: {id:string;title:string}[]=[];
  for(const row of rows) {
    const decision=allowed.get(row.id)?.decision;if(!decision?.allowed)continue;
    const published=!['edit','full'].includes(decision.level!)&&!!row.published_revision_id;
    const body=published?row.publishedBody:row.workingBody,properties=published?row.publishedProperties:row.workingProperties;
    if(!body||!properties||!linksTo(JSON.parse(body),pageId,appOrigin))continue;
    linkedFrom.push({id:row.id,title:JSON.parse(properties).title});
  }
  const text=(await labelForReader(ctx,JSON.parse(revision.body_json) as BlockView[])).map(block=>plainContent(block.content)).join(' ').trim();
  const wordCount=text?text.split(/\s+/u).length:0;
  return {owner,linkedFrom,wordCount,characterCount:text.length,readingMinutes:Math.max(1,Math.ceil(wordCount/200))};
}
