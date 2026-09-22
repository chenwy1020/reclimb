import {CallRunner} from '../src/main/call-runner';
import {writeBackup,readBackup} from '../src/main/backup';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LearningStore} from '../src/main/store';
import {ValidationService} from '../src/main/validation-service';
import {publicSnapshot} from '../src/main/public-snapshot';

const stores:LearningStore[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const store of stores.splice(0))store.close();});
async function fixture(){
 const store=await LearningStore.open(mkdtempSync(join(tmpdir(),'reclimb-validation-')));stores.push(store);
 const now=new Date().toISOString();store.put('projects',{id:'p',title:'自编验证',goal:'说明理由',status:'active',createdAt:now,updatedAt:now});
 const service=new ValidationService(store),set=service.createSet({projectId:'p',title:'独立任务',description:'自编夹具'});
 const task={title:'固定题',prompt:'比较三个数并给出理由。',referenceAnswer:'保密参考：先统一分母。',rubric:['说明依据'],source:{kind:'external',citation:'自编测试夹具，不是真实外部来源'},review:{status:'reviewed',reviewer:'录入核对者',basis:'对照原题和参考解逐条检查'},comparableGroup:'same-conditions',conditions:'无提示，五分钟',transferRationale:''};
 return {store,service,set,task};
}

function submitBaseline(t:Awaited<ReturnType<typeof fixture>>,run:{id:string;sessionId:string}){const session=t.store.get('sessions',run.sessionId)!;t.store.put('attempts',{id:'baseline-'+run.id,projectId:'p',sessionId:run.sessionId,text:'已提交的基准',submittedAt:new Date().toISOString(),helpLevel:session.helpLevel,requestId:'baseline-'+run.id,activitySnapshot:session.activity,teachingVersionId:session.teachingVersionId});t.service.completeRuns(run.sessionId);}
it('starts a fixed check directly without generating teaching and deduplicates double clicks',async()=>{
 const t=await fixture(),[task]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});
 const run=t.service.start({taskId:task.id,requestId:'start',phase:'before'}),again=t.service.start({taskId:task.id,requestId:'start',phase:'before'});
 expect(again.id).toBe(run.id);expect(t.store.list('sessions')).toHaveLength(1);expect(t.store.list('usage')).toEqual([]);
 const session=t.store.get('sessions',run.sessionId)!;expect(session.teaching?.current.action).toBe('check');expect(session.teaching?.current.content).toBe(t.task.prompt);expect(session.teaching?.history).toEqual([]);expect(session.messages).toEqual([]);
 expect(()=>t.service.start({taskId:task.id,requestId:'start',phase:'after'})).toThrow();
});
it('withholds validation prompts and answers from ordinary snapshots while retaining metadata',async()=>{
 const t=await fixture();t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});
 const exposed=JSON.stringify(publicSnapshot(t.store.snapshot()));expect(exposed).not.toContain('先统一分母');expect(exposed).not.toContain(t.task.prompt);expect(exposed).toContain('独立任务');
});
it('logs answer access before the first run and repeated tasks constrain independence',async()=>{
 const t=await fixture(),[task]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});
 expect(t.service.readTask(task.id).referenceAnswer).toContain('先统一分母');
 const run=t.service.start({taskId:task.id,requestId:'first',phase:'before'});
 expect(t.store.get('sessions',run.sessionId)?.helpLevel).toBe(4);
 expect(t.service.results(t.set.id)[0].independence).toBe('exposed');
 submitBaseline(t,run);t.service.start({taskId:task.id,requestId:'second',phase:'after',baselineRunId:run.id});
 expect(t.store.list('validationExposures').some(e=>e.kind==='repeat')).toBe(true);
});
it('rejects malformed task imports atomically and requires named human review basis',async()=>{
 const t=await fixture();expect(()=>t.service.importTasks({setId:t.set.id,tasks:[t.task,{...t.task,title:''}],knownExposure:false})).toThrow();expect(t.store.list('validationTasks')).toEqual([]);
 expect(()=>t.service.importTasks({setId:t.set.id,tasks:[{...t.task,review:{status:'reviewed',reviewer:'',basis:''}}]})).toThrow();
});
it('edits create a new task version and suspend pending judgments about the old rubric',async()=>{
 const t=await fixture(),[task]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});
 const run=t.service.start({taskId:task.id,requestId:'r',phase:'before'}),session=t.store.get('sessions',run.sessionId)!;
 const next=t.service.editTask(task.id,{...t.task,rubric:['说明依据并核对条件']});
 expect(next.id).not.toBe(task.id);expect(next.version).toBe(2);expect(t.store.get('validationTasks',task.id)?.rubric).toEqual(['说明依据']);
 expect(t.store.list('corrections').some(c=>c.teachingVersionId===session.teachingVersionId&&c.action==='invalidate')).toBe(true);
});
it('compares only groups and conditions declared before runs, without a mastery score',async()=>{
 const t=await fixture(),[a,b,c]=t.service.importTasks({setId:t.set.id,tasks:[t.task,{...t.task,title:'同条件变式',prompt:'比较另三个数。'},{...t.task,title:'不同任务',comparableGroup:'other'}],knownExposure:false});
 const first=t.service.start({taskId:a.id,requestId:'a',phase:'before'});submitBaseline(t,first);
 const after=t.service.start({taskId:b.id,requestId:'b',phase:'after',baselineRunId:first.id});expect(t.service.results(t.set.id).find(r=>r.id===after.id)?.comparable).toBe(false);submitBaseline(t,after);
 t.service.start({taskId:c.id,requestId:'c',phase:'after',baselineRunId:first.id});
 const results=t.service.results(t.set.id);expect(results.find(r=>r.taskId===b.id)?.comparable).toBe(true);expect(results.find(r=>r.taskId===c.id)?.comparable).toBe(false);expect(JSON.stringify(results)).not.toContain('masteryScore');
});
it('does not label AI candidates or human review as expert external certification',async()=>{
 const t=await fixture(),[task]=t.service.importTasks({setId:t.set.id,tasks:[{...t.task,source:{kind:'ai',citation:'模型候选'},review:{status:'unreviewed',reviewer:'',basis:''}}],knownExposure:false});
 const run=t.service.start({taskId:task.id,requestId:'r',phase:'before'});expect(t.service.results(t.set.id)[0].basis).toBe('模型判断／未人工核对');
 expect(t.store.list('taskReviews')).toEqual([]);expect(t.store.get('sessions',run.sessionId)?.activity.assessmentBasis).toBe('ai');
});
it('records device and cross-day observations for export without claiming either was performed',async()=>{
 const t=await fixture();t.service.recordTrial({projectId:'p',kind:'device',status:'unverified',participant:'',environment:'iPad 待实际使用',protocol:'Goodnotes两页截图',observations:'未执行',runIds:[]});
 const report=t.service.exportReport('p');expect(report).toContain('未验证');expect(report).toContain('Goodnotes两页截图');expect(report).toContain('不构成学习有效性证明');
});

