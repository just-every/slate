import type { FeatureContext } from '../../app/feature-context';
import { readRevision } from './service';
import type { BlockView } from '../../shared/api/content';
import { ApiProblem } from '../../app/problems';

export async function compareRevisions(ctx: FeatureContext, pageId: string, leftId: string, rightId: string) {
    const [left, right] = await Promise.all([readRevision(ctx, pageId, leftId), readRevision(ctx, pageId, rightId)]);
    if (!('blocks' in left) || !('blocks' in right))
        throw new ApiProblem(409, 'DELETED_REVISION', 'A deleted revision has no content to compare.');
    const old = new Map<string, BlockView>((left.blocks as BlockView[]).map(b => [b.id, b]));
    const next = new Map<string, BlockView>((right.blocks as BlockView[]).map(b => [b.id, b]));
    return {
        leftId, rightId,
        blocks: [...new Set([...old.keys(), ...next.keys()])].map(id => {
            const before = old.get(id), after = next.get(id);
            const change = !before ? 'added' : !after ? 'removed'
                : before.blockType !== after.blockType
                    || before.parentBlockId !== after.parentBlockId
                    || before.treePosition !== after.treePosition
                    || JSON.stringify(before.content) !== JSON.stringify(after.content) ? 'changed' : 'unchanged';
            return { id, change, before: before ?? null, after: after ?? null };
        }),
        properties: { before: left.properties, after: right.properties },
    };
}
