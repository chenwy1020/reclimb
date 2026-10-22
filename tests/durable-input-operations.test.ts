import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';
import {VerificationService} from '../src/main/verification-service';
import {CallRunner} from '../src/main/call-runner';
import {HandwritingService} from '../src/main/handwriting-service';
import {HandwritingFeedbackService} from '../src/main/handwriting-recognition';
import type {Session} from '../src/shared/types';

const stores:LearningStore[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const store of stores.splice(0))store.close();});
const assessment=(input:any)=>({outcome:'met',feedback:'说明了比较依据',criteria:input.activity.rubric.map((criterion:string,index:number)=>({criterion,criterionId:input.activity.rubricIds[index],result:'met',reason:'明确比较大小'})),limitations:[],sourceIds:[]});
async function fixture(reply?:(input:any)=>any){
 const store=await LearningStore.open(mkdtempSync(join(tmpdir(),'reclimb-durable-')));stores.push(store);store.updateSettings({monthlyBudgetCny:100});
 const now=new Date().toISOString();store.put('projects',{id:'p',title:'比较',goal:'说明依据',status:'active',createdAt:now,updatedAt:now});store.put('capabilities',{id:'c',projectId:'p',title:'比较',description:'说明依据',sourceIds:[],prerequisites:[],order:0});
 const calls:any[]=[],provider={complete:async(request:any)=>{const input=JSON.parse(request.user);calls.push(input);return {text:JSON.stringify(reply?await reply(input):input.operation?{text:'先看比较对象',sourceIds:[],scope:'concept'}:assessment(input)),inputTokens:1,outputTokens:1,usageKnown:true};}};
 const verifier=new VerificationService(store,new CallRunner(store,()=> 'test',()=>provider)),activity={id:'task',title:'比较',instruction:'比较 3 和 5 并说明依据。',kind:'selection' as const,rubric:['说明比较依据'],sourceIds:[],assessmentBasis:'ai' as const};
 const version=verifier.createVersion({projectId:'p',capabilityId:'c',activity,steps:[{id:'step',taskId:'task',action:'attempt',title:'比较',content:activity.instruction,sourceIds:[],activity,createdAt:now}],sources:[]});
 store.put('taskReviews',{id:'review',projectId:'p',teachingVersionId:version.id,contentHash:version.contentHash,status:'ready',summary:'已核对',privateSolution:'5 大于 3',branches:[],issues:[],exposureRelations:[],localChecks:[],reviewPolicyVersion:'policy-1',createdAt:now,reviewerModel:'fake'});
 const session:Session={id:'s',projectId:'p',capabilityId:'c',activity:version.activity,teachingVersionId:version.id,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'原稿',helpLevel:0,helpEvents:[],messages:[],checkpoint:'原位置',nextStep:'继续',teaching:{version:1,current:version.steps[0],history:[],upcoming:[],guidance:'guided',confusionCount:0}};
 store.put('sessions',session);const service=new LearningService(store,()=> 'test',()=>provider);
 return {store,service,verifier,version,session,calls};
}
function record(t:Awaited<ReturnType<typeof fixture>>,requestId='request'){return t.service.recordInput('s',{requestId,text:'5 比 3 大，因为差为正',kind:'attempt'});}
function validationRun(t:Awaited<ReturnType<typeof fixture>>){
 const stamp=t.session.createdAt;
 t.store.put('validationSets',{id:'validation-set',projectId:'p',title:'固定验证',description:'事务测试',createdAt:stamp,updatedAt:stamp});
 t.store.put('validationTasks',{id:'validation-task',projectId:'p',setId:'validation-set',familyId:'validation-family',version:1,title:'固定题',prompt:t.session.activity.instruction,referenceAnswer:'5 大于 3',rubric:t.session.activity.rubric,source:{kind:'authored',citation:'事务测试夹具'},review:{status:'reviewed',reviewer:'测试',basis:'固定题设'},comparableGroup:'',conditions:'无提示',transferRationale:'',createdAt:stamp});
 t.store.put('validationRuns',{id:'validation-run',projectId:'p',requestId:'validation-run',setId:'validation-set',taskId:'validation-task',sessionId:'s',phase:'before',kind:'standard',status:'active',startedAt:stamp,selfReportedExposure:'',exposures:[]});
}
it('saves an operation with the immutable input before any external call',async()=>{
 const t=await fixture(),receipt=record(t);expect(t.calls).toHaveLength(0);
 expect(t.store.list('operations')).toContainEqual(expect.objectContaining({projectId:'p',kind:'input_response',phase:'saved',refs:expect.objectContaining({sessionId:'s',inputId:receipt.inputId,attemptId:receipt.attemptId})}));
});

