import { appendFile } from 'node:fs/promises';
import path from 'node:path';

export const unavailableOidcIssuer = 'https://synthetic-slate-709.invalid';

/** Only this synthetic provider's network edge fails; native sign-in and mail stay real. */
export async function unavailableOidcEdge(request, directory, ResponseClass) {
  if (new URL(request.url).origin !== unavailableOidcIssuer) return null;
  await appendFile(path.join(directory, 'oidc-requests.jsonl'), JSON.stringify({ method: request.method, path: new URL(request.url).pathname }) + '\n');
  return new ResponseClass(JSON.stringify({ error: 'synthetic-slate-710' }), { status: 503, headers: { 'content-type': 'application/json' } });
}
