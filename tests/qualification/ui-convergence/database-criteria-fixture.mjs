import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {grant, ok} from './two-people-support.mjs';

/** Real records and computed dependencies, all written through native routes. */
export async function criteriaFixture({context, origin, api}) {
  const mutate = async (route, data, method = 'POST') =>
    (await ok(context, origin, method, route, {operationKey: randomUUID(), ...data})).value;
  const containerId = (await api('/api/containers')).items.find(item => item.name === 'Handbook').id;
  const source = await mutate('/api/databases', {containerId, title: 'Criteria dependency'});
  await mutate(`/api/databases/${source.id}/fields`, {expectedRevisionId: source.revisionId,
    field: {id: 'source-number', name: 'Source amount', type: 'number', config: {}, position: 0}});
  const target = await mutate(`/api/databases/${source.id}/records`, {title: 'Related record', values: {'source-number': 7}});
  await grant(context, origin, source.pageId, 'browser-reader', 'edit');
  const database = await mutate('/api/databases', {containerId, title: 'Saved criteria'});
  const base = `/api/databases/${database.id}`;
  const definitions = [
    ['notes', 'Notes', 'text'], ['quantity', 'Quantity', 'number'], ['checked', 'Checked', 'checkbox'],
    ['due', 'Due date', 'date'], ['choice', 'Choice', 'select', {options: ['Blue', 'Red']}],
    ['tags', 'Tags', 'multi-select', {options: ['Urgent', 'Later']}],
    ['stage', 'Stage', 'status', {options: ['Ready', 'Hold', 'Closed']}],
    ['person', 'Assignee', 'person'], ['file', 'Attachment', 'file'], ['url', 'Website', 'url'],
    ['email', 'Contact', 'email'], ['phone', 'Phone', 'phone'], ['place', 'Place', 'place'],
    ['relation', 'Related', 'relation', {databaseId: source.id}],
    ['rollup', 'Related amount', 'rollup', {relationField: 'relation', targetField: 'source-number', calculation: 'sum'}],
    ['formula', 'Double quantity', 'formula', {expression: {op: 'multiply', args: [{field: 'quantity'}, {literal: 2}]}}],
    ['created', 'Created', 'created-at'], ['updated', 'Updated', 'updated-at'], ['identifier', 'Identifier', 'identifier'],
  ];
  const fields = definitions.map(([id, name, type, config = {}], position) => ({id, name, type, config, position}));
  let revision = database.revisionId;
  for (const field of fields) revision = (await mutate(base + '/fields', {expectedRevisionId: revision, field})).revisionId;
  const common = {notes: 'Response plan', checked: true, tags: ['Urgent'], person: ['browser-owner'],
    url: 'https://example.test/response', email: ['synthetic-slate-1', 'test.invalid'].join('@'), phone: '555 0101',
    place: 'Brisbane', relation: [target.pageId]};
  const rows = [
    ['Alpha', 3, '2026-01-03', 'Ready', 'Blue'], ['Charlie', 3, '2026-01-01', 'Ready', 'Blue'],
    ['Bravo', 3, '2026-01-01', 'Ready', 'Blue'], ['Delta', 2, '2026-01-01', 'Hold', 'Red'],
    ['Excluded status', 4, '2026-01-01', 'Closed', 'Blue'], ['Excluded quantity', 1, '2026-01-01', 'Ready', 'Blue'],
    ['Private priority', 9, '2026-01-01', 'Ready', 'Blue'],
  ];
  const records = [];
  for (const [title, quantity, due, stage, choice] of rows)
    records.push({...await mutate(base + '/records', {title, values: {...common, quantity, due, stage, choice}}), title});
  const privateRecord = records.at(-1);
  await grant(context, origin, privateRecord.pageId, 'browser-owner', 'full');
  const privatePage = await api(`/api/pages/${privateRecord.pageId}`);
  await mutate(`/api/sharing/pages/${privateRecord.pageId}/inheritance`,
    {expectedRevisionId: privatePage.page.revisionId, restricted: true}, 'PUT');
  await grant(context, origin, database.pageId, 'browser-reader', 'edit');
  const view = {id: randomUUID(), name: 'Response criteria', layout: 'list', filters: [], sorts: [], groups: [],
    calculations: {}, display: {visibleFieldIds: ['quantity', 'due', 'stage']}, position: 0};
  revision = (await api(base)).database.revision_id;
  await mutate(base + '/views', {expectedRevisionId: revision, view});
  const criteria = fields.map(field => ({field: field.id, op: field.id === 'file' ? 'empty' : 'not-empty'}));
  Object.assign(criteria.find(rule => rule.field === 'quantity'), {op: 'gte', value: 2});
  Object.assign(criteria.find(rule => rule.field === 'formula'), {op: 'gt', value: 2});
  Object.assign(criteria.find(rule => rule.field === 'rollup'), {op: 'eq', value: 7});
  Object.assign(criteria.find(rule => rule.field === 'checked'), {op: 'eq', value: true});
  Object.assign(criteria.find(rule => rule.field === 'due'), {op: 'lte', value: '2026-01-03'});
  const nested = {or: [{field: 'stage', op: 'eq', value: 'Ready'}, {and: [
    {field: 'choice', op: 'eq', value: 'Red'}, {field: 'checked', op: 'eq', value: true},
  ]}]};
  const expected = {...view, filters: [...criteria, nested], sorts: [
    {field: 'quantity', direction: 'desc'}, {field: 'due', direction: 'asc'}, {field: '$title', direction: 'asc'},
  ]};
  const snapshot = async () => Promise.all(records.map(async record => {
    const opened = await api(base + '/records/' + record.pageId);
    return {pageId: record.pageId, revisionId: opened.revisionId, values: opened.values,
      page: opened.page.page, blocks: opened.page.blocks};
  }));
  assert.equal(records.length, 7);
  return {base, database, fields, criteria, nested, expected, records, snapshot};
}
