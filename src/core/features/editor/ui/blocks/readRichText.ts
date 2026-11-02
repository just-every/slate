import type { InlineSpan, RichText } from "../types";

/** A final BR keeps an otherwise empty browser line editable; it is not text. */
export function isPlaceholderBreak(element: HTMLElement, root: HTMLElement): boolean {
  if (element.tagName !== "BR") return false;
  if (element.hasAttribute("data-slate-caret-placeholder")) return true;
  let node: HTMLElement | null = element;
  while (node && node !== root) {
    if (node.nextSibling) return false;
    const parent: HTMLElement | null = node.parentElement;
    if (parent === root || parent?.tagName === "DIV" || parent?.tagName === "P") return true;
    node = parent;
  }
  return false;
}

/** Read edited text while retaining the metadata attached to each rendered run. */
export function readRichText(root: HTMLElement, previous: RichText): RichText {
  const result: RichText = [];
  const append = (text: string, metadata: Omit<InlineSpan, "text">) => {
    if (text) result.push({ ...metadata, text });
  };
  const visit = (node: Node, inherited: Omit<InlineSpan, "text">) => {
    if (node.nodeType === 3) {
      append(node.textContent ?? "", inherited);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    const index = element.getAttribute("data-inline-span");
    let metadata = inherited;
    if (index !== null) {
      const original = previous[Number(index)];
      if (!original) throw new Error("Edited inline span has no source metadata");
      const { text: _text, ...rest } = original;
      metadata = rest;
      if (original.mention || original.status || original.link && element.querySelector('[data-page-reference]')) {
        result.push({ ...original });
        return;
      }
    }
    if (element.tagName === "BR") {
      if (!isPlaceholderBreak(element, root)) append("\n", metadata);
      return;
    }
    if ((element.tagName === "DIV" || element.tagName === "P") && element.previousSibling) {
      append("\n", {});
    }
    element.childNodes.forEach((child) => visit(child, metadata));
  };
  root.childNodes.forEach((child) => visit(child, {}));
  return result;
}
