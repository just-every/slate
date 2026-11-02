import {syncedGuards} from './synced/guards';
import {canonicalGroupLabels,labelGroups} from '../comments/group-labels';
import { mentionEffects } from '../comments/group-mentions';
import { taskEffects, ownTaskCompletion } from '../work-items/effects';
import { normalizeTask } from './tasks';
import type { FeatureContext } from '../../app/feature-context';
import { commitOperation, mutationGuard, requestHash } from '../../app/operations';
import { ApiProblem } from '../../app/problems';
import { createUlid } from '../../shared/ulid';
import { requirePageLevel } from '../sharing/current-access';
import { pageRow, pageBlocks, properties, pageGuard, revisionStatement, writable, contentEvent } from '../pages/repository';
import type { BlockInput, BlockUpdateInput } from '../pages/types';
import type { BlockView } from '../../shared/api/content';
import type { JsonValue } from '../../shared/api/common';
import { validateBlockContent, validateBlockTree, plainContent } from './validation';
import { contentPolicy } from '../pages/policy';
import { labelForReader, labelPageMentions } from '../pages/mentions';
/** Equal once every page mention's label is dropped: a reader's copy carries labels chosen for them, never the stored title. */
async function sameContent(a: JsonValue, b: JsonValue, origin?:string) { const bare = (value: JsonValue) => labelGroups(labelPageMentions(value, () => '',origin), () => ''); return await requestHash(bare(a)) === await requestHash(bare(b)); }
function revisionUpdate(ctx: FeatureContext, id: string, revisionId: string, live: boolean) { return ctx.db.prepare("UPDATE pages SET working_revision_id=?,revision_id=?,published_revision_id=CASE WHEN ? THEN ? ELSE published_revision_id END,lifecycle=CASE WHEN ? THEN lifecycle WHEN lifecycle IN ('live','live-with-unpublished-changes') THEN 'live-with-unpublished-changes' ELSE lifecycle END,updated_at=? WHERE id=?").bind(revisionId, revisionId, +live, revisionId, +live, ctx.now, id); }
export async function updateBlock(ctx: FeatureContext, pageId: string, blockId: string, input: BlockUpdateInput) {
    // Retry only snapshot contention from a different block. The submitted block CAS is never rebased.
    for (let attempt = 0;; attempt++) {
        try {
            return await commitOperation(ctx, { operationKey: input.operationKey, action: 'pages.block.update', request: { pageId, blockId, ...input }, authorize: async () => { await requirePageLevel(ctx, pageId, 'edit'); }, prepare: async ({ revisionId }) => {
                    const page = await pageRow(ctx, pageId);
                    writable(page);
                    const blocks = await pageBlocks(ctx.db, pageId), block = blocks.find(b => b.id === blockId);
                    if (!block)
                        throw new ApiProblem(404, 'NOT_FOUND', 'Not found.');
                    if (block.revisionId !== input.expectedRevisionId)
                        throw new ApiProblem(409, 'BLOCK_CONFLICT', 'This block changed. Keep your unsaved text and compare.', { blockId, currentRevisionId: block.revisionId, serverContent: await labelForReader(ctx, block.content) });
                    let content = await canonicalGroupLabels(ctx,validateBlockContent(block.blockType, input.content));
                    content = await normalizeTask(ctx, { ...block, content }, block);
                    if (await sameContent(content, block.content,ctx.appOrigin))
                        return { noChange: true, statements: [pageGuard(ctx, page, page.revision_id), mutationGuard(ctx.db, 'SELECT revision_id=? FROM page_blocks WHERE id=? AND page_id=?', [input.expectedRevisionId, blockId, pageId])], entity: { id: pageId, kind: 'page', revisionId: page.revision_id }, value: { pageId, revisionId: page.revision_id, blockRevisionId: block.revisionId, previousRevisionId: page.revision_id } };
                    const blockRevisionId = createUlid();
                    const next = blocks.map(b => b.id === blockId ? { ...b, content, revisionId: blockRevisionId } : b);
                    validateBlockTree(next);
                    const policy = await contentPolicy(ctx), live = policy['page.lifecycle.v1'] === 'always-live' && !['draft', 'scheduled'].includes(page.lifecycle);
                    return { statements: [...await syncedGuards(ctx,next,blocks),pageGuard(ctx, page, page.revision_id), mutationGuard(ctx.db, 'SELECT revision_id=? FROM page_blocks WHERE id=? AND page_id=?', [input.expectedRevisionId, blockId, pageId]), ctx.db.prepare('UPDATE page_blocks SET content_json=?,revision_id=?,updated_at=? WHERE id=?').bind(JSON.stringify(content), blockRevisionId, ctx.now, blockId), revisionUpdate(ctx, pageId, revisionId, live), await revisionStatement(ctx, pageId, revisionId, { blocks: next, properties: await properties(ctx, page) }), ctx.db.prepare('INSERT OR IGNORE INTO page_contributors VALUES (?,?,?)').bind(pageId, ctx.actor.id, ctx.now), ...contentEvent(ctx, pageId, revisionId, 'block', { blockId, blockRevisionId }, [], 'block', !await ownTaskCompletion(ctx, { ...block, content }, block)), ...anchorUpdates(ctx, pageId, next),...await taskEffects(ctx,pageId,next,blocks,revisionId),...await mentionEffects(ctx,pageId,page.container_id,content,block.content,revisionId,undefined,block.blockType==='task'?[(content as Record<string,any>).assigneeMemberId]:[])], entity: { id: pageId, kind: 'page', revisionId }, value: { pageId, revisionId, blockRevisionId, previousRevisionId: page.revision_id } };
                } });
        }
        catch (e) {
            if (!(e instanceof ApiProblem) || e.code !== 'REVISION_CONFLICT' || attempt >= 7)
                throw e;
        }
    }
}
export function anchorUpdates(ctx: FeatureContext, pageId: string, blocks: import('../../shared/api/content').BlockView[]) {
    const ids = new Map<string, string>();
    function visit(v: unknown, id: string) {
        if (Array.isArray(v))
            v.forEach(x => visit(x, id));
        else if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            if (typeof o.commentAnchorId === 'string')
                ids.set(o.commentAnchorId, id);
            Object.values(o).forEach(x => visit(x, id));
        }
    }
    blocks.forEach(b => visit(b.content, b.id));
    return [ctx.db.prepare("UPDATE comment_threads SET orphaned=1 WHERE page_id=? AND kind='inline'").bind(pageId), ...blocks.map(b => ctx.db.prepare("UPDATE comment_threads SET orphaned=0 WHERE page_id=? AND block_id=? AND length(json_extract(anchor_json,'$.quote'))>0 AND instr(?,json_extract(anchor_json,'$.quote'))>0").bind(pageId, b.id, plainContent(b.content))), ...Array.from(ids, ([anchor, id]) => ctx.db.prepare("UPDATE comment_threads SET orphaned=0,block_id=? WHERE page_id=? AND json_extract(anchor_json,'$.anchorId')=?").bind(id, pageId, anchor))];
}
export async function replaceBlocks(ctx: FeatureContext, pageId: string, input: {
    operationKey: string;
    expectedRevisionId: string;
    blocks: BlockInput[];
    blockRevisions?: Record<string, string>;
}) { return commitOperation(ctx, { operationKey: input.operationKey, action: 'pages.blocks.replace', request: { pageId, ...input }, authorize: async () => { await requirePageLevel(ctx, pageId, 'edit'); }, prepare: ({ revisionId }) => prepareReplaceBlocks(ctx, pageId, input, revisionId) }); }
/**
 * SAVE-003: the editor sends the block revision it holds for every block it knows. A stored
 * block committed after that revision is kept unless this request leaves its content exactly
 * as stored; otherwise the whole change is refused with the block's saved content. A caller
 * that builds the whole page from one read at expectedRevisionId may omit the revisions: the
 * page revision guard then covers every block.
 */
