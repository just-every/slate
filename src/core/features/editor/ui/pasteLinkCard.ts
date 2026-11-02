import { sliceRichText } from './sliceRichText';
import type { EditableSelection } from './blocks/editableSelection';
import type { EditorBlock, LinkCardBlockData } from './types';

/** Split the selected text at the native cursor, retaining surrounding rich text. */
export function pasteLinkCard(blocks: EditorBlock[], id: string, range: EditableSelection, url: string) {
  const index = blocks.findIndex(block => block.id === id), source = blocks[index];
  if (!source || !('text' in source)) return null;
  const start = Math.min(range.anchor, range.focus), end = Math.max(range.anchor, range.focus);
  const before = sliceRichText(source.text, 0, start), after = sliceRichText(source.text, end);
  const card: LinkCardBlockData = {
    id: before.length ? crypto.randomUUID() : source.id, type: 'link-card',
    indent: source.indent, layoutParentId: source.layoutParentId,
    url, display: 'card', previewState: 'loading',
  };
  const tail: EditorBlock = { id: crypto.randomUUID(), type: 'paragraph', text: after, indent: source.indent, layoutParentId: source.layoutParentId };
  const next = [...blocks];
  next.splice(index, 1, ...(before.length ? [{...source, text: before}] : []), card, tail);
  return { blocks: next, card, focusId: tail.id };
}
