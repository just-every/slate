import { expect, vi } from 'vitest';
import type { priorIdentityFixture } from './identity-prior-fixture';

const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
type Fixture = Awaited<ReturnType<typeof priorIdentityFixture>>;

/**
 * The incumbent provider through Base's pinned legacy-rs256 flow. Only the
 * provider's network endpoints are substituted; its ID token carries a real
 * RS256 signature, and PKCE, nonce, client and callback are checked.
 */
export async function providerEdge(fixture: Fixture, kid = 'prior-key') {
  const { bindings, origin } = fixture;
  const issuer = bindings.IDENTITY_ISSUER_URL, callback = origin + '/api/auth/identity/callback';
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; challenge: string; subject: string; email: string }>();
  let failure: 'discovery' | 'token' | 'signature' | null = null;
  const previous = globalThis.fetch;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(issuer + '/')) return previous(input, init);
    if (failure === 'discovery' && url.endsWith('/.well-known/openid-configuration') || failure === 'token' && url === issuer + '/token') return Response.json({ error: 'synthetic-slate-701' }, { status: 503 });
    if (url === issuer + '/.well-known/openid-configuration') return Response.json({ issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/keys',
      response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'] });
    if (url === issuer + '/keys') return Response.json({ keys: [jwk] });
    if (url !== issuer + '/token') throw Error('Unexpected test provider endpoint');
    const form = new URLSearchParams(String(input instanceof Request ? await input.text() : init?.body));
    expect(form.get('redirect_uri')).toBe(callback);
    expect(form.get('client_id')).toBe(bindings.IDENTITY_CLIENT_ID);
    expect(form.get('client_secret')).toBe(bindings.IDENTITY_CLIENT_SECRET);
    const grant = codes.get(form.get('code')!); expect(grant).toBeTruthy(); codes.delete(form.get('code')!);
    expect(encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier')!))))).toBe(grant!.challenge);
    const head = encode(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
    const now = Math.floor(Date.now() / 1000);
    const claims = encode(new TextEncoder().encode(JSON.stringify({ iss: issuer, aud: bindings.IDENTITY_CLIENT_ID, exp: now + 300, iat: now, sub: grant!.subject, email: grant!.email, email_verified: true, nonce: grant!.nonce })));
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${claims}`));
    const signed = new Uint8Array(signature);
    if (failure === 'signature') signed[0] = signed[0]! ^ 1;
    return Response.json({ id_token: `${head}.${claims}.${encode(signed)}`, token_type: 'Bearer', access_token: 'synthetic-slate-702' });
  });
  const host = new URL(origin).host;
  /** A browser sign-in: POST start, provider authorization, then the incumbent callback. */
  async function signIn(identity: { subject: string; email: string }) {
    const started = await fixture.api.request(origin + '/auth/oidc/identity/start', { method: 'POST', headers: { host, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: '' }, bindings);
    expect(started.status).toBe(303);
    const authorization = new URL(started.headers.get('location')!);
    expect(authorization.origin + authorization.pathname).toBe(issuer + '/authorize');
    expect(authorization.searchParams.get('redirect_uri')).toBe(callback);
    expect(authorization.searchParams.get('client_id')).toBe(bindings.IDENTITY_CLIENT_ID);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const code = crypto.randomUUID();
    codes.set(code, { nonce: authorization.searchParams.get('nonce')!, challenge: authorization.searchParams.get('code_challenge')!, ...identity });
    const url = callback + '?' + new URLSearchParams({ state: authorization.searchParams.get('state')!, code });
    const browserCookie = started.headers.get('set-cookie')!.split(';')[0]!;
    return { url, browserCookie, complete: (html = false) => fixture.api.request(url, { headers: { host, cookie: browserCookie, ...(html ? { accept: 'text/html' } : {}) } }, bindings) };
  }
  return { signIn, fail: (value: typeof failure) => { failure = value; }, restore: () => fetcher.mockRestore() };
}