it('retains a paid valid result after publication failure and resumes after reopen without another call or duplicate evidence',async()=>{
 const t=await fixture(),receipt=record(t),put=t.store.put.bind(t.store);let fail=true;
 // Inject only an atomic write failure; all transaction, rollback and reopen behavior is real.
 const fault=vi.spyOn(t.store,'put').mockImplementation(((collection:any,entity:any)=>{if(fail&&collection==='operations'&&entity.phase==='completed'){fail=false;throw new Error('模拟发布写入失败');}return put(collection,entity);}) as any);
 await expect(t.service.respondInput('s',receipt.inputId)).rejects.toThrow('写入失败');fault.mockRestore();
 expect(t.store.list('evidence')).toHaveLength(0);expect(t.store.list('operations')[0]).toMatchObject({phase:'result_saved',result:expect.anything()});
 const directory=t.store.dataDirectory;t.store.close();const reopened=await LearningStore.open(directory);stores.push(reopened);let calls=0;
 const service=new LearningService(reopened,()=>'',()=>({complete:async()=>{calls++;throw new Error('恢复不能联网');}}));
 expect(calls).toBe(0);const operation=reopened.list('operations')[0];await service.resumeOperation(operation.id);await service.resumeOperation(operation.id);
 expect(calls).toBe(0);expect(reopened.list('evidence')).toHaveLength(1);expect(reopened.list('operations')[0].phase).toBe('completed');expect(reopened.list('usage')).toHaveLength(1);expect(reopened.list('usage')[0].publicationStatus).toBe('published');
 expect(reopened.get('sessions','s')!.messages.filter(message=>message.role==='assistant'&&message.inputId===receipt.inputId)).toHaveLength(1);
});

it('commits a fixed validation result with feedback, evidence and operation, then resumes the saved model result locally after a validation write failure',async()=>{
 const t=await fixture(),receipt=record(t);validationRun(t);const put=t.store.put.bind(t.store);let fail=true;
 const fault=vi.spyOn(t.store,'put').mockImplementation(((collection:any,entity:any)=>{if(fail&&collection==='validationRuns'&&entity.status==='completed'){fail=false;throw new Error('模拟验证记录提交失败');}return put(collection,entity);}) as any);
 await expect(t.service.respondInput('s',receipt.inputId)).rejects.toThrow('验证记录提交失败');fault.mockRestore();
 expect(t.store.list('evidence')).toEqual([]);const rolledBackRun=t.store.get('validationRuns','validation-run')!;expect(rolledBackRun.status).toBe('active');expect(rolledBackRun.attemptId).toBeUndefined();expect(rolledBackRun.evidenceId).toBeUndefined();expect(t.store.list('operations')[0]).toMatchObject({phase:'result_saved',result:expect.anything()});expect(t.store.get('sessions','s')!.messages.filter(message=>message.role==='assistant')).toEqual([]);
 const operation=t.store.list('operations')[0];await t.service.resumeOperation(operation.id);await t.service.resumeOperation(operation.id);
 expect(t.calls).toHaveLength(1);const evidence=t.store.list('evidence');expect(evidence).toHaveLength(1);expect(t.store.get('validationRuns','validation-run')).toMatchObject({status:'completed',attemptId:receipt.attemptId,evidenceId:evidence[0].id});expect(t.store.list('operations')[0].phase).toBe('completed');expect(t.store.get('sessions','s')!.messages.filter(message=>message.role==='assistant'&&message.inputId===receipt.inputId)).toHaveLength(1);
});
it('keeps unknown usage uncertain and does not issue a paid retry through local resume',async()=>{
 const t=await fixture(()=>{throw new Error('连接中断，费用未知');}),receipt=record(t);await expect(t.service.respondInput('s',receipt.inputId)).rejects.toThrow('连接中断');
 const operation=t.store.list('operations')[0];expect(operation?.phase).toBe('interrupted');expect(t.store.list('usage')[0].status).toBe('uncertain');
 await expect(t.service.resumeOperation(operation.id)).rejects.toThrow();expect(t.calls).toHaveLength(1);expect(t.store.get('attempts',receipt.attemptId!)?.text).toContain('差为正');
});

