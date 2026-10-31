import type { ImportedBlock } from "../types";
import { safeImportLink } from "../url";

/**
 * Notion's Markdown export is CommonMark plus four house constructs:
 * a leading `# <title>` that repeats the filename, `Key: value` property lines
 * directly beneath it, `<aside>…</aside>` for callouts (whose first child is an
 * `<img>` icon), and a bullet followed by four-space-indented content for a
 * toggle. Database views leave `filters:` / `sort:` stanzas behind that carry no
 * content. This module turns one page's Markdown into blocks and names the
 * stanzas it dropped; links keep their raw hrefs so the workspace parser can
 * resolve them against the archive.
 */

export interface NotionUnmapped {
  label: string;
  detail?: string;
}

export interface NotionDocument {
  headingTitle?: string;
  properties: Record<string, string>;
  blocks: ImportedBlock[];
  unmapped: NotionUnmapped[];
}

interface Line {
  indent: number;
  text: string;
  /** The line with trailing whitespace removed but its indentation intact. */
  raw: string;
}

interface Cursor {
  next: number;
}

export const inlineLink = /(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\]\(([^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g;

const headingMarker = /^(#{1,6})\s+(.*)$/;
const bulletMarker = /^([-*+])\s+(.*)$/;
const taskMarker = /^[-*+]\s+\[([ xX])\]\s*(.*)$/;
const orderedMarker = /^(\d+)[.)]\s+(.*)$/;
const propertyMarker = /^([^:\s][^:]{0,119}):[ \t]*(.*)$/;
const viewMarker = /^(filters|sort):\s*$/i;
const dividerMarker = /^(?:---+|\*\*\*+|___+)$/;
const imageTag = /<img\s[^>]*?src="([^"]*)"[^>]*?>/i;
const altAttribute = /\balt="([^"]*)"/i;
const bareUrl = /^(https?:\/\/\S+)$/i;

