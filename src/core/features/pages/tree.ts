import {materializeSynced,projectPublicSynced} from '../editor/synced/read';
import { moveSources, writableMoveGuard } from './tree-writable';
import { publicMoveChanges } from './tree-access';
import { authorScheduleProjections } from '../lifecycle/schedule-view';
import { contentPolicy } from './policy';
import { isPrivateLifecycle } from '../sharing/access';
import { publicPage } from '../publishing/service';
import type { FeatureContext } from '../../app/feature-context';
import { commitOperation, mutationGuard, requestHash } from '../../app/operations';
import { contentLimits } from '../editor/limits';
import { ApiProblem } from '../../app/problems';
import { createUlid } from '../../shared/ulid';
import { currentSubject, requirePageLevel, requireContainerLevel, resolveCurrentAccess, resolveCurrentAccessMany } from '../sharing/current-access';
import { pageRow, pageGuard, ref, revisionStatement, snapshot, contentEvent } from './repository';
import { createPage, readPage, destination, prepareCreatePage } from './service';
import type { PageRow } from './types';
import { validatePlacement, prepareOrder, treeTopologyGuard, destinationGuards, type MovePlacement } from './tree-order';
export async function descendants(ctx: FeatureContext, id: string) { return (await ctx.db.prepare('WITH RECURSIVE tree(id) AS (SELECT id FROM pages WHERE id=? AND workspace_id=? UNION SELECT p.id FROM pages p JOIN tree t ON p.parent_page_id=t.id WHERE p.deleted_at IS NULL) SELECT p.* FROM pages p JOIN tree t ON t.id=p.id').bind(id, ctx.actor.workspaceId).all<PageRow>()).results; }
export async function listPages(ctx: FeatureContext, containerId?: string, label?:string) {
    if(label&&label.length>80)throw new ApiProblem(400,'INVALID_LABEL','Use a label of at most 80 characters.');
    const subject = await currentSubject(ctx);
    const [profile, result] = await Promise.all([
        contentPolicy(ctx),
        ctx.db.prepare('SELECT p.*,c.name AS containerLabel,r.id AS publishedRevision,r.properties_json AS publishedProperties FROM pages p LEFT JOIN containers c ON c.id=p.container_id LEFT JOIN page_revisions r ON r.page_id=p.id AND r.id=p.published_revision_id WHERE p.workspace_id=? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.trashed_at IS NULL AND (? IS NULL OR p.container_id=?) ORDER BY p.tree_position,p.id')
            .bind(ctx.actor.workspaceId, containerId ?? null, containerId ?? null).all<PageRow & {containerLabel:string|null;publishedRevision:string|null;publishedProperties:string|null}>()
    ]);
    const rows = result.results;
    const labels=new Map<string,string[]>();
    const storedLabels=await ctx.db.prepare('SELECT l.page_id,l.label FROM page_labels l JOIN pages p ON p.id=l.page_id WHERE p.workspace_id=? AND (? IS NULL OR p.container_id=?) ORDER BY l.label').bind(ctx.actor.workspaceId,containerId??null,containerId??null).all<{page_id:string;label:string}>();
    for(const row of storedLabels.results)labels.set(row.page_id,[...(labels.get(row.page_id)??[]),row.label]);
    const candidates = rows.filter(p => !(profile['record.page-parity.v1'] === 'record-is-row' && p.page_kind === 'record'));
    const [schedules, accesses] = await Promise.all([
        authorScheduleProjections(ctx, rows.map(p => p.id)),
        resolveCurrentAccessMany(ctx, candidates.map(p => p.id), { subject })
    ]);
    const out = [];
    for (const p of candidates) {
        const resolution = accesses.get(p.id);
        if (!resolution?.decision.allowed) continue;
        const access = resolution.decision;
        // Sharing provenance is independent of the strongest effective grant.
        // Removing an individual invitation removes this entry even if a broader
        // grant still permits the page in the ordinary space tree.
        const grants = [...resolution.context.page.grants, ...(!isPrivateLifecycle(p.lifecycle) ? resolution.context.inheritedGrants : [])];
        const sharedWithMe = !subject.containerIds.includes(p.container_id) && grants.some(grant =>
            grant.principalKind === 'member' && grant.principalId === subject.memberId &&
            !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > ctx.now));
        let title = p.title, icon = p.icon, visibleLabels=labels.get(p.id)??[], statusKey=p.status_key;
        if ((access.level === 'view' || access.level === 'comment') && p.published_revision_id && p.published_revision_id !== p.working_revision_id) {
            if (!p.publishedRevision) throw new ApiProblem(404, 'NOT_FOUND', 'Not found.');
            const props = JSON.parse(p.publishedProperties!);
            title = props.title;
            icon = props.icon;
            visibleLabels=props.labels??[];
            statusKey=props.statusKey??null;
        }
        if(label&&!visibleLabels.some(value=>value.toLocaleLowerCase()===label.toLocaleLowerCase()))continue;
        out.push({ ...ref(p), ...schedules.get(p.id), title, icon, statusKey, labels:visibleLabels, parentPageId: p.parent_page_id, treePosition: p.tree_position, pageKind: p.page_kind, containerLabel: p.containerLabel ?? '', sharedWithMe, permissions: { level: access.level!, canEdit: !p.locked_at && (access.level === 'edit' || access.level === 'full'), canUnlock: access.level === 'edit' || access.level === 'full' } });
    }
    return { items: out };
}
export interface MoveInput extends MovePlacement {
    operationKey: string;
    expectedRevisionId: string;
    containerId: string;
    parentPageId?: string | null;
    accessPreviewHash: string;
}
export async function previewMove(ctx: FeatureContext, id: string, input: MovePlacement) {
    const { order, publicGuard, ...preview } = await prepareMovePreview(ctx, id, input);
    return { ...preview, ...(order ? { orderPreviewHash: order.hash } : {}) };
}
async function prepareMovePreview(ctx: FeatureContext, id: string, input: MovePlacement) {
    const relative = validatePlacement(input);
    const pages = await moveSources(ctx, id, input);
    await destination(ctx, input.containerId, input.parentPageId);
    if (input.parentPageId && pages.some(p => p.id === input.parentPageId))
        throw new ApiProblem(400, 'TREE_CYCLE', 'A page cannot be its own descendant.');
    const locationOverrides = Object.fromEntries(pages.map(p => [p.id, { containerId: input.containerId, parentPageId: p.id === id ? input.parentPageId ?? null : p.parent_page_id }]));
    const exposure = await publicMoveChanges(ctx, pages, input.containerId);
    const changes: { pageId: string; memberId: string | null; audience?: 'public-link'; before: string | null; after: string | null }[] = [...exposure.changes, ...await relocationAudienceChanges(ctx, pages, locationOverrides)];
    // Moving is an edit only while effective access stays unchanged. Inheritance
    // changes require the authority to share every affected page, including children.
    for (const pageId of new Set(changes.map(change => change.pageId)))
        await requirePageLevel(ctx, pageId, 'full');
    const fingerprint = { pages: pages.map(p => [p.id, p.revision_id]), destination: { containerId: input.containerId, parentPageId: input.parentPageId ?? null }, changes };
    return { changes, publicGuard: exposure.guard, accessPreviewHash: await requestHash(fingerprint), order: relative ? await prepareOrder(ctx, id, input) : undefined };
}
export async function movePage(ctx: FeatureContext, id: string, input: MoveInput) {
    validatePlacement(input, true);
    if (typeof input.operationKey !== 'string' || typeof input.expectedRevisionId !== 'string' || !input.expectedRevisionId || typeof input.accessPreviewHash !== 'string') throw new ApiProblem(400, 'INVALID_REQUEST', 'Supply revision and access preview hashes.');
    return commitOperation(ctx, { operationKey: input.operationKey, action: 'pages.move', request: { id, ...input }, authorize: async () => { await moveSources(ctx, id, input); await destination(ctx, input.containerId, input.parentPageId); }, prepare: async ({ revisionId }) => {
            const topology = await treeTopologyGuard(ctx, id);
            const preview = await prepareMovePreview(ctx, id, input);
            if (preview.accessPreviewHash !== input.accessPreviewHash)
                throw new ApiProblem(409, 'ACCESS_PREVIEW_CHANGED', 'Review the current access changes before moving.');
            const pages = await descendants(ctx, id);
            const root = pages.find(p => p.id === id);
            if (!root) throw new ApiProblem(409, 'REVISION_CONFLICT', 'The record changed. Reload before saving.');
            const order = preview.order;
            if (order && order.hash !== input.orderPreviewHash) throw new ApiProblem(409, 'ORDER_PREVIEW_CHANGED', 'Review the current placement before moving.');
            const statements = [topology, writableMoveGuard(ctx, id, input.containerId), preview.publicGuard, ...await destinationGuards(ctx, input), pageGuard(ctx, root, input.expectedRevisionId), ...(order ? [order.guard] : [])];
            if ((order ? order.unchanged : root.tree_position === input.treePosition) && root.container_id === input.containerId && root.parent_page_id === (input.parentPageId ?? null)) return { statements, noChange: true, entity: { id, kind: 'page', revisionId: root.revision_id }, value: { pageId: id, revisionId: root.revision_id } };
            if (order) statements.push(...order.maintenance);
            for (const p of pages) {
                // Descendant edges and ordering do not change on a same-container
                // move. Preserve their immutable history and timestamps exactly.
                if (p.id !== id && p.container_id === input.containerId) continue;
                const rev = p.id === id ? revisionId : createUlid();
                statements.push(pageGuard(ctx, p, p.revision_id), ctx.db.prepare('UPDATE pages SET container_id=?,parent_page_id=CASE WHEN id=? THEN ? ELSE parent_page_id END,tree_position=CASE WHEN id=? THEN ? ELSE tree_position END,revision_id=?,updated_at=? WHERE id=?').bind(input.containerId, id, input.parentPageId ?? null, id, order ? order.position : input.treePosition!, rev, ctx.now, p.id), await revisionStatement(ctx, p.id, rev, await snapshot(ctx, p)), ...contentEvent(ctx, p.id, rev, 'moved', {}, [p.container_id]));
            }
            return { statements, entity: { id, kind: 'page', revisionId }, value: { pageId: id, revisionId } };
        } });
}
export async function duplicatePage(ctx: FeatureContext, id: string, input: {
    operationKey: string;
    containerId: string;
    parentPageId?: string | null;
    includeChildren?: boolean;
    publicSource?: {
        host: string;
        slug: string;
    };
}) {
    const staged: string[] = [];
    try {
        return await commitOperation(ctx, { operationKey: input.operationKey, action: 'pages.duplicate', request: { id, ...input }, authorize: async () => { if (input.publicSource) {
                const exposure = await publicPage(ctx.db, input.publicSource.host, input.publicSource.slug);
                if (exposure.page_id !== id || !exposure.duplicate_as_template || input.includeChildren)
                    throw new ApiProblem(403, 'DUPLICATION_DISABLED', 'This public page cannot be duplicated.');
                if (exposure.anonymous_access === 'forbidden' || exposure.workspace_anonymous === 'forbidden')
                    await requirePageLevel(ctx, id, 'view');
            }
            else
                await requirePageLevel(ctx, id, 'view'); await destination(ctx, input.containerId, input.parentPageId); }, prepare: async ({ revisionId }) => {
                const source = input.includeChildren ? await descendants(ctx, id) : [await pageRow(ctx, id)], ids = new Map(source.map(p => [p.id, createUlid()]));
                const statements: D1PreparedStatement[] = [];
                // Copied attachments count against the same deployment storage limit as uploads.
                const used = (await ctx.db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM files WHERE deleted_at IS NULL').first<{ bytes: number }>())?.bytes ?? 0;
                let copied = 0;
                for (const p of source) {
                    if (!input.publicSource)
                        await requirePageLevel(ctx, p.id, 'view');
                    const exposure = input.publicSource ? await publicPage(ctx.db, input.publicSource.host, input.publicSource.slug) : null;
                    const document = exposure ? { blocks: JSON.parse(exposure.body_json) as import('../../shared/api/content').BlockView[], properties: JSON.parse(exposure.properties_json) as import('./types').PageProperties } : await readPage(ctx, p.id), s = { blocks: materializeSynced(exposure?await projectPublicSynced(ctx.db,exposure,document.blocks):document.blocks,document.properties.title), properties: document.properties }, bid = new Map(s.blocks.map(b => [b.id, createUlid()]));
                    const files = (await ctx.db.prepare('SELECT * FROM files WHERE page_id=? AND deleted_at IS NULL').bind(p.id).all<Record<string, any>>()).results;
                    const fileIds = new Map<string, string>();
                    const fileStatements: D1PreparedStatement[] = [];
                    for (const file of files.filter(file => s.properties.coverFileId === file.id || s.properties.icon === `file:${file.id}` || s.blocks.some(b => JSON.stringify(b.content).includes(file.id)))) {
                        copied += file.size_bytes;
                        if (used + copied > contentLimits.attachmentStorageBytesPerDeployment)
                            throw new ApiProblem(429, 'STORAGE_LIMIT', 'Attachment storage is full.');
                        const newId = createUlid(), key = `pages/${ctx.actor.workspaceId}/${ids.get(p.id)!}/${newId}`, blob = await ctx.files.get(file.storage_key);
                        if (!blob)
                            throw new ApiProblem(409, 'MISSING_ATTACHMENT', 'A source attachment is unavailable.');
                        staged.push(key);
                        await ctx.files.put(key, blob.body, { httpMetadata: { contentType: file.content_type } });
                        fileIds.set(file.id, newId);
                        fileStatements.push(ctx.db.prepare('INSERT INTO files (id,workspace_id,page_id,storage_key,original_name,content_type,size_bytes,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId, ctx.actor.workspaceId, ids.get(p.id)!, key, file.original_name, file.content_type, file.size_bytes, ctx.now));
                    }
                    function remap(value: any): any {
                        if (Array.isArray(value))
                            return value.map(remap);
                        if (value && typeof value === 'object')
                            return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, key === 'fileId' && typeof val === 'string' ? fileIds.get(val) ?? val : key === 'url' && typeof val === 'string' && val.startsWith('/api/media/') ? `/api/media/${fileIds.get(val.slice(11)) ?? val.slice(11)}` : key === 'commentAnchorId' ? undefined : remap(val)]));
                        return value;
                    }
                    const plan = await prepareCreatePage(ctx, { operationKey: input.operationKey, id: ids.get(p.id)!, containerId: input.containerId, parentPageId: p.id === id ? input.parentPageId : ids.get(p.parent_page_id!) ?? null, title: s.properties.title, properties: { ...s.properties, statusKey: null, ownerMemberId: ctx.actor.id, icon: s.properties.icon?.startsWith('file:') ? `file:${fileIds.get(s.properties.icon.slice(5))}` : s.properties.icon, coverFileId: s.properties.coverFileId ? fileIds.get(s.properties.coverFileId) ?? null : null }, blocks: s.blocks.map(b => ({ ...b, content: remap(b.content), id: bid.get(b.id)!, parentBlockId: b.parentBlockId ? bid.get(b.parentBlockId) : null })) }, p.id === id ? revisionId : createUlid());
                    statements.push(...plan.statements, ...fileStatements);
                }
                if (copied)
                    statements.unshift(mutationGuard(ctx.db, 'SELECT COALESCE(SUM(size_bytes),0)+?<=? FROM files WHERE deleted_at IS NULL', [copied, contentLimits.attachmentStorageBytesPerDeployment]));
                const pageId = ids.get(id)!;
                return { statements, entity: { id: pageId, kind: 'page', revisionId }, value: { pageId, revisionId } };
            } });
    }
    finally {
        for (const key of staged) {
            const retained = await ctx.db.prepare('SELECT 1 FROM files WHERE storage_key=?').bind(key).first();
            if (!retained)
                await ctx.files.delete(key);
        }
    }
}
/** Every active member whose effective access to these pages differs once they sit at the overridden locations. */
export async function relocationAudienceChanges(ctx: FeatureContext, pages: PageRow[], locationOverrides: Record<string, { containerId: string; parentPageId: string | null }>, options: { includeTrashed?: boolean } = {}) {
    const members = (await ctx.db.prepare("SELECT id,email,display_name,initials,role FROM members WHERE workspace_id=? AND status='active'").bind(ctx.actor.workspaceId).all<{
        id: string;
        email: string;
        display_name: string;
        initials: string;
        role: 'owner' | 'member';
    }>()).results;
    const changes: { pageId: string; memberId: string; before: string | null; after: string | null }[] = [];
    for (const member of members) {
        const actor = { ...ctx.actor, id: member.id, email: member.email, displayName: member.display_name, initials: member.initials, role: member.role };
        const mctx = { ...ctx, actor };
        for (const p of pages) {
            const before = await readableDecision(mctx, p.id, options);
            const after = await readableDecision(mctx, p.id, { ...options, locationOverrides });
            if (before.level !== after.level)
                changes.push({ pageId: p.id, memberId: member.id, before: before.level, after: after.level });
        }
    }
    return changes;
}
async function readableDecision(ctx: FeatureContext, id: string, options?: Parameters<typeof resolveCurrentAccess>[2]) {
    try {
        return (await resolveCurrentAccess(ctx, id, options)).decision;
    }
    catch (e) {
        if (e instanceof ApiProblem && e.status === 404)
            return { allowed: false, level: null, source: null };
        throw e;
    }
}
