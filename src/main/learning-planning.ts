import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {LearningStore} from './store';
import type {CallRunner} from './call-runner';
import type {VerificationService} from './verification-service';
import {OperationManager,bindingDigest,reconcileDerivedState} from './operations';
import {unitGoalSchema,type UnitGoal,type LearningProposal,type Operation,type RouteAssociation} from '../shared/remediation';
import {evidenceStanding,derivedStanding} from '../shared/reliability-state';
import type {Capability,Session} from '../shared/types';
import type {LearningUnit,LearningPosition,RouteVersion} from '../shared/curriculum';
import type {TeachingStep} from '../shared/teaching';
import type {TeachingSource} from '../shared/reliability';
import {teachingPlanSchema} from './schemas';
import {knowledgeMemory,type KnowledgeMemory} from '../shared/knowledge-graph';
import {KnowledgeService} from './knowledge-service';
import {assertKnowledgeCurrent} from './knowledge-context';

const id=z.string().min(1).max(120),copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const sourceStartSchema=z.object({requestId:id,sourceIds:z.array(id).min(1).max(30),intent:z.enum(['explain','practice']),question:z.string().max(10000).optional()}).strict();
export type SourceStartRequest=z.infer<typeof sourceStartSchema>;
export type UnitGoalRequest=Omit<UnitGoal,'version'>&{expectedVersion?:number};
export interface NextProposalRequest{requestId:string;unitId?:string;text:string;reason?:string;}
export interface LocalPlan{result:z.infer<typeof teachingPlanSchema>;steps:TeachingStep[];sources:TeachingSource[];priorLearning?:KnowledgeMemory;}
interface PlanningCallbacks{
 generate(projectId:string,capability:Capability,unit:LearningUnit,request:SourceStartRequest,callId:string):Promise<LocalPlan>;
 position(projectId:string,unit:LearningUnit,sessionId:string|undefined,intent:LearningPosition['intent'],reason:string,nextRequirement:string):void;
}
const analysisSchema=z.object({analysis:z.string().min(1).max(20000),targetUnitId:id.optional(),intent:z.enum(['continue','challenge','advance','synthesize','consolidate','fill_gap']).optional()}).strict();