it.each(['review','rubric','correction'] as const)('archives feedback when the exact %s basis changes during assessment',async change=>{
 let t:Awaited<ReturnType<typeof fixture>>;t=await fixture(value=>{
  if(change==='review')t.store.put('taskReviews',{...t.store.get('taskReviews','review')!,id:'review-revised',reviewPolicyVersion:'policy-2'});
  if(change==='rubric'){const revised=t.verifier.createVersion({projectId:'p',capabilityId:'c',activity:{...t.version.activity,rubric:['解释另一条件']},steps:t.version.steps,sources:[],origin:'correction',replacesVersionId:t.version.id});t.verifier.correct(t.version.id,'replace','评价标准已修订',{replacementVersionId:revised.id});}
  if(change==='correction'){t.verifier.correct(t.version.id,'suspend','条件需要核对');t.verifier.correct(t.version.id,'restore','题目可以使用，但旧调用依据已经变化');}
  return assessment(value);
 });const receipt=record(t);await expect(t.service.respondInput('s',receipt.inputId)).rejects.toThrow();
 expect(t.store.list('evidence')).toHaveLength(0);expect(t.store.list('operations')[0]).toMatchObject({phase:'stale',result:expect.anything()});expect(t.store.list('usage')[0].status).toBe('completed');expect(t.store.list('usage')[0].publicationStatus).toBe('discarded');expect(t.store.get('attempts',receipt.attemptId!)?.text).toContain('差为正');
});

it('allows legal historical feedback after a newer attempt and page change without advancing the new mainline',async()=>{
 let release!:(value:any)=>void,started!:()=>void;const began=new Promise<void>(resolve=>started=resolve);let sent:any;
 const t=await fixture(value=>{sent=value;started();return new Promise(resolve=>release=resolve);}),receipt=record(t),running=t.service.respondInput('s',receipt.inputId);await began;
 record(t,'new-attempt');const session=t.store.get('sessions','s')!;t.store.put('sessions',{...session,draft:'新草稿',checkpoint:'新位置',activity:{...session.activity,id:'new-task'},teaching:{...session.teaching!,current:{...session.teaching!.current,id:'new-step',taskId:'new-task'}}});
 release(assessment(sent));await running;expect(t.store.list('evidence')).toHaveLength(1);expect(t.store.get('sessions','s')).toMatchObject({draft:'新草稿',checkpoint:'新位置',teaching:{current:{id:'new-step'}}});expect(t.store.list('operations')[0]?.phase).toBe('completed');
});

it('suspends machine-derived drafts and progression while preserving learner text after evidence is invalidated',async()=>{
 const t=await fixture(),receipt=record(t);await t.service.respondInput('s',receipt.inputId);const evidence=t.store.list('evidence')[0],session=t.store.get('sessions','s')!;
 const learner=t.service.saveUnderstanding('p',{unitId:session.unitId,phase:'expand',title:'我的解释',text:'我的原始推导'}),machine={...learner,id:'machine',blocks:learner.blocks.map(block=>({...block,author:'ai' as const,text:'机器建议'})),basedOnEvidenceIds:[evidence.id],basedOnTeachingVersionIds:[t.version.id],derivedStatus:'active' as const};t.store.put('understandingDrafts',machine);
 t.verifier.correct(t.version.id,'invalidate','先前评价错误',{evidenceId:evidence.id});t.verifier.correct(t.version.id,'restore','题目可以继续使用');
 t.service.listOperations('p');
 expect(t.store.get('understandingDrafts','machine')).toMatchObject({derivedStatus:'suspended'});expect(t.store.get('understandingDrafts',learner.id)?.blocks[0].text).toBe('我的原始推导');expect(t.store.get('attempts',receipt.attemptId!)?.text).toContain('差为正');expect(t.store.list('teachingObservations').find(item=>item.evidenceId===evidence.id)?.status).toBe('suspended');
});

