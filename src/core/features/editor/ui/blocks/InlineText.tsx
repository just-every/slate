import {ApiError} from '../../../../client/transport';
import {RequestState} from '../../../../app/ui/RequestState';
import {usePageLinkCard} from './usePageLinkCard';
import type { ReactNode } from "react";
import { cn } from "../../../../ui";
import type { InlineColour, InlineSpan, RichText } from "../types";

/**
 * `BLOCK-002` — bold, italic, underline, strikethrough, inline code, colour,
 * links and mentions. Nothing else renders here, because nothing else is stored.
 */

const colourClass: Record<InlineColour, string> = {
  yellow: "bg-hl-yellow",
  blue: "bg-hl-blue",
  green: "bg-hl-green",
  red: "bg-hl-red",
  purple: "bg-hl-purple",
};

const mentionPrefix: Record<NonNullable<InlineSpan["mention"]>["kind"], string> = {
  person: "@",
  group: "@",
  page: "",
  date: "",
};

function Mention({ span }: { span: InlineSpan }) {
  const mention = span.mention;
  if (!mention) return null;
  return (
    <span
      className={cn(
        "rounded-control px-1 py-0.5 text-[0.95em]",
        (mention.kind === "person" || mention.kind === "group") ? "bg-accent-soft text-accent" : "bg-sidebar-hover text-ink",
        mention.kind === "page" ? "underline decoration-line-strong underline-offset-2" : "",
      )}
      data-mention-kind={mention.kind}
      data-reminder-date={mention.kind==='date'?mention.id:undefined}
      title={mention.kind==='date'?'Set a reminder for this date':undefined}
    >
      {mentionPrefix[mention.kind]}
      {mention.kind==='page' && mention.id && mention.available!==false ? <a href={`/app/pages/${encodeURIComponent(mention.id)}`}>{mention.label}</a>:mention.kind==='date' ? new Date(`${mention.id}T12:00:00`).toLocaleDateString() : mention.label}
      {mention.kind==='page' && mention.state==='restricted' ? <button type="button" data-request-page-access={mention.id}>Request access</button>:null}
      {mention.state && mention.state!=='live'?<span className="text-small"> · {mention.state==='restricted'?'Unavailable':mention.state}</span>:null}
    </span>
  );
}

function withMarks(span: InlineSpan, node: ReactNode): ReactNode {
  const marks = span.marks ?? [];
  let out = node;
  if (marks.includes("code")) {
    out = (
      <code className="rounded-[3px] bg-sidebar-hover px-1 py-0.5 font-mono text-[0.9em] text-ink">{out}</code>
    );
  }
  if (marks.includes("strikethrough")) out = <s>{out}</s>;
  if (marks.includes("underline")) out = <u className="underline-offset-2">{out}</u>;
  if (marks.includes("italic")) out = <em>{out}</em>;
  if (marks.includes("bold")) out = <strong className="font-semibold">{out}</strong>;
  if (span.colour) {
    out = <span className={cn("rounded-[3px] px-0.5", colourClass[span.colour])}>{out}</span>;
  }
  return out;
}

function PageLink({span,children}:{span:InlineSpan;children:ReactNode}) {
  const href=span.link!.href;
  const page=usePageLinkCard(href);
  if(!page.internal)return <a className="text-accent underline underline-offset-2" href={href} rel="noreferrer" target="_blank">{children}</a>;
  if(page.resource.error&&!(page.resource.error instanceof ApiError&&page.resource.error.status===404&&page.resource.error.code==='NOT_FOUND'))return <RequestState loading={false} error={page.resource.error} retry={page.resource.reload}/>;
  const reference=page.resource.data;
  return <span data-page-reference="" data-slate-atomic-length={span.text.length} contentEditable={false}>
    {reference?<><a className="text-accent underline underline-offset-2" href={href} rel="noreferrer" target="_blank">{new URL(href,'https://slate.invalid').searchParams.has('revision')?children:withMarks(span,reference.title)}</a>{reference.state!=='live'?<span className="text-small"> · {reference.state}</span>:null}</>:page.resource.error?<span>Access needed</span>:<span>Checking page access…</span>}
  </span>;
}

function Span({ span }: { span: InlineSpan }) {
  if (span.mention) return <Mention span={span} />;

  let node: ReactNode = withMarks(span,span.status?<span className={cn("inline-block rounded-full border border-line px-2 py-0.5 text-[0.85em] font-medium leading-tight",span.status.colour==='grey'?'bg-sidebar-hover text-ink':colourClass[span.status.colour])}>{span.text}</span>:span.text);

  if (span.link) {
    node = (
      <PageLink span={span}>{node}</PageLink>
    );
  }

  if (span.commentAnchorId) {
    // An anchored comment is marked by a highlight *and* an underline, never by
    // colour alone.
    node = (
      <mark
        className="bg-hl-yellow text-ink underline decoration-warn decoration-2 underline-offset-4"
        data-comment-anchor={span.commentAnchorId}
      >
        {node}
      </mark>
    );
  }

  return <>{node}</>;
}

export function InlineText({ value,canEdit=false }: { value: RichText;canEdit?:boolean }) {
  return (
    <>
      {value.map((span, index) =>
        span.text.length === 0 && !span.mention ? null : (
          <span key={index} data-inline-span={index} data-slate-atomic-length={span.mention || span.status ? span.text.length : undefined} contentEditable={span.mention || span.status ? false : undefined} style={span.status?{border:0,padding:0,background:"transparent",font:"inherit"}:undefined} data-slate-status={span.status?"":undefined} data-status-colour={span.status?.colour} role={span.status&&canEdit?"button":undefined} tabIndex={span.status&&canEdit?0:undefined} aria-label={span.status&&canEdit?`Edit status label: ${span.text}`:undefined}>
            <Span span={span} />
          </span>
        ),
      )}
    </>
  );
}
