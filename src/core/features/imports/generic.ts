import { archiveMediaType, readZipArchive } from "./archive";
import { csvTableBlock, inferCsvFields, parseCsv, validateCsvTable } from "./csv";
import { ImportError } from "./errors";
import { htmlBlocks } from "./html";
import { markdownBlocks } from "./markdown";
import { createImportReport, reportCreated } from "./report";
import { assertImportSourceSize } from "./safety";
import type { ImportFormat, ImportParseOptions, ImportSourceFile, NormalizedImport } from "./types";

function sourceId(prefix: string, source: ImportSourceFile): string {
  return `${prefix}:${source.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document"}`;
}

function documentImport(format: ImportFormat, source: ImportSourceFile, blocks: NormalizedImport["pages"][number]["blocks"]): NormalizedImport {
  const id = sourceId(format, source);
  const report = createImportReport();
  const title = (format === "markdown" ? blocks.find(block => block.kind === "heading" && block.level === 1)?.text?.trim() : undefined) || source.name.replace(/\.[^.]+$/, "") || "Imported document";
  reportCreated(report, "container", title, id);
  reportCreated(report, "page", title, id);
  return {
    format,
    sourceName: source.name,
    containers: [{ sourceId: id, sourceIdentityKind: "path-derived", name: title, personal: false, labels: [], grants: [] }],
    members: [],
    pages: [{ sourceId: id, sourceIdentityKind: "path-derived", containerSourceId: id, title, blocks, lifecycle: "live", labels: [], properties: {}, grants: [], revisions: [] }],
    databases: [],
    records: [],
    media: [],
    report,
  };
}

function text(source: ImportSourceFile): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
  } catch {
    throw new ImportError("IMPORT_FORMAT_INVALID", `${source.name} is not valid UTF-8 text.`);
  }
}

export function parseMarkdownDocument(source: ImportSourceFile, options?: ImportParseOptions): NormalizedImport {
  assertImportSourceSize(source, options);
  const id = sourceId("markdown", source);
  return documentImport("markdown", source, markdownBlocks(text(source), id));
}

export function parsePlainTextDocument(source: ImportSourceFile, options?: ImportParseOptions): NormalizedImport {
  assertImportSourceSize(source, options);
  const id = sourceId("text", source);
  const blocks = text(source).replace(/\r\n?/g, "\n").split(/\n{2,}/).map((paragraph, index) => ({
    sourceId: `${id}#paragraph-${index}`,
    sourceIdentityKind: "path-derived" as const,
    kind: "paragraph" as const,
    text: paragraph.trim(),
    links: [],
    children: [],
  })).filter((block) => block.text);
  return documentImport("text", source, blocks);
}

export function parseHtmlDocument(source: ImportSourceFile, options?: ImportParseOptions): NormalizedImport {
  assertImportSourceSize(source, options);
  const id = sourceId("html", source);
  const parsed = documentImport("html", source, []);
  parsed.pages[0]!.blocks = htmlBlocks(text(source), id, parsed.report);
  return parsed;
}

export function parseCsvDocument(source: ImportSourceFile, options?: ImportParseOptions): NormalizedImport {
  assertImportSourceSize(source, options);
  const id = sourceId("csv", source);
  const rows = parseCsv(text(source));
  const { header, records } = validateCsvTable(rows);
  const report = createImportReport();
  const title = source.name.replace(/\.[^.]+$/, "") || "Imported CSV";
  const databaseId = `${id}:database`;
  reportCreated(report, "container", title, id);
  reportCreated(report, "database", title, databaseId);
  const fields = inferCsvFields(header, records, databaseId);
  return {
    format: "csv",
    sourceName: source.name,
    containers: [{ sourceId: id, sourceIdentityKind: "path-derived", name: title, personal: false, labels: [], grants: [] }],
    members: [],
    pages: [],
    databases: [{ sourceId: databaseId, sourceIdentityKind: "path-derived", containerSourceId: id, title, fields }],
    records: records.map((record, index) => {
      const recordId = `${databaseId}:record:${index + 1}`;
      reportCreated(report, "record", `CSV row ${index + 1}`, recordId);
      return {
        sourceId: recordId,
        sourceIdentityKind: "path-derived" as const,
        databaseSourceId: databaseId,
        fields: Object.fromEntries(fields.map((field, index) => {
          const value = record[index] ?? "";
          return [field.name, field.type === "number" ? (value ? Number(value) : null) : field.type === "checkbox" ? (value ? /^true$/i.test(value) : null) : value];
        })),
        blocks: [csvTableBlock([header, record], recordId)],
        labels: [],
      };
    }),
    media: [],
    report,
  };
}

export function parseGoogleHtmlZip(source: ImportSourceFile, options?: ImportParseOptions): NormalizedImport {
  const files = readZipArchive(source.bytes, options?.limits);
  const htmlPath = [...files.keys()].find((path) => /(?:^|\/)index\.html?$/i.test(path)) ?? [...files.keys()].find((path) => /\.html?$/i.test(path));
  if (!htmlPath) throw new ImportError("IMPORT_FORMAT_INVALID", "The Google Docs HTML archive has no HTML document.");
  const id = sourceId("google-html", source);
  const report = createImportReport();
  const mediaByPath = new Map<string, string>();
  const media = [...files.entries()].filter(([path]) => path !== htmlPath && !/\.html?$/i.test(path)).map(([path, bytes]) => {
    const mediaId = `${id}:file:${path}`;
    mediaByPath.set(path, mediaId);
    reportCreated(report, "file", path, mediaId);
    return { sourceId: mediaId, sourceIdentityKind: "path-derived" as const, name: path.split("/").at(-1) ?? path, archivePath: path, mediaType: archiveMediaType(path), bytes };
  });
  const title = source.name.replace(/\.[^.]+$/, "") || "Google Docs export";
  reportCreated(report, "container", title, id);
  reportCreated(report, "page", title, id);
  const html = new TextDecoder("utf-8", { fatal: true }).decode(files.get(htmlPath)!);
  const directory = htmlPath.includes("/") ? htmlPath.slice(0, htmlPath.lastIndexOf("/") + 1) : "";
  const resolveMedia = (href: string) => mediaByPath.get(href.replace(/^\.\//, "")) ?? mediaByPath.get(`${directory}${href.replace(/^\.\//, "")}`);
  return {
    format: "google-html-zip",
    sourceName: source.name,
    containers: [{ sourceId: id, sourceIdentityKind: "path-derived", name: title, personal: false, labels: [], grants: [] }],
    members: [],
    pages: [{ sourceId: id, sourceIdentityKind: "path-derived", containerSourceId: id, title, blocks: htmlBlocks(html, id, report, resolveMedia), lifecycle: "live", labels: [], properties: {}, grants: [], revisions: [] }],
    databases: [], records: [], media, report,
  };
}
