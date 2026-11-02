import {expect} from 'vitest';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {env} from 'cloudflare:test';
import {createUlid} from '../../../src/core/shared/ulid';
import {Hono} from 'hono';
import type {AppEnvironment,AuthenticatedMember} from '../../../src/core/app/types';
import {ApiProblem} from '../../../src/core/app/problems';
import {createPagesRoutes} from '../../../src/core/features/pages/routes';
import {createContainersRoutes} from '../../../src/core/features/containers/routes';
import {createRevisionsRoutes} from '../../../src/core/features/versions/routes';
import {createArchiveRoutes} from '../../../src/core/features/archive/routes';
import {createStatusRoutes} from '../../../src/core/features/page-status/routes';
import {createMediaRoutes} from '../../../src/core/features/media/routes';
import {createPublishingRoutes,createPublicPagesRoutes} from '../../../src/core/features/publishing/routes';
import {createDatabasesRoutes} from '../../../src/core/features/databases/routes';
import {createCommentsRoutes} from '../../../src/core/features/comments/routes';
export async function fixture(){
 const now=new Date().toISOString(),w=createUlid(),a=createUlid(),b=createUlid();
 await env.DB.prepare('INSERT INTO workspaces(id,name,mark,created_at,updated_at,revision_id) VALUES (?,?,?,?,?,?)').bind(w,'Repair','R',now,now,createUlid()).run();
 for(const id of [a,b])await env.DB.prepare("INSERT INTO members(id,workspace_id,email,display_name,initials,role,created_at,updated_at) VALUES (?,?,?,?,?,'owner',?,?)").bind(id,w,`${id}@repair.invalid`,id,'R',now,now).run();
 const actors=new Map([a,b].map(id=>[id,{id,workspaceId:w,workspaceName:'Repair',email:`${id}@repair.invalid`,displayName:id,initials:'R',role:'owner'} as AuthenticatedMember]));
 const app=new Hono<AppEnvironment>();app.use('*',async(c,next)=>{const actor=actors.get(c.req.header('x-test-actor')??'');if(actor)c.set('member',actor);await next();});app.onError((e,c)=>e instanceof ApiProblem?c.json({code:e.code,message:e.message},e.status):c.json({code:'ERROR',message:e.message},500));
 app.route('/api/databases',createDatabasesRoutes());app.route('/api/pages',createPagesRoutes());app.route('/api/containers',createContainersRoutes());app.route('/api/revisions',createRevisionsRoutes());app.route('/api/archive',createArchiveRoutes());app.route('/api/status',createStatusRoutes());app.route('/api/media',createMediaRoutes());app.route('/api/publishing',createPublishingRoutes());app.route('/api/comments',createCommentsRoutes());app.route('/p',createPublicPagesRoutes());
 const request=async(method:string,path:string,body?:unknown,actor=a)=>{const r=await app.request(`https://local.test${path}`,{method,headers:{'content-type':'application/json','x-test-actor':actor},body:body===undefined?undefined:JSON.stringify(body)},env);return{status:r.status,data:await r.json<any>()};};
 const c=await request('POST','/api/containers',{operationKey:createUlid(),name:'Team'});expect(c.status).toBe(200);
 return {w,a,b,app,request,containerId:c.data.value.id,ctx:{db:env.DB,files:env.FILES,jobs:env.JOBS,actor:actors.get(a)!,now}};
}
export const paragraph=(id=createUlid(),text='unchanged')=>({id,blockType:'paragraph',treePosition:'1',content:{text:[{text}]}});
export async function page(f:Awaited<ReturnType<typeof fixture>>,blocks:any[]=[]){const r=await f.request('POST','/api/pages',{operationKey:createUlid(),containerId:f.containerId,title:'Page',blocks});expect(r.status,JSON.stringify(r.data)).toBe(200);return r.data.value;}

export async function runContentCases(cases:readonly {name:string;run:()=>Promise<void>}[]){
 const failures:Error[]=[];
 for(const [index,{name,run}] of cases.entries()){
  try{if(index>0)await resetDeployment();await run();}
  catch(cause){failures.push(new Error(`[${name}] ${cause instanceof Error?cause.message:String(cause)}`,{cause}));}
 }
 if(failures.length)throw new AggregateError(failures,failures.map(error=>error.message).join('\n'));
}
