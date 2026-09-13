import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';
import {writeBackup,readBackup} from '../src/main/backup';
import {teachingContentHash} from '../src/main/verification-service';
import {reviewedTeaching,withCriterionIds} from './helpers/review-response';

const stores:LearningStore[]=[];
afterEach(()=>{for(const store of stores.splice(0))store.close();});
async function setup(reply?:(input:any)=>any,reviewer:(input:any)=>any=reviewedTeaching,referenceAnswer?:string){
 const store=await LearningStore.open(mkdtempSync(join(tmpdir(),'reclimb-followup-')));stores.push(store);const now=new Date().toISOString(),path=join(store.dataDirectory,'original.md');writeFileSync(path,'原创材料：集合中的最大值不小于该集合内任何值。');
 store.updateSettings({monthlyBudgetCny:100});store.put('projects',{id:'p',title:'原创数值比较',goal:'理解列表比较',status:'active',createdAt:now,updatedAt:now});
 store.put('materials',{id:'m',projectId:'p',title:'原创比较资料',kind:'md',originalName:'original.md',storedPath:path,importedAt:now,warnings:[],fragmentCount:1,summary:'比较对象与判断依据'});
 store.put('fragments',{id:'f',projectId:'p',materialId:'m',locator:'第一段',ordinal:0,text:'集合中的最大值不小于该集合内任何值。'});
 store.put('capabilities',{id:'c',projectId:'p',title:'说明比较依据',description:'依据所有数值进行比较',prerequisites:[],sourceIds:['f'],order:0});
 const calls:any[]=[];const factory=()=>({complete:async(request:any)=>{const raw=JSON.parse(request.user),input=raw.original??raw;calls.push(input);let result;
  if(input.operation==='review_teaching')result=reviewer(input);
  else if(input.operation==='discuss_followup')result=reply?await reply(input):{text:'一个不同例子：集合中每个数都与候选值比较。',sourceIds:['f'],scope:'other_example'};
  else if('answer' in input)result={outcome:'met',feedback:'已按原标准说明比较过程。',criteria:input.activity.rubric.map((criterion:string)=>({criterion,result:'met',reason:'明确比较了所有值'})),limitations:[],sourceIds:['f']};
  else {const independent=input.intent==='independent',activity={title:independent?'新的列表比较':'原来的列表比较',instruction:independent?'给定3、8、4，说明如何找出最大值。':'给定2、5、1，说明比较所有数值的过程。',kind:'selection',rubric:['说明逐项比较的依据'],sourceIds:['f'],assessmentBasis:'source',...(referenceAnswer?{referenceAnswer}:{})};result={steps:independent?[{action:'check',title:activity.title,content:'自己解释新例子的比较过程。',sourceIds:['f'],activity}]:[{action:'explain',title:'原解释',content:'最大值是不小于集合中其他值的成员。',sourceIds:['f']},{action:'attempt',title:activity.title,content:'留下你的比较思路。',sourceIds:['f'],activity}]};}
  return {text:JSON.stringify(withCriterionIds(result,input)),inputTokens:10,outputTokens:10,usageKnown:true};}});
 const service=new LearningService(store,()=> 'local-test-key',factory);let session=await service.start('p','c');
 // Model-generated tasks omit hidden answers; emulate only a legacy stored task for this regression.
 if(referenceAnswer){const original=store.get('teachingVersions',session.teachingVersionId!)!,id=original.id+'-legacy-fixture',activity={...original.activity,teachingVersionId:id,referenceAnswer},steps=original.steps.map(step=>({...step,teachingVersionId:id,...(step.activity?{activity}:{})})),version={...original,id,origin:'legacy' as const,activity,steps};store.put('teachingVersions',{...version,contentHash:teachingContentHash(version)});session={...session,activity,teachingVersionId:id,teaching:{...session.teaching!,current:steps[0],upcoming:steps.slice(1)}};store.put('sessions',session);}
 return{store,service,session,calls,factory};
}
const context=(session:any)=>({task:session.activity,version:session.teachingVersionId,teaching:session.teaching,draft:session.draft,checkpoint:session.checkpoint,nextStep:session.nextStep});

