import {env} from 'cloudflare:test';
import {expect,vi} from 'vitest';
import {fixture} from './fixture';
import {replaceBlocks} from '../../../../src/core/features/editor/service';
import {saveGrant} from '../../../../src/core/features/sharing/grants';
import {answer,providerResponse} from '../../../qualification/inquiry/fixture';
import {createSkill,transitionSkill} from '../../../../src/core/features/skills/service';
import {freezeCases} from '../../../../src/core/features/skills/cases';
import {evaluateSkill} from '../../../../src/core/features/skills/evaluations';
import {recordExpertBaseline} from '../../../../src/core/features/skills/expert';
import {startRun} from '../../../../src/core/features/runs/service';
import {consumeIntelligenceJob} from '../../../../src/core/features/runs/worker';
import {requireRun} from '../../../../src/core/features/runs/repository';
import {answerSchema} from '../../../../src/core/features/ai/contracts';
import type {AppBindings} from '../../../../src/core/app/types';
export async function maintenanceFixture(){
 const f=await fixture(),calls:string[]=[];let proposedChanges:{targetId:string;text:string;evidenceIds:string[]}[]=[];
 vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const u=String(input instanceof Request?input.url:input);if(u!=='https://api.openai.com/v1/responses'||init?.method!=='POST')throw Error('Unmatched maintenance test transport: '+u);calls.push(u);return providerResponse({...answer,proposedChanges});});
 await saveGrant(f.context(),{operationKey:'maintenance-private-source',id:f.readerGrant,targetKind:'page',targetId:f.page.pageId,principalKind:'member',principalId:f.reader,level:'view',revoke:true});
 const doc=await replaceBlocks(f.context(),f.page.pageId,{operationKey:'maintenance-valid-document',expectedRevisionId:f.page.revisionId,blocks:[{id:'maintenance-block-'+f.workspaceId,blockType:'paragraph',treePosition:'0',content:{text:[{text:'The source is available.'}]}}]});
 f.refs=[{kind:'page',sourceId:f.page.pageId,revisionId:doc.value.revisionId}];f.ask={...f.ask,refs:f.refs};
 const skill=await createSkill(f.context(),{operationKey:'maintenance-skill',pageId:f.page.pageId,name:'Synthetic maintenance mechanics',definition:{instructions:'Cite exact source evidence. Propose only the requested local repair.',refs:f.refs,audience:[f.owner],tools:['read-evidence','propose'],effects:['page.maintain'],preconditions:['Current source'],successTests:['The source is available.'],escalations:['Missing exact authority'],maxCostMicros:1000000}});
 const cutoff=f.context().now,testCase={name:'Synthetic development case',question:'Is the test source available?',requiredEvidenceIds:['E1'],requiredStatements:['The source is available.'],forbiddenStatements:['Charged account'],maximumOwnerSeconds:30};
 const cases=await freezeCases(f.context(),{operationKey:'maintenance-cases',revisionId:skill.value.revisionId,cutoff,refs:f.refs,cases:[testCase]});
 const binding={...env,AI_API_KEY:'test-only'} as AppBindings;
 const candidate=await startRun(f.context(),{...f.ask,operationKey:'manual-candidate',question:testCase.question,audience:[f.owner],skillRevisionId:skill.value.revisionId},{apiKey:'test-only'},undefined,cases.value.id);
 const generic=await startRun(f.context(),{...f.ask,operationKey:'manual-generic',question:testCase.question,audience:[f.owner]},{apiKey:'test-only'},undefined,cases.value.id);
 for(const run of [candidate,generic]){await consumeIntelligenceJob(binding,{kind:'intelligence.run',workspaceId:f.workspaceId,runId:run.value.id});expect((await requireRun(f.context(),run.value.id)).status).toBe('completed');}
 const now=f.context().now;
 const expert=await recordExpertBaseline(f.context(),{operationKey:'synthetic-current-process',pageId:f.page.pageId,caseSetId:cases.value.id,question:testCase.question,refs:f.refs,answer:answerSchema.parse(answer),startedAt:now,endedAt:now,ownerSeconds:1,toolCostMicros:0,method:'Synthetic development baseline input only; no human performance or value claim.'});
 const {question,...criteria}=testCase;
 const evaluation=await evaluateSkill(f.context(),{operationKey:'maintenance-evaluate',revisionId:skill.value.revisionId,caseSetId:cases.value.id,cutoff,cases:[{...criteria,candidateRunId:candidate.value.id,genericRunId:generic.value.id,expertRunId:expert.value.id,candidateOwnerSeconds:1,genericOwnerSeconds:1,expertOwnerSeconds:1}]});expect(evaluation.value.passed).toBe(true);
 await transitionSkill(f.context(),{operationKey:'maintenance-activate',revisionId:skill.value.revisionId,action:'activate'});
 proposedChanges=[{targetId:f.page.pageId,text:'Determinate local repair',evidenceIds:['E1']},{targetId:f.page.pageId,text:'Related granted follow-through',evidenceIds:['E1']}];
 const run=await startRun(f.context(),{...f.ask,operationKey:'maintenance-proposal',question:'Prepare the determinate local repair.',kind:'edit',audience:[f.owner],skillRevisionId:skill.value.revisionId},{apiKey:'test-only'});
 await consumeIntelligenceJob(binding,{kind:'intelligence.run',workspaceId:f.workspaceId,runId:run.value.id});const row=await requireRun(f.context(),run.value.id);
 expect(row).toMatchObject({status:'needs-review',skill_revision_id:skill.value.revisionId});expect(JSON.parse(row.output_json!).answer.proposedChanges).toEqual(proposedChanges);expect(calls).toHaveLength(3);
 return {...f,run,row,skill,evaluation,proposedChanges,calls};
}
