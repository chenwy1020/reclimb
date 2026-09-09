import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';
import {taskFamilySignature} from '../src/main/curriculum';
import {reviewedTeaching,withCriterionIds} from './helpers/review-response';
import type {ModelProvider,ModelRequest} from '../src/main/provider';
import type {TaskDemand} from '../src/shared/types';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

const basicDemand:TaskDemand={kind:'calculate',complexity:1,novelty:1,scaffolding:'supported',concepts:['路径极值']};
const harderDemand:TaskDemand={kind:'derive',complexity:3,novelty:2,scaffolding:'supported',concepts:['路径极值','条件边界']};

class TeachingProvider implements ModelProvider {
 inputs:any[]=[];
 beforeTeachingReturn?:()=>void;
 includePrelude=false;
 incompleteAssessment=false;
 async complete(request:ModelRequest){
  const input=JSON.parse(request.user);this.inputs.push(input);
  if(input.operation==='review_teaching')return {text:JSON.stringify(reviewedTeaching(input)),inputTokens:1,outputTokens:1,usageKnown:true};
  if(input.operation==='suggest_understanding')return {text:JSON.stringify({title:'把路径方法压缩成自己的框架',blocks:[{text:'先沿每条路径取最高值，再在路径之间比较；条件不足时保留未知。',sourceIds:['f']}]}),inputTokens:1,outputTokens:1,usageKnown:true};
  if(input.answer){const value={outcome:'met',feedback:'已经完成当前具体要求。',criteria:input.activity.rubric.map((criterion:string)=>({criterion,result:this.incompleteAssessment?'partial':'met',reason:this.incompleteAssessment?'仍缺少一项依据':'作答包含所需判断'})),limitations:[],sourceIds:['f']};return {text:JSON.stringify(withCriterionIds(value,input)),inputTokens:1,outputTokens:1,usageKnown:true};}
  const challenge=input.progression?.action==='challenge'||input.intent==='challenge';
  const activity={title:challenge?'推导条件边界':input.intent==='smaller'?'只看一条路径':'比较路径极值',instruction:challenge?'推导为什么端点条件不足以单独推出正下界，并说明需要增加什么条件。':input.intent==='smaller'?'一条路径的能量依次是 1、4、2，只指出这条路径的最高值。':'两条路径最高值分别为 3 与 5。比较它们给出的上界。',kind:challenge?'argument':'application',rubric:[challenge?'说明逻辑缺口并提出额外条件':input.intent==='smaller'?'指出一条路径的最高值':'比较两个路径最高值'],sourceIds:['f'],assessmentBasis:'source',demand:challenge?harderDemand:basicDemand,workSize:challenge?'extended':'short',milestones:challenge?['指出不足','提出条件','说明作用']:[]};
  const prelude={action:'explain',title:input.intent==='smaller'?'先缩小到一条路径':'先辨认两层比较',content:'先确认路径内取最高值，再比较不同路径。',sourceIds:['f']};
  const steps=this.includePrelude||input.intent==='smaller'?[prelude,{action:'attempt',title:activity.title,content:activity.instruction,sourceIds:['f'],activity}]:[{action:'attempt',title:activity.title,content:activity.instruction,sourceIds:['f'],activity}];
  const hook=this.beforeTeachingReturn;this.beforeTeachingReturn=undefined;hook?.();
  return {text:JSON.stringify({steps}),inputTokens:1,outputTokens:1,usageKnown:true};
 }
}

