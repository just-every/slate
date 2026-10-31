import { useState } from "react";
import type { DocumentView } from "../../../../client/content";
import { usePagePropertySave } from "../../../../client/usePagePropertySave";
import { PagePropertyConflict } from "./PagePropertyConflict";
import { errorMessage } from "../../../../client/transport";

/** The page's labels and reading display: typeface, small text and full width. Editors only. */
export function PageDisplay({ document, revision, reload }: { document: DocumentView; revision: string; reload: () => void }) {
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const properties = usePagePropertySave(document.page.id, revision);
  if (!document.permissions.canEdit) return <section><h2>Display settings</h2><p>You can read this page. Editing options require edit access.</p></section>;
  return (
    <section>
      <h2>Display settings</h2>
      <form
        className="detail-form"
        onChange={() => setSaved(false)}
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setError(undefined);
          setSaved(false);
          setSaving(true);
          try {
            await properties.save({
              labels: String(data.get("labels") ?? "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              typeface: String(data.get("typeface")),
              smallText: data.get("smallText") === "on",
              fullWidth: data.get("fullWidth") === "on",
            });
            await reload();
            setSaved(true);
          } catch (cause) {
            setError(cause);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Labels
          <input name="labels" defaultValue={document.properties?.labels?.join(", ")} placeholder="Separate with commas" />
        </label>
        <label>
          Typeface
          <select name="typeface" defaultValue={document.properties?.typeface ?? "default"}>
            <option value="default">Default</option>
            <option value="serif">Serif</option>
            <option value="mono">Mono</option>
          </select>
        </label>
        <label>
          <input type="checkbox" name="smallText" defaultChecked={document.properties?.smallText} />
          Small text
        </label>
        <label>
          <input type="checkbox" name="fullWidth" defaultChecked={document.properties?.fullWidth} />
          Full width
        </label>
        <button type="submit" disabled={saving}>{saving ? "Saving display settings…" : "Save display settings"}</button>
        {saved ? <p role="status">Display settings saved.</p> : null}
      </form>
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
      {properties.conflict ? <PagePropertyConflict/> : null}
    </section>
  );
}