it('answer access after submission does not rewrite the conditions of the frozen attempt',async()=>{
 const t=await fixture(),[task]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});const run=t.service.start({taskId:task.id,requestId:'submit-before-answer',phase:'before'}),session=t.store.get('sessions',run.sessionId)!;
 t.store.put('attempts',{id:'immutable',projectId:'p',sessionId:session.id,text:'自己的回答',submittedAt:new Date().toISOString(),helpLevel:0,requestId:'immutable',activitySnapshot:session.activity,teachingVersionId:session.teachingVersionId});
 t.service.readAnswer(run.id);expect(t.service.results(t.set.id)[0].independence).toBe('no_recorded_help');expect(t.store.get('sessions',session.id)?.helpLevel).toBe(4);
});
it('opening the task editor during a run marks that active attempt as exposed',async()=>{
 const t=await fixture(),[task]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});const run=t.service.start({taskId:task.id,requestId:'editor-exposure',phase:'before'});t.service.readTask(task.id);expect(t.store.get('sessions',run.sessionId)?.helpLevel).toBe(4);
});

it('rejects reversed, same-stage and unsubmitted baseline links',async()=>{
 const t=await fixture(),[a,b]=t.service.importTasks({setId:t.set.id,tasks:[t.task,{...t.task,title:'后测题',prompt:'另一个问题'}],knownExposure:false});const before=t.service.start({taskId:a.id,requestId:'before',phase:'before'});
 expect(()=>t.service.start({taskId:b.id,requestId:'unsubmitted',phase:'after',baselineRunId:before.id})).toThrow('提交');submitBaseline(t,before);
 const after=t.service.start({taskId:b.id,requestId:'after',phase:'after',baselineRunId:before.id});submitBaseline(t,after);
 expect(()=>t.service.start({taskId:a.id,requestId:'reverse',phase:'before',baselineRunId:after.id})).toThrow('阶段');
 expect(()=>t.service.start({taskId:a.id,requestId:'same-stage',phase:'after',baselineRunId:after.id})).toThrow('阶段');
});
it('validates transfer source identity and enters transfer mode with an eligible existing review',async()=>{
 const t=await fixture(),[source]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});
 expect(()=>t.service.importTasks({setId:t.set.id,tasks:[{...t.task,transferFromTaskId:'missing'}]})).toThrow();
 const baseline=t.service.start({taskId:source.id,requestId:'base',phase:'before'});submitBaseline(t,baseline);const origin=t.store.get('sessions',baseline.sessionId)!;
 t.store.put('reviews',{id:'transfer-review',projectId:'p',capabilityId:origin.capabilityId,fromSessionId:origin.id,kind:'transfer',dueAt:new Date(0).toISOString(),status:'pending',fromTaskId:origin.activity.id,fromActivity:origin.activity});
 const [target]=t.service.importTasks({setId:t.set.id,knownExposure:false,tasks:[{...t.task,title:'不同情境',prompt:'设计一组分数，使其排序需要运用相同的序关系。',transferFromTaskId:source.id,transferRationale:'把比较改为构造',transferCheck:{changedSituation:'从比较到构造',sharedPrinciple:'有理数序关系',requiredAdaptation:'自行选择满足约束的值',verdict:'valid',reason:'录入者明确核对了结构变化'}}]});
 const run=t.service.start({taskId:target.id,requestId:'transfer',phase:'after',baselineRunId:baseline.id}),session=t.store.get('sessions',run.sessionId)!;
 expect(run.kind).toBe('transfer');expect(session.mode).toBe('transfer');expect(session.dueReviewId).toBe('transfer-review');expect(session.activity.transferCheck?.verdict).toBe('valid');
 t.store.put('corrections',{id:'invalidate-origin',projectId:'p',teachingVersionId:origin.teachingVersionId!,action:'invalidate',reason:'基准失效',createdAt:new Date().toISOString()});
 const again=t.service.start({taskId:target.id,requestId:'transfer-invalid-base',phase:'after',baselineRunId:baseline.id});expect(t.store.get('sessions',again.sessionId)?.dueReviewId).toBeUndefined();
});
it('same question with a new title cannot gain transfer eligibility and missing checks stay uncertain',async()=>{
 const t=await fixture(),[source]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});const baseline=t.service.start({taskId:source.id,requestId:'base',phase:'before'});submitBaseline(t,baseline);
 const [skin]=t.service.importTasks({setId:t.set.id,tasks:[{...t.task,title:'换个名字',transferFromTaskId:source.id,transferRationale:'只是换名'}],knownExposure:false});
 const run=t.service.start({taskId:skin.id,requestId:'skin',phase:'after',baselineRunId:baseline.id});expect(t.store.get('sessions',run.sessionId)?.activity.transferCheck?.verdict).toBe('same_task');
 expect(t.service.results(t.set.id).find(r=>r.id===run.id)?.evidenceStatus).not.toBe('transfer');
});

