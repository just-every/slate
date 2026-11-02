import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';
import { root } from '../../e2e/runtime-harness.mjs';
import { accessible } from './browser-evidence.mjs';
import { call, grant, ok, restrictedPage } from './two-people-support.mjs';

/** Ordinary body tasks retain native completion without becoming database records. */
export async function taskBodyJourney(state, people) {
  const { origin } = state, { alice, bob } = people;
  const width = bob.page.viewportSize().width;
  const tasks = ['Check the rollout notes', 'Confirm the review room', 'Prepare the handover'];
  const source = await restrictedPage({ context: alice.context, origin }, 'Body task checklist', []);
  await grant(alice.context, origin, source.pageId, bob.id, 'edit');
  const initial = await ok(alice.context, origin, 'GET', `/api/pages/${source.pageId}`);
  const blocks = tasks.map((text, index) => ({ id: randomUUID(), blockType: 'task', treePosition: String(index), content: { text: [{ text }], done: false } }));
  await ok(alice.context, origin, 'PUT', `/api/pages/${source.pageId}/blocks`, {
    operationKey: randomUUID(), expectedRevisionId: initial.page.revisionId,
    blocks: [...blocks, { id: randomUUID(), blockType: 'paragraph', treePosition: '3', content: { text: [{ text: 'Keep these tasks in the page body.' }] } }],
  });

  // Populated, unfiltered native views make an accidental task record observable.
  const database = (await ok(alice.context, origin, 'POST', '/api/databases', { operationKey: randomUUID(), containerId: source.spaceId, title: 'Checklist records' })).value;
  const base = `/api/databases/${database.id}`;
  const records = [];
  for (const title of ['Launch record', 'Handover record']) records.push((await ok(alice.context, origin, 'POST', `${base}/records`, { operationKey: randomUUID(), title, values: {} })).value.pageId);
  const views = [];
  for (const [position, layout] of ['table', 'list'].entries()) {
    const current = await ok(alice.context, origin, 'GET', base);
    const view = { id: randomUUID(), name: `Checklist ${layout}`, layout, filters: [], sorts: [{ field: '$title', direction: 'asc' }], groups: [], calculations: {}, display: {}, position };
    await ok(alice.context, origin, 'POST', `${base}/views`, { operationKey: randomUUID(), expectedRevisionId: current.database.revision_id, view });
    views.push(view.id);
  }
  const snapshots = await Promise.all(views.map(id => ok(alice.context, origin, 'GET', `${base}/views/${id}`)));
  for (const snapshot of snapshots) assert.deepEqual(snapshot.records.map(row => row.pageId).sort(), [...records].sort(), 'Each populated view contains only its two real records.');
  const unchangedViews = async () => {
    for (const [index, id] of views.entries()) {
      const current = await ok(alice.context, origin, 'GET', `${base}/views/${id}`);
      assert.deepEqual(current.records, snapshots[index].records, 'Body completion never changes a database row or adds a task record.');
      assert.ok(current.records.every(row => ![source.pageId, ...blocks.map(block => block.id)].includes(row.pageId)));
    }
  };
  const read = () => ok(bob.context, origin, 'GET', `/api/pages/${source.pageId}`);
  const figure = bob.page.getByLabel('Task completion', { exact: true });
  const openDetails = async () => {
    const button = bob.page.getByRole('button', { name: 'Details', exact: true });
    if (await button.isVisible()) await button.click();
    else {
      await bob.page.getByRole('button', { name: 'More', exact: true }).click();
      await bob.page.getByRole('menuitem', { name: 'Details', exact: true }).click();
    }
  };
  const counts = async completed => {
    await expect(figure).toHaveText(`${completed} of 3 complete`);
    assert.deepEqual((await ok(bob.context, origin, 'GET', `/api/pages/${source.pageId}/details`)).taskCompletion, { completed, total: 3 });
  };
  const toggle = async (index, done) => {
    const [response] = await Promise.all([
      bob.page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/api/pages/${source.pageId}/blocks/${blocks[index].id}`)),
      bob.page.getByRole('checkbox', { name: `Mark complete: ${tasks[index]}`, exact: true }).click(),
    ]);
    assert.equal(response.status(), 200, 'Another editor can toggle a task through the native body control.');
    const receipt = (await response.json()).receipt;
    const document = await read(), block = document.blocks.find(block => block.id === blocks[index].id);
    assert.equal(block.blockType, 'task');
    assert.equal(block.content.done, done);
    assert.equal(block.content.completedByMemberId, done ? bob.id : null);
    assert.equal(block.content.completedAt, done ? receipt.committedAt : null, 'The server assigns completion time, and undo clears it.');
    return block.content.completedAt;
  };
  await bob.page.goto(`${origin}/app/pages/${source.pageId}`, { waitUntil: 'networkidle' });
  await openDetails();
  await counts(0);
  const times = [];
  for (const index of [0, 1]) {
    times.push(await toggle(index, true));
    await counts(index + 1);
  }
  await bob.page.reload({ waitUntil: 'networkidle' });
  await counts(2);
  for (const index of [0, 1]) {
    const row = bob.page.locator(`[data-block-id="${blocks[index].id}"] [data-task-item]`);
    await expect(row.getByRole('checkbox')).toBeChecked();
    await expect(row.locator('[data-task-completion]')).toContainText('Completed by Morgan Reader');
    await expect(row.locator('[data-task-completion] time')).toHaveAttribute('datetime', times[index]);
    assert.ok((await row.locator('[data-task-completion] time').innerText()).trim(), 'A reader sees the committed time.');
    assert.ok(await row.locator('[data-task-completion]').evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 13));
  }
  await unchangedViews();
  await accessible(bob.page, 'body task completion and page details');
  await bob.page.screenshot({ path: path.join(root, `.artifacts/ui-convergence/body-tasks-${width}-completed.png`), fullPage: true });
  for (const [offset, index] of [0, 1].entries()) {
    await toggle(index, false);
    await counts(1 - offset);
  }
  await bob.page.reload({ waitUntil: 'networkidle' });
  await counts(0);
  await expect(bob.page.locator('[data-task-completion]')).toHaveCount(0);
  for (const text of tasks) await expect(bob.page.getByRole('checkbox', { name: `Mark complete: ${text}`, exact: true })).not.toBeChecked();
  const final = await read();
  assert.deepEqual(final.blocks.filter(block => block.blockType === 'task').map(block => block.id), blocks.map(block => block.id), 'Completion preserves ordinary task block identities.');
  for (const block of final.blocks.filter(block => block.blockType === 'task')) assert.deepEqual([block.content.done, block.content.completedByMemberId, block.content.completedAt], [false, null, null]);
  await unchangedViews();
  await bob.page.screenshot({ path: path.join(root, `.artifacts/ui-convergence/body-tasks-${width}-undone.png`), fullPage: true });

  // The same body door denies a viewer, including a replay of forged attribution.
  await grant(alice.context, origin, source.pageId, bob.id, 'view');
  await bob.page.reload({ waitUntil: 'networkidle' });
  await expect(bob.page.getByRole('checkbox', { name: `Mark complete: ${tasks[0]}`, exact: true })).toBeDisabled();
  const before = await read();
  const refused = await call(bob.context, origin, 'PATCH', `/api/pages/${source.pageId}/blocks/${blocks[0].id}`, { operationKey: randomUUID(), expectedRevisionId: before.blocks[0].revisionId, content: { ...before.blocks[0].content, done: true, completedByMemberId: 'browser-owner', completedAt: '2000-01-01T00:00:00Z' } });
  assert.equal(refused.status, 403);
  assert.deepEqual((await read()).blocks, before.blocks, 'A denied toggle cannot alter completion or attribution.');
  await unchangedViews();
}

/**
 * BLOCK-016: Alex embeds a report filtered to one space and one assignee over tasks on
 * three restricted pages. Morgan, who can read two of them, sees two tasks and nothing of
 * the third, completes one from the report, and the page shows it done. The published
 * page shows the report as a sign-in notice and never runs it for an anonymous reader.
 */
export async function taskReportJourney(state, people) {
  await taskBodyJourney(state, people);
  const { origin } = state, { alice, bob } = people;
  const width = alice.page.viewportSize().width;
  const shot = (view, label) => view.screenshot({ path: path.join(root, `.artifacts/ui-convergence/task-report-${width}-${label}.png`), fullPage: true });
  const titles = ['Alpha rollout page', 'Beta rollout page', 'Confidential rollout page'];
  const texts = ['Draft the rollout notes', 'Book the review room', 'Brief the acquisition board'];
  const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const sources = [];
  for (const [index, title] of titles.entries()) {
    const source = await restrictedPage({ context: alice.context, origin }, title, []);
    if (index < 2) await grant(alice.context, origin, source.pageId, bob.id, index === 0 ? 'edit' : 'view');
    const document = await ok(alice.context, origin, 'GET', `/api/pages/${source.pageId}`);
    const blockId = randomUUID();
    await ok(alice.context, origin, 'PUT', `/api/pages/${source.pageId}/blocks`, { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, blocks: [
      { id: blockId, blockType: 'task', treePosition: '1', content: { text: [{ text: texts[index] }], done: false, assigneeMemberId: 'browser-owner', dueDate: day(index + 2) } },
    ] });
    sources.push({ ...source, blockId });
  }
  const spaceId = sources[0].spaceId;
  const { value: { pageId } } = await ok(alice.context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: spaceId, title: 'Rollout task report' });
  await grant(alice.context, origin, pageId, bob.id, 'view');

  // Alex inserts the report from the insert menu and filters it to the space and to himself.
  await alice.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  await alice.page.getByRole('button', { name: /Add block/ }).click();
  await alice.page.getByPlaceholder('Type to search').fill('Task report');
  await alice.page.getByRole('option', { name: 'Task report', exact: true }).click();
  const report = alice.page.getByRole('region', { name: 'Task report', exact: true });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Edit report', exact: true }).click();
  const dialog = alice.page.getByRole('dialog', { name: 'Edit task report' });
  await dialog.getByRole('combobox', { name: 'Report space', exact: true }).selectOption(spaceId);
  await dialog.getByRole('combobox', { name: 'Report assignee', exact: true }).selectOption('member:browser-owner');
  await dialog.getByRole('button', { name: 'Save report', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = async () => (await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`)).blocks.find(block => block.blockType === 'task-report')?.content.definition ?? {};
  await expect.poll(saved).toMatchObject({ containerId: spaceId, assignee: { kind: 'member', memberId: 'browser-owner' } });
  await alice.page.reload({ waitUntil: 'networkidle' });
  for (const text of texts) await expect(report.getByRole('link', { name: text, exact: true })).toBeVisible();
  for (const title of titles) await expect(report.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(report.getByText(/^Last ran /)).toBeVisible();
  await accessible(alice.page, 'task report for a reader of every page');
  await shot(alice.page, 'all-three');

  // Morgan reads two of the three pages: two tasks, and no count, title or placeholder for the third.
  await bob.page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
  const bobReport = bob.page.getByRole('region', { name: 'Task report', exact: true });
  for (const text of texts.slice(0, 2)) await expect(bobReport.getByRole('link', { name: text, exact: true })).toBeVisible();
  await expect(bobReport.locator('.task-list > li')).toHaveCount(2);
  await expect(bobReport.locator('h3')).toHaveCount(2);
  await expect(bob.page.locator('body')).not.toContainText(texts[2]);
  await expect(bob.page.locator('body')).not.toContainText(titles[2]);
  await expect(bobReport.getByRole('checkbox', { name: `Complete: ${texts[1]}`, exact: true })).toBeDisabled();
  await accessible(bob.page, 'task report for a reader of two pages');
  await shot(bob.page, 'two-of-three');

  // Morgan edits the first page, so completes its task from the report; the page shows it done.
  const [completing] = await Promise.all([bob.page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/api/tasks/${sources[0].pageId}/${sources[0].blockId}`)), bobReport.getByRole('checkbox', { name: `Complete: ${texts[0]}`, exact: true }).click()]);
  assert.equal(completing.status(), 200, 'Completing from the report commits on the source page.');
  await expect(bobReport.getByRole('checkbox', { name: `Complete: ${texts[0]}`, exact: true })).toBeChecked();
  const source = await ok(alice.context, origin, 'GET', `/api/pages/${sources[0].pageId}`);
  assert.deepEqual([source.blocks[0].content.done, source.blocks[0].content.completedByMemberId], [true, bob.id]);
  await bobReport.getByRole('link', { name: titles[0], exact: true }).click();
  await bob.page.waitForURL(`**/app/pages/${sources[0].pageId}`);
  await expect(bob.page.getByRole('checkbox', { name: `Mark complete: ${texts[0]}`, exact: true })).toBeChecked();
  await shot(bob.page, 'completed-on-page');

  // Published, the report is a sign-in notice; the anonymous reader never runs it.
  const document = await ok(alice.context, origin, 'GET', `/api/pages/${pageId}`);
  await ok(alice.context, origin, 'POST', `/api/publishing/${pageId}`, { operationKey: randomUUID(), expectedRevisionId: document.page.revisionId, host: new URL(origin).host, slug: 'rollout-task-report' });
  const publicContext = await alice.context.browser().newContext({ viewport: alice.page.viewportSize() });
  const requests = [];
  publicContext.on('request', request => requests.push(new URL(request.url()).pathname));
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${origin}/p/rollout-task-report`, { waitUntil: 'networkidle' });
    assert.deepEqual(await publicContext.cookies(), [], 'The public reader has no session.');
    await expect(publicPage.getByText('Sign in to view this task report.', { exact: true })).toBeVisible();
    for (const hidden of [...texts, ...titles]) await expect(publicPage.locator('body')).not.toContainText(hidden);
    assert.deepEqual(requests.filter(route => route.startsWith('/api/')), [], 'An anonymous reader never runs the report.');
    await shot(publicPage, 'published');
  } finally { await publicContext.close(); }
}
