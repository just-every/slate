import type { ImportedBlock, ImportedLink, ImportedStatusColour } from "./types";
import { safeUrl } from "../editor/validation";

type Span = { text: string; link?: { href: string }; status?: { colour: ImportedStatusColour } };
type IdFor = (kind: string, id: string) => string;

export function importedHref(link: ImportedLink | undefined, idFor: IdFor): string | undefined {
  if (!link) return undefined;
  if (!link.targetSourceId) return link.href;
  return link.kind === "attachment"
    ? `/api/media/${idFor("file", link.targetSourceId)}`
    : link.kind === "database"
      ? `/app/databases/${idFor("database", link.targetSourceId)}`
      : `/app/pages/${idFor("page", link.targetSourceId)}`;
}

/** Ranges let a status label and a link coexist without styling surrounding prose. */
export function importedText(block: ImportedBlock, idFor: IdFor): Span[] {
  const text = block.text ?? "";
  const valid = (range: {textStart?: number; textEnd?: number}) =>
    range.textStart !== undefined && range.textEnd !== undefined && range.textStart >= 0 &&
    range.textEnd > range.textStart && range.textEnd <= text.length;
  const ranged = block.links.filter(valid);
  const links = ranged.length ? ranged : block.links.slice(0, 1).map(link => ({...link, textStart: 0, textEnd: text.length}));
  const statuses = (block.statuses ?? []).filter(valid);
  const boundaries = [...new Set([0, text.length, ...links.flatMap(link => [link.textStart!, link.textEnd!]), ...statuses.flatMap(status => [status.textStart, status.textEnd])])].sort((a, b) => a - b);
  const spans: Span[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const start = boundaries[i]!, end = boundaries[i + 1]!;
    if (end <= start) continue;
    const link = links.find(link => link.textStart! <= start && link.textEnd! >= end);
    const href = importedHref(link, idFor);
    const status = statuses.find(status => status.textStart <= start && status.textEnd >= end);
    spans.push({text: text.slice(start, end), ...(href && safeUrl(href) ? {link: {href}} : {}), ...(status ? {status: {colour: status.colour}} : {})});
  }
  return spans.length ? spans : [{text}];
}
