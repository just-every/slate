import { FileText, History, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { IconAction } from "../../../../app/ui/header/IconAction";
import { TopBar, type Crumb } from "../../../../app/ui/header/TopBar";

/**
 * The page's top bar: its location, then Share as the one primary action, icon buttons for Comments, History and Details, and
 * the More menu, which lists everything else. On a phone History and Details are reached from More (`desktop-page-tool` is hidden
 * there).
 */
export function PageTopBar({
  trail,
  flagship,
  detail,
  onToggle,
  more,
}: {
  trail: Crumb[];
  flagship: boolean;
  detail: string | null;
  onToggle: (panel: string) => void;
  /** The More menu. */
  more: ReactNode;
}) {
  return (
    <TopBar className="page-topbar" trail={trail}>
      {flagship ? (
        <button className="tool desktop-page-tool" type="button" aria-expanded={detail === "ask"} onClick={() => onToggle("ask")}>
          Ask
        </button>
      ) : null}
      <button className="tool tool-primary" type="button" aria-expanded={detail === "share"} onClick={() => onToggle("share")}>
        Share
      </button>
      <IconAction label="Comments" data-tooltip="Page comments" aria-expanded={detail === "comments"} onClick={() => onToggle("comments")}>
        <MessageSquare aria-hidden="true" />
      </IconAction>
      <IconAction className="desktop-page-tool" label="History" data-tooltip="Version history" aria-expanded={detail === "history"} onClick={() => onToggle("history")}>
        <History aria-hidden="true" />
      </IconAction>
      <IconAction className="desktop-page-tool" label="Details" data-tooltip="Page details" aria-expanded={detail === "details"} onClick={() => onToggle("details")}>
        <FileText aria-hidden="true" />
      </IconAction>
      {more}
    </TopBar>
  );
}
