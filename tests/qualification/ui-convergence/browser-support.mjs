import {initializeEmbedEdge,readEmbedRequests} from '../../helpers/embed-edge.mjs';
import { initializeWebhookEdge, setWebhookFailure } from '../../helpers/webhook-edge.mjs';
import { testDevKey } from '../../e2e/dev-key.mjs';
import assert from 'node:assert/strict';
import { inbox, newOutboxLink, signInWithOutbox } from '../../e2e/outbox-auth.mjs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect, request } from '@playwright/test';
import { applyMigrations, executeD1, root, stop, testSessionSecret } from '../../e2e/runtime-harness.mjs';
import { startShellWorker } from '../release-shell/runtime.mjs';
import { accessible, insideViewport, withinViewport } from './browser-evidence.mjs';
import { initializeSlackEdge, setSlackFailure, readSlackMessages, setTeamsFailure, readTeamsMessages } from '../../helpers/slack-edge.mjs';
import { initializeS3Edge, setS3Failure, readS3Requests, readS3Objects } from '../../helpers/s3-edge.mjs';
import { initializeFolderEdge, readFolderRequests, setFileCardFixture } from '../../helpers/folder-edge.mjs';
import { initializeSamlEdge, installSamlIdp, closeSamlIdp, setSamlDns, setSamlAssertion, readSamlRequests } from '../../helpers/saml-edge.mjs';
export { accessible } from './browser-evidence.mjs';

const ownerEmail = ['owner', 'test.invalid'].join('@');
const readerEmail = ['reader', 'test.invalid'].join('@');

// Prepare the empty schema before registering journeys. Each journey copies it
// before seeding identity, so member data, sessions, erasure and restore stay
// isolated in its own D1 store. The migration CLI closes before any copy.
const pristineDatabase = await (async () => {
  await mkdir(path.join(root, '.artifacts/ui-convergence'), { recursive: true });
  const template = await mkdtemp(path.join(root, '.artifacts/ui-convergence/schema-'));
  await applyMigrations(template);
  return path.join(template, 'v3', 'd1');
})();
async function initializeWorkspaceDatabase(state) {
  await mkdir(path.join(state, 'v3'), { recursive: true });
  await cp(pristineDatabase, path.join(state, 'v3', 'd1'), { recursive: true });
}

