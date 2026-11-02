import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import { currentSubject, requireContainerLevel, requirePageLevel } from '../sharing/current-access';
import { createMemberRepository } from './repository';
import { version } from './native/store';
import { nativeSamlPolicy } from './saml/policy';
export interface MailRow {provider:string|null;id:string;workspace_id:string;kind:string;invitation_id:string|null;member_id:string|null;magic_link_id:string|null;payload_ciphertext:string|null;provider_key_digest:string|null;state:string;delivery_phase:string;attempt_count:number;cycle_attempt:number;cycle_started_at:string|null;first_attempted_at:string|null;lease_until:string|null;next_attempt_at:string|null;requested_by_member_id:string|null;error_detail:string|null;created_at:string;sent_at:string|null;target_email:string}
export type MailResources={files:R2Bucket;jobs:Queue<unknown>};
/** Re-resolve inviter and target authority on EVERY attempt, including a recovered lease. */
export async function mailAuthority(db:D1Database,row:MailRow,now:string,resources?:MailResources):Promise<number>{
 const epoch=(await db.prepare('SELECT epoch FROM core_acl_epoch WHERE id=1').first<{epoch:number}>())!.epoch;
 // A queued native sign-in keeps the same Base proof and provider request.
 // Retired legacy links have no matching native proof and remain cancelled.
 if(row.kind==='sign-in-link'){
  const live=await db.prepare(`SELECT 1 FROM auth_proofs r JOIN members m ON m.id=r.member_id WHERE r.id=? AND r.kind='magic' AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>? AND m.workspace_id=? AND m.status='active' AND lower(m.email)=r.email AND ${version('m')}=r.authority_version AND ${nativeSamlPolicy('m')}`).bind(row.id,Date.parse(now),row.workspace_id).first();
  if(!live)throw new ApiProblem(409,'MAIL_LINK_INACTIVE','The sign-in link is no longer active.');
  return epoch;
 }
  const invitation=await db.prepare('SELECT kind,page_id,container_id,page_grant_id,container_grant_id,invited_by_member_id FROM invitations WHERE id=? AND workspace_id=? AND accepted_by_member_id IS NULL AND revoked_at IS NULL AND expires_at>?').bind(row.invitation_id,row.workspace_id,now).first<{kind:string;page_id:string|null;container_id:string|null;page_grant_id:string|null;container_grant_id:string|null;invited_by_member_id:string}>();
  if(!invitation)throw new ApiProblem(409,'MAIL_LINK_INACTIVE','The invitation is no longer active.');
  const actor=await createMemberRepository(db).getMember(invitation.invited_by_member_id);
  if(!actor)throw new ApiProblem(409,'MAIL_AUTHORITY_REVOKED','The inviter is no longer active.');
  // Member invitations also recheck that the original inviter remains a full member.
  const ctx:FeatureContext={db,files:resources?.files as R2Bucket,jobs:resources?.jobs as Queue<unknown>,actor,now,authorizationEpoch:epoch};
  if((await currentSubject(ctx)).isGuest)throw new ApiProblem(409,'MAIL_AUTHORITY_REVOKED','The inviter can no longer invite.');
  if(await db.prepare("SELECT 1 FROM members WHERE workspace_id=? AND lower(email)=lower(?) AND status='active'").bind(row.workspace_id,row.target_email).first())throw new ApiProblem(409,'MAIL_LINK_INACTIVE','The recipient is already a member.');
  if(invitation.kind==='guest'){
   const table=invitation.page_id?'page_grants':'container_grants';if(!await db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND principal_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`).bind(invitation.page_grant_id??invitation.container_grant_id,`invitation:${row.invitation_id}`,now).first())throw new ApiProblem(409,'MAIL_LINK_INACTIVE','The pending grant was revoked.');
   if(invitation.page_id)await requirePageLevel(ctx,invitation.page_id,'full');
   else if(invitation.container_id)await requireContainerLevel(ctx,invitation.container_id,'full');
   else throw new ApiProblem(409,'MAIL_LINK_INACTIVE','The invitation has no target.');
   const allowed=await db.prepare("SELECT 1 FROM containers c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=COALESCE(?,(SELECT container_id FROM pages WHERE id=? AND deleted_at IS NULL AND trashed_at IS NULL)) AND c.visibility!='personal' AND c.trashed_at IS NULL AND c.archived_at IS NULL AND c.guest_access='allowed' AND w.guest_access='allowed'").bind(invitation.container_id,invitation.page_id).first();
   if(!allowed)throw new ApiProblem(409,'MAIL_AUTHORITY_REVOKED','Guest invitations are no longer allowed here.');
  }
 return epoch;
}
