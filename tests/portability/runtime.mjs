import {createRequire} from 'node:module';
import {realpath} from 'node:fs/promises';
import {launchMailRuntime} from '../e2e/mail-runtime.mjs';
import {signInWithOutbox} from '../e2e/outbox-auth.mjs';
import {testDevKey,devKeyHeaders,sourceDevOrigins} from '../e2e/dev-key.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {availablePort,waitForReady,sessionCookie} from '../e2e/runtime-harness.mjs';
import {command,launch,stop,safeEnvironment} from '../qualification/local/process.mjs';

export const ownerEmail='archive-owner@example.invalid';
export const root=path.resolve(import.meta.dirname,'../..');

/** Separate real D1/R2 bindings; all configuration and state stay in caller scratch. */
export async function runtime(directory){
  const port=await availablePort(),inspector=await availablePort();
  const origin=`http://127.0.0.1:${port}`,persist=path.join(directory,'state');
  const emitted=JSON.parse(await readFile(path.join(root,'dist/server/wrangler.json'),'utf8'));
  const configPath=path.join(directory,'wrangler.json');
  const config={...emitted,main:path.resolve(root,'dist/server',emitted.main),assets:{...emitted.assets,directory:path.resolve(root,'dist/server',emitted.assets.directory)},
    d1_databases:emitted.d1_databases.map(db=>({...db,migrations_dir:path.join(root,'migrations/core')})),
    vars:{APP_URL:origin,SETUP_OWNER_EMAIL:ownerEmail,SESSION_SECRET:randomUUID(),LOCAL_DEVELOPMENT:'true',MAIL_PROVIDER:'development',MAIL_FROM:'archive@example.invalid',AI_ENABLED:'false',SSO_ENABLED:'false',LINK_PREVIEWS_ENABLED:'false',RER_DEV_KEY:testDevKey},no_bundle:true};
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
    async inventory(){
      assert.equal(worker,undefined,'Stop the Worker before inspecting its R2 namespace.');
      const require=createRequire(await realpath(path.join(root,'node_modules/wrangler/package.json')));
      const wrangler=require('wrangler'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
      const selected=wrangler.unstable_getMiniflareWorkerOptions(wrangler.unstable_readConfig({config:configPath}));
      const contents=`export default {async fetch(request,env){
        const objects=[];let cursor;
        do{const page=await env.FILES.list({cursor});objects.push(...page.objects.map(({key,size,etag})=>({key,size,etag})));cursor=page.truncated?page.cursor:undefined;}while(cursor);
        return Response.json(objects.sort((a,b)=>a.key.localeCompare(b.key)));
      }}`;
      const options=convertV4MiniflareOptions({host:'127.0.0.1',port:await availablePort(),workers:[{name:'inventory',compatibilityDate:emitted.compatibility_date,modules:[{type:'ESModule',path:'inventory.mjs',contents}],r2Buckets:selected.workerOptions.r2Buckets}]});
      const storage=new Miniflare({...options,resourcePersistencePath:path.join(persist,'v3')});
      try{return await(await storage.dispatchFetch('http://localhost/')).json();}
      finally{await storage.dispose();}
    },
    async scheduled(){const response=await fetch(origin+'/cdn-cgi/local/scheduled?cron='+encodeURIComponent('* * * * *'));assert.equal(response.status,200,'The emitted Worker runs its real scheduled handler.');},
    async sql(sql){assert.equal(worker,undefined,'Stop the Worker before opening D1 from the fixture helper.');return JSON.parse(await invoke(['d1','execute','DB','--command',sql,'--json']));},
    async cli(action,file,cookie){let output;try{output=await command('nice',['-n','15',process.execPath,'src/core/features/portability/command.mjs',action==='export'?'backup':'restore',file],{cwd:root,env:{...env,SLATE_APP_URL:origin,SLATE_SESSION_COOKIE:cookie}});}catch(cause){const code=cause.message.match(/\"code\":\"([A-Z_]+)\"/)?.[1]??'COMMAND_FAILED';throw Error(`Native ZIP ${action} failed against the local deployment: ${code}.`);}const line=output.trim().split('\n').at(-1);const receipt=JSON.parse(line);assert.equal(receipt.state,'completed');return receipt;}};
}

/** Confirmation still uses the production Worker; only the paid mail edge is fake. */
export async function signIn(instance){return (await signInWithOutbox(instance.origin,ownerEmail)).cookie;}

export async function api(instance,cookie,url,options={}){
  const response=await fetch(new URL(url,instance.origin),{...options,headers:{Cookie:cookie,Origin:instance.origin,...options.headers}});
  assert.equal(response.status,200,`${options.method??'GET'} ${url} succeeds.`);
  return response;
}
