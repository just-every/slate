import { publicPage } from '../features/publishing/service';
import { ApiProblem } from './problems';
import { normalizeEmail } from "../../../modules/operator-auth/index.mjs";
import { createSessionService } from "../features/session/service";
import { sessionOptions } from "../features/session/service";
import { safeAppPath } from "../platform/auth/paths";
import type { RuntimeConfig } from "../platform/config/runtime";
import type { AppBindings } from "./types";

function isOperatorDocument(pathname: string): boolean {
  return pathname === "/setup" || pathname === "/app" || pathname.startsWith("/app/");
}

/**
 * The native anonymous operator-document response, run before TanStack Start so
 * that raw `/app` and `/setup` requests keep their 302 and safe `next` semantics. It does
 * not authorize RPC: every private server function revalidates the session in
 * its own handler.
 */
export async function operatorDocumentGate(
  request: Request,
  url: URL,
  bindings: AppBindings,
  runtimeConfig: RuntimeConfig,
): Promise<Response | null> {
  if (!isOperatorDocument(url.pathname)) return null;

  const member = await createSessionService(bindings.DB, sessionOptions(runtimeConfig)).authenticate(request);
  if (member) return null;

  const page = /^\/app\/pages\/([^/]+)$/.exec(url.pathname);
  if (page && url.searchParams.has('revision') && bindings.RER_DEMO !== '1') {
    const exposure = await bindings.DB.prepare('SELECT host,slug FROM public_exposures WHERE page_id=? AND revoked_at IS NULL').bind(decodeURIComponent(page[1])).first<{host:string;slug:string}>();
    if (exposure && exposure.host === (runtimeConfig.publicPageHost ?? url.host)) {
      try {
        const revision = url.searchParams.get('revision')!;
        const published = await publicPage(bindings.DB, exposure.host, exposure.slug, revision);
        if (published.anonymous_access !== 'forbidden' && published.workspace_anonymous !== 'forbidden')
          return new Response(null, {status:302,headers:{location:`/p/${encodeURIComponent(exposure.slug)}?${new URLSearchParams({revision})}`}});
      } catch (cause) { if (!(cause instanceof ApiProblem && cause.status === 404)) throw cause; }
    }
  }

  const next = safeAppPath(`${url.pathname}${url.search}`);
  const search = new URLSearchParams({ next });
  try {
    search.set("login_hint", normalizeEmail(url.searchParams.get("login_hint")));
  } catch {
    // An invalid optional hint never affects admission or the safe destination.
  }
  return new Response(null, { status: 302, headers: { location: `/signin?${search}` } });
}
