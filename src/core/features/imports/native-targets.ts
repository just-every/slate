import {derivedPageReferences,derivedContainerReferences,nativeReferenceCatalog,nativeIncomingChecks,incomingDependencies,shareNotice,type IncomingCheck} from './native-dependencies';
import type {D1TargetAdapter,D1Database,D1Sql,TargetRow,D1UndoEffect,D1UndoSnapshot,Json} from '../../../../modules/import-kit/src/d1/index.ts';
import {expectedNativeScope,type NativeUnit,type NativeScope} from './native-plan';
import {nativeWrites,nativeIdentifier as identifier} from './native-writes';
import {nativePlanCodec} from './native-plan-codec';

const sql=(sql:string,...params:unknown[]):D1Sql=>({sql,params});
export interface NativeImportBinding {id:string; created_at:string; native_published:number}

// A member's share of an imported page or container is access to it, not an
// edit of it: only the import's own grants are compared, and Undo removes the
// rest with the page or container. A pending invitation still keeps it
// (invitations.page_id, invitations.container_id).
const grantTables=new Set(['container_grants','page_grants']);
const ownedScopeIds=(unit:NativeUnit,table:string)=>JSON.stringify(unit.rows.filter(row=>row.table===table).map(row=>row.values.id));
function scopeQuery(unit:NativeUnit,scope:NativeScope,job:NativeImportBinding):D1Sql {
  const columns=scope.columns.map(column=>{
    let expression=identifier(column);
    if(!job.native_published&&((scope.table==='pages'&&column==='deleted_at')||(scope.table==='containers'&&column==='trashed_at')))expression=`CASE WHEN ${expression}=${JSON.stringify(job.created_at).replaceAll("'","''").replace(/^"|"$/g,"'")} THEN NULL ELSE ${expression} END`;
    return `'${column}',${expression}`;
  }).join(',');
  // Mapping ownership is aggregated per imported unit; older retained ID
  // scopes continue to use their original exact identity comparison.
  const owned=grantTables.has(scope.table)||(scope.table==='federation_import_mappings'&&scope.column==='import_job_id');
  return sql(`SELECT COALESCE(json_group_array(json(value)),'[]') FROM (SELECT json_object(${columns}) AS value FROM ${identifier(scope.table)} WHERE ${identifier(scope.column)}=?${owned?' AND id IN (SELECT value FROM json_each(?))':''} ORDER BY value COLLATE BINARY)`,scope.id,...owned?[ownedScopeIds(unit,scope.table)]:[]);
}
function projection(unit:NativeUnit,job:NativeImportBinding):D1Sql {
  const queries=unit.scopes.map(scope=>scopeQuery(unit,scope,job));
  return sql(`SELECT ${queries.map((q,i)=>`(${q.sql}) AS s${i}`).join(',')}`,...queries.flatMap(q=>q.params??[]));
}
/** The ownership marker is compared with the complete retained value below.
 * Derive its expected projections inside that same predicate so large page
 * bodies are not transmitted a second time as a duplicate snapshot binding. */
function retainedScope(scope:NativeScope,index:number):string {
  const columns=scope.columns.map(column=>{identifier(column);return `'${column}',json_extract(r.value,'$.values.${column}')`;}).join(',');
  identifier(scope.table);identifier(scope.column);
  return `SELECT COALESCE(json_group_array(json(value)),'[]') FROM (SELECT json_object(${columns}) AS value FROM json_each(t.value_json,'$.unit.rows') r WHERE json_extract(r.value,'$.table')='${scope.table}' AND json_extract(r.value,'$.values.${scope.column}')=json_extract(t.value_json,'$.unit.scopes[${index}].id') ORDER BY value COLLATE BINARY)`;
}
function valueUnit(row:TargetRow):NativeUnit {return (row.value as unknown as {unit:NativeUnit}).unit;}
const rootTable=(kind:string)=>({page:'pages',container:'containers',member:'members',group:'groups',media:'files'})[kind as 'page'|'container'|'member'|'group'|'media']!;
const relationshipKey=(table:string)=>table==='database_records'||table==='content_schedules'?'page_id':'id';
const relationshipIdentity=(table:string,id:string)=>JSON.stringify([table,id]);

