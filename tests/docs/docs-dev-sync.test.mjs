import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { docsSite } from "../../src/core/features/docs/build/plugin.ts";

// DOCS-001. `vite dev` keeps the docs in sync with the Markdown: the docs plugin alone, in a Vite server over a fixture
// repository, serves the edited file, refuses a broken link on the docs pages only, follows docs/site.json, and survives
// folders removed with their files, dropping a page whose Markdown went with its folder. The routes' own loader is
// evaluated once and stays fresh throughout, as it does in the Worker, which is never reloaded.
const loaderPath = join(dirname(fileURLToPath(import.meta.url)), "../../src/core/features/docs/load.ts");
const until = async (check, label) => {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { return await check(); } catch (error) {
      if (Date.now() > deadline) throw new Error(`${label} within 5 s: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const site = (pages, githubOnly = []) => JSON.stringify({ sections: [{ title: "Guide", pages }], githubOnly });
const home = { slug: "", source: "README.md", label: "Home" };

test("the docs plugin follows edits to Markdown and docs/site.json in a running dev server", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "slate-docs-sync-")));
  await mkdir(join(root, "docs"));
  const files = {
    "package.json": JSON.stringify({ repository: { url: "https://example.test/source.git" } }),
    "docs/site.json": site([home, { slug: "guide", source: "docs/GUIDE.md", label: "Guide" }]),
    "README.md": "# Fixture\n\nRead [the second part](docs/GUIDE.md#second).\n",
    "docs/GUIDE.md": "# Guide\n\n## Second\n",
  };
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  // No WebSocket server: the plugin's full-reload goes nowhere here, and no fixed HMR port is taken.
  // Observe this rapidly rewritten temporary fixture by content polling. macOS
  // FSEvents can coalesce its edits; the same five-second freshness assertions apply.
  const server = await createServer({ root, configFile: false, logLevel: "silent", appType: "custom", server: { middlewareMode: true, ws: false, watch: { usePolling: true } }, plugins: [docsSite()] });
  // What each environment is sent: the browser's full reload when the docs change, an error if the plugin throws.
  const sent = [];
  for (const environment of Object.values(server.environments)) {
    const send = environment.hot.send.bind(environment.hot);
    environment.hot.send = (payload, ...rest) => { sent.push({ environment: environment.name, ...payload }); return send(payload, ...rest); };
  }
  const errors = () => sent.filter((payload) => payload.type === "error");
  const reloaded = () => [...new Set(sent.filter((payload) => payload.type === "full-reload").map((payload) => payload.environment))];
  const settled = async () => new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    const page = async (slug) => (await server.ssrLoadModule(`virtual:slate-docs/page/${slug}`)).default;
    const index = () => server.ssrLoadModule("virtual:slate-docs");
    const { loadDocsPage } = await server.ssrLoadModule(loaderPath);
    assert.match((await page("guide")).html, /<h2 id="second">Second<\/h2>/);
    assert.match((await page("index")).html, /<a href="\/docs\/guide#second">the second part<\/a>/);
    const first = await loadDocsPage("guide");
    assert.match(first.page.html, /<h2 id="second">Second<\/h2>/);

    await writeFile(join(root, "docs/GUIDE.md"), "# Guide\n\n## Second\n\n## Third\n");
    await until(async () => assert.match((await page("guide")).html, /<h2 id="third">Third<\/h2>/), "an edited page is served");
    const edited = await loadDocsPage("guide");
    assert.match(edited.page.html, /<h2 id="third">Third<\/h2>/);
    // A page served before the edit can tell: src/core/features/docs/useCurrentDocs.ts reloads it.
    assert.ok(edited.version > first.version, "the docs version moves on with the edit");
    assert.equal((await index()).version, edited.version);

    await writeFile(join(root, "README.md"), "# Fixture\n\nRead [the missing part](docs/MISSING.md).\n");
    await until(async () => {
      const error = await page("index").then(() => null, (rejection) => rejection);
      assert.ok(error, "a broken link fails the load");
      assert.match(error.message, /README\.md: docs\/MISSING\.md/);
    }, "a broken link is reported");
    // The index module still loads, so the routes that do not show docs keep working; the docs routes throw its problem.
    const broken = await index();
    assert.match(broken.problem, /README\.md: docs\/MISSING\.md/);
    assert.deepEqual(Object.keys(broken.pages), ["", "guide"]);
    await assert.rejects(loadDocsPage("guide"), /README\.md: docs\/MISSING\.md \(docs\/MISSING\.md does not exist\)/);

    await writeFile(join(root, "README.md"), files["README.md"]);
    await writeFile(join(root, "docs/THIRD.md"), "# Third page\n");
    await writeFile(join(root, "docs/site.json"), site([home, { slug: "guide", source: "docs/GUIDE.md", label: "Guide" }, { slug: "third", source: "docs/THIRD.md", label: "Third" }]));
    await until(async () => {
      const { sections, repository } = await loadDocsPage("third");
      assert.deepEqual(sections[0].pages.map((entry) => entry.href), ["/docs", "/docs/guide", "/docs/third"]);
      assert.deepEqual(repository, { url: "https://example.test/source", branch: "main" });
    }, "a page added to docs/site.json is listed");
    assert.equal((await page("third")).title, "Third page");
    assert.equal((await index()).problem, null);

    // A folder removed with its files: nothing to do with the docs.
    await mkdir(join(root, ".scratch/inner"), { recursive: true });
    await writeFile(join(root, ".scratch/inner/notes.md"), "# Scratch\n");
    await writeFile(join(root, ".scratch/inner/data.txt"), "scratch\n");
    await settled();
    sent.length = 0;
    await rm(join(root, ".scratch"), { recursive: true, force: true });
    await settled();
    assert.deepEqual(errors(), [], "removing a folder sends no error");

    // A published page whose Markdown is removed with its folder is dropped, not served from the cache.
    await mkdir(join(root, "docs/sub"));
    await writeFile(join(root, "docs/sub/PAGE.md"), "# Sub page\n\n## Inside\n");
    await writeFile(join(root, "docs/site.json"), site([home, { slug: "sub", source: "docs/sub/PAGE.md", label: "Sub" }], [{ source: "docs/GUIDE.md", reason: "Retained guide" }, { source: "docs/THIRD.md", reason: "Retained third page" }]));
    await settled();
    // Loaded after the watcher has settled, so the plugin's cache holds the page when its folder goes.
    assert.match((await loadDocsPage("sub")).page.html, /<h2 id="inside">Inside<\/h2>/);
    sent.length = 0;
    await rm(join(root, "docs/sub"), { recursive: true, force: true });
    await until(async () => assert.deepEqual(reloaded(), ["client"]), "the browser reloads when a docs folder is removed");
    assert.deepEqual(errors(), [], "removing a docs folder sends no error");
    assert.match((await index()).problem ?? "", /docs\/sub\/PAGE\.md" does not exist/);
    await assert.rejects(loadDocsPage("sub"), /docs\/sub\/PAGE\.md" does not exist/, "the removed page no longer loads");
    await assert.rejects(page("sub"), /docs\/sub\/PAGE\.md" does not exist/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
