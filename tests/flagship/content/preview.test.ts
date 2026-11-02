import {it, expect, vi} from 'vitest';
import {env} from 'cloudflare:test';
import {createApi} from '../../../src/core/app/hono';
import {contentLimits} from '../../../src/core/features/editor/limits';
import {publicIp} from '../../../src/core/features/editor/link-preview';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {seedWorkspace, seedMember, seedContainer, seedContainerGrant, sessionFor} from '../../e2e/setup/fixtures';

it('rejects private origins before the first fetch and every redirect and accepts bounded HTML only', async () => {
  await resetDeployment();
  const {workspaceId} = await seedWorkspace();
  const {memberId} = await seedMember(workspaceId, {role:'owner', email:['synthetic-slate-1','example.test'].join('@'), displayName:'Synthetic owner', isSetupOwner:true});
  const {containerId} = await seedContainer(workspaceId, {ownerMemberId:memberId, visibility:'open'});
  await seedContainerGrant(containerId,{principalKind:'member',principalId:memberId,level:'full'});
  const cookie = await sessionFor(memberId), app = createApi(), base = 'https://slate.test';
  const bindings = {...env, APP_URL:base, SLATE_PROFILE:'core-wiki'};
  const req = (url:unknown, extra = {}, auth = cookie) => app.request(base+'/api/pages/link-preview', {
    method:'POST', headers:{cookie:auth, origin:base, 'content-type':'application/json'}, body:JSON.stringify({url}),
  }, {...bindings, ...extra});
  const seen: Request[] = [];
  let addresses = ['8.8.8.8'];
  const iconBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1cAAAAASUVORK5CYII='), c=>c.charCodeAt(0));
  const html = () => new Response('<title>Synthetic target</title><meta name="description" content="Target description"><link rel="shortcut icon" href="/icon.png">', {headers:{'content-type':'text/html; charset=utf-8'}});
  let target: (request: Request) => Response | Promise<Response> = request => new URL(request.url).pathname === '/icon.png' ? new Response(iconBytes, {headers:{'content-type':'image/png'}}) : html();
  const edge = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init); seen.push(request);
    expect(request.method).toBe('GET'); expect(request.body).toBeNull();
    expect(init?.credentials).toBe('omit'); expect(request.redirect).toBe('manual');
    expect([...request.headers.keys()]).toEqual(['accept']);
    const url = new URL(request.url);
    if (url.hostname === 'cloudflare-dns.com') {
      expect(url.pathname).toBe('/dns-query');
      const values = url.searchParams.get('name') === 'private.synthetic-slate-1.test' ? ['169.254.169.254'] : addresses;
      return Response.json({Answer:values.map(data=>({type:data.includes(':')?28:1, data}))});
    }
    expect(url.protocol).toBe('https:');
    return target(request);
  });
  const remote = () => seen.filter(request=>new URL(request.url).hostname !== 'cloudflare-dns.com');
  try {
    expect((await req('https://synthetic-slate-1.test', {}, '')).status).toBe(401); expect(seen).toHaveLength(0);
    const disabled = await req('https://synthetic-slate-1.test', {LINK_PREVIEWS_ENABLED:'false'});
    expect(disabled.status).toBe(503); expect((await disabled.json<any>()).code).toBe('PREVIEWS_DISABLED'); expect(seen).toHaveLength(0);
    for (const raw of ['http://synthetic-slate-1.test', 'https://user:pass@synthetic-slate-1.test', 'https://synthetic-slate-1.test:8443', 'https://localhost', 'https://sub.localhost', 'https://metadata.google.internal', 'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://10.1.2.3', 'https://172.16.0.1', 'https://192.168.1.1', 'https://169.254.169.254', 'https://100.64.0.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fd00::1]', 'https://[fe80::1]']) {
      seen.length = 0;
      const refused = await req(raw); expect(refused.status,raw).toBe(400); expect((await refused.json<any>()).code).toBe('PREVIEW_REFUSED'); expect(seen,raw).toHaveLength(0);
    }
    for (const resolved of [[], ['127.0.0.1'], ['10.0.0.1'], ['169.254.169.254'], ['fd00::1'], ['fe80::1'], ['2001:0000::1'], ['2001:0db8::1'], ['8.8.8.8','192.168.1.1']]) {
      addresses = resolved; seen.length = 0;
      expect((await req('https://synthetic-slate-1.test')).status).toBe(400); expect(remote()).toHaveLength(0);
    }
    addresses = ['8.8.8.8']; seen.length = 0;
    const exact = 'https://synthetic-slate-1.test/Path?escaped=%2f#KeepCase';
    const ready = await req(exact); expect(ready.status).toBe(200); expect(ready.headers.get('cache-control')).toBe('private, no-store');
    const card = await ready.json<any>();
    expect(card).toMatchObject({url:exact, display:'card', previewState:'ready', preview:{title:'Synthetic target',description:'Target description'}});
    expect(card.preview.iconData).toBe('data:image/png;base64,'+btoa(String.fromCharCode(...iconBytes)));
    expect(remote().map(request=>new URL(request.url).pathname)).toEqual(['/Path','/icon.png']);
    const made = await app.request(base+'/api/pages', {method:'POST', headers:{cookie,origin:base,'content-type':'application/json'}, body:JSON.stringify({operationKey:crypto.randomUUID(),containerId,title:'Pasted target',blocks:[{id:crypto.randomUUID(),blockType:'link-card',treePosition:'00',content:card}]})}, bindings);
    expect(made.status,await made.clone().text()).toBe(200);
    const id = (await made.json<any>()).value.pageId;
    const readback = await app.request(base+'/api/pages/'+id, {headers:{cookie, origin:base}}, bindings);
    expect(readback.status,await readback.clone().text()).toBe(200);
    const stored = await readback.json<any>();
    expect(stored.blocks[0].content).toEqual(card);
    // Redirects are resolved afresh before each next request, including DNS-mixed answers.
    for (const destination of ['https://private.synthetic-slate-1.test/private','https://127.0.0.1','https://169.254.169.254','https://[::ffff:10.0.0.1]','http://synthetic-slate-1.test','https://user@synthetic-slate-1.test']) {
      seen.length = 0; target = () => new Response(null,{status:302,headers:{location:destination}});
      expect((await req(exact)).status).toBe(400); expect(remote()).toHaveLength(1);
    }
    for (const redirects of [contentLimits.maximumUrlFetchRedirects, contentLimits.maximumUrlFetchRedirects+1]) {
      seen.length = 0;
      target = request => {
        const hop = Number(new URL(request.url).pathname.slice(1)) || 0;
        return hop < redirects ? new Response(null,{status:302,headers:{location:'/'+(hop+1)}}) : new Response('<title>Last hop</title>',{headers:{'content-type':'application/xhtml+xml'}});
      };
      const result = await req('https://synthetic-slate-1.test/0');
      expect(result.status).toBe(redirects===contentLimits.maximumUrlFetchRedirects?200:400);
      expect(remote()).toHaveLength(contentLimits.maximumUrlFetchRedirects+1);
    }
    for (const media of ['application/json','text/plain','image/png']) {
      target = () => new Response('<title>Not HTML</title>',{headers:{'content-type':media}});
      expect((await req(exact)).status).toBe(400);
    }
    for (const declared of [false,true]) {
      let cancelled = false;
      target = () => new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(contentLimits.maximumUrlFetchBytes+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html',...(declared?{'content-length':String(contentLimits.maximumUrlFetchBytes+1)}:{})}});
      const result = await req(exact); expect((await result.json<any>()).code).toBe('PREVIEW_REFUSED'); expect(cancelled).toBe(true);
    }
    target = () => new Response(null,{status:503}); expect((await req(exact)).status).toBe(400);
    target = () => {throw new TypeError('Synthetic remote transport failure');}; expect((await req(exact)).status).toBe(400);
    // The same total deadline fences a missing response and a stalled response body.
    for (const stalled of ['headers','stream']) {
      let cancelled = false;
      target = () => stalled === 'headers' ? new Promise<Response>(()=>{}) : new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('<title>Never finishes'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}});
      const started = Date.now(), timed = await req(exact);
      expect(timed.status).toBe(400); expect((await timed.json<any>()).code).toBe('PREVIEW_REFUSED');
      expect(Date.now()-started).toBeLessThan((contentLimits.maximumUrlFetchSeconds+2)*1000);
      if (stalled === 'stream') expect(cancelled).toBe(true);
    }
    expect(publicIp('10.1.2.3')).toBe(false); expect(publicIp('::ffff:127.0.0.1')).toBe(false);
  } finally {edge.mockRestore();}
}, 30000);
