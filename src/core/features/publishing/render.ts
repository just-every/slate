import {layoutStyles} from '../editor/layout';
import {renderTable} from '../editor/tables/render';
import type {TableContent} from '../editor/tables/model';
import {providerEmbed} from '../editor/embeds/providers';
import { socialMetadata, renderPublicHeader } from './header-render';
import { publicDocumentShell } from './document-shell';
import { html } from './html';
export { html } from './html';
import type { BlockView } from '../../shared/api/content';
import { safeUrl } from '../editor/validation';
import { headingAnchor, tocEntries, type TableOfContentsSettings } from '../editor/table-of-contents';
import { renderTocList } from './toc-render';
/** Keep exact revision addresses when an internal citation is projected onto its public exposure. */
function publicHref(value:string,links:Record<string,string>):string|undefined {
    if (!value.startsWith('/app/')) return value;
    const source=new URL(value,'https://slate.invalid'),match=/^\/app\/pages\/([^/]+)\/?$/.exec(source.pathname);
    let id:string|undefined;
    try { id=match?decodeURIComponent(match[1]):undefined; } catch { return undefined; }
    const exposed=id?links[id]:undefined;
    if (!exposed) return undefined;
    const target=new URL(exposed,'https://slate.invalid');
    if (source.searchParams.has('revision')) target.searchParams.set('revision',source.searchParams.get('revision')!);
    target.hash=source.hash;
    return exposed.startsWith('/')?`${target.pathname}${target.search}${target.hash}`:target.href;
}
function rich(value: any, links: Record<string, string>): string { if (!Array.isArray(value))
    return html(value ?? ''); return value.map(span => { let text = (span.mention?.kind === 'person' ? '@' : '') + html(span.mention?.label ?? span.text ?? '').replace(/\r?\n/g, '<br>'); for (const mark of span.marks ?? []) {
    const tag = ({ bold: 'strong', italic: 'em', underline: 'u', strikethrough: 's', code: 'code' } as Record<string, string>)[mark];
    if (tag)
        text = `<${tag}>${text}</${tag}>`;
} if (span.status && ['grey', 'blue', 'green', 'yellow', 'red', 'purple'].includes(span.status.colour))
    text = `<span class="status-label" data-slate-status="${span.status.colour}">${text}</span>`; if (span.colour && ['yellow', 'blue', 'green', 'red', 'purple'].includes(span.colour))
    text = `<mark class="${span.colour}">${text}</mark>`; let href = span.link?.href; if (span.mention?.kind === 'page')
    href = links[span.mention.id]; if (typeof href === 'string' && href.startsWith('/app/'))
    href = publicHref(href,links); if (href && (safeUrl(href) || href.startsWith('/p/')))
    text = `<a${span.mention ? ' class="mention"' : ''} href="${html(href)}" rel="noopener noreferrer">${text}</a>`; else if (span.mention) text = `<span class="mention">${text}</span>`; return text; }).join(''); }
