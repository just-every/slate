import { useFlagshipEnabled } from "../../../app/ui/LaunchProfile";
import { Bold, Code, Italic, Link2, MessageSquarePlus, Palette, Sparkles, Strikethrough, Underline } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Toggle,
  cn,
} from "../../../ui";
import type { InlineColour, InlineMark } from "./types";

const marks: { mark: InlineMark; label: string; icon: typeof Bold }[] = [
  { mark: "bold", label: "Bold", icon: Bold },
  { mark: "italic", label: "Italic", icon: Italic },
  { mark: "underline", label: "Underline", icon: Underline },
  { mark: "strikethrough", label: "Strikethrough", icon: Strikethrough },
  { mark: "code", label: "Inline code", icon: Code },
];

const colours: { colour: InlineColour; label: string; swatch: string }[] = [
  { colour: "yellow", label: "Yellow", swatch: "bg-hl-yellow" },
  { colour: "blue", label: "Blue", swatch: "bg-hl-blue" },
  { colour: "green", label: "Green", swatch: "bg-hl-green" },
  { colour: "red", label: "Red", swatch: "bg-hl-red" },
  { colour: "purple", label: "Purple", swatch: "bg-hl-purple" },
];

export interface InlineToolbarProps {
  activeMarks: InlineMark[];
  colour?: InlineColour | null;
  canEdit: boolean;
  onToggleMark: (mark: InlineMark) => void;
  onColour: (colour: InlineColour | null) => void;
  onLink: () => void;
  onComment: () => void;
  onAskAi: () => void;
  className?: string;
}

/** The selection toolbar: `BLOCK-002`'s marks, a comment, and an AI request. */
export function InlineToolbar({
  activeMarks,
  colour = null,
  canEdit,
  onToggleMark,
  onColour,
  onLink,
  onComment,
  onAskAi,
  className,
}: InlineToolbarProps) {
  const flagship = useFlagshipEnabled();
  return (
    <div
      aria-label="Formatting for the selected text"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-card border border-line bg-surface px-1 py-1 shadow-[0_12px_32px_rgb(15_15_15/0.16)]",
        className,
      )}
      role="toolbar"
    >
      {marks.map(({ mark, label, icon: Icon }) => (
        <Toggle
          aria-label={label}
          data-tooltip={label === "Bold" ? "Bold text" : label === "Italic" ? "Italic text" : label === "Underline" ? "Underline text" : label === "Strikethrough" ? "Strike text" : label}
          disabled={!canEdit}
          key={mark}
          onPressedChange={() => onToggleMark(mark)}
          pressed={activeMarks.includes(mark)}
        >
          <Icon aria-hidden="true" className="size-4" />
        </Toggle>
      ))}

      <Popover>
        <PopoverTrigger asChild>
          <Button aria-label="Text colour" data-tooltip="Text colour" disabled={!canEdit} size="icon" variant="ghost">
            <Palette aria-hidden="true" className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1">
          <ul className="flex flex-col">
            {colours.map((option) => (
              <li key={option.colour}>
                <button
                  aria-pressed={colour === option.colour}
                  className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-ui text-ink transition-colors hover:bg-sidebar-hover"
                  onClick={() => onColour(option.colour)}
                  type="button"
                >
                  <span aria-hidden="true" className={cn("size-4 rounded-[3px] border border-line", option.swatch)} />
                  {option.label}
                </button>
              </li>
            ))}
            <li>
              <button
                aria-pressed={colour === null}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-ui text-ink transition-colors hover:bg-sidebar-hover"
                onClick={() => onColour(null)}
                type="button"
              >
                <span aria-hidden="true" className="size-4 rounded-[3px] border border-line-strong" />
                No colour
              </button>
            </li>
          </ul>
        </PopoverContent>
      </Popover>

      <Button aria-label="Add a link" data-tooltip="Add link" disabled={!canEdit} onClick={onLink} size="icon" variant="ghost">
        <Link2 aria-hidden="true" className="size-4" />
      </Button>

      <Separator className="mx-1 h-5 w-px" orientation="vertical" />

      <Button onClick={onComment} size="sm" variant="ghost">
        <MessageSquarePlus aria-hidden="true" className="size-4" />
        Comment
      </Button>
      {flagship ? <Button onClick={onAskAi} size="sm" variant="ghost">
        <Sparkles aria-hidden="true" className="size-4" />
        Ask AI
      </Button> : null}
    </div>
  );
}