export class LearningPlanning{
 private running=new Map<string,Promise<unknown>>();
 constructor(private store:LearningStore,private runner:CallRunner,private verifier:VerificationService,private operations:OperationManager,private callbacks:PlanningCallbacks){}
 private project(id:string){const project=this.store.get('projects',id);if(!project||project.trashedAt)throw new Error('学习项目不存在或已移入回收站。');return project;}
 private unit(id:string,projectId?:string):LearningUnit{const unit=this.store.get('learningUnits',id),route=unit?this.store.get('routeVersions',unit.routeVersionId):undefined;if(!unit||(projectId&&unit.projectId!==projectId)||unit.status==='retired'||!route||route.status!=='adopted'||!route.unitIds.includes(unit.id))throw new Error('学习单元不存在或已退出有效路线。');this.project(unit.projectId);return unit;}
 private sources(projectId:string,ids:string[]){return ids.map(id=>{const fragment=this.store.get('fragments',id);if(!fragment||fragment.projectId!==projectId)throw new Error('所选材料片段不存在或不属于这个项目。');return fragment;});}
 private localBinding(operation:Operation):Operation['binding']{
  const request=sourceStartSchema.parse(operation.binding.request),project=this.project(operation.projectId),unit=this.unit(operation.refs.unitId!,project.id);
  return copy({request,projectGoal:project.goal,unit:{id:unit.id,capabilityId:unit.capabilityId,routeVersionId:unit.routeVersionId,coreQuestion:unit.coreQuestion,goal:unit.goal},sources:this.sources(project.id,request.sourceIds),confirmedSources:this.store.list('sourceTranscriptions',project.id).filter(item=>request.sourceIds.includes(item.fragmentId)&&item.status==='confirmed')});
 }
 async startFromSources(projectId:string,body:SourceStartRequest):Promise<Session>{
  const request=sourceStartSchema.parse(body);request.sourceIds=[...new Set(request.sourceIds)];request.question=request.question?.trim();const project=this.project(projectId);if(project.status==='paused')throw new Error('这个项目已暂停，请先恢复。');const fragments=this.sources(projectId,request.sourceIds);
  let operation=this.operations.list(projectId).filter(item=>item.kind==='local_start'&&(item.binding.request as SourceStartRequest|undefined)?.requestId===request.requestId).at(-1);
  if(operation){if(bindingDigest(operation.binding.request)!==bindingDigest(request))throw new Error('这个开始编号已用于不同选段或问题。');return this.runLocal(operation);}
  operation=this.store.transaction(()=>{
   const now=new Date().toISOString(),routeId=randomUUID(),unitId=randomUUID(),capabilityId=randomUUID(),sessionId=randomUUID(),taskId=randomUUID(),stepId=randomUUID(),title=(request.question||fragments[0].locator||'从这里开始').slice(0,80);
   const capability:Capability={id:capabilityId,projectId,title,description:request.question||'理解所选材料并说明其中的关系',sourceIds:request.sourceIds,prerequisites:[],order:this.store.list('capabilities',projectId).length,archived:false,goalContext:project.goal};
   const unit:LearningUnit={id:unitId,projectId,routeVersionId:routeId,capabilityId,title,coreQuestion:request.question||'这一段在说明什么，依据是什么？',purpose:'从当前选段和实际问题开始',expectedOutcome:request.intent==='practice'?'独立完成围绕选段的一次尝试':'用自己的话说明选段的关系和条件',sourceIds:request.sourceIds,locators:fragments.map(fragment=>fragment.locator),prerequisiteUnitIds:[],order:0,phase:'expand',status:'active',createdAt:now,updatedAt:now};
   const {projectId:ignoredProject,routeVersionId:ignoredRoute,status:ignoredStatus,createdAt:ignoredCreated,updatedAt:ignoredUpdated,...unitSnapshot}=unit;
   const route:RouteVersion={id:routeId,projectId,scope:'local',version:1,origin:'generated',status:'adopted',summary:'从当前选段开始的局部学习',coreQuestion:unit.coreQuestion,mapNodes:[],capabilitySnapshots:[{id:capability.id,title:capability.title,description:capability.description,sourceIds:capability.sourceIds,prerequisites:[],order:capability.order,goalContext:project.goal}],unitIds:[unitId],unitSnapshots:[unitSnapshot],coverage:{totalSections:fragments.length,analyzedSectionIds:[],pendingSectionIds:request.sourceIds,method:'学习者选定的材料范围；尚未请求讲解。'},createdAt:now,adoptedAt:now};
   const activity={id:taskId,title,instruction:unit.coreQuestion,kind:'reconstruction' as const,rubric:['说明选段的核心关系'],sourceIds:request.sourceIds,assessmentBasis:'source' as const};
   const session:Session={id:sessionId,projectId,capabilityId,unitId,routeVersionId:routeId,activity,mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'',helpLevel:0,helpEvents:[],messages:request.question?[{id:randomUUID(),role:'user',kind:'note',text:request.question,sourceIds:request.sourceIds,createdAt:now}]:[],checkpoint:'选段和问题已保存在本机',nextStep:'继续读取选段，或请求围绕这个问题的讲解',teaching:{version:1,current:{id:stepId,taskId,action:'explain',title:'从选段开始',content:fragments.map(fragment=>fragment.text).join('\n\n'),sourceIds:request.sourceIds,createdAt:now},upcoming:[],history:[],guidance:'guided',confusionCount:0}};
   this.store.put('capabilities',capability);this.store.put('routeVersions',route);this.store.put('learningUnits',unit);this.store.put('sessions',session);this.callbacks.position(projectId,unit,sessionId,'continue','学习者选定了当前材料和问题。',unit.coreQuestion);
   const seed={projectId,requestId:'local-'+bindingDigest({projectId,requestId:request.requestId}),kind:'local_start' as const,refs:{sessionId,unitId,routeVersionId:routeId},binding:{request},savedSummary:(request.question||'从选段开始：'+fragments.map(fragment=>fragment.locator).join('、')).slice(0,4000)};
   const operation=this.operations.save(seed);return this.operations.patch(operation.id,{binding:this.localBinding(operation),bindingDigest:bindingDigest(this.localBinding(operation))});
  });return this.runLocal(operation);
 }
 private async runLocal(original:Operation):Promise<Session>{
  const running=this.running.get(original.id);if(running)return running as Promise<Session>;
  const work=this.performLocal(original);this.running.set(original.id,work);try{return await work;}finally{this.running.delete(original.id);}
 }
 private async performLocal(original:Operation):Promise<Session>{
  let operation=this.operations.get(original.id);if(operation.phase==='completed')return this.store.get('sessions',operation.refs.sessionId!)!;
  if(operation.phase==='result_saved'){this.resume(operation.id);return this.store.get('sessions',operation.refs.sessionId!)!;}
  if(operation.phase==='stale')throw new Error('原结果的依据已经变化，请明确重新请求。');
  try{
   operation=this.operations.start(operation.id,this.localBinding(operation));const unit=this.unit(operation.refs.unitId!,operation.projectId),capability=this.store.get('capabilities',unit.capabilityId)!;
   const callId=this.operations.beginCall(operation.id),plan=await this.callbacks.generate(operation.projectId,capability,unit,sourceStartSchema.parse(operation.binding.request),callId);
   this.operations.saveResult(operation.id,plan);this.resume(operation.id);this.runner.markPublished(plan.result);return this.store.get('sessions',operation.refs.sessionId!)!;
  }catch(error){this.operations.fail(operation.id,error);throw error;}
 }
 resume(operationId:string):void{
  const operation=this.operations.get(operationId);this.project(operation.projectId);if(operation.phase==='completed')return;if(operation.phase!=='result_saved')throw new Error('没有已保存的本地结果，请明确重新请求。');
  try{
   if(operation.kind==='local_start'){
    this.operations.assertBinding(operation.id,this.localBinding(operation));const plan=operation.result as LocalPlan;teachingPlanSchema.parse(plan.result);
    this.store.transaction(()=>{this.operations.assertBinding(operation.id,this.localBinding(operation));const unit=this.unit(operation.refs.unitId!,operation.projectId),session=this.store.get('sessions',operation.refs.sessionId!)!;if(!session||session.projectId!==operation.projectId||session.unitId!==unit.id)throw new Error('原局部学习会话不存在。');
     assertKnowledgeCurrent(this.store,plan.priorLearning);const version=this.verifier.createVersion({projectId:session.projectId,capabilityId:session.capabilityId,activity:plan.steps.find(step=>step.activity)!.activity!,steps:plan.steps,sources:plan.sources});
     if(plan.priorLearning)new KnowledgeService(this.store).rememberUse(version.id,plan.priorLearning);const current=version.steps[0],next={...session,activity:version.activity,teachingVersionId:version.id,teaching:{version:1 as const,current,upcoming:version.steps.slice(1),history:session.teaching?.history??[],guidance:'guided' as const,confusionCount:0},checkpoint:current.title,nextStep:'围绕选段继续学习；题目尚未独立核验时，只记录想法与探讨',updatedAt:new Date().toISOString()};this.store.put('sessions',next);
     const project=this.project(operation.projectId),position=project.learningPositionId?this.store.get('learningPositions',project.learningPositionId):undefined;if(position?.sessionId===session.id)this.callbacks.position(project.id,unit,session.id,'continue','接着当前选段和问题学习。',current.title);
     if(current.action==='explain'||current.action==='demonstrate')this.verifier.recordExposure(next,'demonstration',current.content,current.taskId);this.operations.complete(operation.id);
    });return;
   }
   if(operation.kind==='proposal_analysis'){this.publishAnalysis(operation);return;}
   throw new Error('这个操作没有本地恢复处理器。');
  }catch(error){this.operations.fail(operation.id,error);throw error;}
 }
 async retry(operationId:string):Promise<void>{
  let operation=this.operations.get(operationId);this.project(operation.projectId);if(operation.phase==='result_saved'||operation.phase==='completed'){this.resume(operation.id);return;}
  if(operation.kind==='local_start'){
   if(operation.phase==='stale')operation=this.operations.save({projectId:operation.projectId,requestId:'local-retry-'+randomUUID(),kind:'local_start',refs:operation.refs,binding:this.localBinding(operation),savedSummary:operation.savedSummary});
   await this.runLocal(operation);return;
  }
  if(operation.kind==='proposal_analysis'&&operation.refs.proposalId){await this.analyzeProposal(operation.refs.proposalId);return;}
  throw new Error('这个操作不能从这里重新请求。');
 }
 saveGoal(projectId:string,unitId:string,input:UnitGoalRequest):UnitGoal{
  const unit=this.unit(unitId,projectId),previous=unit.goal?.version??0;if((input.expectedVersion??0)!==previous)throw new Error('目标已被修改，请先读取当前版本再保存。');
  const goal=unitGoalSchema.parse({behavior:input.behavior,materialScope:input.materialScope,allowedHelp:input.allowedHelp,verification:input.verification,version:previous+1});if(!goal.behavior.trim())throw new Error('请写下希望能够完成的一个动作。');this.store.put('learningUnits',{...unit,goal,updatedAt:new Date().toISOString()});return goal;
 }
 proposeAssociation(localUnitId:string,bookUnitId:string,reason:string):RouteAssociation{
  const local=this.unit(localUnitId),book=this.unit(bookUnitId,local.projectId);if(this.store.get('routeVersions',local.routeVersionId)?.scope!=='local'||this.store.get('routeVersions',book.routeVersionId)?.scope==='local')throw new Error('请关联一个局部单元和一个整书单元。');if(!reason.trim()||reason.length>4000)throw new Error('请简要说明关联理由。');
  const existing=this.store.list('routeAssociations',local.projectId).find(item=>item.localUnitId===local.id&&item.bookUnitId===book.id&&item.status!=='dismissed');if(existing)return existing;
  const now=new Date().toISOString(),association:RouteAssociation={id:randomUUID(),projectId:local.projectId,localUnitId,bookUnitId,status:'proposed',reason,createdAt:now,updatedAt:now};this.store.put('routeAssociations',association);return association;
 }
 decideAssociation(id:string,status:'linked'|'dismissed'):RouteAssociation{
  const association=this.store.get('routeAssociations',id);if(!association)throw new Error('关联提案不存在。');this.project(association.projectId);this.unit(association.localUnitId,association.projectId);this.unit(association.bookUnitId,association.projectId);if(association.status===status)return association;if(association.status!=='proposed')throw new Error('这个关联已经处理。');const updated={...association,status,updatedAt:new Date().toISOString()};this.store.put('routeAssociations',updated);return updated;
 }
 private proposal(id:string):LearningProposal{const proposal=this.store.get('learningProposals',id);if(!proposal)throw new Error('学习建议不存在。');this.project(proposal.projectId);return proposal;}
 private proposalBasis(proposal:LearningProposal){
  const project=this.project(proposal.projectId),unit=proposal.unitId?this.unit(proposal.unitId,project.id):undefined,snapshot=this.store.snapshot(),evidence=snapshot.evidence.filter(item=>item.projectId===project.id&&(!unit||item.capabilityId===unit.capabilityId)&&evidenceStanding(snapshot,item).effective);
  const versionIds=[...new Set(evidence.flatMap(item=>item.teachingVersionId?[item.teachingVersionId]:[]))],candidates=this.store.list('learningUnits',project.id).filter(item=>item.status!=='retired'&&this.store.get('routeVersions',item.routeVersionId)?.status==='adopted').map(item=>({id:item.id,capabilityId:item.capabilityId,routeVersionId:item.routeVersionId,coreQuestion:item.coreQuestion,expectedOutcome:item.expectedOutcome,goal:item.goal}));
  return copy({priorLearning:unit?knowledgeMemory(snapshot,project.id,unit.capabilityId):undefined,projectGoal:project.goal,unit:unit?{id:unit.id,capabilityId:unit.capabilityId,coreQuestion:unit.coreQuestion,expectedOutcome:unit.expectedOutcome,goal:unit.goal}:undefined,candidates,evidence,versions:snapshot.teachingVersions.filter(item=>versionIds.includes(item.id)),reviews:snapshot.taskReviews.filter(item=>versionIds.includes(item.teachingVersionId)),corrections:snapshot.corrections.filter(item=>versionIds.includes(item.teachingVersionId)),proposalText:proposal.text,proposalReason:proposal.reason,dismissed:proposal.status==='dismissed'});
 }
 proposeNext(projectId:string,input:NextProposalRequest):LearningProposal{
  const value=z.object({requestId:id,unitId:id.optional(),text:z.string().min(1).max(10000),reason:z.string().max(10000).default('')}).strict().parse(input),project=this.project(projectId);if(!value.text.trim())throw new Error('请写下想怎样继续。');
  const existing=this.store.list('learningProposals',projectId).find(item=>item.requestId===value.requestId);if(existing){if(existing.text!==value.text||existing.reason!==value.reason||(value.unitId&&existing.unitId!==value.unitId))throw new Error('提案编号已用于不同内容。');return existing;}
  const position=project.learningPositionId?this.store.get('learningPositions',project.learningPositionId):undefined,unitId=value.unitId??position?.unitId;if(unitId)this.unit(unitId,projectId);
  const now=new Date().toISOString(),proposal:LearningProposal={...value,id:randomUUID(),projectId,unitId,status:'saved',basisDigest:'',basedOnEvidenceIds:[],basedOnTeachingVersionIds:[],createdAt:now,updatedAt:now};proposal.basisDigest=bindingDigest(this.proposalBasis(proposal));this.store.put('learningProposals',proposal);return proposal;
 }
 async analyzeProposal(proposalId:string):Promise<LearningProposal>{
  let proposal=this.proposal(proposalId);if(proposal.status==='dismissed')throw new Error('这个建议已略过。');reconcileDerivedState(this.store);proposal=this.proposal(proposalId);const basis=this.proposalBasis(proposal),digest=bindingDigest(basis);
  if((proposal.status==='proposed'||proposal.status==='adopted')&&proposal.basisDigest===digest)return proposal;
  let operation=this.operations.list(proposal.projectId).filter(item=>item.kind==='proposal_analysis'&&item.refs.proposalId===proposal.id&&item.phase!=='completed'&&item.phase!=='stale').at(-1);
  if(operation&&operation.bindingDigest!==digest){try{this.operations.assertBinding(operation.id,basis);}catch{/* assertBinding persists the stale status; this branch starts a new operation. */}operation=undefined;}
  operation??=this.operations.save({projectId:proposal.projectId,requestId:'proposal-'+randomUUID(),kind:'proposal_analysis',refs:{proposalId:proposal.id,unitId:proposal.unitId},binding:basis,savedSummary:proposal.text.slice(0,4000)});
  const running=this.running.get(operation.id);if(running)return running as Promise<LearningProposal>;
  const work=this.performAnalysis(operation,proposal);this.running.set(operation.id,work);try{return await work;}finally{this.running.delete(operation.id);}
 }
 private async performAnalysis(operation:Operation,proposal:LearningProposal):Promise<LearningProposal>{
  try{
   if(operation.phase==='result_saved'){this.resume(operation.id);return this.proposal(proposal.id);}
   const basis=this.proposalBasis(proposal);this.operations.start(operation.id,basis);this.store.put('learningProposals',{...proposal,status:'analyzing',updatedAt:new Date().toISOString()});const requestId=this.operations.beginCall(operation.id);
   const result=await this.runner.run('分析我的下一步',{operation:'analyze_learner_proposal',priorLearning:basis.priorLearning?{entries:basis.priorLearning.entries,instruction:basis.priorLearning.instruction}:undefined,projectGoal:basis.projectGoal,unit:basis.unit,candidates:basis.candidates,evidence:basis.evidence.map(item=>({id:item.id,status:item.status,helpLevel:item.helpLevel,feedback:item.assessment.feedback})),proposal:{text:proposal.text,reason:proposal.reason},instruction:'分析学习者提出的下一步及理由。只返回简短analysis，以及可选的现有targetUnitId和intent。只可选择给定candidates中的单元，不能创建路线、自动采用、宣称已掌握或把自述当证据。说明建议理由、所需帮助和仍未知之处。'},{requestId,schema:analysisSchema,validate:value=>{if(value.targetUnitId&&!basis.candidates.some(unit=>unit.id===value.targetUnitId))throw new Error('建议指向了不存在的学习单元。');if(!!value.targetUnitId!==!!value.intent)throw new Error('目标单元和继续方式必须同时给出。');}});
   this.operations.saveResult(operation.id,result);this.publishAnalysis(this.operations.get(operation.id));this.runner.markPublished(result);return this.proposal(proposal.id);
  }catch(error){this.operations.fail(operation.id,error);const latest=this.proposal(proposal.id);if(latest.status==='analyzing')this.store.put('learningProposals',{...latest,status:this.operations.get(operation.id).phase==='stale'?'stale':'saved',updatedAt:new Date().toISOString()});throw error;}
 }
 private publishAnalysis(operation:Operation):void{
  const proposal=this.proposal(operation.refs.proposalId!),basis=this.proposalBasis(proposal);this.operations.assertBinding(operation.id,basis);const result=analysisSchema.parse(operation.result);
  this.store.transaction(()=>{this.operations.assertBinding(operation.id,this.proposalBasis(this.proposal(proposal.id)));this.store.put('learningProposals',{...proposal,...result,status:'proposed',basisDigest:bindingDigest(basis),knowledgeBasis:basis.priorLearning?.entries.length?{capabilityId:basis.priorLearning.capabilityId,digest:bindingDigest(basis.priorLearning.fingerprint)}:undefined,basedOnEvidenceIds:basis.evidence.map(item=>item.id),basedOnTeachingVersionIds:basis.versions.map(item=>item.id),updatedAt:new Date().toISOString()});this.operations.complete(operation.id);});
 }
 adoptProposal(id:string):LearningProposal{
  reconcileDerivedState(this.store);const proposal=this.proposal(id);if(proposal.status==='stale')throw new Error('目标或依据已经变化，请先重新分析这条建议。');if(proposal.status==='adopted')return proposal;if(proposal.status!=='proposed'||!proposal.targetUnitId||!proposal.intent)throw new Error('请先分析并选择一个有效的下一步。');
  if(proposal.basisDigest!==bindingDigest(this.proposalBasis(proposal))||!derivedStanding(this.store.snapshot(),proposal).effective){this.store.put('learningProposals',{...proposal,status:'stale',updatedAt:new Date().toISOString()});throw new Error('目标或依据已经变化，请先重新分析这条建议。');}
  const unit=this.unit(proposal.targetUnitId,proposal.projectId),session=this.store.list('sessions',proposal.projectId).filter(item=>item.unitId===unit.id&&item.status!=='completed').at(-1),updated={...proposal,status:'adopted' as const,updatedAt:new Date().toISOString()};
  this.store.transaction(()=>{this.callbacks.position(proposal.projectId,unit,session?.id,proposal.intent!,proposal.analysis||proposal.reason,proposal.text);const project=this.project(proposal.projectId),position=this.store.get('learningPositions',project.learningPositionId!)!;this.store.put('learningPositions',{...position,knowledgeBasis:proposal.knowledgeBasis,basedOnEvidenceIds:proposal.basedOnEvidenceIds,basedOnTeachingVersionIds:proposal.basedOnTeachingVersionIds,derivedStatus:'active'});this.store.put('learningProposals',updated);});return updated;
 }
 dismissProposal(id:string):LearningProposal{const proposal=this.proposal(id);if(proposal.status==='adopted')throw new Error('这条建议已经采用。');const updated={...proposal,status:'dismissed' as const,updatedAt:new Date().toISOString()};this.store.put('learningProposals',updated);return updated;}
}
