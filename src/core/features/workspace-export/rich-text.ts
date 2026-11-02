import { safeUrl } from '../editor/validation';
import { html } from '../publishing/html';

interface Span {text?: string; colour?: string; status?: {colour: string}; mention?: {kind: string; label: string}; link?: {href: string}; marks?: string[]}
const highlights: Record<string, string> = {yellow: '#fff0bd', blue: '#dceaff', green: '#d9f0df', red: '#ffdedb', purple: '#ebdfff'};
const colours = new Set(['grey', 'blue', 'green', 'yellow', 'red', 'purple']);
const spans = (value: unknown): Span[] => Array.isArray(value) ? value : [{text: String(value ?? '')}];
export const escapeMarkdown = (value: string) => value.replace(/[\\\[\]*_`~<>]/g, '\\$&');

export function markdownText(value: unknown): string {
  return spans(value).map(span => {
    // Markdown has no underline or colour syntax; inline HTML preserves those
    // appearances in ordinary Markdown readers without changing the manifest.
    if (span.colour || span.marks?.includes('underline')) return htmlText([span]);
    const raw = span.mention?.label ?? span.text ?? '';
    let text = escapeMarkdown(raw);
    if (span.marks?.includes('code')) {
      const fence = '`'.repeat(Math.max(0, ...Array.from(raw.matchAll(/`+/g), match => match[0].length)) + 1);
      const padding = /^[` ]|[` ]$/.test(raw) ? ' ' : '';
      text = `${fence}${padding}${raw}${padding}${fence}`;
    }
    if (span.marks?.includes('strikethrough')) text = `~~${text}~~`;
    if (span.marks?.includes('italic')) text = `_${text}_`;
    if (span.marks?.includes('bold')) text = `**${text}**`;
    if (span.status && colours.has(span.status.colour)) text = `[${text}]{status:${span.status.colour}}`;
    if (span.link?.href && safeUrl(span.link.href)) text = `[${text}](${span.link.href.replace(/[\s()<>\\"]/g, char => encodeURIComponent(char))})`;
    return text;
  }).join('');
}

export function htmlText(value: unknown): string {
  return spans(value).map(span => {
    let text = html(span.mention?.label ?? span.text ?? '').replace(/\r?\n/g, '<br>');
    for (const mark of span.marks ?? []) {
      const tag = ({bold: 'strong', italic: 'em', underline: 'u', strikethrough: 's', code: 'code'} as Record<string, string>)[mark];
      if (tag) text = `<${tag}>${text}</${tag}>`;
    }
    if (span.colour && Object.hasOwn(highlights, span.colour)) text = `<mark data-slate-colour="${span.colour}" style="background-color:${highlights[span.colour]};color:inherit">${text}</mark>`;
    if (span.status && colours.has(span.status.colour)) text = `<span class="status-label" data-slate-status="${span.status.colour}">${text}</span>`;
    if (span.link?.href && safeUrl(span.link.href)) text = `<a href="${html(span.link.href)}">${text}</a>`;
    return text;
  }).join('');
}

export function pdfText(value: unknown): string {
  return spans(value).map(span => `${span.mention?.label ?? span.text ?? ''}${span.status && colours.has(span.status.colour) ? ` (${span.status.colour})` : ''}`).join('');
}
