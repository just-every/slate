import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyMigrations,
  seedAuroraFixture,
  executeD1,
  localDevelopmentVars,
  requestWithHost,
  root,
  signInLocally,
  startEmittedWorker,
  stop,
} from "./runtime-harness.mjs";

import { managedFirstOpen } from './managed-first-open.mjs';
import { randomUUID } from 'node:crypto';
import { confirmationFlow } from './confirmation-flow.mjs';
import { signInHintFlow } from './signin-hint.mjs';
import { providerFallbackFlow } from './provider-fallback-flow.mjs';
import { healthRequest } from '@runeditrun/rer/internal/modules/deploy-kit/health-request.mjs';

const clientAssets = path.join(root, "dist", "client", "assets");
const serverEntry = path.join(root, "dist", "server", "index.js");
const sampleOwnerMemberId = "01JBF2JH4M0D3S8ZJ1TQW7K0B1";

async function requireBuild() {
  try {
    await stat(serverEntry);
  } catch {
    throw new Error("dist/server/index.js is missing. Run `rer build` before the production-artifact tests.");
  }
}

async function clientScripts() {
  const files = await readdir(clientAssets);
  const scripts = files.filter((file) => file.endsWith(".js"));
  assert.ok(scripts.length > 0, "The build emitted no client JavaScript.");
  return Promise.all(scripts.map(async (file) => ({ file, text: await readFile(path.join(clientAssets, file), "utf8") })));
}

async function clientBundleText() {
  return (await clientScripts()).map(({ text }) => text).join("\n");
}

/**
 * DOCS-001: a published docs page is its own chunk, the rendered text of a Markdown file that docs/site.json lists. It is
 * documentation, so it names the deployment inputs a person sets (SLATE_SESSION_SECRET), which is not code reading a binding.
 */
async function docsPageChunks() {
  const manifest = JSON.parse(await readFile(path.join(root, "docs", "site.json"), "utf8"));
  const sources = manifest.sections.flatMap((section) => section.pages.map((page) => page.source));
  const chunks = (await clientScripts()).filter(({ text }) => sources.some((source) => new RegExp(`slug:[^,]*,source:[\`"']${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\`"'],title:`).test(text)));
  assert.equal(chunks.length, sources.length, "Every published docs page is its own client chunk.");
  return chunks;
}

/** Generated transport ids come from the emitted artifact, never copied. */
async function generatedServerFunctionIds() {
  const bundle = await clientBundleText();
  const ids = [...new Set([...bundle.matchAll(/\/_serverFn\/`\+|[0-9a-f]{64}/g)].map((match) => match[0]))]
    .filter((value) => /^[0-9a-f]{64}$/.test(value));
  assert.ok(ids.length > 0, 'The emitted client must expose a real server-function transport.');
  return ids;
}

test("emitted bundles keep server internals and Markdown tooling off the client", async () => {
  // Preserve every original assertion and each runtime step's original deadline.
  const cases = [
    { name: "the build emits a clean client bundle and no prerendered HTML", timeout: undefined, run: async () => {
  await requireBuild();

  const docsChunks = await docsPageChunks();
  const docsFiles = new Set(docsChunks.map(({ file }) => file));
  const bundle = (await clientScripts()).filter(({ file }) => !docsFiles.has(file)).map(({ text }) => text).join("\n");
  for (const serverOnly of ["cloudflare:workers", "drizzle-orm", "sqliteTable", "token_digest", "tokenDigest", "SESSION_SECRET", "MAIL_API_KEY"]) {
    assert.doesNotMatch(bundle, new RegExp(serverOnly.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `The client bundle contains the server-only symbol ${serverOnly}.`);
  }
  // The docs chunks keep every one of those checks, except that the documented deployment inputs carry the SLATE_ prefix.
  for (const { file, text } of docsChunks) {
    for (const serverOnly of ["cloudflare:workers", "drizzle-orm", "sqliteTable", "token_digest", "tokenDigest"]) assert.ok(!text.includes(serverOnly), `${file} contains the server-only symbol ${serverOnly}.`);
    assert.doesNotMatch(text, /(?<!SLATE_)(?:SESSION_SECRET|MAIL_API_KEY)/, `${file} names a binding rather than the documented SLATE_ input.`);
  }

  // Prerendering is configured and disabled, so the build emits no HTML at all.
  const emitted = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".html")) emitted.push(path.relative(root, full));
    }
  }
  await walk(path.join(root, "dist", "client"));
  assert.deepEqual(emitted, []);
} },
    { name: "DOCS-001: the Worker and client bundles carry no Markdown or highlighting code, only rendered pages", timeout: undefined, run: async () => {
  await requireBuild();
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(m?js|cjs)$/.test(entry.name)) files.push(full);
    }
  }
  await walk(path.join(root, "dist", "client"));
  await walk(path.join(root, "dist", "server"));
  assert.ok(files.length > 0);
  // Signatures of the libraries themselves; the pages' own highlighted HTML legitimately contains hljs-* class names.
  const libraries = /registerLanguage|micromark|mdast-util|remark-parse|remark-gfm|react-markdown|\bunified\(|hast-util|highlight\.js/;
  const hits = [];
  for (const file of files) if (libraries.test(await readFile(file, "utf8"))) hits.push(path.relative(root, file));
  assert.deepEqual(hits, [], "No emitted module may contain the Markdown build libraries.");
  // The pages themselves are emitted as rendered HTML.
  let rendered = 0;
  for (const file of files) if ((await readFile(file, "utf8")).includes("Install and deploy")) rendered += 1;
  assert.ok(rendered > 0, "The docs pages are in the build as rendered HTML.");
} }
  ];
  for (const scenario of cases) {
    let timer;
    try {
      if (scenario.timeout === undefined) await scenario.run();
      else await Promise.race([scenario.run(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Original deadline exceeded: ${scenario.name}`)), scenario.timeout);
      })]);
    } catch (cause) { throw new Error(`Case ${scenario.name} failed`, { cause }); }
    finally { clearTimeout(timer); }
  }
});

