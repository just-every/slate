import {archiveMediaSource} from '../archive-stream';
import {compactBlockStore} from '../compact-block-store';
import { archiveMediaType } from "../archive";
import { createImportReport, reportCreated, reportMissingArchiveFile, reportUnmapped, reportWarning } from "../report";
import { importSafetyLimits } from "../safety";
import type { ImportBlockKind, ImportParseOptions, ImportSourceFile, ImportedBlock, ImportedContainer, ImportedGrant, ImportedMedia, ImportedPage, ImportedRevision, NormalizedImport } from "../types";
import { confluenceGrants, confluenceMembers, memberSourceId } from "./grants";

/** Confluence writes server-local timestamps without a zone; exports are produced in UTC. */
const confluenceInstant = (value: string | undefined) => { const instant = new Date(`${(value ?? "").trim().replace(" ", "T")}Z`); return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString(); };
import { parseStorageFormat } from "./storage";
import { readConfluenceExport, requireTable, tableRows, type ConfluenceTables } from "./tables";

/**
 * Confluence Cloud's space export. `content.csv` is the tree and the version
 * ledger, `bodycontent.csv` holds storage-format bodies, and the remaining
 * tables carry labels, restrictions, properties and the plugin data the product
 * keeps beside a space. Everything Slate has no home for is named in the report
 * rather than dropped silently.
 */

const storageBodyType = "2";
const importedAsPage = new Set(["PAGE", "BLOGPOST"]);
const importedAsEmptyPage = new Set(["FOLDER"]);
const namedNotImported = new Set(["WHITEBOARD", "DATABASE", "SLIDE", "EMBED", "COMMENT", "ATTACHMENT", "CUSTOM", "SPACEDESCRIPTION"]);

interface ContentRow extends Record<string, string> {
  contentid: string;
  contenttype: string;
  title: string;
  version: string;
  prevver: string;
  content_status: string;
  spaceid: string;
  parentid: string;
  child_position: string;
  versioncomment: string;
  lastmoddate: string;
}

function emojiFrom(hex: string): string | undefined {
  const codePoint = Number.parseInt(hex.replace(/^"|"$/g, ""), 16);
  return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : undefined;
}

/** Roots first, then each parent's children in `child_position` order. */
function inTreeOrder(rows: ContentRow[]): ContentRow[] {
  const byParent = new Map<string, ContentRow[]>();
  const ids = new Set(rows.map((row) => row.contentid));
  for (const row of rows) {
    const parent = ids.has(row.parentid) ? row.parentid : "";
    byParent.set(parent, [...(byParent.get(parent) ?? []), row]);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => (Number(left.child_position) || 0) - (Number(right.child_position) || 0) || left.contentid.localeCompare(right.contentid));
  }
  const ordered: ContentRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string) => {
    for (const row of byParent.get(parent) ?? []) {
      if (seen.has(row.contentid)) continue;
      seen.add(row.contentid);
      ordered.push(row);
      walk(row.contentid);
    }
  };
  walk("");
  for (const row of rows) if (!seen.has(row.contentid)) ordered.push(row);
  return ordered;
}

function walkBlocks(blocks: ImportedBlock[], visit: (block: ImportedBlock) => void) {
  for (const block of blocks) {
    visit(block);
    walkBlocks(block.children, visit);
  }
}