async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'reclimb-progression-'));roots.push(root);const store=await LearningStore.open(root);const now='2026-09-09T00:00:00.000Z';
 store.transaction(()=>{
  store.updateSettings({monthlyBudgetCny:100});
  store.put('projects',{id:'p',title:'原创教材',goal:'能重构并应用整本教材的方法',status:'active',startingPoint:{familiarity:'experienced',background:'熟悉导数与极值',updatedAt:now},activeRouteVersionId:'r',learningPositionId:'pos',createdAt:now,updatedAt:now});
  store.put('materials',{id:'m',projectId:'p',title:'教材',kind:'md',originalName:'book.md',storedPath:join(root,'book.md'),importedAt:now,warnings:[],fragmentCount:1,summary:'路径与极值'});
  store.put('fragments',{id:'f',projectId:'p',materialId:'m',locator:'第 1 章',ordinal:0,text:'比较路径上的最大值，并在路径族中取下确界。'});
  store.put('capabilities',{id:'c1',projectId:'p',title:'理解路径极值',description:'解释并推导路径极值',prerequisites:[],sourceIds:['f'],order:0});
  store.put('capabilities',{id:'c2',projectId:'p',title:'综合条件',description:'比较适用条件',prerequisites:['c1'],sourceIds:['f'],order:1});
  const snapshots=[
   {id:'u1',capabilityId:'c1',title:'从全书看路径方法',coreQuestion:'路径方法解决什么问题？',purpose:'先建立全局位置',expectedOutcome:'能解释路径极值的角色',sourceIds:['f'],locators:['第 1 章'],prerequisiteUnitIds:[],order:0,phase:'expand' as const},
   {id:'u2',capabilityId:'c2',title:'综合条件与边界',coreQuestion:'条件何时足够？',purpose:'连接多个条件',expectedOutcome:'能分析适用边界',sourceIds:['f'],locators:['第 1 章'],prerequisiteUnitIds:['u1'],order:1,phase:'synthesize' as const},
  ];
  store.put('routeVersions',{id:'r',projectId:'p',version:1,origin:'generated',status:'adopted',summary:'全书粗图',coreQuestion:'如何从路径得到方法？',mapNodes:[],capabilitySnapshots:[],unitIds:['u1','u2'],unitSnapshots:snapshots,coverage:{totalSections:1,analyzedSectionIds:['f'],pendingSectionIds:[],method:'测试'},createdAt:now,adoptedAt:now});
  for(const unit of snapshots)store.put('learningUnits',{...unit,projectId:'p',routeVersionId:'r',status:unit.id==='u1'?'active':'available',createdAt:now,updatedAt:now});
  store.put('learningPositions',{id:'pos',projectId:'p',routeVersionId:'r',unitId:'u1',intent:'continue',reason:'从这里开始',nextRequirement:'比较路径极值',confidence:'confirmed',updatedAt:now});
 });
 const provider=new TeachingProvider(),service=new LearningService(store,()=>'test',()=>provider);return {store,service,provider};
}

