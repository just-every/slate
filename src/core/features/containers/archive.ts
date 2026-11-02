import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import { commitOperation, mutationGuard } from '../../app/operations';
import { requireContainerLevel } from '../sharing/current-access';
import { prepareArchivePage } from '../archive/service';
import {pageLockGuard} from '../pages/repository';
import type {PageRow} from '../pages/types';
import { createUlid } from '../../shared/ulid';
import { containerRevision } from './service';
export async function archiveContainer(ctx: FeatureContext, id: string, input: {
    operationKey: string;
    expectedRevisionId: string;
    restore?: boolean;
    reason?: string;
}) {
    return commitOperation(ctx, { operationKey: input.operationKey, action: input.restore ? 'containers.restore' : 'containers.archive', request: { id, ...input }, authorize: () => requireContainerLevel(ctx, id, 'full'), prepare: async ({ revisionId }) => {
            const container = await ctx.db.prepare('SELECT * FROM containers WHERE id=? AND workspace_id=?').bind(id, ctx.actor.workspaceId).first<Record<string, any>>();
            if (!container)
                throw new ApiProblem(404, 'NOT_FOUND', 'Not found.');
            if (container.visibility === 'personal')
                throw new ApiProblem(403, 'PERSONAL_CONTAINER_PROTECTED', 'Personal containers follow their member lifecycle.');
            const affected=(await ctx.db.prepare('SELECT * FROM pages WHERE container_id=? AND deleted_at IS NULL').bind(id).all<PageRow>()).results;
            if(affected.some(page=>page.locked_at))throw new ApiProblem(409,'PAGE_LOCKED','Unlock the pages in this space before changing its archive state.');
            const roots = (await ctx.db.prepare('SELECT id,revision_id FROM pages WHERE container_id=? AND parent_page_id IS NULL AND deleted_at IS NULL').bind(id).all<{
                id: string;
                revision_id: string;
            }>()).results;
            const statements = [...affected.map(page=>pageLockGuard(ctx,page)),mutationGuard(ctx.db, 'SELECT revision_id=? FROM containers WHERE id=?', [input.expectedRevisionId, id]), ctx.db.prepare('UPDATE containers SET archived_at=?,revision_id=?,updated_at=? WHERE id=?').bind(input.restore ? null : ctx.now, revisionId, ctx.now, id)];
            for (const p of roots) {
                const plan = await prepareArchivePage(ctx, p.id, { operationKey: `${input.operationKey}:${p.id}`, expectedRevisionId: p.revision_id, action: input.restore ? 'restore' : 'archive', reason: input.reason }, createUlid(), { restoringContainer: input.restore ? id : undefined });
                statements.push(...plan.statements);
            }
            statements.push(await containerRevision(ctx, id, revisionId, { ...container, archived_at: input.restore ? null : ctx.now }));
            return { statements, entity: { id, kind: 'container', revisionId }, value: { id, revisionId, archived: !input.restore },
                detail: { reason: input.reason ?? null, priorLocation: { workspaceId: container.workspace_id } } };
        } });
}