it('anchors a historical step in a saved discussion without switching the newer task or trusting client content',async()=>{
 const t=await setup(),step=t.session.teaching!.current;await t.service.nextStep(t.session.id,'continue');await t.service.nextStep(t.session.id,'independent');t.service.saveDraft(t.session.id,'新题草稿');const before=context(t.store.get('sessions',t.session.id)),callCount=t.calls.length;
 const request={requestId:'history-question',kind:'explore' as const,text:'请为这段解释举个例子',followup:{kind:'step' as const,id:step.id,intent:'example' as const,text:'客户端伪造内容'}};
 const receipt=t.service.recordInput(t.session.id,request);expect(t.calls).toHaveLength(callCount);expect(receipt.responseMode).toBe('discussion');
 await t.service.respondInput(t.session.id,receipt.inputId);const input=t.calls.at(-1);expect(input.operation).toBe('discuss_followup');expect(input.anchor.text).toBe(step.content);expect(input.activity.instruction).toBe(t.session.activity.instruction);expect(input.anchor.text).not.toContain('客户端');expect(input.anchor.sources).toBeUndefined();expect(input.rootAnchor.sources).toBeUndefined();expect(input.sources[0].id).toBe('f');
 expect(context(t.store.get('sessions',t.session.id))).toEqual(before);expect(t.store.list('attempts')).toEqual([]);expect(t.store.list('evidence')).toEqual([]);
 const saved=t.store.get('sessions',t.session.id)!.messages.find(message=>message.inputId===receipt.inputId&&message.role==='user')!;expect(saved.followup).toMatchObject({id:step.id,kind:'step',rootInputId:receipt.inputId,teachingVersionId:t.session.teachingVersionId});
});
it('continues the selected reply through its own parent chain after unrelated messages and a restart',async()=>{
 const t=await setup(),first=t.service.recordInput(t.session.id,{requestId:'root',kind:'explore',text:'举一个例子',followup:{kind:'step',id:t.session.teaching!.current.id,intent:'example'}});await t.service.respondInput(t.session.id,first.inputId);
 let session=t.store.get('sessions',t.session.id)!;const parent=session.messages.find(message=>message.role==='assistant'&&message.inputId===first.inputId)!;
 t.store.put('sessions',{...session,messages:[...session.messages,...Array.from({length:10},(_,index)=>({id:'noise-'+index,role:'assistant' as const,kind:'hint',text:'无关支线消息'+index,teachingVersionId:session.teachingVersionId,taskId:session.activity.id,createdAt:new Date().toISOString()}))]});
 const follow=t.service.recordInput(session.id,{requestId:'next-round',kind:'explore',text:'这个例子的关键条件呢？',followup:{kind:'message',id:parent.id,intent:'question'}});
 const reopened=await LearningStore.open(t.store.dataDirectory);stores.push(reopened);const service=new LearningService(reopened,()=> 'local-test-key',t.factory);await service.respondInput(session.id,follow.inputId);
 const input=t.calls.at(-1);expect(input.anchor.text).toBe(parent.text);expect(input.thread.some((message:any)=>message.text==='举一个例子')).toBe(true);expect(JSON.stringify(input.thread)).not.toContain('无关支线消息');
 session=reopened.get('sessions',session.id)!;expect(session.messages.find(message=>message.inputId===follow.inputId&&message.role==='user')?.followup).toMatchObject({rootInputId:first.inputId,parentMessageId:parent.id});
 const backup=join(reopened.dataDirectory,'followup.reclimb');writeBackup(reopened,backup);const restored=readBackup(backup);expect(restored.records.sessions.find(item=>item.id===session.id)!.messages.find(message=>message.id===follow.inputId)!.followup!.rootInputId).toBe(first.inputId);
});
it('freezes a source transcription without inventing a teaching version and keeps later corrections separate',async()=>{
 const t=await setup(),old=t.store.get('sessions',t.session.id)!;t.store.put('sessions',{...old,teaching:undefined,teachingVersionId:undefined,activity:{...old.activity,teachingVersionId:undefined}});
 const fragment=t.store.get('fragments','f')!;t.store.put('fragments',{...fragment,pageNumber:1});const transcription={id:'confirmed1',projectId:'p',materialId:'m',fragmentId:'f',pageNumber:1,version:1,text:'已确认的原文版本：所有成员逐项比较。',status:'confirmed' as const,createdAt:'2026-09-01T00:00:00Z',confirmedAt:'2026-09-01T00:00:00Z',uncertainties:[]};t.store.put('sourceTranscriptions',transcription);
 const count=t.store.list('teachingVersions').length,receipt=t.service.recordInput(old.id,{requestId:'source-question',kind:'explore',text:'这段怎么理解？',followup:{kind:'source',id:'f',intent:'question'}});
 expect(t.store.list('teachingVersions')).toHaveLength(count);const input=t.store.get('sessions',old.id)!.messages.find(message=>message.id===receipt.inputId)!;expect(input.teachingVersionId).toBeUndefined();expect(input.followup?.sources[0].transcriptionIds).toEqual(['confirmed1']);
 t.store.put('sourceTranscriptions',{...transcription,id:'confirmed2',version:2,text:'之后才确认的新版本',createdAt:'2026-09-02T00:00:00Z'});await t.service.respondInput(old.id,receipt.inputId);expect(t.calls.at(-1).sources[0].text).toContain('已确认的原文版本');expect(JSON.stringify(t.calls.at(-1).sources)).not.toContain('之后才确认');expect(t.store.get('sessions',old.id)?.teachingVersionId).toBeUndefined();expect(t.store.list('evidence')).toEqual([]);
});
it('rejects cross-project sources, other-session messages and unseen future steps before saving',async()=>{
 const t=await setup();t.store.put('fragments',{id:'foreign',projectId:'other',materialId:'other',locator:'私有段落',ordinal:0,text:'不可引用'});
 for(const [kind,id] of [['source','foreign'],['message','not-in-session'],['step',t.session.teaching!.upcoming[0].id]] as const)expect(()=>t.service.recordInput(t.session.id,{requestId:'invalid-'+kind,kind:'explore',text:'追问',followup:{kind,id,intent:'question'}})).toThrow();
 expect(t.store.get('sessions',t.session.id)!.messages.some(message=>message.requestId?.startsWith('invalid-'))).toBe(false);
});
it('saves once and retries only the response while retaining anchored corrections and answer exposure',async()=>{
 let fails=true;const t=await setup(()=>{if(fails){fails=false;throw new Error('offline');}return{text:'当前题的答案是5。需要先确认给出的集合。',sourceIds:['f'],scope:'concept'};});
 const request={requestId:'retry-example',kind:'explore' as const,text:'请演示这段',followup:{kind:'step' as const,id:t.session.teaching!.current.id,intent:'example' as const}};
 const receipt=t.service.recordInput(t.session.id,request);await expect(t.service.respondInput(t.session.id,receipt.inputId)).rejects.toThrow();expect(t.service.recordInput(t.session.id,request).inputId).toBe(receipt.inputId);
 t.store.put('corrections',{id:'original-correction',projectId:'p',teachingVersionId:t.session.teachingVersionId!,action:'suspend',reason:'原题条件尚待澄清',createdAt:new Date().toISOString()});
 await t.service.respondInput(t.session.id,receipt.inputId);expect(t.calls.at(-1).discussionContext.corrections.some((item:any)=>item.id==='original-correction')).toBe(true);const session=t.store.get('sessions',t.session.id)!;
 expect(session.messages.filter(message=>message.requestId===request.requestId)).toHaveLength(1);expect(session.messages.filter(message=>message.inputId===receipt.inputId&&message.role==='assistant')).toHaveLength(1);expect(t.store.list('answerExposures').at(-1)).toMatchObject({kind:'answer',taskId:t.session.activity.id,teachingVersionId:t.session.teachingVersionId});expect(t.store.list('evidence')).toEqual([]);
});
it('attributes an old-task solution to its anchor when the learner switches tasks before its response',async()=>{
 const t=await setup(()=>({text:'原题的答案是5。',sourceIds:['f'],scope:'current_task'})),receipt=t.service.recordInput(t.session.id,{requestId:'late-old-help',kind:'explore',text:'解释这个例子',followup:{kind:'step',id:t.session.teaching!.current.id,intent:'example'}});
 await t.service.nextStep(t.session.id,'independent');t.service.saveDraft(t.session.id,'后续题的新草稿');const before=t.store.get('sessions',t.session.id)!;await t.service.respondInput(t.session.id,receipt.inputId);const after=t.store.get('sessions',t.session.id)!;
 expect(context(after)).toEqual(context(before));expect(after.helpLevel).toBe(0);expect(after.helpEvents.at(-1)).toMatchObject({taskId:t.session.activity.id,level:4});expect(t.store.list('answerExposures').at(-1)?.teachingVersionId).toBe(t.session.teachingVersionId);
});
it('keeps a source reply and its followup on the original source thread without adopting the active exercise',async()=>{
 const t=await setup(),request={requestId:'source-root',kind:'explore' as const,text:'请举个原文的例子',followup:{kind:'source' as const,id:'f',intent:'example' as const}};
 const first=t.service.recordInput(t.session.id,request);await t.service.respondInput(t.session.id,first.inputId);const reply=t.store.get('sessions',t.session.id)!.messages.find(message=>message.role==='assistant'&&message.inputId===first.inputId)!;
 await t.service.nextStep(t.session.id,'independent');const follow=t.service.recordInput(t.session.id,{requestId:'source-next',kind:'explore',text:'这个条件还能怎么说明？',followup:{kind:'message',id:reply.id,intent:'question'}});await t.service.respondInput(t.session.id,follow.inputId);
 const input=t.calls.at(-1);expect(input.activity).toBeUndefined();expect(input.anchor.teachingVersionId).toBeUndefined();expect(input.anchor.rootInputId).toBe(first.inputId);expect(input.rootAnchor.kind).toBe('source');expect(t.store.get('sessions',t.session.id)?.helpLevel).toBe(0);
 const path=join(t.store.dataDirectory,'source-followup.reclimb');writeBackup(t.store,path);expect(readBackup(path).records.sessions[0].messages.some(message=>message.followup?.rootInputId===first.inputId)).toBe(true);
 expect(()=>t.service.recordInput(t.session.id,{...request,followup:{kind:'message',id:reply.id,intent:'example'}})).toThrow('记录编号');
});
it.each(['same_task','uncertain','missing','different_task'] as const)('carries source help across capability boundaries and handles a %s relation honestly',async relation=>{
 const t=await setup(()=>({text:'列表比较的完整例子：给定2、5、1，逐项比较后候选值是5。',sourceIds:['f'],scope:'concept'}),input=>({...reviewedTeaching(input),exposureRelations:(input.exposures??[]).filter((exposure:any)=>!(relation==='missing'&&exposure.taskId.startsWith('source-followup-'))).map((exposure:any)=>({exposureId:exposure.id,relation:exposure.taskId.startsWith('source-followup-')?relation==='missing'?'uncertain':relation:'different_task',reason:'自制对照的已见内容关系'}))}));
 const receipt=t.service.recordInput(t.session.id,{requestId:'look-ahead',kind:'explore',text:'演示后面列表比较的步骤',followup:{kind:'source',id:'f',intent:'example'}});await t.service.respondInput(t.session.id,receipt.inputId);const exposure=t.store.list('answerExposures').find(item=>item.taskId.startsWith('source-followup-'))!;
 t.store.put('capabilities',{id:'next-capability',projectId:'p',title:'后续单元的列表判断',description:'新的能力范围',prerequisites:[],sourceIds:['f'],order:1});
 const next=await t.service.start('p','next-capability');expect(next.capabilityId).toBe('next-capability');const review=t.calls.filter(input=>input.operation==='review_teaching').at(-1);expect(review.exposures.some((item:any)=>item.id===exposure.id)).toBe(true);expect(review.exposures.every((item:any)=>item.capabilityId==='next-capability'||item.taskId.startsWith('source-followup-'))).toBe(true);
 await t.service.nextStep(next.id,'continue');await t.service.submit(next.id,'我逐项比较了所有值','next-result-'+relation);const attempt=t.store.get('attempts','next-result-'+relation)!,evidence=t.store.list('evidence').find(item=>item.attemptId===attempt.id)!;
 expect(attempt.helpLevel).toBe(relation==='same_task'?4:0);expect(evidence.status).toBe(relation==='same_task'?'assisted':relation==='different_task'?'independent':'needs_review');
});
it('keeps a historical explanation on the adopted source version and saves ambiguous old text without guessing its original source',async()=>{
 const t=await setup(input=>({text:'只针对这段文字解释比较对象；原来源仍待确认。',sourceIds:input.sources.map((source:any)=>source.id),scope:'concept'})),step=t.session.teaching!.current,fragment=t.store.get('fragments','f')!;
 t.store.put('fragments',{...fragment,pageNumber:1});t.store.put('sourceTranscriptions',{id:'new-confirmed',projectId:'p',materialId:'m',fragmentId:'f',pageNumber:1,version:1,text:'手工确认后的比较关系。',status:'confirmed',createdAt:'2026-09-01T00:00:00Z',confirmedAt:'2026-09-01T00:00:00Z',uncertainties:[]});
 await t.service.adoptConfirmedSources(t.session.id);const adopted=t.store.get('sessions',t.session.id)!;expect(adopted.teaching!.current.id).toBe(step.id);expect(adopted.teaching!.current.teachingVersionId).toBe(adopted.teachingVersionId);expect(adopted.teachingVersionId).not.toBe(t.session.teachingVersionId);
 await t.service.nextStep(adopted.id,'continue');const exact=t.service.recordInput(adopted.id,{requestId:'adopted-explanation',kind:'explore',text:'继续讲这一版',followup:{kind:'step',id:step.id,intent:'question',teachingVersionId:adopted.teachingVersionId}});await t.service.respondInput(adopted.id,exact.inputId);expect(t.calls.at(-1).anchor.teachingVersionId).toBe(adopted.teachingVersionId);expect(t.calls.at(-1).sources[0].transcriptionIds).toEqual(['new-confirmed']);
 const current=t.store.get('sessions',adopted.id)!;t.store.put('sessions',{...current,teaching:{...current.teaching!,history:current.teaching!.history.map(item=>item.id===step.id?{...item,teachingVersionId:undefined}:item)}});
 const ambiguous=t.service.recordInput(adopted.id,{requestId:'old-ambiguous',kind:'explore',text:'这段旧解释我仍想问',followup:{kind:'step',id:step.id,intent:'question'}});const saved=t.store.get('sessions',adopted.id)!.messages.find(message=>message.id===ambiguous.inputId)!;expect(saved.followup?.teachingVersionId).toBeUndefined();expect(saved.followup?.contextWarning).toContain('无法唯一确定');expect(saved.followup?.sources).toEqual([]);
 await t.service.respondInput(adopted.id,ambiguous.inputId);expect(t.calls.at(-1).activity).toBeUndefined();expect(t.calls.at(-1).anchor.text).toBe(step.content);expect(t.store.list('answerExposures').at(-1)?.taskId).toBe('source-followup-'+ambiguous.inputId);expect(t.store.list('evidence')).toEqual([]);
 const backup=join(t.store.dataDirectory,'legacy-step.reclimb');writeBackup(t.store,backup);expect(readBackup(backup).records.sessions[0].messages.find(message=>message.id===ambiguous.inputId)?.followup?.contextWarning).toContain('无法唯一确定');
});
it.each([true,false])('recovers only an explicitly adjacent legacy question (matching: %s)',async matching=>{
 const t=await setup(),session=t.store.get('sessions',t.session.id)!,now=new Date().toISOString(),common={taskId:session.activity.id,stepId:session.teaching!.current.id,teachingVersionId:session.teachingVersionId,createdAt:now};
 t.store.put('sessions',{...session,draft:'当前新草稿，不能代替原问题',messages:[...session.messages,{...common,id:'legacy-question',role:'user',kind:'explore',text:'这个旧例子的比较对象是什么？',...(!matching?{taskId:'another-task'}:{})},{...common,id:'legacy-response',role:'assistant',kind:'hint',text:'比较对象需要明确为同一列表的成员。',sourceIds:['f']}]});
 const receipt=t.service.recordInput(session.id,{requestId:'legacy-followup-'+matching,kind:'explore',text:'请继续解释其中的条件',followup:{kind:'message',id:'legacy-response',intent:'question'}});await t.service.respondInput(session.id,receipt.inputId);const input=t.calls.at(-1);expect(input.thread.some((message:any)=>message.text==='这个旧例子的比较对象是什么？')).toBe(matching);expect(input.threadTruncated).toBe(!matching);expect(JSON.stringify(input)).not.toContain('当前新草稿，不能代替原问题');
});
it('records the actual long reference solution even when a followup falsely labels it navigation',async()=>{
 const reference='先取列表中的第一个数2作为候选，再比较5并更新候选，最后比较1，发现候选5仍然不小于每一个成员。';
 const t=await setup(()=>({text:reference,sourceIds:['f'],scope:'navigation'}),reviewedTeaching,reference),receipt=t.service.recordInput(t.session.id,{requestId:'navigation-leaked-answer',kind:'explore',text:'解释一下',followup:{kind:'step',id:t.session.teaching!.current.id,intent:'question'}});await t.service.respondInput(t.session.id,receipt.inputId);
 expect(t.store.list('answerExposures').at(-1)).toMatchObject({kind:'answer',teachingVersionId:t.session.teachingVersionId,text:reference});expect(t.store.get('sessions',t.session.id)?.helpEvents.at(-1)).toMatchObject({scope:'current_task',level:4});expect(t.store.list('evidence')).toEqual([]);
});
it('does not silently certify independence when an older source exposure falls outside the review context limit',async()=>{
 const t=await setup(),receipt=t.service.recordInput(t.session.id,{requestId:'early-source-help',kind:'explore',text:'请举一个例子',followup:{kind:'source',id:'f',intent:'example'}});await t.service.respondInput(t.session.id,receipt.inputId);const original=t.store.list('answerExposures').find(item=>item.taskId.startsWith('source-followup-'))!;
 for(let index=0;index<61;index++)t.store.put('answerExposures',{...original,id:'later-source-exposure-'+index,taskId:'source-followup-later-'+index});
 t.store.put('capabilities',{id:'next-capability',projectId:'p',title:'后续比较',description:'后续范围',prerequisites:[],sourceIds:['f'],order:1});const next=await t.service.start('p','next-capability'),review=t.calls.filter(input=>input.operation==='review_teaching').at(-1);expect(review.exposures).toHaveLength(60);expect(review.exposures.some((item:any)=>item.id===original.id)).toBe(false);
 await t.service.nextStep(next.id,'continue');await t.service.submit(next.id,'逐项比较每一个值','after-context-limit');expect(t.store.list('evidence').find(item=>item.attemptId==='after-context-limit')?.status).toBe('needs_review');
});
it('saves the selected legacy history entry when the current step shares its id but uses an adopted source version',async()=>{
 const t=await setup(input=>({text:'只分析所选旧片段的文字，不能据此确认原来源。',sourceIds:input.sources.map((source:any)=>source.id),scope:'concept'})),step=t.session.teaching!.current,fragment=t.store.get('fragments','f')!;
 t.store.put('sessions',{...t.session,teaching:{...t.session.teaching!,history:[{...step,teachingVersionId:undefined}]}});t.store.put('fragments',{...fragment,pageNumber:1});t.store.put('sourceTranscriptions',{id:'mixed-confirmed',projectId:'p',materialId:'m',fragmentId:'f',pageNumber:1,version:1,text:'当前步骤采用的新版来源。',status:'confirmed',createdAt:'2026-09-01T00:00:00Z',confirmedAt:'2026-09-01T00:00:00Z',uncertainties:[]});await t.service.adoptConfirmedSources(t.session.id);
 const before=context(t.store.get('sessions',t.session.id)),followup={kind:'step' as const,id:step.id,intent:'question' as const,historyIndex:0},request={requestId:'mixed-history',kind:'explore' as const,text:'我问的是之前走过的解释',followup};
 const receipt=t.service.recordInput(t.session.id,request);expect(t.service.recordInput(t.session.id,request).inputId).toBe(receipt.inputId);await t.service.respondInput(t.session.id,receipt.inputId);const model=t.calls.at(-1);expect(model.anchor.historyIndex).toBe(0);expect(model.anchor.teachingVersionId).toBeUndefined();expect(model.anchor.contextWarning).toContain('无法唯一确定');expect(model.sources).toEqual([]);expect(model.activity).toBeUndefined();expect(context(t.store.get('sessions',t.session.id))).toEqual(before);
 for(const [index,invalid] of [{...followup,historyIndex:1},{...followup,id:'wrong-step'},{...followup,teachingVersionId:t.store.get('sessions',t.session.id)!.teachingVersionId}].entries())expect(()=>t.service.recordInput(t.session.id,{...request,requestId:'invalid-mixed-'+index,followup:invalid})).toThrow('只能针对');
 expect(()=>t.service.recordInput(t.session.id,{...request,followup:{...followup,historyIndex:1}})).toThrow('记录编号');
 const path=join(t.store.dataDirectory,'mixed-history.reclimb');writeBackup(t.store,path);expect(readBackup(path).records.sessions[0].messages.find(message=>message.id===receipt.inputId)?.followup).toMatchObject({historyIndex:0,contextWarning:expect.stringContaining('无法唯一确定')});
});
