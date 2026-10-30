import { supportedHeaderControls } from './header';
import type { FeatureContext } from '../../app/feature-context';
import { commitOperation } from '../../app/operations';
import { ApiProblem } from '../../app/problems';
import { createUlid } from '../../shared/ulid';
import { requirePageLevel } from '../sharing/current-access';
import { pageRow, pageGuard } from '../pages/repository';
import { assertCanPublishPublicPage } from '../sharing/access';
export interface ExposureInput {
    operationKey: string;
    expectedRevisionId: string;
    host: string;
    slug: string;
    indexable?: boolean;
    theme?: string;
    headerControls?: string[];
    duplicateAsTemplate?: boolean;
    socialPreview?: Record<string, string>;
    revoke?: boolean;
    children?: {
        pageId: string;
        slug: string;
        expectedRevisionId: string;
    }[];
}
export async function publishPublicPage(ctx: FeatureContext, id: string, input: ExposureInput) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}$/.test(input.slug) || input.slug.includes('..') || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(input.host))
        throw new ApiProblem(400, 'INVALID_PUBLIC_ADDRESS', 'Choose a valid host and slug.');
    return commitOperation(ctx, { operationKey: input.operationKey, action: input.revoke ? 'publishing.revoke' : 'publishing.publish', request: { id, ...input }, authorize: async () => {
            const a = await requirePageLevel(ctx, id, 'full');
            if (!input.revoke) {
                try {
                    assertCanPublishPublicPage(a.context);
                }
                catch {
                    throw new ApiProblem(403, 'PUBLICATION_FORBIDDEN', 'This page or container cannot be published.');
                }
            }
        }, prepare: async () => { const plan = await preparePublicExposure(ctx, id, input); for (const child of input.children ?? []) {
            const access = await requirePageLevel(ctx, child.pageId, 'full');
            if (!input.revoke)
                assertCanPublishPublicPage(access.context);
            const childPlan = await preparePublicExposure(ctx, child.pageId, { ...input, children: undefined, expectedRevisionId: child.expectedRevisionId, slug: child.slug });
            plan.statements.push(...childPlan.statements);
        } return plan; } });
}
export async function preparePublicExposure(ctx: FeatureContext, id: string, input: ExposureInput) {
    if (input.headerControls && (!Array.isArray(input.headerControls) || input.headerControls.some(c=>!supportedHeaderControls.includes(c)) || new Set(input.headerControls).size!==input.headerControls.length))
        throw new ApiProblem(400,'INVALID_HEADER_CONTROLS','Choose supported public header controls.');
    if (input.socialPreview && (typeof input.socialPreview!=='object' || Array.isArray(input.socialPreview) || Object.entries(input.socialPreview).some(([key,value])=>!['title','description'].includes(key)||typeof value!=='string'||value.length>1000)))
        throw new ApiProblem(400,'INVALID_SOCIAL_PREVIEW','Social preview supports a title and description of at most 1000 characters.');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}$/.test(input.slug) || input.slug.includes("..") || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(input.host))
        throw new ApiProblem(400, "INVALID_PUBLIC_ADDRESS", "Choose a valid host and slug.");
    const p = await pageRow(ctx, id);
    if (p.archived_at || p.trashed_at || (!input.revoke && !p.published_revision_id))
        throw new ApiProblem(409, 'NOT_PUBLISHABLE', 'Publish a live revision first.');
    const old = await ctx.db.prepare('SELECT * FROM public_exposures WHERE page_id=?').bind(id).first<{
        id: string; indexable: number; theme: string; header_controls_json: string;
        duplicate_as_template: number; social_preview_json: string; published_at: string;
    }>();
    const collision = await ctx.db.prepare('SELECT page_id FROM public_exposures WHERE host=? AND slug=? AND page_id<>?').bind(input.host, input.slug, id).first();
    if (collision)
        throw new ApiProblem(409, 'SLUG_RESERVED', 'This address is already reserved.');
    return { statements: [pageGuard(ctx, p, input.expectedRevisionId), ctx.db.prepare('INSERT INTO public_exposures (id,page_id,host,slug,indexable,theme,header_controls_json,duplicate_as_template,social_preview_json,published_at,revoked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET host=excluded.host,slug=excluded.slug,indexable=excluded.indexable,theme=excluded.theme,header_controls_json=excluded.header_controls_json,duplicate_as_template=excluded.duplicate_as_template,social_preview_json=excluded.social_preview_json,published_at=excluded.published_at,revoked_at=excluded.revoked_at').bind(old?.id ?? createUlid(), id, input.host, input.slug, +(input.indexable ?? !!old?.indexable), input.theme ?? old?.theme ?? 'default', input.headerControls === undefined ? old?.header_controls_json ?? '[]' : JSON.stringify(input.headerControls), +(input.duplicateAsTemplate ?? !!old?.duplicate_as_template), input.socialPreview === undefined ? old?.social_preview_json ?? '{}' : JSON.stringify(input.socialPreview), old?.published_at ?? ctx.now, input.revoke ? ctx.now : null)], entity: { id, kind: 'page', revisionId: p.revision_id }, value: { pageId: id, url: `https://${input.host}/p/${input.slug}`, revoked: !!input.revoke } };
}
export async function publicPage(db: D1Database, host: string, slug: string) {
    const p = await db.prepare("SELECT p.id,p.workspace_id,p.published_revision_id,e.*,r.body_json,r.properties_json,c.public_link_access,c.anonymous_access,w.public_link_access AS workspace_public,w.anonymous_access AS workspace_anonymous FROM public_exposures e JOIN pages p ON p.id=e.page_id JOIN containers c ON c.id=p.container_id JOIN workspaces w ON w.id=p.workspace_id JOIN page_revisions r ON r.id=p.published_revision_id WHERE e.host=? AND e.slug=? AND e.revoked_at IS NULL AND p.deleted_at IS NULL AND p.trashed_at IS NULL AND p.archived_at IS NULL AND p.lifecycle IN ('live','live-with-unpublished-changes') AND r.deleted_at IS NULL").bind(host, slug).first<Record<string, any>>();
    if (!p || p.public_link_access === 'forbidden' || p.workspace_public === 'forbidden')
        throw new ApiProblem(404, 'NOT_FOUND', 'This link is no longer available.');
    return p;
}
/** Anonymous links and published titles for the pages a public page mentions or links to. */
export async function publicTargets(db: D1Database, exposure: Record<string, any>): Promise<{ links: Record<string, string>; titles: Record<string, string> }> { const ids = new Set<string>(JSON.stringify(JSON.parse(exposure.body_json)).match(/[0-9A-HJKMNP-TV-Z]{26}/g) ?? []); if (!ids.size)
    return { links: {}, titles: {} }; const rows = (await db.prepare("SELECT p.id,e.host,e.slug,(SELECT json_extract(r.properties_json,'$.title') FROM page_revisions r WHERE r.id=p.published_revision_id) AS title FROM public_exposures e JOIN pages p ON p.id=e.page_id JOIN containers c ON c.id=p.container_id JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=? AND e.revoked_at IS NULL AND p.deleted_at IS NULL AND p.trashed_at IS NULL AND p.archived_at IS NULL AND p.lifecycle IN ('live','live-with-unpublished-changes') AND c.public_link_access='allowed' AND c.anonymous_access='allowed' AND w.public_link_access='allowed' AND w.anonymous_access='allowed'").bind(exposure.workspace_id).all<{
    id: string;
    host: string;
    slug: string;
    title: string | null;
}>()).results.filter(r => ids.has(r.id)); return { links: Object.fromEntries(rows.map(r => [r.id, r.host === exposure.host ? `/p/${r.slug}` : `https://${r.host}/p/${r.slug}`])), titles: Object.fromEntries(rows.flatMap(r => r.title === null ? [] : [[r.id, r.title]])) }; }
