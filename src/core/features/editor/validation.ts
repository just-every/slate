import {fileReferenceSchema} from './file-cards/reference';
import {tableSchema} from './tables/schema';
import {taskReportDefinitionSchema} from '../work-items/report-definition';
import {contentQueryDefinitionSchema} from './query-definition';
import { validDate } from '../work-items/time';
import { contentLimits } from './limits';
import { z } from 'zod';
import { ApiProblem } from '../../app/problems';
import type { JsonValue } from '../../shared/api/common';
import type { BlockInput } from '../pages/types';
export const safeUrl = (value: string) => {
    try {
        const u = new URL(value);
        return ['https:', 'http:', 'mailto:'].includes(u.protocol) && !u.username && !u.password;
    }
    catch {
        return value.startsWith('/app/') || value.startsWith('/api/media/');
    }
};
const span = z.object({ text: z.string(), status: z.object({colour:z.enum(['grey','blue','green','yellow','red','purple'])}).strict().optional(), marks: z.array(z.enum(['bold', 'italic', 'underline', 'strikethrough', 'code'])).optional(), colour: z.enum(['yellow', 'blue', 'green', 'red', 'purple']).optional(), link: z.object({ href: z.string().refine(safeUrl) }).optional(), mention: z.object({ kind: z.enum(['person', 'group', 'page', 'date']), label: z.string().optional(), id: z.string().optional() }).optional(), commentAnchorId: z.string().optional() }).strict().refine(value=>value.mention?.kind!=='group'||!!value.mention.id,'A group mention requires its group ID.').refine(value=>!value.status || (value.text.trim().length>0 && value.text.length<=80),'Status labels need 1 to 80 characters.').transform(value => value.mention ? {...value, mention: {...value.mention, label: value.mention.label ?? value.text}} : value);
const rich = z.array(span);
const schemas: Record<string, z.ZodType> = {
    'synced-source': z.object({text:rich}).strict(),
    'synced-reference': z.object({sourcePageId:z.string().min(1).max(160),sourceBlockId:z.string().min(1).max(160),staticId:z.string().min(1).max(160).optional()}).strict(),
    columns: z.object({count:z.number().int().min(2).max(5)}).strict(),
    column: z.object({}).strict(),
    'file-card':fileReferenceSchema,
    paragraph: z.object({ text: rich }), heading: z.object({ text: rich, level: z.number().int().min(1).max(3), number: z.string().optional() }),
    list: z.object({ variant: z.enum(['bulleted', 'numbered', 'toggle']), start: z.number().int().optional(), items: z.array(z.object({ id: z.string(), text: rich, open: z.boolean().optional(), detail: rich.optional() })) }),
    quote: z.object({ text: rich, attribution: z.string().optional() }), divider: z.object({}), callout: z.object({ text: rich, tone: z.enum(['neutral', 'accent', 'good', 'warn', 'danger']), icon: z.string().optional() }),
    expandable: z.object({ summary: z.string(), open: z.boolean(), content: rich }), table: tableSchema,
    code: z.object({ language: z.string(), languages: z.array(z.string()).optional(), code: z.string() }), task: z.object({ text: rich, done: z.boolean(), assigneeMemberId: z.string().min(1).max(160).nullable().optional(), dueDate: z.string().refine(validDate).nullable().optional(), creatorMemberId: z.string().nullable().optional(), completedBy: z.unknown().optional(), completedAtLabel: z.string().optional(), completedByMemberId: z.string().nullable().optional(), completedAt: z.string().nullable().optional() }),
    media: z.object({ kind: z.enum(['image', 'video', 'audio', 'file']), source: z.object({ url: z.string().refine(safeUrl), name: z.string(), fileId: z.string().optional(), sizeLabel: z.string().optional(), contentType: z.string().optional() }).nullable(), caption: z.string(), alt: z.string() }),
    'link-card': z.object({ url: z.string().refine(safeUrl), display: z.enum(['plain', 'inline', 'card', 'embed']), previewState: z.enum(['ready', 'loading', 'refused', 'failed']), preview: z.object({ title: z.string(), description: z.string().optional(), siteName: z.string().optional(), iconLabel: z.string().optional(), iconData: z.string().max(Math.ceil(contentLimits.maximumUrlFetchBytes * 4 / 3) + 128).regex(/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[A-Za-z0-9+/]+=*$/).optional() }).optional(), previewMessage: z.string().optional() }),
    'content-query': z.object({definition:contentQueryDefinitionSchema}),
    'table-of-contents': z.object({minLevel:z.number().int().min(1).max(3),maxLevel:z.number().int().min(1).max(3),style:z.enum(['flat','nested'])}).refine(value=>value.minLevel<=value.maxLevel),
    'task-report':z.object({definition:taskReportDefinitionSchema}),
};
export function validateBlockContent(type: string, content: JsonValue): JsonValue {
    const schema = schemas[type];
    if (!schema)
        throw new ApiProblem(400, 'INVALID_BLOCK', 'Unsupported block type.');
    const result = schema.safeParse(content);
    if (!result.success)
        throw new ApiProblem(400, 'INVALID_BLOCK', 'Invalid block content.', { issues: result.error.issues.map(i => i.message) });
    return result.data as JsonValue;
}
export function validateBlockTree(blocks: BlockInput[]): BlockInput[] {
    if (blocks.length > contentLimits.capacityEstimate.blocksPerPage)
        throw new ApiProblem(413, 'BODY_LIMIT', 'Too many blocks.');
    const map = new Map(blocks.map(b => [b.id, b]));
    if (map.size !== blocks.length)
        throw new ApiProblem(400, 'DUPLICATE_BLOCK', 'Block IDs must be unique.');
    for (const b of blocks) {
        if(['synced-source','synced-reference'].includes(b.blockType)&&blocks.some(child=>child.parentBlockId===b.id))throw new ApiProblem(400,'INVALID_SYNCED_SOURCE','Synced paragraphs cannot contain child blocks.');
        const parent = b.parentBlockId ? map.get(b.parentBlockId) : undefined;
        if (b.blockType === 'column' && parent?.blockType !== 'columns')
            throw new ApiProblem(400, 'INVALID_COLUMNS', 'A column must belong to a columns section.');
        if (parent?.blockType === 'columns' && b.blockType !== 'column')
            throw new ApiProblem(400, 'INVALID_COLUMNS', 'Place blocks inside a column.');
        if (b.blockType === 'columns') {
            validateBlockContent(b.blockType, b.content);
            const children = blocks.filter(child => child.parentBlockId === b.id);
            if (children.length !== (b.content as {count:number}).count || children.some(child=>child.blockType !== 'column'))
                throw new ApiProblem(400, 'INVALID_COLUMNS', 'A columns section needs 2 to 5 matching columns.');
            let ancestor = parent;
            const ancestors=new Set<string>([b.id]);
            while (ancestor) {
                if(ancestors.has(ancestor.id))throw new ApiProblem(400,"INVALID_BLOCK_TREE","Block parent is cyclic.");
                ancestors.add(ancestor.id);
                if (ancestor.blockType === 'columns' || ancestor.blockType === 'column')
                    throw new ApiProblem(400, 'INVALID_COLUMNS', 'Columns cannot be nested inside a column.');
                ancestor = ancestor.parentBlockId ? map.get(ancestor.parentBlockId) : undefined;
            }
        }
    }
    return blocks.map(b => {
        if (!b.id || !b.treePosition || b.id.length > 160)
            throw new ApiProblem(400, 'INVALID_BLOCK', 'Block ID and order are required.');
        let p = b.parentBlockId;
        const seen = new Set([b.id]);
        while (p) {
            if (seen.has(p) || !map.has(p))
                throw new ApiProblem(400, 'INVALID_BLOCK_TREE', 'Block parent is missing or cyclic.');
            seen.add(p);
            p = map.get(p)!.parentBlockId;
        }
        return { ...b, content: validateBlockContent(b.blockType, b.content) };
    });
}
export function plainContent(value: unknown): string {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.map(plainContent).join(' ');
    if(value&&typeof value==='object'&&'mention' in value){const span=value as {mention?:{label?:string};text?:string};return span.mention?.label??span.text??'';} if (value && typeof value === 'object')
        return Object.entries(value).filter(([k]) => ['text', 'code', 'summary', 'content', 'cells', 'rows', 'columns', 'caption', 'alt', 'items', 'detail', 'attribution'].includes(k)).map(([, v]) => plainContent(v)).join(' ');
    return '';
}
