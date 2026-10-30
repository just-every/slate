import type { FeatureContext } from '../core/app/feature-context';
import type { RuntimeConfig } from '../core/platform/config/runtime';
import { slateSessions } from '../core/features/session/auth';
import { createMemberRepository } from '../core/features/session/repository';
import { saveGrant } from '../core/features/sharing/grants';
import { createComment } from '../core/features/comments/service';
import { openRecent, setWatch } from '../core/features/navigation/service';
import { setFavourite } from '../core/features/navigation/favourites';

/** Populate the owner's actual navigation and inbox through ordinary commands. */
export async function seedActivity(ctx: FeatureContext, config: RuntimeConfig, containerId: string, databaseId: string) {
  for (const [position, pageId] of ['demo-launch', 'demo-decisions', 'demo-weekly'].entries()) {
    await openRecent(ctx, { operationKey: `demo:recent:${pageId}`, pageId });
    await setFavourite(ctx, { operationKey: `demo:favourite:${pageId}`, kind: 'page', id: pageId, enabled: true, position });
    await setWatch(ctx, { operationKey: `demo:watch:${pageId}`, pageId, enabled: true });
  }
  await setFavourite(ctx, { operationKey: 'demo:favourite:projects', kind: 'database', id: databaseId, enabled: true, position: 3 });
  const person = await slateSessions(ctx.db, config).member('lower(email)=?', 'maya.chen@demo.invalid');
  const actor = person && await createMemberRepository(ctx.db).getMember(person.id);
  if (!actor) throw new Error('Demo teammate is unavailable');
  await saveGrant(ctx, { operationKey: 'demo:team:handbook', targetKind: 'container', targetId: containerId, principalKind: 'workspace', principalId: ctx.actor.workspaceId, level: 'edit' });
  const teammate = { ...ctx, actor };
  await createComment(teammate, 'demo-launch', { operationKey: 'demo:comment:launch', body: [{ text: 'The support walkthrough is ready. Please add feedback before Thursday’s review.' }] });
  await createComment(teammate, 'demo-decisions', { operationKey: 'demo:comment:decisions', body: [{ text: 'We agreed to start with the onboarding improvements and measure activation after two weeks.' }] });
}
