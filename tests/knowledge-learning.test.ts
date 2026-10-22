import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';
import {KnowledgeService} from '../src/main/knowledge-service';
import {buildKnowledgeView} from '../src/shared/knowledge-graph';
import {reviewedTeaching} from './helpers/review-response';
import {reconcileDerivedState} from '../src/main/operations';
import {readBackup,writeBackup} from '../src/main/backup';

const roots:string[]=[],stores:LearningStore[]=[];
afterEach(()=>{vi.restoreAllMocks();stores.splice(0).forEach(s=>s.close());roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
const confirmation={projectId:'new',targetCapabilityId:'new-cap',sourceCapabilityId:'old-cap',kind:'equivalent' as const,reason:'两处均要求解释比较的依据'};
const task={title:'短验证',instruction:'比较三种方案的适用条件，说明哪项信息仍然缺失。',kind:'selection' as const,rubric:['说明比较依据'],sourceIds:[],assessmentBasis:'ai' as const,demand:{kind:'compare',complexity:1,novelty:2,scaffolding:'independent',concepts:['比较']},workSize:'short'};
function response(input:any){
 if(input.operation==='review_teaching')return reviewedTeaching(input);
 if(input.operation==='analyze_learner_proposal')return {analysis:'先独立检验当前情境，再决定是否补讲。',targetUnitId:input.unit.id,intent:'challenge'};
 const independent=input.intent==='independent'||input.mode==='diagnosis';
 return {steps:[...(!independent?[{action:'explain',title:'先看对象',content:'比较需要明确同一依据。',sourceIds:[]}]:[]),{action:independent?'check':'attempt',title:'比较条件',content:task.instruction,sourceIds:[],activity:task}]};
}
async function fixture(reply?:(input:any,store:LearningStore)=>unknown|Promise<unknown>){
 const root=mkdtempSync(join(tmpdir(),'reclimb-knowledge-learning-'));roots.push(root);const store=await LearningStore.open(root);stores.push(store);const now='2026-09-01T00:00:00.000Z';
 store.updateSettings({monthlyBudgetCny:100});
 for(const id of ['old','new']){store.put('projects',{id,title:id,goal:'解释比较依据',status:'active',createdAt:now,updatedAt:now});store.put('capabilities',{id:id+'-cap',projectId:id,title:'比较条件',description:'解释比较依据',prerequisites:[],sourceIds:[],order:0});}
 const oldActivity={...task,id:'old-task',instruction:'比较 3 和 5，说明依据。',workSize:'short' as const,demand:undefined};
 store.put('sessions',{id:'old-session',projectId:'old',capabilityId:'old-cap',activity:oldActivity,mode:'practice',status:'completed',createdAt:now,updatedAt:now,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'',nextStep:''});
 store.put('attempts',{id:'old-attempt',taskId:'old-task',projectId:'old',sessionId:'old-session',text:'3小于5',activitySnapshot:oldActivity,submittedAt:now,helpLevel:0,requestId:'old-request'});
 store.put('evidence',{id:'old-evidence',taskId:'old-task',projectId:'old',capabilityId:'old-cap',sessionId:'old-session',attemptId:'old-attempt',activitySnapshot:oldActivity,status:'independent',helpLevel:0,assessment:{outcome:'met',feedback:'说明了比较依据。',criteria:[{criterion:'说明比较依据',result:'met',reason:'有明确依据'}],limitations:[],sourceIds:[]},createdAt:now});
 const calls:any[]=[];const service=new LearningService(store,()=> 'test',()=>({complete:async(request:any)=>{const input=JSON.parse(request.user);calls.push(input);return {text:JSON.stringify(reply?await reply(input,store):response(input)),inputTokens:1,outputTokens:1,usageKnown:true};}}));
 return {store,service,calls,knowledge:new KnowledgeService(store)};
}
it('uses explicitly linked history for a fresh single check, retaining provenance without copying mastery',async()=>{
 const t=await fixture();t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap');
 expect(t.calls[0].priorLearning.entries).toMatchObject([{evidenceId:'old-evidence',helpLevel:0,sourceProjectId:'old'}]);
 expect(t.calls[0].priorLearning.instruction).toMatch(/验证|检验/);
 expect(t.calls[0].evidence).toEqual([]);expect(session.teaching?.guidance).toBe('independent');expect(session.teaching?.current.action).toBe('check');expect(session.teaching?.upcoming).toEqual([]);
 expect(t.store.get('learningPositions',t.store.get('projects','new')!.learningPositionId!)?.sessionId).toBe(session.id);
 expect(t.store.list('evidence','new')).toEqual([]);expect(t.store.list('knowledgeUses','new')).toMatchObject([{teachingVersionId:session.teachingVersionId,entries:[{evidenceId:'old-evidence'}]}]);
 expect(t.calls.find(c=>c.operation==='review_teaching').priorLearningTasks[0].instruction).toContain('3 和 5');
});
it('does not call the model when no usable confirmed history exists',async()=>{const t=await fixture();await expect(t.service.startKnowledgeCheck('new','new-cap')).rejects.toThrow(/关联|记录|依据/);expect(t.calls).toEqual([]);expect(t.store.list('sessions','new')).toEqual([]);});
it.each(['generation','review'])('does not publish after a relation is withdrawn during %s',async(stage)=>{
 let release!:(input:any)=>void,started!:()=>void;const began=new Promise<void>(resolve=>started=resolve);
 const t=await fixture(input=>((stage==='review')===(input.operation==='review_teaching'))?(started(),new Promise(resolve=>release=()=>resolve(response(input)))):response(input));
 const relation=t.knowledge.confirm(confirmation),position=t.store.list('learningPositions','new'),running=t.service.startKnowledgeCheck('new','new-cap');await began;t.knowledge.retract({relationId:relation.id,reason:'范围不相同'});release(undefined);
 await expect(running).rejects.toThrow(/变化|过时|失效|依据/);expect(t.store.list('sessions','new')).toEqual([]);expect(t.store.list('knowledgeUses','new')).toEqual([]);expect(t.store.list('learningPositions','new')).toEqual(position);expect(t.store.list('usage').find(u=>u.kind==='生成学习活动')?.publicationStatus).toBe('discarded');expect(t.store.list('usage').find(u=>u.kind==='生成学习活动')?.status).toBe('completed');
});
it('records history used by normal teaching and identifies affected versions after withdrawal',async()=>{
 const t=await fixture(),relation=t.knowledge.confirm(confirmation),session=await t.service.start('new','new-cap');
 expect(t.calls[0].priorLearning.entries).toHaveLength(1);expect(t.store.list('knowledgeUses')).toHaveLength(1);t.knowledge.retract({relationId:relation.id,reason:'重新判断范围'});
 const impact=buildKnowledgeView(t.store.snapshot(),'new','new-cap').impacts.find(item=>item.use.teachingVersionId===session.teachingVersionId);expect(impact?.effective).toBe(false);expect(t.store.get('sessions',session.id)).toBeDefined();expect(t.store.get('evidence','old-evidence')).toBeDefined();
});
it('rejects a next-step proposal whose cross-project basis changed before adoption',async()=>{
 const t=await fixture(),relation=t.knowledge.confirm(confirmation),unit=t.store.list('learningUnits','new')[0];const proposal=t.service.proposeNext('new',{requestId:'next',unitId:unit.id,text:'是否可以直接挑战？'});await t.service.analyzeProposal(proposal.id);
 expect(t.calls[0].priorLearning.entries).toHaveLength(1);t.knowledge.retract({relationId:relation.id,reason:'应当重新分析'});expect(()=>t.service.adoptProposal(proposal.id)).toThrow(/变化|依据/);expect(t.store.get('learningProposals',proposal.id)?.status).toBe('stale');
});
it('rolls back provenance together with a failed session publication',async()=>{
 const t=await fixture();t.knowledge.confirm(confirmation);const put=t.store.put.bind(t.store);vi.spyOn(t.store,'put').mockImplementation(((collection:any,entity:any)=>{if(collection==='sessions'&&entity.projectId==='new')throw new Error('保存故障');return put(collection,entity);}) as any);
 await expect(t.service.startKnowledgeCheck('new','new-cap')).rejects.toThrow('保存故障');expect(t.store.list('usage').find(u=>u.kind==='生成学习活动')?.publicationStatus).toBe('discarded');expect(t.store.list('knowledgeUses','new')).toEqual([]);expect(t.store.list('sessions','new')).toEqual([]);
});
it('suspends an adopted suggestion after its old basis is withdrawn, including after a backup roundtrip',async()=>{
 const t=await fixture(),relation=t.knowledge.confirm(confirmation),unit=t.store.list('learningUnits','new')[0];const proposal=t.service.proposeNext('new',{requestId:'adopted',unitId:unit.id,text:'根据旧经验安排挑战'});await t.service.analyzeProposal(proposal.id);t.service.adoptProposal(proposal.id);
 const file=join(t.store.dataDirectory,'adopted.reclimb');writeBackup(t.store,file);const restored=readBackup(file);expect(restored.records.learningProposals?.[0]).toHaveProperty('knowledgeBasis');expect(restored.records.learningPositions?.find(p=>p.projectId==='new')).toHaveProperty('knowledgeBasis');
 t.knowledge.retract({relationId:relation.id,reason:'旧范围不适用'});reconcileDerivedState(t.store);
 expect(t.store.get('learningProposals',proposal.id)?.status).toBe('stale');expect(t.store.list('learningPositions','new')[0].derivedStatus).toBe('suspended');expect(t.store.get('evidence','old-evidence')).toBeDefined();
});
it('rejects copying an old completed task as the new independent verification',async()=>{
 const t=await fixture(input=>input.operation==='review_teaching'?response(input):{steps:[{action:'check',title:task.title,content:'独立检验',sourceIds:[],activity:{...task,instruction:'比较 3 和 5，说明依据。'}}]});t.knowledge.confirm(confirmation);
 await expect(t.service.startKnowledgeCheck('new','new-cap')).rejects.toThrow(/旧|相同|重复/);expect(t.store.list('sessions','new')).toEqual([]);
});
it('rolls back a correction publication together with its graph use when saving fails',async()=>{
 const t=await fixture(input=>input.operation==='review_teaching'?{...response(input),...(input.dispute?{status:'needs_correction'}:{})}:input.revision?{steps:[{action:'check',title:task.title,content:'新条件',sourceIds:[],activity:{...task,instruction:'比较 7/10 与 4/9 并说明二者总量不同时为什么不能直接比较实际数量。'}}]}:response(input));
 t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap'),dispute=await t.service.dispute(session.id,'需要补充总量条件');const put=t.store.put.bind(t.store);
 vi.spyOn(t.store,'put').mockImplementation(((collection:any,entity:any)=>{if(collection==='corrections'&&entity.action==='replace')throw new Error('纠错发布失败');return put(collection,entity);}) as any);
 const result=await t.service.reviewDispute(dispute.id,{allowSendingPrivateContext:true});expect(result.status).toBe('unresolved');expect(t.store.list('knowledgeUses','new')).toHaveLength(1);expect(t.store.get('sessions',session.id)?.teachingVersionId).toBe(session.teachingVersionId);expect(t.store.list('usage').filter(u=>u.kind==='生成学习活动').at(-1)?.publicationStatus).toBe('discarded');
});
