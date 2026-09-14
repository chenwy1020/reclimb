import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import AdmZip from 'adm-zip';
import {LearningStore} from '../src/main/store';
import {CallRunner} from '../src/main/call-runner';
import {LearningService} from '../src/main/learning-service';
import {VerificationService} from '../src/main/verification-service';
import {HandwritingService} from '../src/main/handwriting-service';
import {HandwritingFeedbackService,renderHandwritingImages} from '../src/main/handwriting-recognition';
import {readBackup,writeBackup,prepareRestore} from '../src/main/backup';
import {publicSnapshot} from '../src/main/public-snapshot';
import {readableExport} from '../src/main/readable-export';
import {ProviderError} from '../src/main/provider';
import {finishAssessment} from '../src/main/evidence';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
async function fixture(options:{ready?:boolean;note?:string;vision?:(request:any)=>any;feedback?:(input:any)=>any}={}){
 const directory=mkdtempSync(join(tmpdir(),'reclimb-ink-recognition-'));cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));const store=await LearningStore.open(join(directory,'source'));cleanup.push(()=>store.close());
 store.updateSettings({monthlyBudgetCny:100,vision:{enabled:true,providerName:'自编测试视觉',baseUrl:'https://vision.example/v1',model:'chosen-vision',inputPriceCnyPerMillion:1,outputPriceCnyPerMillion:1,priceUpdatedAt:'2026-09-15'}});
 const now=new Date().toISOString();store.put('projects',{id:'p',title:'自编手写任务',goal:'说明比较',status:'active',createdAt:now,updatedAt:now});store.put('capabilities',{id:'c',projectId:'p',title:'比较',description:'说明比较依据',prerequisites:[],sourceIds:[],order:0});
 const verifier=new VerificationService(store,new CallRunner(store,()=>''));const activity={id:'task',title:'比较两个对象',instruction:'比较3和5并写出依据。',kind:'selection' as const,rubric:['说明比较依据'],referenceAnswer:'PRIVATE_REFERENCE_ANSWER',sourceIds:[],assessmentBasis:'ai' as const};
 const version=verifier.createVersion({projectId:'p',capabilityId:'c',activity,steps:[{id:'step',taskId:'task',action:'attempt',title:'比较',content:activity.instruction,sourceIds:[],activity,createdAt:now}],sources:[]});
 store.put('taskReviews',{id:'review',projectId:'p',teachingVersionId:version.id,contentHash:version.contentHash,status:options.ready===false?'uncertain':'ready',summary:'原创测试核验',privateSolution:'PRIVATE_REVIEW_SOLUTION',issues:[],branches:[],exposureRelations:[],localChecks:[],createdAt:now,reviewerModel:'test'});
 store.put('sessions',{id:'s',projectId:'p',capabilityId:'c',activity:version.activity,teachingVersionId:version.id,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'我的电脑主草稿',helpLevel:0,helpEvents:[],messages:[],checkpoint:'正在学习',nextStep:'继续',teaching:{version:1,current:version.steps[0],upcoming:[],history:[],guidance:'independent',confusionCount:0}});
 const handwriting=new HandwritingService(store),target=handwriting.target('s'),receipt=handwriting.save({requestId:'ink-submit',targetId:target.id,note:options.note??'',pages:[{id:'page',width:768,height:1024,strokes:[{id:'stroke',color:'#253e31',width:2,points:[{x:.2,y:.3,pressure:.5},{x:.4,y:.5,pressure:.6}]}]}]}),original=store.get('handwritings',receipt.id)!;
 const visualCalls:any[]=[],textCalls:any[]=[];
 const visionRunner=new CallRunner(store,()=> 'test-vision-key',(settings)=>({complete:async request=>{visualCalls.push({request,model:settings.model});const result=options.vision?await options.vision(request):{text:'3 小于 5，因为在数轴上位于左侧。',uncertainties:[],unresolved:false};return{text:typeof result==='string'?result:JSON.stringify(result),inputTokens:12,outputTokens:15,usageKnown:true};}}));
 const learning=new LearningService(store,()=> 'test-text-key',()=>({complete:async request=>{const input=JSON.parse(request.user);textCalls.push(input);const value=options.feedback?await options.feedback(input):input.operation?.startsWith('discuss_')?{text:'先保留你写下的依据，我们继续讨论。',sourceIds:[],scope:'concept'}:{outcome:'met',feedback:'已经写出比较依据。',criteria:input.activity.rubric.map((criterion:string,index:number)=>({criterion,criterionId:input.activity.rubricIds[index],result:'met',reason:'写出了左右顺序'})),limitations:[],sourceIds:[]};return{text:JSON.stringify(value),inputTokens:10,outputTokens:10,usageKnown:true};}}));
 const feedback=new HandwritingFeedbackService(store,learning,visionRunner,()=> 'test-vision-key',async record=>record.pages.map(()=>({dataUrl:'data:image/png;base64,iVBORw0KGgo='})));
 return {directory,store,verifier,version,handwriting,target,original,learning,feedback,visionRunner,visualCalls,textCalls};
}
const confirm=(t:Awaited<ReturnType<typeof fixture>>,extra:Record<string,unknown>={})=>t.feedback.confirm({handwritingId:t.original.id,requestId:'confirm-1',text:'3 小于 5，因为3在5的左侧。',unresolved:false,...extra});

