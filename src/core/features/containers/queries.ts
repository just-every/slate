import { publishedImportContainerSql } from '../imports/publication';
import type { FeatureContext } from '../../app/feature-context';
import { ApiProblem } from '../../app/problems';
import type { MemberSubject } from '../../shared/knowledge/model';
import { currentSubject } from '../sharing/current-access';
import { containerListAccess } from './list-access';
interface ContainerMetadata { id:string; key:string|null; icon:string|null; name:string; description:string; visibility:string; guestAccess:'allowed'|'forbidden'; publicLinkAccess:'allowed'|'forbidden'; anonymousAccess:'allowed'|'forbidden'; revisionId:string; archivedAt:string|null; trashedAt:string|null; }

async function containerRows(ctx:FeatureContext, subject:MemberSubject, filter:{id:string}|{archived:boolean}) {
    const condition = 'id' in filter ? 'c.id=?' : '((?=0 AND c.archived_at IS NULL AND c.trashed_at IS NULL) OR (?=1 AND (c.archived_at IS NOT NULL OR c.trashed_at IS NOT NULL)))';
    const bindings = 'id' in filter ? [filter.id] : [+filter.archived, +filter.archived];
    const rows = (await ctx.db.prepare(`SELECT c.id,c.key,c.icon,c.name,c.description,c.visibility,c.guest_access AS guestAccess,c.public_link_access AS publicLinkAccess,c.anonymous_access AS anonymousAccess,c.revision_id AS revisionId,c.archived_at AS archivedAt,c.trashed_at AS trashedAt,
        (SELECT COUNT(*) FROM container_members cm WHERE cm.container_id=c.id) AS memberCount,
        EXISTS(SELECT 1 FROM container_owners o WHERE o.container_id=c.id AND o.member_id=?) AS owned,
        EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.workspace_id=c.workspace_id AND m.role='owner' AND m.member_kind='member' AND m.status='active') AS workspaceOwner
        FROM containers c WHERE c.workspace_id=? AND ${condition} AND ${publishedImportContainerSql('c.id')} ORDER BY c.name,c.id`)
        .bind(ctx.actor.id, ctx.actor.id, ctx.actor.workspaceId, ...bindings).all<ContainerMetadata & {memberCount:number;owned:number;workspaceOwner:number}>()).results;
    const accesses = await containerListAccess(ctx, rows.map(row => row.id), subject);
    const owners = subject.isGuest ? [] : (await ctx.db.prepare("SELECT o.container_id AS containerId,o.member_id AS memberId,m.display_name AS displayName FROM container_owners o JOIN members m ON m.id=o.member_id AND m.workspace_id=? AND m.status='active' ORDER BY m.display_name,m.id").bind(ctx.actor.workspaceId).all<{containerId:string;memberId:string;displayName:string}>()).results;
    return rows.flatMap(({owned,workspaceOwner,...row}) => {
        // Workspace administration never reveals another member's personal container.
        if (row.visibility === 'personal' && !owned) return [];
        const level = accesses.get(row.id);
        const canEdit = level === 'full' || level === 'edit';
        const canManage = level === 'full' || (row.visibility !== 'personal' && !!workspaceOwner);
        if (!canManage && !canEdit && !level) return [];
        return [{...row,owners:owners.filter(owner => owner.containerId === row.id).map(({memberId,displayName}) => ({memberId,displayName})),permissions:{canManage,canCreatePages:canEdit && !row.archivedAt && !row.trashedAt}}];
    });
}
export async function readContainer(ctx:FeatureContext,id:string) {
    const subject = await currentSubject(ctx);
    const [row] = await containerRows(ctx, subject, {id});
    if (!row) throw new ApiProblem(404,'NOT_FOUND','Not found.');
    return row;
}
export async function containerIndex(ctx:FeatureContext, archived=false) {
    const subject = await currentSubject(ctx);
    if (subject.isGuest) throw new ApiProblem(403,'FORBIDDEN','Guests have no container index.');
    return {items:await containerRows(ctx, subject, {archived})};
}
