import type { RuntimeConfig } from '../../platform/config/runtime';
import { identityMailer, MailDeliveryError } from '../../platform/mail';
import { deliverSendGridIdentity } from './mail-sendgrid';
import { holdUncertainMail } from './mail-uncertain';
import { ApiProblem } from '../../app/problems';
import { sessionDigest } from '../../platform/auth/token';
import { mutationGuard } from '../../app/operations';
import { mailAuthority, type MailRow, type MailResources } from './mail-authority';
import { openMailPayload, requireMailConfig } from './mail-admission';
export type { MailRow } from './mail-authority';
export const providerRetryDeadline=(row:MailRow)=>Date.parse(row.first_attempted_at??row.created_at)+23*3600000;
export async function readMail(db:D1Database,id:string){return db.prepare('SELECT * FROM mail_deliveries WHERE id=?').bind(id).first<MailRow>();}
/** One durable attempt. Cron resumes admission and expired leases. Identical provider
 * key/body are replayed only inside 23 hours of the first attempt (Resend retains
 * keys for 24 hours). A provider receipt means accepted, not inbox delivery. */
export async function deliverIdentityMail(db:D1Database,config:RuntimeConfig,id:string,resources?:MailResources,now=new Date().toISOString()){
 const row=await readMail(db,id);
 if(!row||['sent','cancelled','failed','legacy','uncertain'].includes(row.delivery_phase)||row.state==='sent'||(row.next_attempt_at&&row.next_attempt_at>now)||(row.lease_until&&row.lease_until>now))return;
 if((row.provider==='sendgrid'||row.provider==='rer')&&row.delivery_phase==='sending'){await holdUncertainMail(db,id,now,row.provider);return;}
 if(providerRetryDeadline(row)<=Date.parse(now)){
  await db.prepare("UPDATE mail_deliveries SET state='failed',delivery_phase='failed',error_detail='Provider receipt is uncertain; the safe retry window has ended. Request a new link.',payload_ciphertext=NULL,next_attempt_at=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state!='sent'").bind(now,id).run();return;
 }
 if(row.cycle_attempt>=3){await db.prepare("UPDATE mail_deliveries SET state='failed',delivery_phase='failed',error_detail='Provider receipt remains unconfirmed after three attempts. Retry explicitly.',lease_until=NULL,next_attempt_at=NULL,updated_at=? WHERE id=? AND state!='sent'").bind(now,id).run();return;}
 let epoch:number;
 try{epoch=await mailAuthority(db,row,now,resources);}catch(cause){
  if(!(cause instanceof ApiProblem))throw cause;
  await db.prepare("UPDATE mail_deliveries SET state='failed',delivery_phase='cancelled',error_detail='The link or invitation authority is no longer active.',payload_ciphertext=NULL,next_attempt_at=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state!='sent'").bind(now,id).run();return;
 }
 const lease=new Date(Date.parse(now)+60000).toISOString();
 const attempt=row.attempt_count+1,cycle=row.cycle_attempt+1;
 const recoveryAt=cycle<3?new Date(Date.parse(row.cycle_started_at??now)+cycle*150000).toISOString():lease;
 try{await db.batch([
  mutationGuard(db,'SELECT epoch=? FROM core_acl_epoch WHERE id=1',[epoch]),
  mutationGuard(db,"SELECT state!='sent' AND delivery_phase IN ('pending','retry','sending') AND attempt_count=? AND (lease_until IS NULL OR lease_until<=?) AND (next_attempt_at IS NULL OR next_attempt_at<=?) FROM mail_deliveries WHERE id=?",[row.attempt_count,now,now,id]),
  db.prepare("UPDATE mail_deliveries SET delivery_phase='sending',attempt_count=attempt_count+1,cycle_attempt=cycle_attempt+1,cycle_started_at=COALESCE(cycle_started_at,?),first_attempted_at=COALESCE(first_attempted_at,?),last_attempted_at=?,lease_until=?,next_attempt_at=?,updated_at=? WHERE id=?").bind(now,now,now,lease,recoveryAt,now,id),
 ]);}catch(cause){if(String(cause).includes('core_write_guards')||String(cause).includes('CHECK constraint'))return;throw cause;}
 try{
  requireMailConfig(config);
  if(row.provider_key_digest!==await sessionDigest(config.sessionSecret,`mail-provider:${config.mailApiKey}`))throw new ApiProblem(409,'MAIL_PROVIDER_CHANGED','Restore the admitted mail provider credentials before retrying this message.');
  if(row.provider!==config.mailProvider)throw new ApiProblem(409,'MAIL_PROVIDER_CHANGED','Restore the admitted mail provider before retrying.');
  const payload=await openMailPayload(config,row);
  if(config.mailProvider==='sendgrid'){await deliverSendGridIdentity(db,config,row,payload,attempt,now);return;}
  const sent=await identityMailer(config,db,payload.from).send({...payload,idempotencyKey:`slate-mail:${id}`});
  await db.prepare("UPDATE mail_deliveries SET state='sent',delivery_phase='sent',provider_message_id=?,sent_at=?,updated_at=?,lease_until=NULL,next_attempt_at=NULL,payload_ciphertext=NULL,error_detail=NULL WHERE id=? AND attempt_count=? AND delivery_phase='sending'").bind(sent.id,now,now,id,attempt).run();
 }catch(cause){
  // Retain HTTP status/category, never an untrusted body or exception containing links.
  if(row.provider==='sendgrid'&&!(cause instanceof ApiProblem)){await holdUncertainMail(db,id,now,'sendgrid');return;}
  const status=cause instanceof MailDeliveryError?cause.status:null;
  if(row.provider==='rer'&&!(cause instanceof ApiProblem)&&(!(cause instanceof MailDeliveryError)||cause.retryable&&status!==429)){
   await holdUncertainMail(db,id,now,'rer');return;
  }
  const transient=!(cause instanceof ApiProblem)&&(!(cause instanceof MailDeliveryError)||cause.retryable)&&(status===null||status===409||status===429||status>=500||status<300);
  const retry=transient&&cycle<3;
  const provider=row.provider==='rer'?'RER mail relay':'Resend';
  const detail=(row.provider==='rer'?'Managed mail could not send this email. Check mail in your Run Edit Run hosting settings. ':'')+(cause instanceof ApiProblem?`${cause.code}: delivery configuration/custody unavailable`:status?`${provider} HTTP ${status}: ${transient?'delivery not confirmed':'request rejected'}`:`${provider} transport or receipt persistence failure: delivery not confirmed`);
  const retryAfter=cause instanceof MailDeliveryError?cause.retryAfterSeconds??0:0;
  const next=retry?new Date(Math.max(Date.parse(row.cycle_started_at??now)+cycle*150000,Date.parse(now)+retryAfter*1000)).toISOString():null;
  await db.prepare("UPDATE mail_deliveries SET state=?,delivery_phase=?,error_detail=?,next_attempt_at=?,lease_until=NULL,failed_at=?,updated_at=? WHERE id=? AND attempt_count=? AND delivery_phase='sending'").bind(retry?'queued':'failed',retry?'retry':'failed',detail,next,now,now,id,attempt).run();
 }
}
export async function scheduleIdentityMail(db:D1Database,config:RuntimeConfig,resources?:MailResources,now=new Date().toISOString()){
 const rows=await db.prepare("SELECT id FROM mail_deliveries WHERE delivery_phase IN ('pending','retry','sending') AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at LIMIT 100").bind(now,now).all<{id:string}>();
 for(let i=0;i<rows.results.length;i+=5){const results=await Promise.allSettled(rows.results.slice(i,i+5).map(row=>deliverIdentityMail(db,config,row.id,resources,now)));if(results.some(r=>r.status==='rejected'))throw new Error('Identity mail dispatch failed; durable commands remain pending.');}
}