it('transcribes stored pages using the chosen vision profile once and rejects unconfirmed text as an attempt',async()=>{
 const t=await fixture(),machine=await t.feedback.recognize(t.original.id,'recognize-1');expect(machine).toMatchObject({status:'machine',handwritingId:t.original.id,contentHash:t.original.contentHash});expect(t.visualCalls[0].model).toBe('chosen-vision');expect(t.visualCalls[0].request.images).toHaveLength(1);expect(t.visualCalls[0].request.system).toContain('不完成学习者尚未写出的思考');expect(JSON.stringify(t.visualCalls)).not.toContain('PRIVATE_REFERENCE_ANSWER');
 expect(await t.feedback.recognize(t.original.id,'recognize-1')).toEqual(machine);expect(t.visualCalls).toHaveLength(1);expect(()=>t.learning.recordHandwritingInput(machine.id)).toThrow('确认');expect(t.store.list('attempts')).toEqual([]);expect(t.store.list('evidence')).toEqual([]);expect(t.textCalls).toEqual([]);
});
it('supports manual confirmation without a vision key and keeps the source draft and current step intact after feedback',async()=>{
 const t=await fixture();t.store.updateSettings({vision:{...t.store.getSettings().vision!,enabled:false}});const before=t.store.get('sessions','s')!,saved=confirm(t);expect(saved.receipt.responseMode).toBe('assessment');expect(t.textCalls).toEqual([]);expect(t.visualCalls).toEqual([]);await t.feedback.respond(t.original.id,saved.receipt.inputId);await t.feedback.respond(t.original.id,saved.receipt.inputId);
 const after=t.store.get('sessions','s')!;expect(after.draft).toBe(before.draft);expect(after.teaching?.current).toEqual(before.teaching?.current);expect(after.checkpoint).toBe(before.checkpoint);expect(t.textCalls).toHaveLength(1);expect(t.store.list('evidence')).toHaveLength(1);expect(JSON.stringify(t.feedback.responses(t.original.id))).not.toContain('PRIVATE_');expect(t.feedback.responses(t.original.id)).toHaveLength(2);
});
it('keeps confirmed unresolved text as discussion even if its task is ready',async()=>{
 const t=await fixture(),saved=confirm(t,{text:'[无法辨认] 小于 5',unresolved:false});expect(saved.transcription.unresolved).toBe(true);expect(saved.receipt.responseMode).toBe('discussion');await t.feedback.respond(t.original.id,saved.receipt.inputId);expect(t.store.list('evidence')).toEqual([]);expect(t.textCalls[0].operation).toBe('discuss_input');
});
it('preserves fixed discussion mode if verification becomes ready after confirmation',async()=>{
 const t=await fixture({ready:false}),saved=confirm(t);t.store.put('taskReviews',{...t.store.get('taskReviews','review')!,id:'ready-later',status:'ready'});await t.feedback.respond(t.original.id,saved.receipt.inputId);expect(saved.receipt.responseMode).toBe('discussion');expect(t.store.list('evidence')).toEqual([]);
});
it('binds an old confirmed original after advancing, without inheriting the new task help or moving its draft',async()=>{
 const t=await fixture(),before=t.store.get('sessions','s')!,newActivity={...before.activity,id:'later-task',title:'后续任务',instruction:'解释另一个对象。'};const next=t.verifier.createVersion({projectId:'p',capabilityId:'c',activity:newActivity,steps:[{...t.version.steps[0],id:'later-step',taskId:'later-task',activity:newActivity}],sources:[]});
 t.store.put('sessions',{...before,activity:next.activity,teachingVersionId:next.id,helpLevel:4,helpEvents:[{id:'later-help',kind:'answer',level:4,taskId:'later-task',scope:'current_task',createdAt:new Date().toISOString()}],draft:'新任务的主草稿',teaching:{...before.teaching!,current:next.steps[0],history:[t.version.steps[0]]}});
 const saved=confirm(t);expect(t.store.get('attempts',saved.receipt.attemptId!)?.helpLevel).toBe(0);await t.feedback.respond(t.original.id,saved.receipt.inputId);
 const after=t.store.get('sessions','s')!;expect(after.draft).toBe('新任务的主草稿');expect(after.activity.id).toBe('later-task');expect(after.teaching?.current.id).toBe('later-step');expect(t.textCalls[0].activity.id).toBe('task');expect(t.feedback.responses(t.original.id).at(-1)).toMatchObject({handwritingId:t.original.id,taskId:'task',teachingVersionId:t.version.id});
});
it('includes old-task help received before confirmation without rewriting the original ink help',async()=>{
 const t=await fixture(),now=new Date().toISOString();t.store.put('answerExposures',{id:'shown-answer',projectId:'p',sessionId:'s',capabilityId:'c',taskId:'task',teachingVersionId:t.version.id,kind:'answer',text:'已经看过的答案',createdAt:now});const saved=confirm(t);expect(t.store.get('attempts',saved.receipt.attemptId!)?.helpLevel).toBe(4);expect(t.store.get('handwritings',t.original.id)?.helpLevel).toBe(0);await t.feedback.respond(t.original.id,saved.receipt.inputId);expect(t.store.list('evidence')[0].status).toBe('assisted');
});
it('saves confirmation once and rejects request IDs reused for different text or parents',async()=>{
 const t=await fixture(),first=confirm(t);expect(confirm(t).receipt.inputId).toBe(first.receipt.inputId);expect(()=>confirm(t,{text:'改成另一段文字'})).toThrow('编号');expect(t.store.list('handwritingTranscriptions')).toHaveLength(1);expect(t.store.list('attempts')).toHaveLength(1);expect(t.feedback.responses(t.original.id)).toHaveLength(1);
});
it('keeps the confirmation on zero budget and does not send either model request',async()=>{
 const t=await fixture();t.store.updateSettings({monthlyBudgetCny:0});const saved=confirm(t);await expect(t.feedback.respond(t.original.id,saved.receipt.inputId)).rejects.toThrow('预算');await expect(t.feedback.recognize(t.original.id,'no-budget')).rejects.toThrow('预算');expect(t.visualCalls).toEqual([]);expect(t.textCalls).toEqual([]);expect(t.feedback.responses(t.original.id)[0]).toMatchObject({responseState:'failed',text:saved.transcription.text});expect(t.store.list('handwritings')).toHaveLength(1);
});
it('saves while recognition is busy and never queues a feedback call automatically',async()=>{
 let release!:(value:any)=>void,started!:()=>void;const began=new Promise<void>(resolve=>started=resolve),t=await fixture({vision:()=>{started();return new Promise(resolve=>release=resolve);}});const running=t.feedback.recognize(t.original.id,'busy-recognize');await began;const saved=confirm(t);expect(saved.responseAvailability).toBe('busy');expect(await t.feedback.respond(t.original.id,saved.receipt.inputId)).toEqual({responseAvailability:'busy'});release({text:'3 小于 5',uncertainties:[],unresolved:false});await running;expect(t.textCalls).toEqual([]);expect(t.feedback.responses(t.original.id)[0].responseState).toBe('pending');
});
it('stops evidence if a dispute is raised while the handwriting assessment returns',async()=>{
 let t:Awaited<ReturnType<typeof fixture>>;t=await fixture({feedback:async input=>{await t.learning.dispute('s','原题比较条件有遗漏');return{outcome:'met',feedback:'原评价',criteria:input.activity.rubric.map((criterion:string,i:number)=>({criterion,criterionId:input.activity.rubricIds[i],result:'met',reason:'满足'})),limitations:[],sourceIds:[]};}});const saved=confirm(t);await expect(t.feedback.respond(t.original.id,saved.receipt.inputId)).rejects.toThrow('质疑');expect(t.store.list('evidence')).toEqual([]);expect(t.feedback.responses(t.original.id)[0].responseState).toBe('failed');expect(t.store.get('handwritings',t.original.id)?.pages).toEqual(t.original.pages);
});
it('retains an unreadable machine result without silently repairing the learner reasoning',async()=>{
 const t=await fixture({vision:()=>({text:'[无法辨认]\n[图形需对照原稿]',uncertainties:['不等号无法确认'],unresolved:true})}),candidate=await t.feedback.recognize(t.original.id,'unclear');expect(candidate.text).toContain('[无法辨认]');expect(candidate.unresolved).toBe(true);expect(t.store.list('attempts')).toEqual([]);expect(t.store.list('evidence')).toEqual([]);
});
it('charges and bounds one explicit format repair, while an unsupported vision model is not replaced',async()=>{
 let calls=0;const t=await fixture({vision:()=>++calls===1?'invalid json':{text:'原稿转录',uncertainties:[],unresolved:false}});await t.feedback.recognize(t.original.id,'repair-recognize');expect(t.visualCalls).toHaveLength(2);expect(t.store.list('usage').filter(item=>item.entryType==='call')).toHaveLength(2);expect(t.store.list('handwritingTranscriptions')).toHaveLength(1);
 const unsupported=await fixture({vision:()=>{throw new ProviderError('当前模型不支持图像',true);}});await expect(unsupported.feedback.recognize(unsupported.original.id,'unsupported')).rejects.toThrow('不支持图像');expect(unsupported.visualCalls).toHaveLength(1);expect(unsupported.visualCalls[0].model).toBe('chosen-vision');expect(unsupported.store.list('handwritingTranscriptions')).toEqual([]);
});
it('stores an unconfirmed text draft independently from the main draft, and validates its parent',async()=>{
 const t=await fixture(),before=t.store.get('sessions','s')!,machine=await t.feedback.recognize(t.original.id,'draft-recognition');const draft=t.feedback.saveDraft({handwritingId:t.original.id,text:'还在核对的文字',parentId:machine.id,unresolved:true});expect(t.feedback.draft(t.original.id)).toEqual(draft);expect(t.store.get('sessions','s')?.draft).toBe(before.draft);expect(t.store.get('sessions','s')?.updatedAt).toBe(before.updatedAt);expect(t.store.list('attempts')).toEqual([]);expect(()=>t.feedback.saveDraft({handwritingId:t.original.id,text:'文字',parentId:'absent',unresolved:false})).toThrow('关联');
});
it('restores raw pages, machine and confirmed versions, pending response and text draft without exposing candidates in snapshots',async()=>{
 const t=await fixture({ready:false}),machine=await t.feedback.recognize(t.original.id,'backup-recognition');t.feedback.saveDraft({handwritingId:t.original.id,text:'保留的编辑文字',parentId:machine.id,unresolved:true});const saved=confirm(t,{transcriptionId:machine.id});
 const archive=join(t.directory,'archive.reclimb');writeBackup(t.store,archive);const restored=readBackup(archive);expect(restored.records.handwritingTranscriptions).toHaveLength(2);expect(restored.records.sessions[0].handwritingDrafts?.[t.original.id].text).toBe('保留的编辑文字');expect(restored.records.sessions[0].messages[0]).toMatchObject({handwritingId:t.original.id,handwritingTranscriptionId:saved.transcription.id,responseState:'pending'});expect(publicSnapshot(t.store.snapshot()).handwritingTranscriptions).toEqual([]);expect(readableExport(t.store.snapshot())).toContain('机器识别候选，尚未核对');
 await prepareRestore(archive,join(t.directory,'restored'));const reopened=await LearningStore.open(join(t.directory,'restored'));cleanup.push(()=>reopened.close());expect(reopened.get('handwritings',t.original.id)?.pages).toEqual(t.original.pages);expect(reopened.get('handwritingTranscriptions',saved.transcription.id)?.text).toBe(saved.transcription.text);
 const zip=new AdmZip(archive),manifest=JSON.parse(zip.readAsText('manifest.json'));manifest.records.handwritingTranscriptions.find((item:any)=>item.id===saved.transcription.id).text='被改写的转录';zip.updateFile('manifest.json',Buffer.from(JSON.stringify(manifest)));const altered=archive+'.bad';writeFileSync(altered,zip.toBuffer());expect(()=>readBackup(altered)).toThrow('确认转录');
});
it('renders original strokes into bounded PNG pages locally without a model',async()=>{
 const t=await fixture(),images=await renderHandwritingImages(t.original);expect(images).toHaveLength(1);expect(images[0].dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);expect(t.visualCalls).toEqual([]);
});

