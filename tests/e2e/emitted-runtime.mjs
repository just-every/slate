import {embedEdge} from '../helpers/embed-edge.mjs';
import { webhookEdge } from '../helpers/webhook-edge.mjs';
import { createRequire } from 'node:module';
import { readFile, realpath, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { productionModules } from '@runeditrun/rer/production-modules';
import { slackEdge, teamsEdge } from '../helpers/slack-edge.mjs';
import { s3Edge } from '../helpers/s3-edge.mjs';
import { folderEdge } from '../helpers/folder-edge.mjs';
import { samlEdge } from '../helpers/saml-edge.mjs';
import { unavailableOidcEdge } from '../helpers/oidc-edge.mjs';

// Use the same Wrangler conversion and module loader as Base productionRuntime,
// with the qualification's isolated configuration, bindings and persistence.
const [configPath, persistPath, port, varsPath, triggerMode] = process.argv.slice(2);
const require = createRequire(await realpath(resolve('node_modules/wrangler/package.json')));
const { unstable_getMiniflareWorkerOptions, unstable_readConfig } = require('wrangler');
const miniflare = require('miniflare');
const config = unstable_readConfig({ config: configPath });
const selected = unstable_getMiniflareWorkerOptions(config);
const { modulesRules, ...workerOptions } = selected.workerOptions;
const mailbox = resolve('.artifacts/mail-edge', port + '.jsonl');
await mkdir(resolve('.artifacts/mail-edge'), {recursive:true});
await writeFile(mailbox, '');
const vars = {...workerOptions.bindings, ...JSON.parse(await readFile(varsPath, 'utf8'))};
const mail = vars.MAIL_PROVIDER === 'development' ? {MAIL_PROVIDER:'resend',MAIL_API_KEY:'test-only-mail-key'} : {};
const worker = { ...workerOptions, name: config.name,
  ...await productionModules(selected.main, modulesRules, miniflare),
  bindings: { ...workerOptions.bindings, ...vars, ...mail },
  outboundService: async request => {
    const oidc = await unavailableOidcEdge(request, persistPath, miniflare.Response);
    if (oidc) return oidc;
    const webhook = await webhookEdge(request,persistPath,miniflare.Response);
    if(webhook)return webhook;
    const saml = await samlEdge(request, persistPath, miniflare.Response);
    if (saml) return saml;
    const embed=await embedEdge(request,persistPath,miniflare.Response);
    if(embed)return embed;
    const folder = await folderEdge(request, persistPath, miniflare.Response);
    if (folder) return folder;
    const s3 = await s3Edge(request, persistPath, miniflare.Response);
    if (s3) return s3;
    const slack = await slackEdge(request, persistPath, miniflare.Response);
    if (slack) return slack;
    const teams = await teamsEdge(request, persistPath, miniflare.Response);
    if (teams) return teams;
    if (request.url === 'https://api.resend.com/emails') {
      const message = await request.json();
      await appendFile(mailbox, JSON.stringify(message) + '\n');
      return new miniflare.Response(JSON.stringify({id:crypto.randomUUID()}), {headers:{'content-type':'application/json'}});
    }
    return fetch(request);
  } };
const options = miniflare.convertV4MiniflareOptions({ host: '127.0.0.1', port: Number(port),
  unsafeTriggerHandlers: triggerMode === 'scheduled', unsafeLocalExplorer: false, workers: [worker, ...selected.externalWorkers] });
const runtime = new miniflare.Miniflare({ ...options, resourcePersistencePath: resolve(persistPath, 'v3') });
let stopping;
const stop = () => stopping ??= runtime.dispose();
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
try { await runtime.ready; }
catch (cause) { await stop(); throw cause; }

// Parent-only clock fixtures use the running native D1 binding, avoiding CLI/Worker
// persistence contention. No application route or application response is replaced.
if (triggerMode === 'scheduled' && process.send) process.on('message', async message => {
  if (message?.type !== 'fixture.sql' || typeof message.id !== 'string'
      || !Array.isArray(message.statements) || !message.statements.every(sql => typeof sql === 'string')) return;
  try {
    const db = await runtime.getD1Database('DB');
    await db.batch(message.statements.map(sql => db.prepare(sql)));
    if (process.connected) process.send({type:'fixture.sql.result',id:message.id});
  } catch {
    if (process.connected) process.send({type:'fixture.sql.result',id:message.id,error:'Native D1 fixture write failed'});
  }
});
