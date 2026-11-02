import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import React from 'react';
import Markdown from 'react-markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect } from '@playwright/test';
import { ok } from './two-people-support.mjs';

const text = bytes => new TextDecoder().decode(bytes);

/** Read the actual PDF drawing operations and embedded Unicode maps with pdf-lib,
 * independently of Slate's import parser and the archive's canonical manifest. */
async function pdfText(bytes) {
  const document = await PDFDocument.load(bytes);
  let result = '';
  for (const page of document.getPages()) {
    const fonts = page.node.Resources().lookup(PDFName.of('Font'));
    const maps = new Map();
    for (const [name, ref] of fonts.entries()) {
      const font = document.context.lookup(ref);
      const cmap = text(decodePDFRawStream(font.lookup(PDFName.of('ToUnicode'), PDFRawStream)).decode());
      const chars = new Map();
      for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of section[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
          chars.set(pair[1].toUpperCase(), String.fromCharCode(...(pair[2].match(/.{4}/g) ?? []).map(code => parseInt(code, 16))));
        }
      }
      assert.ok(chars.size, 'An embedded font has a readable Unicode map.');
      maps.set(name.toString(), chars);
    }
    let font;
    const contents = page.node.Contents();
    const streams = contents instanceof PDFRawStream ? [contents] : contents.asArray().map(ref => document.context.lookup(ref, PDFRawStream));
    for (const stream of streams) {
      const operations = text(decodePDFRawStream(stream).decode());
      for (const operation of operations.matchAll(/(\/[^\s]+)\s+[\d.]+\s+Tf|<([0-9a-f]+)>\s*Tj/gi)) {
        if (operation[1]) font = maps.get(operation[1]);
        else {
          assert.ok(font, 'PDF text selects an embedded font.');
          for (const code of operation[2].match(/.{4}/g) ?? []) {
            assert.ok(font.has(code.toUpperCase()), 'PDF glyph maps to readable text.');
            result += font.get(code.toUpperCase());
          }
        }
      }
    }
  }
  return result;
}

/** RFC-style quoted CSV reader; deliberately independent of the application parser. */
function csvRows(source) {
  const rows = [], row = [];
  let value = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(value); value = '';
      if (char === '\n') { rows.push(row.splice(0)); }
    } else if (char !== '\r' || quoted) value += char;
  }
  assert.equal(quoted, false);
  if (value || row.length) rows.push([...row, value]);
  return rows;
}

/** All content, files and records enter through native HTTP, then leave through the
 * actual export dialog and return through the native document-import form. */