it('keeps the frozen baseline displayed after another attempt in that session',async()=>{
 const t=await fixture(),[a,b]=t.service.importTasks({setId:t.set.id,tasks:[t.task,{...t.task,title:'后测',prompt:'另一道可比题'}],knownExposure:false});const before=t.service.start({taskId:a.id,requestId:'b',phase:'before'});submitBaseline(t,before);const after=t.service.start({taskId:b.id,requestId:'a',phase:'after',baselineRunId:before.id});submitBaseline(t,after);
 const first=t.store.get('attempts',after.baselineAttemptId!)!;t.store.put('attempts',{...first,id:'later-baseline',text:'后来的答案',submittedAt:new Date(Date.now()+1000).toISOString()});t.service.completeRuns(before.sessionId);
 const result=t.service.results(t.set.id).find(r=>r.id===after.id)!;expect(result.comparisonBaseline?.attemptId).toBe(first.id);expect(t.store.get('validationRuns',before.id)?.attemptId).toBe(first.id);
});
it('does not link a transfer review before its due time',async()=>{
 const t=await fixture(),[a]=t.service.importTasks({setId:t.set.id,tasks:[t.task],knownExposure:false});const before=t.service.start({taskId:a.id,requestId:'b',phase:'before'});submitBaseline(t,before);const origin=t.store.get('sessions',before.sessionId)!;
 t.store.put('reviews',{id:'future-review',projectId:'p',capabilityId:origin.capabilityId,fromSessionId:origin.id,kind:'transfer',dueAt:new Date(Date.now()+7*86400000).toISOString(),status:'pending',fromTaskId:origin.activity.id,fromActivity:origin.activity});
 const [b]=t.service.importTasks({setId:t.set.id,tasks:[{...t.task,title:'迁移题',prompt:'不同情境',transferFromTaskId:a.id}],knownExposure:false});const run=t.service.start({taskId:b.id,requestId:'transfer',phase:'after',baselineRunId:before.id});expect(t.store.get('sessions',run.sessionId)?.dueReviewId).toBeUndefined();
});

