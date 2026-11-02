import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {launch} from '../qualification/local/process.mjs';

/** Run the selected emitted artifact, intercepting only the paid mail transport. */
export async function launchMailRuntime({root,configPath,persist,port,variables={},env,scheduled=false}) {
  const varsPath=path.join(persist,'mail-vars.json');
  await mkdir(persist,{recursive:true});
  await writeFile(varsPath,JSON.stringify(variables),{mode:0o600});
  return launch(process.execPath,[path.join(root,'tests/e2e/emitted-runtime.mjs'),configPath,persist,String(port),varsPath,...(scheduled?['scheduled']:[])],{cwd:root,...(env?{env}:{})});
}

/** Emitted production Worker with a real D1 and only the relay network edge replaced. */
export async function managedMailRuntime(bindings, outboundService, {port = 0, tls} = {}) {
  const {createRequire} = await import('node:module');
  const {realpath} = await import('node:fs/promises');
  const {productionModules} = await import('@runeditrun/rer/production-modules');
  const require = createRequire(await realpath('node_modules/wrangler/package.json'));
  const {unstable_readConfig, unstable_getMiniflareWorkerOptions} = require('wrangler');
  const miniflare = require('miniflare');
  const config = unstable_readConfig({config: path.resolve('dist/server/wrangler.json')});
  const selected = unstable_getMiniflareWorkerOptions(config);
  const {modulesRules, ...workerOptions} = selected.workerOptions;
  const emitted = await productionModules(selected.main, modulesRules, miniflare);
  // Miniflare's Node outbound bridge recreates Request with redirect='follow'.
  // Assert the real fetch options inside workerd, then call native fetch untouched.
  const observer = {type:'ESModule',path:path.join(path.dirname(selected.main),'mail-fetch-observer.mjs'),contents:`
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = function(input, init) {
      if (String(input) === ${JSON.stringify(bindings.MAIL_RELAY_URL)} && init?.redirect !== 'manual')
        throw new Error('Mail fetch must use redirect manual');
      return nativeFetch.call(this, input, init);
    };
    export {default} from './${path.basename(selected.main)}';
    export * from './${path.basename(selected.main)}';
  `};
  const worker = {...workerOptions, name: config.name,
    ...emitted,modules:[observer,...emitted.modules],
    bindings: {...workerOptions.bindings, ...bindings},
    outboundService: async request => {
      const response = await outboundService(request);
      return new miniflare.Response(response.body, response);
    }};
  const options = miniflare.convertV4MiniflareOptions({host:'127.0.0.1',port,...(tls?{https:true,httpsKey:tls.key,httpsCert:tls.cert}:{}),
    unsafeTriggerHandlers:false,unsafeLocalExplorer:false,workers:[worker,...selected.externalWorkers]});
  const runtime = new miniflare.Miniflare(options);
  try { await runtime.ready; return runtime; }
  catch (cause) { await runtime.dispose(); throw cause; }
}