/** Test-only identity records replace mailbox possession, never successful API responses. */
/** `scheduled` exposes the Worker's own cron handler, which a journey fires in place of waiting for the clock. */
export async function withWorkspace(viewport, profile, run, overrides = {}, { scheduled = false, slack = false, backups = false, folders = false, saml = false, webhooks = false } = {}) {
  const scratchRoot = path.join(root, '.artifacts/ui-convergence');
  await mkdir(scratchRoot, { recursive: true });
  const state = await mkdtemp(path.join(scratchRoot, 'state-'));
  const network = [], consoleErrors = [], modelRequests = [], captures = new Set();
  let runtime, browser;
  try {
    const samlFixture = saml ? await initializeSamlEdge(state) : undefined;
    if (slack) await initializeSlackEdge(state);
    if(webhooks)await initializeWebhookEdge(state);
    if (backups) await initializeS3Edge(state);
    if (folders) await initializeFolderEdge(state);
    await initializeEmbedEdge(state);
    await initializeWorkspaceDatabase(state);
    const now = new Date().toISOString();
    await executeD1(state, `INSERT INTO workspaces(id,name,mark,created_at,updated_at,revision_id) VALUES('browser-workspace','Harbor operations','','${now}','${now}','initial');
      INSERT INTO members(id,workspace_id,email,display_name,initials,role,member_kind,status,is_setup_owner,created_at,updated_at) VALUES('browser-owner','browser-workspace','${ownerEmail}','Alex Owner','AO','owner','member','active',1,'${now}','${now}');
      INSERT INTO members(id,workspace_id,email,display_name,initials,role,member_kind,status,is_setup_owner,created_at,updated_at) VALUES('browser-reader','browser-workspace','${readerEmail}','Morgan Reader','MR','member','member','active',0,'${now}','${now}');`);
    const origin = `http://127.0.0.1:${Number(process.env.SHELL_APP_PORT ?? 57000)}`;
    const workerVars = {
      SESSION_SECRET: testSessionSecret, LOCAL_DEVELOPMENT: 'true', APP_URL: origin,
      SETUP_OWNER_EMAIL: ownerEmail, MAIL_PROVIDER: 'development', MAIL_FROM: ownerEmail, RER_DEV_KEY: testDevKey,
      MAIL_API_KEY: 'TEST-ONLY-NOT-A-PROVIDER-CREDENTIAL', AI_ENABLED: 'false',
      AI_API_KEY: '', AI_PROVIDER: '', AI_LOCAL_URL: '', AI_LOCAL_TOKEN: '',
      ...(slack ? { CONNECTOR_CREDENTIALS_KEY: 'TEST-ONLY-SLACK-ENCRYPTION-KEY-32-CHARACTERS' } : {}),
      ...(backups || folders || webhooks ? { CONNECTOR_CREDENTIALS_KEY: 'synthetic-slate-100000000000000000000000003' } : {}),
      SLATE_PROFILE: profile, ...overrides,
    };
    let allocatedPorts;
    const startWorker = async () => {
      const started = await startShellWorker(state, workerVars, allocatedPorts, scheduled ? 'scheduled' : undefined);
      allocatedPorts = started.ports;
      return started;
    };
    runtime = await startWorker();
    const ownerSession=await signInWithOutbox(runtime.baseUrl,ownerEmail);
    const readerSession=await signInWithOutbox(runtime.baseUrl,readerEmail);
    const token=ownerSession.cookie.split('=')[1],readerToken=readerSession.cookie.split('=')[1];
    // Software raster, one raster thread, fixed colour and text handling: captures of the same page match across browser launches.
    const rasterArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization', '--disable-lcd-text', '--font-render-hinting=none', '--force-color-profile=srgb', '--num-raster-threads=1', '--disable-partial-raster', '--disable-skia-runtime-opts'];
    browser = await chromium.launch({ headless: true, ...(process.env.SLATE_CHROMIUM_PATH ? { executablePath: process.env.SLATE_CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic', ...rasterArgs] });
    const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], locale: 'en-US' });
    if (saml) await installSamlIdp(context, state, runtime.baseUrl);
    await context.addCookies([{ name: 'slate_session', value: token, url: runtime.baseUrl }]);
    const page = await context.newPage();
    context.on('request', request => {
      if (request.method() === 'POST' && /\/api\/(ai\/ask|inquiries\/ask)/.test(request.url())) modelRequests.push(request.url());
    });
    context.on('response', response => {
      const request = response.request();
      if (!new URL(response.url()).pathname.startsWith('/api/') || request.method() === 'GET') return;
      // Backup credential custody includes test receipts: never persist the submitted credential fields.
      let requestBody = request.postData();
      if (new URL(response.url()).pathname === '/api/backups' && request.method() === 'POST' && requestBody) {
        const submitted = JSON.parse(requestBody);
        delete submitted.accessKeyId;
        delete submitted.secretAccessKey;
        requestBody = JSON.stringify(submitted);
      }
      if (new URL(response.url()).pathname === '/api/imports/provider-folders/connections' && request.method() === 'POST' && requestBody) {
        const submitted = JSON.parse(requestBody);
        delete submitted.token;
        requestBody = JSON.stringify(submitted);
      }
      const pending = response.text().then(body => { if(new URL(response.url()).pathname.match(/^\/api\/(developer\/(tokens|webhooks|scim(?:\/[^/]+\/rotate)?)|activity\/streams)$/) && request.method() === 'POST' && response.ok()){const value=JSON.parse(body);delete value.secret;body=JSON.stringify(value);} network.push({ url: response.url(), method: request.method(), requestBody, status: response.status(), responseBody: body }); })
        .catch(cause => {
          // First run commits, then navigates to the new page. Chromium may
          // discard that document's body buffer before this diagnostic read;
          // keep the genuine response status instead of calling it a rejection.
          if (new URL(response.url()).pathname === '/api/workspace/first-run'
              && String(cause).includes('Response body is not available for a response that was navigated away from.')) {
            network.push({ url: response.url(), method: request.method(), requestBody, status: response.status(), responseBodyUnavailable: 'The first-run document navigated after the response.' });
          } else network.push({ url: response.url(), error: String(cause) });
        });
      captures.add(pending); pending.finally(() => captures.delete(pending));
    });
    context.on('requestfailed', request => network.push({ url: request.url(), method: request.method(), failure: request.failure() }));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ url: page.url(), message: message.text() }); });
    page.on('pageerror', cause => consoleErrors.push({ url: page.url(), message: String(cause) }));
    const api = async (route, options = {}) => {
      // Own the transport as call() does: Connection: close alone can still
      // select a pooled socket that the local proxy has already closed.
      const transport = await request.newContext({ storageState: await context.storageState() });
      try {
        const response = await transport.get(runtime.baseUrl + route, { ...options, maxRetries: 0 });
        assert.equal(response.status(), 200, await response.text());
        const value = await response.json();
        network.push({ url: runtime.baseUrl + route, method: 'GET', status: response.status(), responseBody: value });
        return value;
      } finally {
        await transport.dispose();
      }
    };
    const switchIdentity = async identity => {
      await context.clearCookies();
      await context.addCookies([{ name: 'slate_session', value: identity === 'reader' ? readerToken : token, url: runtime.baseUrl }]);
    };
    const records = async () => {
      // Unmount the page before the deliberate Worker restart so background
      // presence/session requests cannot race the fixture's stopped listener.
      await page.waitForLoadState('networkidle');
      await Promise.all([...captures]);
      const checkpointUrl = page.url();
      await page.goto('about:blank');
      await stop(runtime.child);
      runtime = undefined;
      let result, failure;
      try {
        [result] = await executeD1(state, "SELECT (SELECT COUNT(*) FROM workspaces) AS workspaces, (SELECT COUNT(*) FROM containers WHERE visibility!='personal') AS spaces, (SELECT COUNT(*) FROM pages) AS pages");
      } catch (cause) {
        failure = cause;
      }
      try {
        runtime = await startWorker();
      } catch (cause) {
        failure = failure ? new AggregateError([failure, cause], 'Persisted count checkpoint and Worker restart failed') : cause;
      }
      if (failure) throw failure;
      await page.goto(checkpointUrl, { waitUntil: 'networkidle' });
      return result.results[0];
    };
    /** Stored clock state (a past reminder) written with the Worker stopped, as records() reads. */
    const atRest = async statement => {
      await page.waitForLoadState('networkidle');
      await Promise.all([...captures]);
      await stop(runtime.child);
      runtime = undefined;
      let result;
      try { result = await executeD1(state, statement); }
      finally { runtime = await startWorker(); }
      return result;
    };
    const fixtureSql = async statements => {
      assert.ok(scheduled && runtime.child.connected, 'Clock fixtures require the scheduled test process IPC channel.');
      const child=runtime.child,id=crypto.randomUUID();
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('Native D1 fixture write timed out')),10000);
        const finish=error=>{clearTimeout(timer);child.off('message',receive);child.off('exit',exited);error?reject(error):resolve();};
        const receive=message=>{if(message?.type==='fixture.sql.result'&&message.id===id)finish(message.error?new Error(message.error):undefined);};
        const exited=()=>finish(new Error('Fixture process exited'));
        child.on('message',receive);child.once('exit',exited);
        child.send({type:'fixture.sql',id,statements},error=>{if(error)finish(error);});
      });
    };
    const runScheduled = async () => {
      assert.ok(scheduled, 'This workspace was started without the scheduled trigger.');
      const response = await fetch(`${runtime.baseUrl}/cdn-cgi/local/scheduled`, { headers: { connection: 'close' } });
      assert.equal(response.status, 200, await response.text());
    };
    try {
      await run({readEmbedRequests:()=>readEmbedRequests(state), page, context, origin: runtime.baseUrl, api, records, atRest, fixtureSql, runScheduled, switchIdentity, modelRequests, readerCookie: `slate_session=${readerToken}`,
        assertNoConsoleErrors: () => assert.deepEqual(consoleErrors, [], 'The browser must have no console errors or uncaught page errors.'),
        ...(webhooks ? {setWebhookFailure:failure=>setWebhookFailure(state,failure)} : {}),
        ...(backups ? { setS3Failure: failure => setS3Failure(state, failure), readS3Requests: () => readS3Requests(state), readS3Objects: () => readS3Objects(state) } : {}),
        ...(folders ? { setFileCardFixture:changes=>setFileCardFixture(state,changes), readFolderRequests: () => readFolderRequests(state) } : {}),
        ...(saml ? { samlFixture, installSamlIdp: nextContext => installSamlIdp(nextContext, state, runtime.baseUrl),
          setSamlDns: value => setSamlDns(state, value), setSamlAssertion: value => setSamlAssertion(state, value), readSamlRequests: () => readSamlRequests(state) } : {}),
        ...(slack ? { setSlackFailure: failure => setSlackFailure(state, failure), readSlackMessages: () => readSlackMessages(state), setTeamsFailure: failure => setTeamsFailure(state, failure), readTeamsMessages: () => readTeamsMessages(state) } : {}) });
    } catch (cause) {
      // Locator diagnostics can include a once-issued password value; preserve the failure without the credential.
      const credentials = (await Promise.all(browser.contexts().flatMap(view => view.pages()).map(view => view.locator('input[type=password][readonly]').evaluateAll(inputs => inputs.map(input => input.value)).catch(() => [])))).flat().filter(Boolean);
      for (const secret of credentials) { if (cause instanceof Error) { cause.message = cause.message.replaceAll(secret, '[credential redacted]'); if (cause.stack) cause.stack = cause.stack.replaceAll(secret, '[credential redacted]'); } }
      await accessible(page, `${profile} journey failure`).catch(() => {});
      await Promise.allSettled([...captures]);
      // A label that never changed looks the same whether the click did nothing or the server rejected it; say which.
      console.error('Journey failure context', JSON.stringify({ rejected: network.filter(entry => entry.error || entry.status >= 400).slice(-10), consoleErrors: consoleErrors.slice(-10) }, null, 2).slice(0, 8000));
      throw cause;
    }
    assert.deepEqual(modelRequests, [], 'This no-provider suite must never submit model work.');
  } finally {
    try {
      await Promise.allSettled([...captures]);
      const artifact = JSON.parse(await readFile(path.join(root, '.cache/slate/build-source.json'), 'utf8'));
      await writeFile(path.join(scratchRoot, `${profile}-${viewport.width}-network.json`), JSON.stringify({
        fixture: 'Identity-only D1 records and native development outbox sessions; no spaces, pages, invitations or application responses are seeded.',
        artifact, viewport, profile, network, consoleErrors, modelRequests,
      }, null, 2));
    } finally {
      try { await browser?.close(); }
      finally {
        try { if (runtime) await stop(runtime.child); }
        finally { await closeSamlIdp(state); await rm(state, { recursive: true, force: true }); }
      }
    }
  }
}