it('recognizes an identical reimported prompt as previously used even with a new family and title',async()=>{
 const t=await fixture(),[first,duplicate]=t.service.importTasks({setId:t.set.id,tasks:[t.task,{...t.task,title:'换名再导入'}],knownExposure:false});t.service.start({taskId:first.id,requestId:'original',phase:'before'});const repeated=t.service.start({taskId:duplicate.id,requestId:'duplicate',phase:'before'});expect(t.store.get('sessions',repeated.sessionId)?.helpLevel).toBe(4);
});

it('backs up generated candidates and deduplicates completed requests without a new model charge',async()=>{
 const t=await fixture();t.store.updateSettings({monthlyBudgetCny:100});let calls=0;const runner=new CallRunner(t.store,()=> 'fixture-key',()=>({complete:async()=>{calls++;return {text:JSON.stringify({tasks:[t.task]}),inputTokens:1,outputTokens:1,usageKnown:true}}}));const service=new ValidationService(t.store,runner);
 await service.generateCandidates({setId:t.set.id,requestId:'candidates',topic:'自编分数',count:1});const file=join(t.store.dataDirectory,'candidate.reclimb');writeBackup(t.store,file);expect(readBackup(file).records.operations).toHaveLength(1);const operation=t.store.list('operations')[0];expect(operation.phase).toBe('completed');expect(t.store.list('validationTasks')[0].source.kind).toBe('ai');expect(t.store.list('validationTasks')[0].review.status).toBe('unreviewed');await service.generateCandidates({setId:t.set.id,requestId:'candidates',topic:'自编分数',count:1});expect(calls).toBe(1);
});

it('locally resumes saved candidates after publication fails and never duplicates tasks',async()=>{
 const t=await fixture();t.store.updateSettings({monthlyBudgetCny:100});let calls=0;const runner=new CallRunner(t.store,()=> 'fixture-key',()=>({complete:async()=>{calls++;return {text:JSON.stringify({tasks:[t.task]}),inputTokens:1,outputTokens:1,usageKnown:true}}})),service=new ValidationService(t.store,runner),put=t.store.put.bind(t.store);let fail=true;
 const fault=vi.spyOn(t.store,'put').mockImplementation(((collection:any,entity:any)=>{if(fail&&collection==='operations'&&entity.phase==='completed'){fail=false;throw Error('commit failed')}return put(collection,entity)}) as any);
 await expect(service.generateCandidates({setId:t.set.id,requestId:'recover',topic:'分数',count:1})).rejects.toThrow('commit failed');fault.mockRestore();const operation=t.store.list('operations')[0];expect(operation.phase).toBe('result_saved');expect(operation.failureStage).toBe('local_commit');expect(t.store.list('validationTasks')).toHaveLength(0);
 await service.resumeOperation(operation.id);await service.generateCandidates(operation.binding);expect(calls).toBe(1);expect(t.store.list('validationTasks')).toHaveLength(1);expect(t.store.list('operations')[0].phase).toBe('completed');
});
it('shares an in-flight candidate request but rejects a conflicting duplicate',async()=>{
 const t=await fixture();t.store.updateSettings({monthlyBudgetCny:100});let finish!:(value:any)=>void,calls=0;const runner=new CallRunner(t.store,()=> 'fixture-key',()=>({complete:async()=>{calls++;return new Promise(resolve=>finish=resolve)}})),service=new ValidationService(t.store,runner),request={setId:t.set.id,requestId:'concurrent',topic:'分数',count:1};const a=service.generateCandidates(request),b=service.generateCandidates(request);await expect(service.generateCandidates({...request,topic:'不同要求'})).rejects.toThrow();finish({text:JSON.stringify({tasks:[t.task]}),inputTokens:1,outputTokens:1,usageKnown:true});await Promise.all([a,b]);expect(calls).toBe(1);expect(t.store.list('validationTasks')).toHaveLength(1);
});
