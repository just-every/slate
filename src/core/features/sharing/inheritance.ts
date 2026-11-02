import type { FeatureContext } from '../../app/feature-context';
import { commitOperation } from '../../app/operations';
import { requirePageLevel } from './current-access';
import { pageRow,pageAccessGuard,snapshot,revisionStatement,contentEvent,lifecycleWritable } from '../pages/repository';
/** Restriction changes traversal only; neither branch copies nor rewrites any grant. */
export function setPageInheritance(ctx:FeatureContext,pageId:string,input:{operationKey:string;expectedRevisionId:string;restricted:boolean}) {
  return commitOperation(ctx,{operationKey:input.operationKey,action:'sharing.inheritance',request:{pageId,...input},authorize:async()=>{await requirePageLevel(ctx,pageId,'full');},prepare:async({revisionId})=>{
    const page=await pageRow(ctx,pageId);lifecycleWritable(page);
    const inheritance=input.restricted?'restricted':'inherit';
    if(page.access_inheritance===inheritance)return {noChange:true,entity:{id:pageId,kind:'page',revisionId:page.revision_id},value:{pageId,revisionId:page.revision_id,restricted:input.restricted},statements:[pageAccessGuard(ctx,page,input.expectedRevisionId)]};
    return {entity:{id:pageId,kind:'page',revisionId},value:{pageId,revisionId,restricted:input.restricted},statements:[
      pageAccessGuard(ctx,page,input.expectedRevisionId),ctx.db.prepare('UPDATE pages SET access_inheritance=?,revision_id=?,updated_at=? WHERE id=?').bind(inheritance,revisionId,ctx.now,pageId),
      await revisionStatement(ctx,pageId,revisionId,await snapshot(ctx,page)),...contentEvent(ctx,pageId,revisionId,'access-inheritance',{restricted:input.restricted})
    ]};
  }});
}
/** The nearest restricted page on a page's own traversal: the page itself, else the closest ancestor. Nothing above it is inherited. */
export async function restrictionBoundary(ctx:FeatureContext,pageId:string) {
  return ctx.db.prepare(`WITH RECURSIVE chain(id,parent_id,restricted,depth) AS (
    SELECT id,parent_page_id,access_inheritance='restricted',0 FROM pages WHERE id=? AND workspace_id=?
    UNION ALL
    SELECT p.id,p.parent_page_id,p.access_inheritance='restricted',c.depth+1 FROM pages p JOIN chain c ON p.id=c.parent_id WHERE c.restricted=0 AND p.workspace_id=?
  ) SELECT id,depth FROM chain WHERE restricted=1 ORDER BY depth LIMIT 1`).bind(pageId,ctx.actor.workspaceId,ctx.actor.workspaceId).first<{id:string;depth:number}>();
}
