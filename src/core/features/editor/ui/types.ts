import type {SyncedResolution} from '../../../shared/api/content';
import type {FileReference} from '../file-cards/reference';
import type {TableContent} from '../tables/model';
import type {TableOfContentsSettings} from '../table-of-contents';
import type {TaskReportDefinition} from '../../work-items/report-definition';
import type {EmbeddedSearchQuery} from '../../../shared/knowledge/search-definition';
import type {PageTrust} from '../../search/trust-types';
/**
 * The typed shape of a page body (`BLOCK-001`). These are view types only: the
 * editor components render what they are handed and report every change back
 * through callbacks. Nothing here fetches, stores or merges.
 */

/** `BLOCK-002` names every inline mark the body carries, and nothing else. */
export type InlineMark =
  "bold" | "italic" | "underline" | "strikethrough" | "code";

/** The stored highlight colours. Colour never carries meaning on its own. */
export type InlineColour = "yellow" | "blue" | "green" | "red" | "purple";

export type MentionKind = "person" | "group" | "page" | "date";

export type StatusColour = "grey" | "blue" | "green" | "yellow" | "red" | "purple";

export interface InlineSpan {
  text: string;
  status?: {colour:StatusColour};
  marks?: InlineMark[];
  colour?: InlineColour;
  link?: { href: string };
  /** `BLOCK-005` — a person, page or date mention rendered from its current value. */
  mention?: { kind: MentionKind; label: string; id?: string; state?:string; available?:boolean };
  /** `COMM-001` — the anchor an anchored comment points at. */
  commentAnchorId?: string;
}

export type RichText = InlineSpan[];

export function isRichTextEmpty(value: RichText): boolean {
  return value.every((span) => span.text.length === 0 && !span.mention);
}

export function richTextToPlain(value: RichText): string {
  return value.map((span) => span.mention?.label ?? span.text).join("");
}

/* ---------- blocks ---------- */

interface BlockBase {
  id: string;
  /** Nesting depth in the body tree. */
  indent?: number;
  /** Structural parent for a layout; ordinary indentation stays relative to it. */
  layoutParentId?: string;
  synced?: SyncedResolution;
  copyRevisionId?: string;
}

export interface ParagraphBlockData extends BlockBase {
  type: "paragraph";
  text: RichText;
}

export interface HeadingBlockData extends BlockBase {
  type: "heading";
  level: 1 | 2 | 3;
  text: RichText;
  /** An author-written section number, as the references show. */
  number?: string;
}

export interface ListItemData {
  id: string;
  text: RichText;
  /** Toggle lists only. */
  open?: boolean;
  detail?: RichText;
}

export interface ListBlockData extends BlockBase {
  type: "list";
  variant: "bulleted" | "numbered" | "toggle";
  start?: number;
  items: ListItemData[];
}

export interface QuoteBlockData extends BlockBase {
  type: "quote";
  text: RichText;
  attribution?: string;
}

export interface DividerBlockData extends BlockBase {
  type: "divider";
}

export type CalloutTone = "neutral" | "accent" | "good" | "warn" | "danger";

export interface CalloutBlockData extends BlockBase {
  type: "callout";
  tone: CalloutTone;
  icon?: string;
  text: RichText;
}

export interface ExpandableBlockData extends BlockBase {
  type: "expandable";
  summary: string;
  open: boolean;
  content: RichText;
}

export interface TableRowData {
  id: string;
  cells: string[];
}

export interface TableBlockData extends BlockBase, TableContent {
  type: "table";
  caption?: string;
  columns: string[];
  rows: TableRowData[];
}

export interface CodeBlockData extends BlockBase {
  type: "code";
  language: string;
  /** The languages this deployment offers, in the order they are listed. */
  languages: string[];
  code: string;
}

export interface TaskBlockData extends BlockBase {
  type: "task";
  text: RichText;
  done: boolean;
  assigneeMemberId?: string | null;
  dueDate?: string | null;
  creatorMemberId?: string;
  /** `BLOCK-007` — completion is assigned by the server. */
  completedByMemberId?: string | null;
  completedAt?: string | null;
  completedBy?: { name: string };
  completedAtLabel?: string;
}

export type MediaKind = "image" | "video" | "audio" | "file";

export interface MediaSource {
  fileId?: string;
  url: string;
  name: string;
  sizeLabel?: string;
  contentType?: string;
}

export interface MediaBlockData extends BlockBase {
  type: "media";
  kind: MediaKind;
  /** Null until a file is uploaded or a link is added. */
  source: MediaSource | null;
  caption: string;
  alt: string;
}

export interface FileCardBlockData extends BlockBase, FileReference {type:"file-card"}