/** Each logical Kit effect is a complete native page (including revisions,
 * attachments and grants), container, or historical principal. */
export function nativeTargets(job:NativeImportBinding,writes:()=>number):D1TargetAdapter {
  let references:ReturnType<typeof nativeReferenceCatalog>|undefined;
  // Within one request the Kit reads every target for its conflict snapshot and
  // again for staging, with no write between. A read is reused until this
  // request writes; concurrent writers are fenced by the native epoch guard.
  const reads=new Map<string,{writes:number;row:Promise<TargetRow|undefined>}>();
  let epoch:{writes:number;revision:Promise<number>}|undefined;
  const readTarget=async(db:D1Database,destination:string,kind:string,id:string):Promise<TargetRow|undefined>=>{
    const saved=await db.prepare('SELECT value_json,revision FROM import_native_targets WHERE import_id=? AND kind=? AND target_id=?').bind(destination,kind,id).first<{value_json:string;revision:string}>();
    if(!saved)return undefined;
    const value=JSON.parse(saved.value_json),unit=value.unit as NativeUnit,q=projection(unit,job);
    const observed=await db.prepare(q.sql).bind(...q.params??[]).first<Record<string,string>>();
    const current=unit.scopes.map((_,i)=>observed![`s${i}`]!);
    if(current.some((v,i)=>v!==expectedNativeScope(unit,unit.scopes[i]!)))value.observed=current;
    return {destination,targetKind:kind,targetId:id,value,revision:saved.revision};
  };
  const adapter:D1TargetAdapter={
    planCodec:nativePlanCodec,
    async read(db,destination,kind,id) {
      const key=`${kind}\u0000${id}`,cached=reads.get(key);
      if(cached?.writes===writes())return structuredClone(await cached.row);
      const row=readTarget(db,destination,kind,id);reads.set(key,{writes:writes(),row});
      return structuredClone(await row);
    },
    matches(row,destination,kind,id) {
      if(!row)return sql(`NOT EXISTS(SELECT 1 FROM import_native_targets WHERE import_id=? AND kind=? AND target_id=?) AND NOT EXISTS(SELECT 1 FROM ${identifier(rootTable(kind))} WHERE id=?)`,destination,kind,id,id);
      const unit=valueUnit(row),observed=(row.value as unknown as {observed?:string[]}).observed;
      const queries=unit.scopes.map(scope=>scopeQuery(unit,scope,job));
      const value={...(row.value as object)} as Record<string,unknown>;delete value.observed;
      // One aggregate comparison avoids SQLite's expression-depth limit and
      // binds each scope identity once. Concatenation removes JSON subtypes so
      // both sides contain the exact serialized per-table snapshots.
      const expected=observed?'?':`json_array(${unit.scopes.map((scope,index)=>`((${retainedScope(scope,index)}) || '')`).join(',')})`;
      return sql(`EXISTS(SELECT 1 FROM import_native_targets t WHERE t.import_id=? AND t.kind=? AND t.target_id=? AND t.value_json=? AND t.revision=? AND json_array(${queries.map(q=>`((${q.sql}) || '')`).join(',')})=${expected})`,destination,kind,id,JSON.stringify(value),row.revision,...queries.flatMap(q=>q.params??[]),...observed?[JSON.stringify(observed)]:[]);
    },
    write(row) {
      const unit=valueUnit(row),statements=nativeWrites(unit.rows,job.native_published?undefined:job.created_at);
      statements.push(sql('INSERT INTO import_native_targets(import_id,kind,target_id,value_json,revision) VALUES (?,?,?,?,?)',row.destination,row.targetKind,row.targetId,JSON.stringify(row.value),row.revision));
      return statements;
    },
    // remove receives no row. Retained reviewed scope descriptions in the same
    // job let deletion enumerate exactly the owned rows without a broad cascade.
    remove(destination,kind,id) {
      // Child rows are deleted only after the exact whole-unit guard succeeds.
      // Required incoming relationships are fenced by preparePreservedUndo.
      return [
        ...(kind==='page'?[...[...derivedPageReferences,'page_grants'].map(table=>sql(`DELETE FROM ${identifier(table)} WHERE page_id=?`,id)),sql(`DELETE FROM ${identifier(shareNotice.table)} WHERE ${identifier(shareNotice.column)}=? AND event=?`,id,shareNotice.event)]:[]),
        ...(kind==='container'?[...derivedContainerReferences,'container_grants'].map(table=>sql(`DELETE FROM ${identifier(table)} WHERE container_id=?`,id)):[]),
        sql("UPDATE import_objects SET available=0 WHERE import_id=? AND storage_key IN (SELECT json_extract(r.value,'$.values.storage_key') FROM import_native_targets t,json_each(t.value_json,'$.unit.rows') r WHERE t.import_id=? AND t.kind=? AND t.target_id=? AND json_extract(r.value,'$.table')='files')",destination,destination,kind,id),
        sql("INSERT INTO content_media_cleanup(storage_key,created_at) SELECT json_extract(r.value,'$.values.storage_key'),? FROM import_native_targets t,json_each(t.value_json,'$.unit.rows') r WHERE t.import_id=? AND t.kind=? AND t.target_id=? AND json_extract(r.value,'$.table')='files' ON CONFLICT DO NOTHING",job.created_at,destination,kind,id),
        ...deletionTables.map(({table,column,path})=>sql(`DELETE FROM ${identifier(table)} WHERE ${identifier(column)} IN (SELECT json_extract(r.value,?) FROM import_native_targets t,json_each(t.value_json,'$.unit.rows') r WHERE t.import_id=? AND t.kind=? AND t.target_id=? AND json_extract(r.value,'$.table')=?)`,path,destination,kind,id,table)),
        sql(`DELETE FROM ${identifier(rootTable(kind))} WHERE id=?`,id),
        sql('DELETE FROM import_native_targets WHERE import_id=? AND kind=? AND target_id=?',destination,kind,id),
      ];
    },
    async list(db,destination) {
      const rows=(await db.prepare('SELECT kind,target_id FROM import_native_targets WHERE import_id=? ORDER BY kind,target_id').bind(destination).all<{kind:string;target_id:string}>()).results;
      const result:TargetRow[]=[];for(const row of rows){const target=await adapter.read(db,destination,row.kind,row.target_id);if(target)result.push(target);}return result;
    },
    matchesCount(count,destination){return sql('(SELECT COUNT(*) FROM import_native_targets WHERE import_id=?)=?',destination,count);},
    async preparePreservedUndo(db,destination,effects){return preservedSnapshot(db,destination,effects,adapter,job,await (references??=nativeReferenceCatalog(db)));},
  };
  adapter.stagingRead=async(db,destination,kind,id)=>{
    if(epoch?.writes!==writes())epoch={writes:writes(),revision:db.prepare('SELECT revision FROM import_native_epoch WHERE id=1').first<{revision:number}>().then(row=>row!.revision)};
    const revision=await epoch.revision,row=await adapter.read(db,destination,kind,id);
    return {row,guards:[sql('(SELECT revision FROM import_native_epoch WHERE id=1)=?',revision)]};
  };
  adapter.stagingPublication=(stageId)=>({
    protect:[sql('INSERT INTO import_native_publications(id,revision) SELECT ?,revision FROM import_native_epoch WHERE id=1',stageId)],
    seal:[sql('UPDATE import_native_epoch SET seal=? WHERE id=1 AND revision=(SELECT revision FROM import_native_publications WHERE id=?)',stageId,stageId)],
    release:[sql('DELETE FROM import_native_publications WHERE id=?',stageId)],
    final:[sql('EXISTS(SELECT 1 FROM import_native_epoch WHERE id=1 AND seal=?) AND NOT EXISTS(SELECT 1 FROM import_native_publications WHERE id=?)',stageId,stageId)],
  });
  adapter.matchesParts=(row,destination,kind,id)=>[adapter.matches(row,destination,kind,id)];
  return adapter;
}