it('uses separate input and operation identities for the same client request in different projects',async()=>{
 const t=await fixture(),first=record(t),now=new Date().toISOString();
 t.store.put('projects',{id:'q',title:'另一个项目',goal:'比较',status:'active',createdAt:now,updatedAt:now});t.store.put('capabilities',{...t.store.get('capabilities','c')!,id:'q-c',projectId:'q'});
 const version=t.verifier.createVersion({projectId:'q',capabilityId:'q-c',activity:t.version.activity,steps:t.version.steps,sources:[]});
 t.store.put('taskReviews',{...t.store.get('taskReviews','review')!,id:'q-review',projectId:'q',teachingVersionId:version.id,contentHash:version.contentHash});
 t.store.put('sessions',{...t.session,id:'q-s',projectId:'q',capabilityId:'q-c',teachingVersionId:version.id,activity:version.activity,teaching:{...t.session.teaching!,current:version.steps[0]}});
 const second=t.service.recordInput('q-s',{requestId:'request',text:'我的另一个答案',kind:'attempt'});
 expect(second.attemptId).not.toBe(first.attemptId);expect(t.store.get('attempts',first.attemptId!)?.text).toContain('差为正');expect(t.store.get('attempts',second.attemptId!)?.requestId).toBe('request');
 await t.service.respondInput('s',first.inputId);await t.service.respondInput('q-s',second.inputId);
 expect(t.store.list('evidence','p')).toHaveLength(1);expect(t.store.list('evidence','q')).toHaveLength(1);expect(new Set(t.store.list('operations').map(operation=>operation.requestId)).size).toBe(2);expect(t.store.list('usage')).toHaveLength(2);
});

it('archives an in-flight handwriting assessment when the same original receives a revised confirmed transcription',async()=>{
 let t:Awaited<ReturnType<typeof fixture>>,feedback:HandwritingFeedbackService,handwritingId:string;
 t=await fixture(value=>{feedback.confirm({handwritingId,requestId:'confirmation-2',text:'修正了原稿的转录内容',unresolved:false});return assessment(value);});
 const handwriting=new HandwritingService(t.store),target=handwriting.target('s'),original=handwriting.save({requestId:'original',targetId:target.id,note:'我的推导',pages:[{id:'page',width:768,height:1024,strokes:[{id:'stroke',color:'#253e31',width:3,points:[{x:.2,y:.3,pressure:.5}]}]}]});handwritingId=original.id;
 feedback=new HandwritingFeedbackService(t.store,t.service,new CallRunner(t.store,()=>''),()=> '');const confirmed=feedback.confirm({handwritingId,requestId:'confirmation-1',text:'比较后的原转录',unresolved:false});
 await expect(t.service.respondInput('s',confirmed.receipt.inputId)).rejects.toThrow();
 expect(t.store.list('evidence')).toHaveLength(0);expect(t.store.list('operations').find(operation=>operation.refs.inputId===confirmed.receipt.inputId)?.phase).toBe('stale');expect(t.store.get('attempts',confirmed.receipt.attemptId!)?.text).toBe('比较后的原转录');expect(t.store.list('handwritingTranscriptions')).toHaveLength(2);
});

it('reopens a running operation as interrupted while preserving uncertain reserved usage without contacting a model',async()=>{
 const t=await fixture(),receipt=record(t),operation=t.store.list('operations')[0];expect(operation).toBeDefined();
 t.store.put('operations',{...operation,phase:'running',callIds:['unknown-call']});t.store.put('usage',{id:'unknown-call',requestId:'unknown-call',operationId:'unknown-call',createdAt:new Date().toISOString(),kind:'评价尝试',model:'fake',inputTokens:0,outputTokens:0,estimatedCny:.15,status:'reserved',entryType:'call',validationStatus:'pending',publicationStatus:'pending'});
 const directory=t.store.dataDirectory;t.store.close();const reopened=await LearningStore.open(directory);stores.push(reopened);let calls=0;const service=new LearningService(reopened,()=>'',()=>({complete:async()=>{calls++;throw new Error('不能自动请求');}}));
 expect(reopened.list('operations')[0].phase).toBe('interrupted');expect(reopened.list('usage')[0]).toMatchObject({status:'reserved',estimatedCny:.15});await expect(service.resumeOperation(operation.id)).rejects.toThrow();expect(calls).toBe(0);expect(reopened.get('attempts',receipt.attemptId!)?.text).toContain('差为正');
});

