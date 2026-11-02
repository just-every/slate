import {removeMemberReviewAssignment} from '../archive/erasure-reviews';
import {beginImportErasure} from '../imports/retire-custody';
import {completeErasure} from '../archive/erasure-cleanup';
import { prepareEraseMemberContent } from '../archive/erasure';
import { ensurePersonalContainer } from './personal';
import { identityRevision } from './revisions';
import type { FeatureContext } from '../../app/feature-context';
import { commitOperation, mutationGuard } from '../../app/operations';
import { ApiProblem } from '../../app/problems';
import { currentSubject, requireWorkspaceOwner } from '../sharing/current-access';
import type { MemberView, Theme } from '../../shared/api/workspace';
export async function currentMember(ctx:FeatureContext):Promise<MemberView> {
  const subject=await currentSubject(ctx);
  const [member]=await Promise.all([
    ctx.db.prepare('SELECT id,display_name AS displayName,email,role,member_kind AS memberKind,theme,is_setup_owner AS isSetupOwner FROM members WHERE id=?').bind(ctx.actor.id).first<Omit<MemberView,'isSetupOwner'>&{isSetupOwner:number}>(),
    ensurePersonalContainer(ctx,subject)
  ]);
  return {...member!,isSetupOwner:!!member!.isSetupOwner};
}
export async function listMembers(ctx:FeatureContext,kind:'member'|'guest') {
  const subject=await currentSubject(ctx); if(kind==='guest')await requireWorkspaceOwner(ctx); if(subject.isGuest) throw new ApiProblem(403,'FORBIDDEN','Guests cannot list workspace members.');
  return {items:(await ctx.db.prepare("SELECT id,display_name AS displayName,email,role,member_kind AS memberKind,theme,is_setup_owner AS isSetupOwner FROM members WHERE workspace_id=? AND member_kind=? AND status='active' ORDER BY display_name,id").bind(ctx.actor.workspaceId,kind).all<Omit<MemberView,'isSetupOwner'>&{isSetupOwner:number}>()).results.map(person=>({...person,isSetupOwner:!!person.isSetupOwner}))};
}
export async function setTheme(ctx:FeatureContext,input:{operationKey:string;theme:Theme}) {
  return commitOperation(ctx,{operationKey:input.operationKey,action:'member.theme',request:input,authorize:async()=>{await currentSubject(ctx)},prepare:async({revisionId})=>({entity:{id:ctx.actor.id,kind:'member',revisionId},value:{theme:input.theme},statements:[await identityRevision(ctx,revisionId,'member',ctx.actor.id,{theme:input.theme}),ctx.db.prepare('UPDATE members SET theme=?,updated_at=? WHERE id=?').bind(input.theme,ctx.now,ctx.actor.id)]})});
}
export async function removeMember(ctx:FeatureContext,input:{operationKey:string;memberId:string;erase?:boolean}) {
  const erasure=input.erase?beginImportErasure(ctx,input.operationKey):undefined;
  if(erasure)ctx=erasure.ctx;
  const authorize=async()=>{
    await currentSubject(ctx);
    const selfException=input.memberId===ctx.actor.id&&(input.erase||!!await ctx.db.prepare('SELECT id FROM members WHERE id=? AND is_setup_owner=1').bind(ctx.actor.id).first());
    if(!selfException)await requireWorkspaceOwner(ctx);
  };
  const result=await commitOperation(ctx,{commit:erasure?.commit,operationKey:input.operationKey,action:input.erase?'member.erase':'member.remove',request:input,authorize,prepare:async({revisionId})=>{
    const target=await ctx.db.prepare('SELECT email,is_setup_owner FROM members WHERE id=? AND workspace_id=?').bind(input.memberId,ctx.actor.workspaceId).first<{email:string;is_setup_owner:number}>();
    if(!target) throw new ApiProblem(404,'NOT_FOUND','Not found.');
    if(target.is_setup_owner&&input.memberId!==ctx.actor.id) throw new ApiProblem(403,'SETUP_OWNER','Only the setup owner can remove themselves.');
    const erasureContent=input.erase?await prepareEraseMemberContent(ctx,input.memberId):[];
    const statements=[
      ...erasureContent,
      removeMemberReviewAssignment(ctx,input.memberId),
      mutationGuard(ctx.db,"SELECT role!='owner' OR status!='active' OR (SELECT count(*) FROM members WHERE workspace_id=? AND role='owner' AND status='active')>1 FROM members WHERE id=?",[ctx.actor.workspaceId,input.memberId]),
      ctx.db.prepare("UPDATE members SET status='removed',is_setup_owner=0,updated_at=? WHERE id=?").bind(ctx.now,input.memberId),
      ctx.db.prepare('UPDATE sessions SET revoked_at=?,updated_at=? WHERE member_id=? AND revoked_at IS NULL').bind(ctx.now,ctx.now,input.memberId),
      ctx.db.prepare('UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND email=? AND accepted_by_member_id IS NULL').bind(ctx.now,ctx.actor.workspaceId,target.email),
      ctx.db.prepare("UPDATE mail_deliveries SET payload_ciphertext=NULL,next_attempt_at=NULL,lease_until=NULL,state=CASE WHEN state='sent' THEN state ELSE 'failed' END,delivery_phase=CASE WHEN state='sent' THEN delivery_phase ELSE 'cancelled' END,updated_at=? WHERE workspace_id=? AND (member_id=? OR requested_by_member_id=? OR lower(target_email)=lower(?))").bind(ctx.now,ctx.actor.workspaceId,input.memberId,input.memberId,target.email),
      // Keep referenced invitation/link grants as revoked history.
      ctx.db.prepare("UPDATE page_grants SET revoked_at=?,updated_at=? WHERE principal_kind='member' AND principal_id=?").bind(ctx.now,ctx.now,input.memberId),
      ctx.db.prepare("UPDATE container_grants SET revoked_at=?,updated_at=? WHERE principal_kind='member' AND principal_id=?").bind(ctx.now,ctx.now,input.memberId),
      ctx.db.prepare("UPDATE pages SET lifecycle='archived',archived_at=?,updated_at=?,revision_id=? WHERE container_id IN (SELECT c.id FROM containers c JOIN container_owners o ON o.container_id=c.id WHERE c.visibility='personal' AND o.member_id=?)").bind(ctx.now,ctx.now,revisionId,input.memberId),
      ctx.db.prepare("UPDATE containers SET archived_at=?,updated_at=?,revision_id=? WHERE visibility='personal' AND id IN (SELECT container_id FROM container_owners WHERE member_id=?)").bind(ctx.now,ctx.now,revisionId,input.memberId),
      ctx.db.prepare('UPDATE pages SET owner_member_id=NULL,updated_at=? WHERE owner_member_id=?').bind(ctx.now,input.memberId),
      ctx.db.prepare('DELETE FROM group_members WHERE member_id=?').bind(input.memberId),
      ctx.db.prepare('DELETE FROM container_members WHERE member_id=?').bind(input.memberId),
    ];
    if(input.erase) statements.push(ctx.db.prepare('DELETE FROM magic_links WHERE email=?').bind(target.email),ctx.db.prepare('DELETE FROM auth_proofs WHERE member_id=?').bind(input.memberId),ctx.db.prepare('DELETE FROM member_identity_bindings WHERE member_id=?').bind(input.memberId),ctx.db.prepare('DELETE FROM sessions WHERE member_id=?').bind(input.memberId),ctx.db.prepare("UPDATE members SET email=?,display_name='Deleted person',initials='?',updated_at=? WHERE id=?").bind(`erased-${input.memberId}@invalid`,ctx.now,input.memberId),ctx.db.prepare('UPDATE activity_entries SET actor_member_id=NULL WHERE actor_member_id=?').bind(input.memberId),ctx.db.prepare('UPDATE invitations SET email=? WHERE workspace_id=? AND email=?').bind(`erased-${input.memberId}@invalid`,ctx.actor.workspaceId,target.email),ctx.db.prepare('UPDATE mail_deliveries SET target_email=?,error_detail=NULL WHERE member_id=? OR target_email=?').bind(`erased-${input.memberId}@invalid`,input.memberId,target.email));
    statements.push(await identityRevision(ctx,revisionId,'member',input.memberId,{removed:true,erased:!!input.erase}));
    return {entity:{id:input.memberId,kind:'member',revisionId},value:{removed:true,erased:!!input.erase},statements};
  }});
  if(input.erase)await completeErasure(ctx);
  return result;
}
export async function setMemberRole(ctx:FeatureContext,input:{operationKey:string;memberId:string;expectedRole:'owner'|'member';role:'owner'|'member'}) {
 return commitOperation(ctx,{operationKey:input.operationKey,action:'member.role',request:input,authorize:()=>requireWorkspaceOwner(ctx),prepare:async({revisionId})=>({entity:{id:input.memberId,kind:'member',revisionId},value:{id:input.memberId,role:input.role},statements:[mutationGuard(ctx.db,"SELECT role=? AND status='active' AND member_kind='member' AND workspace_id=? FROM members WHERE id=?",[input.expectedRole,ctx.actor.workspaceId,input.memberId]),...(input.role==='member'?[mutationGuard(ctx.db,"SELECT role!='owner' OR (SELECT count(*) FROM members WHERE workspace_id=? AND role='owner' AND status='active')>1 FROM members WHERE id=?",[ctx.actor.workspaceId,input.memberId])]:[]),ctx.db.prepare('UPDATE members SET role=?,updated_at=? WHERE id=?').bind(input.role,ctx.now,input.memberId),await identityRevision(ctx,revisionId,'member',input.memberId,{role:input.role})]})});
}