// Children before their owners. These are the native planners' owned rows;
// everything else pointing at an imported entity is a preservation dependency.
const deletionTables=[
  ['comments','thread_id'],['comment_threads','page_id'],
  ['content_published_revisions','page_id'],['federation_import_mappings','id'],['database_records','page_id'],['database_views','id'],['database_fields','id'],['databases','id'],
  ['files','id'],['page_grants','id'],['page_labels','page_id'],['blog_posts','page_id'],['task_origins','block_id'],['page_blocks','id'],['page_revisions','id'],
  ['page_contributors','page_id'],['content_events','page_id'],['record_revisions','id'],['structured_revisions','id'],
  ['container_grants','id'],['container_members','container_id'],['container_owners','container_id'],
].map(([table,column])=>({table:table!,column:column!,path:`$.values.${column}`}));

async function preservedSnapshot(db:D1Database,destination:string,effects:D1UndoEffect[],adapter:D1TargetAdapter,job:NativeImportBinding,references:Awaited<ReturnType<typeof nativeReferenceCatalog>>):Promise<D1UndoSnapshot> {
  const observations:D1UndoSnapshot['observations']=[],dependencies:D1UndoSnapshot['dependencies']=[];
  const epoch=await db.prepare('SELECT revision FROM import_native_epoch WHERE id=1').first<{revision:number}>();
  // Every native table observed below advances this durable epoch on writes.
  // The complete snapshot is fenced before any selected removal executes.
  const guards=[sql('(SELECT revision FROM import_native_epoch WHERE id=1)=?',epoch!.revision)];
  // Grant IDs and record page IDs identify rows within complete guarded
  // effects. Rows outside this child remain external preservation dependencies.
  const ownedRows=new Map<string,string>();
  for(const effect of effects)for(const row of valueUnit(effect.expected).rows){
    const id=row.values[relationshipKey(row.table)];
    if(typeof id==='string')ownedRows.set(relationshipIdentity(row.table,id),effect.provenance.id);
  }
  const pageEffect=(id:string)=>ownedRows.get(relationshipIdentity('pages',id));
  const stays=pageStays(db,destination,adapter,references);
  const mediaReferences=await nativeMediaReferences(db,effects.map(effect=>valueUnit(effect.expected)).filter(unit=>unit.kind==='media'));
  for(const effect of effects){
    const expected=effect.expected,unit=valueUnit(expected);
    const current=await adapter.read(db,destination,expected.targetKind,expected.targetId)??null;
    observations.push({effectId:effect.provenance.id,current,entity:{table:rootTable(expected.targetKind),recordId:expected.targetId},guard:current?sql('EXISTS(SELECT 1 FROM import_native_targets WHERE import_id=? AND kind=? AND target_id=? AND revision=?)',destination,expected.targetKind,expected.targetId,current.revision):adapter.matches(null,destination,expected.targetKind,expected.targetId)});
    const queries:Relation[]=[];
    if(unit.kind==='member'||unit.kind==='group')for(const table of ['page_grants','container_grants'])queries.push({table,column:'principal_id',target:unit.id});
    if(unit.kind==='container')queries.push({table:'pages',column:'container_id',target:unit.id});
    if(unit.kind==='page')queries.push(...pageRelations(unit));
    if(unit.kind==='media'){
      // A file may be in a later stream child than its owning page, and Undo
      // reaches later children first. The file goes with its page: decided
      // together in one child, or by predicting the page's own child.
      const owner=ownerOf(unit),cause={table:'pages',recordId:owner,field:'attachment'};
      if(pageEffect(owner))dependencies.push({requiredEffectId:effect.provenance.id,dependentEffectId:pageEffect(owner)!,order:false,cause,evidence:{reason:'Attachment of a kept imported page'}});
      else if(await stays(owner))dependencies.push({requiredEffectId:effect.provenance.id,cause,evidence:{reason:'Attachment required by a kept page'}});
      for(const pageId of mediaReferences.get(unit.id)??[]){
        const cause={table:'pages',recordId:pageId,field:'media'};
        // A link is not a removal order: imported pages may link each other's
        // files in a cycle. The file stays only if the linking page stays.
        if(pageEffect(pageId)){dependencies.push({requiredEffectId:effect.provenance.id,dependentEffectId:pageEffect(pageId)!,order:false,cause,evidence:{reason:'File is linked by an imported page'}});continue;}
        if(await stays(pageId))dependencies.push({requiredEffectId:effect.provenance.id,cause,evidence:{reason:'File is referenced by a kept page'}});
      }
    }
    const incoming=nativeIncomingChecks(references,unit,queries);
    if(!incoming.length&&!queries.length)continue;
    const found=await readRelations(db,incoming,queries);
    const fenced=incomingDependencies(incoming,found.incoming,effect.provenance.id);guards.push(...fenced.guards);dependencies.push(...fenced.dependencies);
    queries.forEach((relation,index)=>{for(const id of found.related[index]!){
      const dependentEffectId=ownedRows.get(relationshipIdentity(relation.table,id));
      if(dependentEffectId===effect.provenance.id)continue;
      dependencies.push({requiredEffectId:effect.provenance.id,...(dependentEffectId?{dependentEffectId}:{}),cause:{table:relation.table,recordId:id,field:relation.column},evidence:{reason:'Required native relationship',target:relation.target} as Json});
    }});
  }
  return {observations,dependencies,guards};
}

