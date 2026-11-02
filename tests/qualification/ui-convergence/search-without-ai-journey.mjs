import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import {ok,grant} from './two-people-support.mjs';
import {accessible} from './browser-evidence.mjs';

/** Native controls and HTTP over the same retained corpus in all four AI states. */
export async function searchWithoutAiJourney(state) {
 const {page,context,origin,api,switchIdentity,setSearchAiState,readSearchAiRequests,modelRequests,readerCookie}=state;
 const width=page.viewportSize().width,query='Solsticeneedle',corpus=[],timings=[],pending=new Set(),starts=new Map();
 // Earlier journey tabs retain presence timers. Unmount them before deliberate
 // fixture restarts, then restore their native URLs for their remaining checks.
 const suspended=[];
 for(const view of context.browser().contexts().flatMap(browserContext=>browserContext.pages())){
  if(view===page||!view.url().startsWith(origin))continue;
  await view.waitForLoadState('networkidle');
  const url=view.url();await view.goto('about:blank');suspended.push({view,url});
 }
 const mutate=(method,path,data)=>ok(context,origin,method,'/api'+path,{operationKey:crypto.randomUUID(),...data});
 const spaceResult=await mutate('POST','/containers',{name:query+' space',description:'Operations plans and retained team knowledge',visibility:'default'});
 const space=spaceResult.value.id;
 const row=(id,title,kind,stamp,extra={})=>{const item={id,title,kind,updatedAt:stamp,containerId:space,contributors:[],status:null,label:null,score:title===query?20:title.includes(query)?10:1,views:0,...extra};corpus.push(item);return item;};
 row(space,query+' space','container',spaceResult.receipt.committedAt,{containerId:space});
 row(spaceResult.value.homePageId,query+' space home','page',spaceResult.receipt.committedAt,{contributors:['browser-owner']});
 const create=async(title,text)=>{
  const result=await mutate('POST','/pages',{containerId:space,title,blocks:[{id:crypto.randomUUID(),blockType:'paragraph',treePosition:'a',content:{text:[{text}]}}]});
  return row(result.value.pageId,title,'page',result.receipt.committedAt,{contributors:['browser-owner']});
 };
 const exact=await create(query,'Incident captains retain escalation decisions, responsibility and recovery plans.');
 await mutate('POST','/status',{key:'isolation-ready',label:'Isolation ready',color:'#145a3d',requiresVerification:false});
 await mutate('POST','/status/page/'+exact.id,{expectedRevisionId:(await api('/api/pages/'+exact.id)).page.revisionId,statusKey:'isolation-ready'});
 const labeled=await mutate('PATCH','/pages/'+exact.id,{expectedRevisionId:(await api('/api/pages/'+exact.id)).page.revisionId,properties:{labels:['amber']}});
 Object.assign(exact,{updatedAt:labeled.receipt.committedAt,status:'isolation-ready',label:'amber'});
 await switchIdentity('reader');
 let body,comment;
 try {
  body=await create('Customer response rota',query+' support specialists document their distinct weekly rotation.');
  body.contributors=['browser-reader'];
  const response=await mutate('POST','/comments/page/'+exact.id,{body:[{text:query+' question about the retained escalation responsibility.'}]});
  comment=row(response.value.threadId,query,'comment-thread',response.receipt.committedAt,{contributors:['browser-owner','browser-reader'],status:'isolation-ready',label:'amber'});
  await mutate('POST','/analytics/views',{pageId:body.id});body.views=1;
 } finally {await switchIdentity('owner');}
 const archived=await create('Retired incident playbook',query+' historical investigation and audit procedure.');
 const trashed=await create('Abandoned migration proposal',query+' discarded storage migration planning.');
 for(const [item,action]of [[archived,'archive'],[trashed,'trash']]){
  const result=await mutate('POST','/archive/'+item.id,{expectedRevisionId:(await api('/api/pages/'+item.id)).page.revisionId,action});
  item.updatedAt=result.receipt.committedAt;item[action==='archive'?'archived':'trashed']=true;
 }
 const hidden=await create('Confidential '+query,query+' confidential forecast must not reach the reader.');corpus.pop();
 await grant(context,origin,hidden.id,'browser-owner','full');
 await mutate('PUT','/sharing/pages/'+hidden.id+'/inheritance',{expectedRevisionId:(await api('/api/pages/'+hidden.id)).page.revisionId,restricted:true});
 const database=(await mutate('POST','/databases',{containerId:space,title:'Incident inventory'})).value;
 const field={id:crypto.randomUUID(),name:'Details',type:'text',config:{},position:0};
 await mutate('POST','/databases/'+database.id+'/fields',{expectedRevisionId:database.revisionId,field});
 const record=await mutate('POST','/databases/'+database.id+'/records',{title:'Emergency equipment',values:{[field.id]:query+' retained equipment ledger'}});
 row(record.value.pageId,'Emergency equipment','record',record.receipt.committedAt,{contributors:['browser-owner']});
 const template=await mutate('POST','/templates',{sourcePageId:body.id,includeChildren:false,containerId:space,title:query+' template',description:'Reusable customer response notes',category:'General'});
 row(template.value.id,query+' template','template',template.receipt.committedAt);
 const expected=filters=>corpus.filter(item=>
  (!item.archived||filters.includeArchived==='true')&&(!item.trashed||filters.includeTrashed==='true')&&
  (!filters.kind||item.kind===filters.kind)&&(!filters.containerId||item.containerId===filters.containerId)&&
  (!filters.contributorId||item.contributors.includes(filters.contributorId))&&(!filters.status||item.status===filters.status)&&
  (!filters.label||item.label===filters.label)&&(!filters.updatedFrom||item.updatedAt>=new Date(filters.updatedFrom).toISOString())&&
  (!filters.updatedTo||item.updatedAt<=new Date(filters.updatedTo).toISOString())
 ).sort((a,b)=>(filters.sort==='views'?b.views-a.views:0)||(filters.sort==='updated'?b.updatedAt.localeCompare(a.updatedAt):0)||b.score-a.score||Number(!!a.archived)-Number(!!b.archived)||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
 const facets=items=>Object.fromEntries([['kind','kind'],['container','containerId'],['status','status']].map(([key,field])=>[key,Object.fromEntries([...new Set(items.map(item=>item[field]).filter(Boolean))].map(value=>[value,items.filter(item=>item[field]===value).length]))]));
 let aiState;
 const started=request=>{if(new URL(request.url()).pathname==='/api/search')starts.set(request,performance.now());};
 const received=response=>{
  if(!starts.has(response.request()))return;
  const startedAt=starts.get(response.request());starts.delete(response.request());
  const capture=response.text().then(text=>{const data=JSON.parse(text);timings.push({state:aiState,door:'browser',url:new URL(response.url()).search,status:response.status(),ms:performance.now()-startedAt,ids:data.items?.map(item=>item.id)});});
  pending.add(capture);capture.finally(()=>pending.delete(capture));
 };
 page.on('request',started);page.on('response',received);
 const raw=async filters=>{
  const startedAt=performance.now(),response=await fetch(origin+'/api/search?'+new URLSearchParams({q:query,...filters}),{headers:{cookie:readerCookie}}),text=await response.text();
  const ms=performance.now()-startedAt,data=JSON.parse(text),items=expected(filters);
  timings.push({state:aiState,door:'HTTP',filters,status:response.status,ms,ids:data.items?.map(item=>item.id)});
  assert.equal(response.status,200,text);assert.ok(ms<500,aiState+' native HTTP must finish below 500ms: '+ms);
  assert.deepEqual(data.items.map(item=>item.id),items.map(item=>item.id),aiState+' ranked IDs '+JSON.stringify(filters));
  assert.equal(data.total,items.length);assert.deepEqual(data.facets,facets(items));
  assert.equal(JSON.stringify(data).includes('confidential'),false);assert.equal(data.items.some(item=>item.id===hidden.id),false);
  assert.equal('answer' in data,false);return items;
 };
 const check=async filters=>{
  const items=await raw(filters);
  await expect.poll(()=>page.locator('.search-results h2').allTextContents()).toEqual(items.map(item=>(item.kind==='comment-thread'?'Comment on ':'')+item.title));
  await expect(page.locator('.control-count')).toHaveText(items.length+' result'+(items.length===1?'':'s'));
  await expect(page.getByRole('region',{name:'Retained answer',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Ask',exact:true})).toHaveCount(0);
  await expect(page.locator('.search-workspace [role=alert]')).toHaveCount(0);
  await Promise.all([...pending]);
 };
 const combined={kind:'page',containerId:space,contributorId:'browser-owner',status:'isolation-ready',label:'amber',updatedFrom:'2000-01-01',updatedTo:'2099-01-01',includeArchived:'true',includeTrashed:'true'};
 try {
  await switchIdentity('reader');
  for(aiState of ['unconfigured','disabled','failing','over-budget']){
   await setSearchAiState(aiState);
   // ADMIN-007's default-product boundary remains authoritative in every state.
   const refused=await context.request.get(origin+'/api/ai/availability');assert.equal(refused.status(),403);assert.equal((await refused.json()).code,'FEATURE_DISABLED');
   await page.goto(origin+'/app/search',{waitUntil:'networkidle'});
   await page.getByRole('searchbox',{name:'Search your workspace',exact:true}).fill(query);
   await page.getByRole('button',{name:'Search',exact:true}).click();await check({});
   await page.getByRole('button',{name:'Filter results',exact:true}).click();
   // Functional assertions run at desktop width; the phone captures the same
   // four states and an applied, retained combination through actual controls.
   if(width===1440){
    for(const [key,name,values]of [
     ['kind','Look in',['page','record','container','template','comment-thread','']],
     ['containerId','Space',[space,'']],['contributorId','Contributor',['browser-reader','browser-owner','']],
     ['status','Status',['isolation-ready','']],['sort','Sort results',['updated','views','']],
    ])for(const value of values){await page.getByRole('combobox',{name,exact:true}).selectOption(value);await check(value?{[key]:value}:{});}
    const label=page.getByLabel('Label',{exact:true});await label.fill('amber');await check({label:'amber'});await label.fill('');await check({});
    const from=page.getByLabel('Updated from',{exact:true}),to=page.getByLabel('Updated until',{exact:true});
    await from.fill('2099-01-01');await check({updatedFrom:'2099-01-01'});await from.fill('2000-01-01');await check({updatedFrom:'2000-01-01'});
    await to.fill('2000-01-01');await check({updatedFrom:'2000-01-01',updatedTo:'2000-01-01'});await to.fill('2099-01-01');await check({updatedFrom:'2000-01-01',updatedTo:'2099-01-01'});
    await from.fill('');await to.fill('');await check({});
    await page.getByRole('checkbox',{name:'Include archive',exact:true}).check();await check({includeArchived:'true'});
    await page.getByRole('checkbox',{name:'Include trash',exact:true}).check();await check({includeArchived:'true',includeTrashed:'true'});
    await page.getByRole('checkbox',{name:'Include archive',exact:true}).uncheck();await check({includeTrashed:'true'});
   }
   // Change controls sequentially: independent native requests must never race
   // on the React snapshot of another control's current value.
   for(const [key,name]of Object.entries({kind:'Look in',containerId:'Space',contributorId:'Contributor',status:'Status'}))await page.getByRole('combobox',{name,exact:true}).selectOption(combined[key]);
   await page.getByLabel('Label',{exact:true}).fill('amber');await page.getByLabel('Updated from',{exact:true}).fill(combined.updatedFrom);await page.getByLabel('Updated until',{exact:true}).fill(combined.updatedTo);
   await page.getByRole('checkbox',{name:'Include archive',exact:true}).check();await page.getByRole('checkbox',{name:'Include trash',exact:true}).check();await check(combined);
   await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle'});await check(combined);
   await accessible(page,'search without AI '+aiState);
   assert.deepEqual(await readSearchAiRequests(),[],'Ranked search never calls the failing provider edge.');assert.deepEqual(modelRequests,[],'No browser model submission.');
   assert.ok(timings.filter(item=>item.state===aiState).every(item=>item.status===200&&item.ms<500),JSON.stringify(timings.filter(item=>item.state===aiState&&!(item.status===200&&item.ms<500))));
  }
 } finally {
  await Promise.allSettled([...pending]);page.off('request',started);page.off('response',received);
  await mkdir('.artifacts/ui-convergence/search-without-ai',{recursive:true});
  await writeFile('.artifacts/ui-convergence/search-without-ai/'+width+'.json',JSON.stringify({candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),width,query,corpus,timings,providerRequests:await readSearchAiRequests(),modelRequests},null,2));
  await setSearchAiState('unconfigured');await switchIdentity('owner');
  for(const {view,url}of suspended)await view.goto(url,{waitUntil:'networkidle'});
 }
}