function inlineText(value: string): string {
  return value
    .replace(inlineLink, (_match, bang: string, label: string, href: string) => (label.trim() ? label : bang ? "" : href))
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__|[*_`~]/g, "")
    .replace(/&nbsp;/g, " ");
}

export function stripInline(value: string): string {
  return inlineText(value).trim();
}

function toLines(markdown: string): Line[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n").map((value) => {
    const raw = value.replace(/\s+$/, "");
    return { indent: raw.length - raw.trimStart().length, text: raw.trim(), raw };
  });
}

function dedent(lines: Line[]): Line[] {
  const base = Math.min(...lines.filter((line) => line.text).map((line) => line.indent));
  return lines.map((line) => (line.text ? { indent: line.indent - base, text: line.text, raw: line.raw.slice(base) } : line));
}

function makeBlock(sourceId: string, cursor: Cursor, kind: ImportedBlock["kind"], text?: string): ImportedBlock {
  return { sourceId: `${sourceId}#block-${cursor.next++}`, sourceIdentityKind: "path-derived", kind, text, links: [], children: [] };
}

function attachLinks(block: ImportedBlock, source: string) {
  const text = inlineText(source);
  const leading = text.length - text.trimStart().length;
  inlineLink.lastIndex = 0;
  for (const match of source.matchAll(inlineLink)) {
    if (match[1] === "!") continue;
    const link = safeImportLink(match[3]!.trim());
    if (link) {
      // Offsets refer to the rendered plain text, after Markdown and HTML
      // markers are removed. Each label keeps its own destination; surrounding
      // prose must never inherit the first link in a paragraph.
      const textStart = Math.max(0, inlineText(source.slice(0, match.index)).length - leading);
      const label = match[2]!.trim() ? match[2]! : match[3]!;
      const textEnd = Math.min(block.text?.length ?? 0, textStart + inlineText(label).length);
      block.links.push({ ...link, textStart, textEnd });
    }
  }
}

/** Lines belonging to the construct opened at `lines[index]`: everything indented past it. */
function childLines(lines: Line[], index: number): { children: Line[]; end: number } {
  const indent = lines[index]!.indent;
  let end = index + 1;
  let last = index;
  while (end < lines.length && (!lines[end]!.text || lines[end]!.indent > indent)) {
    if (lines[end]!.text) last = end;
    end += 1;
  }
  return { children: lines.slice(index + 1, last + 1), end: last + 1 };
}

function parseImageTag(line: string, sourceId: string, cursor: Cursor): ImportedBlock | undefined {
  const match = line.match(imageTag);
  if (!match) return undefined;
  const alt = line.match(altAttribute)?.[1]?.trim();
  const block = makeBlock(sourceId, cursor, "media", alt && alt !== match[1] ? alt : undefined);
  block.links.push({ href: match[1]!, kind: "attachment" });
  return block;
}

function parseBlocks(lines: Line[], sourceId: string, cursor: Cursor, unmapped: NotionUnmapped[]): ImportedBlock[] {
  const blocks: ImportedBlock[] = [];
  let index = 0;

  const pushChildren = (block: ImportedBlock, children: Line[]) => {
    if (children.some((line) => line.text)) block.children = parseBlocks(dedent(children), sourceId, cursor, unmapped);
  };

  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.text) { index += 1; continue; }

    if (line.text === "<aside>") {
      let close = index + 1;
      while (close < lines.length && lines[close]!.text !== "</aside>") close += 1;
      const inner = lines.slice(index + 1, close);
      const callout = makeBlock(sourceId, cursor, "callout");
      pushChildren(callout, inner.length ? dedent(inner) : inner);
      blocks.push(callout);
      index = close + 1;
      continue;
    }

    if (viewMarker.test(line.text)) {
      const stanza: string[] = [];
      let end = index + 1;
      while (end < lines.length && lines[end]!.text && !viewMarker.test(lines[end]!.text)) stanza.push(lines[end++]!.text);
      unmapped.push({ label: "Notion database view configuration", detail: `${line.text} ${stanza.join(" ")}`.trim() });
      index = end;
      continue;
    }

    if (imageTag.test(line.text)) {
      const media = parseImageTag(line.text, sourceId, cursor);
      if (media) blocks.push(media);
      const remainder = line.text.replace(imageTag, "").trim();
      if (remainder) {
        const paragraph = makeBlock(sourceId, cursor, "paragraph", stripInline(remainder));
        attachLinks(paragraph, remainder);
        if (paragraph.text) blocks.push(paragraph);
      }
      index += 1;
      continue;
    }

    if (line.text.startsWith("```")) {
      // Code is verbatim: indentation inside the fence is content, not layout.
      const language = line.text.slice(3).trim();
      const fenceIndent = line.indent;
      const code: string[] = [];
      let end = index + 1;
      while (end < lines.length && !lines[end]!.text.startsWith("```")) {
        const raw = lines[end++]!.raw;
        code.push(raw.slice(0, fenceIndent).trim() ? raw : raw.slice(fenceIndent));
      }
      const block = makeBlock(sourceId, cursor, "code", code.join("\n"));
      block.language = language || undefined;
      blocks.push(block);
      index = end + 1;
      continue;
    }

    const heading = line.text.match(headingMarker);
    if (heading) {
      const block = makeBlock(sourceId, cursor, "heading", stripInline(heading[2]!));
      block.level = heading[1]!.length;
      attachLinks(block, heading[2]!);
      blocks.push(block);
      index += 1;
      continue;
    }

    if (dividerMarker.test(line.text)) {
      blocks.push(makeBlock(sourceId, cursor, "divider"));
      index += 1;
      continue;
    }

    if (line.text.startsWith(">")) {
      // A quote runs until the first line that is not one; its continuation
      // lines are the same block, not a second quote.
      const quoted: string[] = [];
      let end = index;
      while (end < lines.length && lines[end]!.text.startsWith(">")) quoted.push(lines[end++]!.text.replace(/^>\s?/, ""));
      const source = quoted.join(" ").trim();
      const block = makeBlock(sourceId, cursor, "quote", stripInline(source));
      attachLinks(block, source);
      blocks.push(block);
      index = end;
      continue;
    }

    const task = line.text.match(taskMarker);
    if (task) {
      const block = makeBlock(sourceId, cursor, "task", stripInline(task[2]!));
      block.checked = task[1]!.toLowerCase() === "x";
      attachLinks(block, task[2]!);
      const { children, end } = childLines(lines, index);
      pushChildren(block, children);
      blocks.push(block);
      index = end;
      continue;
    }

    const bullet = line.text.match(bulletMarker);
    const ordered = bullet ? undefined : line.text.match(orderedMarker);
    if (bullet || ordered) {
      const content = (bullet ?? ordered)![2]!;
      const { children, end } = childLines(lines, index);
      const hasChildren = children.some((child) => child.text);
      const kind = hasChildren && bullet ? "toggle" : bullet ? "bulleted-list" : "numbered-list";
      const block = makeBlock(sourceId, cursor, kind, stripInline(content));
      attachLinks(block, content);
      pushChildren(block, children);
      blocks.push(block);
      index = end;
      continue;
    }

    if (line.text.includes("|") && index + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[index + 1]!.text)) {
      const rows = [line.text];
      let end = index + 2;
      while (end < lines.length && lines[end]!.text.includes("|")) rows.push(lines[end++]!.text);
      const block = makeBlock(sourceId, cursor, "table");
      block.rows = rows.map((row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => stripInline(cell.trim())));
      blocks.push(block);
      index = end;
      continue;
    }

    const bare = line.text.match(bareUrl);
    if (bare) {
      const block = makeBlock(sourceId, cursor, "link", bare[1]!);
      const link = safeImportLink(bare[1]!);
      if (link) block.links.push(link);
      blocks.push(block);
      index += 1;
      continue;
    }

    inlineLink.lastIndex = 0;
    const only = inlineLink.exec(line.text);
    if (only && only[0] === line.text) {
      const block = makeBlock(sourceId, cursor, only[1] === "!" ? "media" : "link", stripInline(only[2]!) || only[3]!);
      const link = safeImportLink(only[3]!.trim());
      if (link) block.links.push({ ...link, kind: only[1] === "!" ? "attachment" : link.kind });
      blocks.push(block);
      index += 1;
      continue;
    }

    const paragraph = [line.text];
    let end = index + 1;
    while (end < lines.length && lines[end]!.text && lines[end]!.indent === line.indent
      && !headingMarker.test(lines[end]!.text) && !bulletMarker.test(lines[end]!.text) && !orderedMarker.test(lines[end]!.text)
      && !dividerMarker.test(lines[end]!.text) && !viewMarker.test(lines[end]!.text) && !lines[end]!.text.startsWith("```")
      && !lines[end]!.text.startsWith(">") && lines[end]!.text !== "<aside>" && !imageTag.test(lines[end]!.text)) {
      paragraph.push(lines[end++]!.text);
    }
    const joined = paragraph.join(" ");
    const block = makeBlock(sourceId, cursor, "paragraph", stripInline(joined));
    attachLinks(block, joined);
    if (block.text) blocks.push(block);
    for (const image of joined.matchAll(inlineLink)) {
      if (image[1] !== "!") continue;
      const media = makeBlock(sourceId, cursor, "media", stripInline(image[2]!) || undefined);
      media.links.push({ href: image[3]!.trim(), kind: "attachment" });
      blocks.push(media);
    }
    index = end;
  }
  return blocks;
}

