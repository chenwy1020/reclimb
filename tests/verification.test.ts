import {z} from 'zod';
import {reviewedHelpSchema,reviewedAssessmentSchema} from '../src/main/verification-schemas';
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LearningStore} from '../src/main/store';import {CallRunner} from '../src/main/call-runner';
import {teachingContentHash,VerificationService} from '../src/main/verification-service';
const stores:LearningStore[]=[];afterEach(()=>{for(const store of stores.splice(0))store.close();});
const review=(status='ready')=>({status,summary:'独立核对已完成',issues:status==='ready'?[]:[{kind:'conditions',message:'第三问前提不成立'}],privateSolution:'私有核对：先验证前提。',branches:[{id:'all',condition:'普通任务',applicability:'applies',criterionIndexes:[0],expectedBehavior:'给出相应判断'}],exposureRelations:[],mathChecks:[]});
async function fixture(respond:(input:any)=>unknown=()=>review()){
 const store=await LearningStore.open(mkdtempSync(join(tmpdir(),'reclimb-verification-')));stores.push(store);store.updateSettings({monthlyBudgetCny:100});const inputs:any[]=[],requests:any[]=[];const runner=new CallRunner(store,()=> 'local-key',()=>({complete:async request=>{const input=JSON.parse(request.user);inputs.push(input);requests.push(request);return {text:JSON.stringify(respond(input)),inputTokens:1,outputTokens:1,usageKnown:true};}}));const service=new VerificationService(store,runner);
 const activity={id:'task',title:'检查条件',instruction:'判断给定的条件是否足够。',kind:'diagnosis' as const,rubric:['检查条件是否足够'],sourceIds:[],assessmentBasis:'ai' as const};
 const version=service.createVersion({projectId:'p',capabilityId:'c',activity,steps:[{id:'step',taskId:'task',action:'attempt',title:activity.title,content:activity.instruction,activity,sourceIds:[],createdAt:'2026-09-08T00:00:00Z'}],sources:[]});return {store,service,inputs,requests,version};
}
it('binds readiness to the complete immutable teaching version, including earlier explanations',async()=>{
 const t=await fixture();await t.service.review(t.version);expect(t.service.getView(t.version.id).canAssess).toBe(true);const altered={...t.version,steps:t.version.steps.map(step=>({...step,content:'改成另一项主张'}))};expect(teachingContentHash(altered)).not.toBe(t.version.contentHash);expect(()=>t.store.put('teachingVersions',altered)).toThrow('不可覆盖');expect(t.service.getView(t.version.id).canAssess).toBe(true);
});
it('reviews the full teaching unit in an independent context without learner attempts',async()=>{
 const t=await fixture();await t.service.review(t.version);expect(t.inputs[0].operation).toBe('review_teaching');expect(t.inputs[0].teaching.steps).toEqual(t.version.steps);expect(t.inputs[0]).not.toHaveProperty('answer');expect(t.inputs[0]).not.toHaveProperty('history');expect(t.store.list('taskReviews')[0].privateSolution).toContain('私有核对');
});
it('does not permit evaluation when the reviewer cannot confirm task validity',async()=>{
 const t=await fixture(()=>review('uncertain'));await t.service.review(t.version);expect(t.service.getView(t.version.id)).toMatchObject({status:'uncertain',canAssess:false});
});
it('keeps repeated challenges in a persistent issue and suspends the version',async()=>{
 const t=await fixture();await t.service.review(t.version);const session:any={id:'s',projectId:'p',capabilityId:'c',activity:t.version.activity,teachingVersionId:t.version.id};const first=t.service.openDispute(session,'第二问的前提不成立');const again=t.service.openDispute(session,'我已经说明了这个条件不成立');expect(again.id).toBe(first.id);expect(again.messages).toHaveLength(2);expect(t.store.list('disputes')).toHaveLength(1);expect(t.store.list('corrections').filter(c=>c.action==='suspend')).toHaveLength(1);expect(t.service.getView(t.version.id).canAssess).toBe(false);
});

