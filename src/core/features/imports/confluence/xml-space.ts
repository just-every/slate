import {xmlContent} from './xml-content';
import {entities, nameMatches, property, propertyId, propertyIds, type ConfluenceEntity} from './xml-entities';
import {xmlHistory} from './xml-history';
import {xmlMedia} from './xml-media';
import {xmlStorageBlocks} from './xml-storage';
import {xmlResourceContext} from './xml-resource-context';
import {historicalRestrictions, xmlRestrictions} from './xml-restrictions';
import {requireArchiveText} from '../archive';
import {ImportError} from '../errors';
import {createImportReport, reportCreated, reportUnmapped, reportWarning} from '../report';
import {parseXml} from '../xml';
import type {ImportSourceFile, ImportedBlock, ImportedPage, ImportedRevision, NormalizedImport} from '../types';

function pageLifecycle(entity: ConfluenceEntity): ImportedPage['lifecycle'] {
  const status = property(entity, 'contentStatus', 'status')?.toLowerCase();
  if (status === 'draft') return 'draft';
  if (status === 'archived') return 'archived';
  return 'live';
}

export function parseConfluenceXmlSpace(files: Map<string, Uint8Array>, source: Pick<ImportSourceFile, 'name'>): NormalizedImport {
  const entitiesPath = [...files.keys()].find(path => path.split('/').at(-1)?.toLowerCase() === 'entities.xml');
  if (!entitiesPath) throw new ImportError('IMPORT_FORMAT_INVALID', 'The Confluence archive has no entities.xml export.');
  const allEntities = entities(parseXml(requireArchiveText(files, entitiesPath), entitiesPath));
  const report = createImportReport();
  const content = xmlContent(allEntities, report);
  const spaces = allEntities.filter(entity => nameMatches(entity, 'Space'));
  if (!spaces.length) throw new ImportError('IMPORT_FORMAT_INVALID', 'The Confluence archive has no space entity.');
  const containers = spaces.map(space => {
    const sourceId = `confluence-space:${space.id}`;
    const name = property(space, 'name', 'key') ?? `Confluence space ${space.id}`;
    reportCreated(report, 'container', name, sourceId);
    return {sourceId, sourceIdentityKind: 'native' as const, name, key: property(space, 'key'), personal: false, labels: content.labels(space), grants: []};
  });
  const history = xmlHistory(allEntities, report);
  const restrictions = xmlRestrictions(allEntities, report);
  // The older standalone Version shape uses the same ownership and access path.
  for (const version of allEntities.filter(entity => nameMatches(entity, 'Version'))) {
    const contentIds = propertyIds(version, 'contentId', 'content', 'originalContent');
    const owner = contentIds.length ? history.aliases.get(contentIds[0]!) : undefined;
    if (!owner || contentIds.some(id => history.aliases.get(id) !== owner)) { reportUnmapped(report, 'Confluence version could not be associated with a page', `confluence-version:${version.id}`); continue; }
    const currentId = owner.slice('confluence-page:'.length);
    const previous = history.revisions.get(currentId) ?? [];
    previous.push(version); history.revisions.set(currentId, previous);
  }
  const media = xmlMedia(allEntities, files, history.aliases, report);
  const resolvePage = xmlResourceContext(allEntities, history.aliases, history.revisions);
  const blocksFor = (entity: ConfluenceEntity, sourceId: string, owner: string): ImportedBlock[] => xmlStorageBlocks(content.body(entity), sourceId, owner, media, history.aliases, resolvePage, report);
  const revisionFor = (entity: ConfluenceEntity, owner: string): ImportedRevision => {
    const sourceId = `${nameMatches(entity, 'Version') ? 'confluence-version' : 'confluence-page'}:${entity.id}`;
    const number = Number(property(entity, 'version', 'versionNumber'));
    const ordinal = Number.isSafeInteger(number) && number > 0 ? number : undefined;
    if (!ordinal && property(entity, 'version', 'versionNumber')) reportUnmapped(report, 'Confluence revision version number is invalid', sourceId);
    reportCreated(report, 'version', `Version ${ordinal ?? entity.id}`, sourceId);
    return {sourceId, sourceIdentityKind: 'native', ordinal, title: property(entity, 'title'), labels: content.labels(entity), label: property(entity, 'title'), status: property(entity, 'contentStatus', 'status'), comment: property(entity, 'versionComment', 'comment', 'message'), createdAt: property(entity, 'lastModificationDate', 'creationDate', 'created'), origin: pageLifecycle(entity)==='draft'?'autosave':'publish', blocks: nameMatches(entity,'Folder')?[]:blocksFor(entity, sourceId, owner)};
  };
  const pages: ImportedPage[] = history.pages.map(entity => {
    const isFolder = nameMatches(entity, 'Folder');
    const sourceId = history.aliases.get(entity.id)!;
    const title = property(entity, 'title', 'name') ?? `${isFolder ? 'Folder' : 'Page'} ${entity.id}`;
    const previous = history.revisions.get(entity.id) ?? [];
    const currentRevision = ['version','versionNumber','versionComment','comment','contentStatus','status'].some(name=>property(entity,name)!==undefined)
      ? revisionFor(entity,sourceId) : undefined;
    const parents = propertyIds(entity, 'parentId', 'parent');
    const parent = parents.length ? history.aliases.get(parents[0]!) : undefined;
    const invalidParent = parents.length > 0 && (!parent || parents.some(id => history.aliases.get(id) !== parent));
    if (invalidParent) reportUnmapped(report, 'Confluence parent reference could not resolve to a current page; access remains closed', sourceId, parents.map(id => `confluence-page:${id}`).join(', '));
    const page: ImportedPage = {
      sourceId, sourceIdentityKind: 'native', title,
      parentSourceId: invalidParent ? undefined : parent,
      containerSourceId: `confluence-space:${propertyId(entity, 'spaceId', 'space') ?? spaces[0]!.id}`,
      blocks: isFolder ? [] : blocksFor(entity, sourceId, sourceId), lifecycle: pageLifecycle(entity),
      labels: content.labels(entity), properties: {}, status: property(entity, 'contentStatus', 'status'),
      ...historicalRestrictions(entity, previous, restrictions, report),
      revisions: [...previous.map(revision => revisionFor(revision, sourceId)),...(currentRevision?[currentRevision]:[])],
      ...(currentRevision?{workingRevisionSourceId:currentRevision.sourceId,...(pageLifecycle(entity)==='draft'?{}:{publishedRevisionSourceId:currentRevision.sourceId})}:{}),
    };
    if (invalidParent) { page.restricted = true; page.grants = []; }
    if (isFolder) reportUnmapped(report, 'Confluence folder imported as an empty-body page', sourceId);
    reportCreated(report, 'page', title, sourceId); return page;
  });
  for (const page of pages) page.revisions.sort((a, b) => (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER) || a.sourceId.localeCompare(b.sourceId));
  for (const entity of allEntities) if (['Whiteboard', 'BlogPost', 'Calendar'].some(name => nameMatches(entity, name))) reportUnmapped(report, `Unsupported Confluence ${entity.className.split('.').at(-1)}`, `confluence:${entity.id}`);
  if (pages.some(page => page.restricted)) reportWarning(report, 'Restrictions remain closed unless explicitly mapped to existing workspace members or groups; the importing member retains recovery access');
  return {format: 'confluence-space', sourceName: source.name, containers, members: restrictions.members, pages, databases: [], records: [], media, report};
}