export function parseNotionMarkdown(markdown: string, sourceId: string): NotionDocument {
  const lines = toLines(markdown);
  const unmapped: NotionUnmapped[] = [];
  const properties: Record<string, string> = {};
  let index = 0;
  let headingTitle: string | undefined;

  while (index < lines.length && !lines[index]!.text) index += 1;
  const heading = lines[index]?.text.match(headingMarker);
  if (heading && heading[1] === "#") {
    headingTitle = stripInline(heading[2]!);
    index += 1;
    while (index < lines.length && !lines[index]!.text) index += 1;
    while (index < lines.length && lines[index]!.text) {
      const property = lines[index]!.text.match(propertyMarker);
      if (!property || viewMarker.test(lines[index]!.text) || bulletMarker.test(lines[index]!.text) || headingMarker.test(lines[index]!.text)) break;
      properties[property[1]!.trim()] = property[2]!.trim();
      index += 1;
    }
  }

  const rest = lines.slice(index);
  return { headingTitle, properties, blocks: rest.some((line) => line.text) ? parseBlocks(dedent(rest), sourceId, { next: 0 }, unmapped) : [], unmapped };
}

export function walkBlocks(blocks: ImportedBlock[], visit: (block: ImportedBlock) => void) {
  for (const block of blocks) {
    visit(block);
    walkBlocks(block.children, visit);
  }
}