type Relation={table:string;column:string;target:string};
/** Incoming references and required relationships, read in one statement. */
async function readRelations(db:D1Database,incoming:IncomingCheck[],relations:Relation[]) {
  const parts=[...incoming.map((check,index)=>`(${check.query}) AS i${index}`),...relations.map((relation,index)=>{
    const key=relationshipKey(relation.table);
    return `(SELECT COALESCE(json_group_array(${identifier(key)}),'[]') FROM (SELECT ${identifier(key)} FROM ${identifier(relation.table)} WHERE ${identifier(relation.column)}=? ORDER BY ${identifier(key)})) AS r${index}`;
  })];
  const found=await db.prepare(`SELECT ${parts.join(',')}`).bind(...incoming.map(check=>check.id),...relations.map(relation=>relation.target)).first<Record<string,string>>();
  return {incoming:incoming.map((_,index)=>found![`i${index}`]!),related:relations.map((_,index)=>JSON.parse(found![`r${index}`]!) as string[])};
}

/** What keeps a page: its children, its database's pages and records, its
 * attachments, and the discussion, suggestions, schedules and publication on it. */
function pageRelations(unit:NativeUnit):Relation[] {
  const queries:Relation[]=[{table:'pages',column:'parent_page_id',target:unit.id}];
  for(const row of unit.rows)if(row.table==='databases'){
    queries.push({table:'pages',column:'database_id',target:String(row.values.id)});
    // Records belong to their page effect, not the database definition.
    // A retained/later-child or native-added record has no removable owner
    // in this snapshot and must keep the definition and its ancestors.
    queries.push({table:'database_records',column:'database_id',target:String(row.values.id)});
  }
  queries.push({table:'files',column:'page_id',target:unit.id});
  for(const table of ['comment_threads','content_suggestions','content_schedules','public_exposures'])queries.push({table,column:'page_id',target:unit.id});
  return queries;
}