export async function readableExportJourney(state, { proofOnly = false } = {}) {
  const { page, context, origin, api } = state;
  const width = page.viewportSize().width;
  const mutate = async (route, body, method = 'POST') => (await ok(context, origin, method, route, { operationKey: randomUUID(), ...body })).value;
  const container = await mutate('/api/containers', { name: 'Export recovery handbook', visibility: 'private', key: null });
  const containerId = container.id;
  const fixtures = [{ id: container.homePageId, title: 'Export recovery handbook home', parent: null, kind: 'page' }];
  async function create(title, parent, position, body = title + ' recovery instructions') {
    const blocks = [
      { id: randomUUID(), blockType: 'heading', content: { level: 2, text: [{ text: title + ' steps' }] }, treePosition: 'a' },
      { id: randomUUID(), blockType: 'paragraph', content: { text: [{ text: body }] }, treePosition: 'b' },
    ];
    const value = await mutate('/api/pages', { containerId, title, parentPageId: parent ?? null, treePosition: position, blocks });
    fixtures.push({ id: value.pageId, title, parent: parent ?? null, body, heading: title + ' steps', kind: 'page' });
    return value.pageId;
  }
  const root = await create('Recovery handbook', null, 'a', 'Restore café service with the original attachments.');
  await create('After recovery', root, 'z');
  const earlier = await create('Before recovery', root, 'a');
  await create('Escalation checklist', earlier, 'a');
  const outside = await create('Independent operations', null, 'z');
  const database = await mutate('/api/databases', { containerId, parentPageId: root, title: 'Recovery inventory' });
  fixtures.push({ id: database.pageId, title: 'Recovery inventory', parent: root, kind: 'database' });
  let revision = database.revisionId;
  const fields = [
    { id: randomUUID(), name: 'Recovery notes', type: 'text', config: {}, position: 0 },
    { id: randomUUID(), name: 'Quantity', type: 'number', config: {}, position: 1 },
    { id: randomUUID(), name: 'Ready', type: 'checkbox', config: {}, position: 2 },
  ];
  for (const field of fields) revision = (await mutate(`/api/databases/${database.id}/fields`, { expectedRevisionId: revision, field })).revisionId;
  const recordValues = [
    ['Primary recovery kit', ['Fresh, "quoted"\nsecond line', 7.5, true]],
    ['Reserve recovery kit', ['Café spare', 0, false]],
  ];
  const records = [];
  for (const [title, values] of recordValues) {
    const record = await mutate(`/api/databases/${database.id}/records`, { title, values: Object.fromEntries(fields.map((field, i) => [field.id, values[i]])) });
    records.push({ id: record.pageId, title, values });
    fixtures.push({ id: record.pageId, title, parent: database.pageId, kind: 'record' });
  }
  const mediaBytes = Buffer.from('synthetic-slate-138 original attachment\nCafé recovery bytes\u0000', 'utf8');
  const uploaded = await context.request.post(origin + '/api/media', { headers: { origin }, multipart: {
    operationKey: randomUUID(), pageId: root,
    file: { name: 'recovery-notes.txt', mimeType: 'text/plain', buffer: mediaBytes },
  } });
  assert.equal(uploaded.status(), 200, await uploaded.text());
  const file = (await uploaded.json()).value;
  const rootDocument = await api(`/api/pages/${root}`);
  await mutate(`/api/pages/${root}/blocks`, { expectedRevisionId: rootDocument.page.revisionId, blocks: [
    ...rootDocument.blocks.map(({ id, blockType, content, parentBlockId, treePosition }) => ({ id, blockType, content, parentBlockId, treePosition })),
    { id: randomUUID(), blockType: 'media', content: { kind: 'file', source: { fileId: file.id, name: file.name, url: file.url, contentType: 'text/plain' }, caption: '', alt: 'Original recovery notes' }, treePosition: 'c' },
  ] }, 'PUT');
  const ordered = (await api(`/api/pages?containerId=${containerId}`)).items;
  assert.equal(ordered.length, fixtures.length);

  for (const scope of ['page', 'descendants', 'container']) {
    const denied = await context.request.post(origin + '/api/exports/readable', { headers: { origin, cookie: state.readerCookie }, data: { scope, id: scope === 'container' ? containerId : root, format: 'html' } });
    assert.equal(denied.status(), 404, 'An ungranted member receives no private export.');
    assert.ok(!(await denied.text()).includes('Restore café service'));
  }

  async function openExport(scope) {
    await page.goto(origin + (scope === 'container' ? `/app/containers/${containerId}` : `/app/pages/${root}`), { waitUntil: 'networkidle' });
    if (scope === 'container') await page.getByRole('button', { name: 'Export space', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Export page', exact: true }).click();
    }
    const dialog = page.getByRole('dialog', { name: 'Export readable content', exact: true });
    await dialog.getByLabel('Content', { exact: true }).selectOption(scope);
    return dialog;
  }

  for (const scope of ['page', 'descendants', 'container']) {
    for (const format of (proofOnly ? ['html'] : ['markdown', 'html', 'pdf'])) {
      const expected = fixtures.filter(item => scope === 'container' || (scope === 'page' ? item.id === root : item.id !== outside && item.id !== container.homePageId));
      const dialog = await openExport(scope);
      await dialog.getByLabel('Format', { exact: true }).selectOption(format);
      if (format === 'html') await page.screenshot({ path: `.artifacts/ui-convergence/readable-export-${width}-${scope}-dialog.png` });
      const pending = page.waitForEvent('download');
      const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/exports/readable' && result.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Download export', exact: true }).click();
      const exported = await response;
      assert.equal(exported.status(), 200);
      assert.deepEqual(exported.request().postDataJSON(), { scope, id: scope === 'container' ? containerId : root, format, includeComments: true });
      const download = await pending;
      assert.match(download.suggestedFilename(), /\.zip$/);
      const bytes = await readFile(await download.path()), entries = unzipSync(bytes);
      const manifest = JSON.parse(text(entries['slate-readable.json']));
      assert.deepEqual(manifest.pages.map(item => item.id).sort(), expected.map(item => item.id).sort());
      assert.deepEqual(manifest.pages.map(item => [item.id, item.parentId]).sort(), expected.map(item => [item.id, item.parent]).sort());
      assert.deepEqual(Buffer.from(entries[`media/${file.id}`]), mediaBytes, 'The archive contains original bytes.');
      // Open every actual output, using only independent document readers.
      const output = await context.newPage();
      try {
        for (const fixture of expected) {
          const extension = format === 'markdown' ? 'md' : format;
          const document = entries[`pages/${fixture.id}.${extension}`];
          assert.ok(document, `Downloaded ${format} document for ${fixture.title}`);
          if (format === 'pdf') {
            const readable = await pdfText(document);
            assert.ok(readable.includes(fixture.title));
            if (fixture.body) assert.ok(readable.includes(fixture.body), 'PDF drawing operations retain readable Unicode body text.');
            if (fixture.heading) assert.ok(readable.includes(fixture.heading));
          } else {
            await output.setContent(format === 'html' ? text(document) : renderToStaticMarkup(React.createElement(Markdown, null, text(document))));
            await expect(output.getByRole('heading', { level: 1, name: fixture.title, exact: true })).toBeVisible();
            if (fixture.body) await expect(output.locator('body')).toContainText(fixture.body);
            if (fixture.heading) await expect(output.getByRole('heading', { level: 2, name: fixture.heading, exact: true })).toBeVisible();
            if (fixture.id === root) await expect(output.getByRole('link', { name: file.name, exact: true })).toHaveAttribute('href', `../media/${file.id}`);
          }
        }
      } finally { await output.close(); }
      const expectedRecords = scope === 'page' ? [] : records;
      assert.deepEqual(Object.keys(entries).filter(name => name.endsWith('.csv')).sort(), expectedRecords.map(record => `records/${record.id}.csv`).sort());
      for (const record of expectedRecords) {
        const rows = csvRows(text(entries[`records/${record.id}.csv`]));
        assert.deepEqual(rows, [fields.map(field => field.id), record.values.map(String)], 'CSV opens with exact quoted, multiline, Unicode, numeric and boolean values.');
      }

      const before = new Set((await api('/api/pages')).items.map(item => item.id));
      await page.goto(`${origin}/app/settings?section=portability`, { waitUntil: 'networkidle' });
      const form = page.locator('.portability-panel > form');
      await form.getByRole('combobox', { name: /^Format/ }).selectOption('slate-readable');
      await form.getByLabel('File', { exact: true }).setInputFiles({ name: `${scope}-${format}.zip`, mimeType: 'application/zip', buffer: bytes });
      const completed = page.waitForResponse(result => /^\/api\/imports\/[^/]+\/run$/.test(new URL(result.url()).pathname) && result.request().method() === 'POST');
      await form.getByRole('button', { name: 'Upload and review', exact: true }).click();
      const receipt = await completed;
      assert.equal(receipt.status(), 200, await receipt.text());
      assert.equal((await receipt.json()).state, 'completed');
      await expect(page.getByRole('heading', { name: 'Import · completed', exact: true })).toBeVisible();
      const copies = (await api('/api/pages')).items.filter(item => !before.has(item.id));
      assert.equal(copies.length, expected.length, 'Re-import creates the complete tree exactly once.');
      const copyByTitle = new Map(copies.map(item => [item.title, item]));
      for (const fixture of expected) {
        const copy = copyByTitle.get(fixture.title);
        assert.ok(copy);
        assert.notEqual(copy.id, fixture.id, 'Readable imports map fresh native identities.');
        assert.equal(copy.parentPageId, fixture.parent ? copyByTitle.get(fixtures.find(item => item.id === fixture.parent).title).id : null);
        assert.equal(copy.pageKind, fixture.kind, 'Database and record pages retain their native kind.');
        const restored = await api(`/api/pages/${copy.id}`);
        if (fixture.body) assert.ok(JSON.stringify(restored.blocks).includes(fixture.body));
        if (fixture.heading) assert.ok(restored.blocks.some(block => block.blockType === 'heading' && block.content.text[0].text === fixture.heading));
      }
      for (const parentId of new Set(expected.map(item => item.parent))) {
        const wanted = ordered.filter(item => expected.some(fixture => fixture.id === item.id) && item.parentPageId === parentId).map(item => item.title);
        const targetParent = parentId ? copyByTitle.get(fixtures.find(item => item.id === parentId).title).id : null;
        assert.deepEqual(copies.filter(item => item.parentPageId === targetParent).map(item => item.title), wanted, 'Sibling order survives the mapped tree.');
      }
      if (expectedRecords.length) {
        const restoredDatabase = (await api('/api/databases')).items.find(item => item.pageId === copyByTitle.get('Recovery inventory').id);
        assert.ok(restoredDatabase);
        for (const record of expectedRecords) {
          const restored = await api(`/api/databases/${restoredDatabase.id}/records/${copyByTitle.get(record.title).id}`);
          assert.deepEqual(fields.map(field => restored.values[restored.fields.find(item => item.name === field.name).id]), record.values);
        }
      }
      const restoredRoot = copyByTitle.get('Recovery handbook');
      const restored = await api(`/api/pages/${restoredRoot.id}`);
      const media = restored.blocks.find(block => block.blockType === 'media').content.source;
      assert.notEqual(media.fileId, file.id);
      const restoredMedia = await context.request.get(origin + `/api/media/${media.fileId}`);
      assert.equal(restoredMedia.status(), 200);
      assert.deepEqual(await restoredMedia.body(), mediaBytes);
      await page.goto(`${origin}/app/pages/${restoredRoot.id}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('textbox', { name: 'Page title', exact: true })).toHaveValue('Recovery handbook');
      if (format === 'html') await page.screenshot({ path: `.artifacts/ui-convergence/readable-export-${width}-${scope}-restored.png` });
      console.log(`PROBE PORT-007 ${scope} ${format}: native download and page import -> ${copies.length} mapped pages, ${expectedRecords.length} exact CSV records and original media bytes`);
    }
  }
}
