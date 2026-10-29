import { useState } from "react";
import { useResource } from "../../../../client/useResource";
import { RequestState } from "../../../../app/ui/RequestState";
type Activity = {
  id: string;
  actor: { id: string; displayName: string } | null;
  action: string;
  target: { kind: string; id: string };
  occurredAt: string;
  deleted: boolean;
  context: { pageId?:string;threadId?:string;grantId?:string;commentId?: string; revisionId?: string };
  automationRunId?: string;
  aiRunId?: string;
};
export function ActivityWorkspace() {
  const [filters, setFilters] = useState("");
  const [cursor, setCursor] = useState("");
  const resource = useResource<{
    items: Activity[];
    nextCursor: string | null;
  }>(
    `/api/activity?${filters}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const members = useResource<{ items: { id: string; displayName: string }[] }>(
    "/api/members",
  );
  const containers = useResource<{ items: { id: string; name: string }[] }>(
    "/api/containers",
  );
  return (
    <section className="settings-panel">
      <h2>What changed.</h2>
      <form
        className="detail-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const params = new URLSearchParams();
          for (const [key, value] of data.entries())
            if (String(value)) params.set(key, String(value));
          setCursor("");
          setFilters(params.toString());
        }}
      >
        <label>
          Person
          <select name="actorId">
            <option value="">Everyone</option>
            {members.data?.items.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Space
          <select name="containerId">
            <option value="">All accessible spaces</option>
            {containers.data?.items.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select name="kind">
            <option value="">All kinds</option>
            {[
              "page",
              "container",
              "comment",
              "database",
              "decision",
              "run",
            ].map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <label>Action<input name="action" placeholder="For example pages.properties"/></label>
        <label>
          From
          <input name="from" type="datetime-local" />
        </label>
        <label>
          Until
          <input name="to" type="datetime-local" />
        </label>
        <button>Filter activity</button>
      </form>
      <RequestState
        loading={resource.loading}
        error={resource.error}
        retry={resource.reload}
      >
        <ol className="settings-list">
          {resource.data?.items.map((item) => (
            <li key={item.id} data-activity-id={item.id}>
              <div>
                <strong>{item.actor?.displayName ?? (item.action.startsWith("verification-rules.") ? "Verification rules" : "Former member")}</strong> ·{" "}
                {item.action.replace(/[._-]/g, " ")}
                <p>
                  <time dateTime={item.occurredAt}>
                    {new Date(item.occurredAt).toLocaleString()}
                  </time>
                  {item.deleted ? (
                    " · Item no longer available"
                  ) : (item.context.pageId || item.target.kind === "page") ? (
                    <>
                      {" "}
                      ·{" "}
                      <a className="activity-page-link"
                        href={`/app/pages/${item.context.pageId??item.target.id}?${new URLSearchParams(item.context.commentId?{detail:"comments",comment:item.context.commentId}:item.context.threadId?{detail:"comments",thread:item.context.threadId}:item.context.grantId?{detail:"share",grant:item.context.grantId}:item.context.revisionId?{detail:"history",revision:item.context.revisionId}:{}).toString()}`}
                      >
                        Open page{item.context.commentId ? " and comment" : ""}
                      </a>
                    </>
                  ) : null}
                </p>
                {item.automationRunId ? (
                  <p className="muted">From a recorded automation</p>
                ) : item.aiRunId ? (
                  <p className="muted">From an intelligence run</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {resource.data?.items.length === 0 ? (
          <p>No activity matches these filters.</p>
        ) : null}
        {resource.data?.nextCursor ? (
          <button onClick={() => setCursor(resource.data!.nextCursor!)}>
            Earlier activity
          </button>
        ) : null}
        {cursor ? (
          <button onClick={() => setCursor("")}>Newest activity</button>
        ) : null}
      </RequestState>
    </section>
  );
}
