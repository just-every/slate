import { Columns2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../../../../ui";
import { IconAction } from "../../../../app/ui/header/IconAction";

/** DB-010's three presentations of one record address (Q3): beside its list (the default), a centred sheet, or a full page. */
export type RecordLayout = "beside" | "centred" | "full";
const key = "slate.record-layout";
const layouts: { value: RecordLayout; label: string }[] = [
  { value: "beside", label: "Beside the list" },
  { value: "centred", label: "Centred" },
  { value: "full", label: "Full page" },
];

/** The layout chosen in this browser; never in the address. */
export function useRecordLayout() {
  const [layout, setLayout] = useState<RecordLayout>("beside");
  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (layouts.some((item) => item.value === stored)) setLayout(stored as RecordLayout);
  }, []);
  return [layout, (next: RecordLayout) => { setLayout(next); localStorage.setItem(key, next); }] as const;
}

/** Whether the window is wide enough for a record beside its list (1280 px, Q1); under it every layout is the record's own page. */
export function useBesideWidth() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = matchMedia("(min-width: 1280px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

/** One icon-only control at the record's top right; there is none under 1280 px. */
export function RecordLayoutMenu({ layout, onLayout }: { layout: RecordLayout; onLayout: (next: RecordLayout) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconAction className="record-layout" label="Record layout" tooltipAlign="end">
          <Columns2 aria-hidden="true" />
        </IconAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={layout} onValueChange={(value) => onLayout(value as RecordLayout)}>
          {layouts.map((item) => <DropdownMenuRadioItem key={item.value} value={item.value}>{item.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