/** Whether a page outside this stream child will still exist after Undo,
 * applying the rules its own child applies: a native page stays; an imported
 * page stays when it was edited, has a native reference or relationship, or
 * has an imported child page, record or attachment that itself stays. Results
 * are shared within one snapshot; a reference cycle alone keeps nothing. */
function pageStays(db:D1Database,destination:string,adapter:D1TargetAdapter,references:Awaited<ReturnType<typeof nativeReferenceCatalog>>) {
  const decided=new Map<string,boolean>(),visiting=new Set<string>();
  let cuts=0;
  const stays=async(pageId:string):Promise<boolean>=>{
    if(visiting.has(pageId)){cuts++;return false;}
    if(decided.has(pageId))return decided.get(pageId)!;
    const before=cuts;visiting.add(pageId);
    try {
      const result=await decide(pageId);
      // An answer that assumed an unfinished page in a cycle is not reused.
      if(cuts===before)decided.set(pageId,result);
      return result;
    } finally { visiting.delete(pageId); }
  };
  const decide=async(pageId:string):Promise<boolean>=>{
    const target=await adapter.read(db,destination,'page',pageId);
    if(!target)return (await db.prepare('SELECT 1 AS present FROM pages WHERE id=?').bind(pageId).first())!==null;
    if((target.value as unknown as {observed?:string[]}).observed)return true;
    const unit=valueUnit(target),relations=pageRelations(unit),incoming=nativeIncomingChecks(references,unit,relations);
    const found=await readRelations(db,incoming,relations);
    if(found.incoming.some(snapshot=>(JSON.parse(snapshot) as number[]).some(Boolean)))return true;
    const owned=new Set(unit.rows.map(row=>relationshipIdentity(row.table,String(row.values[relationshipKey(row.table)]))));
    const related=relations.flatMap((relation,index)=>found.related[index]!.filter(id=>!owned.has(relationshipIdentity(relation.table,id))).map(id=>({table:relation.table,id})));
    // Direct reasons first, then imported pages and files that may stay.
    if(related.some(item=>!['pages','database_records','files'].includes(item.table)))return true;
    const pages=related.filter(item=>item.table!=='files').map(item=>item.id),files:NativeUnit[]=[];
    for(const {id} of related.filter(item=>item.table==='files')){
      const media=await adapter.read(db,destination,'media',id);
      if(!media||(media.value as unknown as {observed?:string[]}).observed)return true;
      files.push(valueUnit(media));
    }
    for(const id of pages)if(await stays(id))return true;
    const linked=await nativeMediaReferences(db,files);
    for(const linking of [...linked.values()].flat())if(await stays(linking))return true;
    return false;
  };
  return stays;
}

