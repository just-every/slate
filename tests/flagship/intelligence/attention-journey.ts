import { env } from 'cloudflare:test';
import { expect, vi } from 'vitest';
import { fixture } from './measured-fixture';
import { sessionDoor } from './run-flow';
import { consumeIntelligenceJob } from '../../../src/core/features/runs/worker';
import { notifyOverdueDecisions } from '../../../src/core/features/decisions/scheduler';
import type { AppBindings } from '../../../src/core/app/types';

/** Named review and decision recipients, actionable results, and current output audience. */
export async function attentionJourney() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2028-01-01T12:00:00.000Z'));
  try {
    const f = await fixture(), owner = await sessionDoor(f.owner), reader = await sessionDoor(f.reader);
    const key = () => crypto.randomUUID();
    async function ok(door: typeof owner, method: string, path: string, body?: unknown) {
      const response = await door(method, path, body);
      const data = await response.json<any>();
      expect(response.status, `${method} ${path}: ${JSON.stringify(data)}`).toBe(200);
      return data;
    }
    const notices = async (door = owner) => (await ok(door, 'GET', '/api/notifications')).items as any[];
    const answer = { statements: [{ text: 'The handoff remains open.', evidenceIds: ['E1'], kind: 'observation', limitations: [] }], unresolved: [], proposedChanges: [{ targetId: f.page.pageId, text: 'Confirm the handoff owner.', evidenceIds: ['E1'] }], researchPlan: null, hypothesisAssessment: null };
    let providerCalls=0;
    vi.stubGlobal('fetch', async () => { providerCalls++; return Response.json({ id: 'synthetic-slate-1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }], usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } }); });
    const runInput = { ...f.ask, operationKey: key() };
    const run = await ok(owner, 'POST', '/api/ai/ask', runInput);
    await ok(owner, 'POST', '/api/ai/ask', runInput);
    const job = { kind: 'intelligence.run', runId: run.value.id, workspaceId: f.workspaceId };
    await consumeIntelligenceJob({ ...env, AI_API_KEY: 'synthetic-slate-2' } as AppBindings, job);
    await consumeIntelligenceJob({ ...env, AI_API_KEY: 'synthetic-slate-2' } as AppBindings, job);
    expect((await notices()).filter(item => item.detail?.runId === run.value.id)).toMatchObject([{ event: 'run-review' }]);
    expect((await notices(reader)).filter(item => item.detail?.runId === run.value.id)).toEqual([]);
    expect((await ok(owner, 'GET', '/api/notifications/today')).decisions.some((item: any) => item.detail?.runId === run.value.id)).toBe(true);
    const currentRun = await ok(owner, 'GET', `/api/runs/${run.value.id}`);
    const pause = { operationKey: key(), expectedRevisionId: currentRun.revisionId, action: 'pause', reason: 'Owner is checking the handoff.' };
    await ok(owner, 'POST', `/api/runs/${run.value.id}/control`, pause);
    expect((await notices()).filter(item => item.detail?.runId === run.value.id), 'An owner pausing their own run adds no self notification.').toHaveLength(1);

    await ok(owner, 'POST', '/api/sharing', { operationKey: key(), id: f.readerGrant, targetKind: 'page', targetId: f.page.pageId, principalKind: 'member', principalId: f.reader, level: 'edit' });
    const input = { operationKey: key(), pageId: f.page.pageId, question: 'Who must approve the handoff?', options: ['Keep the current owner', 'Choose a new owner'], outcome: 'Keep the current owner', rationale: 'The named owner must decide before work proceeds.', ownerId: f.owner, decidedAt: null, reviewAt: '2028-01-02T12:00:00.000Z', citations: f.refs };
    const decision = await ok(reader, 'POST', '/api/decisions', input);
    await ok(reader, 'POST', '/api/decisions', input);
    expect((await notices()).filter(item => item.detail?.decisionId === decision.value.id)).toMatchObject([{ event: 'decision-required' }]);
    expect((await notices(reader)).filter(item => item.detail?.decisionId === decision.value.id)).toEqual([]);
    expect((await ok(owner, 'GET', '/api/notifications/today')).decisions.some((item: any) => item.detail?.decisionId === decision.value.id)).toBe(true);
    await ok(owner, 'POST', `/api/decisions/${decision.value.id}/accept`, { operationKey: key(), expectedRevisionId: decision.value.revisionId });
    vi.setSystemTime(new Date('2028-01-03T12:00:00.000Z'));
    await notifyOverdueDecisions(env as AppBindings, new Date().toISOString());
    await notifyOverdueDecisions(env as AppBindings, new Date().toISOString());
    expect((await notices()).filter(item => item.detail?.decisionId === decision.value.id), 'One initial decision and one overdue decision remain distinct.').toHaveLength(2);
    const accepted = await ok(owner, 'GET', `/api/decisions/${decision.value.id}`);
    await ok(owner, 'POST', `/api/decisions/${decision.value.id}/review`, { operationKey: key(), expectedRevisionId: accepted.revision_id, note: 'Owner reviewed the outstanding choice.', nextReviewAt: null });
    expect((await ok(owner, 'GET', '/api/notifications/today')).decisions.some((item: any) => item.detail?.decisionId === decision.value.id)).toBe(false);
    const pending=await ok(owner,'POST','/api/ai/ask',{...f.ask,operationKey:key(),question:'Prepare a second handoff review.'});
    // Current output audience is checked again even for retained Inbox history.
    await ok(owner, 'POST', '/api/sharing', { operationKey: key(), id: f.readerGrant, targetKind: 'page', targetId: f.page.pageId, principalKind: 'member', principalId: f.reader, level: 'edit', revoke: true });
    const replay={kind:'intelligence.run',runId:pending.value.id,workspaceId:f.workspaceId};
    await consumeIntelligenceJob({...env,AI_API_KEY:'synthetic-slate-2'} as AppBindings,replay);
    await consumeIntelligenceJob({...env,AI_API_KEY:'synthetic-slate-2'} as AppBindings,replay);
    expect(providerCalls).toBe(1);
    expect((await notices()).some(item=>item.detail?.runId===pending.value.id)).toBe(false);
    expect((await notices()).some(item => item.detail?.runId === run.value.id)).toBe(false);
    expect((await notices(reader)).some(item => item.pageId === f.page.pageId)).toBe(false);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}
