import {env} from 'cloudflare:test';
import {expect} from 'vitest';
import {createApi} from '../../../src/core/app/hono';
import type {searchFixture} from './route-fixture';
import seed from '../../../seed.json';
import {freshnessJourney} from './freshness-journey';
import {mixedKindsJourney} from './mixed-kinds-journey';

/** One public HTTP search journey, shared with the existing authority corpus. */
export async function discoveryJourney(f:Awaited<ReturnType<typeof searchFixture>>) {
 const {sql,page,find,now}=f,api=createApi();
 const request=async(path:string,actor='owner',body?:unknown)=>{
  const r=await api.fetch(new Request('http://localhost:8787/api'+path,{method:body?'POST':'GET',headers:{cookie:f.cookies[actor]!,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{...env,SLATE_PROFILE:undefined});
  return {status:r.status,data:await r.json<any>()};
 };
 const corpus=[
  {id:'discovery-a',title:'Discovery launch guide',body:'Knowledgealpha exact phrase for our company launch.',label:'launch',by:'owner',owner:'owner',status:'review',private:false},
  {id:'discovery-b',title:'Discovery support handbook',body:'Knowledgebeta incident instructions for customer care.',label:'support',by:'reader',owner:'reader',status:'approved',private:false},
  {id:'discovery-private',title:'Discovery confidential plan',body:'Knowledgealpha exact phrase restricted business forecast.',label:'launch',by:'owner',owner:'owner',status:'review',private:true},
 ];
 for(const d of corpus) {
  await page(d.id,d.body,{title:d.title,status:d.status,restricted:d.private});
  const props={title:d.title,icon:null,coverFileId:null,ownerMemberId:d.owner,statusKey:d.status,labels:[d.label],typeface:'sans',smallText:false,fullWidth:false};
  await sql('INSERT INTO page_labels(page_id,label,created_at) VALUES(?,?,?)',d.id,d.label,now);
  await sql('INSERT INTO page_contributors VALUES(?,?,?)',d.id,d.by,now);
  await sql("INSERT INTO page_revisions(id,page_id,author_member_id,origin,content_hash,body_json,properties_json,created_at) VALUES(?,?,'owner','autosave','h',?,?,?)",'r-'+d.id,d.id,JSON.stringify([{id:'b-'+d.id,blockType:'paragraph',treePosition:'a',revisionId:'r',content:{text:d.body}}]),JSON.stringify(props),now);
  await sql('UPDATE pages SET owner_member_id=?,working_revision_id=?,published_revision_id=? WHERE id=?',d.owner,'r-'+d.id,'r-'+d.id,d.id);
 }
 await sql("INSERT INTO page_grants(id,page_id,principal_kind,principal_id,level,created_at,updated_at) VALUES('discovery-private-grant','discovery-private','member','denied','view',?,?)",now,now);
 const checks:[string,string[]][]=[
  ['title:launch',['discovery-a']],['label:launch',['discovery-a']],['in:Collection',['discovery-a','discovery-b']],
  ['by:reader',['discovery-b']],['owner:reader',['discovery-b']],['status:review',['discovery-a']],
  ['verified:unverified',['discovery-a','discovery-b']],['before:2099-01-01',['discovery-a','discovery-b']],
  ['after:2000-01-01',['discovery-a','discovery-b']],['type:page',['discovery-a','discovery-b']],
  ['"exact phrase"',['discovery-a']],['label:launch AND title:guide',['discovery-a']],
  ['label:launch OR by:reader',['discovery-a','discovery-b']],['-label:support',['discovery-a']],
  ['(literal)',[]],
 ];
 for(const actor of ['reader','denied'])for(const [query,readable]of checks) {
  const r=await find('title:Discovery AND '+query,actor);
  expect(r.status,query).toBe(200);
  const expected=actor==='reader'?readable:query==='(literal)'||query==='title:launch'||query==='by:reader'||query==='owner:reader'||query==='label:launch AND title:guide'?[]:['discovery-private'];
  expect(r.data.items.map((x:any)=>x.id).sort(),actor+': '+query).toEqual([...expected].sort());
 }
 const filtered=await find('title:Discovery','reader',{label:'launch',sort:'updated'});expect(filtered.data.items.map((x:any)=>x.id)).toEqual(['discovery-a']);
 for(const [filters,expected]of [
  [{kind:'page'},['discovery-a','discovery-b']], [{kind:'record'},[]],
  [{containerId:'c'},['discovery-a','discovery-b']], [{containerId:'absent-container'},[]],
  [{contributorId:'reader'},['discovery-b']], [{contributorId:'denied'},[]],
  [{status:'review'},['discovery-a']], [{status:'approved'},['discovery-b']],
  [{updatedFrom:'2000-01-01',updatedTo:'2099-01-01'},['discovery-a','discovery-b']],
  [{updatedFrom:'2099-01-01'},[]], [{updatedTo:'2000-01-01'},[]],
 ] as [Record<string,string>,string[]][]) {
  const result=await find('title:Discovery','reader',filters);expect(result.status).toBe(200);
  expect(result.data.items.map((item:any)=>item.id).sort()).toEqual(expected);
  expect(result.data.filters.query).toBe('title:Discovery');
  for(const [key,value]of Object.entries(filters))expect(String(result.data.filters[key])).toBe(key.startsWith('updated')?new Date(value).toISOString():value);
 }
 expect((await find('title:Discovery AND "phrase exact"')).data.total).toBe(0);
 expect((await request('/pages?containerId=c&label=launch','reader')).data.items.map((x:any)=>x.id)).toEqual(['discovery-a']);
 const saved=await request('/search/saved','owner',{operationKey:'save-discovery',name:'Launch knowledge',query:{query:'title:Discovery label:launch'}});expect(saved.status).toBe(200);
 const criteria=saved.data.value.query;
 for(const [actor,ids]of [['reader',['discovery-a']],['denied',['discovery-private']]]as const) {
  const target=actor==='reader'?'discovery-a':'discovery-private';
  const embedded=await request('/pages/'+target+'/query',actor,{search:criteria,limit:20});expect(embedded.status,JSON.stringify(embedded.data)).toBe(200);
  expect(embedded.data.items.map((x:any)=>x.id)).toEqual(ids);
 }
 const card=await request('/pages/discovery-a/link-card','reader');expect(card.status).toBe(200);expect(card.data).toMatchObject({title:'Discovery launch guide',trust:{state:'unverified',owner:{id:'owner'}}});
 const hiddenCard=await request('/pages/discovery-private/link-card','reader');expect(hiddenCard.status).toBe(404);expect(JSON.stringify(hiddenCard.data)).not.toContain('confidential');
 const historical=await request('/pages/discovery-a/link-card?revision=r-discovery-a','reader');expect(historical.status).toBe(200);expect(historical.data.title).toBe('Discovery launch guide');
 await sql("INSERT INTO page_revisions(id,page_id,author_member_id,origin,content_hash,body_json,properties_json,created_at) VALUES('discovery-unpublished','discovery-a','owner','autosave','new','[]',?,?)",JSON.stringify({title:'Unpublished private guidance',ownerMemberId:'reader',statusKey:'approved',labels:['internal-only'],icon:null,coverFileId:null,typeface:'default',smallText:false,fullWidth:false}),now);
 await sql("UPDATE pages SET working_revision_id='discovery-unpublished',revision_id='discovery-unpublished',lifecycle='live-with-unpublished-changes',status_key='approved',title='Unpublished private guidance',owner_member_id='reader' WHERE id='discovery-a'");
 const projectedCard=await request('/pages/discovery-a/link-card','reader');expect(projectedCard.status).toBe(200);expect(projectedCard.data.title).toBe('Discovery launch guide');expect(projectedCard.data.trust.owner.id).toBe('owner');
 expect((await request('/pages/discovery-a/link-card?revision=discovery-unpublished','reader')).status).toBe(404);
 const projectedQuery=await request('/pages/discovery-b/query','reader',{label:'launch',status:'review'});expect(projectedQuery.status,JSON.stringify(projectedQuery.data)).toBe(200);expect(projectedQuery.data.items.map((x:any)=>x.id)).toEqual(['discovery-a']);
 expect((await find('title:Discovery label:launch','reader')).data.items.map((x:any)=>x.id)).toEqual(['discovery-a']);
 // Equally relevant pages have distinct bodies, so ranking and badges are independent of grouping.
 for(const [id,body]of [['trust-verified','Trustneedle polished documented procedure accepted'],['trust-lapsed','Trustneedle superseded incident historical timeline'],['trust-unverified','Trustneedle tentative research proposal exploration']])await page(id,body!,{title:id,status:'review'});
 for(const id of ['trust-verified','trust-lapsed','trust-unverified']) {
  await sql("INSERT INTO page_revisions(id,page_id,author_member_id,origin,content_hash,body_json,properties_json,created_at) VALUES(?,?,'owner','autosave','h','[]',?,?)",'r-'+id,id,JSON.stringify({title:id,statusKey:'review',labels:[]}),now);
  await sql('UPDATE pages SET working_revision_id=?,published_revision_id=? WHERE id=?','r-'+id,'r-'+id,id);
 }
 for(const [id,expiry]of [['trust-verified','2099-01-01T00:00:00.000Z'],['trust-lapsed','2000-01-01T00:00:00.000Z']])await sql("INSERT INTO page_verifications(id,page_id,status_key,revision_id,owner_member_id,verified_by_member_id,expires_at,created_at) VALUES(?,?,'review',?,'owner','owner',?,?)",id,id,'r-'+id,expiry,now);
 const ranked=await find('Trustneedle');expect(ranked.status).toBe(200);
 expect(ranked.data.items.map((x:any)=>[x.id,x.trust.state,x.trust.owner?.displayName??null])).toEqual([['trust-verified','verified','owner'],['trust-unverified','unverified',null],['trust-lapsed','lapsed','owner']].map(([id,state,owner])=>[id,state,owner]));
 const base=Array.from({length:100},(_,i)=>'word'+i);
 const near=[...base];for(let i=0;i<8;i++)near[i]='near'+i;
 const further=[...base];for(let i=0;i<17;i++)further[i]='far'+i;
 // 96 base shingles; prefix replacements produce exact Jaccard 88/104 and 79/113.
 const shingles=(words:string[])=>new Set(words.slice(4).map((_,i)=>words.slice(i,i+5).join(' ')));
 const similarity=(left:string[],right:string[])=>{const a=shingles(left),b=shingles(right);return [...a].filter(x=>b.has(x)).length/new Set([...a,...b]).size;};
 expect(similarity(base,near)).toBeCloseTo(88/104);expect(similarity(base,further)).toBeCloseTo(79/113);
 for(const [id,words]of [['duplicate-base',base],['duplicate-near',near],['duplicate-further',further]]as const)await page(id,words.join(' '),{title:'Duplicatecorpus '+id});
 const grouped=await find('Duplicatecorpus');expect(grouped.status).toBe(200);expect(grouped.data.total).toBe(2);expect(grouped.data.items.flatMap((x:any)=>x.similarPages??[])).toHaveLength(1);
 const threshold=seed.limits.nearDuplicateSimilarity;
 try{seed.limits.nearDuplicateSimilarity=.65;const lowered=await find('Duplicatecorpus');expect(lowered.data.total).toBe(1);expect(lowered.data.items[0].similarPages).toHaveLength(2);}finally{seed.limits.nearDuplicateSimilarity=threshold;}
 await sql("UPDATE page_grants SET revoked_at=? WHERE id='discovery-private-grant'",now);
 expect((await find('title:Discovery','denied')).data.total).toBe(0);
 await freshnessJourney(f);
 await mixedKindsJourney(f);
}
