import { env } from 'cloudflare:test';
import { expect } from 'vitest';
import { followingFixture } from './following-support';
import { runContentJobs } from '../../../src/core/features/lifecycle/jobs';
import { scheduledDiscovery } from '../../../src/core/features/notifications/jobs';
import type { AppBindings } from '../../../src/core/app/types';

/** Public wiki triggers, recipient suppression, delivery replay and Inbox actions. */
export async function meaningfulNotifications(f: Awaited<ReturnType<typeof followingFixture>>) {
  const { owner, editor, commenter, key } = f;
  const container = (await f.ok(owner, 'POST', '/api/containers', { operationKey: key(), name: 'Notification workspace', visibility: 'private' })).value.id;
  const grant = { operationKey: key(), targetKind: 'container', targetId: container, principalKind: 'member', principalId: editor, level: 'edit' };
  await f.ok(owner, 'POST', '/api/sharing', grant);
  await f.ok(owner, 'POST', '/api/sharing', grant);
  const containerNotices = (await f.ok(editor, 'GET', '/api/notifications')).items.filter((item: any) => item.containerId === container);
  expect(containerNotices).toMatchObject([{ event: 'access-granted', href: `/app/containers/${container}` }]);
  const pageId = (await f.ok(owner, 'POST', '/api/pages', { operationKey: key(), containerId: container, title: 'Meaningful notification source' })).value.pageId;
  const pageGrantInput = { operationKey: key(), targetKind: 'page', targetId: pageId, principalKind: 'member', principalId: commenter, level: 'comment' };
  const pageGrant = await f.ok(owner, 'POST', '/api/sharing', pageGrantInput);
  await f.ok(owner, 'POST', '/api/sharing', pageGrantInput);
  expect((await f.inbox(commenter)).filter(item => item.pageId === pageId)).toMatchObject([{ event: 'access-granted' }]);
  await f.watch(commenter, pageId, true);
  const commentInput = { operationKey: key(), body: [
    { text: 'Please inspect this change. ' },
    { text: 'Colleague', mention: { kind: 'person', id: commenter, label: 'Colleague' } },
    { text: 'Owner', mention: { kind: 'person', id: owner, label: 'Owner' } },
  ] };
  const comment = await f.ok(owner, 'POST', `/api/comments/page/${pageId}`, commentInput);
  await f.ok(owner, 'POST', `/api/comments/page/${pageId}`, commentInput);
  expect((await f.inbox(commenter)).filter(item => item.pageId === pageId).map(item => item.event).sort()).toEqual(['access-granted', 'comment', 'mention']);
  expect((await f.inbox(owner)).filter(item => item.pageId === pageId)).toEqual([]);
  const replyInput = { operationKey: key(), threadId: comment.value.threadId, parentCommentId: comment.value.id, body: [{ text: 'I checked the change.' }] };
  await f.ok(commenter, 'POST', `/api/comments/page/${pageId}`, replyInput);
  await f.ok(commenter, 'POST', `/api/comments/page/${pageId}`, replyInput);
  expect((await f.inbox(owner)).filter(item => item.pageId === pageId)).toMatchObject([{ event: 'reply' }]);
  expect((await f.inbox(commenter)).some(item => item.pageId === pageId && item.event === 'reply')).toBe(false);
  for (let round = 0; round < 2; round++) {
    let document = await f.ok(owner, 'GET', `/api/pages/${pageId}`);
    if (round) {
      await f.ok(owner, 'PATCH', `/api/pages/${pageId}`, { operationKey: key(), expectedRevisionId: document.page.revisionId, properties: { title: 'Republished notification source' } });
      document = await f.ok(owner, 'GET', `/api/pages/${pageId}`);
    }
    const input = { operationKey: key(), expectedRevisionId: document.page.revisionId };
    await f.ok(owner, 'POST', `/api/pages/${pageId}/publish`, input);
    await f.ok(owner, 'POST', `/api/pages/${pageId}/publish`, input);
  }
  expect((await f.inbox(commenter)).filter(item => item.pageId === pageId && item.event === 'published')).toHaveLength(2);

  await f.ok(owner, 'POST', '/api/status', { operationKey: key(), key: 'reviewed', label: 'Reviewed', color: '#336699', requiresVerification: true });
  const document = await f.ok(owner, 'GET', `/api/pages/${pageId}`);
  await f.ok(owner, 'POST', `/api/pages/${pageId}/open`, { operationKey: key(), revisionId: document.workingRevisionId });
  await f.ok(owner, 'POST', `/api/status/page/${pageId}`, { operationKey: key(), expectedRevisionId: document.page.revisionId, statusKey: 'reviewed', attestRevisionId: document.workingRevisionId, expiresInDays: 7 });
  // Clock fixture only: the verification itself was attested through its public door.
  await env.DB.prepare('UPDATE page_verifications SET expires_at=? WHERE page_id=?').bind('2000-01-01T00:00:00.000Z', pageId).run();
  await runContentJobs(env as AppBindings);
  await runContentJobs(env as AppBindings);
  await scheduledDiscovery(env as AppBindings);
  expect((await f.inbox(owner)).filter(item => item.pageId === pageId && item.event === 'verification-lapsed')).toHaveLength(1);

  const direct = await f.ok(commenter, 'GET', '/api/notifications?audience=direct');
  const watched = await f.ok(commenter, 'GET', '/api/notifications?audience=watched');
  const mentioned = direct.items.find((item: any) => item.pageId === pageId && item.event === 'mention');
  expect(mentioned).toBeTruthy();
  expect(watched.items.some((item: any) => item.pageId === pageId && item.event === 'published')).toBe(true);
  const read = await f.ok(commenter, 'POST', '/api/notifications/actions', { operationKey: key(), action: 'read', id: mentioned.id });
  expect(read.value.href).toBe(`/app/pages/${pageId}?comment=${comment.value.id}`);
  expect((await f.ok(commenter, 'GET', '/api/notifications')).items.find((item: any) => item.id === mentioned.id).readAt).toBeTruthy();
  await f.ok(commenter, 'POST', '/api/notifications/actions', { operationKey: key(), action: 'read-all' });
  expect((await f.ok(commenter, 'GET', '/api/notifications')).unreadCount).toBe(0);
  await f.ok(commenter, 'POST', '/api/notifications/actions', { operationKey: key(), action: 'archive-read' });
  expect((await f.inbox(commenter)).filter(item => item.pageId === pageId)).toEqual([]);
  expect((await f.ok(commenter, 'GET', '/api/notifications?archived=true')).items.some((item: any) => item.pageId === pageId)).toBe(true);
  await f.ok(owner, 'POST', '/api/sharing', { ...pageGrantInput, operationKey: key(), id: pageGrant.value.id, revoke: true });
  await f.ok(owner, 'POST', `/api/comments/page/${pageId}`, { ...commentInput, operationKey: key() });
  await scheduledDiscovery(env as AppBindings);
  await scheduledDiscovery(env as AppBindings);
  expect((await f.inbox(commenter)).some(item => item.pageId === pageId)).toBe(false);
  expect((await f.ok(commenter, 'GET', '/api/notifications?archived=true')).items.some((item: any) => item.pageId === pageId)).toBe(false);
  expect((await f.request(commenter, 'POST', '/api/notifications/actions', { operationKey: key(), action: 'read', id: mentioned.id })).status).toBe(404);
  await f.ok(owner, 'POST', '/api/members/remove', { operationKey: key(), memberId: commenter, erase: true });
  await scheduledDiscovery(env as AppBindings);
  await scheduledDiscovery(env as AppBindings);
  expect((await f.request(commenter, 'GET', '/api/notifications')).status).toBe(401);
}
