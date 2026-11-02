import type { FeatureContext } from '../../app/feature-context';
import type { RuntimeConfig } from '../../platform/config/runtime';
import { currentSubject } from '../sharing/current-access';
import { ApiProblem } from '../../app/problems';
import { mailAuthority, type MailRow } from './mail-authority';
import { deliverIdentityMail, providerRetryDeadline, readMail } from './mail';
import { mutationGuard } from '../../app/operations';
export function mailStatus(row:MailRow,now:string){return {id:row.id,kind:row.kind,state:row.delivery_phase==='legacy'?row.state:row.delivery_phase==='retry'||row.delivery_phase==='pending'||row.delivery_phase==='sending'?'queued':row.delivery_phase,attemptCount:row.attempt_count,errorDetail:row.error_detail,nextAttemptAt:row.next_attempt_at,sentAt:row.sent_at,createdAt:row.created_at,invitationId:row.invitation_id,targetEmail:row.target_email,canRetry:row.kind==='invitation'&&row.delivery_phase==='failed'&&!!row.payload_ciphertext&&providerRetryDeadline(row)>Date.parse(now),canRevoke:row.kind==='invitation'&&!['cancelled','legacy'].includes(row.delivery_phase)};}
async function ownerOrInviter(ctx:FeatureContext,row?:MailRow){const subject=await currentSubject(ctx);if(subject.isGuest)throw new ApiProblem(403,'FORBIDDEN','Guests cannot manage mail.');const owner=!!await ctx.db.prepare("SELECT 1 FROM members WHERE id=? AND role='owner' AND status='active'").bind(ctx.actor.id).first();if(row&&(row.workspace_id!==ctx.actor.workspaceId||!owner&&row.requested_by_member_id!==ctx.actor.id))throw new ApiProblem(404,'NOT_FOUND','Not found.');return owner;}
export async function listIdentityMail(ctx:FeatureContext){const owner=await ownerOrInviter(ctx);const rows=await ctx.db.prepare(`SELECT * FROM mail_deliveries WHERE workspace_id=? ${owner?'':"AND kind='invitation' AND requested_by_member_id=?"} ORDER BY created_at DESC LIMIT 100`).bind(...(owner?[ctx.actor.workspaceId]:[ctx.actor.workspaceId,ctx.actor.id])).all<MailRow>();const items=[];for(const row of rows.results){const status=mailStatus(row,ctx.now);if(row.invitation_id){const active=!!await ctx.db.prepare('SELECT 1 FROM invitations WHERE id=? AND accepted_by_member_id IS NULL AND revoked_at IS NULL AND expires_at>?').bind(row.invitation_id,ctx.now).first();status.canRevoke=active&&owner;status.canRetry&&=active;}items.push(status);}return {items};}
export async function retryIdentityMail(ctx:FeatureContext,config:RuntimeConfig,id:string){const row=await readMail(ctx.db,id);if(!row)throw new ApiProblem(404,'NOT_FOUND','Not found.');await ownerOrInviter(ctx,row);await retryMail(ctx.db,config,row,ctx.now,ctx);return mailStatus((await readMail(ctx.db,id))!,ctx.now);}
export async function retryMail(db:D1Database,config:RuntimeConfig,row:MailRow,now:string,resources?:{files:R2Bucket;jobs:Queue<unknown>}){
 if(row.state==='sent')return;
 if(row.delivery_phase==='uncertain')throw new ApiProblem(409,'MAIL_UNCERTAIN','Provider acceptance is uncertain. Review the provider receipt before any new dispatch.');
 const epoch=await mailAuthority(db,row,now,resources);
 if(row.delivery_phase==='failed'){
  if(!mailStatus(row,now).canRetry)throw new ApiProblem(409,'MAIL_NOT_RECOVERABLE','The safe retry window has ended. Request a new link.');
  await db.batch([mutationGuard(db,'SELECT epoch=? FROM core_acl_epoch WHERE id=1',[epoch]),mutationGuard(db,"SELECT delivery_phase='failed' AND attempt_count=? FROM mail_deliveries WHERE id=?",[row.attempt_count,row.id]),db.prepare("UPDATE mail_deliveries SET state='queued',delivery_phase='pending',cycle_attempt=0,cycle_started_at=NULL,next_attempt_at=?,lease_until=NULL,updated_at=? WHERE id=?").bind(now,now,row.id)]);
 }
 await deliverIdentityMail(db,config,row.id,resources,now);
}