export async function setupWorkspace({ page, context, origin, api, records }) {
  const completion = () => ({ operationKey: crypto.randomUUID(), workspaceName: 'Refused workspace', containerName: 'Refused space', pageTitle: 'Refused page' });
  const freshView = async (cookie, run) => {
    const view = await context.browser().newContext({ viewport: page.viewportSize() });
    try {
      if (cookie) await view.addCookies([{ name: 'slate_session', value: cookie.split('=')[1], url: origin }]);
      await run(view, await view.newPage());
    } finally { await view.close(); }
  };
  // Separate native sessions keep the server's admission independent of an
  // already-mounted owner's router or cached setup state.
  const revoked = await signInWithOutbox(origin, ownerEmail);
  const signOut = await fetch(origin + '/auth/signout', { method: 'POST', headers: { origin, cookie: revoked.cookie } });
  assert.equal(signOut.status, 204);
  for (const cookie of [undefined, 'slate_session=synthetic-slate-invalid', revoked.cookie]) {
    await freshView(cookie, async (view, visitor) => {
      await visitor.goto(origin + '/setup', { waitUntil: 'networkidle' });
      assert.equal(new URL(visitor.url()).pathname, '/signin');
      await expect(visitor.getByRole('heading', { name: 'Name this workspace', exact: true })).toHaveCount(0);
      assert.equal((await view.request.get(origin + '/api/workspace/first-run')).status(), 401);
      assert.equal((await view.request.post(origin + '/api/workspace/first-run', { headers: { origin }, data: completion() })).status(), 401);
    });
  }
  for (const route of ['/app', '/app/search', '/app/settings']) {
    await page.goto(origin + route, { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/setup', 'Every unfinished owner entry reaches the native wizard.');
  }
  assert.deepEqual(await api('/api/workspace/first-run'), { required: true, canComplete: true });
  await page.goto(origin + '/app', { waitUntil: 'networkidle' });
  assert.deepEqual(await records(), { workspaces: 1, spaces: 0, pages: 0 }, 'The fixture supplies identity only before first run.');
  await expect(page.getByRole('heading', { name: 'Name this workspace', exact: true })).toBeVisible();
  await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue('');
  assert.equal(await page.getByLabel('Workspace name', { exact: true }).evaluate(input => input.placeholder), '');
  await expect(page.getByTestId('member-email')).toHaveText(ownerEmail);
  await expect(page.locator('body')).not.toContainText(/Aurora Android Launch|Jamie Park|Customer Success|How we handle an escalation/);
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(next).toBeDisabled();
  await accessible(page, 'first-run workspace');
  await insideViewport(page, next, 'Disabled first-run Continue');
  await page.getByLabel('Workspace name', { exact: true }).fill('Field notes');
  await expect(next).toBeEnabled();
  await withinViewport(page, next, 'First-run Continue');
  const buttonStyle = await next.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, height: element.getBoundingClientRect().height }));
  assert.notEqual(buttonStyle.background, 'rgba(0, 0, 0, 0)', 'Continue has a visible button surface.');
  assert.ok(buttonStyle.height >= 32);
  await next.click();
  await expect(page.getByLabel('Space name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('First page title')).toHaveValue('');
  await expect(next).toBeDisabled();
  const placeholders = await page.locator('input').evaluateAll(inputs => inputs.map(input => input.placeholder));
  assert.ok(placeholders.every(placeholder => placeholder === ''), 'First-run names have no value-like placeholders.');
  assert.ok(!placeholders.includes('Customer Success') && !placeholders.includes('How we handle an escalation'));
  await accessible(page, 'first-run space');
  await insideViewport(page, next, 'Disabled first-space Continue');
  await page.getByLabel('Space name', { exact: true }).fill('Handbook');
  await expect(next).toBeDisabled();
  await page.getByLabel('First page title').fill('Welcome');
  await withinViewport(page, next, 'First-space Continue');
  await next.click();
  await accessible(page, 'first-run invitations');
  await page.getByRole('button', { name: 'Skip this step' }).click();
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toBeVisible();
  assert.deepEqual(await records(), { workspaces: 1, spaces: 1, pages: 1 }, 'First run creates exactly one workspace, non-personal space and page.');
  const workspace = await api('/api/workspace');
  const spaces = await api('/api/containers');
  const pages = await api('/api/pages');
  assert.equal(workspace.name, 'Field notes');
  assert.deepEqual(spaces.items.filter(space => space.visibility !== 'personal').map(space => space.name), ['Handbook']);
  assert.deepEqual(pages.items.map(item => item.title), ['Welcome']);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Welcome');
  await expect(page.getByTestId('workspace-name')).toHaveText('Field notes');
  await accessible(page, 'first page');
  assert.deepEqual(await api('/api/workspace/first-run'), { required: false, canComplete: false });
  const before = await api('/api/workspace');
  const repeat = await context.request.post(origin + '/api/workspace/first-run', { headers: { origin }, data: completion() });
  assert.equal(repeat.status(), 409, 'A new completion cannot create another initial space or page.');
  assert.deepEqual(await api('/api/workspace'), before);
  // A genuinely new native session for a later member must never inherit the
  // owner's wizard, including on a direct setup URL after a reload.
  const laterEmail = ['later-' + crypto.randomUUID(), 'test.invalid'].join('@');
  const mail = await inbox(origin);
  const invite = await context.request.post(origin + '/api/invitations', { headers: { origin }, data: { operationKey: crypto.randomUUID(), email: laterEmail, kind: 'member' } });
  assert.equal(invite.status(), 200);
  const link = new URL(await newOutboxLink(origin, mail));
  const accepted = await fetch(origin + '/api/auth/invitation/accept', { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: link.searchParams.get('token') }) });
  assert.equal(accepted.status, 303);
  const laterCookie = accepted.headers.get('set-cookie').split(';', 1)[0];
  await freshView(laterCookie, async (view, member) => {
    const session = await (await view.request.get(origin + '/api/session')).json();
    assert.equal(session.member.email, laterEmail);
    assert.equal(session.member.role, 'member');
    for (const route of ['/app', '/setup']) {
      await member.goto(origin + route, { waitUntil: 'networkidle' });
      assert.equal(new URL(member.url()).pathname, '/app');
      await expect(member.getByRole('main')).toBeVisible();
      await expect(member.getByRole('heading', { name: 'Name this workspace', exact: true })).toHaveCount(0);
      await member.reload({ waitUntil: 'networkidle' });
      assert.equal(new URL(member.url()).pathname, '/app');
    }
    assert.deepEqual(await (await view.request.get(origin + '/api/workspace/first-run')).json(), { required: false, canComplete: false });
    assert.equal((await view.request.post(origin + '/api/workspace/first-run', { headers: { origin }, data: completion() })).status(), 403);
  });
  await page.goto(origin + '/setup', { waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/app', 'Completed owners return to their workspace.');
  assert.deepEqual(await records(), { workspaces: 1, spaces: 1, pages: 1 }, 'Refused and repeated setup creates no domain records.');
  await page.goto(origin + '/app/pages/' + pages.items[0].id, { waitUntil: 'networkidle' });
  await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Welcome');
}

export async function openNavigation(page) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
}

export async function closeDetails(page) {
  await page.locator('.detail-close').click();
}

/** The phone reaches secondary page actions through the real More menu. */
export async function openPageAction(page, name) {
  const desktopAction = page.locator('.page-topbar').getByRole('button', { name, exact: true });
  if (await desktopAction.isVisible()) await desktopAction.click();
  else {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
  }
}