it('uses exact local arithmetic to reject a falsely approved calculation without claiming to prove the full task',async()=>{
 const t=await fixture(()=>({...review(),mathChecks:[{id:'poly',kind:'polynomial_evaluate',claim:'在三处的值为负',assumptions:['使用给定多项式'],coefficients:['0','0','1','-1/4'],at:'3',expected:'-9/4'}]}));const result=await t.service.review(t.version);expect(result.status).toBe('needs_correction');const check=JSON.parse(result.localChecks[0].details);expect(check.actual).toBe('9/4');expect(check.status).toBe('failed');expect(check.scope).toBeTruthy();
});
it('separates answer-exposure coverage from whether the complete teaching task is valid after sixty earlier exposures',async()=>{
 const t=await fixture(input=>({...review(),exposureRelations:input.exposures.map((e:any)=>({exposureId:e.id,relation:'different_task',reason:'不同问题'}))}));for(let i=0;i<61;i++)t.store.put('answerExposures',{id:'seen'+i,projectId:'p',capabilityId:'c',sessionId:'old',taskId:'old'+i,kind:'answer',text:'旧示例'+i,createdAt:'2026-09-01T00:00:00Z'});const result=await t.service.review(t.version);expect(result.status).toBe('ready');expect(result.exposureCoverageComplete).toBe(false);expect(t.service.getView(t.version.id).canAssess).toBe(true);expect(t.inputs[0].exposures).toHaveLength(60);
});

it('does not approve critical mathematical claims from unconfirmed OCR merely because source IDs are valid',async()=>{
 const t=await fixture(()=>review());const activity={...t.version.activity,id:'ocr-task',sourceIds:['ocr']};const version=t.service.createVersion({projectId:'p',capabilityId:'c',activity,steps:[{...t.version.steps[0],id:'ocr-step',taskId:'ocr-task',activity,sourceIds:['ocr']}],sources:[{id:'ocr',locator:'第1页',text:'OCR中的不等号尚不明确',warnings:['OCR文本尚未核对数学符号'],transcriptionIds:[]}]});const result=await t.service.review(version);expect(result.status).toBe('uncertain');expect(t.service.getView(version.id).canAssess).toBe(false);
});
it('keeps a critical OCR dependence uncertain even when the model marks the task ready',async()=>{
 const t=await fixture(()=>({...review(),sourceChecks:[{sourceId:'ocr',usesCriticalSymbols:true,independentlyEstablished:false,reason:'结论依赖模糊的不等号'}]}));const activity={...t.version.activity,id:'ocr-task',sourceIds:['ocr']};const version=t.service.createVersion({projectId:'p',capabilityId:'c',activity,steps:[{...t.version.steps[0],id:'ocr-step',taskId:'ocr-task',activity,sourceIds:['ocr']}],sources:[{id:'ocr',locator:'第1页',text:'模糊的不等号',warnings:['数学符号待核'],transcriptionIds:[]}]});expect((await t.service.review(version)).status).toBe('uncertain');
});

it('does not approve contradictory applicability for the same stable rubric item',async()=>{
 const t=await fixture(()=>({...review(),branches:[{id:'yes',condition:'当前题设成立',applicability:'applies',criterionIndexes:[0],expectedBehavior:'执行此项'},{id:'no',condition:'当前题设不成立',applicability:'does_not_apply',criterionIndexes:[0],expectedBehavior:'不执行此项'}]}));expect((await t.service.review(t.version)).status).toBe('uncertain');expect(t.service.getView(t.version.id).canAssess).toBe(false);
});

