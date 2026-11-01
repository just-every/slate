import { env } from 'cloudflare:test';
import { test, expect, vi } from 'vitest';
import { reviewFixture } from './fixture';
import { sessionFor } from '../setup/fixtures';
import { createApi } from '../../../src/core/app/hono';
import { scheduledDiscovery } from '../../../src/core/features/notifications/jobs';
import type { AppBindings } from '../../../src/core/app/types';

// STAT-003 through the status route: the server sets 7/30/90-day expiries from its own
// clock, accepts a future date or none, refuses a past date and an unopened revision,
// and an edit afterwards shows the verified revision is not the current one.
test('Verifying offers 7, 30 or 90 days, a date or none, only on the opened revision, and an edit makes it not current', async () => {
  const f = await reviewFixture(env.DB), { request, sql, now } = f;
  let key = 0;
  const op = () => `verification-flow-${++key}`;
  const created = await request('owner', 'POST', '/api/pages', { operationKey: op(), containerId: 'c', title: 'Handbook flow page' });
  expect(created.status).toBe(200);
  const id = created.data.value.pageId as string;
  let revision = created.data.receipt.revisionId as string;
  const working = revision;
  const verify = (actor: string, body: Record<string, unknown>) => request(actor, 'POST', `/api/status/page/${id}`, { operationKey: op(), expectedRevisionId: revision, statusKey: 'verified', attestRevisionId: working, ...body });
  const current = async (actor = 'owner') => (await request(actor, 'GET', `/api/status/page/${id}`)).data.verification;

  // Not yet opened: the existing refusal, in plain words.
  const unopened = await verify('owner', { expiresInDays: 90 });
  expect(unopened.status).toBe(409);
  expect(unopened.data.code).toBe('REVISION_NOT_OPENED');
  expect((await request('owner', 'POST', `/api/pages/${id}/open`, { operationKey: op(), revisionId: working })).status).toBe(200);

  for (const days of [7, 30, 90]) {
    const response = await verify('owner', { expiresInDays: days });
    expect(response.status, `${days} days`).toBe(200);
    revision = response.data.receipt.revisionId;
    const v = await current();
    expect(Date.parse(v.expires_at) - Date.parse(v.created_at), `${days} days`).toBe(days * 86_400_000);
    expect(v).toMatchObject({ state: 'current', current: true, revision_id: working, owner_member_id: 'owner', verifier: { id: 'owner', active: true }, openedCurrent: true });
  }
  for (const [body, code] of [[{ expiresInDays: 45 }, 'INVALID_EXPIRY'], [{ expiresAt: '2000-01-01T00:00:00.000Z' }, 'INVALID_EXPIRY'], [{ expiresAt: new Date(Date.parse(now) - 1000).toISOString() }, 'INVALID_EXPIRY'], [{ expiresInDays: 7, expiresAt: '2099-01-01T00:00:00.000Z' }, 'INVALID_EXPIRY'], [{ expiresAt: 'tomorrow' }, 'INVALID_EXPIRY']] as const) {
    const refused = await verify('owner', body);
    expect(refused.status, JSON.stringify(body)).toBe(400);
    expect(refused.data.code, JSON.stringify(body)).toBe(code);
  }
  const dated = await verify('owner', { expiresAt: '2099-03-04T05:06:07+02:00' });
  expect(dated.status).toBe(200);
  revision = dated.data.receipt.revisionId;
  expect((await current()).expires_at).toBe('2099-03-04T03:06:07.000Z');
  const forever = await verify('owner', { expiresAt: null });
  expect(forever.status).toBe(200);
  revision = forever.data.receipt.revisionId;
  expect(await current()).toMatchObject({ expires_at: null, state: 'current' });

  // A second member edits; the page now says the verified revision is not the current one.
  await sql("INSERT INTO page_grants(id,page_id,principal_kind,principal_id,level,created_at,updated_at) VALUES('flow-editor',?,'member','reader','edit',?,?)", id, now, now);
  expect((await request('reader', 'GET', `/api/status/page/${id}`)).data.verification.openedCurrent).toBe(false);
  const edited = await request('reader', 'PATCH', `/api/pages/${id}`, { operationKey: op(), expectedRevisionId: revision, properties: { title: 'Handbook flow page, edited' } });
  expect(edited.status).toBe(200);
  const changed = await current();
  expect(changed).toMatchObject({ state: 'changed', current: false, lapsed: false, changedSince: true, revision_id: working, revisionsSince: 1, editorsSince: ['reader'] });
  expect(changed.workingRevisionId).not.toBe(working);
  const page = (await request('owner', 'GET', `/api/pages/${id}`)).data;
  expect(page.verification).toMatchObject({ state: 'changed', current: false, revisionId: working, ownerDisplayName: 'owner', ownerActive: true });
  // The verified revision still opens as committed and says a newer one exists (REV-005); compare works between them (REV-004).
  expect((await request('owner', 'GET', `/api/revisions/${id}/${working}`)).data).toMatchObject({ id: working, newerRevisionExists: true });
  const compared = await request('owner', 'GET', `/api/revisions/${id}/compare/${working}/${changed.workingRevisionId}`);
  expect(compared.status).toBe(200);
  expect(compared.data.properties.before.title).toBe('Handbook flow page');
  expect(compared.data.properties.after.title).toBe('Handbook flow page, edited');
  // The editor has not opened the new revision as a reader would, so attesting the old one is refused.
  revision = edited.data.receipt.revisionId;
  const stale = await verify('reader', { expiresInDays: 7 });
  expect(stale.status).toBe(409);
  expect(stale.data.code).toBe('EXACT_REVISION_REQUIRED');

  // STAT-006: a named review is actual work with its own generation and receipt.
  const dueDate = new Date(Date.parse(now) - 86400000).toISOString().slice(0, 10);
  const assignment = { assigneeKind: 'member', assigneeId: 'reader', date: dueDate, time: '09:00', timezone: 'UTC', note: 'Please check the handbook changes.' };
  const requestReview = async () => request('owner', 'POST', `/api/status/requests/page/${id}`, { operationKey: op(), expectedRevisionId: revision, ...assignment });
  const review = await requestReview();
  expect(review.status).toBe(200);
  const reviewId = review.data.value.id;
  const reviewCAS = { expectedRevisionId: review.data.value.revisionId, assignmentGeneration: review.data.value.assignmentGeneration };
  const assigned = await request('reader', 'GET', '/api/status/requests/queue?view=assigned');
  expect(assigned.data.items.find((i: any) => i.id === reviewId)).toMatchObject({ pageId: id, note: assignment.note, canVerify: true, openedCurrent: false });
  expect((await request('owner', 'GET', '/api/status/requests/queue?view=requested')).data.items.map((i: any) => i.id)).toContain(reviewId);
  expect((await request('reader', 'GET', '/api/notifications')).data.items.filter((i: any) => i.event === 'review-requested' && i.detail.reviewRequestId === reviewId)).toHaveLength(1);
  const finish = () => request('reader', 'POST', `/api/status/requests/${reviewId}/verify`, { operationKey: op(), ...reviewCAS, pageRevisionId: revision, attestRevisionId: changed.workingRevisionId, statusKey: 'verified', expiresInDays: 30 });
  expect((await finish()).data.code).toBe('REVISION_NOT_OPENED');
  expect((await request('reader', 'POST', `/api/pages/${id}/open`, { operationKey: op(), revisionId: changed.workingRevisionId })).status).toBe(200);
  const reviewed = await finish();
  expect(reviewed.status).toBe(200);
  revision = reviewed.data.receipt.revisionId;
  expect((await request('reader', 'GET', `/api/status/requests/${reviewId}`)).data.request.state).toBe('verified');
  expect((await current()).verifier.id).toBe('reader');
  expect((await request('reader', 'GET', '/api/status/requests/queue?view=assigned')).data.items.map((i: any) => i.id)).not.toContain(reviewId);

  // Requesting changes creates a native, replay-safe page comment in the same write.
  const changesReview = await requestReview(), changesId = changesReview.data.value.id;
  const changesInput = { operationKey: op(), expectedRevisionId: changesReview.data.value.revisionId, assignmentGeneration: 1, note: 'Correct the on-call escalation instructions.' };
  const changesRequested = await request('reader', 'POST', `/api/status/requests/${changesId}/changes`, changesInput);
  expect(changesRequested.status).toBe(200);
  expect((await request('reader', 'POST', `/api/status/requests/${changesId}/changes`, changesInput)).data.value.commentId).toBe(changesRequested.data.value.commentId);
  expect((await request('owner', 'GET', `/api/comments/page/${id}`)).text).toContain(changesInput.note);
  expect((await request('owner', 'GET', `/api/status/requests/${changesId}`)).data.request).toMatchObject({state: 'changes_requested', commentId: changesRequested.data.value.commentId});
  expect((await request('reader', 'POST', `/api/status/requests/${changesId}/changes`, {...changesInput, operationKey: op(), note: 'Stale request must not leave a comment.'})).status).toBe(409);
  expect((await request('owner', 'GET', `/api/comments/page/${id}`)).text).not.toContain('Stale request must not leave a comment.');

  // Public discovery scheduling issues each overdue stage once; owners wait 24 hours.
  const overdue = await requestReview(), overdueId = overdue.data.value.id;
  await scheduledDiscovery(env as AppBindings);
  await scheduledDiscovery(env as AppBindings);
  const reviewerNotices = (await request('reader', 'GET', '/api/notifications')).data.items;
  expect(reviewerNotices.filter((i: any) => i.event === 'review-overdue' && i.detail.reviewRequestId === overdueId)).toHaveLength(1);
  expect((await request('owner', 'GET', '/api/notifications')).data.items.filter((i: any) => i.event === 'review-escalated' && i.detail.reviewRequestId === overdueId)).toHaveLength(0);
  // Advance this durable reminder's timestamp rather than sleeping a day.
  await sql("UPDATE review_request_deliveries SET created_at=? WHERE request_id=? AND stage='reviewer'", new Date(Date.parse(now) - 25 * 3600000).toISOString(), overdueId);
  await scheduledDiscovery(env as AppBindings);
  await scheduledDiscovery(env as AppBindings);
  expect((await request('owner', 'GET', '/api/notifications')).data.items.filter((i: any) => i.event === 'review-escalated' && i.detail.reviewRequestId === overdueId)).toHaveLength(1);
  const cancelled = await requestReview(), cancelledId = cancelled.data.value.id;
  expect((await request('owner', 'POST', `/api/status/requests/${cancelledId}/cancel`, {operationKey: op(), expectedRevisionId: cancelled.data.value.revisionId, assignmentGeneration: 1})).status).toBe(200);
  await scheduledDiscovery(env as AppBindings);
  expect((await request('reader', 'GET', '/api/notifications')).data.items.filter((i: any) => i.detail.reviewRequestId === cancelledId)).toHaveLength(0);

  // Bulk attestation is still the same human/open/edit authority for every page.
  const unopenedBulk = await request('owner', 'POST', '/api/status/review/bulk-verify', {items: [{pageId: id, operationKey: op(), pageRevisionId: revision, attestRevisionId: changed.workingRevisionId, statusKey: 'verified'}]});
  expect(unopenedBulk.data.items[0]).toMatchObject({verified: false, code: 'REVISION_NOT_OPENED'});
  expect((await request('owner', 'POST', `/api/pages/${id}/open`, {operationKey: op(), revisionId: changed.workingRevisionId})).status).toBe(200);
  const bulk = await request('owner', 'POST', '/api/status/review/bulk-verify', {items: [{pageId: id, operationKey: op(), pageRevisionId: revision, attestRevisionId: changed.workingRevisionId, statusKey: 'verified'}]});
  expect(bulk.data.items).toEqual([{pageId: id, verified: true}]);
  await citationJourney(f);
}, 60_000);


