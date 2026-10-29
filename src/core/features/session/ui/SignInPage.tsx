import { useEffect, useRef, useState } from "react";
import { normalizeEmail } from "../../../../../modules/operator-auth/index.mjs";
import { requestJson } from "../../../api/request";
import { SignInScreen } from "./SignInScreen";
import { PaperPage, PaperScene } from "./PaperPage";

import type { SignInCapabilities } from '../capabilities';

/** Public capabilities are request-specific first-response content. */
export function SignInPage({ capabilities, requested = false, loginHint, ownerLinkRefused = false, providerRefused = false }: { loginHint?: string; next: string; capabilities: SignInCapabilities; requested?: boolean; ownerLinkRefused?: boolean; providerRefused?: boolean }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState(() => {
    try { return normalizeEmail(loginHint); } catch { return ""; }
  });
  const [delivery, setDelivery] = useState<
    "queued" | "sent" | "failed" | "uncertain" | "unconfirmed" | null
  >(requested ? "unconfirmed" : null);
  const requestKey = useRef<string | null>(null);
  const providerNotice = providerRefused
    ? `Sign-in with ${capabilities.identityProviders.find(provider => provider.start === '/auth/oidc/identity/start')?.name ?? 'the OIDC identity provider'} is unavailable for this attempt. You can request an email sign-in link.`
    : capabilities.identityProviders.length === 0
      ? 'OIDC sign-in is not configured. You can sign in by email.'
      : undefined;
  useEffect(() => {
    if (delivery !== "queued" || !requestKey.current) return;
    let alive = true;
    const timer = setInterval(() => {
      requestJson<{
        state: "queued" | "sent" | "failed" | "uncertain" | "unconfirmed";
        errorDetail?: string;
      }>("/api/auth/magic/status", {
        method: "POST",
        body: { email, requestKey: requestKey.current },
      })
        .then((result) => {
          if (alive) {
            setDelivery(result.state);
            if (result.state === "failed")
              setFailure(result.errorDetail ?? "Delivery failed.");
          }
        })
        .catch((cause) => {
          if (alive) {
            setFailure(
              cause instanceof Error
                ? cause.message
                : "Delivery status could not be checked.",
            );
            setDelivery("unconfirmed");
          }
        });
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [delivery, email]);

  if (capabilities?.mailDelivery)
    return (
      <SignInScreen
        email={email}
        onEmailChange={(value) => {
          setEmail(value);
          requestKey.current = null;
          setDelivery(null);
        }}
        state={
          delivery === "sent"
            ? "sent"
            : failure
              ? "delivery-failed"
              : delivery === "queued"
                ? "pending"
                : delivery === "unconfirmed" || delivery === "uncertain"
                  ? "unconfirmed"
                  : "request"
        }
        deliveryError={failure}
        lede={ownerLinkRefused ? "That owner sign-in link no longer works. Get a new sign-in link by email instead." : undefined}
        submitting={submitting}
        onUseAnotherAddress={() => {
          setDelivery(null);
          requestKey.current = null;
          setFailure(null);
        }}
        identityProviders={capabilities.identityProviders}
        providerNotice={providerNotice}
        onSubmit={() => {
          setSubmitting(true);
          setFailure(null);
          requestKey.current ??= crypto.randomUUID();
          requestJson("/api/auth/magic", {
            method: "POST",
            body: { email, requestKey: requestKey.current },
          })
            .then(() => setDelivery(capabilities.identityProviders.some(provider => provider.start === "/auth/saml/start") ? "unconfirmed" : "queued"))
            .catch((cause: unknown) =>
              setFailure(
                cause instanceof Error
                  ? cause.message
                  : "The sign-in request failed.",
              ),
            )
            .finally(() => setSubmitting(false));
        }}
      />
    );

  return (
    <PaperPage>
      <div className="paper-columns">
        <div className="paper-body paper-body--narrow">
          <h1 className="paper-title">Your workspace is private.</h1>
          <p className="paper-lede">
            Email sign-in is not configured for this deployment yet. Slate has not
            sent an email.
          </p>
          <div className="paper-alert">
            Configure Slate’s mail adapter to deliver magic links in a deployed
            workspace.
          </div>

          {capabilities.identityProviders.length ? (
            <div className="paper-actions">
              {capabilities.identityProviders.map((provider) => (
                <form action={provider.start} method={provider.method ?? 'post'} key={provider.start}>
                  <button className="paper-pill" type="submit">
                    Continue with {provider.name}
                  </button>
                </form>
              ))}
            </div>
          ) : null}

          {providerRefused ? <div className="paper-alert" role="alert">{providerNotice}</div> : null}

          {failure ? <p className="paper-alert" role="alert">{failure}</p> : null}
        </div>
        <PaperScene />
      </div>
    </PaperPage>
  );
}
