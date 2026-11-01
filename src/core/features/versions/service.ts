import { rejectErasedPage } from '../pages/erased';
import {projectSynced} from '../editor/synced/read';
import { labelForReader } from '../pages/mentions';
import { filterRecordProperties } from '../databases/property-access';
import type { FeatureContext } from '../../app/feature-context';
import { commitOperation } from '../../app/operations';
import { ApiProblem } from '../../app/problems';
import { requirePageLevel } from '../sharing/current-access';
import { pageRow, revisionRow, pageGuard, writable } from '../pages/repository';
import { contentPolicy } from '../pages/policy';
import { restorePageContent } from '../lifecycle/service';
export async function revisionHistory(ctx: FeatureContext, pageId: string) {
    await rejectErasedPage(ctx,pageId);
    const access = await requirePageLevel(ctx, pageId, 'view');
    const editor = access.decision.level === 'edit' || access.decision.level === 'full';
    return (await ctx.db.prepare("SELECT r.id,r.origin,r.author_member_id AS authorMemberId,COALESCE(m.display_name,'Former member') AS authorDisplayName,r.ordinal,r.label,r.status_key AS statusKey,r.created_at AS createdAt,r.deleted_at AS deletedAt,r.deleted_by_member_id AS deletedByMemberId FROM page_revisions r LEFT JOIN members m ON m.id=r.author_member_id AND m.workspace_id=? WHERE r.page_id=? AND (? OR EXISTS (SELECT 1 FROM content_published_revisions v WHERE v.page_id=r.page_id AND v.revision_id=r.id)) ORDER BY r.created_at DESC,r.id DESC").bind(ctx.actor.workspaceId,pageId,+editor).all()).results;
}
export async function readRevision(ctx: FeatureContext, pageId: string, id: string) {
    await rejectErasedPage(ctx,pageId);
    const access = await requirePageLevel(ctx, pageId, 'view');
    const r = await revisionRow(ctx, pageId, id);
    if (access.decision.level === 'view' || access.decision.level === 'comment') {
        if (!await ctx.db.prepare('SELECT 1 FROM content_published_revisions WHERE page_id=? AND revision_id=?').bind(pageId,id).first())
            throw new ApiProblem(404, 'NOT_FOUND', 'Not found.');
    }
    if (r.deleted_at)
        return { id: r.id, deleted: true, ordinal: r.ordinal, deletedAt: r.deleted_at };
    const p = await pageRow(ctx, pageId);
    return { id: r.id, blocks: await projectSynced(ctx,await labelForReader(ctx, JSON.parse(r.body_json))), properties: await filterRecordProperties(ctx, pageId, JSON.parse(r.properties_json)), createdAt: r.created_at, newerRevisionExists: p.working_revision_id !== id };
}
export async function restorePageRevision(ctx: FeatureContext, pageId: string, id: string, input: {
    operationKey: string;
    expectedRevisionId: string;
}) {
    await requirePageLevel(ctx, pageId, 'edit');
    const r = await revisionRow(ctx, pageId, id);
    if (r.deleted_at)
        throw new ApiProblem(409, 'DELETED_REVISION', 'This revision has been deleted.');
    return restorePageContent(ctx, pageId, input, JSON.parse(r.body_json), JSON.parse(r.properties_json), id);
}
export async function deleteRevision(ctx: FeatureContext, pageId: string, id: string, input: {
    operationKey: string;
}) {
    return commitOperation(ctx, { operationKey: input.operationKey, action: 'versions.delete', request: { pageId, id, ...input }, authorize: async () => { await requirePageLevel(ctx, pageId, 'full'); }, prepare: async () => {
            if ((await contentPolicy(ctx))['page.version.v1'] !== 'labelled')
                throw new ApiProblem(409, 'POLICY_RESTRICTED', 'Version deletion requires the labelled profile.');
            const p = await pageRow(ctx, pageId);
            writable(p);
            if ([p.revision_id, p.working_revision_id, p.published_revision_id].includes(id))
                throw new ApiProblem(409, 'CURRENT_REVISION', 'Current and published versions cannot be deleted.');
            await revisionRow(ctx, pageId, id);
            return { statements: [pageGuard(ctx, p, p.revision_id), ctx.db.prepare("UPDATE page_revisions SET body_json='[]',properties_json='{}',content_hash='',author_member_id=NULL,label=NULL,status_key=NULL,deleted_at=?,deleted_by_member_id=? WHERE id=? AND page_id=?").bind(ctx.now, ctx.actor.id, id, pageId)], entity: { id: pageId, kind: 'page', revisionId: p.revision_id }, value: { id, deleted: true } };
        } });
}
