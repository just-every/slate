import { useEffect, useState, type ElementType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { richTextToPlain, type RichText } from "../types";
import { InlineText } from "./InlineText";
import { EditableElement } from "./EditableElement";

/**
 * One editable run of inline text. The element carries `data-slate-editable` and
 * `data-placeholder`, so an empty run shows its placeholder from the global
 * stylesheet rather than collapsing to a blank box.
 */
export interface EditableProps {
  value: RichText;
  placeholder: string;
  canEdit: boolean;
  /** Report the edited spans without discarding inline metadata. */
  onChange: (value: RichText) => void;
  label: string;
  className?: string;
  multiline?: boolean;
  /** Single-line string fields cannot retain inline metadata. */
  inlineLabels?: boolean;
  mentionPageId?: string;
  previousMentions?: unknown;
  as?: ElementType;
}

export function Editable(props: EditableProps) {
  // Start with the same locale on both sides of hydration. The editable owns
  // serialized markup, so a locale change must produce a fresh markup value.
  const [locale, setLocale] = useState('en-US');
  useEffect(() => { setLocale(navigator.language); }, []);
  // Serialize outside the hooked input component: nested server rendering must
  // finish before React enters that component's hook dispatcher.
  const html = renderToStaticMarkup(<InlineText value={props.value} canEdit={props.canEdit} locale={locale} />) +
    (richTextToPlain(props.value).endsWith("\n") ? '<br data-slate-caret-placeholder="">' : "");
  return <EditableElement {...props} html={html} />;
}

/** A single-line editable field used for captions, summaries and cells. */
export function EditableLine({
  value,
  placeholder,
  canEdit,
  onTextChange,
  label,
  className,
}: Omit<EditableProps, "value" | "multiline" | "as" | "onChange"> & { value: string; onTextChange: (text: string) => void }) {
  return (
    <Editable
      canEdit={canEdit}
      className={className}
      label={label}
      multiline={false}
      inlineLabels={false}
      onChange={(next) => onTextChange(richTextToPlain(next))}
      placeholder={placeholder}
      value={value.length > 0 ? [{ text: value }] : []}
    />
  );
}