/** Reusable native identity preparation, including Member-only commit guards and revision custody. */
export async function memberIdentityUpdateStatements(ctx:FeatureContext,revisionId:string,input:{memberId:string;email:string;displayName:string}) {
  const {personInitials}=await import('../../shared/person-identity');
  const email=input.email.trim().toLowerCase(),displayName=input.displayName.trim();
  if(!email||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!displayName||displayName.length>200)throw new ApiProblem(400,'INVALID_MEMBER_IDENTITY','Supply a valid email and personal name.');
  return [mutationGuard(ctx.db,"SELECT role='member' AND member_kind='member' AND workspace_id=? FROM members WHERE id=?",[ctx.actor.workspaceId,input.memberId]),ctx.db.prepare('UPDATE sessions SET revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE member_id=? AND (SELECT lower(email) FROM members WHERE id=?)!=?').bind(ctx.now,ctx.now,input.memberId,input.memberId,email),ctx.db.prepare('UPDATE members SET email=?,display_name=?,initials=?,updated_at=? WHERE id=?').bind(email,displayName,personInitials(displayName,email),ctx.now,input.memberId),await identityRevision(ctx,revisionId,'member',input.memberId,{email,displayName})];
}
/** Owner-managed Member identity changes use the native revision and session boundary. */
export async function updateMemberIdentity(ctx:FeatureContext,input:{operationKey:string;memberId:string;email:string;displayName:string}) {
  return commitOperation(ctx,{operationKey:input.operationKey,action:'member.identity',request:input,authorize:()=>requireWorkspaceOwner(ctx),prepare:async({revisionId})=>({entity:{id:input.memberId,kind:'member',revisionId},value:{id:input.memberId,email:input.email,displayName:input.displayName},statements:await memberIdentityUpdateStatements(ctx,revisionId,input)})});
}
