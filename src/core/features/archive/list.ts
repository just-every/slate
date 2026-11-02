import type { FeatureContext } from "../../app/feature-context";
import { ApiProblem } from "../../app/problems";
import { resolveCurrentAccess } from "../sharing/current-access";
export async function listArchive(ctx: FeatureContext) {
        const rows = (await ctx.db.prepare('SELECT p.id,p.title,p.page_kind AS pageKind,p.container_id AS containerId,p.revision_id AS revisionId,p.archived_at AS archivedAt,p.trashed_at AS trashedAt,l.reason,l.occurred_at AS occurredAt,l.actor_member_id AS actorMemberId,l.prior_container_id AS priorContainerId,l.prior_parent_id AS priorParentId,l.prior_position AS priorPosition,l.prior_lifecycle AS priorLifecycle,p.working_revision_id,p.published_revision_id FROM pages p LEFT JOIN content_archive_locations l ON l.page_id=p.id WHERE p.workspace_id=? AND p.deleted_at IS NULL AND (p.archived_at IS NOT NULL OR p.trashed_at IS NOT NULL)').bind(ctx.actor.workspaceId).all<Record<string, any>>()).results, out = [];
        for (const r of rows) {
            try {
                const { working_revision_id, published_revision_id, ...item } = r, access = await resolveCurrentAccess(ctx, r.id, { includeTrashed: true });
                if (!access.decision.allowed)
                    continue;
                // Readers below edit see the published title, as the page door shows them.
                if (!['edit', 'full'].includes(access.decision.level ?? '') && published_revision_id && published_revision_id !== working_revision_id)
                    item.title = JSON.parse((await ctx.db.prepare('SELECT properties_json FROM page_revisions WHERE id=?').bind(published_revision_id).first<{ properties_json: string }>())?.properties_json ?? '{}').title ?? '';
                out.push(item);
            }
            catch (e) {
                if (!(e instanceof ApiProblem) || e.status !== 404)
                    throw e;
            }
        }
        return { items: out };
}
