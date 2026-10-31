import { useState } from "react";
import { Image } from "lucide-react";
import type { DocumentView } from "../../../../client/content";

export type PageCover = { kind: "gallery"; id: string } | { kind: "link"; url: string };

export const galleries: Record<string, string> = {
  sand: "linear-gradient(120deg,#ead3b0,#b07c55)",
  ocean: "linear-gradient(120deg,#87bfce,#275c77)",
  forest: "linear-gradient(120deg,#a6bb98,#36553b)",
  sunset: "linear-gradient(120deg,#e6b875,#a74b5c)",
  lavender: "linear-gradient(120deg,#d5c7e8,#7b6a9a)",
  slate: "linear-gradient(120deg,#bbc3cb,#4e5967)",
};

export const suppliedIcons = ["◆", "✦", "✓", "⚑", "⌘"];

export function StoredIcon({ icon }: { icon: unknown }) {
  if (typeof icon !== "string" || !icon) return null;
  return icon.startsWith("file:") ? (
    <img className="stored-page-icon" src={`/api/media/${encodeURIComponent(icon.slice(5))}?display=icon`} alt="Page icon" aria-hidden="true" />
  ) : (
    <span className="stored-page-icon" aria-hidden="true">
      {icon}
    </span>
  );
}

export interface PageAppearanceView {
  icon?: string | null;
  cover?: PageCover | null;
  coverFileId?: string | null;
}

/** Remote loading is consent for this exact URL, including after replacement. */
export function StoredCover({ cover, coverFileId, compact = false }: PageAppearanceView & { compact?: boolean }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const className = compact ? "page-cover-thumbnail" : "page-cover-image";
  if (coverFileId) return <img className={className} src={`/api/media/${encodeURIComponent(coverFileId)}?display=cover`} alt="Page cover" />;
  if (cover?.kind === "gallery") return <div className={className} role="img" aria-label={`${cover.id} gallery cover`} style={{ background: galleries[cover.id] }} />;
  if (cover?.kind !== "link") return null;
  if (loadedUrl === cover.url) return <img className={className} src={cover.url} alt="Linked page cover" referrerPolicy="no-referrer" />;
  const label = `Load cover from ${new URL(cover.url).hostname}`;
  return <button className={compact ? "page-cover-load" : undefined} aria-label={label} data-tooltip={compact ? "Load linked cover" : undefined} data-tooltip-align={compact ? "end" : undefined} onClick={() => setLoadedUrl(cover.url)}>
    {compact ? <Image aria-hidden="true" /> : label}
  </button>;
}

/** The page's cover and icon as they sit above the title. */
export function PageAppearance({ document }: { document: DocumentView }) {
  const props = document.properties as PageAppearanceView | undefined;
  return (
    <div className="page-appearance">
      <StoredCover key={props?.cover?.kind === "link" ? props.cover.url : props?.coverFileId ?? props?.cover?.id ?? "none"} {...props} />
      <StoredIcon icon={props?.icon} />
    </div>
  );
}
