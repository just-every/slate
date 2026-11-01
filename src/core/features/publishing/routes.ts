import {observedEmbed,embedDeployment} from '../editor/embeds/refusal';
import {providerEmbed} from '../editor/embeds/providers';
import {projectPublicSynced} from '../editor/synced/read';
import {embedDocument} from '../editor/embeds/document';
import { publishingExposure } from "./exposure";
import { publicHeader } from './header';
import { publicQueries } from './queries';
import { publicViewStatement } from '../analytics/public-views';
import { createUlid } from '../../shared/ulid';
import { Hono } from 'hono';
import type { AppEnvironment } from '../../app/types';
import { featureContext } from '../../app/feature-context';
import { publishPublicPage, publicPage, publicTargets } from './service';
import { labelPageMentions } from '../pages/mention-labels';
import { renderPublicDocument } from './render';
import { publicDocumentHeaders, renderUnavailablePublicDocument } from './document-shell';
import { ApiProblem } from '../../app/problems';
import { requirePageLevel } from '../sharing/current-access';
import { mediaResponse } from '../media/service';
async function authorizePublic(c: import('hono').Context<AppEnvironment>, p: Record<string, any>) {
    if (c.env.RER_DEMO === '1' && !c.get('member'))
        throw new ApiProblem(404, 'NOT_FOUND', 'This link is no longer available.');
    if (p.anonymous_access === 'forbidden' || p.workspace_anonymous === 'forbidden') {
        const member = c.get('member');
        if (!member)
            throw new ApiProblem(404, 'NOT_FOUND', 'This link is no longer available.');
        await requirePageLevel(featureContext(c), p.page_id, 'view');
    }
}
export function createPublishingRoutes() {
    return new Hono<AppEnvironment>().get('/:id',async c=>{return c.json(await publishingExposure(featureContext(c),c.req.param('id')));}).post('/:id', async (c) => {
        const input = await c.req.json();
        const host = c.get('runtimeConfig')?.publicPageHost ?? new URL(c.req.url).host;
        if (input.host !== host)
            throw new ApiProblem(400, 'UNCONFIGURED_PUBLIC_HOST', 'Use the deployment public host.');
        return c.json(await publishPublicPage(featureContext(c), c.req.param('id'), input));
    });
}
export function createPublicPagesRoutes() {
    return new Hono<AppEnvironment>().get('/:slug/embeds/:blockId',async c=>{
      const p=await publicPage(c.env.DB,new URL(c.req.url).host,c.req.param('slug'));
      await authorizePublic(c,p);
      const block=JSON.parse(p.body_json).find((b:any)=>b.id===c.req.param('blockId') && b.blockType==='link-card');
      if(!block)throw new ApiProblem(404,'NOT_FOUND','Not found.');
      const verdict=await observedEmbed(c.env.DB,p.workspace_id,embedDeployment(c.get('runtimeConfig')?.appUrl??new URL(c.req.url).origin,c.get('runtimeConfig')?.publicPageHost),block.content.url);
      if(verdict?.verdict!=='embeddable')return c.html('<p>The provider does not allow embedding. Open the original link.</p>');
      return embedDocument(block.content);
    }).get('/:slug/media/:id', async (c) => {
        const p = await publicPage(c.env.DB, new URL(c.req.url).host, c.req.param('slug'));
        await authorizePublic(c, p);
        const f = await c.env.DB.prepare('SELECT * FROM files WHERE id=? AND page_id=? AND deleted_at IS NULL').bind(c.req.param('id'), p.page_id).first<Record<string, any>>();
        if (!f)
            throw new ApiProblem(404, 'NOT_FOUND', 'Not found.');
        const blocks = JSON.parse(p.body_json), props = JSON.parse(p.properties_json);
        if (!(props.coverFileId === f.id || props.icon === `file:${f.id}` || blocks.some((b: any) => b.blockType === 'media' && (b.content.source?.fileId === f.id || b.content.source?.url === `/api/media/${f.id}`))))
            throw new ApiProblem(404, 'NOT_FOUND', 'Not found.');
        const display = c.req.query('display'), inline = !!display && blocks.some((b: any) => b.id === display && b.blockType === 'media' && b.content.kind !== 'file' && (b.content.source?.fileId === f.id || b.content.source?.url === `/api/media/${f.id}`));
        return mediaResponse(c.env.FILES, f, inline);
    }).get('/*', async (c) => { try { const p = await publicPage(c.env.DB, new URL(c.req.url).host, decodeURIComponent(new URL(c.req.url).pathname.slice(3)),c.req.query('revision')); await authorizePublic(c, p); if (!c.get('member'))
        await publicViewStatement(c.env.DB, { viewId: createUlid(), pageId: p.page_id, host: new URL(c.req.url).host, slug: p.slug, now: new Date().toISOString() }).run(); p.body_json=JSON.stringify(await projectPublicSynced(c.env.DB,p,JSON.parse(p.body_json))); const { links, titles } = await publicTargets(c.env.DB, p), shown = await publicHeader(c.env.DB, await publicQueries(c.env.DB, p), c.req.query('q')??'');
        const refusedHosts=new Set<string>();
        for(const block of JSON.parse(p.body_json)){if(block.blockType!=='link-card')continue;const embed=providerEmbed(block.content.url);if(embed&&(await observedEmbed(c.env.DB,p.workspace_id,embedDeployment(c.get('runtimeConfig')?.appUrl??new URL(c.req.url).origin,c.get('runtimeConfig')?.publicPageHost),block.content.url))?.verdict!=='embeddable')refusedHosts.add(new URL(embed.url).hostname);}
        // LINK-004: an anonymous reader sees the title of a mentioned page only when that page is public too.
        return c.html(renderPublicDocument({ ...shown, body_json: JSON.stringify(labelPageMentions(JSON.parse((shown as Record<string, any>).body_json), id => titles[id] ?? 'Restricted page')) }, links, refusedHosts), 200, { 'X-Robots-Tag': p.indexable ? 'index,follow' : 'noindex,nofollow', ...publicDocumentHeaders });
        } catch (cause) {
            if (cause instanceof ApiProblem && cause.status === 404)
                return c.html(renderUnavailablePublicDocument(), 404, { ...publicDocumentHeaders, 'X-Robots-Tag': 'noindex,nofollow' });
            throw cause;
        }
    });
}
