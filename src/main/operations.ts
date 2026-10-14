import {knowledgeMemory} from '../shared/knowledge-graph';
import {createHash,randomUUID} from 'node:crypto';
import type {Operation} from '../shared/remediation';
import type {LearningStore} from './store';
import {derivedStanding,evidenceStanding} from '../shared/reliability-state';

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
/** Canonical content digest: object insertion order is not a semantic revision. */
export function bindingDigest(value:unknown):string{
 const canonical=JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
 return createHash('sha256').update(canonical).digest('hex');
}
export class OperationBindingError extends Error {}
const recoveredStores=new WeakSet<LearningStore>();
export class OperationManager{
 constructor(private store:LearningStore){
  if(recoveredStores.has(store))return;
  const interrupted=store.list('operations').filter(operation=>operation.phase==='running');
  if(interrupted.length)store.transaction(()=>{for(const operation of interrupted)this.patch(operation.id,{phase:'interrupted',failureStage:'model_call',failureReason:'上次操作中断；输入仍在本机。结果未知时须明确重试，可能产生新费用。'});});
  recoveredStores.add(store);
 }
 list(projectId:string):Operation[]{return this.store.list('operations',projectId);}
 get(id:string):Operation{const operation=this.store.get('operations',id);if(!operation)throw new Error('本地操作记录不存在。');return operation;}
 save(input:Pick<Operation,'projectId'|'requestId'|'kind'|'refs'|'binding'|'savedSummary'>):Operation{
  const existing=this.store.list('operations',input.projectId).find(operation=>operation.kind===input.kind&&operation.requestId===input.requestId);
  if(existing){if(bindingDigest(existing.refs)!==bindingDigest(input.refs))throw new Error('操作编号已绑定其他输入。');return existing;}
  const now=new Date().toISOString(),operation:Operation={...clone(input),id:randomUUID(),phase:'saved',bindingDigest:bindingDigest(input.binding),callIds:[],createdAt:now,updatedAt:now};this.store.put('operations',operation);return operation;
 }
 patch(id:string,changes:Partial<Pick<Operation,'phase'|'binding'|'bindingDigest'|'savedSummary'|'failureStage'|'failureReason'|'callIds'|'result'>>):Operation{
  const operation={...this.get(id),...changes,updatedAt:new Date().toISOString()};this.store.put('operations',operation);return operation;
 }
 start(id:string,binding:Operation['binding']):Operation{
  const operation=this.get(id);if(operation.phase==='stale')throw new Error('原操作依据已经变化，已归档的结果不能重新采用。');
  if(operation.phase==='completed'||operation.phase==='result_saved')return operation;
  return this.patch(id,{phase:'running',binding:clone(binding),bindingDigest:bindingDigest(binding),failureStage:undefined,failureReason:undefined});
 }
 beginCall(id:string):string{
  const operation=this.get(id),callId='input-'+bindingDigest({projectId:operation.projectId,inputId:operation.refs.inputId,operationId:id,call:operation.callIds.length});
  this.patch(id,{callIds:[...operation.callIds,callId]});return callId;
 }
 private callIds(operation:Operation):string[]{return [...new Set([...operation.callIds,...this.store.list('usage').filter(usage=>usage.operationId&&operation.callIds.includes(usage.operationId)).map(usage=>usage.id)])];}
 saveResult(id:string,result:unknown):Operation{const operation=this.get(id);return this.patch(id,{phase:'result_saved',result:clone(result),callIds:this.callIds(operation),failureStage:undefined,failureReason:undefined});}
 fail(id:string,error:unknown):void{
  const operation=this.get(id);if(operation.phase==='completed'||operation.phase==='stale')return;
  if(error instanceof OperationBindingError){this.markStale(id,error.message);return;}
  this.patch(id,{phase:operation.phase==='result_saved'?'result_saved':'interrupted',callIds:this.callIds(operation),failureStage:operation.phase==='result_saved'?'local_commit':'model_call',failureReason:(error instanceof Error?error.message:'操作尚未完成').slice(0,4000)});
 }
 assertBinding(id:string,binding:Operation['binding']):void{
  const operation=this.get(id);if(operation.bindingDigest===bindingDigest(binding))return;
  const reason='原作答、题目标准、核验或已确认转录在回应期间发生变化或质疑；原回复已归档，未采用为能力证据。';
  this.markStale(id,reason);throw new OperationBindingError(reason);
 }
 private markStale(id:string,reason:string):void{
  const operation=this.get(id);this.store.transaction(()=>{this.patch(id,{phase:'stale',failureStage:'binding_check',failureReason:reason});for(const callId of this.callIds(operation)){const usage=this.store.get('usage',callId);if(usage)this.store.put('usage',{...usage,publicationStatus:'discarded'});}});
 }
 /** Call inside the same outer transaction as the response and its derived records. */
 complete(id:string):void{
  const operation=this.get(id);if(operation.phase==='completed')return;if(operation.phase!=='result_saved')throw new Error('没有已保存的有效结果，不能完成本地发布。');
  this.patch(id,{phase:'completed',failureStage:undefined,failureReason:undefined});for(const callId of this.callIds(operation)){const usage=this.store.get('usage',callId);if(usage?.validationStatus==='valid')this.store.put('usage',{...usage,publicationStatus:'published'});}
 }
}

/** Suspend conclusions, never learner-authored history. A later restore cannot revive them implicitly. */
export function reconcileDerivedState(store:LearningStore):void{
 // Standing and knowledge signatures depend on saved evidence and source text,
 // not original ink or its recognition history. Avoid loading these on UI refresh.
 const snapshot=store.snapshot({includeHandwriting:false});
 const knowledgeCurrent=(item:{projectId:string;knowledgeBasis?:{capabilityId:string;digest:string}})=>!item.knowledgeBasis||item.knowledgeBasis.digest===bindingDigest(knowledgeMemory(snapshot,item.projectId,item.knowledgeBasis.capabilityId).fingerprint);
 const observations=snapshot.teachingObservations.filter(item=>{if(item.status!=='active'||!item.evidenceId)return false;const evidence=snapshot.evidence.find(evidence=>evidence.id===item.evidenceId);return !evidence||!evidenceStanding(snapshot,evidence).effective;});
 const drafts=snapshot.understandingDrafts.filter(item=>item.derivedStatus!=='suspended'&&!derivedStanding(snapshot,item).effective);
 const positions=snapshot.learningPositions.filter(item=>item.derivedStatus!=='suspended'&&(!derivedStanding(snapshot,item).effective||!knowledgeCurrent(item)));
 const proposals=(snapshot.learningProposals??[]).filter(item=>item.status!=='stale'&&item.status!=='dismissed'&&(!derivedStanding(snapshot,item).effective||!knowledgeCurrent(item)));
 if(!observations.length&&!drafts.length&&!positions.length&&!proposals.length)return;
 store.transaction(()=>{
  for(const item of observations)store.put('teachingObservations',{...item,status:'suspended',progressionEligible:false});
  for(const item of drafts)store.put('understandingDrafts',{...item,derivedStatus:'suspended'});
  for(const item of positions){store.put('learningPositions',{...item,derivedStatus:'suspended',reason:'原建议依据已暂停或失效，请重新选择下一步。',nextRequirement:'保留当前材料和原稿，重新确认下一步。'});if(item.sessionId){const session=store.get('sessions',item.sessionId);if(session)store.put('sessions',{...session,nextStep:'原建议依据已暂停或失效，请重新选择下一步。'});}}
  for(const item of proposals)store.put('learningProposals',{...item,status:'stale',updatedAt:new Date().toISOString()});
 });
}
