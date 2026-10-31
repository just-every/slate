import { batchRequestReads } from './read-batches';
import { workspaceLocation } from "./workspace-location";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { WorkspaceSnapshot } from "./ui/workspaceSnapshot";

/**
 * Start statically imports this wrapper into route modules, so the true server
 * modules are imported inside the handler. The client receives a generated RPC
 * stub and no D1, session or binding code.
 *
 * BASE-ACCESS-002: this private server function validates the native session in
 * its own handler before it reads anything private. The `/app` document gate
 * does not stand in for it, because the transport request arrives outside
 * `/app`. A missing, expired or revoked session throws the identifiable Start
 * sign-in redirect protocol without returning any member record.
 */
export const loadWorkspace = createServerFn({ method: "GET" }).inputValidator(workspaceLocation).handler(async ({data}): Promise<WorkspaceSnapshot | { canonical: string }> => {
  const [{ createSessionService, sessionOptions }, { startRequestHeaders }, { requestBindings }, { runtimeConfigFor }, { getRequestUrl, getRequestHeader }] = await Promise.all([
    import("../features/session/service"),
    import("../platform/auth/start-request"),
    import("../platform/bindings.server"),
    import("./runtime-gate"),
    import("@tanstack/react-start/server"),
  ]);
  const bindings = requestBindings();
  // BASE-SECRET-002 has already refused a misconfigured deployment in
  // `src/server.ts`; this call is how the handler obtains the checked secret.
  const config = runtimeConfigFor(bindings, getRequestUrl().hostname);
  const member = await createSessionService(bindings.DB, sessionOptions(config)).authenticate(startRequestHeaders());
  if (!member) throw redirect({ to: "/signin", search: { next: "/app" } });
  // Use the same authorized services as the API. Nothing private is read before
  // the current request's native session has been checked above.
  const [{ readWorkspace }, { firstRunState }, { navigation }, { currentMember }] = await Promise.all([
    import("../features/workspace/settings"),
    import("../features/workspace/bootstrap"),
    import("../features/navigation/service"),
    import("../features/workspace/members"),
  ]);
  const context = { db: batchRequestReads(bindings.DB), files: bindings.FILES, jobs: bindings.JOBS, actor: member, now: new Date().toISOString(), preview: config.preview };
  // Live may create the member's personal space on first use. Finish that
  // before reading either space list, so the screen matches the data a preview
  // will copy. Use a separate context so subsequent reads capture the access
  // epoch after initialization. Preview reads preserve copied spaces unchanged.
  const current = await currentMember({ ...context });
  const [{ initialResources }, { canonicalLocation }] = await Promise.all([import("./initial-resources.server"), import("../features/databases/addresses")]);
  const requestUrl=getRequestUrl();
  const url=data.path ? new URL(data.path,requestUrl.origin) : requestUrl;
  // SL1: an old database or record address answers one hop before anything is read or recorded for it.
  const canonical=await canonicalLocation(context,url);
  if(canonical)return {canonical};
  const recordVisit=(data.visit??true) && /^\/app\/(?:(?:pages|containers)\/[^/]+|databases\/[^/]+(?:\/records\/[^/]+)?)$/.test(url.pathname) && ![getRequestHeader('sec-purpose'),getRequestHeader('purpose')].some(value=>value?.includes('prefetch'));
  const resourcesRead=initialResources(context,url,current,recordVisit);
  const [workspace, setup, personalNavigation, resources] = await Promise.all([
    readWorkspace(context), firstRunState(context), navigation(context), resourcesRead,
  ]);
  const opened=resources[`${url.pathname.replace('/app/','/api/')}/opened`];
  if(opened) {
    // The same request just committed this visit. Project that confirmed write
    // into the fresh navigation read instead of reading the entire list again.
    const format=new Intl.DateTimeFormat('en-CA',{timeZone:personalNavigation.preferences.value.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
    const recent={...opened.recent,day:format.format(new Date(opened.recent.openedAt))};
    personalNavigation.recents=[recent,...personalNavigation.recents.filter(item=>item.id!==recent.id)].sort((a,b)=>b.openedAt.localeCompare(a.openedAt)||b.id.localeCompare(a.id));
  }
  resources["/api/navigation"] = personalNavigation;
  resources["/api/navigation/configuration"] = personalNavigation.configuration;
  return { resourcePath:url.pathname, resources, member, workspace, setup, business: setup.required && setup.canComplete ? config.business ?? null : null, navigation: personalNavigation, localDevelopment: config.localDevelopment, editorEnabled: Boolean(bindings.RER_MANAGEMENT_ORIGIN && bindings.RER_INSTALLATION_ID), profile: { profile: config.launchProfile ?? "core-wiki" } };
});
