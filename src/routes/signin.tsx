import {editorLeaf} from "../editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignInPage } from "../core/features/session/ui/SignInPage";
import { safeAppPath } from "../core/platform/auth/paths";
import { loadSignInCapabilities } from '../core/features/session/loader';

// The router JSON-parses search values, so the no-script form's `?requested=1` and a
// refused preview owner link's `?owner_link=1` arrive as the number 1.
const searchSchema = z.object({ next: z.string().optional(), requested: z.literal(1).optional(), owner_link: z.literal(1).optional().catch(undefined), login_hint: z.string().catch('').optional(), notice: z.string().max(64).regex(/^oidc_[a-z_]+$/).optional().catch(undefined), provider: z.literal('identity').optional().catch(undefined) });

export const Route = createFileRoute("/signin")({
  validateSearch: searchSchema,
  loaderDeps: ({search}) => ({next: search.next, requested: search.requested, owner_link: search.owner_link}),
  loader: ({deps}) => loadSignInCapabilities({data: deps}),
  head: () => ({ meta: [{ title: "Sign in — Slate" }], links: [{ rel: "stylesheet", href: "/rer-theme.css" }] }),
  component: editorLeaf(SignIn),
});

function SignIn() {
  const search = Route.useSearch();
  return <SignInPage loginHint={search.login_hint} next={safeAppPath(search.next)} capabilities={Route.useLoaderData()} requested={search.requested === 1} ownerLinkRefused={search.owner_link === 1} providerRefused={search.provider === 'identity' && !!search.notice} />;
}
