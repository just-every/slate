import type { FeatureContext } from './feature-context';
import type { InitialResources } from '../client/InitialResources';
import { ApiProblem } from './problems';
import { listTreePages } from '../features/pages/tree';
import { readPage } from '../features/pages/service';
import { openPage } from '../features/pages/open';
import { listDatabases } from '../features/databases/discovery';
import { readContainerHome } from '../features/containers/home';
import { readContainer } from '../features/containers/queries';
import { listContainers } from '../features/containers/service';
import { listMembers } from '../features/workspace/members';
import type { MemberView } from '../shared/api/workspace';
import { reviewCount, reviewQueue } from '../features/page-status/review';
import { listTemplates } from '../features/templates/service';
import { savedSearches } from '../features/search/saved';
import { notificationList } from '../features/notifications/service';
import { listComments } from '../features/comments/service';
import { listArchive } from '../features/archive/list';
import { publishingExposure } from '../features/publishing/exposure';
import { statusEntries } from '../features/page-status/entries';
import { readDatabase, readRecord } from '../features/databases/reads';
import { queryView } from '../features/databases/views';
import { pageAddress } from '../shared/knowledge/addresses';

/** Same authorized reads as the API, in parallel, scoped to one document. */
export async function initialResources(ctx: FeatureContext, url: URL, member: MemberView, recordVisit=false): Promise<InitialResources> {
  const resources: InitialResources = { '/api/members/current': member };
  const reads: Promise<void>[] = [];
  const add = (path: string, read: () => Promise<unknown>) => {
    reads.push(read().then(value => { resources[path] = value; }).catch(cause => {
      // Leave the ordinary resource error boundary in charge of denied reads.
      if (!(cause instanceof ApiProblem)) throw cause;
    }));
  };
  add('/api/pages', () => listTreePages(ctx));
  add('/api/databases', () => listDatabases(ctx));
  add('/api/containers', () => listContainers(ctx));
  add('/api/status/review/count', () => reviewCount(ctx));
  if (url.pathname === '/app/search') {
    add('/api/members', () => listMembers(ctx, 'member'));
    add('/api/status', () => statusEntries(ctx));
    add('/api/search/saved?updated=0', async () => ({ items: await savedSearches(ctx) }));
  } else if (url.pathname === '/app/containers' || url.pathname === '/app/containers/') {
    add('/api/containers?archived=false', () => listContainers(ctx, false));
  } else if (url.pathname === '/app/templates' || url.pathname === '/app/templates/') {
    add('/api/templates?state=active&query=&category=&containerId=', () => listTemplates(ctx, { state: 'active', query: '', category: '', containerId: '' }));
  } else if (url.pathname === '/app/inbox') {
    add('/api/notifications?audience=', () => notificationList(ctx, {}));
  } else if (url.pathname === '/app/review') {
    add('/api/status/review?filter=everyone', () => reviewQueue(ctx, { filter: 'everyone' }));
  } else if (url.pathname === '/app/archive') {
    add('/api/archive', () => listArchive(ctx));
  }
  // `visit` is the address that opened the page: that visit is recorded under the page id, as Recents' destination.
  const seedPage = async (id:string,visit:string|false=recordVisit&&pageAddress(id)) => {
    const pending:Promise<void>[]=[];
    const seed=(path:string,read:()=>Promise<unknown>)=>pending.push(read().then(value=>{resources[path]=value;}).catch(cause=>{if(!(cause instanceof ApiProblem))throw cause;}));
    seed(`/api/pages/${encodeURIComponent(id)}`,async()=>{
      const document=await readPage(ctx,id);
      if(visit) {
        const sessionId=crypto.randomUUID(),epoch=ctx.authorizationEpoch!;
        const opened=await openPage({...ctx},id,{operationKey:crypto.randomUUID(),revisionId:['edit','full'].includes(document.permissions.level)?document.workingRevisionId:document.publishedRevisionId??document.workingRevisionId},{document,authorizationEpoch:epoch,sessionId});
        resources[`/api/pages/${id}/opened`]={sessionId,revisionId:opened.value.revisionId,recent:{id:document.page.id,title:document.page.title,containerId:document.page.containerId,icon:document.properties.icon,openedAt:ctx.now,href:visit,...Object.fromEntries(['publishAt','scheduleState','scheduleFailure'].filter(key=>key in document.page).map(key=>[key,(document.page as unknown as Record<string,unknown>)[key]]))}};
        resources[`/api/collaboration/${id}?after=0`]=opened.collaboration;
      }
      return document;
    });
    seed('/api/status',()=>statusEntries(ctx));
    seed(`/api/comments/page/${id}`,()=>listComments(ctx,id));
    seed(`/api/publishing/${id}`,()=>publishingExposure(ctx,id));
    await Promise.all(pending);
  };
  // SL1: a database's address and a record's read what a page reads, plus the database, its chosen view and the record.
  const seedDatabase = async (id:string,recordId?:string) => {
    const path=`/api/databases/${encodeURIComponent(id)}`;
    let detail:Awaited<ReturnType<typeof readDatabase>>;
    try { detail=await readDatabase(ctx,id); } catch(cause) { if(cause instanceof ApiProblem)return; throw cause; }
    resources[path]=detail;
    const view=detail.views.find(item=>item.id===url.searchParams.get('view'))??detail.views[0];
    const pending=[seedPage(detail.database.page_id,recordVisit&&!recordId&&pageAddress(detail.database.page_id,{kind:'database',databaseId:id}))];
    if(view)pending.push(queryView(ctx,id,view.id).then(value=>{resources[`${path}/views/${encodeURIComponent(view.id)}`]=value;}).catch(cause=>{if(!(cause instanceof ApiProblem))throw cause;}));
    if(recordId)pending.push(readRecord(ctx,id,recordId).then(async record=>{
      resources[`${path}/records/${encodeURIComponent(recordId)}`]=record;
      // Under record-is-row a record is not a page, so its visit stays unrecorded.
      await seedPage(recordId,recordVisit&&record.parity==='record-is-page'&&pageAddress(recordId,{kind:'record',databaseId:id}));
    }).catch(cause=>{if(!(cause instanceof ApiProblem))throw cause;}));
    await Promise.all(pending);
    const opened=resources[`/api/pages/${recordId??detail.database.page_id}/opened`];
    if(opened)resources[`${url.pathname.replace('/app/','/api/')}/opened`]=opened;
  };
  const page=/^\/app\/pages\/([^/]+)$/.exec(url.pathname);
  const container=/^\/app\/containers\/([^/]+)$/.exec(url.pathname);
  const database=/^\/app\/databases\/([^/]+)(?:\/records\/([^/]+))?$/.exec(url.pathname);
  if(page)reads.push(seedPage(decodeURIComponent(page[1])));
  if(database)reads.push(seedDatabase(decodeURIComponent(database[1]),database[2]?decodeURIComponent(database[2]):undefined));
  if(container) {
    const id=decodeURIComponent(container[1]),path=`/api/containers/${encodeURIComponent(id)}`;
    add(path,()=>readContainer(ctx,id));
    add(`/api/pages?containerId=${encodeURIComponent(id)}`,()=>listTreePages(ctx,id));
    add(`${path}/home`,async()=>{
      const home=await readContainerHome(ctx,id);
      if(home.pageId) {
        await seedPage(home.pageId);
        if(resources[`/api/pages/${home.pageId}/opened`])resources[`${path}/opened`]=resources[`/api/pages/${home.pageId}/opened`];
      }
      return home;
    });
  }
  await Promise.all(reads);
  return resources;
}
