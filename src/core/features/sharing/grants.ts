import { requireConfiguredLevel } from './configuration';
import { grantRecipients } from './recipients';
import { identityRevision } from '../workspace/revisions';
import { notificationStatements } from '../notifications/events';
import type { FeatureContext } from '../../app/feature-context';
import { commitOperation,mutationGuard } from '../../app/operations';
import { ApiProblem } from '../../app/problems';
import { currentSubject,requirePageLevel,requireContainerAdministration } from './current-access';
import { createUlid } from '../../shared/ulid';
import type { AccessLevel,GrantPrincipalKind } from '../../shared/knowledge/model';
export async function saveGrant(ctx:FeatureContext,input:{operationKey:string;targetKind:'page'|'container';targetId:string;id?:string;principalKind:GrantPrincipalKind;principalId:string;level:AccessLevel;expiresAt?:string|null;revoke?:boolean}){
  return commitOperation(ctx,{operationKey:input.operationKey,action:'sharing.grant',request:input,authorize:async()=>{if(input.targetKind==='page')await requirePageLevel(ctx,input.targetId,'full');else await requireContainerAdministration(ctx,input.targetId);},prepare:async({revisionId})=>{
    if(!input.revoke)await requireConfiguredLevel(ctx,input.level);
    const id=input.id??createUlid(),table=input.targetKind==='page'?'page_grants':'container_grants',key=input.targetKind==='page'?'page_id':'container_id';
    const container=await ctx.db.prepare(input.targetKind==='page'?'SELECT c.* FROM containers c JOIN pages p ON p.container_id=c.id WHERE p.id=?':'SELECT * FROM containers WHERE id=?').bind(input.targetId).first<{id:string;visibility:string;guest_access:string}>();
    if(!container||container.visibility==='personal')throw new ApiProblem(403,'PERSONAL_PRIVATE','A personal container cannot be shared.');
    if(input.targetKind==='page'){const page=await ctx.db.prepare('SELECT lifecycle FROM pages WHERE id=?').bind(input.targetId).first<{lifecycle:string}>();if(!input.revoke&&(page?.lifecycle==='draft'||page?.lifecycle==='scheduled')&&(input.principalKind==='workspace'||input.principalKind==='container'))throw new ApiProblem(403,'DRAFT_PRIVATE','Drafts cannot have general grants.');}
    const pending=input.id?await ctx.db.prepare(`SELECT id FROM invitations WHERE ${input.targetKind==='page'?'page_grant_id':'container_grant_id'}=? AND workspace_id=? AND accepted_by_member_id IS NULL AND revoked_at IS NULL`).bind(input.id,ctx.actor.workspaceId).first<{id:string}>():null;
    if(pending&&!input.revoke)throw new ApiProblem(409,'INVITATION_PENDING','Revoke the pending invitation before changing its grant.');
    if(!pending){
    if(input.principalKind==='member'){
      const member=await ctx.db.prepare("SELECT member_kind FROM members WHERE id=? AND workspace_id=? AND status='active'").bind(input.principalId,ctx.actor.workspaceId).first<{member_kind:string}>();if(!member)throw new ApiProblem(400,'PRINCIPAL_INVALID','The principal is unavailable.');
      if(member.member_kind==='guest'){const workspace=await ctx.db.prepare('SELECT guest_access FROM workspaces WHERE id=?').bind(ctx.actor.workspaceId).first<{guest_access:string}>();if(container.guest_access==='forbidden'||workspace?.guest_access==='forbidden')throw new ApiProblem(403,'GUESTS_FORBIDDEN','Guests are forbidden here.');}
    } else if(input.principalKind==='group'){if(!await ctx.db.prepare('SELECT id FROM groups WHERE id=? AND workspace_id=?').bind(input.principalId,ctx.actor.workspaceId).first())throw new ApiProblem(400,'PRINCIPAL_INVALID','The group is unavailable.');}
    else if((input.principalKind==='workspace'&&input.principalId!==ctx.actor.workspaceId)||(input.principalKind==='container'&&input.principalId!==container.id))throw new ApiProblem(400,'PRINCIPAL_INVALID','General grants must name their own scope.');
    }
    const statements:D1PreparedStatement[]=[];
    if(input.id)statements.push(mutationGuard(ctx.db,`SELECT ${key}=? FROM ${table} WHERE id=?`,[input.targetId,id]));
    if(input.revoke)statements.push(ctx.db.prepare(`UPDATE ${table} SET revoked_at=?,updated_at=? WHERE id=? AND ${key}=?`).bind(ctx.now,ctx.now,id,input.targetId));
    else {
      if(input.principalKind==='workspace'||input.principalKind==='container')statements.push(ctx.db.prepare(`DELETE FROM ${table} WHERE ${key}=? AND principal_kind IN ('workspace','container')`).bind(input.targetId));
      statements.push(ctx.db.prepare(`INSERT INTO ${table} (id,${key},principal_kind,principal_id,level,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET principal_kind=excluded.principal_kind,principal_id=excluded.principal_id,level=excluded.level,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=excluded.updated_at`).bind(id,input.targetId,input.principalKind,input.principalId,input.level,input.expiresAt??null,ctx.now,ctx.now));
    }
    if(pending&&input.revoke)statements.push(ctx.db.prepare('UPDATE invitations SET revoked_at=? WHERE id=?').bind(ctx.now,pending.id),ctx.db.prepare("UPDATE mail_deliveries SET payload_ciphertext=NULL,next_attempt_at=NULL,lease_until=NULL,state=CASE WHEN state='sent' THEN state ELSE 'failed' END,delivery_phase=CASE WHEN state='sent' THEN delivery_phase ELSE 'cancelled' END,updated_at=? WHERE invitation_id=?").bind(ctx.now,pending.id));
    if(!input.revoke) { const recipientIds=await grantRecipients(ctx,input.principalKind,input.principalId); if(recipientIds.length)statements.push(...notificationStatements(ctx,{id:createUlid(),event:'access-granted',...(input.targetKind==='page'?{pageId:input.targetId}:{containerId:input.targetId}),recipientIds})); }
    statements.push(await identityRevision(ctx,revisionId,`${input.targetKind}-grant`,id,{targetId:input.targetId,principalKind:input.principalKind,principalId:input.principalId,level:input.level,expiresAt:input.expiresAt??null,revoked:!!input.revoke}));
    return {entity:{id:input.targetId,kind:input.targetKind,revisionId},value:{id,revoked:!!input.revoke},detail:{grantId:id},statements};
  }});
}
export { listGrants } from './listing';
