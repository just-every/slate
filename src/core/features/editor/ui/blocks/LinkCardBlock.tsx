import {ApiError} from '../../../../client/transport';
import {useEffect,useState} from 'react';
import {providerEmbed} from '../../embeds/providers';
import {useTaskPage} from './TaskPageContext';
import { ExternalLink, Link as LinkIcon, TriangleAlert } from "lucide-react";
import { Button, cn } from "../../../../ui";
import type { BlockRenderProps, LinkCardBlockData, LinkCardDisplay } from "../types";
import {usePageLinkCard} from './usePageLinkCard';
import {TrustBadge} from '../../../search/ui/TrustBadge';
import {RequestState} from '../../../../app/ui/RequestState';

const displayOptions: { value: LinkCardDisplay; label: string }[] = [
  { value: "plain", label: "Plain link" },
  { value: "inline", label: "Inline card" },
  { value: "card", label: "Block card" },
];

function PlainLink({ url }: { url: string }) {
  return (
    <a className="text-body break-all text-accent underline underline-offset-2" href={url} rel="noreferrer" target="_blank">
      {url}
    </a>
  );
}

function DisplaySwitch({ block, onChange }: { block: LinkCardBlockData; onChange: (next: LinkCardBlockData) => void }) {
  return (
    <div aria-label="How this link is shown" className="flex flex-wrap items-center gap-1" role="group">
      {[...displayOptions,...(providerEmbed(block.url)?[{value:'embed' as const,label:'Embed'}]:[])].map((option) => (
        <Button
          aria-pressed={block.display === option.value}
          className={cn(block.display === option.value ? "bg-sidebar-hover text-ink" : "")}
          key={option.value}
          onClick={() => onChange({ ...block, display: option.value })}
          size="sm"
          variant="ghost"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * `BLOCK-009` — a pasted URL as a plain link, an inline card or a block card.
 * A refused or failed preview leaves the plain link and says why; the URL is
 * stored exactly as pasted either way.
 */
export function LinkCardBlock({ block, canEdit, onChange, actions }: BlockRenderProps<LinkCardBlockData>) {
  const page=usePageLinkCard(block.url);
  const parent=useTaskPage();
  const [loaded,setLoaded]=useState<string|null>(null);
  const embed=block.display==='embed'?providerEmbed(block.url):null;
  const [refused,setRefused]=useState(false);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    setRefused(false);setLoaded(null);setReady(false);
    if(!embed||!parent)return;
    const controller=new AbortController();
    fetch(`/api/pages/${encodeURIComponent(parent.pageId)}/embeds/${encodeURIComponent(block.id)}/status`,{signal:controller.signal,credentials:'same-origin'})
      .then(async response=>{if(response.ok){const value=await response.json() as {verdict?:string};if(value.verdict==='refuses')setRefused(true);}}).catch(()=>{});
    return ()=>controller.abort();
  },[block.url,block.display,parent?.pageId,block.id]);
  useEffect(()=>{if(!loaded||ready)return;const timer=setTimeout(()=>{setRefused(true);setLoaded(null);},8000);return()=>clearTimeout(timer);},[loaded,ready]);
  if(embed && parent && !refused)return <div className="my-2 flex flex-col gap-2">
    <a href={block.url} target="_blank" rel="noreferrer" className="break-all text-accent underline">{block.preview?.title??embed.provider}</a>
    {loaded===block.url?<><iframe title={`${embed.provider} embed`} src={`/api/pages/${encodeURIComponent(parent.pageId)}/embeds/${encodeURIComponent(block.id)}`} onLoad={()=>setReady(true)} sandbox={embed.sandbox} referrerPolicy="no-referrer" allow="fullscreen" className="w-full rounded-card border border-line" style={{height:420}}/><Button onClick={()=>setLoaded(null)} variant="secondary">Show link instead</Button></>:<Button onClick={()=>{setReady(false);setLoaded(block.url);}} variant="secondary">Load {embed.provider} embed</Button>}
    <p className="text-small text-ink-muted">Loading connects to {embed.provider}. If unavailable, open the original link above.</p>
    {canEdit?<DisplaySwitch block={block} onChange={onChange}/>:null}
  </div>;
  if(page.internal)return <div className="my-2 flex flex-col gap-2">
    {page.checking?<p role="status">Checking page access…</p>:page.resource.error instanceof ApiError&&page.resource.error.status===404?<p>Access needed</p>:<RequestState loading={page.resource.loading} error={page.resource.error} retry={page.resource.reload}>
      {page.resource.data?<>
        {block.display==='plain'?<a className="text-body break-all text-accent underline underline-offset-2" href={page.resource.data.href}>{page.resource.data.title}</a>:block.display==='inline'?(
          <a className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-line px-1.5 py-0.5 align-middle text-body text-ink hover:bg-sidebar-hover" href={page.resource.data.href}>
            <LinkIcon aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted"/>
            <span className="truncate">{page.resource.data.title}</span>
          </a>
        ):(
          <a className="flex items-start gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:bg-sidebar-hover" href={page.resource.data.href}>
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-control bg-sidebar-hover text-micro font-medium text-ink-muted"><LinkIcon aria-hidden="true" className="size-3.5"/></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-medium text-ink">{page.resource.data.title}</span>
              <span className="mt-1 block truncate text-small text-ink-muted">{block.url}</span>
            </span>
          </a>
        )}
        {page.resource.data.state!=='live'?<span className="text-small text-ink-muted">{page.resource.data.state}</span>:null}
        {page.resource.data.trust?<TrustBadge trust={page.resource.data.trust}/>:null}
      </>:null}
    </RequestState>}
    {canEdit?<DisplaySwitch block={block} onChange={onChange}/>:null}
  </div>;
  const failed = refused || block.previewState === "refused" || block.previewState === "failed";
  const preview = block.preview;

  return (
    <div className="my-2 flex flex-col gap-2">
      {failed || !preview || block.display === "plain" ? (
        <PlainLink url={block.url} />
      ) : block.display === "inline" ? (
        <a
          className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-line px-1.5 py-0.5 align-middle text-body text-ink hover:bg-sidebar-hover"
          href={block.url}
          rel="noreferrer"
          target="_blank"
        >
          <LinkIcon aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
          <span className="truncate">{preview.title}</span>
        </a>
      ) : (
        <a
          className="flex items-start gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:bg-sidebar-hover"
          href={block.url}
          rel="noreferrer"
          target="_blank"
        >
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-control bg-sidebar-hover text-micro font-medium text-ink-muted">
            {preview.iconLabel ?? <ExternalLink aria-hidden="true" className="size-3.5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui font-medium text-ink">{preview.title}</span>
            {preview.description ? (
              <span className="mt-0.5 block line-clamp-2 text-small text-ink-muted">{preview.description}</span>
            ) : null}
            <span className="mt-1 block truncate text-small text-ink-muted">{preview.siteName ?? block.url}</span>
          </span>
        </a>
      )}

      {failed ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-ink-muted" role="status">
          <TriangleAlert aria-hidden="true" className="size-3.5 text-warn" />
          {refused ? "The provider does not allow embedding. Open the original link." : block.previewMessage ??
            (block.previewState === "refused"
              ? "A preview was refused for this address, so the link is shown as written."
              : "A preview could not be fetched, so the link is shown as written.")}
          {actions?.onRetryPreview ? (
            <Button onClick={() => actions.onRetryPreview?.(block.id)} size="sm" variant="secondary">
              Try the preview again
            </Button>
          ) : null}
        </p>
      ) : null}

      {canEdit ? <DisplaySwitch block={block} onChange={onChange} /> : null}
    </div>
  );
}
