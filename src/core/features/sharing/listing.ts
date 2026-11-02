import type { FeatureContext } from '../../app/feature-context';
import type { KnowledgeGrant } from '../../shared/knowledge/model';
import { requirePageLevel, requireContainerAdministration } from './current-access';
import { sharingConfiguration } from './configuration';
import { isPrivateLifecycle } from './access';
import { restrictionBoundary } from './inheritance';
import { currentPageTitle, permitted } from '../search/visibility';

type GrantRow = KnowledgeGrant & {invitationId:string|null;invitationEmail:string|null;invitationExpiresAt:string|null;invitationRevokedAt:string|null;principalLabel:string|null};
async function rows(ctx:FeatureContext,kind:'page'|'container',id:string) {
  return (await ctx.db.prepare(`SELECT g.id,g.principal_kind AS principalKind,g.principal_id AS principalId,g.level,g.expires_at AS expiresAt,g.revoked_at AS revokedAt,i.id AS invitationId,i.email AS invitationEmail,i.expires_at AS invitationExpiresAt,i.revoked_at AS invitationRevokedAt,CASE g.principal_kind WHEN 'member' THEN m.display_name WHEN 'group' THEN gr.name WHEN 'container' THEN c.name WHEN 'workspace' THEN w.name END AS principalLabel FROM ${kind==='page'?'page_grants':'container_grants'} g LEFT JOIN invitations i ON i.${kind==='page'?'page_grant_id':'container_grant_id'}=g.id AND i.accepted_by_member_id IS NULL LEFT JOIN members m ON g.principal_kind='member' AND m.id=g.principal_id LEFT JOIN groups gr ON g.principal_kind='group' AND gr.id=g.principal_id LEFT JOIN containers c ON g.principal_kind='container' AND c.id=g.principal_id LEFT JOIN workspaces w ON g.principal_kind='workspace' AND w.id=g.principal_id WHERE g.${kind==='page'?'page_id':'container_id'}=? ORDER BY g.created_at,g.id`).bind(id).all<GrantRow>()).results;
}
function presented(row:GrantRow,origin:{kind:'page'|'container';id:string|null;name:string},inherited:boolean,eligible:boolean,now:string) {
  const status = row.revokedAt || row.invitationRevokedAt ? 'revoked' : (row.expiresAt && row.expiresAt <= now) || (row.invitationId && row.invitationExpiresAt && row.invitationExpiresAt <= now) ? 'expired' : row.invitationId ? 'pending' : 'active';
  return {...row,principalLabel:row.invitationEmail ?? row.principalLabel ?? 'Former principal',origin,inherited,status,effective:eligible&&status==='active'};
}
/** Keep direct rows for editing; inherited rows are read-only and follow the exact current ACL traversal. */
export async function listGrants(ctx:FeatureContext,kind:'page'|'container',id:string) {
  const access=kind==='page'?await requirePageLevel(ctx,id,'full'):null;
  if(kind==='container')await requireContainerAdministration(ctx,id);
  const configuration=await sharingConfiguration(ctx);
  const containerId=access?.context.container.id??id;
  const container=await ctx.db.prepare('SELECT name FROM containers WHERE id=?').bind(containerId).first<{name:string}>();
  const ownName=kind==='page'?await currentPageTitle(ctx,id):container!.name;
  const items=(await rows(ctx,kind,id)).map(row=>presented(row,{kind,id,name:ownName},false,kind==='container'||!isPrivateLifecycle(access!.context.page.lifecycle)||['member','group'].includes(row.principalKind),ctx.now));
  const inheritedItems:ReturnType<typeof presented>[]=[];
  if(access&&!isPrivateLifecycle(access.context.page.lifecycle)&&!access.context.page.restricted) {
    const inheritedIds=new Set(access.context.inheritedGrants.map(grant=>grant.id));
    if(inheritedIds.size) {
      const sources=(await ctx.db.prepare('SELECT DISTINCT p.id FROM pages p JOIN page_grants g ON g.page_id=p.id WHERE p.workspace_id=? AND p.container_id=?').bind(ctx.actor.workspaceId,containerId).all<{id:string}>()).results;
      for(const source of sources) {
        const inheritedRows=(await rows(ctx,'page',source.id)).filter(row=>inheritedIds.has(row.id));
        if(!inheritedRows.length)continue;
        const readable=await permitted(()=>requirePageLevel(ctx,source.id,'view'));
        const origin={kind:'page' as const,id:readable?source.id:null,name:readable?await currentPageTitle(ctx,source.id):'Restricted ancestor'};
        inheritedItems.push(...inheritedRows.map(row=>presented(row,origin,true,true,ctx.now)));
      }
    }
    const containerIds=new Set(access.context.container.grants.map(grant=>grant.id));
    inheritedItems.push(...(await rows(ctx,'container',containerId)).filter(row=>containerIds.has(row.id)).map(row=>presented(row,{kind:'container',id:containerId,name:container!.name},true,true,ctx.now)));
  }
  // A restriction is reported on the restricted page and on every descendant it cuts off from the pages above and the space; an unreadable restricted ancestor keeps its title and id out of the answer.
  const boundary=access&&!isPrivateLifecycle(access.context.page.lifecycle)?await restrictionBoundary(ctx,id):null;
  let restriction:{scope:'page'|'ancestor';id:string|null;name:string}|null=null;
  if(boundary) {
    const readable=boundary.depth===0||await permitted(()=>requirePageLevel(ctx,boundary.id,'view'));
    restriction={scope:boundary.depth===0?'page':'ancestor',id:readable?boundary.id:null,name:readable?await currentPageTitle(ctx,boundary.id):'Restricted ancestor'};
  }
  return {items,inheritedItems,effectiveItems:[...items,...inheritedItems].filter(row=>row.effective),levels:configuration.levels,container:{id:containerId,name:container!.name},restricted:access?.context.page.restricted??false,restriction};
}
