import { useState } from "react";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { request, mutate, operationKey } from "../../../../client/transport";
import type { DocumentView } from "../../../../client/content";
import { galleries, suppliedIcons, type PageAppearanceView } from "./PageAppearance";

/** The dialog that sets, replaces or removes the page's icon or cover. */
export function PageAppearanceDialog({
  document,
  revision,
  kind,
  onClose,
  onSaved,
}: {
  document: DocumentView;
  revision: string;
  kind: "icon" | "cover";
  onClose: () => void;
  onSaved: (revisionId: string) => void;
}) {
  const props = document.properties as PageAppearanceView | undefined;
  const cover = props?.cover;
  const [mode, setMode] = useState(kind === "icon" ? (props?.icon?.startsWith("file:") ? "upload" : suppliedIcons.includes(props?.icon ?? "") ? "symbols" : "gallery") : props?.coverFileId ? "upload" : cover?.kind === "link" ? "link" : "gallery");
  async function save(properties: object) {
    const result = await mutate<{ value: { revisionId: string } }>(
      `/api/pages/${document.page.id}`,
      { operationKey: operationKey(), expectedRevisionId: revision, properties },
      "PATCH",
    );
    onSaved(result.value.revisionId);
  }
  async function submit(form: FormData) {
    if (form.get("remove") === "on") {
      await save(kind === "icon" ? { icon: null } : { cover: null, coverFileId: null });
      return;
    }
    if (mode === "upload") {
      const upload = new FormData();
      upload.set("file", form.get("file")!);
      upload.set("pageId", document.page.id);
      upload.set("operationKey", operationKey());
      const result = await request<{ value: { id: string } }>("/api/media", { method: "POST", body: upload });
      await save(kind === "icon" ? { icon: `file:${result.value.id}` } : { coverFileId: result.value.id });
    } else if (kind === "icon") await save({ icon: String(form.get(mode === "symbols" ? "symbol" : "icon")) });
    else await save({ cover: mode === "gallery" ? { kind: "gallery", id: String(form.get("gallery")) } : { kind: "link", url: String(form.get("url")) } });
  }
  return (
    <ActionDialog title={kind === "icon" ? "Page icon" : "Page cover"} action="Save appearance" onClose={onClose} onSubmit={submit}>
      {kind === "cover" ? (
        <label>
          Cover source
          <select aria-label="Cover source" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="gallery">Gallery</option>
            <option value="upload">Upload</option>
            <option value="link">Link</option>
          </select>
        </label>
      ) : (
        <label>
          Icon source
          <select aria-label="Icon source" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="gallery">Emoji</option>
            <option value="symbols">Supplied icons</option>
            <option value="upload">Upload</option>
          </select>
        </label>
      )}
      {mode === "upload" ? (
        <label>
          Image
          <input name="file" type="file" accept="image/*" />
        </label>
      ) : kind === "icon" && mode === "symbols" ? (
        <label>
          Supplied icon
          <select name="symbol" aria-label="Supplied icon" defaultValue={suppliedIcons.includes(props?.icon ?? "") ? props!.icon! : suppliedIcons[0]}>
            {suppliedIcons.map(icon => <option key={icon} value={icon}>{icon}</option>)}
          </select>
        </label>
      ) : kind === "icon" ? (
        <label>
          Icon
          <input name="icon" list="page-icon-symbols" defaultValue={typeof props?.icon === "string" && !props.icon.startsWith("file:") ? props.icon : ""} />
          <datalist id="page-icon-symbols">
            {["📄", "📚", "💡", "⭐", "🧭", "✅"].map((icon) => (
              <option key={icon} value={icon} />
            ))}
          </datalist>
        </label>
      ) : mode === "gallery" ? (
        <label>
          Gallery
          <select aria-label="Gallery" name="gallery" defaultValue={cover?.kind === "gallery" ? cover.id : "sand"}>
            {Object.keys(galleries).map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Cover HTTPS link
          <input type="url" pattern="https://.*" name="url" defaultValue={cover?.kind === "link" ? cover.url : ""} />
        </label>
      )}
      <label>
        <input type="checkbox" name="remove" />
        Remove {kind}
      </label>
    </ActionDialog>
  );
}