test("emitted Worker admission serves configured public doors and protects native owner access", async () => {
  await providerFallbackFlow();
  // Preserve every original assertion and each runtime step's original deadline.
  const cases = [
    { name: "every request family refuses a deployment that is missing configuration", timeout: 180000, run: async () => {
  await requireBuild();
  const persistPath = await mkdtemp(path.join(os.tmpdir(), "slate-artifact-bare-"));
  let runtime;

  try {
    await applyMigrations(persistPath);
    runtime = await startEmittedWorker(persistPath);
    const { baseUrl } = runtime;
    const serverFunctionIds = await generatedServerFunctionIds();

    // Every family answers the same way, not just /health: a misconfigured
    // deployment must not render a document or serialise a server-function
    // result behind a failing health check.
    const gated = [
      ["/health", {}],
      ["/", {}],
      ["/", { headers: { "sec-fetch-mode": "navigate" } }],
      ["/signin", {}],
      ["/auth/confirm", {}],
      ["/docs", {}],
      ["/docs/install", {}],
      ["/app", {}],
      ["/nothing-here", {}],
      ...serverFunctionIds.map(id => [`/_serverFn/${id}`, { headers: { origin: baseUrl, "x-tsr-serverFn": "true" } }]),
    ];
    for (const [gatedPath, init] of gated) {
      const response = await fetch(`${baseUrl}${gatedPath}`, { redirect: "manual", ...init });
      assert.equal(response.status, 503, `${gatedPath} did not return 503 on an unconfigured deployment.`);
      const body = await response.json();
      assert.equal(body.code, "CONFIGURATION_INVALID", gatedPath);
    }

    // A session cookie does not buy past the configuration gate either.
    const withCookie = await fetch(`${baseUrl}/app`, { headers: { cookie: "slate_session=anything" }, redirect: "manual" });
    assert.equal(withCookie.status, 503);
  } finally {
    if (runtime) await stop(runtime.child);
    await rm(persistPath, { recursive: true, force: true });
  }
} },
    { name: "a claimed RER owner signs in to a ready default workspace", timeout: 240000, run: async () => {
  await requireBuild();
  const persistPath = await mkdtemp(path.join(os.tmpdir(), "slate-first-open-"));
  let runtime;
  try {
    await applyMigrations(persistPath);
    const token = randomUUID(), email = process.env.SLATE_OWNER_EMAIL ?? 'owner\x40example.test';
    runtime = await startEmittedWorker(persistPath, { ...localDevelopmentVars, SETUP_OWNER_EMAIL: email, SETUP_TOKEN: token });
    await managedFirstOpen(runtime.baseUrl, token, email);
  } finally {
    if (runtime) await stop(runtime.child);
    await rm(persistPath, { recursive: true, force: true });
  }
} },
    { name: "the emitted Worker serves every declared surface and a real 404 everywhere else", timeout: 240000, run: async () => {
  await requireBuild();
  const persistPath = await mkdtemp(path.join(os.tmpdir(), "slate-artifact-"));
  let runtime;

  try {
    await applyMigrations(persistPath);
    await seedAuroraFixture(persistPath);
    runtime = await startEmittedWorker(persistPath, localDevelopmentVars);
    const { baseUrl } = runtime;
    const serverFunctionIds = await generatedServerFunctionIds();

    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    await signInHintFlow(baseUrl);

    // The local sample binding is loopback-only. The same Worker asked for a
    // non-loopback host is an unconfigured deployment, and every family must
    // say so rather than rendering the sample workspace to the open internet.
    for (const gatedPath of ["/health", "/", "/signin", "/docs", "/docs/install", "/app", "/auth/confirm", "/api/auth/capabilities"]) {
      const response = await requestWithHost(baseUrl, gatedPath, "slate.example");
      assert.equal(response.status, 503, `${gatedPath} on a non-loopback host did not return 503.`);
      assert.equal(JSON.parse(response.body).code, "CONFIGURATION_INVALID", gatedPath);
      assert.doesNotMatch(response.body, /Jamie Park|jamie@aurora\.example/, gatedPath);
    }

    // The public Start document: the root is the Lobby, which the Worker renders with no script.
    const landing = await fetch(`${baseUrl}/docs`);
    assert.equal(landing.status, 200);
    assert.match(landing.headers.get('content-type') ?? '', /text\/html/);
    const landingHtml = await landing.text();
    assert.doesNotMatch(landingHtml, /Jamie Park|jamie@aurora\.example/);
    assert.match(landingHtml, /<script type="module"/);

    // Base deploys with run_worker_first, as dist/server/wrangler.json declares, so
    // the Worker itself must hand every emitted client file to ASSETS, by GET and HEAD.
    const emittedConfig = JSON.parse(await readFile(path.join(root, "dist", "server", "wrangler.json"), "utf8"));
    assert.equal(emittedConfig.assets?.run_worker_first, true);
    const clientFiles = (await readdir(path.join(root, "dist", "client"), { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name !== ".assetsignore")
      .map((entry) => "/" + path.relative(path.join(root, "dist", "client"), path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
    assert.ok(clientFiles.some((file) => file.endsWith(".js")) && clientFiles.some((file) => file.endsWith(".css")));
    for (const file of clientFiles) {
      const asset = await fetch(`${baseUrl}${file}`);
      assert.equal(asset.status, 200, file);
      assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), new Uint8Array(await readFile(path.join(root, "dist", "client", file.slice(1)))), file);
      assert.equal((await fetch(`${baseUrl}${file}`, { method: "HEAD" })).status, 200, `HEAD ${file}`);
    }
    const script = await fetch(`${baseUrl}${clientFiles.find((file) => file.endsWith(".js"))}`);
    assert.match(script.headers.get("content-type") ?? "", /javascript/);
    await script.body?.cancel();

    // Every icon actually linked by the document is delivered as the original
    // same-origin image, rather than falling through to the application's 404.
    const iconLinks = [...landingHtml.matchAll(/<link[^>]*rel="(?:shortcut icon|icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(iconLinks.length, 'The document links its icons.');
    for (const iconPath of new Set(iconLinks)) {
      assert.equal(new URL(iconPath, baseUrl).origin, new URL(baseUrl).origin);
      const icon = await fetch(`${baseUrl}${iconPath}`);
      assert.equal(icon.status, 200, iconPath);
      assert.match(icon.headers.get("content-type") ?? "", /^image\//, iconPath);
      const body = new Uint8Array(await icon.arrayBuffer());
      assert.ok(body.length, iconPath);
      assert.deepEqual(body, new Uint8Array(await readFile(path.join(root, 'public', new URL(iconPath, baseUrl).pathname.slice(1)))), iconPath);
    }

    // Unknown documents, missing assets, and development-only virtual paths are
    // real 404s in the emitted artifact, with and without a navigation request.
    const notFoundPaths = [
      "/nothing-here",
      "/auth/not-a-route",
      "/assets/missing-asset-that-was-never-built.js",
      "/@id/virtual:tanstack-start-dev-client-entry",
      "/src/core/app/styles.css",
      "/@vite/client",
    ];
    for (const unknownPath of notFoundPaths) {
      for (const headers of [{}, { "sec-fetch-mode": "navigate" }]) {
        const response = await fetch(`${baseUrl}${unknownPath}`, { headers });
        assert.equal(response.status, 404, `${unknownPath} ${JSON.stringify(headers)}`);
      }
    }

    const canonical = await fetch(baseUrl + '/auth/confirm/', {redirect:'manual'});
    assert.ok([301,302,307,308].includes(canonical.status), 'Start canonicalizes its trailing-slash document path');
    assert.equal(new URL(canonical.headers.get('location'), baseUrl).pathname, '/auth/confirm');
    assert.equal(canonical.headers.get('set-cookie'), null);
    await confirmationFlow(baseUrl);
    let { cookie } = await signInLocally(baseUrl);

    // BASE-ACCESS-002, protected operator document.
    const anonymousApp = await fetch(`${baseUrl}/app`, { redirect: "manual" });
    assert.equal(anonymousApp.status, 302);
    assert.equal(anonymousApp.headers.get("location"), "/signin?next=%2Fapp");
    const authenticatedApp = await fetch(`${baseUrl}/app`, { headers: { cookie } });
    assert.equal(authenticatedApp.status, 200);
    const appHtml = await authenticatedApp.text();
    assert.match(appHtml, /data-testid="member-email">jamie@aurora\.example</);

    // Request-time SSR against the bound D1, proven by changing the binding. A session is fenced to the member's address, so the
    // next /app response is the sign-in document; after the address is restored a new sign-in shows the app again.
    await executeD1(persistPath, `UPDATE members SET email = 'changed-in-d1\x40aurora.example' WHERE id = '${sampleOwnerMemberId}'`);
    const changedHtml = await (await fetch(`${baseUrl}/app`, { headers: { cookie } })).text();
    assert.doesNotMatch(changedHtml, /data-testid="member-email"/);
    assert.match(changedHtml, /<h1 class="paper-title">Sign in</);
    await executeD1(persistPath, `UPDATE members SET email = 'jamie\x40aurora.example' WHERE id = '${sampleOwnerMemberId}'`);
    ({ cookie } = await signInLocally(baseUrl));
    assert.match(await (await fetch(`${baseUrl}/app`, { headers: { cookie } })).text(), /data-testid="member-email">jamie@aurora\.example</);

    // BASE-ACCESS-002, protected operator HTTP API.
    assert.equal((await fetch(`${baseUrl}/api/session`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/unknown-member`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/unknown-member`, { headers: { cookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).status, 200);

    // BASE-ACCESS-002, private generated server function, over the pinned wire protocol.
    const serverFunctionHeaders = {
      origin: baseUrl,
      "x-tsr-serverFn": "true",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    };

    // Find private transports by their real authenticated result. Public
    // capabilities may add transports without changing workspace authority.
    const privateFunctions = [];
    for (const id of serverFunctionIds) {
      const url = `${baseUrl}/_serverFn/${id}`;
      const authenticated = await fetch(url, { headers: { ...serverFunctionHeaders, cookie } });
      assert.equal(authenticated.status, 200);
      const payload = await authenticated.text();
      if (/jamie@aurora\.example|Aurora Android Launch/.test(payload)) privateFunctions.push(id);
      else {
        const anonymous = await fetch(url, { headers: serverFunctionHeaders });
        assert.equal(anonymous.status, 200);
        const publicPayload = await anonymous.text();
        assert.equal(publicPayload, payload, 'Public capabilities do not depend on a private session.');
        assert.doesNotMatch(publicPayload, /Jamie Park|jamie@aurora\.example|Aurora Android Launch/);
      }
    }
    assert.ok(privateFunctions.length > 0, 'A real workspace transport must return the authenticated fixture.');

    const ipv6Host = `[::1]:${new URL(baseUrl).port}`;
    for (const id of privateFunctions) {
      const ipv6Call = await requestWithHost(baseUrl, `/_serverFn/${id}`, ipv6Host, {
        ...serverFunctionHeaders, origin: `http://${ipv6Host}`, cookie,
      });
      assert.equal(ipv6Call.status, 200, ipv6Call.body);
      assert.match(ipv6Call.body, /jamie@aurora\.example/);
    }

    // The pinned Start resolver owns unknown generated IDs and reports 500.
    // Preserve that framework behavior without inventing a second registry.
    const unknownFunction = await fetch(`${baseUrl}/_serverFn/${"0".repeat(64)}`, { headers: { ...serverFunctionHeaders, cookie } });
    assert.equal(unknownFunction.status, 500);
    assert.doesNotMatch(await unknownFunction.text(), /Jamie Park|jamie@aurora\.example|Aurora Android Launch/);

    const cases = [];
    for (const state of ["valid", "missing", "expired", "revoked"]) {
      if (state === "expired") await executeD1(persistPath, "UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
      if (state === "revoked") await executeD1(persistPath, "UPDATE sessions SET expires_at = '2099-01-01T00:00:00.000Z', revoked_at = '2026-01-01T00:00:00.000Z'");
      const headers = state === "missing" ? {} : { cookie };
      const document = await fetch(`${baseUrl}/app?view=recent`, { headers, redirect: "manual" });
      const documentBody = await document.text();
      assert.equal(document.status, state === "valid" ? 307 : 302, state);
      if (state === "valid") assert.equal(document.headers.get("location"), "/setup", state);
      else {
        assert.equal(document.headers.get("location"), "/signin?next=%2Fapp%3Fview%3Drecent", state);
        assert.equal(documentBody, "", state);
      }
      const setupDocument = await fetch(`${baseUrl}/setup?source=owner`, { headers, redirect: "manual" });
      assert.equal(setupDocument.status, state === "valid" ? 200 : 302, `${state} setup document`);
      const setupBody = await setupDocument.text();
      if (state === "valid") assert.match(setupBody, /Jamie Park/);
      else {
        assert.equal(setupDocument.headers.get("location"), "/signin?next=%2Fsetup%3Fsource%3Downer");
        assert.doesNotMatch(setupBody, /Jamie Park|jamie@aurora\.example/);
      }
      for (const apiPath of ["/api/session", "/api/unknown-member"]) {
        const response = await fetch(`${baseUrl}${apiPath}`, { headers });
        assert.equal(response.status, state === "valid" ? (apiPath === "/api/session" ? 200 : 404) : 401, `${state} ${apiPath}`);
        if (state !== "valid") assert.doesNotMatch(await response.text(), /Jamie Park|jamie@aurora\.example|Aurora Android Launch/);
      }
      for (const id of privateFunctions) {
        const call = await fetch(`${baseUrl}/_serverFn/${id}`, { headers: { ...serverFunctionHeaders, ...headers }, redirect: "manual" });
        const payload = await call.text();
        assert.equal(call.status, 200, `${state}: ${payload}`);
        if (state === "valid") {
          assert.equal(call.headers.get("x-tss-serialized"), "true");
          assert.match(payload, /jamie@aurora\.example/);
          assert.match(payload, /Aurora Android Launch/);
        } else {
          const denial = JSON.parse(payload);
          assert.equal(denial.isSerializedRedirect, true, payload);
          assert.equal(denial.to, "/signin", payload);
          assert.deepEqual(denial.search, { next: "/app" });
          assert.doesNotMatch(payload, /Jamie Park|jamie@aurora\.example|Aurora Android Launch/);
        }
      }
      cases.push({ name: state, status: "passed" });
    }
    if (process.env.SLATE_ACCESS_REPORT_PATH) await writeFile(process.env.SLATE_ACCESS_REPORT_PATH, JSON.stringify({ clause: "BASE-ACCESS-002", status: "satisfied", cases }));

    // Origin is a separate guard from the session: a cross-origin mutation is refused.
    for (const id of privateFunctions) {
      const hostileOrigin = await fetch(`${baseUrl}/_serverFn/${id}`, {
        method: "POST",
        headers: { ...serverFunctionHeaders, origin: "https://attacker.example", "sec-fetch-site": "cross-site", cookie },
      });
      assert.equal(hostileOrigin.status, 403);
      assert.doesNotMatch(await hostileOrigin.text(), /jamie@aurora\.example/);
    }
  } finally {
    if (runtime) await stop(runtime.child);
    await rm(persistPath, { recursive: true, force: true });
  }
} },
    { name: "Base's deploy-identity check accepts the emitted Worker's /health", timeout: 180000, run: async () => {
  await requireBuild();
  const persistPath = await mkdtemp(path.join(os.tmpdir(), "slate-artifact-identity-"));
  let runtime;

  try {
    await applyMigrations(persistPath);
    // Base deploy-kit sets these two variables and the RER_VERSION version-metadata binding on upload.
    const receipt = { source: { sha: "a".repeat(40) }, fingerprint: "b".repeat(64) };
    const versionId = "4f9d6a3e-0c1b-4e7a-9b2d-5a8c7e6f1d20";
    runtime = await startEmittedWorker(persistPath, { ...localDevelopmentVars, RER_DEPLOY_SOURCE: receipt.source.sha, RER_DEPLOY_FINGERPRINT: receipt.fingerprint, RER_VERSION: { id: versionId, tag: "", timestamp: new Date().toISOString() } });
    const request = (url, init) => fetch(url, init);
    const expected = { sourceSha: receipt.source.sha, fingerprint: receipt.fingerprint, versionId };
    const accepted = await healthRequest({ origin: runtime.baseUrl, expected, request, timeoutMs: 10000, offsetMs: 0 });
    assert.equal(accepted.attempt.status, 200);
    assert.equal(accepted.attempt.errorClass, null, accepted.attempt.body);
    // A Worker answering for another upload is refused by the same check.
    const stale = await healthRequest({ origin: runtime.baseUrl, expected: { ...expected, versionId: "another-version" }, request, timeoutMs: 10000, offsetMs: 0 });
    assert.equal(stale.attempt.errorClass, "health-identity-mismatch");
  } finally {
    if (runtime) await stop(runtime.child);
    await rm(persistPath, { recursive: true, force: true });
  }
} },
    { name: "DOCS-001: the emitted Worker serves /docs and each page, a real 404 for any other slug, and no cookie", timeout: 240000, run: async () => {
  await requireBuild();
  const persistPath = await mkdtemp(path.join(os.tmpdir(), "slate-artifact-docs-"));
  let runtime;

  try {
    await applyMigrations(persistPath);
    runtime = await startEmittedWorker(persistPath, localDevelopmentVars);
    const { baseUrl } = runtime;

    const manifest = JSON.parse(await readFile(path.join(root, 'docs/site.json'), 'utf8'));
    const pages = manifest.sections.flatMap(section => section.pages).flatMap(page =>
      (page.slug ? ['/docs/' + page.slug] : ['/docs', '/docs/']).map(docsPath => ({ ...page, docsPath })));
    for (const page of pages) {
      const { docsPath } = page;
      const source = await readFile(path.join(root, page.source), 'utf8');
      const title = source.match(/^# (.+)$/m)?.[1];
      assert.ok(title, `${docsPath} has its source title`);
      const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const headers of [{}, { "sec-fetch-mode": "navigate" }]) {
        const response = await fetch(`${baseUrl}${docsPath}`, { headers });
        assert.equal(response.status, 200, docsPath);
        assert.match(response.headers.get("content-type") ?? "", /text\/html/, docsPath);
        assert.equal(response.headers.get("set-cookie"), null, docsPath);
        const html = await response.text();
        assert.equal(html.match(/<h1[\s>]/g)?.length, 1, `${docsPath} has one h1`);
        assert.match(html, new RegExp(`<h1\\b[^>]*>${escapedTitle}</h1>`), docsPath);
        assert.doesNotMatch(html, /Jamie Park|jamie@aurora\.example/, docsPath);
        assert.match(html, /<script type="module"/, docsPath);
      }
    }

    // Unknown, miscased and nested slugs are real 404s, with and without a navigation request.
    for (const unknownPath of ["/docs/nothing-here", "/docs/Install", "/docs/install/extra", "/docs/index"]) {
      for (const headers of [{}, { "sec-fetch-mode": "navigate" }]) {
        const response = await fetch(`${baseUrl}${unknownPath}`, { headers });
        assert.equal(response.status, 404, `${unknownPath} ${JSON.stringify(headers)}`);
        await response.body?.cancel();
      }
    }

    // The anonymous /app redirect is untouched by the docs routes.
    const anonymousApp = await fetch(`${baseUrl}/app`, { redirect: "manual" });
    assert.equal(anonymousApp.status, 302);
    assert.equal(anonymousApp.headers.get("location"), "/signin?next=%2Fapp");
  } finally {
    if (runtime) await stop(runtime.child);
    await rm(persistPath, { recursive: true, force: true });
  }
} }
  ];
  for (const scenario of cases) {
    let timer;
    try {
      if (scenario.timeout === undefined) await scenario.run();
      else await Promise.race([scenario.run(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Original deadline exceeded: ${scenario.name}`)), scenario.timeout);
      })]);
    } catch (cause) { throw new Error(`Case ${scenario.name} failed`, { cause }); }
    finally { clearTimeout(timer); }
  }
});
