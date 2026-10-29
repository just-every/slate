import { useState } from "react";
import { useResource } from "../../../client/useResource";
import { mutate, operationKey, errorMessage } from "../../../client/transport";
import { RequestState } from "../../../app/ui/RequestState";
import { TopBar } from "../../../app/ui/header/TopBar";
import { PageTitle } from "../../../app/ui/header/PageTitle";
import { useWorkspace } from "../../../app/ui/WorkspaceContext";
interface Notice {
  id: string;
  title: string | null;
  event: string;
  href: string;
  createdAt: string;
  period: string;
  readAt: string | null;
  detail?: { outcome?: string; verificationRules?: { unverified: number; flagged: number; pages: { id: string; title: string; change: string }[] } };
}
/** STAT-007: one coalesced notice per owner and run, counts and titles only. */
function rulesSummary(rules: { unverified: number; flagged: number }) {
  const parts = [rules.unverified ? `unverified ${rules.unverified}` : "", rules.flagged ? `flagged ${rules.flagged}` : ""].filter(Boolean);
  return `Verification rules ${parts.join(" and ")} ${rules.unverified + rules.flagged === 1 ? "page" : "pages"} you own`;
}
export function WorkspaceInbox() {
  const { localDevelopment } = useWorkspace();
  const [audience, setAudience] = useState("");
  const [cursor, setCursor] = useState<string>();
  const resource = useResource<{
    items: Notice[];
    unreadCount: number;
    nextCursor?: string;
  }>(
    `/api/notifications?audience=${audience}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const [error, setError] = useState<unknown>();
  const periods = new Map<string, Notice[]>();
  for (const item of resource.data?.items ?? []) {
    const entries = periods.get(item.period) ?? [];
    entries.push(item);
    periods.set(item.period, entries);
  }
  async function act(action: string, id?: string) {
    try {
      await mutate("/api/notifications/actions", {
        operationKey: operationKey(),
        action,
        id,
      });
      resource.reload();
    } catch (cause) {
      setError(cause);
    }
  }
  async function openNotice(id: string) {
    try {
      const receipt = await mutate<{ value: { href: string } }>("/api/notifications/actions", {
        operationKey: operationKey(), action: "read", id,
      });
      window.location.assign(receipt.value.href);
    } catch (cause) {
      setError(cause);
    }
  }
  return (
    <>
      <TopBar trail={[{ label: "Inbox" }]} />
      <section className="main">
        <PageTitle>For your attention.</PageTitle><p className="page-lede">{resource.data?.unreadCount??0} unread notifications</p>
        <div className="editor-actions">
          <select
            aria-label="Notification audience"
            value={audience}
            onChange={(event) => {
              setAudience(event.target.value);
              setCursor(undefined);
            }}
          >
            <option value="">All notifications</option>
            <option value="direct">Direct to you</option>
            <option value="watched">Watching</option>
          </select>
          <button type="button" onClick={() => void act("read-all")}>
            Mark all read
          </button>
          <button type="button" onClick={() => void act("archive-read")}>
            Archive read
          </button>
        </div>
        <RequestState
          loading={resource.loading}
          error={resource.error}
          retry={resource.reload}
        >
          {[...periods].map(([period, items]) => (
            <section key={period} aria-label={`Notifications for ${period}`}>
              <h2 className="inbox-period"><time dateTime={period}>{new Date(`${period}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" })}</time></h2>
              <ul className="outcome-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <a href={item.href} onClick={event => {event.preventDefault();void openNotice(item.id);}}>
                      <span className="outcome-kind">
                        {item.event.replaceAll("-", " ")}
                        {!item.readAt ? " · Unread" : ""}
                      </span>
                      <h3>{item.title ?? (item.detail?.verificationRules ? rulesSummary(item.detail.verificationRules) : "Workspace update")}</h3>
                      {item.detail?.verificationRules ? <p>{item.detail.verificationRules.pages.map(page => `${page.title} (${page.change})`).join(", ")}</p> : null}
                      {localDevelopment && item.detail?.outcome ? <p>{item.detail.outcome}</p> : null}
                      <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {resource.data?.items.length === 0 ? (
            <p>You’re all caught up.</p>
          ) : null}
          {resource.data?.nextCursor ? (
            <button
              type="button"
              onClick={() => setCursor(resource.data!.nextCursor)}
            >
              Older notifications →
            </button>
          ) : null}
        </RequestState>
        {error ? <p role="alert">{errorMessage(error)}</p> : null}
      </section>
    </>
  );
}
