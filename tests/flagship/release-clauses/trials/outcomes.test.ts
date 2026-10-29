import {resetDeployment} from '../../../e2e/setup/reset-deployment';
import {test,expect,afterEach,vi} from 'vitest';
import {env} from 'cloudflare:test';
import {nativeTrial,effects} from './native-trial';
import {executeTrial} from '../../../../src/core/features/experiments/execution';
import {collectMeasurements} from '../../../../src/core/features/experiments/measurement';
import {concludeTrial} from '../../../../src/core/features/experiments/service';
import {saveField} from '../../../../src/core/features/databases/service';
import {sessionDoor} from '../../intelligence/run-flow';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

// Independent two-observation-per-arm oracle: sample-mean variance is (x1-x2)^2/4.
// The declared conservative 95% df=1 critical value is 12.706, not a normal 1.96.
function oracle(values:number[]) {const [a,b,c,d]=values as [number,number,number,number];const effect=(c+d-a-b)/2,halfWidth=12.706*Math.hypot(a-b,c-d)/2;return {effect,halfWidth,lower:effect-halfWidth,upper:effect+halfWidth};}
const cases:[string,number[]][]=[['benefit',[1,1.04,8,8.04]],['null',[8,8.04,8,8.04]],['adverse',[12,12.04,8,8.04]],['inconclusive',[1,20,1,20]],['meaningful boundary',[6,6,8,8]]];
let f:Awaited<ReturnType<typeof nativeTrial>>, active:Awaited<ReturnType<Awaited<ReturnType<typeof nativeTrial>>['approve']>>;
async function setupCase(task:{name:string}){
  const values=cases.find(([label])=>task.name.includes(`persisted ${label} conclusion`))?.[1]??[1,1,8,8];
  f=await nativeTrial(values);active=await f.approve();f.advance(f.plan.measurement!.observeAfter);
  if(task.name.includes('missing exposure'))f.wire.hooks.send=async(_,index)=>{if(index===1)throw new TypeError('Response lost');};
  if(!task.name.includes('empty measurements')){await executeTrial(f.context(),f.trialId);await collectMeasurements(f.context(),f.trialId);}

}
test('TRIAL-003 — persisted conclusions use collected fields and independently checked precision',async()=>{
 // Each measured cohort must satisfy the same independent precision oracle.
 for(const [label,values] of cases){
  await resetDeployment();
  try{
   await setupCase({name:`TRIAL-003 — persisted ${label} conclusion uses collected fields and independently checked precision`});
  const bindings={CONNECTOR_CREDENTIALS_KEY:f.context().sourceSecret};
  const owner=await sessionDoor(f.owner,bindings),reader=await sessionDoor(f.reader,bindings);
  const input={id:f.trialId,operationKey:'u6-outcome',expectedRevisionId:active.value.revisionId,instrumentationRevision:f.plan.instrumentationRevision};
  await expect(concludeTrial(f.context(),input)).rejects.toMatchObject({code:'WINDOW_OPEN'});
  await collectMeasurements(f.context(),f.trialId);
  const rows=(await env.DB.prepare('SELECT subject_id,arm,value,effect_id,refs_json FROM intelligence_observations WHERE experiment_id=? ORDER BY subject_id').bind(f.trialId).all<{subject_id:string;arm:string;value:number;effect_id:string|null;refs_json:string}>()).results;
  expect(rows).toHaveLength(4);for(const [i,subject] of f.plan.assignment.entries()){const row=rows.find(r=>r.subject_id===subject.subjectId)!;expect(row.value).toBe(values[i]);expect(row.arm).toBe(subject.arm);expect(JSON.parse(row.refs_json)[0].sourceId).toBe(f.plan.measurement!.subjects[i]!.pageId);if(subject.arm==='treatment')expect(row.effect_id).toBeTruthy();else expect(row.effect_id).toBeNull();}
  expect((await effects(f.trialId)).map(e=>e.state)).toEqual(['confirmed','confirmed']);
  f.advance('2028-01-01T00:01:59.999Z');await expect(concludeTrial(f.context(),input)).rejects.toMatchObject({code:'WINDOW_OPEN'});
  f.advance(f.plan.endsAt);const result=await concludeTrial(f.context(),{...input,instrumentationRevision:'caller-cannot-bless-measurements'}),outcome=result.value.outcome;
  expect(outcome.classification).toBe(label==='meaningful boundary'?'benefit':label);expect(outcome.instrumentation.state).toBe('unchanged');
  const expected=oracle(values);for(const key of ['effect','halfWidth','lower','upper'] as const)expect((outcome as any).estimate[key]).toBeCloseTo(expected[key],10);
  if(label==='null'){expect(expected.upper).toBeLessThan(f.plan.meaningfulEffect);expect(expected.halfWidth).toBeLessThanOrEqual(f.plan.maximumHalfWidth);expect(outcome.disconfirms).toBe(true);}
  expect(JSON.parse((await env.DB.prepare('SELECT outcome_json FROM intelligence_experiments WHERE id=?').bind(f.trialId).first<string>('outcome_json'))!)).toEqual(outcome);
  expect((await concludeTrial(f.context(),{...input,instrumentationRevision:'caller-cannot-bless-measurements'})).value).toEqual(result.value);
  expect(f.wire.sends).toHaveLength(2);
  const inbox=await owner('GET','/api/notifications');expect(inbox.status,await inbox.clone().text()).toBe(200);
  const results=(await inbox.json<any>()).items.filter((item:any)=>item.detail?.experimentId===f.trialId);
  expect(results).toMatchObject([{event:'experiment-result',detail:{outcome:outcome.classification}}]);
  const outsider=await reader('GET','/api/notifications');expect(outsider.status).toBe(200);
  expect((await outsider.json<any>()).items.some((item:any)=>item.detail?.experimentId===f.trialId)).toBe(false);

  }finally{vi.useRealTimers();vi.unstubAllGlobals();}
 }
});

