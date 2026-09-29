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
 store.put('attempts',{id:'old-attempt',projectId:'old',sessionId:'old-session',text:'3小于5',activitySnapshot:oldActivity,submittedAt:now,helpLevel:0,requestId:'old-request'});
 store.put('evidence',{id:'old-evidence',projectId:'old',capabilityId:'old-cap',sessionId:'old-session',attemptId:'old-attempt',activitySnapshot:oldActivity,status:'independent',helpLevel:0,assessment:{outcome:'met',feedback:'说明了比较依据。',criteria:[{criterion:'说明比较依据',result:'met',reason:'有明确依据'}],limitations:[],sourceIds:[]},createdAt:now});
 const calls:any[]=[];const service=new LearningService(store,()=> 'test',()=>({complete:async(request:any)=>{const input=JSON.parse(request.user);calls.push(input);return {text:JSON.stringify(reply?await reply(input,store):response(input)),inputTokens:1,outputTokens:1,usageKnown:true};}}));
 return {store,service,calls,knowledge:new KnowledgeService(store)};
}
it.each([false,true])('keeps historical tasks on forced verification, including withdrawn relations=%s',async(withdraw)=>{
 const t=await fixture(input=>input.operation==='review_teaching'&&input.priorLearningTasks?.length?{...response(input),status:'uncertain',summary:'旧题对应仍待核对'}:response(input));
 const relation=t.knowledge.confirm(confirmation),session=await t.service.startKnowledgeCheck('new','new-cap');
 if(withdraw)t.knowledge.retract({relationId:relation.id,reason:'对应范围需要重核'});
 const result=await t.service.verify(session.id,{force:true}),review=t.calls.filter(input=>input.operation==='review_teaching').at(-1);
 expect(review.priorLearningTasks).toMatchObject([{evidenceId:'old-evidence',instruction:'比较 3 和 5，说明依据。'}]);
 expect(result.canAssess).toBe(false);
});
it('restores historical tasks through replacement versions and a malformed lineage cycle',async()=>{
 const t=await fixture();t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap'),original=t.store.get('teachingVersions',session.teachingVersionId!)!;
 const {VerificationService}=await import('../src/main/verification-service'),{CallRunner}=await import('../src/main/call-runner');
 const verifier=new VerificationService(t.store,new CallRunner(t.store,()=> 'test',()=>({complete:async(request:any)=>{const input=JSON.parse(request.user);t.calls.push(input);return {text:JSON.stringify(response(input)),inputTokens:1,outputTokens:1,usageKnown:true};}})));
 const replacement=verifier.createVersion({projectId:'new',capabilityId:'new-cap',activity:original.activity,steps:original.steps,sources:original.sources,origin:'correction',replacesVersionId:original.id});
 await verifier.review(replacement,{force:true});
 expect(t.calls.at(-1).priorLearningTasks).toMatchObject([{evidenceId:'old-evidence',instruction:'比较 3 和 5，说明依据。'}]);
 // The input lineage may be malformed after importing old files; lookup must still terminate.
 await verifier.review({...replacement,replacesVersionId:replacement.id},{force:true});
});
it('uses the frozen attempt when evidence has no task snapshot, never a later session activity',async()=>{
 const t=await fixture();t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap');
 t.store.put('evidence',{...t.store.get('evidence','old-evidence')!,activitySnapshot:undefined});
 const source=t.store.get('sessions','old-session')!;t.store.put('sessions',{...source,activity:{...source.activity,instruction:'这是会话后来换到的另一道题'}});
 await t.service.verify(session.id,{force:true});
 expect(t.calls.at(-1).priorLearningTasks).toMatchObject([{evidenceId:'old-evidence',instruction:'比较 3 和 5，说明依据。'}]);
 expect(JSON.stringify(t.calls.at(-1).priorLearningTasks)).not.toContain('另一道题');
});
it('invalidates review cache and blocks a ready claim when the frozen old task is missing',async()=>{
 const t=await fixture();t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap');
 t.store.put('evidence',{...t.store.get('evidence','old-evidence')!,activitySnapshot:undefined});
 t.store.put('attempts',{...t.store.get('attempts','old-attempt')!,activitySnapshot:undefined});
 const source=t.store.get('sessions','old-session')!;t.store.put('sessions',{...source,activity:{...source.activity,instruction:'已经换题，不能当作旧题'}});
 const before=t.calls.length,result=await t.service.verify(session.id);
 expect(t.calls.length).toBe(before+1);expect(t.calls.at(-1).priorLearningTasks).toMatchObject([{evidenceId:'old-evidence',instruction:''}]);
 expect(result.canAssess).toBe(false);expect(result.status).toBe('uncertain');
});
it('preserves unavailable task markers after the original project has been purged',async()=>{
 const t=await fixture();t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap');
 t.store.remove('evidence','old-evidence');t.store.remove('attempts','old-attempt');t.store.remove('sessions','old-session');
 const result=await t.service.verify(session.id,{force:true});
 expect(t.calls.at(-1).priorLearningTasks).toMatchObject([{evidenceId:'old-evidence',instruction:''}]);expect(result.canAssess).toBe(false);
});
it('reuses unchanged review context after publication and never sends old private answers',async()=>{
 const t=await fixture(),evidence=t.store.get('evidence','old-evidence')!;
 t.store.put('evidence',{...evidence,activitySnapshot:{...evidence.activitySnapshot!,referenceAnswer:'PRIVATE_OLD_SOLUTION'}});
 t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap'),before=t.calls.length;
 const result=await t.service.verify(session.id);
 expect(t.calls.length).toBe(before);expect(result.canAssess).toBe(true);
 expect(JSON.stringify(t.calls.filter(input=>input.operation==='review_teaching').map(input=>input.priorLearningTasks))).not.toContain('PRIVATE_OLD_SOLUTION');
});
it('does not claim novelty from a truncated historical task',async()=>{
 const t=await fixture();t.knowledge.confirm(confirmation);const session=await t.service.startKnowledgeCheck('new','new-cap'),evidence=t.store.get('evidence','old-evidence')!;
 t.store.put('evidence',{...evidence,activitySnapshot:{...evidence.activitySnapshot!,instruction:'旧条件'.repeat(2500)}});
 const result=await t.service.verify(session.id,{force:true});
 expect(t.calls.at(-1).priorLearningTasks[0].instruction).toHaveLength(6000);expect(result.canAssess).toBe(false);
});