it('does not treat one confirmed crop as confirmation of other unresolved formulas on the same page',async()=>{
 const t=await fixture(()=>review()),activity={...t.version.activity,id:'partial-task',sourceIds:['partial']};const version=t.service.createVersion({projectId:'p',capabilityId:'c',activity,steps:[{...t.version.steps[0],taskId:activity.id,activity,sourceIds:['partial']}],sources:[{id:'partial',locator:'第1页',text:'仅选区公式已确认；其他公式来自提取文本',warnings:['页面其余部分未验证，仍需对照原页'],transcriptionIds:['confirmed-crop']}]});expect((await t.service.review(version)).status).toBe('uncertain');
});

it('offers exact current ID enums and repairs an invented review step once before saving the valid review',async()=>{
 const t=await fixture(raw=>({...review('needs_correction'),issues:[{kind:'conditions',message:'核对这一具体步骤',stepId:raw.repair?'step':'invented-step'}]}));const result=await t.service.review(t.version);expect(t.inputs).toHaveLength(2);expect(result.status).toBe('needs_correction');expect(result.issues[0].stepId).toBe('step');const props=t.requests[0].schema.properties;expect(props.issues.items.properties.stepId.enum).toEqual(['step']);expect(props.sourceChecks.maxItems).toBe(0);expect(props.exposureRelations.maxItems).toBe(0);expect(props.assessmentFindings.maxItems).toBe(0);expect(t.store.list('taskReviews')).toHaveLength(1);
});
it('constrains review source and exposure IDs to the exact supplied records',async()=>{
 const t=await fixture(input=>({...review(),exposureRelations:input.exposures.map((e:any)=>({exposureId:e.id,relation:'different_task',reason:'核对为不同例子'})),sourceChecks:[{sourceId:'actual-source',usesCriticalSymbols:false,independentlyEstablished:true,reason:'文本不依赖模糊公式'}]}));t.store.put('answerExposures',{id:'actual-exposure',projectId:'p',capabilityId:'c',sessionId:'old',taskId:'old',kind:'answer',text:'另一题',createdAt:'2026-09-01T00:00:00Z'});const version=t.service.createVersion({projectId:'p',capabilityId:'c',activity:t.version.activity,steps:t.version.steps,sources:[{id:'actual-source',locator:'当前段',text:'本地材料',warnings:[],transcriptionIds:[]}]});await t.service.review(version);const props=t.requests[0].schema.properties;expect(props.sourceChecks.items.properties.sourceId.enum).toEqual(['actual-source']);expect(props.exposureRelations.items.properties.exposureId.enum).toEqual(['actual-exposure']);expect(props.assessmentFindings.maxItems).toBe(0);
});

it('publishes an object-root assessment schema while requiring exactly one complete assessment or dispute',()=>{
 const schema=reviewedAssessmentSchema(['source'],['criterion']),json=z.toJSONSchema(schema) as any;expect(json.type).toBe('object');expect(json.anyOf).toBeUndefined();const assessment={outcome:'met',feedback:'给出有效解释',criteria:[{criterion:'原标准的等价表述',criterionId:'criterion',result:'met',reason:'已说明'}],limitations:[],sourceIds:['source']};expect(schema.safeParse(assessment).success).toBe(true);expect(schema.safeParse({dispute:{issue:'条件不足',reason:'需核查'}}).success).toBe(true);expect(schema.safeParse({...assessment,dispute:{issue:'不能同时评分',reason:'互斥'}}).success).toBe(false);expect(schema.safeParse({}).success).toBe(false);expect(schema.safeParse({outcome:'met'}).success).toBe(false);
});

it('keeps help and semantic challenge replies compatible with object-root provider grammars',()=>{
 const schema=reviewedHelpSchema(['source']),json=z.toJSONSchema(schema) as any;expect(json.type).toBe('object');expect(json.anyOf).toBeUndefined();expect(schema.safeParse({dispute:{issue:'条件缺失',reason:'需核对'}}).success).toBe(true);expect(schema.safeParse({text:'一个提示',sourceIds:['source'],scope:'concept'}).success).toBe(true);expect(schema.safeParse({text:'同时提示',dispute:{issue:'同时质疑',reason:'互斥'}}).success).toBe(false);
});
