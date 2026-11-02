import type { MailSender } from '../../../../modules/operator-auth/index.mjs';
import { createMailSender } from '../../../../modules/mail/src/sender.mjs';
import type { RuntimeConfig } from '../../platform/config/runtime';
import { TENANT } from './native/store';
import { encryptSecret } from '../../platform/secrets/custody';
import { mailKey, mailScope } from './mail-admission';
import { sessionDigest } from '../../platform/auth/token';
import { deliverIdentityMail, readMail } from './mail';

export interface SignInDelivery { requestDigest?: string; failure?: string; uncertain?: boolean }

/**
 * Base Mail for Base's email links. A requested sign-in also records its
 * accepted or refused delivery, keyed by the requester's status digest, so the
 * sign-in screen and the owner's mail list keep reporting provider outcomes.
 */
export function identityMailSender(db: D1Database, config: RuntimeConfig, delivery: SignInDelivery): MailSender | undefined {
  if (!config.mailProvider) return undefined;
  const sender = createMailSender(config.mailProvider === 'development'
    ? { provider: 'development', mode: 'development' }
    : { provider: config.mailProvider, mode: 'production', apiKey: config.mailApiKey, ...(config.mailProvider === 'rer' ? {relayUrl: config.mailRelayUrl} : {}) });
  async function record(id: string, to: string, result: { status: string; providerMessageId: string | null; code?: string } | null) {
    const sent = result?.status === 'accepted' || result?.status === 'development';
    delivery.failure = sent ? undefined : config.mailProvider === 'rer'
      ? 'Managed mail could not send this email. Check mail in your Run Edit Run hosting settings'
      : `${config.mailProvider} ${result?.status ?? 'transport failure'}${result?.code ? `: ${result.code}` : ''}`;
    if (!delivery.requestDigest) return;
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('DELETE FROM mail_deliveries WHERE request_digest=?').bind(delivery.requestDigest),
      db.prepare(`INSERT INTO mail_deliveries (id,workspace_id,kind,target_email,member_id,state,attempt_count,provider,provider_message_id,error_detail,first_attempted_at,last_attempted_at,sent_at,failed_at,created_at,updated_at,request_digest,delivery_phase)
        SELECT ?,${TENANT},'sign-in-link',?,(SELECT id FROM members WHERE workspace_id=${TENANT} AND lower(email)=?),?,1,?,?,?,?,?,?,?,?,?,?,?`)
        .bind(id, to, to, sent ? 'sent' : 'failed', config.mailProvider!, result?.providerMessageId ?? null, delivery.failure ?? null, now, now, sent ? now : null, sent ? null : now, now, now, delivery.requestDigest, sent ? 'sent' : 'failed'),
    ]);
  }
  return {
    async send(message) {
      if (delivery.requestDigest && config.mailProvider !== 'development') {
        const now = new Date().toISOString();
        const proof = await db.prepare(`SELECT r.member_id,m.workspace_id FROM auth_proofs r JOIN members m ON m.id=r.member_id WHERE r.id=? AND m.workspace_id=${TENANT}`).bind(message.deliveryId).first<{member_id:string;workspace_id:string}>();
        if (!proof) throw new Error('Sign-in proof is unavailable.');
        const payload = await encryptSecret(await mailKey(config), JSON.stringify({from:message.from,to:message.to[0],subject:message.subject,text:message.text,...(message.html?{html:message.html}:{})}), mailScope(proof.workspace_id,message.deliveryId));
        await db.prepare(`INSERT INTO mail_deliveries (id,workspace_id,kind,target_email,member_id,state,created_at,updated_at,payload_ciphertext,request_digest,next_attempt_at,provider_key_digest,provider,delivery_phase)
          VALUES (?,?,'sign-in-link',?,?,'queued',?,?,?,?,?,?,?,'pending')`).bind(message.deliveryId,proof.workspace_id,message.to[0]!,proof.member_id,now,now,payload,delivery.requestDigest,now,await sessionDigest(config.sessionSecret,`mail-provider:${config.mailApiKey}`),config.mailProvider!).run();
        await deliverIdentityMail(db,config,message.deliveryId,undefined,now);
        const row = (await readMail(db,message.deliveryId))!;
        delivery.failure = row.error_detail ?? undefined;
        delivery.uncertain = row.delivery_phase === 'uncertain';
        // Base retains the proof while Slate owns a durable queued command.
        // Only the public delivery status reports provider acceptance to a person.
        return {provider:config.mailProvider!,status:row.delivery_phase==='sent'||row.state==='queued'?'accepted':delivery.uncertain?'uncertain':'rejected',providerMessageId:row.delivery_phase==='sent'?await db.prepare('SELECT provider_message_id FROM mail_deliveries WHERE id=?').bind(row.id).first<string>('provider_message_id'):null};
      }
      let result;
      try { result = await sender.send(message); }
      catch (cause) { await record(message.deliveryId, message.to[0]!, null); throw cause; }
      await record(message.deliveryId, message.to[0]!, result);
      return result;
    },
  };
}
