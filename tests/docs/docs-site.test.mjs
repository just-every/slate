import test from "node:test";
import { build } from "vite";
import { docsSite } from "../../src/core/features/docs/build/plugin.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// DOCS-001. The /docs pages are built from the repository's Markdown listed in docs/site.json
// (src/core/features/docs/build). These checks need no build: they import the same build modules the Vite plugin runs.
const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");
const { readManifest } = await import("../../src/core/features/docs/build/manifest.ts");
const { absolutePath, buildSite, pathKind, readRepository } = await import("../../src/core/features/docs/build/site.ts");
const { renderPage } = await import("../../src/core/features/docs/build/render.ts");
const { createSlugger } = await import("../../src/core/features/docs/build/slug.ts");

const site = buildSite(root);
const repository = readRepository(root).url;

test("docs build renders declared pages and refuses invalid manifests, markup, links and images", async () => {
  // Each row retains its original fixture and every assertion.
  const cases = [
    { name: "the manifest rules are enforced: one home first, clean unique slugs, existing unique sources, reasons", run: async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), "slate-docs-manifest-")));
  try {
    await mkdir(join(fixture, "docs"));
    for (const file of ["README.md", "A.md", "B.md"]) await writeFile(join(fixture, file), `# ${file}\n`);
    const check = async (manifest) => {
      await writeFile(join(fixture, "docs/site.json"), JSON.stringify(manifest));
      return assert.throws(() => readManifest(fixture));
    };
    const page = (slug, source, label = "Label") => ({ slug, source, label });
    const valid = { sections: [{ title: "S", pages: [page("", "README.md"), page("a", "A.md")] }], githubOnly: [{ source: "B.md", reason: "Kept on GitHub" }] };
    await writeFile(join(fixture, "docs/site.json"), JSON.stringify(valid));
    assert.equal(readManifest(fixture).pages.length, 2);
    await check({ ...valid, sections: [{ title: "S", pages: [page("a", "A.md"), page("", "README.md")] }] });
    await check({ ...valid, sections: [{ title: "S", pages: [page("", "README.md"), page("index", "A.md")] }] });
    await check({ ...valid, sections: [{ title: "S", pages: [page("", "README.md"), page("Install", "A.md")] }] });
    await check({ ...valid, sections: [{ title: "S", pages: [page("", "README.md"), page("a", "A.md"), page("a", "B.md")] }], githubOnly: [] });
    await check({ ...valid, sections: [{ title: "S", pages: [page("", "README.md"), page("a", "MISSING.md")] }] });
    await check({ ...valid, githubOnly: [{ source: "A.md", reason: "Twice" }] });
    await check({ ...valid, githubOnly: [{ source: "B.md", reason: " " }] });
    await check({ ...valid, githubOnly: [{ source: "GONE.md", reason: "Stale" }] });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
} },
    { name: "every Markdown file at the root, under docs/ or as a top-level README is published or listed as GitHub-only", run: () => {
  const manifest = readManifest(root);
  const listed = new Set([...manifest.pages, ...manifest.githubOnly].map((entry) => entry.source));
  const inScope = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"], { cwd: root, encoding: "utf8" })
    .split("\n").filter((file) => /^([^/]+\.md|docs\/.+\.md|[^./][^/]*\/README\.md)$/.test(file));
  const unlisted = inScope.filter((file) => !listed.has(file));
  assert.deepEqual(unlisted, [], `Add ${unlisted.join(", ")} to docs/site.json, as a published page or under githubOnly with a reason`);
  assert.equal(listed.size, manifest.pages.length + manifest.githubOnly.length, "no source is listed twice");
} },
    { name: "the docs build renders every page with no problems, one title, unique ids and only safe, resolvable links", run: () => {
  assert.deepEqual(site.problems, []);
  assert.deepEqual(
    site.pages.map(({ section, slug, source, label, href }) => ({ section, slug, source, label, href })),
    readManifest(root).pages,
    "every declared published page is rendered in manifest order",
  );
  const published = new Map(site.pages.map((page) => [page.href, new Set(page.ids)]));
  const kind = pathKind(root);
  for (const page of site.pages) {
    const markdown = readFileSync(join(root, page.source), "utf8");
    assert.equal(page.title, /^# (.+)$/m.exec(markdown)[1].replace(/`/g, ""), `${page.source} title`);
    assert.match(markdown.trimStart(), /^# /, `${page.source} starts with its H1`);
    assert.doesNotMatch(page.html, /<h1\b/, `${page.source} has exactly one H1, rendered by the page`);
    assert.equal(new Set(page.ids).size, page.ids.length, `${page.source} heading ids are unique`);
    assert.doesNotMatch(page.html, /\s(style|on[a-z]+)=|<script/i, `${page.source} has no inline style, handler or script`);
    assert.doesNotMatch(page.html, new RegExp(absolutePath.source), `${page.source} names no machine path`);
    for (const [, href] of page.html.matchAll(/<a href="([^"]+)"/g)) {
      const decoded = href.replaceAll("&amp;", "&");
      if (decoded.startsWith("/docs")) {
        const [path, hash] = decoded.split("#");
        assert.ok(published.has(path), `${page.source}: ${href} is a published page`);
        if (hash) assert.ok(published.get(path).has(decodeURIComponent(hash)), `${page.source}: ${href} names a heading`);
      } else if (decoded.startsWith("#")) {
        assert.ok(page.ids.includes(decodeURIComponent(decoded.slice(1))), `${page.source}: ${href} names a heading on the page`);
      } else if (decoded.startsWith(`${repository}/`) && !markdown.includes(`](${decoded})`) && !markdown.includes(`<${decoded}>`)) {
        // A relative link the build rewrote to GitHub (links written as full URLs in the Markdown stay as they are).
        const match = new RegExp(`^${repository}/(blob|tree)/main/([^#]+)`).exec(decoded);
        assert.ok(match, `${page.source}: ${href} is a blob or tree link on main`);
        assert.equal(kind(match[2]), match[1] === "blob" ? "file" : "directory", `${page.source}: ${href} names an existing path`);
      } else assert.match(decoded, /^(https?:|mailto:)/, `${page.source}: ${href} is external`);
    }
  }

} },
    { name: "published pages describe only the default core-wiki profile and carry no maintainer material", run: () => {
  // Development-only surfaces and specific maintainer commands or records stay on GitHub.
  const forbidden = [
    [/flagship/i, "flagship"], [/frontier/i, "frontier"], [/user-journeys?/i, "user journeys"], [/\bAI\b/, "AI"], [/inquir/i, "inquiry"],
    [/connectors?\b/i, "connector"], [/\bagents?\b/i, "agent"], [/\bexperiments?\b/i, "experiment"], [/\bMCP\b/, "MCP"], [/\bRER\b/, "RER"],
    [/source:lock|integration:sync|publish-check|artifact:delivery/, "maintainer command"],
    [/sources\.lock|edition\.json|Base Mail/i, "maintainer record"], [/\b[A-Z]{2,8}-\d{3}\b/, "requirement ID"],
  ];
  const nonPublished = /FLAGSHIP|FRONTIER|USER-JOURNEYS|HANDOVER|ACCEPTANCE|PROOF|local-agent/;
  for (const page of site.pages) {
    const text = page.html.replace(/<[^>]+>/g, " ");
    for (const [pattern, name] of forbidden) assert.doesNotMatch(text, pattern, `${page.source} mentions ${name}`);
    for (const [, href] of page.html.matchAll(/<a href="([^"]+)"/g)) assert.doesNotMatch(href, nonPublished, `${page.source} links ${href}`);
  }
} },
    { name: "heading ids match GitHub, including duplicates, em dashes, backticks and parentheses", run: () => {
  const slug = createSlugger();
  assert.equal(slug("Request limits (`RATE_LIMITS`)"), "request-limits-rate_limits");
  assert.equal(slug("Updates, backup and recovery"), "updates-backup-and-recovery");
  assert.equal(slug("Current final disposition — FAIL / confirmed owner HOLD"), "current-final-disposition--fail--confirmed-owner-hold");
  assert.deepEqual([slug("Added"), slug("Added"), slug("Added")], ["added", "added-1", "added-2"]);
  const page = render("## Request limits (`RATE_LIMITS`)\n\n### Added\n\n### Added\n\n### Added");
  assert.deepEqual(page.ids, ["fixture-page", "request-limits-rate_limits", "added", "added-1", "added-2"]);
  assert.match(page.html, /<h2 id="request-limits-rate_limits">Request limits \(<code>RATE_LIMITS<\/code>\)<\/h2>/);
  assert.deepEqual(page.toc, [
    { depth: 2, id: "request-limits-rate_limits", text: "Request limits (RATE_LIMITS)" },
    { depth: 3, id: "added", text: "Added" }, { depth: 3, id: "added-1", text: "Added" }, { depth: 3, id: "added-2", text: "Added" },
  ]);
  assert.equal(page.title, "Fixture page");
  assert.equal(page.titleId, "fixture-page");
} },
    { name: "tables, code, callouts and raw HTML render safely with classes only", run: () => {
  const table = render("| Name | Count |\n|:----:|------:|\n| a | 1 |").html.trim();
  assert.match(table, /^<div class="docs-table" role="region" tabindex="0" aria-label="Table: Name, Count"><table>/);
  assert.match(table, /<th class="docs-align-center">Name<\/th><th class="docs-align-right">Count<\/th>/);
  assert.doesNotMatch(table, /style=|align=/);
  const long = render(`| ${Array.from({ length: 12 }, (_, i) => `Column number ${i}`).join(" | ")} |\n|${"---|".repeat(12)}`).html;
  assert.ok(/aria-label="([^"]+)"/.exec(long)[1].length <= 80, "the table label stays short");
  const code = render("```sh\n# install\npnpm install --frozen-lockfile\n```").html;
  assert.match(code, /^<pre><code class="language-sh"><span class="hljs-comment"># install<\/span>\npnpm install --frozen-lockfile<\/code><\/pre>$/);
  assert.doesNotMatch(code, /class="(?:[^"]*\s)?hljs[\s"]/, "no highlight.js theme class applies");
  assert.equal(render("```\nplain <b>text</b>\n```").html, "<pre><code>plain &lt;b&gt;text&lt;/b&gt;</code></pre>");
  assert.equal(render("```unknownlang\nx = 1\n```").html, '<pre><code class="language-unknownlang">x = 1</code></pre>');
  assert.equal(render("Use `node scripts/rer.mjs verify` first, please.").html, "<p>Use <code>node scripts/rer.mjs verify</code> first, please.</p>");
  const warning = render("> [!WARNING]\n> Back up the database first.").html;
  assert.equal(warning, '<div class="docs-callout docs-callout--warning" role="note"><p class="docs-callout-label">Warning</p>\n<p>Back up the database first.</p>\n</div>');
  assert.match(render("> Just a quote.").html, /^<blockquote>\n<p>Just a quote\.<\/p>\n<\/blockquote>$/);
  const raw = render("Hello <script>alert(1)</script> <img src=x onerror=alert(1)>").html;
  assert.doesNotMatch(raw, /<script|<img/);
  assert.match(raw, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
} },
    { name: "links go to published pages, to GitHub for everything else, or are reported", run: () => {
  const page = render([
    "[same page](#fixture-page) [other](OTHER.md) [other heading](OTHER.md#part) [internal](INTERNAL.md) [licences](licenses)",
    "[licence](../LICENSE) [site](https://example.com/a?b=c) [mail](mailto:team\x40example.com)",
  ].join("\n\n"));
  assert.deepEqual(page.problems, []);
  assert.deepEqual([...page.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]), [
    "#fixture-page", "/docs/other", "/docs/other#part", "https://example.test/source.git/blob/main/docs/INTERNAL.md",
    "https://example.test/source.git/tree/main/docs/licenses", "https://example.test/source.git/blob/main/LICENSE",
    "https://example.com/a?b=c", "mailto:team\x40example.com",
  ]);
  assert.deepEqual(page.anchors, [{ source: "docs/PAGE.md", id: "fixture-page" }, { source: "docs/OTHER.md", id: "part" }]);
  assert.deepEqual(render("[gone](MISSING.md) [up](../../outside.md) [js](javascript:alert(1)) [rooted](/docs/x) [hash](../LICENSE#x)").problems, [
    "MISSING.md (docs/MISSING.md does not exist)", "../../outside.md (outside the repository)", "javascript:alert(1) (unsupported link scheme)",
    "/docs/x (use a path relative to docs/PAGE.md)", "../LICENSE#x (an anchor can only point into a Markdown file)",
  ]);
} },
    { name: "images come only from docs/media, with alt text", run: () => {
  const good = render("![A diagram](media/diagram.png)");
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.images, ["docs/media/diagram.png"]);
  assert.match(good.html, /<img src="__DOCS_IMAGE_0__" alt="A diagram" loading="lazy" decoding="async"\/>/);
  assert.deepEqual(render("![Outside](../LICENSE) ![External](https://example.com/a.png) ![](media/diagram.png) ![Missing](media/none.png)").problems, [
    "../LICENSE (images must be files in docs/media/)", "https://example.com/a.png (images must be files in docs/media/)",
    "media/diagram.png (image has no alt text)", "media/none.png (docs/media/none.png does not exist)",
  ]);
} },
    { name: "a page has one H1, first, and a description from its first real paragraph", run: () => {
  assert.deepEqual(renderPage("Intro first.\n\n# Title\n", fixtureContext()).problems, ["the first block must be the page's H1", "an H1 that is not the first block (a page has exactly one H1, first)"]);
  assert.deepEqual(renderPage("<b>x</b>\n\n# Title\n", fixtureContext()).problems, ["raw HTML is not allowed in published Markdown", "raw HTML is not allowed in published Markdown", "the first block must be the page's H1", "an H1 that is not the first block (a page has exactly one H1, first)"]);
  assert.deepEqual(renderPage("# One\n\n# Two\n", fixtureContext()).problems, ["an H1 that is not the first block (a page has exactly one H1, first)"]);
  const page = render(`**Short line.**\n\nThis paragraph explains what the page covers in more than eight words, ${"and keeps going ".repeat(12)}until the end.`);
  assert.ok(page.description.startsWith("This paragraph explains what the page covers in more than eight words, and keeps going"));
  assert.ok(page.description.length <= 160 && page.description.endsWith("…"), page.description);
  assert.equal(render("Too short.").description, "Fixture page: Slate documentation.");
} },
    { name: "broken links and anchors across pages fail the site build, naming the file and the link", run: async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), "slate-docs-site-")));
  try {
    await mkdir(join(fixture, "docs"));
    await writeFile(join(fixture, "package.json"), JSON.stringify({ repository: { url: "https://example.test/source.git" } }));
    await writeFile(join(fixture, "docs/site.json"), JSON.stringify({ sections: [{ title: "S", pages: [{ slug: "", source: "README.md", label: "Home" }, { slug: "guide", source: "docs/GUIDE.md", label: "Guide" }] }], githubOnly: [{ source: "NOTES.md", reason: "Maintainer notes" }] }));
    await writeFile(join(fixture, "README.md"), "# Home\n\n[guide](docs/GUIDE.md#second) [bad](docs/GUIDE.md#third) [notes](NOTES.md#kept) [gone](NOTES.md#lost) [missing](docs/MISSING.md) [self](#nowhere)\n");
    await writeFile(join(fixture, "docs/GUIDE.md"), "# Guide\n\n## Second\n");
    await writeFile(join(fixture, "NOTES.md"), "# Notes\n\n## Kept\n");
    const built = buildSite(fixture);
    assert.equal(built.repository.url, "https://example.test/source", "the .git of the clone URL is dropped");
    assert.deepEqual(built.problems, [
      "README.md: docs/MISSING.md (docs/MISSING.md does not exist)",
      "README.md: #third (no such heading in docs/GUIDE.md)",
      "README.md: #lost (no such heading in NOTES.md)",
      "README.md: #nowhere (no such heading in README.md)",
    ]);
    assert.match(built.pages[0].html, /href="\/docs\/guide#second"/);
    assert.match(built.pages[0].html, /href="https:\/\/example\.test\/source\/blob\/main\/NOTES\.md#kept"/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
} }
    , { name: "the real Vite build emits valid docs and refuses unsafe repository inputs", run: async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), "slate-docs-boundary-")));
  try {
    await mkdir(join(fixture, "docs"));
    await writeFile(join(fixture, "package.json"), JSON.stringify({ repository: { url: "https://example.test/source.git" } }));
    await writeFile(join(fixture, "docs/site.json"), JSON.stringify({ sections: [{ title: "Guide", pages: [{ slug: "", source: "README.md", label: "Home" }] }], githubOnly: [] }));
    await writeFile(join(fixture, "entry.js"), 'export * from "virtual:slate-docs";');
    const valid = "# Guide\n\n## Start\n\nA safe document with a [working anchor](#start).\n";
    const compile = () => build({ root: fixture, configFile: false, logLevel: "silent", plugins: [docsSite()], build: { write: false, minify: false, lib: { entry: join(fixture, "entry.js"), formats: ["es"] } } });
    await writeFile(join(fixture, "README.md"), valid);
    const output = await compile();
    assert.ok([output].flat().flatMap(result => result.output).some(item => item.type === "chunk" && item.code.includes('<h2 id=')), "valid Markdown becomes emitted HTML");
    for (const unlisted of ["UNLISTED.md", "docs/NESTED.md", "guide/README.md"]) {
      await mkdir(join(fixture, unlisted.split("/").slice(0, -1).join("/")), { recursive: true });
      await writeFile(join(fixture, unlisted), "# Unlisted\n");
      await assert.rejects(compile, error => error.message.includes(`unlisted Markdown \"${unlisted}\"`), unlisted);
      await rm(join(fixture, unlisted));
    }
    for (const [input, diagnostic] of [
      ["[Missing](MISSING.md)", /MISSING\.md.*does not exist/],
      ["[Missing heading](#absent)", /no such heading in README\.md/],
      ["Inline <b>raw</b> HTML", /raw HTML is not allowed/],
      ["<script>tracking()</script>", /raw HTML is not allowed/],
      ["![Outside](outside.png)", /images must be files in docs\/media/],
      ["Build folder: /home/synthetic-slate-1/private", /absolute machine path/],
    ]) {
      await writeFile(join(fixture, "README.md"), valid + "\n" + input + "\n");
      await assert.rejects(compile, diagnostic, input);
    }
    await writeFile(join(fixture, "README.md"), valid);
    await compile();
  } finally { await rm(fixture, { recursive: true, force: true }); }
} }
  ];
  for (const scenario of cases) {
    try { await scenario.run(); }
    catch (cause) { throw new Error(`Case ${scenario.name} failed`, { cause }); }
  }
});







// A link context for in-memory fixtures: one published page and a few repository paths.
const fixtureContext = (source = "docs/PAGE.md") => ({
  source,
  repository: { url: "https://example.test/source.git", branch: "main" },
  published: new Map([["docs/PAGE.md", "/docs/page"], ["docs/OTHER.md", "/docs/other"]]),
  kind: (path) => ({ "docs/PAGE.md": "file", "docs/OTHER.md": "file", "docs/INTERNAL.md": "file", "docs/licenses": "directory", LICENSE: "file", "docs/media/diagram.png": "file" })[path] ?? null,
});
const render = (body, source) => renderPage(`# Fixture page\n\n${body}\n`, fixtureContext(source));