const ownerOf=(unit:NativeUnit)=>unit.rows.find(r=>r.table==='files')!.values.page_id as string;
/** One statement for every file in the batch: a different native page may use an
 * imported file in its body, cover, icon, typed record fields or retained
 * revision. The native epoch fences these observations before removal. */
async function nativeMediaReferences(db:D1Database,units:NativeUnit[]):Promise<Map<string,string[]>> {
  const found=new Map<string,string[]>();
  if(!units.length)return found;
  const rows=(await db.prepare(`WITH m(id,owner) AS (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)),
    refs(media_id,page_id) AS (
      SELECT m.id,p.id FROM m JOIN pages p ON p.cover_file_id=m.id OR p.icon='file:'||m.id
      UNION SELECT m.id,b.page_id FROM page_blocks b,json_tree(b.content_json) j JOIN m ON j.atom IN (m.id,'/api/media/'||m.id) WHERE j.type='text'
      UNION SELECT m.id,r.page_id FROM database_records r,json_tree(r.field_values_json) j JOIN m ON j.atom IN (m.id,'/api/media/'||m.id) WHERE j.type='text'
      UNION SELECT m.id,r.page_id FROM page_revisions r,json_tree(r.body_json) j JOIN m ON j.atom IN (m.id,'/api/media/'||m.id) WHERE j.type='text'
      UNION SELECT m.id,r.page_id FROM page_revisions r,json_tree(r.properties_json) j JOIN m ON j.atom IN (m.id,'/api/media/'||m.id,'file:'||m.id) WHERE j.type='text')
    SELECT DISTINCT refs.media_id,refs.page_id FROM refs JOIN m ON m.id=refs.media_id WHERE refs.page_id!=m.owner ORDER BY refs.media_id,refs.page_id`).bind(JSON.stringify(units.map(unit=>[unit.id,ownerOf(unit)]))).all<{media_id:string;page_id:string}>()).results;
  for(const row of rows)found.set(row.media_id,[...(found.get(row.media_id)??[]),row.page_id]);
  return found;
}