export type LinkCardDisplay = "plain" | "inline" | "card" | "embed";
export type LinkPreviewState = "ready" | "loading" | "refused" | "failed";

export interface LinkCardBlockData extends BlockBase {
  type: "link-card";
  /** Stored exactly as pasted, whatever the preview did. */
  url: string;
  display: LinkCardDisplay;
  previewState: LinkPreviewState;
  preview?: {
    title: string;
    description?: string;
    siteName?: string;
    iconLabel?: string;
  };
  /** Why a refused or failed fetch left the plain link. */
  previewMessage?: string;
}

export interface ContentQueryDefinition {
  search?: EmbeddedSearchQuery;
  searchName?: string;
  label?: string;
  container?: string;
  ancestor?: string;
  pageType?: string;
  status?: string;
  contributor?: string;
  dateRange?: string;
  orderBy?: string;
  limit?: number;
}

export interface ContentQueryResult {
  id: string;
  title: string;
  typeLabel: string;
  containerLabel: string;
  description?: string;
  trust?: PageTrust;
}

export interface ContentQueryBlockData extends BlockBase {
  type: "content-query";
  definition: ContentQueryDefinition;
  /** When the list last re-ran, written for a reader. */
  lastRanLabel: string;
  results: ContentQueryResult[];
  /** `BLOCK-010` — a deleted source says so instead of showing an empty list. */
  sourceMissing?: { message: string };
}

export interface TableOfContentsBlockData extends BlockBase, TableOfContentsSettings { type: "table-of-contents" }
export interface TaskReportBlockData extends BlockBase { type: "task-report"; definition:TaskReportDefinition }

export interface ColumnsBlockData extends BlockBase {type:"columns";count:number}
export interface ColumnBlockData extends BlockBase {type:"column"}

export interface SyncedSourceBlockData extends BlockBase {type:"synced-source";text:RichText}
export interface SyncedReferenceBlockData extends BlockBase {type:"synced-reference";sourcePageId:string;sourceBlockId:string;staticId?:string}

export type EditorBlock =
  | SyncedSourceBlockData
  | SyncedReferenceBlockData
  | ColumnsBlockData
  | ColumnBlockData
  | ParagraphBlockData
  | HeadingBlockData
  | ListBlockData
  | QuoteBlockData
  | DividerBlockData
  | CalloutBlockData
  | ExpandableBlockData
  | TableBlockData
  | CodeBlockData
  | TaskBlockData
  | MediaBlockData
  | FileCardBlockData
  | LinkCardBlockData
  | ContentQueryBlockData
  | TableOfContentsBlockData
  | TaskReportBlockData;

export type EditorBlockType = EditorBlock["type"];

/* ---------- movement ---------- */

export type BlockMove =
  | { kind: "into-column"; columnId: string }
  | { kind: "step"; direction: "up" | "down" }
  | { kind: "indent" }
  | { kind: "outdent" }
  | { kind: "before"; blockId: string }
  | { kind: "after"; blockId: string };

/* ---------- save state (SAVE-001…SAVE-004) ---------- */

export interface RevisionConflict {
  /** The revision the local draft began from. */
  fromRevision: string;
  currentRevision: string;
  byMemberName: string;
  atLabel: string;
  localPreview?: string;
  serverPreview?: string;
}

export type BlockSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; atLabel?: string }
  | { status: "failed"; message: string }
  | { status: "offline" }
  /** SAVE-004: the server is reachable again and the unsent draft awaits an explicit save. */
  | { status: "unsaved" }
  | { status: "conflict"; conflict: RevisionConflict };

/** What a member may choose when an edit hits a superseded revision. */
export type ConflictChoice = "compare" | "reload" | "overwrite";

/* ---------- shared renderer props ---------- */

export interface BlockActions {
  layoutBusy?: boolean;
  onMakeSynced?: (blockId:string)=>void;
  onSyncedSaved?: ()=>Promise<void>;
  onConvertTable?: (blockId:string) => void;
  onCopyCode?: (blockId: string) => void;
  onChooseFile?: (blockId: string) => void;
  onAddFileLink?: (blockId: string) => void;
  onDownloadFile?: (blockId: string) => void;
  onRetryPreview?: (blockId: string) => void;
  onRerunQuery?: (blockId: string) => void;
  onOpenQueryResult?: (pageId: string) => void;
  onEditQueryDefinition?: (blockId: string) => void;
}

export interface BlockRenderProps<TBlock extends EditorBlock> {
  block: TBlock;
  canEdit: boolean;
  onChange: (next: TBlock) => void;
  actions?: BlockActions;
}