function renderBlock(b: BlockView, slug: string, links: Record<string, string>, blocks: BlockView[], refusedHosts: Set<string>) { const c = b.content as Record<string, any>, id = html(b.id), text = rich(c.text, links); switch (b.blockType) {
    case 'synced-source': return `<section id="${id}"><p>Synced source</p><p>${text}</p></section>`;
    case 'synced-reference': return b.synced?.state==='ready'?`<section id="${id}"><p>Source: ${html(b.synced.sourceTitle)}</p><p>${rich(b.synced.text,links)}</p></section>`:`<aside id="${id}">Access needed</aside>`;
    case 'heading': return `<h${c.level} id="${html(headingAnchor(b.id))}">${text}</h${c.level}>`;
    case 'table-of-contents': return `<nav id="${id}" class="table-of-contents" aria-label="Table of contents">${renderTocList(tocEntries(blocks, c as TableOfContentsSettings))}</nav>`;
    case 'divider': return '<hr>';
    case 'code': return `<pre id="${id}"><code>${html(c.code)}</code></pre>`;
    case 'quote': return `<blockquote id="${id}">${text}${c.attribution ? `<cite>${html(c.attribution)}</cite>` : ''}</blockquote>`;
    case 'callout': return `<aside id="${id}">${html(c.icon)} ${text}</aside>`;
    case 'expandable': return `<details id="${id}"><summary>${html(c.summary)}</summary>${rich(c.content, links)}</details>`;
    case 'task': return `<p id="${id}" class="task" data-done="${!!c.done}"><span class="task-marker" role="img" aria-label="${c.done ? 'Completed' : 'Not completed'}">${c.done ? '☑' : '☐'}</span><span class="task-text">${text}</span></p>`;
    case 'list': {
        const tag = c.variant === 'numbered' ? 'ol' : 'ul';
        return `<${tag} id="${id}">${(c.items ?? []).map((item: any) => `<li>${c.variant === 'toggle' ? `<details><summary>${rich(item.text, links)}</summary>${rich(item.detail, links)}</details>` : rich(item.text, links)}</li>`).join('')}</${tag}>`;
    }
    case 'table': return renderTable(c as TableContent, b.id);
    case 'media': {
        if (!c.source?.fileId)
            return `<p>${html(c.caption || c.source?.name || '')}</p>`;
        const base = `/p/${encodeURIComponent(slug)}/media/${encodeURIComponent(c.source.fileId)}`, url = `${base}?display=${encodeURIComponent(b.id)}`;
        return c.kind === 'image' ? `<figure><img src="${url}" alt="${html(c.alt)}"><figcaption>${html(c.caption)}</figcaption></figure>` : c.kind === 'audio' ? `<audio controls src="${url}"></audio>` : c.kind === 'video' ? `<video controls src="${url}"></video>` : `<a href="${base}">${html(c.source.name)}</a>`;
    }
    case 'file-card': return `<p id="${id}"><a href="${html(c.url)}" rel="noopener noreferrer">${html(c.provider)} file</a></p>`;
    case 'link-card': {
        const embed=c.display==='embed'?providerEmbed(c.url):null;
        if(embed && refusedHosts.has(new URL(embed.url).hostname))return `<section id="${id}"><p><a href="${html(c.url)}" rel="noreferrer">${html(c.preview?.title??embed.provider)}</a></p><p>The provider does not allow embedding. Open the original link.</p></section>`;
        if(embed) {
          const name=`embed-${id}`,route=`/p/${encodeURIComponent(slug)}/embeds/${encodeURIComponent(b.id)}`;
          return `<section id="${id}"><p><a href="${html(c.url)}" rel="noreferrer">${html(c.preview?.title??embed.provider)}</a></p><form data-slate-embed action="${route}" target="${name}" method="get"><button type="submit" class="public-action">Load ${html(embed.provider)} embed</button><p data-embed-message>This connects to ${html(embed.provider)}. If unavailable, open the original link above.</p></form><iframe hidden name="${name}" title="${html(embed.provider)} embed" sandbox="${embed.sandbox}" referrerpolicy="no-referrer" allow="fullscreen" style="width:100%;height:420px;border:0"></iframe></section>`;
        }
        const url = publicHref(c.url,links);
        return url && (safeUrl(url) || url.startsWith('/p/')) ? `<p><a href="${html(url)}" rel="noopener noreferrer">${html(c.preview?.title ?? c.url)}</a></p>` : `<p>${html(c.preview?.title ?? c.url)}</p>`;
    }
    case 'task-report': return `<aside id="${id}">Sign in to view this task report.</aside>`;
    case 'content-query': return `<ul>${(c.results ?? []).map((r: any) => `<li><a href="${html(r.url)}">${html(r.title)}</a></li>`).join('')}</ul>`;
    default: return `<p id="${id}">${text}</p>`;
} }
export function renderPublicDocument(exposure: Record<string, any>, links: Record<string, string> = {}, refusedHosts: Set<string> = new Set()) {
    const properties = JSON.parse(exposure.properties_json), blocks: BlockView[] = JSON.parse(exposure.body_json);
    const byParent = new Map<string | null, BlockView[]>();
    for (const block of blocks) {
        const parent = block.parentBlockId ?? null;
        const rows = byParent.get(parent) ?? [];
        rows.push(block);
        byParent.set(parent, rows);
    }
    function tree(parent: string | null): string {
        return (byParent.get(parent) ?? []).map(block => block.blockType==='columns' ? `<section class="slate-columns" style="--column-count:${Number((block.content as {count:number}).count)}">${tree(block.id)}</section>` : block.blockType==='column' ? `<div class="slate-column">${tree(block.id)}</div>` : `${renderBlock(block, exposure.slug, links, blocks, refusedHosts)}${byParent.has(block.id) ? `<section class="nested">${tree(block.id)}</section>` : ''}`).join('');
    }
    const media = (id: string) => `/p/${encodeURIComponent(exposure.slug)}/media/${encodeURIComponent(id)}`;
    const cover = properties.coverFileId ? `<img class="page-cover" src="${media(properties.coverFileId)}" alt="">` : '';
    const icon = properties.icon ? `<div class="page-icon">${properties.icon.startsWith('file:') ? `<img src="${media(properties.icon.slice(5))}" alt="">` : html(properties.icon)}</div>` : '';
    return publicDocumentShell({
        title: properties.title,
        theme: exposure.theme,
        indexable: !!exposure.indexable,
        metadata: socialMetadata(exposure, properties.title),
        header: renderPublicHeader(exposure),
        fullWidth: !!properties.fullWidth,
        content: `<style>${layoutStyles}</style><article class="public-document" data-typeface="${html(properties.typeface)}" data-small-text="${!!properties.smallText}">${exposure.newerRevisionExists ? '<p>A newer revision exists. This is the exact selected version.</p>' : ''}${cover}${icon}<h1 class="page-title">${html(properties.title)}</h1>${properties.byline ? `<p class="page-byline">${html(properties.byline)}</p>` : ''}<div class="page-body">${tree(null)}</div></article>`,
    });
}
