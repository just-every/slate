export type ImportFormat =
  | "slate-readable"
  | "notion-workspace"
  | "confluence-space"
  | "docx"
  | "google-docx"
  | "google-html-zip"
  | "markdown"
  | "html"
  | "text"
  | "csv"
  | "pdf"
  | "epub";

export type SourceIdentityKind = "native" | "path-derived";

export type ImportBlockKind =
  | "columns"
  | "column"
  | "paragraph"
  | "heading"
  | "bulleted-list"
  | "numbered-list"
  | "toggle"
  | "quote"
  | "divider"
  | "callout"
  | "expandable"
  | "table"
  | "code"
  | "task"
  | "table-of-contents"
  | "media"
  | "link";

export type PageLifecycle = "draft" | "scheduled" | "live" | "live-with-unpublished-changes" | "archived";
export type GrantPrincipalKind = "member" | "group" | "container" | "workspace";
export type GrantLevel = "full" | "edit" | "comment" | "view";
export type RevisionOrigin = "autosave" | "publish";

export interface ImportSourceFile {
  name: string;
  mediaType?: string;
  bytes: Uint8Array;
}

export interface SourceIdentity {
  sourceId: string;
  sourceIdentityKind: SourceIdentityKind;
}

export interface ImportedLink {
  href: string;
  /** Range in the block's plain text occupied by this link's label. */
  textStart?: number;
  textEnd?: number;
  targetSourceId?: string;
  kind: "external" | "page" | "database" | "attachment";
}

export interface ImportedBlock extends SourceIdentity {
  canonicalBlock?: {id:string;blockType:string;content:import("../../shared/api/common").JsonValue;parentBlockId:string|null;treePosition:string};
  /** Only references whose source record is actually present may acquire a destination ID. */
  canonicalReferences?: {ancestorPageSourceId?: string};
  kind: ImportBlockKind;
  text?: string;
  level?: number;
  language?: string;
  checked?: boolean;
  tableOfContents?: import("../editor/table-of-contents").TableOfContentsSettings;
  statuses?: ImportedStatus[];
  rows?: string[][];
  mediaSourceId?: string;
  links: ImportedLink[];
  children: ImportedBlock[];
}

export type ImportedStatusColour = "grey" | "blue" | "green" | "yellow" | "red" | "purple";
export interface ImportedStatus {
  textStart: number;
  textEnd: number;
  colour: ImportedStatusColour;
}

export interface ImportedGrant {
  principalKind: GrantPrincipalKind;
  principalSourceId: string;
  level: GrantLevel;
  expiresAt?: string;
  general: boolean;
}

export interface ImportedRevision extends SourceIdentity {
  /** Snapshot metadata, when the source exports it independently of current content. */
  title?: string;
  labels?: string[];
  ordinal?: number;
  label?: string;
  status?: string;
  comment?: string;
  createdAt?: string;
  origin: RevisionOrigin;
  blocks: ImportedBlock[];
}

export interface ImportedPublicExposure {
  host?: string;
  slug?: string;
  theme?: string;
  indexable?: boolean;
}

export interface ImportedPage extends SourceIdentity {
  comments?: import("../workspace-export/comment-archive").CommentArchive;
  /** Shared page reading options retained by Slate readable archives. */
  display?: { typeface: "default" | "serif" | "mono"; smallText: boolean; fullWidth: boolean };
  parentSourceId?: string;
  /** Readable archives retain sibling placement independently of archive entry order. */
  treePosition?: string;
  containerSourceId: string;
  title: string;
  icon?: string;
  coverMediaSourceId?: string;
  blocks: ImportedBlock[];
  lifecycle: PageLifecycle;
  labels: string[];
  /** Property lines the source export wrote above the body, verbatim. */
  properties: Record<string, string>;
  status?: string;
  /** Source restrictions survive missing or unknown principal mappings. */
  restricted?: boolean;
  grants: ImportedGrant[];
  revisions: ImportedRevision[];
  publicExposure?: ImportedPublicExposure;
  /** CONT-010: a source blog post keeps its original date and author. */
  post?: { postedAt: string; authorSourceId?: string };
}

export interface ImportedField extends SourceIdentity {
  name: string;
  type: string;
  options?: string[];
  rawConfiguration?: unknown;
}

export interface ImportedDatabase extends SourceIdentity {
  pageSourceId?:string;
  containerSourceId: string;
  parentSourceId?: string;
  title: string;
  fields: ImportedField[];
}

export interface ImportedRecord extends SourceIdentity {
  databaseSourceId: string;
  pageSourceId?: string;
  fields: Record<string, string | string[] | number | boolean | null>;
  blocks: ImportedBlock[];
  labels: string[];
}

export interface ImportedMedia extends SourceIdentity {
  /** Explicit XML content owner; prevents reference inference from widening access. */
  ownerPageSourceId?: string;
  source?:import('./archive-stream').ArchiveMediaSource;
  name: string;
  archivePath?: string;
  mediaType: string;
  bytes: Uint8Array;
  caption?: string;
  altText?: string;
}

export interface ImportedContainer extends SourceIdentity {
  name: string;
  key?: string;
  /** A personal container: no page in it carries a general grant (`SHARE-004`). */
  personal: boolean;
  labels: string[];
  grants: ImportedGrant[];
}

/**
 * A principal the source export named. `PORT-005`: every imported member is an
 * inactive historical actor until a member invites them, so an import never
 * activates an account.
 */
export interface ImportedMember extends SourceIdentity {
  displayName: string;
  email?: string;
  status: "inactive-historical";
}

export type ImportReportEntryKind = "container" | "page" | "database" | "record" | "file" | "version" | "construct";

export interface ImportReportEntry {
  targetId?:string;
  kind: ImportReportEntryKind;
  sourceId?: string;
  label: string;
  detail?: string;
}

export interface ImportReport {
  created: ImportReportEntry[];
  unmapped: ImportReportEntry[];
  warnings: ImportReportEntry[];
}

export interface NormalizedImport {
  format: ImportFormat;
  sourceName: string;
  containers: ImportedContainer[];
  members: ImportedMember[];
  pages: ImportedPage[];
  databases: ImportedDatabase[];
  records: ImportedRecord[];
  media: ImportedMedia[];
  report: ImportReport;
}

export interface ImportSafetyLimits {
  maximumArchiveBytes: number;
  maximumEntries: number;
  maximumExpandedBytes: number;
  maximumEntryBytes: number;
  maximumCompressionRatio: number;
}

export interface ImportParseOptions {
  limits?: Partial<ImportSafetyLimits>;
}

export const defaultImportSafetyLimits: ImportSafetyLimits = {
  maximumArchiveBytes: 256 * 1024 * 1024,
  maximumEntries: 20_000,
  maximumExpandedBytes: 512 * 1024 * 1024,
  maximumEntryBytes: 64 * 1024 * 1024,
  maximumCompressionRatio: 100,
};
