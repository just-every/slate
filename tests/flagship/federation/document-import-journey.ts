import {env} from 'cloudflare:test';
import {expect, vi} from 'vitest';
import {strToU8, unzipSync, unzlibSync, zipSync} from 'fflate';
import {createApi} from '../../../src/core/app/hono';
import type {ImportFormat} from '../../../src/core/features/imports/types';
import {seedWorkspace, seedMember, seedContainer, seedPageGrant, sessionFor} from '../../e2e/setup/fixtures';
import {syntheticDocx, syntheticEpub} from '../../e2e/imports/fixtures/synthetic';
import {syntheticStructuredPdf} from '../../e2e/imports/fixtures/pdf-structure';
import {imageBytes} from '../../e2e/imports/word-export-fixture';

type Block = {id: string; blockType: string; content: any; parentBlockId: string | null};
type DocumentCase = {format: ImportFormat; name: string; bytes: Uint8Array; headings: string[]; levels: number[]; tables: string[][][]; paragraphs?: string[]; media?: 'archive' | 'pdf'};
const text = (block: Block) => typeof block.content.text === 'string' ? block.content.text : (block.content.text ?? []).map((span: {text: string}) => span.text).join('');
const table = (block: Block): string[][] => [block.content.columns, ...block.content.rows.map((row: {cells: string[]}) => row.cells)];
const marker = imageBytes;

function documents(): DocumentCase[] {
  const word = unzipSync(syntheticDocx());
  word['word/document.xml'] = strToU8(new TextDecoder().decode(word['word/document.xml']).replace('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>', '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Term</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Count</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Word</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'));
  word['word/media/image1.png'] = marker;
  const epub = unzipSync(syntheticEpub());
  epub['OPS/book.opf'] = strToU8('<package><manifest><item id="first" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>');
  epub['OPS/chapter.xhtml'] = strToU8('<h1>Chapter one</h1><table><tr><th>Part</th><th>State</th></tr><tr><td>First</td><td>Ready</td></tr></table><img src="marker.png" alt="Archive marker">');
  epub['OPS/second.xhtml'] = strToU8('<h2>Chapter two</h2><p>Second chapter body</p>');
  epub['OPS/marker.png'] = marker;
  return [
    {format: 'markdown', name: 'synthetic-slate-1.md', bytes: strToU8('# Markdown heading\n\n| Item | Count |\n| --- | --- |\n| Widget | 2 |\n\nMarkdown body'), headings: ['Markdown heading'], levels: [1], tables: [[['Item', 'Count'], ['Widget', '2']]], paragraphs: ['Markdown body']},
    {format: 'html', name: 'synthetic-slate-2.html', bytes: strToU8('<h2 onclick="unsafe-handler">HTML heading</h2><table><tr><th>Item</th><th>Count</th></tr><tr><td>Gadget</td><td>3</td></tr></table><p>HTML body</p><script>unsafe-script</script><form>unsafe-form</form><a href="javascript:unsafe-link">Bad link</a><img src="https://media.example.test/missing.png" alt="Missing image"><img src="data:text/html,unsafe-image">'), headings: ['HTML heading'], levels: [2], tables: [[['Item', 'Count'], ['Gadget', '3']]], paragraphs: ['HTML body']},
    {format: 'docx', name: 'synthetic-slate-3.docx', bytes: zipSync(word), headings: ['Heading'], levels: [1], tables: [[['Term', 'Count'], ['Word', '4']]], paragraphs: ['Body text'], media: 'archive'},
    {format: 'pdf', name: 'synthetic-slate-4.pdf', bytes: syntheticStructuredPdf(), headings: ['Recovery checklist'], levels: [1], tables: [[['Task', 'Status'], ['Restore files', 'Ready']]], paragraphs: ['Open companion'], media: 'pdf'},
    {format: 'epub', name: 'synthetic-slate-5.epub', bytes: zipSync(epub), headings: ['Chapter one', 'Chapter two'], levels: [1, 2], tables: [[['Part', 'State'], ['First', 'Ready']]], paragraphs: ['Second chapter body'], media: 'archive'},
    {format: 'text', name: 'synthetic-slate-6.txt', bytes: strToU8('Plain first paragraph\n\nPlain second paragraph'), headings: [], levels: [], tables: [], paragraphs: ['Plain first paragraph', 'Plain second paragraph']},
  ];
}