it.each([false,true])('keeps original notes and confirmed uncertainty in feedback but excludes unchecked drafts (ready=%s)',async ready=>{
 const t=await fixture({ready,note:'我画的箭头表示数轴方向。'});t.feedback.saveDraft({handwritingId:t.original.id,text:'PRIVATE_UNCONFIRMED_DRAFT',unresolved:true});
 const saved=confirm(t,{unresolved:!ready});await t.feedback.respond(t.original.id,saved.receipt.inputId);
 expect(t.textCalls[0].handwritingContext).toMatchObject({originalNote:t.original.note,unresolved:!ready,origin:'learner_confirmed_handwriting'});
 if(!ready)expect(t.textCalls[0].handwritingContext.uncertainties.length).toBeGreaterThan(0);
 expect(JSON.stringify(t.textCalls)).not.toContain('PRIVATE_UNCONFIRMED_DRAFT');expect(publicSnapshot(t.store.snapshot()).sessions[0].handwritingDrafts).toBeUndefined();
});

it('cannot bypass confirmation or remove handwriting provenance at the evidence boundary',async()=>{
 const t=await fixture(),saved=confirm(t,{unresolved:true}),attempt=t.store.get('attempts',saved.receipt.attemptId!)!,session=t.store.get('sessions','s')!;
 t.store.put('sessions',{...session,messages:session.messages.map(message=>message.inputId===saved.receipt.inputId?{...message,responseMode:'assessment' as const}:message)});
 const assessment={outcome:'met' as const,feedback:'伪造绕过',criteria:t.version.activity.rubric.map((criterion,i)=>({criterion,criterionId:t.version.activity.rubricIds![i],result:'met' as const,reason:'满足'})),limitations:[],sourceIds:[]};
 expect(()=>finishAssessment(t.store,attempt.id,assessment)).toThrow('手写内容');
 t.store.put('attempts',{...attempt,handwritingId:undefined,handwritingTranscriptionId:undefined});expect(()=>finishAssessment(t.store,attempt.id,assessment)).toThrow('手写内容');expect(t.store.list('evidence')).toEqual([]);
});

