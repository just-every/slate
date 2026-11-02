import { useEffect, useState } from "react";
import { useResource } from "../../../../client/useResource";
import {
  mutate,
  operationKey,
  errorMessage,
} from "../../../../client/transport";
import { RequestState } from "../../../../app/ui/RequestState";
interface Delivery {
  id: string;
  kind: string;
  state: string;
  attemptCount: number;
  errorDetail: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  invitationId: string | null;
  targetEmail: string | null;
  canRetry: boolean;
  canRevoke: boolean;
}
export function MailDeliveryPanel() {
  const resource = useResource<{ items: Delivery[] }>("/api/workspace/mail");
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState<string>();
  useEffect(() => {
    if (
      !resource.data?.items.some((item) =>
        ["queued", "pending", "sending"].includes(item.state),
      )
    )
      return;
    const timer = setTimeout(resource.reload, 5000);
    return () => clearTimeout(timer);
  }, [resource.data, resource.reload]);
  async function action(item: Delivery, kind: "retry" | "revoke") {
    setPending(item.id);
    setError(undefined);
    try {
      await mutate(
        kind === "retry"
          ? `/api/workspace/mail/${item.id}/retry`
          : "/api/invitations/revoke",
        {
          operationKey: operationKey(),
          ...(kind === "revoke" ? { id: item.invitationId } : {}),
        },
      );
      resource.reload();
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(undefined);
    }
  }
  return (
    <section aria-label="Invitation delivery">
      <h3>Invitation delivery</h3>
      <RequestState
        loading={resource.loading}
        error={resource.error}
        retry={resource.reload}
      >
        <ul className="settings-list">
          {resource.data?.items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.targetEmail ?? "Workspace email"}</strong>
                <p>
                  {item.kind} · {item.state === 'uncertain' ? 'Review required' : item.state === 'sent' ? 'Accepted by mail provider' : item.state}
                  {item.sentAt
                    ? ` · ${new Date(item.sentAt).toLocaleString()}`
                    : ""}
                </p>
                {item.errorDetail ? (
                  <p role="alert">{item.errorDetail}</p>
                ) : null}
                {item.nextAttemptAt ? (
                  <p>
                    Next delivery attempt:{" "}
                    {new Date(item.nextAttemptAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div>
                {item.canRetry ? (
                  <button
                    disabled={!!pending}
                    onClick={() => void action(item, "retry")}
                  >
                    Retry delivery
                  </button>
                ) : null}
                {item.canRevoke && item.invitationId ? (
                  <button
                    disabled={!!pending}
                    onClick={() => void action(item, "revoke")}
                  >
                    Revoke invitation
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {resource.data?.items.length === 0 ? (
          <p className="muted">No email deliveries to show.</p>
        ) : null}
      </RequestState>
      {error ? <p role="alert">{errorMessage(error)}</p> : null}
    </section>
  );
}
