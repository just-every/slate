import { AlertTriangle, Mail } from "lucide-react";
import { useId } from "react";
import { PaperPage, PaperScene } from "./PaperPage";
import type { SignInIdentityProvider } from "../capabilities";

/**
 * The four states the magic-link sign-in screen has.
 *
 * `delivery-failed` is the one that matters most: `MAIL-002` requires the
 * provider's error to be shown to the person and forbids reporting the message
 * as sent. It is a separate state from `sent` for exactly that reason.
 */
export type SignInScreenState =
  "request" | "pending" | "unconfirmed" | "sent" | "link-expired" | "delivery-failed";

export function SignInScreen({
  state,
  email,
  onEmailChange,
  onSubmit,
  onUseAnotherAddress,
  submitting = false,
  deliveryError,
  lede,
  identityProviders = [],
  providerNotice,
  className,
}: {
  state: SignInScreenState;
  email: string;
  onEmailChange: (next: string) => void;
  onSubmit: () => void;
  onUseAnotherAddress: () => void;
  submitting?: boolean;
  /** `MAIL-002` — the provider's own error, shown verbatim. */
  deliveryError?: string | null;
  /** The request state's one sentence; a refused preview owner link says why the person is here. */
  lede?: string;
  /** `WORK-015` — each configured, enabled provider keeps its own sign-in. */
  identityProviders?: SignInIdentityProvider[];
  providerNotice?: string;
  className?: string;
}) {
  const fieldId = useId();
  const samlAvailable = identityProviders.some(provider => provider.start === '/auth/saml/start');
  const showsForm =
    state === "request" ||
    state === "link-expired" ||
    state === "delivery-failed";
  const anotherAddress = (
    <a
      className="paper-link"
      href="/signin"
      onClick={(event) => { event.preventDefault(); onUseAnotherAddress(); }}
    >
      Use a different address
    </a>
  );

  return (
    <PaperPage className={className}>
      <div className="paper-columns">
        <div className="paper-body paper-body--narrow">
          <h1 className="paper-title">
            {state === "sent" ? "Check your email" : "Sign in"}
          </h1>

          {state === "request" ? <p className="paper-lede">{lede ?? (samlAvailable ? 'Use your workspace sign-in method, or request an email sign-in link.' : 'Use your email address to get a one-time sign-in link.')}</p> : null}

          {providerNotice ? <div className="paper-alert" role="status">{providerNotice}</div> : null}

          {state === "link-expired" ? (
            <p className="paper-lede">
              That link has been used already or is more than an hour old. A
              sign-in link works once. Ask for a new one.
            </p>
          ) : null}

          {state === "pending" || state === "unconfirmed" ? (
            <div className="paper-body" role="status">
              <p className="paper-lede">{state === "pending" ? "Your sign-in email is queued. We’ll show delivery status here." : "Your request was received. If this address can sign in, check its inbox. Delivery has not been confirmed here."}</p>
              <div>{anotherAddress}</div>
            </div>
          ) : null}

          {state === "sent" ? (
            <div className="paper-body">
              <p className="paper-sent">
                <Mail aria-hidden="true" className="size-5" />
                <span>
                  A sign-in link is on its way to{" "}
                  <strong>{email}</strong>. It works once and
                  stops working an hour after it was created.
                </span>
              </p>
              <div>{anotherAddress}</div>
            </div>
          ) : null}

          {state === "delivery-failed" ? (
            <div className="paper-alert" role="alert">
              <strong className="paper-alert-title">
                <AlertTriangle aria-hidden="true" className="size-5" />
                The email was not sent
              </strong>
              <span>
                The mail provider did not confirm delivery. You can request
                another link when the problem is resolved.
              </span>
              {deliveryError ? <code>{deliveryError}</code> : null}
            </div>
          ) : null}

          {showsForm ? (
            <form
              action="/api/auth/magic"
              method="post"
              className="paper-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              <div className="paper-field">
                <label htmlFor={fieldId}>Email address</label>
                <input
                  autoComplete="email"
                  className="paper-input"
                  disabled={submitting}
                  id={fieldId}
                  name="email"
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <div className="paper-actions">
                <button className="paper-pill" disabled={submitting} type="submit">
                  {submitting ? "Sending the link…" : "Email me a sign-in link"}
                </button>
              </div>
            </form>
          ) : null}

          {identityProviders.length ? (
            <div className="paper-actions">
              {identityProviders.map((provider) => (
                <form action={provider.start} method={provider.method ?? 'post'} key={provider.start}>
                  <button className="paper-pill paper-pill--quiet" type="submit">
                    Continue with {provider.name}
                  </button>
                </form>
              ))}
            </div>
          ) : null}


          <p className="paper-note">
            {samlAvailable
              ? 'If your workspace requires SAML, members sign in through the identity provider. Email sign-in remains available for guests and emergency access.'
              : 'Slate stores no password, so there is nothing to reset. Access to your mailbox is what signs you in.'}
          </p>
        </div>
        <PaperScene />
      </div>
    </PaperPage>
  );
}
