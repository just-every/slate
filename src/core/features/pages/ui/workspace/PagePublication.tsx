import { useState } from "react";
import type { DocumentView } from "../../../../client/content";
import { errorMessage, mutate, operationKey } from "../../../../client/transport";
import { useResource } from "../../../../client/useResource";
import { ActionDialog } from "../../../../app/ui/ActionDialog";
import { RequestState } from "../../../../app/ui/RequestState";
import { displayDate } from "../../../../app/ui/displayDate";
type Exposure = {
  host: string;
  slug: string;
  indexable: boolean;
  theme: string;
  headerControls: string[];
  duplicateAsTemplate: boolean;
  socialPreview: Record<string, string>;
  revokedAt: string | null;
};
export function PagePublication({
  document,
  revision,
}: {
  document: DocumentView;
  revision: string;
}) {
  const resource = useResource<{ exposure: Exposure | null }>(
    document.permissions.canShare
      ? `/api/publishing/${document.page.id}`
      : null,
  );
  const [action, setAction] = useState<"edit" | "revoke" | null>(null);
  const [key, setKey] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [linkError, setLinkError] = useState<unknown>();
  if (!document.permissions.canShare) return null;
  const exposure = resource.data?.exposure;
  const site = document.policyProfile["page.public-access.v1"] === "site";
  const blocked =
    !document.publishedRevisionId ||
    ["draft", "scheduled"].includes(document.page.lifecycle);
  const open = (value: "edit" | "revoke") => {
    setKey(operationKey());
    setAction(value);
  };
  const saveLink = async (changes: { revoke?: boolean; indexable?: boolean }) => {
    setSavingLink(true);
    setLinkError(undefined);
    try {
      await mutate(`/api/publishing/${document.page.id}`, {
        operationKey: operationKey(),
        expectedRevisionId: revision,
        host: exposure?.host ?? window.location.host,
        slug: exposure?.slug ?? crypto.randomUUID(),
        ...changes,
      });
      await resource.reload();
      window.dispatchEvent(new Event("slate:public-page-changed"));
    } catch (cause) {
      setLinkError(cause);
    } finally {
      setSavingLink(false);
    }
  };
  return (
    <section className="publication-settings">
      <h3>Publish to the web</h3>
      <p>
        Publish the current published revision at an address you can share.
        Child pages stay private unless individually published.
      </p>
      <RequestState
        loading={resource.loading}
        error={resource.error}
        retry={resource.reload}
      >
        {!site ? (
          <>
            <label>
              <input
                type="checkbox"
                role="switch"
                checked={!!exposure && !exposure.revokedAt}
                disabled={blocked || resource.loading || savingLink}
                onChange={(event) => void saveLink({ revoke: !event.currentTarget.checked })}
              />
              Public link
            </label>
            {blocked ? <p>Publish a workspace revision first.</p> : null}
            {exposure && !exposure.revokedAt ? (
              <>
                <a href={`${window.location.protocol}//${exposure.host}/p/${exposure.slug}`} target="_blank" rel="noreferrer">
                  {`${window.location.protocol}//${exposure.host}/p/${exposure.slug}`}
                </a>
                <label>
                  <input
                    type="checkbox"
                    checked={exposure.indexable}
                    disabled={savingLink}
                    onChange={(event) => void saveLink({ indexable: event.currentTarget.checked })}
                  />
                  Allow search engines to index this page
                </label>
                <button disabled={savingLink} onClick={() => open("revoke")}>Stop public access</button>
              </>
            ) : null}
            {linkError ? <p role="alert">{errorMessage(linkError)}</p> : null}
          </>
        ) : exposure && !exposure.revokedAt ? (
          <>
            <a
              href={`${window.location.protocol}//${exposure.host}/p/${exposure.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              {site ? "Open public page" : `${window.location.protocol}//${exposure.host}/p/${exposure.slug}`}
            </a>
            <button onClick={() => open("edit")}>Edit public settings</button>
            <button onClick={() => open("revoke")}>Stop public access</button>
          </>
        ) : blocked ? (
          <p>Publish a workspace revision first.</p>
        ) : (
          <button onClick={() => open("edit")}>{site ? "Set up public page" : "Enable public link"}</button>
        )}
        {exposure?.revokedAt ? (
          <p>
            Public access was stopped{" "}
            {displayDate(exposure.revokedAt, true)}.
          </p>
        ) : null}
      </RequestState>
      {action ? (
        <ActionDialog
          title={
            action === "revoke" ? "Stop public access?" : "Public page settings"
          }
          action={
            action === "revoke" ? "Stop public access" : "Save public page"
          }
          onClose={() => setAction(null)}
          onSubmit={async (data) => {
            const settings =
              action === "revoke"
                ? { host: exposure!.host, slug: exposure!.slug }
                : {
                    host: site ? String(data.get("host")) : exposure?.host ?? window.location.host,
                    slug: site ? String(data.get("slug")) : exposure?.slug ?? crypto.randomUUID(),
                    theme: site ? String(data.get("theme")) : exposure?.theme ?? "light",
                    indexable: data.get("indexable") === "on",
                    duplicateAsTemplate: site ? data.get("duplicate") === "on" : exposure?.duplicateAsTemplate ?? false,
                    headerControls: site ? data.getAll("header").map(String) : exposure?.headerControls ?? [],
                    socialPreview: site ? {
                      title: String(data.get("socialTitle") ?? ""),
                      description: String(data.get("socialDescription") ?? ""),
                    } : exposure?.socialPreview ?? {},
                  };
            await mutate(`/api/publishing/${document.page.id}`, {
              operationKey: key,
              expectedRevisionId: revision,
              ...settings,
              revoke: action === "revoke",
            });
            await resource.reload();window.dispatchEvent(new Event("slate:public-page-changed"));
          }}
        >
          {action === "revoke" ? (
            <p>
              The public address will stop serving this page. Workspace access
              is unchanged.
            </p>
          ) : (
            <>
              {site ? <><label>Host<input name="host" required defaultValue={exposure?.host ?? window.location.host}/></label><label>
                Public address
                <input
                  name="slug"
                  required
                  pattern="[A-Za-z0-9][A-Za-z0-9\/_\-]*"
                  defaultValue={exposure?.slug}
                  placeholder="team-handbook"
                />
              </label>
              <label>
                Theme
                <select name="theme" defaultValue={exposure?.theme ?? "light"}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              </> : null}
              <label>
                <input
                  name="indexable"
                  type="checkbox"
                  defaultChecked={exposure?.indexable}
                />
                Allow search engines to index this page
              </label>
              {site ? <><label>
                <input
                  name="duplicate"
                  type="checkbox"
                  defaultChecked={exposure?.duplicateAsTemplate}
                />
                Allow readers to duplicate the published page
              </label>
              <fieldset>
                <legend>Header controls</legend>
                {["search", "breadcrumbs", "duplicate"].map((control) => (
                  <label key={control}>
                    <input
                      type="checkbox"
                      name="header"
                      value={control}
                      defaultChecked={exposure?.headerControls.includes(
                        control,
                      )}
                    />
                    {control}
                  </label>
                ))}
              </fieldset>
              <label>
                Social preview title
                <input
                  name="socialTitle"
                  defaultValue={exposure?.socialPreview.title}
                />
              </label>
              <label>
                Social preview description
                <textarea
                  name="socialDescription"
                  defaultValue={exposure?.socialPreview.description}
                />
              </label></> : null}
            </>
          )}
        </ActionDialog>
      ) : null}
    </section>
  );
}
