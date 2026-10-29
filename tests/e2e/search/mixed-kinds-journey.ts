import {expect} from 'vitest';
import type {searchFixture} from './route-fixture';

/** All retained kinds share one HTTP query, ranking and live-authority cursor. */
export async function mixedKindsJourney(f:Awaited<ReturnType<typeof searchFixture>>) {
 const {sql,page,find,mutate}=f;
 const now='2026-01-15T12:00:00.000Z',query='Spectrumneedle';
 const expected:{id:string;kind:string;score:number;updatedAt:string;containerId:string}[]=[];
 await page('spectrum-database','Database schema');
 await sql("INSERT INTO databases(id,page_id,workspace_id,created_at,updated_at,revision_id) VALUES('spectrum-db','spectrum-database','w',?,?,'r')",now,now);
 await sql("INSERT INTO database_fields(id,database_id,name,field_type,config_json,position,created_at,updated_at,revision_id) VALUES('spectrum-field','spectrum-db','Details','text','{}',0,?,?,'r')",now,now);
 for(const kind of ['page','record','container','comment-thread','template'])for(const score of [20,10,1]) {
  const id=`spectrum-${kind}-${score}`,title=score===20?query:score===10?query+' heading':kind+' unrelated heading';
  const marker=`Retained${kind.replace('-','')}marker${score}End`;
  const text=`${score===1?query+' ':''}${marker} distinct ${id} content`;
  const updatedAt=score===10?'2026-01-16T12:00:00.000Z':now;
  const containerId=kind==='container'?id:kind==='template'&&score===1?'spectrum-container-1':'c';
  expected.push({id,kind,score,updatedAt,containerId});
  if(kind==='container') {
   await sql("INSERT INTO containers(id,workspace_id,name,description,created_at,updated_at,revision_id) VALUES(?,'w',?,?,?,?, 'r')",id,title,text,now,updatedAt);
   await sql("INSERT INTO container_owners VALUES(?,'owner',?)",id,now);
   for(const actor of ['owner','reader'])await sql("INSERT INTO container_grants(id,container_id,principal_kind,principal_id,level,created_at,updated_at) VALUES(?,?,'member',?,?,?,?)",id+'-'+actor,id,actor,actor==='owner'?'full':'view',now,now);
  } else if(kind==='template') {
   await sql("INSERT INTO knowledge_templates(id,workspace_id,container_id,title,description,category,snapshot_json,created_at,updated_at,revision_id) VALUES(?,'w',?,?,'Template description marker','General',?,?,?,'r')",id,containerId,title,JSON.stringify({blocks:[{content:{text:[{text}]}}]}),now,updatedAt);
  } else if(kind==='comment-thread') {
   const parent=id+'-page';await page(parent,'Nonmatching discussion page',{title});
   // A comment uses its page's title. Only the thread is in the mixed corpus;
   // the parent is kept out of the title match with a separate query below.
   await sql("UPDATE pages SET title='Discussion parent' WHERE id=?",parent);
   await sql("INSERT INTO comment_threads(id,workspace_id,page_id,kind,created_at,updated_at,revision_id) VALUES(?,'w',?,'page',?,?,'r')",id,parent,now,updatedAt);
   await sql("INSERT INTO comments(id,thread_id,author_member_id,body_json,created_at,updated_at,revision_id) VALUES(?,?,'owner',?,?,?,'r')",id+'-comment',id,JSON.stringify([{text:query+' '},{text:marker+' retained comment'}]),now,updatedAt);
   // Thread titles are inherited; all threads deliberately rank on comment text.
   expected.at(-1)!.score=1;
  } else {
   await page(id,kind==='record'?'Unrelated record body':text,{title,kind});
   await sql('UPDATE pages SET updated_at=? WHERE id=?',updatedAt,id);
   if(kind==='record')await sql("INSERT INTO database_records(page_id,database_id,field_values_json,created_at,updated_at,revision_id) VALUES(?,'spectrum-db',?,?,?,'r')",id,JSON.stringify({'spectrum-field':text}),now,updatedAt);
  }
  const single=await find(marker);
  expect(single.status,kind+' retained text').toBe(200);
  expect(single.data.items.map((item:any)=>[item.id,item.kind])).toEqual([[id,kind]]);
  if(kind==='comment-thread') {
   const spans=await find(`"${query} ${marker} retained comment"`);
   expect(spans.status).toBe(200);expect(spans.data.items.map((item:any)=>item.id)).toEqual([id]);
  }
 }
 // Isolate title, description and template body matches from all other content.
 for(const [term,ids]of [
  ['"Spectrumneedle heading"',['spectrum-container-10','spectrum-page-10','spectrum-record-10','spectrum-template-10']],
  ['"Template description marker"',['spectrum-template-1','spectrum-template-10','spectrum-template-20']],
 ] as [string,string[]][]) {
  const result=await find(term);expect(result.status).toBe(200);
  expect(result.data.items.map((item:any)=>item.id).sort()).toEqual(ids);
 }
 expected.sort((a,b)=>b.score-a.score||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
 const facets=(rows:typeof expected)=>({kind:Object.fromEntries([...new Set(rows.map(r=>r.kind))].map(kind=>[kind,rows.filter(r=>r.kind===kind).length])),container:Object.fromEntries([...new Set(rows.map(r=>r.containerId))].map(id=>[id,rows.filter(r=>r.containerId===id).length])),status:{}});
 const first=await find(query,'reader',{limit:'4'});
 expect(first.status).toBe(200);expect(first.data.total).toBe(15);expect(first.data.facets).toEqual(facets(expected));
 expect(first.data.items.map((r:any)=>[r.id,r.score])).toEqual(expected.slice(0,4).map(r=>[r.id,r.score]));
 expect(first.data.nextCursor).toBeTruthy();
 const late=await mutate('/pages',{operationKey:'spectrum-late-arrival',containerId:'c',title:query});
 expect(late.status).toBe(200);
 // Remove a future page, record, thread and container after the first page.
 // These use the native authority door; the snapshot must not preserve access.
 const removed=['spectrum-page-1','spectrum-record-1','spectrum-comment-thread-1','spectrum-container-1','spectrum-template-1'];
 for(const id of removed) {
  if(id.includes('template'))continue;
  const targetId=id.startsWith('spectrum-comment')?id+'-page':id;
  if(id.includes('container')) {
   const grant=await mutate('/sharing',{operationKey:'spectrum-revoke-'+id,targetKind:'container',targetId,id:id+'-reader',principalKind:'member',principalId:'reader',level:'view',revoke:true});
   expect(grant.status,JSON.stringify(grant.data)).toBe(200);
  } else {
   const restricted=await mutate('/sharing/pages/'+targetId+'/inheritance',{operationKey:'spectrum-restrict-'+id,expectedRevisionId:'r',restricted:true},'PUT');
   expect(restricted.status,JSON.stringify(restricted.data)).toBe(200);
  }
 }
 const retained=expected.filter(row=>!removed.includes(row.id)),observed=first.data.items.map((r:any)=>[r.id,r.score]);
 let cursor=first.data.nextCursor,pages=1;
 while(cursor) {
  expect(pages++).toBeLessThan(10);
  const next=await find(query,'reader',{limit:'4',cursor});expect(next.status,JSON.stringify(next.data)).toBe(200);
  expect(next.data.total).toBe(retained.length);expect(next.data.facets).toEqual(facets(retained));
  expect(JSON.stringify(next.data.items)).not.toContain(late.data.value.pageId);
  observed.push(...next.data.items.map((r:any)=>[r.id,r.score]));cursor=next.data.nextCursor;
 }
 expect(observed).toEqual(retained.map(r=>[r.id,r.score]));
 expect(new Set(observed.map(([id]:string[])=>id)).size).toBe(observed.length);
 const fresh=await find(query);expect(fresh.data.total).toBe(retained.length+1);
 expect(fresh.data.items.some((r:any)=>r.id===late.data.value.pageId)).toBe(true);
 const denied=await find(query,'denied');expect(denied.status).toBe(200);expect(denied.data.total).toBe(0);expect(denied.data.items).toEqual([]);expect(denied.data.facets).toEqual({kind:{},container:{},status:{}});
 // Deleted comment content is not retained search content, even under a cursor.
 await sql('UPDATE comments SET deleted_at=? WHERE id=?',now,'spectrum-comment-thread-10-comment');
 expect((await find('Retainedcommentthreadmarker10End')).data.total).toBe(0);
}
