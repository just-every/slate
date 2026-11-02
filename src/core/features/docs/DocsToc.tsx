import type { DocsTocEntry } from './types';

type Group = DocsTocEntry & { children: DocsTocEntry[] };

/** h3 entries nest under the h2 before them; short pages retain their title entry. */
function groups(toc: DocsTocEntry[]) {
  return toc.reduce<Group[]>((list, entry) => {
    if (entry.depth === 3 && list.length) list[list.length - 1].children.push(entry);
    else list.push({ ...entry, children: [] });
    return list;
  }, []);
}

function TocList({ toc }: { toc: DocsTocEntry[] }) {
  return <ul>
    {groups(toc).map(group => <li key={group.id}>
      <a href={`#${group.id}`}>{group.text}</a>
      {group.children.length > 0 && <ul>{group.children.map(entry => <li key={entry.id}><a href={`#${entry.id}`}>{entry.text}</a></li>)}</ul>}
    </li>)}
  </ul>;
}

/** The contents list beside the page, from 1200px. */
export function DocsToc({ toc }: { toc: DocsTocEntry[] }) {
  if (!groups(toc).length) return null;
  return <nav className="docs-toc" aria-label="On this page">
    <p className="docs-toc-title">On this page</p>
    <TocList toc={toc} />
  </nav>;
}

/** The same list above the page body below 1200px, folded away until asked for. */
export function DocsTocCompact({ toc }: { toc: DocsTocEntry[] }) {
  if (!groups(toc).length) return null;
  return <details className="docs-toc-compact">
    <summary>On this page</summary>
    <TocList toc={toc} />
  </details>;
}
