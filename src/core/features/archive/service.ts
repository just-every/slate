import {beginImportErasure} from '../imports/retire-custody';
import {completeErasure} from './erasure-cleanup';
import {currentSubject} from '../sharing/current-access';
import { prepareErasePages } from './erasure';
import { preparePurgePageStatements } from '../ai/erasure';
import { prepareDeleteStructuredPages } from '../databases/content-plan';
import { discoveryPurgePageStatements } from '../notifications/purge';
import type { FeatureContext } from '../../app/feature-context';
import { commitOperation } from '../../app/operations';
import { ApiProblem } from '../../app/problems';
import { createUlid } from '../../shared/ulid';
import { requirePageLevel } from '../sharing/current-access';
import { pageRow, pageLockGuard, unlocked, contentEvent } from '../pages/repository';
import { treeTopologyGuard } from '../pages/tree-order';
import { creationDestinationGuards } from '../pages/service';
import { descendants, relocationAudienceChanges } from '../pages/tree';
import { publicMoveChanges } from '../pages/tree-access';
import { destination } from '../pages/service';
export async function archivePage(ctx: FeatureContext, id: string, input: {
    operationKey: string;
    expectedRevisionId: string;
    action: 'archive' | 'trash' | 'restore';
    reason?: string;
    containerId?: string;
    parentPageId?: string | null;
}) { return commitOperation(ctx, { operationKey: input.operationKey, action: `archive.${input.action}`, request: { id, ...input }, authorize: async () => { await requirePageLevel(ctx, id, 'edit', { includeTrashed: true }); }, prepare: ({ revisionId }) => prepareArchivePage(ctx, id, input, revisionId) }); }
export async function prepareArchivePage(ctx: FeatureContext, id: string, input: {
    operationKey: string;
    expectedRevisionId: string;
    action: 'archive' | 'trash' | 'restore';
    reason?: string;
    containerId?: string;
    parentPageId?: string | null;
}, revisionId: string, options: {
    restoringContainer?: string;
} = {}) {
    const pages = await descendants(ctx, id), root = pages.find(p => p.id === id)!;
    const statements = [await treeTopologyGuard(ctx, id), pageLockGuard(ctx, root, input.expectedRevisionId)];
    if (input.action === 'restore' && (input.containerId !== undefined || input.parentPageId !== undefined)) {
        // Restoring somewhere else is a move: changing who can read requires sharing authority over every affected page.
        const overrides: Record<string, { containerId: string; parentPageId: string | null }> = {};
        for (const p of pages) {
            const prior = await ctx.db.prepare('SELECT prior_container_id,prior_parent_id FROM content_archive_locations WHERE page_id=?').bind(p.id).first<{ prior_container_id: string; prior_parent_id: string | null }>();
            if (prior) overrides[p.id] = { containerId: input.containerId ?? prior.prior_container_id, parentPageId: p.id === id && input.parentPageId !== undefined ? input.parentPageId : prior.prior_parent_id };
        }
        const exposure = input.containerId === undefined ? null : await publicMoveChanges(ctx, pages, input.containerId);
        for (const pageId of new Set([...exposure?.changes ?? [], ...await relocationAudienceChanges(ctx, pages, overrides, { includeTrashed: true })].map(change => change.pageId)))
            await requirePageLevel(ctx, pageId, 'full', { includeTrashed: true });
        if (exposure) statements.push(exposure.guard);
    }
    for (const p of pages) {
        await requirePageLevel(ctx, p.id, 'edit', { includeTrashed: true });
        unlocked(p);
        if (p.id !== id) statements.push(pageLockGuard(ctx, p));
        if (input.action === 'restore') {
            const prior = await ctx.db.prepare('SELECT * FROM content_archive_locations WHERE page_id=?').bind(p.id).first<Record<string, any>>();
            if (!prior)
                continue;
            const containerId = input.containerId ?? prior.prior_container_id, parentId = p.id === id ? (input.parentPageId === undefined ? prior.prior_parent_id : input.parentPageId) : prior.prior_parent_id;
            if (p.id === id && parentId && pages.some(q => q.id === parentId))
                throw new ApiProblem(400, 'TREE_CYCLE', 'A page cannot be its own descendant.');
            if (options.restoringContainer !== containerId)
                await destination(ctx, containerId, parentId && pages.some(q => q.id === parentId) ? null : parentId);
            if (options.restoringContainer !== containerId) statements.push(...await creationDestinationGuards(ctx, containerId, parentId && pages.some(q => q.id === parentId) ? null : parentId));
            statements.push(ctx.db.prepare('UPDATE pages SET archived_at=NULL,trashed_at=NULL,lifecycle=?,container_id=?,parent_page_id=?,tree_position=?,updated_at=? WHERE id=?').bind(prior.prior_lifecycle, containerId, parentId, prior.prior_position, ctx.now, p.id), ctx.db.prepare('DELETE FROM content_archive_locations WHERE page_id=?').bind(p.id));
        }
        else {
            statements.push(ctx.db.prepare('INSERT INTO content_archive_locations VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(page_id) DO NOTHING').bind(p.id, p.parent_page_id, p.container_id, p.tree_position, p.lifecycle, input.action, ctx.actor.id, input.reason ?? null, ctx.now), ctx.db.prepare(input.action === 'archive' ? "UPDATE pages SET archived_at=?,lifecycle='archived',updated_at=? WHERE id=?" : 'UPDATE pages SET trashed_at=?,updated_at=? WHERE id=?').bind(ctx.now, ctx.now, p.id));
        }
        statements.push(...contentEvent(ctx, p.id, p.revision_id, input.action, {}, [p.container_id]));
    }
    return { statements, entity: { id, kind: 'page', revisionId: root.revision_id }, value: { pageId: id, revisionId: root.revision_id, action: input.action },
        detail: { reason: input.reason ?? null, priorLocation: { containerId: root.container_id, parentPageId: root.parent_page_id, position: root.tree_position } } };
}
export async function permanentDeletePage(ctx: FeatureContext, id: string, input: {
    operationKey: string;
    confirmedPageIds: string[];
}) {
    const erasure=beginImportErasure(ctx,input.operationKey);ctx=erasure.ctx;
    const result = await commitOperation(ctx, { commit:erasure.commit, operationKey: input.operationKey, action: 'archive.permanent-delete', request: { id, ...input }, authorize: async () => {
            await currentSubject(ctx);
            const replay=await ctx.db.prepare("SELECT 1 FROM operation_receipts WHERE workspace_id=? AND actor_member_id=? AND operation_key=? AND target_id=? AND target_kind='page'").bind(ctx.actor.workspaceId,ctx.actor.id,input.operationKey,id).first();
            if(!replay)await requirePageLevel(ctx, id, 'full', { includeTrashed: true });
        }, prepare: async ({ revisionId }) => {
            const pages = await descendants(ctx, id);
            const expected = pages.map(p => p.id).sort();
            if (JSON.stringify([...input.confirmedPageIds].sort()) !== JSON.stringify(expected))
                throw new ApiProblem(409, 'CONFIRM_CASCADE', 'Confirm every page to be destroyed.', { pageIds: expected });
            const statements: D1PreparedStatement[] = [];
            for (const p of pages) {
                await requirePageLevel(ctx, p.id, 'full', { includeTrashed: true });
                if (!p.trashed_at)
                    throw new ApiProblem(409, 'NOT_TRASHED', 'Only trash can be permanently deleted.');
            }
            statements.push(...await prepareErasePages(ctx, expected));
            return { statements, entity: { id, kind: 'page', revisionId }, value: { deletedPageIds: expected } };
        } });
    await completeErasure(ctx);
    return result;
}
