import "../editor-init";
import { loadPreviewEnvironment } from "../core/app/installation-loader";
import { PreviewBanner, previewStylesheet } from "../core/app/preview-banner";
import {useEffect} from "react";
import {useRouter,useRouterState} from "@tanstack/react-router";
import {setLiveEditsReady} from "../editor";
import {editorLeaf} from "../editor-leaf";
import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { ExtensionSlotProvider } from "../core/app/ext-client";
import appCss from "../core/app/styles.css?url";
import {privateAppCss,privateFontCss,isWorkspacePath} from "../core/app/private-styles";
import { fontLinks } from "../core/app/font-head";
import { introCss, introGuardScript } from "../base/runtime/hydration/intro-guard";
import { DocsNotFound } from "../core/features/docs/DocsPage";

export const Route = createRootRoute({
  loader: () => loadPreviewEnvironment(),
  head: ({matches}) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "description", content: "Slate — a self-hosted knowledge workspace." },
      { title: "Slate" },
      { name: "theme-color", content: "#f6f3e8" },
    ],
    // Slate's card mark, served from the deployment's own `public/` directory (regenerate the rasters with scripts/generate-icons.mjs).
    links: [
      ...(matches.some(match=>isWorkspacePath(match.pathname)) ? [] : [{rel:"stylesheet",href:appCss}]),
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    ],
  }),
  notFoundComponent: editorLeaf(NotFound),
  component: Root,
});

function Root() {
  const router = useRouter();
  useEffect(() => router.subscribe('onBeforeNavigate', () => setLiveEditsReady(false)), [router]);
  return (
    <Document>
      <ExtensionSlotProvider>
        <Outlet />
      </ExtensionSlotProvider>
    </Document>
  );
}

function NotFound() {
  const path = useRouterState({ select: state => state.location.pathname });
  if (path === '/docs' || path.startsWith('/docs/')) return <DocsNotFound />;
  return (
    <main className="grid min-h-screen place-items-center px-5 py-10 text-stone-900">
      <section className="max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-stone-950">Not found</h1>
        <p className="mt-4 leading-7 text-stone-600">This workspace has no document at that address.</p>
      </section>
    </main>
  );
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
  const preview = Route.useLoaderData();
  const privateDocument=useRouterState({select:state=>isWorkspacePath(state.location.pathname)});
  return (
    <html lang="en" data-slate-preview={preview ? "" : undefined}>
      <head>
        {privateDocument ? <style>{privateAppCss}</style> : fontLinks.map(link => <link key={link.href} {...link} />)}
        <HeadContent />
        {preview ? <link rel="stylesheet" href={previewStylesheet} /> : null}
        {privateDocument ? <style>{privateFontCss}</style> : null}
        <script dangerouslySetInnerHTML={{ __html: introGuardScript }} />
        <style>{introCss}</style>
      </head>
      <body>
        {preview ? <PreviewBanner /> : null}
        {children}
        <Scripts />
      </body>
    </html>
  );
}