export function parseConfluenceCsvSpace(files: Map<string, Uint8Array>, source: Pick<ImportSourceFile,'name'>, options?: ImportParseOptions): NormalizedImport {
  const { tables, descriptor } = readConfluenceExport(files, importSafetyLimits(options));
  const report = createImportReport();
  const noted = new Set<string>();
  const note = (label: string, sourceId?: string, detail?: string) => {
    const key = `${label}|${sourceId ?? ""}|${detail ?? ""}`;
    if (noted.has(key)) return;
    noted.add(key);
    reportUnmapped(report, label, sourceId, detail);
  };

  const containers: ImportedContainer[] = requireTable(tables, "spaces").rows.map((space) => {
    const sourceId = `confluence-space:${space.spaceid}`;
    reportCreated(report, "container", space.spacename || space.spacekey || sourceId, sourceId);
    return {
      sourceId,
      sourceIdentityKind: "native" as const,
      name: space.spacename || space.spacekey || `Confluence space ${space.spaceid}`,
      key: space.spacekey,
      // `CONT-005`/`SHARE-004`: nothing in a personal space carries a general grant.
      personal: (space.spacetype ?? "").toLowerCase() === "personal",
      labels: [] as string[],
      grants: [] as ImportedGrant[],
    };
  });
  const containerIds = new Set(containers.map((container) => container.sourceId));
  const defaultContainer = containers[0]?.sourceId ?? "confluence-space:unknown";
  const personalContainers = new Set(containers.filter((container) => container.personal).map((container) => container.sourceId));
  if (personalContainers.size) {
    reportWarning(report, "The exported space is a personal space, so no imported page carries a general access grant", defaultContainer);
  }

  const content = requireTable(tables, "content").rows as ContentRow[];
  const contentById = new Map(content.map((row) => [row.contentid, row]));
  const containerOf = (row: ContentRow | undefined): string => {
    if (!row) return defaultContainer;
    const declared = row.spaceid ? `confluence-space:${row.spaceid}` : "";
    if (declared && containerIds.has(declared)) return declared;
    note("Confluence content names no space this export carries, so it landed in the exported space", `confluence-content:${row.contentid}`, row.spaceid || "(blank spaceid)");
    return defaultContainer;
  };

  // `bodycontent` has one row per body type. Only storage format (2) is a page
  // body; a plugin payload row must never blank the page it shares an id with.
  const bodiesByContent = new Map<string, Map<string, Record<string,string>>>();
  for (const row of tableRows(tables, "bodycontent")) {
    const id = row.contentid ?? "";
    if (!bodiesByContent.has(id)) bodiesByContent.set(id, new Map());
    // Keep the lazy row rather than copying every decompressed body into a
    // second map. Only the requested page/revision body is expanded below.
    bodiesByContent.get(id)!.set(row.bodytypeid ?? "", row);
  }
  const storageBodyFor = (contentid: string): string | undefined => {
    const byType = bodiesByContent.get(contentid);
    if (!byType) return undefined;
    for (const [type, row] of byType) {
      if (type === storageBodyType) continue;
      if ((row.body??'').trim()) note(`Confluence body type ${type} is a plugin payload, not storage format`, `confluence-content:${contentid}`);
    }
    return byType.get(storageBodyType)?.body;
  };

  const current = content.filter((row) => !row.prevver && row.content_status === "current");
  const historical = content.filter((row) => row.prevver && row.content_status === "current");
  const drafts = content.filter((row) => row.content_status === "draft");
  for (const row of content) {
    if (row.content_status === "current" || row.content_status === "draft") continue;
    note(`Confluence content status "${row.content_status}" is neither current nor draft, so it was not imported`, `confluence-content:${row.contentid}`, row.title || undefined);
  }

  // Account for every property row, without expanding thousands of identical
  // unsupported property names into equally many review items.
  const icons = new Map<string, string>();
  const propertyLosses=new Map<string,{unsupported:number;malformed:number;unmapped:number}>();
  const iconTargets=new Set(current.filter(row=>importedAsPage.has(row.contenttype)||importedAsEmptyPage.has(row.contenttype)).map(row=>row.contentid));
  for (const property of tableRows(tables, "contentproperties")) {
    const name=property.propertyname||'(unnamed)';
    const counts=propertyLosses.get(name)??{unsupported:0,malformed:0,unmapped:0};
    if(name!=="titleEmoji")counts.unsupported++;
    else {
      const value=(property.stringval??'').replace(/^"|"$/g,'');
      const icon=/^[0-9a-f]+$/i.test(value)?emojiFrom(value):undefined;
      if(!icon)counts.malformed++;
      else if(!iconTargets.has(property.contentid??''))counts.unmapped++;
      else icons.set(property.contentid!,icon);
    }
    if(counts.unsupported+counts.malformed+counts.unmapped)propertyLosses.set(name,counts);
  }
  for(const [name,counts] of propertyLosses)note(`Confluence content property "${name}" did not cross`,undefined,`${counts.unsupported+counts.malformed+counts.unmapped} rows: ${counts.unsupported} unsupported, ${counts.malformed} malformed, ${counts.unmapped} without an imported current page`);

  const labelNames = new Map(tableRows(tables, "label").map((row) => [row.labelid!, row]));
  const labelsByContent = new Map<string, string[]>();
  for (const link of tableRows(tables, "content_label")) {
    const label = labelNames.get(link.labelid ?? "");
    if (!label) { note("Confluence label link names a label the export does not carry", `confluence-label:${link.id}`); continue; }
    if (label.namespace === "my") {
      note(`Confluence personal label "${label.name}" is a member's favourite, not a page label`, `confluence-content:${link.contentid}`);
      continue;
    }
    labelsByContent.set(link.contentid!, [...(labelsByContent.get(link.contentid!) ?? []), label.name!]);
  }

  const members = confluenceMembers(tables);
  const grantsByContent = confluenceGrants(
    tables,
    (contentId) => containerOf(contentById.get(contentId)),
    (containerSourceId) => personalContainers.has(containerSourceId),
    report,
  );
  if (tableRows(tables, "content_perm_set").length) {
    note("Confluence Server content_perm_set restrictions are not read by the Cloud CSV importer", undefined, `${tableRows(tables, "content_perm_set").length} rows`);
  }

  const attachmentRows = content.filter((row) => row.contenttype === "ATTACHMENT");
  const media: ImportedMedia[] = [];
  const mediaByName = new Map<string, string>();
  for (const attachment of attachmentRows) {
    const sourceId = `confluence-attachment:${attachment.contentid}`;
    const path = [...files.keys()].find((candidate) => candidate.includes(`/${attachment.contentid}/`) || candidate.split("/").at(-1) === attachment.title);
    if (!path) { reportMissingArchiveFile(report, attachment.title, sourceId); continue; }
    media.push({ sourceId, sourceIdentityKind: "native", name: attachment.title, archivePath: path, mediaType: archiveMediaType(attachment.title),source:archiveMediaSource(files,path), get bytes(){return files.get(path)!;} });
    mediaByName.set(attachment.title, sourceId);
    reportCreated(report, "file", attachment.title, sourceId);
  }

  const publishedIds = new Set(current.map((row) => row.contentid));
  const orphanDrafts = drafts.filter((row) => !row.prevver || !publishedIds.has(row.prevver));
  const pageRows = inTreeOrder([
    ...current.filter((row) => importedAsPage.has(row.contenttype) || importedAsEmptyPage.has(row.contenttype)),
    ...orphanDrafts.filter((row) => importedAsPage.has(row.contenttype) || importedAsEmptyPage.has(row.contenttype)),
  ]);
  const pageIds = new Map(pageRows.map((row) => [row.contentid, `confluence-page:${row.contentid}`]));

  const blockStore=compactBlockStore();
  const parseBody = (contentid: string, sourceId: string): ImportedBlock[] => {
    const body = storageBodyFor(contentid);
    if (!body) return [];
    const parsed = parseStorageFormat(body, sourceId);
    for (const construct of parsed.constructs) note(construct.label, sourceId, construct.detail);
    return blockStore.retain(parsed.blocks);
  };

  const pages: ImportedPage[] = pageRows.map((row) => {
    const sourceId = pageIds.get(row.contentid)!;
    const isFolder = importedAsEmptyPage.has(row.contenttype);
    const neverPublished = row.content_status === "draft";
    const blocks = isFolder ? [] : parseBody(row.contentid, sourceId);
    if (isFolder) note("Confluence folder imported as a page with an empty body so its tree survives", sourceId, row.title);
    if (neverPublished) note("Confluence draft was never published, so it was imported as a private draft page", sourceId, row.title);

    const revisions: ImportedRevision[] = [];
    for (const version of historical.filter((candidate) => candidate.prevver === row.contentid).sort((left, right) => (Number(left.version) || 0) - (Number(right.version) || 0))) {
      revisions.push({
        sourceId: `confluence-version:${version.contentid}:${version.version}`,
        sourceIdentityKind: "native",
        ordinal: Number(version.version) || undefined,
        comment: version.versioncomment || undefined,
        status: version.content_status,
        createdAt: version.lastmoddate,
        origin: "publish",
        blocks: parseBody(version.contentid, `confluence-version:${version.contentid}`),
      });
    }
    revisions.push({
      sourceId: `confluence-version:${row.contentid}:${row.version}`,
      sourceIdentityKind: "native",
      ordinal: Number(row.version) || undefined,
      comment: row.versioncomment || undefined,
      status: row.content_status,
      createdAt: row.lastmoddate,
      origin: neverPublished ? "autosave" : "publish",
      blocks,
    });
    const draft = neverPublished ? undefined : drafts.find((candidate) => candidate.prevver === row.contentid);
    if (draft) {
      revisions.push({
        sourceId: `confluence-version:${draft.contentid}:draft`,
        sourceIdentityKind: "native",
        ordinal: undefined,
        comment: draft.versioncomment || undefined,
        status: "draft",
        createdAt: draft.lastmoddate,
        origin: "autosave",
        blocks: parseBody(draft.contentid, `confluence-version:${draft.contentid}`),
      });
    }
    for (const revision of revisions) reportCreated(report, "version", `${row.title} v${revision.ordinal ?? "draft"}`, revision.sourceId);

    // `SHARE-004`/`LIFE-002`: a draft never carries a general grant.
    const grants = (grantsByContent.get(row.contentid) ?? []).filter((grant) => {
      if (!grant.general || !neverPublished) return true;
      note("Confluence restriction on an unpublished draft cannot become a general grant", sourceId);
      return false;
    });

    const postedAt = row.contenttype === "BLOGPOST" ? confluenceInstant(row.creationdate) : undefined;
    if (row.contenttype === "BLOGPOST" && !postedAt) note("Confluence blog post has no readable creation date, so it was imported as a page", sourceId, row.title);
    reportCreated(report, "page", row.title, sourceId);
    return {
      sourceId,
      sourceIdentityKind: "native" as const,
      parentSourceId: pageIds.get(row.parentid),
      containerSourceId: containerOf(row),
      title: row.title,
      icon: icons.get(row.contentid),
      blocks,
      lifecycle: neverPublished ? "draft" : draft ? "live-with-unpublished-changes" : "live",
      labels: labelsByContent.get(row.contentid) ?? [],
      properties: {},
      status: row.content_status,
      restricted: tableRows(tables, "content_permissions").some(permission => permission.content_id === row.contentid) || tableRows(tables, "content_perm_set").some(permission => (permission.content_id ?? permission.contentid) === row.contentid),
      grants,
      revisions,
      workingRevisionSourceId: draft ? `confluence-version:${draft.contentid}:draft` : `confluence-version:${row.contentid}:${row.version}`,
      publishedRevisionSourceId: neverPublished ? undefined : `confluence-version:${row.contentid}:${row.version}`,
      ...(postedAt ? { post: { postedAt, ...(row.creator ? { authorSourceId: memberSourceId(row.creator) } : {}) } } : {}),
    };
  });

  // Links, on the page body and on every revision body alike. Everything this
  // export writes is an absolute URL; an intra-space page URL resolves to the
  // imported page, an `ac:link` resolves by title, and an attachment reference
  // resolves to the imported file.
  const pagesByTitle = new Map(pages.map((page) => [page.title, page.sourceId]));
  const fixUp = (blocks: ImportedBlock[], sourceId: string) => {
    walkBlocks(blocks, (block) => {
      for (const link of block.links) {
        if (link.kind === "page" && !link.targetSourceId) {
          const target = pagesByTitle.get(link.href);
          if (target) link.targetSourceId = target;
          else { link.kind = "external"; note("Confluence page link names a page the export does not carry", sourceId, link.href); }
          continue;
        }
        if (link.kind === "attachment" && !link.targetSourceId) {
          const target = mediaByName.get(link.href);
          if (target) link.targetSourceId = target;
          else { link.kind = "external"; reportMissingArchiveFile(report, link.href, sourceId); }
          continue;
        }
        const contentid = link.href.match(/\/pages\/(\d+)/)?.[1] ?? link.href.match(/[?&]pageId=(\d+)/i)?.[1];
        const target = contentid ? pageIds.get(contentid) : undefined;
        if (target) { link.kind = "page"; link.targetSourceId = target; }
      }
      if (block.kind === "media" && !block.links.some((link) => link.kind === "attachment" && link.targetSourceId)) {
        block.kind = "link" satisfies ImportBlockKind;
        note("Confluence image is hosted outside the archive, so it was imported as a link", sourceId, block.links[0]?.href);
      }
    });
  };
  for (const page of pages) {
    fixUp(page.blocks, page.sourceId);
    for (const revision of page.revisions) if (revision.blocks !== page.blocks) fixUp(revision.blocks, revision.sourceId);
  }

  for (const row of content) {
    // Every row is accounted for: a blank or foreign space id, a version of
    // something that was not imported, and every content type with no home.
    if (!row.spaceid || !containerIds.has(`confluence-space:${row.spaceid}`)) containerOf(row);
    if (pageIds.has(row.contentid)) continue;
    if (row.prevver && (row.content_status === "current" || row.content_status === "draft")) {
      if (!pageIds.has(row.prevver)) {
        note(`Confluence ${row.contenttype.toLowerCase()} version belongs to content that was not imported`, `confluence-content:${row.contentid}`, row.title || undefined);
      }
      continue;
    }
    if (row.content_status !== "current") continue;
    if (!namedNotImported.has(row.contenttype)) { note(`Confluence content type ${row.contenttype} is unknown to this importer`, `confluence-content:${row.contentid}`, row.title); continue; }
    if (row.contenttype === "ATTACHMENT") continue;
    note(`Confluence ${row.contenttype.toLowerCase()} has no Slate equivalent`, `confluence-content:${row.contentid}`, row.title || undefined);
  }
  for (const whiteboard of tableRows(tables, "whiteboardContentIds")) {
    note(`Confluence whiteboard canvas for ${whiteboard.contenttype?.toLowerCase()} content`, `confluence-content:${whiteboard.contentid}`, whiteboard.referenceid);
  }
  for (const path of files.keys()) {
    if (path.startsWith("whiteboards/")) note("Confluence whiteboard canvas payload was not imported", undefined, path);
  }
  for (const [name, table] of tables) {
    if (!name.startsWith("AO_") || !table.rows.length) continue;
    note(
      name === "AO_BAF3AA_AOINLINE_TASK"
        ? `Confluence app table ${name} was not read; its inline tasks came from the page bodies instead`
        : `Confluence app table ${name} was not imported`,
      undefined,
      `${table.rows.length} rows`,
    );
  }
  if (tableRows(tables, "spacepermissions").length || tableRows(tables, "spacerole_assignments").length) {
    reportWarning(report, "Confluence space permissions and role assignments were not imported; every restriction stays container-scoped", defaultContainer);
  }
  if (!content.some((row) => row.versioncomment)) {
    reportWarning(report, "No content row in this export carries a version comment, so no revision arrived with one", defaultContainer);
  }
  if (descriptor.backupAttachments === "true" && !attachmentRows.length) {
    reportWarning(report, "The export declares attachments were backed up but carries no attachment content rows", defaultContainer);
  }
  if (descriptor.exportFormat && descriptor.exportFormat !== "csv") {
    reportWarning(report, `The export descriptor declares format "${descriptor.exportFormat}"`, undefined, descriptor.exportFormat);
  }

  return { format: "confluence-space", sourceName: source.name, containers, members, pages, databases: [], records: [], media, report };
}
