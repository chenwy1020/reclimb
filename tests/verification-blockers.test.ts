import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {LearningStore} from '../src/main/store';import {CallRunner} from '../src/main/call-runner';
import {VerificationService} from '../src/main/verification-service';
import {publicSnapshot} from '../src/main/public-snapshot';
import type {Session} from '../src/shared/types';
const stores:LearningStore[]=[];afterEach(()=>stores.splice(0).forEach(store=>store.close()));
const reply=()=>({status:'ready',summary:'核对很顺利，秘密解答：选甲',issues:[],privateSolution:'秘密解答：选甲',branches:[{id:'boundary',condition:'题设的边界条件',applicability:'applies',criterionIndexes:[0],expectedBehavior:'秘密解答：选甲'}],exposureRelations:[],sourceChecks:[],mathChecks:[]});
async function fixture(respond:(input:any)=>unknown=()=>reply()){
 const store=await LearningStore.open(mkdtempSync(join(tmpdir(),'reclimb-source-review-')));stores.push(store);store.updateSettings({monthlyBudgetCny:100});const requests:any[]=[];
 const runner=new CallRunner(store,()=> 'test-key',()=>({complete:async request=>{const input=JSON.parse(request.user);requests.push(input);return {text:JSON.stringify(respond(input)),inputTokens:1,outputTokens:1,usageKnown:true};}}));
 const service=new VerificationService(store,runner),activity={id:'task',title:'核对边界条件',instruction:'条件给出边界值至少为 α。判断所列步骤是否使用了同一条件。',kind:'diagnosis' as const,rubric:['正确区分至少和严格大于'],sourceIds:['source'],sourceVersions:[{fragmentId:'source',transcriptionIds:[]}],assessmentBasis:'source' as const};
 const fragment={id:'source',projectId:'project',materialId:'material',locator:'第 2 页',pageNumber:2,text:'边界值 ≥ α，模糊符号待核',ordinal:0,quality:{kind:'ocr-text' as const,needsVerification:true,reasons:['OCR数学符号尚未核对']}};store.put('fragments',fragment);
 const version=service.createVersion({projectId:'project',capabilityId:'capability',activity,steps:[{id:'step',taskId:'task',action:'attempt',title:activity.title,content:activity.instruction,sourceIds:['source'],activity,createdAt:'2026-09-08T00:00:00Z'}],sources:[{id:'source',locator:fragment.locator,text:fragment.text,warnings:fragment.quality.reasons,transcriptionIds:[]}]});
 return {store,service,version,requests};
}
function confirm(t:Awaited<ReturnType<typeof fixture>>,id='confirmed',extra:Record<string,unknown>={}){t.store.put('sourceTranscriptions',{id,projectId:'project',materialId:'material',fragmentId:'source',pageNumber:2,version:1,text:'边界值 ≥ α。这里没有声称严格大于。',status:'confirmed',origin:'manual',createdAt:'2026-09-09T00:00:00Z',confirmedAt:'2026-09-09T00:00:00Z',uncertainties:[],...extra} as any);}
it('preserves the model verdict while explaining the exact source gate without exposing its solution',async()=>{
 const t=await fixture(()=>({...reply(),sourceChecks:[{sourceId:'source',consistency:'uncertain',usesCriticalSymbols:true,independentlyEstablished:false,reason:'关键不等号来自未核OCR；秘密解答：选甲'}]}));
 const review:any=await t.service.review(t.version),view:any=t.service.getView(t.version.id);
 expect(review.reportedStatus).toBe('ready');expect(review.effectiveStatus).toBe('uncertain');expect(review.status).toBe('uncertain');expect(view).toMatchObject({reportedStatus:'ready',effectiveStatus:'uncertain',canAssess:false});expect(view.blockingReasons).toContainEqual(expect.objectContaining({code:'source_unverified',sourceId:'source',locator:'第 2 页'}));expect(JSON.stringify(view)).not.toContain('秘密解答');
 const snapshot=publicSnapshot(t.store.snapshot());expect(JSON.stringify(snapshot.taskReviews)).not.toContain('秘密解答');expect((snapshot.taskReviews[0] as any).blockingReasons[0].sourceId).toBe('source');
});
it('blocks an explicit source conflict even when the summary praises the task and the source has no OCR warning',async()=>{
 const t=await fixture(()=>({...reply(),sourceChecks:[{sourceId:'source',consistency:'conflicting',usesCriticalSymbols:true,independentlyEstablished:true,reason:'来源给出至少 α，教学包要求必须严格大于 α'}]}));
 const version=t.service.createVersion({...t.version,sources:t.version.sources.map(source=>({...source,warnings:[]}))});const result:any=await t.service.review(version);
 expect(result.reportedStatus).toBe('ready');expect(result.status).toBe('needs_correction');expect(t.service.getView(version.id).canAssess).toBe(false);expect(result.blockingReasons).toContainEqual(expect.objectContaining({code:'source_conflict',sourceId:'source'}));
});
it('reuses matching reviews and read-only views but invalidates the cache on model, endpoint or explicit force changes',async()=>{
 const t=await fixture();const first=await t.service.review(t.version);await t.service.review(t.version);for(let i=0;i<3;i++)t.service.getView(t.version.id);expect(t.requests).toHaveLength(1);
 t.store.updateSettings({model:'different-model'});const changed:any=await t.service.review(t.version);expect(t.requests).toHaveLength(2);expect(changed.id).not.toBe(first.id);expect(changed.reviewPolicyVersion).toBeTruthy();expect(changed.reviewKey).toBeTruthy();
 t.store.updateSettings({baseUrl:'https://another.example/v1'});await t.service.review(t.version);expect(t.requests).toHaveLength(3);await t.service.review(t.version,{force:true});expect(t.requests).toHaveLength(4);
});
it('replaces the old source-contract cache only when review is explicitly requested and preserves the old record',async()=>{
 const t=await fixture(),settings=t.store.getSettings();
 const oldPolicy='0.3.1-source-contract-1';
 const oldKey=createHash('sha256').update(JSON.stringify({contentHash:t.version.contentHash,endpoint:settings.baseUrl.trim().replace(/\/+$/,''),model:settings.model,policy:oldPolicy})).digest('hex');
 const old={id:'old-contract-review',projectId:'project',teachingVersionId:t.version.id,contentHash:t.version.contentHash,status:'uncertain' as const,summary:'旧核验策略',issues:[],privateSolution:'旧核验推导',branches:[],exposureRelations:[],localChecks:[],createdAt:'2026-09-08T00:00:00Z',reviewerModel:settings.model,reviewKey:oldKey,reviewPolicyVersion:oldPolicy};t.store.put('taskReviews',old);
 t.service.getView(t.version.id);expect(t.requests).toHaveLength(0);
 const current=await t.service.review(t.version);
 expect(t.requests).toHaveLength(1);expect(current.id).not.toBe(old.id);expect(current.reviewPolicyVersion).not.toBe(oldPolicy);
 expect(t.store.get('taskReviews',old.id)).toEqual(old);
 await t.service.review(t.version);expect(t.requests).toHaveLength(1);
});
it('does not invent a historical reported status or hide its source blocker',async()=>{
 const t=await fixture();t.store.put('taskReviews',{id:'old-review',projectId:'project',teachingVersionId:t.version.id,contentHash:t.version.contentHash,status:'uncertain',summary:'旧汇总',issues:[],privateSolution:'旧秘密答案',branches:[],exposureRelations:[],sourceChecks:[],localChecks:[],createdAt:'2026-09-08T00:00:00Z',reviewerModel:'older-model'});
 const view:any=t.service.getView(t.version.id);expect(view.reportedStatus).toBeUndefined();expect(view.blockingReasons).toContainEqual(expect.objectContaining({code:'source_unverified',sourceId:'source'}));expect(t.requests).toHaveLength(0);expect(t.store.get('taskReviews','old-review')).not.toHaveProperty('reportedStatus');
});
it('adopts a confirmed source in a new immutable same-task version without changing old work or making a model call',async()=>{
 const t=await fixture();const before=JSON.stringify(t.version);confirm(t);const next=(t.service as any).adoptConfirmedSources(t.version);
 expect(next.id).not.toBe(t.version.id);expect(next.taskId).toBe(t.version.taskId);expect(next.replacesVersionId).toBe(t.version.id);expect(next.activity.rubricIds).toEqual(t.version.activity.rubricIds);expect(next.activity.sourceVersions).toEqual([{fragmentId:'source',transcriptionIds:['confirmed']}]);expect(next.steps[0].id).toBe('step');expect(next.steps[0].activity.teachingVersionId).toBe(next.id);expect(next.steps[0].content).toBe(t.version.steps[0].content);expect(next.sources[0].warnings).toEqual([]);expect(next.sources[0].text).toContain('边界值 ≥ α');expect(JSON.stringify(t.store.get('teachingVersions',t.version.id))).toBe(before);expect(t.requests).toHaveLength(0);expect(t.service.getView(next.id)).toMatchObject({status:'pending',canAssess:false});expect((t.service as any).adoptConfirmedSources(next).id).toBe(next.id);
});
it('ignores machine and foreign transcriptions and does not promote a confirmed crop to whole-page confirmation',async()=>{
 const t=await fixture();confirm(t,'machine',{status:'machine'});confirm(t,'foreign',{projectId:'other'});expect((t.service as any).adoptConfirmedSources(t.version).id).toBe(t.version.id);
 confirm(t,'crop',{region:{x:0,y:0,width:0.5,height:0.2}});const next=(t.service as any).adoptConfirmedSources(t.version);expect(next.sources[0].transcriptionIds).toEqual(['crop']);expect(next.sources[0].warnings.length).toBeGreaterThan(0);expect((await t.service.review(next)).status).toBe('uncertain');
});
it('preserves the pending adopted version when budget prevents the one requested review and never reports a model verdict',async()=>{
 const t=await fixture();confirm(t);const next=(t.service as any).adoptConfirmedSources(t.version);t.store.updateSettings({monthlyBudgetCny:0});const result:any=await t.service.review(next);expect(t.requests).toHaveLength(0);expect(result.reportedStatus).toBeUndefined();expect(t.store.get('teachingVersions',next.id)?.sources[0].transcriptionIds).toEqual(['confirmed']);expect(t.store.get('teachingVersions',t.version.id)).toBeTruthy();expect(t.service.getView(next.id)).toMatchObject({status:'pending',canAssess:false});await t.service.review(next);expect(t.store.list('taskReviews')).toHaveLength(1);
});
it('does not bypass an open dispute by adopting a confirmed source',async()=>{
 const t=await fixture(()=>({...reply(),sourceChecks:[{sourceId:'source',consistency:'consistent',usesCriticalSymbols:true,independentlyEstablished:true,reason:'本页已核对'}]}));
 t.service.openDispute({id:'session',projectId:'project',capabilityId:'capability',activity:t.version.activity,teachingVersionId:t.version.id} as Session,'这一步把非严格条件改成了严格条件');confirm(t);const next=(t.service as any).adoptConfirmedSources(t.version);await t.service.review(next);expect(t.service.getView(next.id).canAssess).toBe(false);
});

