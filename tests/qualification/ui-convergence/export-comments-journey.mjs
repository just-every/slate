import { inlineSpans } from '../../portability/fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { expect } from '@playwright/test';
import { grant, ok } from './two-people-support.mjs';
import { openPageAction } from './browser-support.mjs';

export async function exportCommentsJourney(state, people) {
  const { page, context, origin, api } = state;
  const width = page.viewportSize().width;
  const space = (await api('/api/containers')).items.find(item => item.name === 'Handbook');
  const blockId = randomUUID(), anchorId = randomUUID();
  const { value: { pageId } } = await ok(context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, title: 'Customer incident handover', blocks: [{ id: blockId, blockType: 'paragraph', content: { text: [{ text: 'Confirm the recovery owner', commentAnchorId: anchorId }, { text: ' before handing the incident to the next shift.' }] }, treePosition: 'a' }] });
  await grant(context, origin, pageId, people.bob.id, 'comment');
  const original = await api(`/api/pages/${pageId}`);
  const spans = inlineSpans(people.bob.id, pageId).map(span => span.mention?.kind === 'page' ? {...span,text:'Customer incident handover',mention:{...span.mention,label:'Customer incident handover'}} : span);
  await ok(context, origin, 'PUT', `/api/pages/${pageId}/blocks`, {operationKey:randomUUID(),expectedRevisionId:original.page.revisionId,blocks:[...original.blocks,{id:randomUUID(),blockType:'paragraph',parentBlockId:null,treePosition:'b',content:{text:spans}}]});
  const source = await api(`/api/pages/${pageId}`);
  const first = (await ok(context, origin, 'POST', `/api/comments/page/${pageId}`, { operationKey: randomUUID(), kind: 'inline', blockId, anchor: { anchorId, quote: 'Confirm the recovery owner' }, anchorRevisionId: source.workingRevisionId, body: [{ text: 'Who will coordinate the next customer update?' }] })).value;
  await ok(people.bob.context, origin, 'POST', `/api/comments/page/${pageId}`, { operationKey: randomUUID(), threadId: first.threadId, parentCommentId: first.id, body: [{ text: 'Morgan will send the update at the next handover.' }] });
  await ok(context, origin, 'POST', `/api/comments/page/${pageId}`, { operationKey: randomUUID(), body: [{ text: 'Keep this timeline with the incident report.' }] });
  const discussion = await api(`/api/comments/page/${pageId}`);
  await ok(context, origin, 'POST', `/api/comments/thread/${first.threadId}/resolve`, { operationKey: randomUUID(), expectedRevisionId: discussion.threads.find(t => t.id === first.threadId).revision_id, resolved: true });
  async function openExport() {
    await page.goto(`${origin}/app/pages/${pageId}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export page', exact: true }).click();
  }
  async function download(format, label, { scope = 'page', includeComments = true } = {}) {
    const dialog = page.getByRole('dialog', { name: 'Export readable content', exact: true });
    await dialog.getByLabel('Format', { exact: true }).selectOption(format);
    if (scope !== 'page') await dialog.getByLabel('Content', { exact: true }).selectOption(scope);
    const comments = dialog.getByRole('checkbox', { name: 'Include comments', exact: true });
    await expect(comments).toBeChecked();
    await comments.setChecked(includeComments);
    await expect(dialog).toContainText('comment authors');
    await page.screenshot({ path: `.artifacts/ui-convergence/export-comments-${width}-${label}-dialog.png` });
    const pending = page.waitForEvent('download');
    const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/exports/readable' && result.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Download export', exact: true }).click();
    const exported = await response;
    assert.equal(exported.status(), 200);
    assert.equal(exported.request().postDataJSON().includeComments, includeComments);
    assert.equal(exported.headers()['content-type'], format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/zip');
    const file = await pending;
    assert.match(file.suggestedFilename(), format === 'docx' ? /\.docx$/ : /\.zip$/);
    const bytes = await readFile(await file.path());
    await expect(dialog).toHaveCount(0);
    return bytes;
  }
  for (const format of ['html', 'markdown']) {
    await openExport();
    const bytes = await download(format, format);
    const entries = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(entries['slate-readable.json']));
    const archivedPage = manifest.pages.find(p => p.id === pageId);
    assert.deepEqual(archivedPage.blocks.map(block => block.content), source.blocks.map(block => block.content), 'Every canonical mark and reference enters the page archive unchanged.');
    const archived = archivedPage.comments;
    const readable = new TextDecoder().decode(entries[`pages/${pageId}.${format === 'html' ? 'html' : 'md'}`]);
    if (format === 'markdown') {
      for (const fragment of ['**bold words**','_italic words_','<u>underline words</u>','~~strikethrough words~~','`code words`','[Ready for review]{status:green}','External reference','Research member','Customer incident handover']) assert.ok(readable.includes(fragment), `Readable Markdown retains ${fragment}.`);
      for (const colour of ['yellow','blue','green','red','purple']) assert.ok(readable.includes(`data-slate-colour="${colour}"`));
      assert.ok(!readable.includes('<script>') && !readable.includes('<img src=x'));
    }
    assert.equal(archived.threads.length, 2);
    assert.equal(archived.threads.find(t => t.kind === 'inline').state, 'resolved');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(entries[`pages/${pageId}.comments.json`])), archived);
    if (format === 'html') {
      const output = await context.newPage();
      try {
        await output.setContent(new TextDecoder().decode(entries[`pages/${pageId}.html`]));
        for (const [tag, label] of [['strong','bold words'],['em','italic words'],['u','underline words'],['s','strikethrough words'],['code','code words']]) await expect(output.locator(tag).filter({hasText:new RegExp(`^${label}$`)})).toHaveCount(1);
        for (const colour of ['yellow','blue','green','red','purple']) {
          const highlight = output.locator(`[data-slate-colour="${colour}"]`).filter({hasText:`${colour} highlight`});
          await expect(highlight).toHaveCount(1);
          assert.notEqual(await highlight.evaluate(element=>getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
        }
        await expect(output.locator('script,img')).toHaveCount(0);
        await expect(output.getByText('Literal <img src=x onerror=alert(1)> & <script>unsafe()</script>',{exact:true})).toBeVisible();
        await expect(output.getByRole('link',{name:'External reference',exact:true})).toHaveAttribute('href','https://example.invalid/document?part=1&next=2');
        await expect(output.getByRole('region', { name: 'Comments', exact: true })).toContainText('Alex Owner');
        await expect(output.getByRole('region', { name: 'Comments', exact: true })).toContainText('Morgan Reader');
        await expect(output.getByRole('link', { name: 'Inline thread', exact: true })).toHaveAttribute('href', `#slate-block-${blockId}`);
        await output.getByRole('link', { name: 'Inline thread', exact: true }).click();
        await expect(output.locator(`#slate-block-${blockId}`)).toBeInViewport();
        await output.screenshot({ path: `.artifacts/ui-convergence/export-comments-${width}-html.png`, fullPage: true });
      } finally { await output.close(); }
    }
    const previous = new Set((await api('/api/pages')).items.map(p => p.id));
    await page.goto(`${origin}/app/settings?section=portability`, { waitUntil: 'networkidle' });
    const form = page.locator('.portability-panel > form');
    await form.getByRole('combobox', { name: /^Format/ }).selectOption('slate-readable');
    await form.getByLabel('File', { exact: true }).setInputFiles({ name: `handover-${format}.zip`, mimeType: 'application/zip', buffer: bytes });
    await form.getByRole('button', { name: 'Upload and review', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Import · completed', exact: true })).toBeVisible();
    await page.screenshot({ path: `.artifacts/ui-convergence/export-comments-${width}-${format}-import.png`, fullPage: true });
    const copy = (await api('/api/pages')).items.find(p => !previous.has(p.id) && p.title === 'Customer incident handover');
    assert.ok(copy);
    await page.goto(`${origin}/app/pages/${copy.id}`, { waitUntil: 'networkidle' });
    await openPageAction(page, 'Comments');
    await expect(page.locator('.comment-thread')).toHaveCount(2);
    await expect(page.locator('.right')).toContainText('Morgan Reader');
    await expect(page.locator('.right')).toContainText('Who will coordinate the next customer update?');
    await expect(page.locator('.right')).toContainText('Resolved');
    const restored = await api(`/api/comments/page/${copy.id}`);
    assert.equal(restored.threads.find(t => t.kind === 'inline').block_id, (await api(`/api/pages/${copy.id}`)).blocks[0].id);
    const copyDocument = await api(`/api/pages/${copy.id}`);
    const author = restored.comments.find(comment => comment.authorDisplayName === 'Morgan Reader').authorMemberId;
    const expectedSpans = spans.map(span => span.mention?.kind === 'page' ? {...span,mention:{...span.mention,id:copy.id}} : span.mention?.kind === 'person' ? {...span,mention:{...span.mention,id:author}} : span.link?.href === `/app/pages/${pageId}` ? {...span,link:{href:`/app/pages/${copy.id}`}} : span);
    assert.deepEqual(copyDocument.blocks[1].content.text, expectedSpans, 'Page re-import changes only explicitly mapped native identities.');
    await expect(page.locator('[data-block-id]').nth(1).locator('strong').filter({hasText:'bold words'})).toBeVisible();
    assert.deepEqual(restored.comments.map(c => [c.authorDisplayName, c.createdAt, c.body]), discussion.comments.map(c => [c.authorDisplayName, c.createdAt, c.body]));
    await page.screenshot({ path: `.artifacts/ui-convergence/export-comments-${width}-${format}-restored.png`, fullPage: true });
  }
  await ok(context, origin, 'POST', '/api/pages', { operationKey: randomUUID(), containerId: space.id, parentPageId: pageId, title: 'Recovery follow-up', blocks: [{ id: randomUUID(), blockType: 'paragraph', content: { text: [{ text: 'Review the incident after the next shift.' }] }, treePosition: 'a' }] });
  const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  for (const [scope, includeComments, label] of [
    ['page', true, 'word-comments'],
    ['page', false, 'word-without-comments'],
    ['descendants', true, 'word-descendants'],
  ]) {
    await openExport();
    const bytes = await download('docx', label, { scope, includeComments });
    const entries = unzipSync(bytes);
    assert.ok(entries['[Content_Types].xml']);
    assert.equal(entries['slate-readable.json'], undefined, 'Word is a single document rather than a readable archive.');
    const document = xml.parse(new TextDecoder().decode(entries['word/document.xml']));
    assert.ok(document.document.body);
    const body = JSON.stringify(document.document.body);
    assert.match(body, /Customer incident handover/);
    assert.match(body, /Confirm the recovery owner/);
    if (scope === 'descendants') {
      assert.match(body, /Recovery follow-up/);
      assert.match(body, /Review the incident after the next shift\./);
    } else assert.doesNotMatch(body, /Recovery follow-up|Review the incident after the next shift\./);
    if (includeComments) {
      assert.ok(entries['word/comments.xml']);
      const parsed = xml.parse(new TextDecoder().decode(entries['word/comments.xml'])).comments.comment;
      const comments = Array.isArray(parsed) ? parsed : [parsed];
      for (const comment of discussion.comments) {
        const exported = comments.find(item => item['@_author'] === comment.authorDisplayName && JSON.stringify(item).includes(comment.body[0].text));
        assert.ok(exported, `Word retains the comment by ${comment.authorDisplayName}.`);
        assert.equal(new Date(exported['@_date']).getTime(), new Date(comment.createdAt).getTime());
      }
      assert.match(body, /commentRangeStart/);
      assert.match(body, /commentReference/);
    } else {
      assert.equal(entries['word/comments.xml'], undefined);
      assert.doesNotMatch(body, /commentRangeStart|commentReference|Who will coordinate|Keep this timeline/);
    }
    await openPageAction(page, 'Comments');
    await expect(page.locator('.comment-thread')).toHaveCount(2);
    await expect(page.locator('.right')).toContainText('Resolved');
    await expect(page.locator('.right')).toContainText('Who will coordinate the next customer update?');
    await page.screenshot({ path: `.artifacts/ui-convergence/export-comments-${width}-${label}-downloaded.png`, fullPage: true });
  }
  await page.goto(`${origin}/app/settings?section=portability`, { waitUntil: 'networkidle' });
  for (const item of (await api('/api/pages')).items) {
    const response = await context.request.post(origin + '/api/exports/readable', { headers: { origin }, data: { scope: 'page', id: item.id, format: 'html' } });
    assert.equal(response.status(), 200, `Export ${item.title}: ${response.status() === 200 ? '' : await response.text()}`);
  }
  await page.getByRole('button', { name: 'Export readable workspace', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Format', { exact: true }).locator('option[value="docx"]')).toHaveCount(0);
  const workspace = await download('html', 'workspace');
  assert.ok(JSON.parse(new TextDecoder().decode(unzipSync(workspace)['slate-readable.json'])).pages.length >= 4);
}