describe('durable learning position and progression',()=>{
 it('resumes the existing session for a unit unless a new attempt is explicit',async()=>{
  const {store,service,provider}=await fixture();const first=await service.start('p',undefined,'practice',undefined,undefined,'u1');const callCount=provider.inputs.length;
  const resumed=await service.start('p',undefined,'practice',undefined,undefined,'u1');
  expect(resumed.id).toBe(first.id);expect(provider.inputs).toHaveLength(callCount);expect(store.get('learningPositions','pos')).toMatchObject({unitId:'u1',sessionId:first.id});
  const fresh=await service.start('p',undefined,'practice',undefined,undefined,'u1',true);expect(fresh.id).not.toBe(first.id);expect(fresh.unitId).toBe('u1');
 });

 it('marks source sections as analyzed when a unit actually reads them',async()=>{
  const {store,service}=await fixture();const route=store.get('routeVersions','r')!;store.put('routeVersions',{...route,coverage:{...route.coverage,analyzedSectionIds:[],pendingSectionIds:['f']}});
  await service.start('p',undefined,'practice',undefined,undefined,'u1');expect(store.get('routeVersions','r')?.coverage).toMatchObject({analyzedSectionIds:['f'],pendingSectionIds:[]});
 });

 it('stores discussion and work as observations without inventing ability evidence',async()=>{
  const {store,service}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');
  const receipt=service.recordInput(session.id,{requestId:'input-1',text:'我认为要先比较每条路径上的最高值。',kind:'attempt',taskId:session.activity.id,stepId:session.teaching?.current.id,teachingVersionId:session.teachingVersionId});
  expect(store.list('teachingObservations','p')).toContainEqual(expect.objectContaining({unitId:'u1',sessionId:session.id,inputId:receipt.inputId,kind:'learner_work',certainty:'unverified',status:'active'}));
  expect(store.list('evidence','p')).toEqual([]);
  await service.respondInput(session.id,receipt.inputId);
  expect(store.list('teachingObservations','p')).toContainEqual(expect.objectContaining({attemptId:receipt.attemptId,kind:'verified_performance',certainty:'verified'}));
  expect(store.list('evidence','p')).toHaveLength(1);
 });

 it('does not make a needs-review assessment eligible for automatic progression even when its headline outcome is met',async()=>{
  const {store,service,provider}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');provider.incompleteAssessment=true;await service.submit(session.id,'只写了结论','needs-review-answer');const evidence=store.list('evidence','p')[0],observation=store.list('teachingObservations','p').find(item=>item.evidenceId===evidence.id)!;
  expect(evidence.status).toBe('needs_review');expect(observation).toMatchObject({outcome:'met',progressionEligible:false});
 });

 it('turns a third same-level task into a materially harder challenge',async()=>{
  const {store,service,provider}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');
  const family=taskFamilySignature('两条路径最高值分别为 3 与 5。比较它们给出的上界。',basicDemand);
  for(const index of [1,2])store.put('teachingObservations',{id:'o'+index,projectId:'p',unitId:'u1',sessionId:session.id,kind:'verified_performance',scope:'比较路径极值',summary:'完成同层比较',taskFamily:family,demand:basicDemand,helpLevel:0,certainty:'verified',outcome:'met',progressionEligible:true,status:'active',createdAt:`2026-09-09T00:0${index}:00.000Z`});
  const current=store.get('sessions',session.id)!;current.activity.instruction='两条路径最高值分别为 7 与 9。比较它们给出的上界。';current.activity.demand=basicDemand;store.put('sessions',current);
  const next=await service.nextStep(session.id,'continue');expect(next.activity.demand).toEqual(harderDemand);
  expect([...provider.inputs].reverse().find((input:any)=>input.steps===undefined&&input.operation!=='review_teaching'&&!input.answer)?.progression).toMatchObject({action:'challenge'});
  expect(store.get('learningPositions','pos')?.intent).toBe('challenge');
 });

 it('keeps an explicit smaller step out of challenge state even after two successful same-level tasks',async()=>{
  const {store,service,provider}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');const family=taskFamilySignature(session.activity.instruction,basicDemand);
  for(const index of [1,2])store.put('teachingObservations',{id:'smaller-'+index,projectId:'p',unitId:'u1',sessionId:session.id,taskId:'old-'+index,kind:'verified_performance',scope:'比较路径极值',summary:'完成同层比较',taskFamily:family,demand:basicDemand,helpLevel:0,certainty:'verified',outcome:'met',progressionEligible:true,status:'active',createdAt:`2026-09-09T00:0${index}:00.000Z`});
  await service.nextStep(session.id,'smaller','step');
  expect(store.get('learningPositions','pos')?.intent).toBe('continue');
  expect([...provider.inputs].reverse().find((input:any)=>input.intent==='smaller')?.progression).toMatchObject({action:'smaller'});
 });

 it('rejects a generated start if the learner changes the mainline while the model is responding',async()=>{
  const {store,service,provider}=await fixture();provider.beforeTeachingReturn=()=>{const position=store.get('learningPositions','pos')!;store.put('learningPositions',{...position,unitId:'u2',sessionId:undefined,updatedAt:'2026-09-10T00:00:00.000Z'});};
  await expect(service.start('p',undefined,'practice',undefined,undefined,'u1',true)).rejects.toThrow(/位置|路线/);
  expect(store.list('sessions','p')).toEqual([]);expect(store.get('learningPositions','pos')?.unitId).toBe('u2');
 });

 it('rejects a generated next step if the learner enters another unit while the model is responding',async()=>{
  const {store,service,provider}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');const before=store.get('sessions',session.id)!;
  provider.beforeTeachingReturn=()=>{const position=store.get('learningPositions','pos')!;store.put('learningPositions',{...position,unitId:'u2',sessionId:undefined,updatedAt:'2026-09-10T00:00:00.000Z'});};
  await expect(service.nextStep(session.id,'challenge')).rejects.toThrow(/位置|路线/);
  expect(store.get('sessions',session.id)?.activity.id).toBe(before.activity.id);expect(store.get('learningPositions','pos')?.unitId).toBe('u2');
 });

 it('updates the durable next requirement when moving inside a prepared teaching fragment',async()=>{
  const {store,service,provider}=await fixture();provider.includePrelude=true;const session=await service.start('p',undefined,'practice',undefined,undefined,'u1',true);
  expect(session.teaching?.current.title).toBe('先辨认两层比较');await service.nextStep(session.id,'continue');
  expect(store.get('learningPositions','pos')).toMatchObject({unitId:'u1',sessionId:session.id,nextRequirement:'比较路径极值'});
 });

 it('updates the durable position when returning from a smaller branch',async()=>{
  const {store,service}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');const originalTitle=session.teaching?.current.title;await service.nextStep(session.id,'smaller','step');expect(store.get('learningPositions','pos')?.nextRequirement).toBe('先缩小到一条路径');await service.nextStep(session.id,'return');expect(store.get('learningPositions','pos')).toMatchObject({unitId:'u1',sessionId:session.id,nextRequirement:originalTitle});
 });

 it('refuses to resume a historical session whose unit has left the active route',async()=>{
  const {store,service}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');store.put('sessions',{...store.get('sessions',session.id)!,status:'paused'});const unit=store.get('learningUnits','u1')!;store.put('learningUnits',{...unit,status:'retired'});const before=store.get('learningPositions','pos');
  expect(()=>service.resumeSession(session.id)).toThrow(/路线|定位/);expect(store.get('learningPositions','pos')).toEqual(before);expect(store.get('sessions',session.id)?.status).toBe('paused');
 });

 it('can advance directly and resumes the destination unit without claiming the prior one is mastered',async()=>{
  const {store,service,provider}=await fixture();const first=await service.start('p',undefined,'practice',undefined,undefined,'u1');const second=await service.start('p',undefined,'practice',undefined,undefined,'u2');
  store.put('learningPositions',{...store.get('learningPositions','pos')!,unitId:'u1',sessionId:first.id});const before=provider.inputs.length;
  const advanced=await service.nextStep(first.id,'advance');expect(advanced.id).toBe(second.id);expect(provider.inputs).toHaveLength(before);
  expect(store.get('learningPositions','pos')).toMatchObject({unitId:'u2',sessionId:second.id,intent:'advance'});expect(store.get('learningUnits','u1')?.status).not.toBe('completed');
 });

 it('versions learner understanding locally and keeps AI suggestions visibly attributed',async()=>{
  const {store,service}=await fixture();const session=await service.start('p',undefined,'practice',undefined,undefined,'u1');const callsBefore=store.list('usage').length;
  const first=service.saveUnderstanding('p',{unitId:'u1',phase:'expand',title:'我的展开',text:'路径的最高值和路径之间的选择是两层操作。',sourceIds:['f'],sourceInputIds:[]});
  const revised=service.saveUnderstanding('p',{unitId:'u1',phase:'expand',title:'我的展开',text:'先在路径内取最高值，再在路径之间取下确界。',sourceIds:['f'],sourceInputIds:[],basedOnDraftId:first.id});
  expect(store.get('understandingDrafts',first.id)?.status).toBe('superseded');expect(revised.blocks[0].author).toBe('learner');expect(store.list('usage')).toHaveLength(callsBefore);expect(store.list('evidence')).toHaveLength(0);
  const suggestion=await service.suggestUnderstanding('p','u1','synthesize');expect(suggestion.blocks[0].author).toBe('ai');expect(suggestion.blocks[0].text).toContain('条件不足');
  const edited=service.saveUnderstanding('p',{unitId:'u1',phase:'synthesize',title:'我修订后的框架',text:'我保留两层极值，并补上适用条件。',sourceIds:['f'],sourceInputIds:[],basedOnDraftId:suggestion.id});expect(edited.blocks[0].author).toBe('learner_edited_ai');
  expect(store.list('answerExposures','p').some(item=>item.sessionId===session.id&&item.text.includes('条件不足'))).toBe(true);expect(store.list('evidence')).toHaveLength(0);
 });
});
