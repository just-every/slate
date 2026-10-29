import {env} from 'cloudflare:test';
import {expect,vi} from 'vitest';
import {createApi} from '../../../src/core/app/hono';
import type {AppBindings} from '../../../src/core/app/types';
import type {AskInput} from '../../../src/core/features/ai/contracts';
import type {startRun,controlRun} from '../../../src/core/features/runs/service';
import {sessionFor} from '../../e2e/setup/fixtures';
import {resetDeployment} from '../../e2e/setup/reset-deployment';
import {fixture} from './measured-fixture';

export async function sessionDoor(memberId:string,overrides:Partial<AppBindings>={}) {
  const app=createApi(),cookie=await sessionFor(memberId);
  const bindings={...env,AI_API_KEY:'test-only',...overrides} as AppBindings;
  return async (method:string,path:string,body?:unknown,extraHeaders?:Headers) => {
    const headers=new Headers(extraHeaders);
    headers.set('cookie',cookie);
    if(body!==undefined)headers.set('content-type','application/json');
    return app.request(`https://slate.example${path}`,{
      method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
    },bindings);
  };
}

type RunReceipt=Awaited<ReturnType<typeof startRun>>;
type ControlInput=Parameters<typeof controlRun>[1];
type ControlReceipt=Awaited<ReturnType<typeof controlRun>>;
type RunOutcome={id:string;status:string;pendingReason?:string;output?:unknown;cost?:number;uncertainCostLiability?:number;availableActions?:string[]};
export type RunFlow={title:string;execute:(f:Awaited<ReturnType<typeof fixture>>,door:Awaited<ReturnType<typeof runDoor>>)=>Promise<RunOutcome>};

async function runDoor(memberId:string) {
  const request=await sessionDoor(memberId);
  async function mutation<T>(path:string,body:unknown):Promise<T> {
    const response=await request('POST',path,body);
    const value=await response.json<T&{code?:string}>();
    if(!response.ok)throw Object.assign(new Error(`Run route returned ${response.status}: ${value.code}`),{status:response.status,code:value.code});
    expect(response.status).toBe(200);
    return value;
  }
  return {
    request,
    async start(input:AskInput) {
      const receipt=await mutation<RunReceipt>('/api/ai/ask',input);
      expect(receipt.receipt.entity.kind).toBe('run');
      expect(receipt.value.status).toBe('queued');
      return receipt;
    },
    control({id,...input}:ControlInput) {
      return mutation<ControlReceipt>(`/api/runs/${id}/control`,input);
    },
  };
}

/** Independent executions of the same signed-in ask/control/read flow. */
export async function runFlowCase(
  title:string,
  execute:RunFlow['execute'],
) {
  try {
    await resetDeployment();
    const f=await fixture(),door=await runDoor(f.owner);
    const outcome=await execute(f,door);
    const response=await door.request('GET',`/api/runs/${outcome.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(outcome);
    // The same public read distinguishes the authenticated outcome from denial.
    expect((await createApi().request(`https://slate.example/api/runs/${outcome.id}`,{},env)).status).toBe(401);
  } catch(error) {
    throw new Error(title,{cause:error});
  } finally {
    vi.unstubAllGlobals();
  }
}