test('TRIAL-003 — missing exposure, empty measurements and changed instrumentation remain inconclusive despite the declared hash',async()=>{
 // Every incomplete or invalid measurement provenance must remain inconclusive.
 for(const mode of ['missing exposure','empty measurements','changed instrumentation'] as const){
  await resetDeployment();
  try{
   await setupCase({name:`TRIAL-003 — ${mode} remains inconclusive despite the caller repeating the declared hash`});
  const observations=await env.DB.prepare('SELECT count(*) n FROM intelligence_observations WHERE experiment_id=?').bind(f.trialId).first<number>('n');expect(observations).toBe(mode==='empty measurements'?0:mode==='missing exposure'?3:4);
  if(mode==='changed instrumentation'){await saveField(f.context(),f.dbId,{operationKey:'alter-measurement-definition',expectedRevisionId:f.fieldRevision,field:{id:f.valueField,name:'Different duration definition',type:'number',config:{},position:0}});await expect(collectMeasurements(f.context(),f.trialId)).rejects.toMatchObject({code:'INSTRUMENTATION_CHANGED'});}
  f.advance(f.plan.endsAt);const result=await concludeTrial(f.context(),{id:f.trialId,operationKey:'u6-incomplete-conclude',expectedRevisionId:active.value.revisionId,instrumentationRevision:f.plan.instrumentationRevision});
  expect(result.value.outcome.classification).toBe('inconclusive');expect(result.value.outcome.disconfirms).toBe(false);expect(result.value.outcome.instrumentation.state).toBe(mode==='changed instrumentation'?'changed':'unchanged');
  if(mode==='missing exposure')expect((await effects(f.trialId)).map(e=>e.state)).toEqual(['confirmed','uncertain']);
  expect(f.wire.sends).toHaveLength(mode==='empty measurements'?0:2);

  }finally{vi.useRealTimers();vi.unstubAllGlobals();}
 }
});