async function blockConflict(old: BlockView[], next: { id: string; blockType: string; content: JsonValue }[], known: Record<string, string>,origin?:string) {
    for (const stored of old) {
        if (known[stored.id] === stored.revisionId)
            continue;
        const sent = next.find(b => b.id === stored.id);
        if (sent && sent.blockType === stored.blockType && await sameContent(sent.content, stored.content,origin))
            continue;
        return stored;
    }
}
export async function prepareReplaceBlocks(ctx: FeatureContext, pageId: string, input: {
    expectedRevisionId: string;
    blocks: BlockInput[];
    blockRevisions?: Record<string, string>;
}, revisionId: string) {
    const incoming = await canonicalGroupLabels(ctx,validateBlockTree(input.blocks));
    const page = await pageRow(ctx, pageId);
    writable(page);
    const old = await pageBlocks(ctx.db, pageId);
    const normalized = await Promise.all(incoming.map(async b => ({ ...b, content: await normalizeTask(ctx, b, old.find(o => o.id === b.id)) })));
    const conflict = input.blockRevisions && await blockConflict(old, normalized, input.blockRevisions,ctx.appOrigin);
    if (conflict)
        throw new ApiProblem(409, 'BLOCK_CONFLICT', 'Someone else changed a block on this page since you loaded it. Nothing was changed; compare or reload that block, then try again.', { blockId: conflict.id, currentRevisionId: conflict.revisionId, serverContent: await labelForReader(ctx, conflict.content) });
    // A block whose content this change leaves as stored keeps its revision, so a concurrent edit to it still saves.
    // A block left as stored keeps its stored text too, so a reader's mention labels are never written back.
    const kept = await Promise.all(normalized.map(async b => { const stored = old.find(o => o.id === b.id); return stored && stored.blockType === b.blockType && await sameContent(stored.content, b.content,ctx.appOrigin) ? stored : undefined; }));
    const next = normalized.map((b, i) => ({ ...b, pageId, parentBlockId: b.parentBlockId ?? null, revisionId: kept[i]?.revisionId ?? createUlid() }));
    const saved = next.map((b, i) => kept[i] ? { ...b, content: kept[i]!.content } : b);
    for (const b of next) {
        const foreign = await ctx.db.prepare('SELECT page_id FROM page_blocks WHERE id=?').bind(b.id).first<{
            page_id: string;
        }>();
        if (foreign && foreign.page_id !== pageId)
            throw new ApiProblem(409, 'BLOCK_ID_COLLISION', 'Block belongs to another page.');
    }
    const removed = old.filter(b => !next.some(n => n.id === b.id));
    const policy = await contentPolicy(ctx), live = policy['page.lifecycle.v1'] === 'always-live' && !['draft', 'scheduled'].includes(page.lifecycle);
    const syncedStatements=await syncedGuards(ctx,saved,old);
    const responseBlocks=await Promise.all(next.map(async(b,i)=>saved[i]!.blockType===b.blockType?b:{...saved[i]!,content:await labelForReader(ctx,saved[i]!.content)}));
    return { statements: [...syncedStatements,pageGuard(ctx, page, input.expectedRevisionId), ...removed.flatMap(b => [ctx.db.prepare('UPDATE comment_threads SET block_id=NULL,orphaned=1 WHERE block_id=?').bind(b.id), ctx.db.prepare('DELETE FROM page_blocks WHERE id=?').bind(b.id)]), ...saved.map(b => ctx.db.prepare('INSERT INTO page_blocks (id,page_id,parent_block_id,block_type,content_json,tree_position,revision_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_block_id=excluded.parent_block_id,block_type=excluded.block_type,content_json=excluded.content_json,tree_position=excluded.tree_position,revision_id=excluded.revision_id,updated_at=excluded.updated_at').bind(b.id, pageId, b.parentBlockId, b.blockType, JSON.stringify(b.content), b.treePosition, b.revisionId, ctx.now, ctx.now)), revisionUpdate(ctx, pageId, revisionId, live), await revisionStatement(ctx, pageId, revisionId, { blocks: saved, properties: await properties(ctx, page) }), ...anchorUpdates(ctx, pageId, saved),...await taskEffects(ctx,pageId,saved,old,revisionId), ...await mentionEffects(ctx,pageId,page.container_id,saved,old,revisionId), ...contentEvent(ctx, pageId, revisionId, 'structure')], entity: { id: pageId, kind: 'page', revisionId }, value: { pageId, revisionId, blocks: responseBlocks } };
}