it('replaces stored blocker prose with program-owned wording at the renderer boundary',async()=>{
 const t=await fixture();const review:any=await t.service.review(t.version);const snapshot=t.store.snapshot();snapshot.taskReviews[0]={...review,blockingReasons:[{code:'source_unverified',sourceId:'source',locator:'第 2 页',message:'恢复的说明含秘密解答：选甲'}]};const visible=publicSnapshot(snapshot);expect(JSON.stringify(visible.taskReviews)).not.toContain('秘密解答');expect(visible.taskReviews[0].blockingReasons?.[0]).toMatchObject({sourceId:'source',locator:'第 2 页'});
});
it('requires an explicit review to replace an unknown legacy cache policy and never alters that old record',async()=>{
 const t=await fixture();const old={id:'legacy-review',projectId:'project',teachingVersionId:t.version.id,contentHash:t.version.contentHash,status:'uncertain' as const,summary:'旧规则核验',issues:[],privateSolution:'已核对',branches:[],exposureRelations:[],localChecks:[],createdAt:'2026-09-08T00:00:00Z',reviewerModel:t.store.getSettings().model};t.store.put('taskReviews',old);t.service.getView(t.version.id);expect(t.requests).toHaveLength(0);const current:any=await t.service.review(t.version);expect(t.requests).toHaveLength(1);expect(current.id).not.toBe(old.id);expect(t.store.get('taskReviews',old.id)).toEqual(old);await t.service.review(t.version);expect(t.requests).toHaveLength(1);
});
it('rebinds the present same-task steps without rewriting historical teaching, drafts or help',async()=>{
 const {rebindConfirmedSourceVersion}=await import('../src/main/verification-service');const t=await fixture();confirm(t);const next=(t.service as any).adoptConfirmedSources(t.version);const oldStep=t.version.steps[0],session:Session={id:'session',projectId:'project',capabilityId:'capability',activity:t.version.activity,teachingVersionId:t.version.id,mode:'practice',status:'active',draft:'我的当前想法',taskDrafts:{task:'原草稿'},helpLevel:3,helpEvents:[{id:'help',level:3,kind:'example',taskId:'task',createdAt:'2026-09-08T00:00:00Z'}],messages:[{id:'message',role:'user',text:'尚未评分的想法',createdAt:'2026-09-08T00:00:00Z'}],checkpoint:'当前起点',nextStep:'继续',createdAt:'2026-09-08T00:00:00Z',updatedAt:'2026-09-08T00:00:00Z',teaching:{version:1,current:oldStep,upcoming:[oldStep],history:[oldStep],returnStep:oldStep,returnUpcoming:[oldStep],guidance:'supported',confusionCount:1}};
 const before=JSON.stringify(session),rebound=rebindConfirmedSourceVersion(session,next);expect(rebound.activity.teachingVersionId).toBe(next.id);expect(rebound.teaching?.current.activity?.teachingVersionId).toBe(next.id);expect(rebound.teaching?.upcoming[0].activity?.teachingVersionId).toBe(next.id);expect(rebound.teaching?.returnStep?.activity?.teachingVersionId).toBe(next.id);expect(rebound.teaching?.history[0].activity?.teachingVersionId).toBe(t.version.id);expect(rebound.draft).toBe(session.draft);expect(rebound.taskDrafts).toEqual(session.taskDrafts);expect(rebound.helpEvents).toEqual(session.helpEvents);expect(rebound.helpLevel).toBe(3);expect(rebound.messages).toEqual(session.messages);expect(JSON.stringify(session)).toBe(before);
});

