import { batchRequestReads } from './read-batches';
import type { Context } from 'hono';
import type { AppEnvironment, AuthenticatedMember } from './types';
import { ApiProblem } from './problems';
/** `stepUp` makes every commit repeat the asking session's fresh Base step-up proof. */
export interface FeatureContext { appOrigin?:string; containerScopeIds?: readonly string[]; credentialGuard?: () => D1PreparedStatement; operationStatements?: { before: D1PreparedStatement[]; after: D1PreparedStatement[] }; db: D1Database; files: R2Bucket; jobs: Queue<unknown>; actor: AuthenticatedMember; now: string; localDevelopment?: boolean; preview?: boolean; authorizationEpoch?: number; sourceSecret?: string; contentOrigin?: 'historical-import'; stepUp?: { sessionId: string; since: number } }
export function featureContext(context: Context<AppEnvironment>): FeatureContext {
  const actor = context.get('member');
  if (!actor) throw new ApiProblem(401, 'UNAUTHENTICATED', 'A valid session is required.');
  const stepUp = context.get('stepUp');
  return { appOrigin:new URL(context.req.url).origin, db: batchRequestReads(context.env.DB), files: context.env.FILES, jobs: context.env.JOBS, actor, now: new Date().toISOString(), localDevelopment: context.get('runtimeConfig')?.localDevelopment === true, preview: context.get('runtimeConfig')?.preview === true, sourceSecret: context.env.CONNECTOR_CREDENTIALS_KEY, ...(stepUp ? { stepUp } : {}) };
}