it('discusses a legacy original after task replacement without reconstructing missing criteria from the new task',async()=>{
 const t=await fixture(),session=t.store.get('sessions','s')!,{teachingVersionId:_version,rubricIds:_criteria,...oldActivity}=session.activity;
 t.store.put('sessions',{...session,id:'legacy',activity:oldActivity,teaching:undefined,teachingVersionId:undefined});
 const target=t.handwriting.target('legacy'),ink=t.handwriting.save({targetId:target.id,requestId:'legacy-ink',pages:t.original.pages,note:'这是原题的补充说明'});
 t.store.put('sessions',{...t.store.get('sessions','legacy')!,activity:{...oldActivity,id:'later-task',title:'无关新任务',instruction:'新条件'},draft:'新题草稿'});
 const saved=t.feedback.confirm({handwritingId:ink.id,requestId:'legacy-confirm',text:'我认为原题的依据是数轴次序。',unresolved:false});
 expect(saved.receipt).toMatchObject({responseMode:'discussion'});expect(saved.receipt.attemptId).toBeUndefined();await t.feedback.respond(ink.id,saved.receipt.inputId);
 expect(t.textCalls[0].operation).toBe('discuss_legacy_handwriting');expect(t.textCalls[0].originalTask.id).toBe(target.id);expect(t.textCalls[0].handwritingContext.originalNote).toBe('这是原题的补充说明');expect(JSON.stringify(t.textCalls)).not.toContain('无关新任务');expect(t.store.get('sessions','legacy')?.draft).toBe('新题草稿');expect(t.store.list('evidence')).toEqual([]);
});
