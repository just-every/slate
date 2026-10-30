import { useFlagshipEnabled } from "../../../../app/ui/LaunchProfile";
import {PersonalHome} from "./PersonalHome";
import { useResource } from "../../../../client/useResource";
import { RequestState } from "../../../../app/ui/RequestState";
import { mutate, operationKey } from "../../../../client/transport";
import { TopBar } from "../../../../app/ui/header/TopBar";
import { PageTitle } from "../../../../app/ui/header/PageTitle";
import { SectionLabel } from "../../../../app/ui/SectionLabel";
import { displayDate } from "../../../../app/ui/displayDate";
interface Notice {
  id: string;
  title: string | null;
  event: string;
  href: string;
  createdAt: string;
  readAt: string | null;
  detail?: { outcome?: string };
}
interface Today {
  decisions: Notice[];
  contradictions: Notice[];
  notices: Notice[];
  outcomes: { day: string; count: number; items: Notice[] }[];
  unreadCount: number;
}
export function TodayWorkspace() {
  return useFlagshipEnabled() ? <FlagshipToday /> : <><TopBar trail={[{ label: "Today" }]} /><section className="main"><PageTitle>Your workspace</PageTitle><PersonalHome /></section></>;
}
function FlagshipToday() {
  const resource = useResource<Today>("/api/notifications/today");
  const data = resource.data;
  const empty =
    data &&
    !data.decisions.length &&
    !data.contradictions.length &&
    !data.notices.length &&
    !data.outcomes.length;
  function rows(items: Notice[]) {
    return (
      <ul className="outcome-list">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              onClick={() => {
                void mutate("/api/notifications/actions", {
                  operationKey: operationKey(),
                  action: "read",
                  id: item.id,
                }).catch(() => {});
              }}
            >
              <span className="outcome-kind">
                {item.event.replaceAll("-", " ")}
              </span>
              <h3>{item.title ?? "Workspace update"}</h3>
              {item.detail?.outcome ? <p>{item.detail.outcome}</p> : null}
              <time dateTime={item.createdAt}>
                {displayDate(item.createdAt, true)}
              </time>
              <span className="outcome-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <TopBar trail={[{ label: "Today" }]}>
        <a href="/app/inbox">
          Inbox{data?.unreadCount ? ` · ${data.unreadCount}` : ""}
        </a>
      </TopBar>
      <section className="main" data-testid="workspace-empty-state">
        <PageTitle>Today</PageTitle>
        <RequestState
          loading={resource.loading}
          error={resource.error}
          retry={resource.reload}
        >
          {empty ? (
            <div className="empty-start">
              <a href="/app/settings/portability">
                Import your knowledge
              </a>
              <p className="muted">
                Nothing needs your attention yet. Ask a question from any page
                to use its context.
              </p>
            </div>
          ) : null}
          {data?.decisions.length ? (
            <section className="today-section">
              <SectionLabel>Ready for your decision</SectionLabel>
              {rows(data.decisions)}
            </section>
          ) : null}
          {data?.contradictions.length ? (
            <section className="today-section">
              <SectionLabel>Something needs a closer look</SectionLabel>
              {rows(data.contradictions)}
            </section>
          ) : null}
          {data?.outcomes.map((group) => (
            <details className="today-section" key={group.items[0]?.id ?? group.day}>
              <summary>Completed work · {group.count} {group.count === 1 ? "outcome" : "outcomes"} · {group.day}</summary>
              {rows(group.items)}
            </details>
          ))}
          {data?.notices.length ? (
            <section className="today-section">
              <SectionLabel>For you</SectionLabel>
              {rows(data.notices)}
            </section>
          ) : null}
        </RequestState>
        <PersonalHome/>
      </section>
    </>
  );
}
