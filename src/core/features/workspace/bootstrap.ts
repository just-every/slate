import { profileNameStatements } from './profile-name';
import { personDisplayName, personInitials } from '../../shared/person-identity';
import { firstRunRecords } from './first-run-records';
import { defaultStatusStatements } from '../page-status/defaults';
import type { RuntimeConfig } from '../../platform/config/runtime';
import type { FeatureContext } from '../../app/feature-context';
import { createUlid } from '../../shared/ulid';
import { commitOperation, mutationGuard } from '../../app/operations';
import { requireWorkspaceOwner, currentSubject } from '../sharing/current-access';
/** Configuration identifies the sole initial mailbox. The mailbox still must prove possession. */
export async function bootstrapOwner(db:D1Database,config:RuntimeConfig,email:string,workspaceName?:string,displayName?:string):Promise<boolean>{
  if(email.toLowerCase()!==config.setupOwnerEmail?.toLowerCase())return false;
  if(await db.prepare('SELECT id FROM workspaces LIMIT 1').first())return false;
  const workspaceId=createUlid(),memberId=createUlid(),now=new Date().toISOString();
  const initial = workspaceName ? await firstRunRecords({db, actor:{id:memberId,workspaceId}, now}, {containerName:'General',pageTitle:'Welcome'}, createUlid()) : null;
  try{await db.batch([mutationGuard(db,'SELECT count(*)=0 FROM workspaces',[]),db.prepare("INSERT INTO workspaces (id,name,mark,created_at,updated_at,revision_id,first_run_completed_at) VALUES (?,?,'',?,?,?,?)").bind(workspaceId,workspaceName??'My workspace',now,now,createUlid(),workspaceName?now:null),db.prepare("INSERT INTO members (id,workspace_id,email,display_name,initials,role,member_kind,status,is_setup_owner,created_at,updated_at) VALUES (?,?,?,?,?,'owner','member','active',1,?,?)").bind(memberId,workspaceId,email.toLowerCase(),personDisplayName(displayName,email),personInitials(displayName,email),now,now),...defaultStatusStatements(db,workspaceId,now),...(initial?.statements??[])]);return true;}catch(cause){if(!await db.prepare('SELECT id FROM workspaces LIMIT 1').first())throw cause;return false;}
}
export async function firstRunState(ctx:FeatureContext){
 await currentSubject(ctx);
 const state=await ctx.db.prepare('SELECT w.first_run_completed_at,m.is_setup_owner,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE w.id=? AND m.id=?').bind(ctx.actor.workspaceId,ctx.actor.id).first<{first_run_completed_at:string|null;is_setup_owner:number;role:string}>();
 const required=!!state&&!state.first_run_completed_at&&state.is_setup_owner===1;
 return {required,canComplete:required&&state?.role==='owner'};
}
export async function completeFirstRun(ctx:FeatureContext,input:{operationKey:string;workspaceName:string;containerName:string;pageTitle:string;displayName?:string}){
  return commitOperation(ctx,{operationKey:input.operationKey,action:'workspace.first-run',request:input,authorize:()=>requireWorkspaceOwner(ctx),prepare:async({revisionId})=>{
    const initial=await firstRunRecords(ctx,input,revisionId);
    const nameStatements=input.displayName===undefined?[]:await profileNameStatements(ctx,ctx.actor.id,input.displayName);
    return {entity:{id:ctx.actor.workspaceId,kind:'workspace',revisionId},value:{workspaceId:ctx.actor.workspaceId,containerId:initial.containerId,pageId:initial.pageId,invitationStep:true},statements:[
      mutationGuard(ctx.db,'SELECT is_setup_owner=1 FROM members WHERE id=?',[ctx.actor.id]),
      mutationGuard(ctx.db,'SELECT first_run_completed_at IS NULL FROM workspaces WHERE id=?',[ctx.actor.workspaceId]),
      mutationGuard(ctx.db,'SELECT NOT EXISTS (SELECT 1 FROM containers WHERE workspace_id=?) AND NOT EXISTS (SELECT 1 FROM pages WHERE workspace_id=?)',[ctx.actor.workspaceId,ctx.actor.workspaceId]),
      ctx.db.prepare('UPDATE workspaces SET name=?,updated_at=?,revision_id=?,first_run_completed_at=? WHERE id=?').bind(input.workspaceName,ctx.now,revisionId,ctx.now,ctx.actor.workspaceId),
      ...defaultStatusStatements(ctx.db,ctx.actor.workspaceId,ctx.now),...nameStatements,...initial.statements,
    ]};
  }});
}
