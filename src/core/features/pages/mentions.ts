import {pageReference} from '../../shared/page-reference';
import {canonicalGroupLabels} from '../comments/group-labels';
import type { FeatureContext } from '../../app/feature-context';
import type { BlockView } from '../../shared/api/content';
import type { JsonValue } from '../../shared/api/common';
import { resolveCurrentAccessMany } from '../sharing/current-access';
import { labelPageMentions } from './mention-labels';
export { labelPageMentions };
export interface MentionResolution {
    label:string;
    available:boolean;
    state:'live'|'draft'|'scheduled'|'archived'|'trashed'|'deleted'|'restricted'|'unavailable';
    deletedAt?:string;
}
export async function resolveMentions(ctx:FeatureContext,blocks:Pick<BlockView,'content'>[]):Promise<Record<string,MentionResolution>> {
    const ids=new Set<string>();
    function collect(value:unknown) {
        if(Array.isArray(value))value.forEach(collect);
        else if(value&&typeof value==='object') {
            const record=value as Record<string,any>;
            if(record.mention?.kind==='page'&&typeof record.mention.id==='string')ids.add(record.mention.id);
            const link=pageReference(record.link?.href??record.url??'',ctx.appOrigin);
            if(link)ids.add(link.id);
            Object.values(record).forEach(collect);
        }
    }
    blocks.forEach(block=>collect(block.content));
    return resolvePageReferences(ctx,[...ids]);
}
/** References share one current-authority and reader-safe title projection. */
export async function resolvePageReferences(ctx:FeatureContext,ids:string[]):Promise<Record<string,MentionResolution>> {
    if(!ids.length)return {};
    const access=await resolveCurrentAccessMany(ctx,[...ids],{includeTrashed:true,includeDeleted:true});
    const labels:Record<string,MentionResolution>={};
    for(const id of ids) {
        // Lifecycle does not grant disclosure: a restricted target reveals no title or state.
        const decision=access.get(id)?.decision;
        if(!decision?.allowed){labels[id]={label:'Restricted page',available:false,state:'restricted'};continue;}
        const row=await ctx.db.prepare('SELECT title,lifecycle,archived_at,trashed_at,deleted_at,working_revision_id,published_revision_id FROM pages WHERE id=? AND workspace_id=?').bind(id,ctx.actor.workspaceId).first<{title:string;lifecycle:string;archived_at:string|null;trashed_at:string|null;deleted_at:string|null;working_revision_id:string;published_revision_id:string|null}>();
        if(!row){labels[id]={label:'Unavailable page',available:false,state:'unavailable'};continue;}
        if(row.deleted_at){labels[id]={label:'Deleted page',available:false,state:'deleted',deletedAt:row.deleted_at};continue;}
        let label=row.title;
        if(!['edit','full'].includes(decision.level!)&&row.published_revision_id&&row.published_revision_id!==row.working_revision_id) {
            const revision=await ctx.db.prepare('SELECT properties_json FROM page_revisions WHERE id=? AND page_id=? AND deleted_at IS NULL').bind(row.published_revision_id,id).first<{properties_json:string}>();
            if(!revision){labels[id]={label:'Unavailable page',available:false,state:'unavailable'};continue;}
            label=JSON.parse(revision.properties_json).title;
        }
        const state:MentionResolution['state']=row.trashed_at?'trashed':row.archived_at?'archived':row.lifecycle==='draft'?'draft':row.lifecycle==='scheduled'?'scheduled':'live';
        labels[id]={label,available:!row.trashed_at,state};
    }
    return labels;
}
/** The given content with every page mention labelled for this reader. */
export async function labelForReader<T>(ctx:FeatureContext,value:T):Promise<T> {
    const mentions=await resolveMentions(ctx,[{content:value as JsonValue}]);
    return canonicalGroupLabels(ctx,labelPageMentions(value,id=>mentions[id]?.label??'Unavailable page',ctx.appOrigin));
}
/**
 * The given content labelled for everyone it is shown to at once, such as an
 * evidence packet prepared for an audience: each mention shows only what every
 * one of them may see.
 */
export async function labelForAudience<T>(readers:FeatureContext[],value:T):Promise<T> {
    if(readers.length===1)return labelForReader(readers[0]!,value);
    const each=await Promise.all(readers.map(reader=>resolveMentions(reader,[{content:value as JsonValue}])));
    const labels:Record<string,string>={};
    for(const id of new Set(each.flatMap(mentions=>Object.keys(mentions)))) {
        const seen=each.map(mentions=>mentions[id]??{label:'Unavailable page',available:false,state:'unavailable' as const});
        const hidden=seen.find(item=>['restricted','unavailable','deleted'].includes(item.state));
        if(hidden||new Set(seen.map(item=>item.label)).size===1){labels[id]=(hidden??seen[0]!).label;continue;}
        // Editors see the working title and readers the published one; all of them may see the published one.
        const published=await readers[0]!.db.prepare('SELECT r.properties_json FROM pages p JOIN page_revisions r ON r.id=p.published_revision_id AND r.page_id=p.id AND r.deleted_at IS NULL WHERE p.id=? AND p.workspace_id=?').bind(id,readers[0]!.actor.workspaceId).first<{properties_json:string}>();
        labels[id]=published?String(JSON.parse(published.properties_json).title):'Restricted page';
    }
    return labelPageMentions(value,id=>labels[id]??'Unavailable page',readers[0]?.appOrigin);
}
