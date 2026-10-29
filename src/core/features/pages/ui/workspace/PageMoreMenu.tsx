import {
  Archive,
  Bell,
  BellOff,
  CalendarX,
  ChartColumn,
  ChevronDown,
  CircleDot,
  Copy,
  Ellipsis,
  FileDown,
  FolderInput,
  Globe,
  History,
  ImagePlus,
  Info,
  LayoutTemplate,
  LockKeyhole,
  LockKeyholeOpen,
  Palette,
  Presentation,
  Scale,
  Send,
  Sparkles,
  SmilePlus,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { contentApi, type DocumentView } from "../../../../client/content";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../../ui";
import { PageActionDialogs, type PageDialog } from "./PageActionDialogs";
import { usePageFollowing } from "./usePageFollowing";
import { errorMessage } from "../../../../client/transport";
import { ReminderDialog } from '../../../editor/ui/blocks/ReminderDialog';

/** A trailing mark on items that open a dialog or a panel; it is not part of the item's name. */
const opens = <span aria-hidden="true">…</span>;

/**
 * The page's More menu: a compact list of every remaining page action. Items either act at once, open a dialog, or open one
 * of the page's side panels, and only then. Favourite and Watch keep the menu open so the new state is seen.
 */
export function PageMoreMenu({
  document,
  unsaved,
  revision,
  flagship,
  extraItems,
  reload,
  onPresent,
  onOpenPanel,
}: {
  document: DocumentView;
  unsaved: boolean;
  revision: string;
  flagship: boolean;
  /** Items a host adds to the menu, after Export page. */
  extraItems?: ReactNode;
  reload: () => void;
  onPresent: () => void;
  /** Opens a side panel; `returnTo` is where focus goes when it closes. */
  onOpenPanel: (kind: string, returnTo: HTMLElement | null) => void;
}) {
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  const [reminder,setReminder]=useState(false);
  const [locking,setLocking]=useState(false);
  const [lockError,setLockError]=useState<unknown>();
  async function toggleLock() {
    if (locking) return;
    setLocking(true); setLockError(undefined);
    try {
      await contentApi.lock(document.page.id, revision, !document.lock);
      await reload();
      window.dispatchEvent(new Event("slate:navigation-changed"));
    } catch (cause) { setLockError(cause); }
    finally { setLocking(false); }
  }
  // On a phone the top bar drops Ask, History and Details, so the menu carries them.
  const [phone, setPhone] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const handoff = useRef(false);
  const following = usePageFollowing(document.page.id);
  // When a dialog closes, focus returns to the menu's button, not to the page behind it.
  const dialogWasOpen = useRef(false);
  useEffect(() => {
    if (dialog) dialogWasOpen.current = true;
    else if (dialogWasOpen.current) {
      dialogWasOpen.current = false;
      trigger.current?.focus();
    }
  }, [dialog]);
  const { canEdit, canShare } = document.permissions;
  const props = document.properties as (NonNullable<DocumentView["properties"]> & { cover?: unknown; coverFileId?: unknown }) | undefined;
  const hasCover = !!(props?.cover || props?.coverFileId);
  const publishable =
    canEdit &&
    (document.policyProfile["page.lifecycle.v1"] === "draft-then-publish" || document.policyProfile["page.version.v1"] === "labelled" || document.page.lifecycle === "draft");
  const hasUnpublished = document.policyProfile["page.lifecycle.v1"] === "draft-then-publish" && !!document.publishedRevisionId && document.publishedRevisionId !== document.workingRevisionId;

  /** An item that opens a dialog or panel takes focus there instead of back to the trigger. */
  function open(action: () => void) {
    return () => {
      handoff.current = true;
      action();
    };
  }
  const panel = (kind: string) => open(() => onOpenPanel(kind, trigger.current));
  const dialogItem = (kind: PageDialog) => open(() => setDialog(kind));
  const stayOpen = (action: () => void) => (event: Event) => {
    event.preventDefault();
    action();
  };
  const item = (icon: ReactNode, label: string, onSelect: (event: Event) => void, dialogOrPanel = true) => (
    <DropdownMenuItem onSelect={onSelect}>
      {icon}
      <span>
        {label}
        {dialogOrPanel ? opens : null}
      </span>
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu onOpenChange={(open) => {if(open){setPhone(window.matchMedia("(max-width: 700px)").matches);void following.refresh();}}}>
        <DropdownMenuTrigger asChild>
          <button ref={trigger} className="tool" type="button" data-page-more>
            <Ellipsis aria-hidden="true" />
            More
            <ChevronDown aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="page-more-menu"
          tabIndex={0}
          onCloseAutoFocus={(event) => {
            if (!handoff.current) return;
            handoff.current = false;
            event.preventDefault();
          }}
        >
          {phone ? (
            <>
              {flagship ? item(<Sparkles aria-hidden="true" />, "Ask", panel("ask"), false) : null}
              {item(<History aria-hidden="true" />, "History", panel("history"), false)}
              {item(<Info aria-hidden="true" />, "Details", panel("details"), false)}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {item(<Presentation aria-hidden="true" />, "Present this page", open(onPresent), false)}
          {item(<FileDown aria-hidden="true" />, "Export page", dialogItem("export"))}
          {item(<Bell aria-hidden="true" />, "Remind me", open(()=>setReminder(true)))}
          {extraItems}
          <DropdownMenuItem disabled={following.disabled} onSelect={stayOpen(() => void following.toggleFavourite())}>
            <Star aria-hidden="true" fill={following.favourite ? "currentColor" : "none"} />
            {following.favourite ? "Remove from favourites" : "Add to favourites"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={following.disabled} onSelect={stayOpen(() => void following.toggleWatch())}>
            {following.watched ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
            {following.watched ? "Stop watching" : "Watch this page"}
          </DropdownMenuItem>
          {following.error ? <p className="page-more-note" role="alert">{following.error}</p> : null}
          <DropdownMenuSeparator />
          {document.permissions.canUnlock ? <DropdownMenuItem disabled={locking || (!document.lock && unsaved)} onSelect={() => void toggleLock()}>
            {document.lock ? <LockKeyholeOpen aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
            <span>{document.lock ? "Unlock page" : "Lock page"}</span>
          </DropdownMenuItem> : null}
          {document.permissions.canUnlock && !document.lock && unsaved ? <p className="page-more-note">Save or resolve your current edits before locking.</p> : null}
          {canEdit ? (
            <>
              {item(<SmilePlus aria-hidden="true" />, props?.icon ? "Change icon" : "Add icon", dialogItem("icon"))}
              {item(<ImagePlus aria-hidden="true" />, hasCover ? "Change cover" : "Add cover", dialogItem("cover"))}
              {item(<Palette aria-hidden="true" />, "Display settings", panel("display"))}
              {item(<Scale aria-hidden="true" />, "Add decision record", dialogItem("decision"))}
              {item(<FolderInput aria-hidden="true" />, "Move page", dialogItem("move"))}
            </>
          ) : null}
          {item(<Copy aria-hidden="true" />, "Duplicate page", dialogItem("duplicate"))}
          {canEdit ? item(<LayoutTemplate aria-hidden="true" />, "Save as template", dialogItem("template")) : null}
          <DropdownMenuSeparator />
          {item(<CircleDot aria-hidden="true" />, "Page status", panel("status"))}
          {item(<ChartColumn aria-hidden="true" />, "Readership & contributors", panel("readership"))}
          {canShare ? item(<Globe aria-hidden="true" />, "Public access", panel("publication")) : null}
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              {publishable ? (
                <DropdownMenuItem disabled={unsaved} onSelect={dialogItem("publish")}>
                  <Send aria-hidden="true" />
                  <span>
                    Publish workspace revision
                    {opens}
                  </span>
                </DropdownMenuItem>
              ) : null}
              {publishable && unsaved ? <p className="page-more-note">Save or resolve your current edits before reviewing publication.</p> : null}
              {document.page.lifecycle === "scheduled" ? item(<CalendarX aria-hidden="true" />, "Cancel scheduled publication", dialogItem("cancel-schedule")) : null}
              {hasUnpublished ? item(<Undo2 aria-hidden="true" />, "Discard unpublished changes", dialogItem("discard-changes")) : null}
              {item(<Archive aria-hidden="true" />, "Archive page", dialogItem("archive"))}
              <DropdownMenuItem className="text-danger [&_svg]:text-danger" onSelect={dialogItem("trash")}>
                <Trash2 aria-hidden="true" />
                <span>
                  Move to trash
                  {opens}
                </span>
              </DropdownMenuItem>
            </>
          ) : (
            <p className="page-more-note">{document.lock ? "This page is locked. Unlock it to edit." : "You can read this page. Editing options require edit access."}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {lockError ? <p role="alert">{errorMessage(lockError)}</p> : null}
      <PageActionDialogs
        dialog={dialog}
        document={document}
        revision={revision}
        reload={reload}
        onClose={() => setDialog(null)}
      />
      {reminder?<ReminderDialog pageId={document.page.id} onClose={()=>setReminder(false)}/>:null}
    </>
  );
}