/** Exact citations use native writes and current authority, with substitution only at the clock. */
async function citationJourney(f: Awaited<ReturnType<typeof reviewFixture>>) {
  const api=createApi(),origin=new URL(String(env.APP_URL)).origin;
  const request=async(actor:string,method:string,path:string,body?:unknown)=>{
    if(path.startsWith('/p/'))return f.request(actor,method,path,body);
    const response=await api.request(origin+path,{method,headers:{origin,...(actor==='anonymous'?{}:{cookie:f.cookies[actor]}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env);
    const text=await response.text();
    return {status:response.status,data:JSON.parse(text),text};
  };
  let sequence=0;
  const op=()=>`synthetic-slate-citation-${++sequence}`;
  const success=async(actor:string,method:string,path:string,body?:unknown)=>{
    const result=await request(actor,method,path,body);
    expect(result.status,result.text).toBe(200);
    return result.data;
  };
  const w=await success('owner','GET','/api/workspace');
  const settings={expectedRevisionId:w.revisionId,name:w.name,mark:w.mark,description:w.description,guestAccess:w.guestAccess,publicLinkAccess:'allowed',anonymousAccess:'allowed',policies:{...w.policies,'page.lifecycle.v1':'draft-then-publish'}};
  await success('owner','PUT','/api/workspace',{operationKey:op(),...settings});
  const container=await success('owner','GET','/api/containers/c');
  await success('owner','POST','/api/sharing/container-settings',{operationKey:op(),id:'c',expectedRevisionId:container.revisionId,visibility:container.visibility,guestAccess:'allowed',publicLinkAccess:'allowed',anonymousAccess:'allowed'});
  const created=await success('owner','POST','/api/pages',{operationKey:op(),containerId:'c',title:'Cited handbook',blocks:[{id:'synthetic-slate-cited-block',blockType:'paragraph',treePosition:'0',content:{text:[{text:'Committed citation body.'}]}}]});
  const id=created.value.pageId;
  let revision=created.receipt.revisionId;
  const share=async(principalId:string,level:string,extra={})=>success('owner','POST','/api/sharing',{operationKey:op(),targetKind:'page',targetId:id,principalKind:'member',principalId,level,...extra});
  await share('owner','full');
  const restricted=await success('owner','PUT',`/api/sharing/pages/${id}/inheritance`,{operationKey:op(),expectedRevisionId:revision,restricted:true});
  revision=restricted.receipt.revisionId;
  const published=await success('owner','POST',`/api/pages/${id}/publish`,{operationKey:op(),expectedRevisionId:revision});
  revision=published.receipt.revisionId;
  const snapshot=(await success('owner','GET',`/api/pages/${id}`)).publishedRevisionId;
  const readerGrant=await share('reader','view');
  const changed=await success('owner','PATCH',`/api/pages/${id}`,{operationKey:op(),expectedRevisionId:revision,properties:{title:'Working-only private title'}});
  const working=changed.value.revisionId;
  const card=await success('owner','GET',`/api/pages/${id}/link-card?revision=${snapshot}`);
  expect(card).toMatchObject({href:`/app/pages/${id}?revision=${snapshot}`,title:'Cited handbook'});
  const exact=await success('reader','GET',`/api/revisions/${id}/${snapshot}`);
  expect(exact).toMatchObject({id:snapshot,properties:{title:'Cited handbook'},newerRevisionExists:true});
  expect(exact.blocks[0].content.text).toEqual([{text:'Committed citation body.'}]);
  expect((await request('reader','GET',`/api/revisions/${id}/${working}`)).status).toBe(404);
  await share('reader','view',{id:readerGrant.value.id,revoke:true});
  const revoked=await request('reader','GET',`/api/revisions/${id}/${snapshot}`);
  expect(revoked.status).toBe(404);
  expect(revoked.text).not.toContain('Committed citation body.');
  const clock=Date.now();
  vi.useFakeTimers({toFake:['Date']});
  try {
    vi.setSystemTime(clock);
    await share('reader','view',{id:readerGrant.value.id,expiresAt:new Date(clock+60000).toISOString()});
    expect((await request('reader','GET',`/api/revisions/${id}/${snapshot}`)).status).toBe(200);
    vi.setSystemTime(clock+60001);
    const expired=await request('reader','GET',`/api/revisions/${id}/${snapshot}`);
    expect(expired.status).toBe(404);
    expect(expired.text).not.toContain('Committed citation body.');
  } finally { vi.useRealTimers(); }
  expect((await request('anonymous','GET',`/api/revisions/${id}/${snapshot}`)).status).toBe(401);
  expect((await request('anonymous','GET',`/p/cited-handbook?revision=${snapshot}`)).status).toBe(404);
  const current=await success('owner','GET',`/api/pages/${id}`);
  await success('owner','POST',`/api/publishing/${id}`,{operationKey:op(),expectedRevisionId:current.page.revisionId,host:'localhost:8787',slug:'cited-handbook',indexable:false});
  const publicRevision=await request('anonymous','GET',`/p/cited-handbook?revision=${snapshot}`);
  expect(publicRevision.status,publicRevision.text).toBe(200);
  expect(publicRevision.text).toContain('Committed citation body.');
  expect(publicRevision.text).toContain('A newer revision exists.');
  expect(publicRevision.text).not.toContain('Working-only private title');
  const privateRevision=await request('anonymous','GET',`/p/cited-handbook?revision=${working}`);
  expect(privateRevision.status).toBe(404);
  expect(privateRevision.text).not.toContain('Working-only private title');
  // A freshly proven native session authorizes deletion; no stale grant authorizes a replay.
  f.cookies.owner=await sessionFor('owner',{freshProof:true});
  await success('owner','POST',`/api/archive/${id}`,{operationKey:op(),expectedRevisionId:current.page.revisionId,action:'trash'});
  const refused=await request('owner','POST',`/api/archive/${id}/permanent-delete`,{operationKey:op(),confirmedPageIds:[]});
  expect(refused.status,refused.text).toBe(409);
  expect(refused.data.code).toBe('CONFIRM_CASCADE');
  await success('owner','POST',`/api/archive/${id}`,{operationKey:op(),expectedRevisionId:current.page.revisionId,action:'restore'});
  expect((await success('owner','GET',`/api/revisions/${id}/${snapshot}`)).blocks).toEqual(exact.blocks);
  await success('owner','POST',`/api/archive/${id}`,{operationKey:op(),expectedRevisionId:current.page.revisionId,action:'trash'});
  const deletion={operationKey:op(),confirmedPageIds:[id]};
  expect((await success('owner','POST',`/api/archive/${id}/permanent-delete`,deletion)).value.deletedPageIds).toEqual([id]);
  await success('owner','POST',`/api/archive/${id}/permanent-delete`,deletion);
  for(const path of [`/api/pages/${id}`,`/api/revisions/${id}/${snapshot}`,`/api/pages/${id}/link-card?revision=${snapshot}`]) {
    const tombstone=await request('owner','GET',path);
    expect(tombstone.status).toBe(404);
    expect(tombstone.data).toEqual({code:'PAGE_ERASED',message:'This record was permanently deleted.',details:{kind:'page',deletedAt:expect.any(String)}});
    expect(Number.isFinite(Date.parse(tombstone.data.details.deletedAt))).toBe(true);
  }
  const replay=await request('owner','PATCH',`/api/pages/${id}`,{operationKey:op(),expectedRevisionId:working,properties:{title:'Resurrected content'}});
  expect(replay.status).toBe(404);
  expect((await request('denied','GET',`/api/revisions/${id}/${snapshot}`)).data.code).toBe('NOT_FOUND');
  const erasedPublic=await request('anonymous','GET',`/p/cited-handbook?revision=${snapshot}`);
  expect(erasedPublic.status).toBe(404);
  expect(erasedPublic.text).not.toContain('Committed citation body.');
}
