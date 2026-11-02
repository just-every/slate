import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {request as httpsRequest} from 'node:https';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {managedMailRuntime} from './mail-runtime.mjs';

const address = name => [name,'example.test'].join('@');
const privateDetail = 'synthetic-slate-private-provider-response';
const credential = 'synthetic-slate-provider-credential';

/** Real native sign-in and Settings controls; only the provider network edge is substituted. */
export async function mailFailureJourney() {
  const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  const tlsDir=await mkdtemp(path.join(tmpdir(),'slate-mail-tls-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(tlsDir,'key.pem'),'-out',path.join(tlsDir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  const tls={key:await readFile(path.join(tlsDir,'key.pem'),'utf8'),cert:await readFile(path.join(tlsDir,'cert.pem'),'utf8')};
  // Trust only this loopback runtime's ephemeral certificate for native probes.
  const localFetch=(url,init={})=>new Promise((resolve,reject)=>{
    const request=httpsRequest(url,{method:init.method??'GET',headers:init.headers,ca:tls.cert},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:Object.fromEntries(Object.entries(response.headers).map(([name,value])=>[name,Array.isArray(value)?value.join(', '):value]))})));
    });
    request.on('error',reject);request.end(init.body?.toString());
  });
  const shots = process.env.SLATE_MAIL_SHOTS;
  if(shots)await mkdir(shots,{recursive:true});
  try {
    for (const provider of ['resend','sendgrid','rer']) {
      const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const port=server.address().port;await new Promise(resolve=>server.close(resolve));
      const origin=`https://127.0.0.1:${port}`,owner=address(`synthetic-slate-${provider}-owner`);
      const relay='https://management.test.invalid/api/managed-mail/send';
      const endpoint=provider==='rer'?relay:provider==='resend'?'https://api.resend.com/emails':'https://api.sendgrid.com/v3/mail/send';
      let outcome='accept';
      const requests=[];
      const runtime=await managedMailRuntime({APP_URL:origin,LOCAL_DEVELOPMENT:'false',MAIL_PROVIDER:provider,MAIL_FROM:address('synthetic-slate-sender'),MAIL_RELAY_URL:relay,MAIL_API_KEY:credential,SESSION_SECRET:'synthetic-slate-session-secret-at-least-32-characters',SETUP_TOKEN:'synthetic-slate-setup-token-at-least-32-characters',SETUP_OWNER_EMAIL:owner},async request=>{
        assert.equal(request.url,endpoint,'Only the configured provider receives mail');
        const wire=await request.text(),body=JSON.parse(wire);
        const to=provider==='rer'?body.to:provider==='sendgrid'?body.personalizations[0].to[0].email:body.to[0];
        requests.push({to,wire,key:request.headers.get('idempotency-key'),outcome});
        if(outcome==='reject')return new Response(privateDetail,{status:401});
        if(outcome==='throttle')return new Response(privateDetail,{status:429,headers:{'Retry-After':'240'}});
        if(outcome==='uncertain')return new Response(privateDetail,{status:503});
        if(provider==='resend')return Response.json({id:'synthetic-slate-accepted'});
        return Response.json({accepted:true},{status:202,headers:provider==='sendgrid'?{'x-message-id':'synthetic-slate-accepted'}:{}});
      },{port,tls});
      try {
        const db=await runtime.getD1Database('DB'),worker=await runtime.getWorker();
        const {readD1Migrations}=await import('@cloudflare/vitest-pool-workers');
        for(const migration of await readD1Migrations('migrations/core'))await db.batch(migration.queries.map(query=>db.prepare(query)));
        const post=(route,body,cookie='')=>localFetch(origin+route,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
        const read=(email,kind)=>db.prepare('SELECT * FROM mail_deliveries WHERE target_email=? AND kind=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(email,kind).first();
        const count=email=>requests.filter(request=>request.to===email).length;
        const tick=()=>worker.scheduled({cron:'* * * * *'});
        const due=async row=>{
          await db.prepare('UPDATE mail_deliveries SET next_attempt_at=?,lease_until=NULL WHERE id=?').bind(new Date(Date.now()-1).toISOString(),row.id).run();
          await tick();
        };
        const rows=await db.prepare('SELECT count(*) AS n FROM mail_deliveries').first();assert.equal(rows.n,0);
        // Establish a real native owner session from mail captured at the provider edge.
        assert.equal((await post('/api/auth/magic',{email:owner,requestKey:crypto.randomUUID()})).status,200);
        const link=JSON.parse(requests[0].wire).text.match(/https?:\/\/\S+/)[0];
        const token=new URL(link).searchParams.get('token');
        const confirmed=await localFetch(origin+'/auth/confirm',{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})});
        assert.equal(confirmed.status,303);
        const cookie=confirmed.headers.get('set-cookie').split(';')[0];
        const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
        const page=await context.newPage();
        await context.addCookies([{name:cookie.split('=')[0],value:cookie.slice(cookie.indexOf('=')+1),url:origin}]);
        const anonymous=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
        const signIn=await anonymous.newPage();
        const panel=page.getByRole('region',{name:'Invitation delivery',exact:true});
        const item=email=>panel.getByRole('listitem').filter({has:page.getByText(email,{exact:true})});
        const shot=async(name,target)=>{
          assert.equal(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          if(shots)await target.screenshot({path:path.join(shots,`${provider}-${name}-${target.viewportSize().width}.png`),fullPage:true});
        };
        const reload=async()=>{await page.reload();await panel.waitFor();};
        const invite=async email=>{
          await page.getByRole('button',{name:'Invite a member',exact:true}).click();
          const dialog=page.getByRole('dialog',{name:'Invite a member',exact:true});
          await dialog.getByLabel('Email',{exact:true}).fill(email);
          const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/invitations'&&response.request().method()==='POST');
          await dialog.getByRole('button',{name:'Send invitation',exact:true}).click();
          assert.equal((await response).status(),200);
          await expect(dialog).toHaveCount(0);
          await expect(page.getByRole('status').filter({hasText:'Invitation requested'})).toContainText(email);
          await expect(page.getByText(`Invitation sent to ${email}`,{exact:true})).toHaveCount(0);
          await item(email).waitFor();
          return read(email,'invitation');
        };
        const requestSignIn=async()=>{
          await signIn.goto(origin+'/signin');
          await signIn.getByLabel('Email address',{exact:true}).fill(owner);
          const response=signIn.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/magic'&&response.request().method()==='POST');
          await signIn.getByRole('button',{name:'Email me a sign-in link'}).click();
          await response;
          return read(owner,'sign-in-link');
        };
        const safe=async target=>assert.doesNotMatch(await target.locator('body').innerText(),new RegExp(`${privateDetail}|${credential}|payload_ciphertext|request_digest|/auth/confirm\\?token=`));
        try {
          await page.goto(origin+'/app/settings/members');await panel.waitFor();
          outcome='reject';
          let signinRow=await requestSignIn();
          await expect(signIn.getByRole('alert')).toContainText('Delivery was not confirmed');
          await expect(signIn.getByRole('heading',{name:'Check your email'})).toHaveCount(0);
          assert.equal(signinRow.delivery_phase,'failed');assert.equal(count(owner),2);
          await signIn.reload();await expect(signIn.getByRole('alert')).toContainText('Delivery was not confirmed');assert.equal(count(owner),2);
          await safe(signIn);await shot('sign-in-failed',signIn);
          const rejected=address(`synthetic-slate-${provider}-rejected`);
          let rejectedRow=await invite(rejected);assert.equal(rejectedRow.delivery_phase,'failed');assert.equal(count(rejected),1);
          await expect(item(rejected)).toContainText('failed');await expect(item(rejected).getByRole('button',{name:'Retry delivery'})).toBeVisible();
          await reload();await expect(item(rejected)).toContainText('failed');assert.equal(count(rejected),1);
          await safe(page);await shot('invitation-failed',page);
          outcome='accept';
          await item(rejected).getByRole('button',{name:'Retry delivery'}).click();
          await expect(item(rejected)).toContainText('Accepted by mail provider');
          rejectedRow=await read(rejected,'invitation');assert.equal(rejectedRow.delivery_phase,'sent');assert.equal(count(rejected),2);
          await reload();await expect(item(rejected)).toContainText('Accepted by mail provider');assert.equal(count(rejected),2);
          const recover=signIn.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/magic'&&response.request().method()==='POST');
          await signIn.getByRole('button',{name:'Email me a sign-in link'}).click();await recover;
          await expect(signIn.getByRole('heading',{name:'Check your email'})).toBeVisible();
          assert.equal((await read(owner,'sign-in-link')).delivery_phase,'sent');assert.equal(count(owner),3);
          await signIn.reload();await expect(signIn.getByRole('heading',{name:'Check your email'})).toBeVisible();assert.equal(count(owner),3);
          // A new status capability, without replacing any application response.
          await anonymous.clearCookies();await signIn.evaluate(()=>sessionStorage.clear());
          const exhausted=address(`synthetic-slate-${provider}-exhausted`);
          if(provider==='resend'||provider==='rer'){
            outcome='throttle';
            signinRow=await requestSignIn();
            let row=await invite(exhausted);
            const ownerBefore=count(owner),inviteBefore=count(exhausted);
            await tick();assert.equal(count(owner),ownerBefore);assert.equal(count(exhausted),inviteBefore);
            for(let attempt=1;attempt<=2;attempt++){
              for(const pending of [await read(owner,'sign-in-link'),await read(exhausted,'invitation')]){
                assert.equal(Date.parse(pending.next_attempt_at)-Date.parse(pending.last_attempted_at)>=240000,true);
                await due(pending);
              }
            }
            signinRow=await read(owner,'sign-in-link');row=await read(exhausted,'invitation');
            assert.equal(signinRow.attempt_count,3);assert.equal(row.attempt_count,3);assert.equal(signinRow.delivery_phase,'failed');assert.equal(row.delivery_phase,'failed');
            await tick();assert.equal(count(owner),ownerBefore+2);assert.equal(count(exhausted),inviteBefore+2);
            await signIn.reload();await expect(signIn.getByRole('alert')).toContainText('Delivery was not confirmed');
            await reload();await expect(item(exhausted)).toContainText('failed');
            const wires=requests.filter(request=>request.to===exhausted);assert.equal(new Set(wires.map(request=>request.wire)).size,1);assert.equal(new Set(wires.map(request=>request.key)).size,1);
            outcome='accept';await item(exhausted).getByRole('button',{name:'Retry delivery'}).click();await expect(item(exhausted)).toContainText('Accepted by mail provider');
            assert.equal(count(exhausted),inviteBefore+3);assert.equal((await read(exhausted,'invitation')).attempt_count,4);
            console.log(`PROBE MAIL-002 7 ${provider}: native sign-in and invitation throttling -> three durable attempts, no early or fourth automatic send; explicit invitation recovery accepted`);
          }
          if(provider==='sendgrid'||provider==='rer'){
            outcome='uncertain';await signIn.evaluate(()=>sessionStorage.clear());
            signinRow=await requestSignIn();await expect(signIn.getByRole('alert')).toContainText('Provider review required');
            assert.equal(signinRow.delivery_phase,'uncertain');
            const uncertain=address(`synthetic-slate-${provider}-uncertain`),row=await invite(uncertain);
            assert.equal(row.delivery_phase,'uncertain');await expect(item(uncertain)).toContainText('Review required');
            await expect(item(uncertain).getByRole('button',{name:'Retry delivery'})).toHaveCount(0);
            const ownerBefore=count(owner),inviteBefore=count(uncertain);
            await tick();
            const refused=await post(`/api/workspace/mail/${row.id}/retry`,{},cookie);assert.equal(refused.status,409);assert.equal((await refused.json()).code,'MAIL_UNCERTAIN');
            const statusKey=await signIn.evaluate(()=>JSON.parse(sessionStorage.getItem('slate.sign-in-status')).requestKey);
            assert.equal((await post('/api/auth/magic',{email:owner,requestKey:statusKey})).status,200);
            await signIn.reload();await expect(signIn.getByRole('alert')).toContainText('Provider review required');
            await expect(signIn.getByRole('button',{name:'Email me a sign-in link'})).toHaveCount(0);
            await expect(signIn.getByRole('heading',{name:'Check your email'})).toHaveCount(0);
            await reload();await expect(item(uncertain)).toContainText('Review required');
            assert.equal(count(owner),ownerBefore);assert.equal(count(uncertain),inviteBefore);
            assert.equal((await read(uncertain,'invitation')).sent_at,null);assert.equal((await read(owner,'sign-in-link')).sent_at,null);
            await safe(signIn);await safe(page);await shot('sign-in-review',signIn);await shot('invitation-review',page);
            // Phone proof observes these same native durable states; assertions above run at 1440.
            await signIn.setViewportSize({width:390,height:844});await page.setViewportSize({width:390,height:844});
            await signIn.reload();await reload();await shot('sign-in-review',signIn);await shot('invitation-review',page);
            await item(uncertain).getByRole('button',{name:'Revoke invitation'}).click();await expect(item(uncertain)).toContainText('cancelled');
            await tick();assert.equal(count(uncertain),inviteBefore);assert.equal((await read(uncertain,'invitation')).payload_ciphertext,null);
            console.log(`PROBE MAIL-002 1,2,6,7 ${provider}: native sign-in and Settings uncertain outcomes -> review required after reload; cron, replay and explicit retry send nothing; revoke clears custody`);
          }else{
            await signIn.setViewportSize({width:390,height:844});await page.setViewportSize({width:390,height:844});
            await signIn.reload();await reload();await shot('sign-in-failed',signIn);await shot('invitation-recovered',page);
          }
          await safe(signIn);await safe(page);
          console.log(`PROBE MAIL-002 2 ${provider}: rejected native sign-in and Settings invitation -> safe visible failures, no Sent claim, durable reload, explicit recovery reconciled with provider counts`);
        } finally {await anonymous.close();await context.close();}
      } finally {await runtime.dispose();}
    }
  } finally {await browser.close();await rm(tlsDir,{recursive:true,force:true});}
}