it.each(['discussion','dispute'] as const)('resumes a saved %s exactly once with help and dispute records in the same commit',async mode=>{
 const t=await fixture(()=>mode==='discussion'?{text:'共同分析的回应',sourceIds:[],scope:'current_task'}:{dispute:{issue:'条件不足',reason:'需要先核对比较对象'}}),receipt=t.service.recordInput('s',{requestId:'note',text:'我不确定这一步',kind:'note'}),put=t.store.put.bind(t.store);let fail=true;
 const fault=vi.spyOn(t.store,'put').mockImplementation(((collection:any,entity:any)=>{if(fail&&collection==='operations'&&entity.phase==='completed'){fail=false;throw new Error('模拟发布写入失败');}return put(collection,entity);}) as any);
 await expect(t.service.respondInput('s',receipt.inputId)).rejects.toThrow('写入失败');fault.mockRestore();
 expect(t.store.list('disputes')).toHaveLength(0);expect(t.store.list('answerExposures')).toHaveLength(0);
 const operation=t.store.list('operations')[0];await t.service.resumeOperation(operation.id);await t.service.resumeOperation(operation.id);
 expect(t.calls).toHaveLength(1);expect(t.store.list('evidence')).toHaveLength(0);expect(t.store.list('disputes')).toHaveLength(mode==='dispute'?1:0);expect(t.store.list('answerExposures')).toHaveLength(1);expect(t.store.get('sessions','s')!.messages.filter(message=>message.role==='assistant'&&message.inputId===receipt.inputId)).toHaveLength(1);expect(t.store.get('sessions','s')!.helpEvents).toHaveLength(1);
});

it('keeps provenance when a learner edits an AI understanding suggestion, so a later correction suspends reuse without deleting text',async()=>{
 const t=await fixture(value=>value.operation==='suggest_understanding'?{title:'理解建议',blocks:[{text:'结合比较对象说明依据。',sourceIds:[]}]}:assessment(value)),receipt=record(t);await t.service.respondInput('s',receipt.inputId);const evidence=t.store.list('evidence')[0],session=t.store.get('sessions','s')!;
 const suggestion=await t.service.suggestUnderstanding('p',session.unitId,'expand');expect(suggestion.basedOnEvidenceIds).toEqual([evidence.id]);
 const edited=t.service.saveUnderstanding('p',{unitId:session.unitId,phase:'expand',title:'我的修改',text:'我补充了比较前需要统一单位。',basedOnDraftId:suggestion.id});
 t.verifier.correct(t.version.id,'invalidate','之前评价遗漏了条件',{evidenceId:evidence.id});
 expect(t.store.get('understandingDrafts',edited.id)).toMatchObject({derivedStatus:'suspended',blocks:[expect.objectContaining({author:'learner_edited_ai',text:'我补充了比较前需要统一单位。'})]});
 expect(t.store.get('learningPositions',t.store.get('projects','p')!.learningPositionId!)).toMatchObject({derivedStatus:'suspended'});
});

it('keeps an already suspended AI draft and its position suspended when edited, preserving the new learner text immediately',async()=>{
 const t=await fixture(value=>value.operation==='suggest_understanding'?{title:'理解建议',blocks:[{text:'结合比较对象说明依据。',sourceIds:[]}]}:assessment(value)),receipt=record(t);await t.service.respondInput('s',receipt.inputId);const evidence=t.store.list('evidence')[0],session=t.store.get('sessions','s')!,suggestion=await t.service.suggestUnderstanding('p',session.unitId,'expand');
 t.verifier.correct(t.version.id,'invalidate','原评审依据不成立',{evidenceId:evidence.id});expect(t.store.get('understandingDrafts',suggestion.id)?.derivedStatus).toBe('suspended');
 const edited=t.service.saveUnderstanding('p',{unitId:session.unitId,phase:'expand',title:'继续保留文字',text:'我重新检查了这个条件，暂时保持未确定。',basedOnDraftId:suggestion.id});
 expect(edited.derivedStatus).toBe('suspended');expect(edited.blocks[0].text).toContain('重新检查');expect(t.store.get('learningPositions',t.store.get('projects','p')!.learningPositionId!)?.derivedStatus).toBe('suspended');
});
