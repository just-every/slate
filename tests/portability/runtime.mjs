import {launchMailRuntime} from '../e2e/mail-runtime.mjs';
import {signInWithOutbox} from '../e2e/outbox-auth.mjs';
import {testDevKey,devKeyHeaders,sourceDevOrigins} from '../e2e/dev-key.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {availablePort,waitForReady,sessionCookie} from '../e2e/runtime-harness.mjs';
import {command,launch,stop,safeEnvironment} from '../qualification/local/process.mjs';

export const ownerEmail='archive-owner\x40example.invalid';
export const root=path.resolve(import.meta.dirname,'../..');

/** Separate real D1/R2 bindings; all configuration and state stay in caller scratch. */
export async function runtime(directory){
  const port=await availablePort(),inspector=await availablePort();
  const origin=`http://127.0.0.1:${port}`,persist=path.join(directory,'state');
  const emitted=JSON.parse(await readFile(path.join(root,'dist/server/wrangler.json'),'utf8'));
  const configPath=path.join(directory,'wrangler.json');
  const config={...emitted,main:path.resolve(root,'dist/server',emitted.main),assets:{...emitted.assets,directory:path.resolve(root,'dist/server',emitted.assets.directory)},
    d1_databases:emitted.d1_databases.map(db=>({...db,migrations_dir:path.join(root,'migrations/core')})),
    vars:{APP_URL:origin,SETUP_OWNER_EMAIL:ownerEmail,SESSION_SECRET:randomUUID(),CONNECTOR_CREDENTIALS_KEY:randomUUID(),LOCAL_DEVELOPMENT:'true',MAIL_PROVIDER:'development',MAIL_FROM:'archive\x40example.invalid',AI_ENABLED:'false',SSO_ENABLED:'false',LINK_PREVIEWS_ENABLED:'false',RER_DEV_KEY:testDevKey},no_bundle:true};
  await writeFile(configPath,JSON.stringify(config),{mode:0o600});
  const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
  const env={...safeEnvironment(),WRANGLER_LOG_PATH:path.join(directory,'logs')};
  // Never surface Wrangler output: it may render the private test configuration.
  async function invoke(args){try{return await command('nice',['-n','15',process.execPath,cli,...args,'--local','--config',configPath,'--persist-to',persist],{cwd:directory,env});}catch{throw Error('Local portability storage command failed.');}}
  let worker;
  const localSettings=path.join(root,'.artifacts',`portability-owner-${port}.vars`);
  async function close(){await stop(worker);worker=undefined;sourceDevOrigins.delete(origin);await rm(localSettings,{force:true});}
  async function start({localOwner=false}={}){
    if(localOwner){
      await writeFile(localSettings,Object.entries(config.vars).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
      worker=launch(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,env:{...env,SLATE_LOCAL_SETTINGS_PATH:localSettings,SLATE_PERSIST_STATE_PATH:persist,SLATE_WRANGLER_CONFIG_PATH:configPath}});
      sourceDevOrigins.add(origin);
    }else worker=await launchMailRuntime({root,configPath,persist,port,variables:config.vars,env,scheduled:true});
    try{await waitForReady(origin,worker.child,60000,localOwner?devKeyHeaders:undefined);}catch{
      await writeFile(path.join(root,'.artifacts/portability-local-start.log'),worker.output(),{mode:0o600});
      await close();throw Error('Local portability Worker did not become ready.');
    }
  }
  await invoke(['d1','migrations','apply','DB']);
  return {origin,persist,start,close,
    async scheduled(){const response=await fetch(origin+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(response.status,200,'The emitted Worker runs its real scheduled handler.');},
    async sql(sql){assert.equal(worker,undefined,'Stop the Worker before opening D1 from the fixture helper.');return JSON.parse(await invoke(['d1','execute','DB','--command',sql,'--json']));},
    async cli(action,file,cookie){let output;try{output=await command('nice',['-n','15',process.execPath,'src/core/features/portability/command.mjs',action==='export'?'backup':'restore',file],{cwd:root,env:{...env,SLATE_APP_URL:origin,SLATE_SESSION_COOKIE:cookie}});}catch(cause){const code=cause.message.match(/\"code\":\"([A-Z_]+)\"/)?.[1]??'COMMAND_FAILED';throw Error(`Native ZIP ${action} failed against the local deployment: ${code}.`);}const line=output.trim().split('\n').at(-1);const receipt=JSON.parse(line);assert.equal(receipt.state,'completed');return receipt;}};
}

/** Confirmation still uses the production Worker; only the paid mail edge is fake. */
export async function signIn(instance){return (await signInWithOutbox(instance.origin,ownerEmail)).cookie;}

export async function api(instance,cookie,url,options={}){
  const response=await fetch(new URL(url,instance.origin),{...options,headers:{Cookie:cookie,Origin:instance.origin,...options.headers}});
  assert.equal(response.status,200,`${options.method??'GET'} ${url} succeeds; code=${response.status===200?'OK':(await response.clone().json()).code}.`);
  return response;
}