/** Native document uploads, atomic publication and current-authority readback. */
export async function documentImportJourney() {
  const {workspaceId} = await seedWorkspace();
  const person = async (index: number, role: 'owner' | 'member') => seedMember(workspaceId, {email: [`synthetic-slate-${index}`, 'example.test'].join('@'), displayName: `Person ${index}`, role, isSetupOwner: role === 'owner'});
  const owner = await person(1, 'owner'), editor = await person(2, 'member'), viewer = await person(3, 'member');
  const {containerId} = await seedContainer(workspaceId, {ownerMemberId: owner.memberId, visibility: 'private'});
  const app = createApi(), nativeEnv = {...env, APP_URL: 'https://slate.example', SLATE_PROFILE: undefined};
  const ownerCookie = await sessionFor(owner.memberId), editorCookie = await sessionFor(editor.memberId), viewerCookie = await sessionFor(viewer.memberId);
  const request = (cookie: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => app.request(`https://slate.example/api${path}`, {method, headers: {Cookie: cookie, Origin: 'https://slate.example', ...(body === undefined || body instanceof FormData ? {} : {'Content-Type': 'application/json'})}, ...(body === undefined ? {} : {body: body instanceof FormData ? body : JSON.stringify(body)})}, nativeEnv);
  const ok = async (path: string, body?: unknown, method?: string, cookie = editorCookie) => {
    const response = await request(cookie, path, body, method), value = await response.json<any>();
    expect(response.status, `${path}: ${JSON.stringify(value)}`).toBe(200);
    return value;
  };
  const originalBlock = {id: 'synthetic-slate-original', blockType: 'paragraph', content: {text: [{text: 'Existing destination content'}]}, treePosition: '0'};
  const created = await ok('/pages', {operationKey: 'synthetic-slate-create', containerId, title: 'Existing destination', blocks: [originalBlock]}, undefined, ownerCookie);
  const pageId = created.value.pageId, path = `/pages/${pageId}`;
  await seedPageGrant(pageId, {principalKind: 'member', principalId: owner.memberId, level: 'full'});
  const grant = await seedPageGrant(pageId, {principalKind: 'member', principalId: editor.memberId, level: 'edit'});
  await seedPageGrant(pageId, {principalKind: 'member', principalId: viewer.memberId, level: 'view'});
  expect((await ok(path)).permissions.level).toBe('edit');
  const initial = await ok(path);
  const upload = async (document: Pick<DocumentCase, 'format' | 'name' | 'bytes'>, mode: 'append' | 'children', revision: string, cookie = editorCookie) => {
    if (mode === 'children') return app.request('https://slate.example/api/imports/stream', {method: 'POST', headers: {Cookie: cookie, 'X-Import-Metadata': encodeURIComponent(JSON.stringify({operationKey: crypto.randomUUID(), format: document.format, name: document.name, sizeBytes: document.bytes.length, destination: {pageId, expectedRevisionId: revision, mode}}))}, body: document.bytes as Uint8Array<ArrayBuffer>}, nativeEnv);
    const form = new FormData();
    form.set('file', new File([document.bytes as Uint8Array<ArrayBuffer>], document.name));
    form.set('format', document.format); form.set('operationKey', crypto.randomUUID());
    form.set('destinationPageId', pageId); form.set('expectedRevisionId', revision); form.set('mode', mode);
    return request(cookie, '/imports', form);
  };
  const stage = async (document: Pick<DocumentCase, 'format' | 'name' | 'bytes'>, mode: 'append' | 'children', revision: string) => {
    const response = await upload(document, mode, revision), job = await response.json<any>();
    expect(response.status, JSON.stringify(job)).toBe(200);
    return job;
  };
  const complete = async (job: {id: string}, source: {bytes: Uint8Array}) => {
    const result = await ok(`/imports/${job.id}/run`, {});
    expect(result.state).toBe('completed');
    expect(await ok(`/imports/${job.id}`)).toEqual(result);
    expect(result.report).toEqual(expect.objectContaining({created: expect.any(Array), unmapped: expect.any(Array), warnings: expect.any(Array)}));
    const original = await request(editorCookie, `/imports/${job.id}/original`);
    expect(original.status).toBe(200);
    expect(original.headers.get('Content-Disposition')).toContain('attachment');
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(source.bytes);
    return result;
  };
  const readMedia = async (blocks: Block[], kind: 'archive' | 'pdf') => {
    const media = blocks.filter(block => block.blockType === 'media');
    expect(media).toHaveLength(1);
    const response = await request(editorCookie, media[0]!.content.source.url.replace('/api', ''));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (kind === 'archive') expect(bytes).toEqual(marker);
    else {
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([2, 2]);
      let pixels: Uint8Array | undefined;
      for (let offset = 8; offset < bytes.length; offset += 12 + view.getUint32(offset)) {
        if (new TextDecoder().decode(bytes.slice(offset + 4, offset + 8)) === 'IDAT') pixels = unzlibSync(bytes.slice(offset + 8, offset + 8 + view.getUint32(offset)));
      }
      expect(pixels && [...pixels]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]);
      expect(media[0]!.content.alt).toBe('Four colour recovery marker');
    }
  };
  const assertContent = async (blocks: Block[], document: DocumentCase, report: any) => {
    expect(blocks.filter(block => block.blockType === 'heading').map(text)).toEqual(document.headings);
    expect(blocks.filter(block => block.blockType === 'heading').map(block => block.content.level)).toEqual(document.levels);
    expect(blocks.filter(block => block.blockType === 'table').map(table)).toEqual(document.tables);
    for (const paragraph of document.paragraphs ?? []) expect(blocks.filter(block => block.blockType === 'paragraph').map(text)).toContain(paragraph);
    if (document.media) await readMedia(blocks, document.media);
    if (document.format === 'html') {
      expect(report.unmapped.map((entry: {label: string}) => entry.label)).toEqual(['Removed unsafe HTML element <script>', 'Removed unsafe HTML element <form>', 'Removed unsafe link', 'Removed unsafe image source']);
      expect(report.warnings).toEqual([expect.objectContaining({label: 'Image was imported as a link because no archive file was present', detail: 'https://media.example.test/missing.png'})]);
      expect(blocks.find(block => block.blockType === 'link-card')?.content).toMatchObject({url: 'https://media.example.test/missing.png', previewState: 'refused'});
      expect(JSON.stringify(blocks)).not.toMatch(/unsafe-|javascript:|data:text|onclick/);
    }
    if (document.format === 'pdf') expect(report.unmapped).toContainEqual(expect.objectContaining({label: 'Companion.pdf'}));
  };

  // Only the public request boundary is invoked; any outbound fetch is a failure.
  const network = vi.fn(() => {throw new Error('Document import attempted an outbound request');});
  vi.stubGlobal('fetch', network);
  try {
    for (const document of documents()) {
      for (const mode of ['append', 'children'] as const) {
        const before = await ok(path), job = await stage(document, mode, before.page.revisionId);
        const result = await complete(job, document);
        expect(result.counts).toMatchObject({containers: 0, pages: mode === 'append' ? 0 : document.format === 'epub' ? 2 : 1, files: document.media ? 1 : 0});
        const after = await ok(path);
        if (mode === 'append') {
          // Append normalizes positions while retaining order, IDs, content and write tokens.
          const retained = (blocks: any[]) => blocks.map(({treePosition: _position, ...block}) => block);
          expect(retained(after.blocks.slice(0, before.blocks.length))).toEqual(retained(before.blocks));
          await assertContent(after.blocks.slice(before.blocks.length), document, result.report);
          expect(after.page.revisionId).not.toBe(before.page.revisionId);
        } else {
          expect(after).toEqual(before);
          const children = (await ok(`/pages?containerId=${containerId}`)).items.filter((item: any) => item.parentPageId === pageId);
          const sourcePages = result.report.created.filter((entry: any) => entry.kind === 'page');
          expect(sourcePages).toHaveLength(document.format === 'epub' ? 2 : 1);
          const blocks: Block[] = [];
          for (const source of sourcePages) {
            expect(children.map((item: any) => item.id)).toContain(source.targetId);
            const child = await ok(`/pages/${source.targetId}`);
            expect(child.properties.title).toBe(source.label);
            blocks.push(...child.blocks);
          }
          await assertContent(blocks, document, result.report);
        }
        const pages = (await ok(`/pages?containerId=${containerId}`)).items;
        expect((await ok(`/imports/${job.id}/run`, {})).state).toBe('completed');
        expect((await ok(path)).blocks).toEqual(after.blocks);
        expect((await ok(`/pages?containerId=${containerId}`)).items).toEqual(pages);
        console.info(`PROBE IMP-005 format=${document.format} mode=${mode}: native upload and run -> persisted headings, tables, media and report match; replay unchanged`);
      }
    }

    const csv = {format: 'csv' as const, name: 'synthetic-slate-7.csv', bytes: strToU8('Name,Count,Ready,Reference\nWidget,2,true,0012\nGadget,3,false,9007199254740993\n')};
    const beforeCsv = await ok(path), refusedCsv = await stage(csv, 'append', beforeCsv.page.revisionId);
    const refusal = await request(editorCookie, `/imports/${refusedCsv.id}/run`, {});
    expect(refusal.status).toBe(422);
    expect(await refusal.json()).toMatchObject({code: 'IMPORT_DATABASE_AS_CHILD'});
    expect(await ok(path)).toEqual(beforeCsv);
    const csvJob = await stage(csv, 'children', beforeCsv.page.revisionId), csvResult = await complete(csvJob, csv);
    expect(csvResult.counts).toMatchObject({containers: 0, databases: 1, records: 2, pages: 3});
    const databaseId = csvResult.report.created.find((entry: any) => entry.kind === 'database').targetId;
    const database = await ok(`/databases/${databaseId}`), databasePage = await ok(`/pages/${database.database.page_id}`);
    expect(databasePage.parentPageId).toBe(pageId);
    expect(database.fields.map((field: any) => [field.name, field.type])).toEqual([['Name', 'text'], ['Count', 'number'], ['Ready', 'checkbox'], ['Reference', 'text']]);
    const recordPages = (await ok(`/pages?containerId=${containerId}`)).items.filter((item: any) => item.pageKind === 'record');
    expect(recordPages).toHaveLength(2);
    const records = [];
    for (const record of recordPages) {
      expect(record.parentPageId).toBe(databasePage.page.id);
      const opened = await ok(`/databases/${databaseId}/records/${record.id}`);
      records.push(Object.fromEntries(opened.fields.map((field: any) => [field.name, opened.values[field.id]])));
      expect(opened.page.blocks.filter((block: Block) => block.blockType === 'table').map(table)).toEqual(record.title === 'Widget' ? [[['Name', 'Count', 'Ready', 'Reference'], ['Widget', '2', 'true', '0012']]] : [[['Name', 'Count', 'Ready', 'Reference'], ['Gadget', '3', 'false', '9007199254740993']]]);
    }
    expect(records).toEqual(expect.arrayContaining([{Name: 'Widget', Count: 2, Ready: true, Reference: '0012'}, {Name: 'Gadget', Count: 3, Ready: false, Reference: '9007199254740993'}]));
    expect(await ok(path)).toEqual(beforeCsv);
    console.info('PROBE IMP-005 CSV: append -> 422 unchanged; child import -> database schema, two records and tables read through native doors');

    // A supplied page set retains multiple hierarchy levels under the destination.
    const tree = {format: 'slate-readable' as const, name: 'synthetic-slate-tree.zip', bytes: zipSync({'slate-readable.json': strToU8(JSON.stringify({version: 1, pages: [
      {id: 'root', parentId: null, title: 'Imported root', labels: [], blocks: []},
      {id: 'child', parentId: 'root', title: 'Imported child', labels: [], blocks: []},
      {id: 'leaf', parentId: 'child', title: 'Imported leaf', labels: [], blocks: [{id: 'leaf-text', blockType: 'paragraph', content: {text: [{text: 'Leaf body'}]}, parentBlockId: null, treePosition: '0'}]},
    ], media: [], report: []}))})};
    const treeJob = await stage(tree, 'children', beforeCsv.page.revisionId);
    expect((await complete(treeJob, tree)).counts.pages).toBe(3);
    const pages = (await ok(`/pages?containerId=${containerId}`)).items;
    const root = pages.find((item: any) => item.title === 'Imported root'), child = pages.find((item: any) => item.title === 'Imported child'), leaf = pages.find((item: any) => item.title === 'Imported leaf');
    expect([root.parentPageId, child.parentPageId, leaf.parentPageId]).toEqual([pageId, root.id, child.id]);
    expect((await ok(`/pages/${leaf.id}`)).blocks.map(text)).toEqual(['Leaf body']);
    console.info('PROBE IMP-005 page set: native child import -> destination, root, child and populated leaf hierarchy retained');

    const unchanged = await ok(path), unchangedPages = (await ok(`/pages?containerId=${containerId}`)).items;
    const invalid = await upload({...documents()[0]!, format: 'unsupported' as ImportFormat}, 'append', unchanged.page.revisionId);
    expect(invalid.status).toBe(400);
    const oversized = await app.request('https://slate.example/api/imports/stream', {method: 'POST', headers: {Cookie: editorCookie, 'X-Import-Metadata': encodeURIComponent(JSON.stringify({operationKey: crypto.randomUUID(), format: 'text', name: 'synthetic-slate-large.txt', sizeBytes: 256 * 1024 * 1024 + 1, destination: {pageId, expectedRevisionId: unchanged.page.revisionId, mode: 'append'}}))}, body: 'bounded body'}, nativeEnv);
    expect(oversized.status).toBe(413);
    const malformed = {format: 'epub' as const, name: 'synthetic-slate-unsafe.epub', bytes: zipSync({'../escape.xhtml': strToU8('<p>Must not persist</p>')})};
    const malformedJob = await stage(malformed, 'children', unchanged.page.revisionId);
    const malformedRun = await request(editorCookie, `/imports/${malformedJob.id}/run`, {});
    expect(malformedRun.status).toBe(400);
    expect(await malformedRun.json()).toMatchObject({code: 'IMPORT_ARCHIVE_PATH_UNSAFE'});
    expect((await ok(`/imports/${malformedJob.id}`)).state).toBe('failed');
    expect(await ok(path)).toEqual(unchanged);
    expect((await ok(`/pages?containerId=${containerId}`)).items).toEqual(unchangedPages);
    for (const mode of ['append', 'children'] as const) {
      const stale = await stage(documents()[0]!, mode, initial.page.revisionId);
      const failed = await request(editorCookie, `/imports/${stale.id}/run`, {});
      expect(failed.status).toBe(409);
      expect(await failed.json()).toMatchObject({code: 'REVISION_CONFLICT'});
      expect(await ok(path)).toEqual(unchanged);
      expect((await ok(`/pages?containerId=${containerId}`)).items).toEqual(unchangedPages);
      const denied = await upload(documents()[0]!, mode, unchanged.page.revisionId, viewerCookie);
      expect(denied.status).toBe(404);
      expect(await ok(path)).toEqual(unchanged);
    }
    expect((await ok('/imports', undefined, undefined, viewerCookie)).jobs).toEqual([]);
    const revoked = await stage(documents()[0]!, 'append', unchanged.page.revisionId);
    expect((await request(viewerCookie, `/imports/${revoked.id}`)).status).toBe(404);
    expect((await request(viewerCookie, `/imports/${revoked.id}/original`)).status).toBe(404);
    await env.DB.prepare('UPDATE page_grants SET revoked_at=? WHERE id=?').bind(new Date().toISOString(), grant.grantId).run();
    expect((await request(editorCookie, `/imports/${revoked.id}/run`, {})).status).toBe(404);
    expect(await ok(path, undefined, undefined, ownerCookie)).toEqual({...unchanged, permissions: (await ok(path, undefined, undefined, ownerCookie)).permissions});
    expect((await ok(`/pages?containerId=${containerId}`, undefined, undefined, ownerCookie)).items.map((item: any) => item.id).sort()).toEqual(unchangedPages.map((item: any) => item.id).sort());
    expect((await request(editorCookie, '/auth/logout', {})).status).toBe(204);
    expect((await request(editorCookie, `/imports/${treeJob.id}/run`, {})).status).toBe(401);
    expect((await request(editorCookie, `/imports/${treeJob.id}/original`)).status).toBe(401);
    expect((await ok(path, undefined, undefined, ownerCookie)).blocks).toEqual(unchanged.blocks);
    expect(network).not.toHaveBeenCalled();
    console.info('PROBE IMP-005 safety: invalid format and unsafe archive -> 400; oversized stream -> 413; stale append and child runs -> 409 unchanged; view-only uploads and revoked editor run -> 404 unchanged; revoked-session replay -> 401; outbound fetches=0');
  } finally { vi.unstubAllGlobals(); }
}
