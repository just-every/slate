import { SELF, env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { isHonoRequest } from "../../src/core/app/hono";
import { handleApplicationRequest } from "../../src/core/app/request-handler";
import { requestBindings } from "../../src/core/platform/bindings.server";
import type { AppBindings } from "../../src/core/app/types";
import { seedWorkspace, seedMember, sessionFor } from "./setup/fixtures";
import { Landing } from "../../src/core/features/landing/Landing";

/**
 * Supporting regressions for DOCS-001. They register exactly in tests/requirements/test-evidence.json as supporting
 * evidence: they cover what the documentation routes render and which requests they refuse, not the requirement's full
 * acceptance. The manifest, link and content rules are checked from the tree by tests/docs-site.mjs, and the emitted
 * artifact by tests/e2e/production-artifact.test.mjs.
 */

const published = ["", "install", "moving-in", "backup", "email-delivery", "cloudflare-footprint"];
const get = (path: string) => SELF.fetch(`https://slate.test${path}`);
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => [match[1], match[2].replace(/<[^>]+>/g, "").trim()]);

describe("DOCS-001 public documentation supporting regressions", () => {
  test("public docs serve declared pages with accessible navigation and refuse unknown routes", async () => {
  // Each row retains its original fixture and every assertion.
  const cases = [
    { name: "docs: the Worker serves /docs and each published page with one h1, the landing frame and the section navigation", run: async () => {
    for (const slug of published) {
      const path = slug ? `/docs/${slug}` : "/docs";
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toMatch(/text\/html/);
      expect(response.headers.get("set-cookie"), path).toBeNull();
      const html = await response.text();
      expect(html.match(/<h1[\s>]/g), path).toHaveLength(1);
      expect(html, path).toContain('<h1 id="');
      expect(html, path).toContain('class="slate-landing slate-docs"');
      expect(html, path).toContain('<main id="docs-content"');
      expect(html, path).toContain("Edit this page on GitHub");
      for (const target of ["/docs", "/docs/install", "/docs/moving-in", "/docs/backup", "/docs/email-delivery", "/docs/cloudflare-footprint"]) expect(html, `${path} nav ${target}`).toContain(`href="${target}"`);
      expect(html, path).not.toMatch(/Jamie Park|aurora\.example/);
      // Nothing is loaded from another origin; outbound links name Slate, the Chest sibling, the credit, Run Edit Run's hosting entry and, on the footprint page, Cloudflare's pricing pages.
      expect(html, path).not.toMatch(/\ssrc="https?:/);
      for (const link of [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((match) => match[1])) {
        const allowed = slug === "cloudflare-footprint" ? /^https:\/\/(github\.com\/just-every\/run-chest$|github\.com\/just-every\/(?:run-)?slate|(?:app\.)?runeditrun\.com|developers\.cloudflare\.com\/)/ : /^https:\/\/(github\.com\/just-every\/run-chest$|github\.com\/just-every\/(?:run-)?slate|(?:app\.)?runeditrun\.com)/;
        expect(link, `${path} ${link}`).toMatch(allowed);
      }
    }
    const install = await (await get("/docs/install")).text();
    expect(install).toContain("<title>Install and deploy · Slate docs</title>");
    expect(install).toContain('href="https://github.com/just-every/run-slate/edit/main/docs/INSTALL.md"');
    expect(install).toContain('rel="next"');
    expect(install).toContain('rel="prev"');
    // The current page alone is marked in the section navigation.
    expect(install.match(/aria-current="page"[^>]*href="\/docs\/install"/g)).toHaveLength(2);
    expect(install).not.toMatch(/<(img|iframe|video|audio|object|embed|form|input)[\s>]/i);
    // The document head contains the trusted hydration intro guard's stylesheet;
    // documentation content must still introduce no media, forms or styles.
    const body = install.slice(install.indexOf("<body"));
    expect(body).toMatch(/^<body[\s>]/i);
    expect(body).not.toMatch(/<(img|iframe|video|audio|object|embed|form|input|style)[\s>]/i);
    expect(install).not.toMatch(/\sstyle="|\son[a-z]+="/);
  } },
    { name: "docs: an unknown, miscased or nested slug is a real 404 and /docs is not a Hono or operator route", run: async () => {
    for (const path of ["/docs/does-not-exist", "/docs/Install", "/docs/install/extra", "/docs/index", "/docs/__proto__", "/docs/constructor"]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      const unavailable = await response.text();
      expect(unavailable, path).toContain("Not found");
      expect(unavailable, path).toContain('class="slate-landing slate-docs"');
      expect(unavailable, path).toContain('href="/docs">Back to documentation');
    }
    for (const path of ["/docs", "/docs/", "/docs/install"]) expect(isHonoRequest(path), path).toBe(false);
    // /docs/ is the docs home, not a redirect.
    expect((await get("/docs/")).status).toBe(200);
    // Anonymous /app is untouched.
    const app = await SELF.fetch("https://slate.test/app", { redirect: "manual" });
    expect(app.status).toBe(302);
    expect(app.headers.get("location")).toBe("/signin?next=%2Fapp");
  } },
    { name: "docs: the landing links to /docs and /docs/install and the docs header has no brand h1", run: async () => {
    // The landing is the run site's homepage (src/site/pages.tsx renders it the same way).
    const landing = renderToStaticMarkup(createElement(Landing));
    const landingHrefs = links(landing).map(([href]) => href);
    // Header, footer and the hero's guide link open the docs home; the moving-in section opens the setup guide.
    expect(landingHrefs.filter((href) => href === "/docs")).toHaveLength(3);
    expect(landingHrefs).toContain("/docs/install");
    // Neither marks the landing as a docs page.
    expect(landing).not.toMatch(/href="\/docs"[^>]*aria-current|aria-current[^>]*href="\/docs"/);
    expect(landing).toContain('<h1 class="brand-name">');

    const docs = await (await get("/docs/install")).text();
    expect(docs).not.toContain('<h1 class="brand-name">');
    expect(docs).toContain('<span class="brand-name">');
    expect(links(docs)).toContainEqual(["/", expect.stringContaining("")]);
    const header = docs.slice(docs.indexOf("<header"), docs.indexOf("</header>"));
    expect(header).toMatch(/aria-current="page"[^>]*href="\/docs"/);
    expect(header.indexOf('href="/docs"')).toBeLessThan(header.indexOf('href="https://github.com/just-every/run-slate"'));
  } }
    , { name: "docs read no native identity or workspace data, including with a valid or revoked session", run: async () => {
    const { workspaceId } = await seedWorkspace({ name: "synthetic-slate-private-workspace" });
    const { memberId } = await seedMember(workspaceId, { role: "owner", email: ["synthetic-slate-1", "example.test"].join("@"), displayName: "synthetic-slate-private-member" });
    const cookie = await sessionFor(memberId);
    const statements: string[] = [];
    const fixturePrepare = env.DB.prepare.bind(env.DB);
    // Observe both the HTTP bindings and Start's ambient native binding. The
    // statements still execute on real D1; no application response is replaced.
    const observations = [...new Set([env.DB, requestBindings().DB])].map(db => {
      const prepare = db.prepare.bind(db);
      return vi.spyOn(db, "prepare").mockImplementation(sql => { statements.push(sql); return prepare(sql); });
    });
    const bindings: AppBindings = { ...env };
    const request = async (path: string, cookie?: string) => {
      const execution = createExecutionContext();
      const response = await handleApplicationRequest(new Request("https://slate.test" + path, { headers: cookie ? { cookie } : {} }), bindings, execution);
      const html = await response.text();
      await waitOnExecutionContext(execution);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(html).not.toMatch(/synthetic-slate-private/);
    };
    try {
      for (const path of ["/docs", "/docs/install", "/docs/backup"]) {
        await request(path);
        await request(path, cookie);
      }
      await fixturePrepare("DELETE FROM sessions WHERE member_id = ?").bind(memberId).run();
      await request("/docs", cookie);
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.some(sql => /INSERT INTO request_limits/.test(sql))).toBe(true);
      for (const sql of statements) expect(sql, "docs native reads").not.toMatch(/\b(?:workspaces|members|sessions|member_identity_bindings|pages|blocks)\b/i);
    } finally { observations.forEach(observation => observation.mockRestore()); }
  } },
    { name: "docs and the root refuse missing configuration identically and share one public request budget", run: async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:15Z"));
    const request = async (path: string, address: string, bindings: AppBindings = env) => {
      const execution = createExecutionContext();
      const response = await handleApplicationRequest(new Request("https://slate.test" + path, { headers: { "cf-connecting-ip": address } }), bindings, execution);
      await waitOnExecutionContext(execution);
      return response;
    };
    try {
      const missing: AppBindings = { ...env, SESSION_SECRET: "" };
      const failures = [];
      for (const path of ["/", "/docs", "/docs/install"]) {
        const response = await request(path, "synthetic-slate-configuration", missing);
        expect(response.status).toBe(503);
        failures.push(await response.json());
      }
      expect(failures[0]).toMatchObject({ code: "CONFIGURATION_INVALID" });
      expect(failures[1]).toEqual(failures[0]);
      expect(failures[2]).toEqual(failures[0]);
      expect((await request("/", "synthetic-slate-shared")).status).toBe(200);
      let limited = false;
      for (let index = 0; index < 200; index++) {
        const response = await request(index % 2 ? "/docs/install" : "/docs", "synthetic-slate-shared");
        await response.body?.cancel();
        if (response.status === 429) { limited = true; break; }
        expect(response.status).toBe(200);
      }
      expect(limited, "the native public request budget is finite").toBe(true);
      for (const path of ["/", "/docs", "/docs/install"]) {
        const response = await request(path, "synthetic-slate-shared");
        expect(response.status).toBe(429);
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
        expect((await request(path, "synthetic-slate-fresh")).status).toBe(200);
      }
      vi.advanceTimersByTime(60_000);
      expect((await request("/docs", "synthetic-slate-shared")).status).toBe(200);
    } finally { vi.useRealTimers(); }
  } }
  ];
  for (const scenario of cases) {
    try {  await scenario.run(); }
    catch (cause) { throw new Error(`Case ${scenario.name} failed`, { cause }); }
  }
});




});
