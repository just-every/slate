import { env } from 'cloudflare:test';
import { createApi } from '../../../src/core/app/hono';
import { createOpaqueToken,sessionDigest } from '../../../src/core/platform/auth/token';
import { SESSION_COOKIE_NAME } from '../../../src/core/platform/auth/cookie';
import type { AppBindings } from '../../../src/core/app/types';

export async function searchFixture(db:D1Database) {
 const now=new Date().toISOString(),sql=(query:string,...values:unknown[])=>db.prepare(query).bind(...values).run();
 await sql("INSERT INTO workspaces(id,name,mark,created_at,updated_at,revision_id) VALUES('w','Search test','S',?,?,'r')",now,now);
 const cookies:Record<string,string>={};
 const sessionSecret=env.SESSION_SECRET;
 if(!sessionSecret)throw new Error('Search fixture requires SESSION_SECRET.');
 for(const id of ['owner','reader','denied','guest','page-guest','removed','inactive','expired','revoked']){
  await sql("INSERT INTO members(id,workspace_id,email,display_name,initials,role,member_kind,status,created_at,updated_at) VALUES(?,'w',?,?,?, ?,?,'active',?,?)",id,id+'@search.test',id,id.slice(0,2),id==='owner'?'owner':'member',id.endsWith('guest')?'guest':'member',now,now);
  const token=createOpaqueToken();cookies[id]=SESSION_COOKIE_NAME+'='+token;
  await sql("INSERT INTO sessions(id,member_id,token_digest,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?)",id,id,await sessionDigest(sessionSecret,token),now,now,'2099-01-01T00:00:00.000Z');
 }
 await sql("UPDATE members SET status='historical' WHERE id='inactive'");
 await sql("UPDATE members SET status='removed' WHERE id='removed'");
 await sql("INSERT INTO containers(id,workspace_id,name,created_at,updated_at,revision_id) VALUES('c','w','Collection',?,?,'r')",now,now);
 await sql("INSERT INTO container_owners VALUES('c','owner',?)",now);
 for(const id of ['owner','reader','guest','expired','revoked'])await sql("INSERT INTO container_grants(id,container_id,principal_kind,principal_id,level,expires_at,revoked_at,created_at,updated_at) VALUES(?,'c','member',?,?,?, ?,?,?)",id,id,id==='owner'?'full':'view',id==='expired'?'2000-01-01T00:00:00.000Z':null,id==='revoked'?now:null,now,now);
 const page=async(id:string,body:string,options:{title?:string;container?:string;parent?:string;author?:string;status?:string;restricted?:boolean;lifecycle?:string;kind?:string}={})=>{
  await sql("INSERT INTO pages(id,workspace_id,container_id,parent_page_id,page_kind,title,author_member_id,lifecycle,status_key,working_revision_id,published_revision_id,created_at,updated_at,revision_id,access_inheritance) VALUES(?,'w',?,?,?,?,?,?,?,'r','r',?,?,'r',?)",id,options.container??'c',options.parent??null,options.kind??'page',options.title??id,options.author??'owner',options.lifecycle??'live',options.status??null,now,now,options.restricted?'restricted':'inherit');
  await sql("INSERT INTO page_blocks(id,page_id,block_type,content_json,tree_position,revision_id,created_at,updated_at) VALUES(?,?,'paragraph',?,'a','r',?,?)",'b-'+id,id,JSON.stringify({text:body}),now,now);
 };
 const app=createApi();
 const mutate=async(path:string,body:unknown,method='POST')=>{
  const response=await app.fetch(new Request('http://localhost:8787/api'+path,{method,headers:{cookie:cookies.owner!,'content-type':'application/json'},body:JSON.stringify(body)}),{...env,DB:db,SLATE_PROFILE:undefined} as AppBindings);
  return {status:response.status,data:await response.json() as any};
 };
 const measuredFind=async(query:string,actor='reader',extra:Record<string,string>={},bindings:Partial<AppBindings>={})=>{
  const headers:Record<string,string>=actor==='anonymous'?{}:{cookie:cookies[actor]!};
  const started=performance.now();
  const response=await app.fetch(new Request('http://localhost:8787/api/search?'+new URLSearchParams({q:query,...extra}),{headers}),{...env,DB:db,SLATE_PROFILE:undefined,...bindings} as AppBindings);
  const data=await response.json() as any;
  return {status:response.status,data,ms:performance.now()-started};
 };
 const find=async(query:string,actor='reader',extra:Record<string,string>={})=>{
  const {status,data}=await measuredFind(query,actor,extra);return {status,data};
 };
 return {db,now,sql,page,find,measuredFind,mutate,cookies};
}