it.each([false,true])('does not invent a critical-source blocker for legacy noncritical OCR (independently established: %s)',async independentlyEstablished=>{
 const t=await fixture();const version=t.service.createVersion({...t.version,sources:[...t.version.sources,{id:'background',locator:'第 6 页',text:'背景材料中的模糊符号，本题未使用',warnings:['OCR公式尚未核对'],transcriptionIds:[]}]});
 t.store.put('taskReviews',{id:'legacy-source-checks',projectId:'project',teachingVersionId:version.id,contentHash:version.contentHash,status:'uncertain',summary:'旧摘要不能当作原始状态',issues:[],privateSolution:'已有核对推导',branches:[],exposureRelations:[],sourceChecks:[{sourceId:'source',usesCriticalSymbols:true,independentlyEstablished:false,reason:'本题依赖关键符号，尚未确立'},{sourceId:'background',usesCriticalSymbols:false,independentlyEstablished,reason:'本题未依赖其中的关键符号'}],localChecks:[],createdAt:'2026-09-08T00:00:00Z',reviewerModel:'legacy'});
 const view=t.service.getView(version.id);expect(view.blockingReasons.filter(reason=>reason.code==='source_unverified').map(reason=>reason.sourceId)).toEqual(['source']);expect(view.canAssess).toBe(false);expect(view.reportedStatus).toBeUndefined();expect(t.store.get('taskReviews','legacy-source-checks')).not.toHaveProperty('reportedStatus');expect(t.requests).toHaveLength(0);
});
