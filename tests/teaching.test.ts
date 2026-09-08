import {reviewedTeaching,withCriterionIds} from './helpers/review-response';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningStore } from '../src/main/store';
import {writeBackup,readBackup} from '../src/main/backup';
import {teachingContentHash} from '../src/main/verification-service';
import { LearningService } from '../src/main/learning-service';
import type { Activity } from '../src/shared/types';
const stores: LearningStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const task = (instruction = '两条连接相同端点的路径最高能量分别为3和5。哪条提供更小的上界？说明比较的是路径上的哪个量。'): Activity => ({ title: '比较路径的最高能量', instruction, kind: 'selection', rubric: ['识别每条路径的最高能量', '比较这两个最高值'], sourceIds: ['f'], referenceAnswer: '比较的是各路径最高能量，选择最高能量为3的路径。', assessmentBasis: 'source' });
const plan = (instruction?: string) => ({ steps: [
  { action: 'explain', title: '从泛函到一个实数', content: '泛函把一个函数或状态对应到一个实数。沿一条路径会经过不同状态，因此也会得到一串能量值。', sourceIds: ['f'] },
  { action: 'demonstrate', title: '先看不同例子', content: '若两条路径的最高能量分别为2和4，选择最高值较小的路径，其上界是2。这里先在路径上取最高，再比较路径。', sourceIds: ['f'] },
  { action: 'attempt', title: '亲自比较一小步', content: '现在换一组数，由你选择。', sourceIds: ['f'], activity: task(instruction) },
] });
async function setup(respond: (input: any) => unknown | Promise<unknown>,reviewer:(input:any)=>unknown=reviewedTeaching) {
  const store = await LearningStore.open(mkdtempSync(join(tmpdir(), 'reclimb-teaching-'))); stores.push(store); const now = new Date().toISOString();
  store.transaction(() => {
    store.updateSettings({ monthlyBudgetCny: 100 });
    store.put('projects', { id: 'p', title: 'Rabinowitz临界点理论', goal: '理解山路定理及其在PDE中的用途', status: 'active', createdAt: now, updatedAt: now });
    store.put('materials', { id: 'm', projectId: 'p', title: '临界点理论', kind: 'md', originalName: 'notes.md', storedPath: '', importedAt: now, warnings: [], fragmentCount: 1, summary: '泛函、路径最高能量与临界点' });
    store.put('fragments', { id: 'f', projectId: 'p', materialId: 'm', locator: '第1节', ordinal: 0, text: '泛函定义在函数空间上并取实值。沿路径考察泛函值，比较不同路径的最高能量，用以刻画minimax水平。' });
    store.put('capabilities', { id: 'c', projectId: 'p', title: '理解路径最高能量', description: '区分路径上的最大值与路径族中的选择', prerequisites: [], sourceIds: ['f'], order: 0 });
  });
  const inputs: any[] = []; const requests: any[] = []; const provider = { complete: async (request: { user: string }) => { const input = JSON.parse(request.user); inputs.push(input); requests.push(request); return { text: JSON.stringify(input.operation==='review_teaching'?await reviewer(input):withCriterionIds(await respond(input),input)), inputTokens: 10, outputTokens: 10, usageKnown: true }; } };
  const service = new LearningService(store, () => 'local-test-key', () => provider); return { store, service, inputs, requests };
}
const assessment = (input: any) => ({ outcome: 'met', feedback: '你正确比较了两个最高值。', criteria: input.activity.rubric.map((criterion: string) => ({ criterion, result: 'met', reason: '有明确比较' })), limitations: [], sourceIds: ['f'] });

describe('continuous teaching', () => {
  it('saves an explicit starting point without changing the long-term goal or inventing evidence', async () => {
    const t = await setup(() => { throw new Error('must not call'); }); const goal = t.store.get('projects', 'p')!.goal;
    t.service.saveStartingPoint('p', { familiarity: 'new', background: '没学过泛函分析' });
    expect(t.store.get('projects', 'p')?.startingPoint?.familiarity).toBe('new'); expect(t.store.get('projects', 'p')?.goal).toBe(goal); expect(t.store.list('evidence')).toEqual([]);
  });
  it('starts by teaching, advances without compulsory answers, and persists its step across reopening', async () => {
    const t = await setup(() => plan()); t.service.saveStartingPoint('p', { familiarity: 'new', background: '' });
    const s = await t.service.start('p', 'c'); expect(s.teaching?.current.action).toBe('explain');
    await t.service.nextStep(s.id, 'continue'); expect(t.store.get('sessions', s.id)?.teaching?.current.action).toBe('demonstrate');
    await t.service.nextStep(s.id, 'continue'); const active = t.store.get('sessions', s.id)!; expect(active.teaching?.current.action).toBe('attempt'); expect(active.helpLevel).toBe(0); expect(t.inputs.filter(input=>input.operation!=='review_teaching')).toHaveLength(1); expect(t.store.list('evidence')).toEqual([]);
    const reopened = await LearningStore.open(t.store.dataDirectory); stores.push(reopened); expect(reopened.get('sessions', s.id)?.teaching).toEqual(active.teaching);
  });
  it('turns a confused click into a smaller teaching action and can return to the same task draft', async () => {
    const t = await setup(input => input.intent === 'smaller' ? { steps: [{ action: 'explain', title: '先只看一个点', content: '暂时不比较路径。先把一个状态对应到一个能量数值；这就是这一小步。', sourceIds: ['f'] }, { action: 'attempt', title: '一个状态的值', content: '只辨认输入和输出。', sourceIds: ['f'], activity: { ...task('给一个函数一个实数值，这里输入是什么？'), rubric: ['识别输入是函数或状态'] } }] } : plan());
    const s = await t.service.start('p', 'c'); await t.service.nextStep(s.id, 'continue'); await t.service.nextStep(s.id, 'continue'); const original = t.store.get('sessions', s.id)!;
    t.service.saveDraft(s.id, '我的原始草稿', original.activity.id); await t.service.help(s.id, 'confused', '', 'term');
    expect(t.store.get('sessions', s.id)?.teaching?.current.content).toContain('先把一个状态'); expect(t.store.get('sessions', s.id)?.teaching?.lastConfusion).toBe('term');
    await t.service.nextStep(s.id, 'return'); expect(t.store.get('sessions', s.id)?.activity.id).toBe(original.activity.id); expect(t.store.get('sessions', s.id)?.draft).toBe('我的原始草稿');
  });
  it('scopes help to a task, freezes old evidence, and permits later independent reconstruction', async () => {
    const t = await setup(input => 'answer' in input ? assessment(input) : input.intent === 'independent' ? { steps: [{ action: 'check', title: '独立换例', content: '这一题请自己判断。', sourceIds: ['f'], activity: task('两条路径最高能量分别为7和9，比较其上界并说明。') }] } : input.kind === 'hint' ? { text: '先找每条路径上的最高能量。', sourceIds: ['f'], scope: 'current_task' } : plan());
    const s = await t.service.start('p', 'c'); await t.service.nextStep(s.id, 'continue'); await t.service.nextStep(s.id, 'continue'); const oldTask = t.store.get('sessions', s.id)!.activity;
    await t.service.help(s.id, 'hint'); await t.service.submit(s.id, '选择3', 'first-submission'); expect(t.store.list('evidence')[0].status).toBe('assisted');
    await t.service.nextStep(s.id, 'independent'); const next = t.store.get('sessions', s.id)!; expect(next.helpLevel).toBe(0); expect(next.activity.id).not.toBe(oldTask.id);
    t.service.saveDraft(s.id, '迟来的旧题保存', oldTask.id); expect(t.store.get('sessions', s.id)?.draft).toBe('');
    await t.service.submit(s.id, '选择7，比较的是最高能量', 'second-submission'); const records = t.store.list('evidence'); expect(records[1].status).toBe('independent'); expect(records[0].activitySnapshot?.instruction).toBe(oldTask.instruction); expect(records[0].taskId).toBe(oldTask.id);
  });
  it('does not turn a different example or a conceptual explanation into current-task assistance', async () => {
    const t = await setup(input => input.kind === 'example' ? { text: '另一个例子：最高能量为11和13时，先比较这两个数。', sourceIds: ['f'], scope: 'other_example' } : plan());
    const s = await t.service.start('p', 'c'); await t.service.nextStep(s.id, 'continue'); await t.service.nextStep(s.id, 'continue'); await t.service.help(s.id, 'example');
    expect(t.store.get('sessions', s.id)?.helpLevel).toBe(0); expect(t.store.get('sessions', s.id)?.helpEvents.at(-1)?.scope).toBe('other_example');
  });
  it('keeps the goal unchanged until and after confirming a smaller scope', async () => {
    const t = await setup(() => ({ summary: '长期仍指向山路定理，先建立路径能量直观。', capabilities: [{ title: '路径最高能量', description: '比较路径上的最大值', prerequisites: [], sourceIds: ['f'] },...['比较候选','说明上界'].map(title=>({title,description:'一个明确的比较动作',prerequisites:[],sourceIds:['f']}))], nearSteps: [{ capabilityTitle: '路径最高能量', title: '泛函是什么', objective: '说出输入和输出', completion:'指出输入为函数、输出为实数即可', prerequisites:[], reason: '先建立对象', sourceIds: ['f'] }, { capabilityTitle: '路径最高能量', title: '一条路径的高点', objective: '指出最高能量', completion:'从一串能量中选择最高值即可', prerequisites:[], reason: '再准备比较路径', sourceIds: ['f'] }], scopeProposal: { suggestedFocus: '先理解有限例子的路径最高能量', reason: '零基础暂不跳到PDE存在性证明' } }));
    const goal = t.store.get('projects', 'p')!.goal; t.service.saveStartingPoint('p', { familiarity: 'new', background: '' }); await t.service.generateRoute('p');
    expect(t.store.get('projects', 'p')?.nearSteps).toHaveLength(2); expect(t.store.get('projects', 'p')?.learningScope?.status).toBe('proposed'); expect(t.store.get('projects', 'p')?.goal).toBe(goal);
    t.service.confirmScope('p'); expect(t.store.get('projects', 'p')?.learningScope?.status).toBe('confirmed'); expect(t.store.get('projects', 'p')?.goal).toBe(goal);
  });
});

describe('teaching continuity and attribution regressions',()=>{
 it('restores the pending demonstration and attempt after exploring from a foundation explanation',async()=>{
  const t=await setup(input=>input.kind==='explore'?{text:'这是关于泛函输入对象的补充背景。',sourceIds:['f'],scope:'concept'}:plan());const s=await t.service.start('p','c');const original=s.teaching!;
  await t.service.help(s.id,'explore','状态指什么？');expect(t.store.get('sessions',s.id)?.teaching?.returnStep?.id).toBe(original.current.id);
  await t.service.nextStep(s.id,'return');expect(t.store.get('sessions',s.id)?.teaching?.upcoming.map(step=>step.id)).toEqual(original.upcoming.map(step=>step.id));await t.service.nextStep(s.id,'continue');expect(t.store.get('sessions',s.id)?.teaching?.current.action).toBe('demonstrate');
 });
 it('preserves the complete teaching step and draft when a smaller explanation cannot be generated',async()=>{
  const t=await setup(input=>{if(input.intent==='smaller')throw new Error('offline');return plan();});const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');t.service.saveDraft(s.id,'先保留这个猜想');const before=t.store.get('sessions',s.id)!;
  await expect(t.service.help(s.id,'confused','','overload')).rejects.toThrow();const after=t.store.get('sessions',s.id)!;expect(after.teaching).toEqual(before.teaching);expect(after.draft).toBe(before.draft);expect(after.helpLevel).toBe(0);
 });
 it('does not trust an other-example label when the response explicitly gives the current short answer',async()=>{
  const t=await setup(input=>'answer' in input?assessment(input):input.kind==='example'?{text:'当前题的正确答案是3。',sourceIds:['f'],scope:'other_example'}:plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');
  await t.service.help(s.id,'example');await t.service.submit(s.id,'3','short-leaked-answer');expect(t.store.list('evidence')[0].status).toBe('assisted');expect(t.store.get('sessions',s.id)?.helpEvents[0].scope).toBe('current_task');
 });
 it('freezes confirmed transcription versions across later corrections and evaluation retries',async()=>{
  let failed=false;const t=await setup(input=>{if('answer' in input){if(!failed){failed=true;throw new Error('offline');}return assessment(input);}return plan();});const f=t.store.get('fragments','f')!;t.store.put('fragments',{...f,pageNumber:1});const version={id:'v1',projectId:'p',materialId:'m',fragmentId:'f',pageNumber:1,version:1,text:'已核对旧公式：泛函值为J(u)。',status:'confirmed' as const,createdAt:'2026-09-01T00:00:00Z',confirmedAt:'2026-09-01T00:00:00Z',uncertainties:[]};t.store.put('sourceTranscriptions',version);
  const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');expect(s.activity.sourceVersions).toEqual([{fragmentId:'f',transcriptionIds:['v1']}]);
  await expect(t.service.submit(s.id,'选择3','version-retry')).rejects.toThrow();t.store.put('sourceTranscriptions',{...version,id:'v2',version:2,text:'新核对内容，不可回改旧任务',createdAt:'2026-09-02T00:00:00Z'});await t.service.submit(s.id,'选择3','version-retry');
  const evaluations=t.inputs.filter(input=>'answer' in input);expect(evaluations).toHaveLength(2);expect(evaluations.every(input=>input.sources[0].text.includes('已核对旧公式')&&!input.sources[0].text.includes('新核对内容'))).toBe(true);expect(t.store.list('evidence')[0].activitySnapshot?.sourceVersions?.[0].transcriptionIds).toEqual(['v1']);
 });
 it('generates full demonstrations only when requested, keeping initial teaching output compact',async()=>{
  const t=await setup(input=>input.kind==='answer'?{text:'完整示范：先找路径的最高能量，再比较。',sourceIds:['f'],scope:'current_task'}:plan());const s=await t.service.start('p','c');expect(s.activity.referenceAnswer).toBeUndefined();await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.help(s.id,'answer');expect(t.inputs.at(-1).kind).toBe('answer');expect(t.store.get('sessions',s.id)?.helpLevel).toBe(4);
 });
});
it('keeps an unsuccessfully evaluated return attributed to its original review after continuing to another task',async()=>{
 let failReturn=true;const t=await setup(input=>{
  if('answer' in input){if(input.activity.instruction.includes('回访')&&failReturn){failReturn=false;throw new Error('offline');}return assessment(input);}
  if(input.mode==='delayed')return {steps:[{action:'check',title:'延迟重构',content:'回访时独立判断',sourceIds:['f'],activity:task('回访：重新解释如何比较路径的最高能量。')}]};
  if(input.intent==='independent')return {steps:[{action:'check',title:'新任务',content:'换个新例子',sourceIds:['f'],activity:task('新的独立任务：路径最高能量是6和8。')}]};return plan();
 });
 const origin=await t.service.start('p','c');await t.service.nextStep(origin.id,'continue');await t.service.nextStep(origin.id,'continue');await t.service.submit(origin.id,'比较最高值','origin-result');
 const old='2026-01-01T00:00:00.000Z';const oldSession=t.store.get('sessions',origin.id)!;t.store.put('sessions',{...oldSession,createdAt:old,updatedAt:old,messages:oldSession.messages.map(m=>({...m,createdAt:old})),helpEvents:oldSession.helpEvents.map(h=>({...h,createdAt:old})),teaching:{...oldSession.teaching!,current:{...oldSession.teaching!.current,createdAt:old},history:oldSession.teaching!.history.map(step=>({...step,createdAt:old}))}});const oldAttempt=t.store.get('attempts','origin-result')!;t.store.put('attempts',{...oldAttempt,submittedAt:old});const first=t.store.list('evidence')[0];t.store.put('evidence',{...first,createdAt:old});
 const due=t.store.list('reviews').find(r=>r.kind==='delayed')!;t.store.put('reviews',{...due,dueAt:old});const returned=await t.service.start('p','c','delayed',due.id);await expect(t.service.submit(returned.id,'独立解释最高值','return-retry')).rejects.toThrow();
 await t.service.nextStep(returned.id,'independent');expect(t.store.get('sessions',returned.id)?.mode).toBe('practice');await t.service.submit(returned.id,'独立解释最高值','return-retry');const result=t.store.list('evidence').find(e=>e.attemptId==='return-retry')!;expect(result.status).toBe('delayed');expect(result.reviewId).toBe(due.id);expect(t.store.get('sessions',returned.id)?.helpLevel).toBe(0);
});

it('checks semantic transfer rather than publishing a merely reworded task',async()=>{
 const t=await setup(input=>'answer' in input?assessment(input):input.newActivity?{changedSituation:'只替换数字',sharedPrinciple:'比较最大值',requiredAdaptation:'无新增适配',verdict:'same_task',reason:'仍是完全相同的已给出最高值比较'}:input.mode==='transfer'?{steps:[{action:'check',title:'候选迁移',content:'另一个题目',sourceIds:['f'],activity:task('把最高能量改成7与9后比较。')}]}:plan());const origin=await t.service.start('p','c');await t.service.nextStep(origin.id,'continue');await t.service.nextStep(origin.id,'continue');await t.service.submit(origin.id,'选择较小最高值','transfer-origin');const due=t.store.list('reviews').find(r=>r.kind==='transfer')!;t.store.put('reviews',{...due,dueAt:'2026-01-01T00:00:00Z'});const count=t.store.list('sessions').length;
 await expect(t.service.start('p','c','transfer',due.id)).rejects.toThrow('表面变化');expect(t.store.list('sessions')).toHaveLength(count);expect(t.store.get('reviews',due.id)?.status).toBe('pending');expect(t.inputs.some(input=>input.oldActivity&&input.newActivity)).toBe(true);
});

it('uses concrete feedback to replace the next action and retains the previous task history',async()=>{
 const t=await setup(input=>'answer' in input?{...assessment(input),outcome:'partial',feedback:'你比较了终点值，还没有识别路径中间的最高值。',criteria:input.activity.rubric.map((criterion:string)=>({criterion,result:'partial',reason:'未定位中间高点'}))}:input.intent==='continue'&&input.evidence.some((e:any)=>e.status==='needs_review')?{steps:[{action:'explain',title:'先定位中间高点',content:'先画出同一路径上的三个能量值，不比较多条路径。',sourceIds:['f']},{action:'attempt',title:'只找一个最高值',content:'这次先只处理一条路径。',sourceIds:['f'],activity:{...task('沿一条路径能量依次为1、5、2，指出最高值。'),rubric:['从三个值中找出最高能量']}}]}:plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.submit(s.id,'比较终点','partial-step');await t.service.nextStep(s.id,'continue');const current=t.store.get('sessions',s.id)!;
 expect(current.teaching?.current.content).toContain('不比较多条路径');expect(current.activity.rubric).toEqual(['从三个值中找出最高能量']);expect(current.teaching?.history.some(step=>step.action==='feedback')).toBe(true);expect(t.store.list('evidence')[0].activitySnapshot?.rubric).toHaveLength(2);
});
describe('load reduction after real teaching counterexamples',()=>{
 it('repairs overfilled smaller plans and reaches a single judgment on a second confused click',async()=>{
  const smallerPlan=(count:number,rubricCount:number)=>({steps:[{action:'explain',title:'只看眼前一句',content:'一句话可以只是报告观察。这一小步只辨认它是否描述实际见到的事。',sourceIds:['f']},{action:'attempt',title:'一个判断',content:'用一个编号回答即可。',sourceIds:['f'],activity:{...task('缩步'+count+'：句子“记录显示有五次变化”是在报告观察吗？回复是或否。'),rubric:Array.from({length:rubricCount},(_,i)=>i===0?'辨认这句话是否报告观察':'另一个负担'+i)}}]});
  const t=await setup(raw=>{const input=raw.original??raw;if(input.intent!=='smaller')return plan();return smallerPlan(input.confusionCount??1,raw.repair?(input.confusionCount>=2?1:2):3);});const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');
  await t.service.help(s.id,'confused','','term');expect(t.store.get('sessions',s.id)?.activity.rubric).toHaveLength(2);await t.service.help(s.id,'confused','','overload');const active=t.store.get('sessions',s.id)!;expect(active.activity.rubric).toEqual(['辨认这句话是否报告观察']);expect(active.teaching?.confusionCount).toBe(2);expect(active.teaching?.upcoming).toHaveLength(1);await t.service.nextStep(s.id,'continue');expect(t.store.get('sessions',s.id)?.teaching?.current.action).toBe('attempt');expect(t.store.get('sessions',s.id)?.activity.instruction).toContain('回复是或否');expect(t.inputs.filter(input=>input.repair)).toHaveLength(2);
 });
 it('repairs unsupported marking instructions to plain text choices before publishing',async()=>{
  const t=await setup(raw=>{const input=raw.original??raw;if(input.intent!=='smaller')return plan();return {steps:[{action:'explain',title:'一句观察',content:'先区分观察和判断。',sourceIds:['f']},{action:'attempt',title:'选一句',content:'只做一个选择。',sourceIds:['f'],activity:{...task(raw.repair?'回复编号1或2，选出报告观察的一句。':'用横线和波浪线标出主张与证据。'),rubric:['选出报告观察的一句']}}]};});const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.help(s.id,'confused','','step');expect(t.store.get('sessions',s.id)?.activity.instruction).toContain('回复编号');expect(t.inputs.find(input=>input.intent==='smaller')?.learnerInputCapabilities).toEqual(['文本','编号选择','数学式']);
 });
});
it('uses exact source enums for teaching, help and assessment and never accepts a foreign project reference',async()=>{
 const t=await setup(raw=>{const input=raw.original??raw;const ids=raw.repair?['f']:['foreign'];if('answer' in input)return {...assessment(input),sourceIds:ids};if(input.kind==='hint')return {text:'先比较题目给出的最高值。',sourceIds:ids,scope:'current_task'};const response=plan();response.steps=response.steps.map(step=>({...step,sourceIds:ids,...(step.activity?{activity:{...step.activity,sourceIds:ids}}:{})}));return response;});
 t.store.put('fragments',{id:'foreign',projectId:'other',materialId:'other-m',locator:'别的项目',ordinal:0,text:'不可跨项目引用'});const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.help(s.id,'hint');await t.service.submit(s.id,'选择较小的最高值','scoped-repair');expect(t.requests.filter(request=>JSON.parse(request.user).operation!=='review_teaching')).toHaveLength(6);
 const taskRequests=t.requests.filter(request=>JSON.parse(request.user).operation!=='review_teaching');const teaching=taskRequests[0].schema.properties.steps.items.properties;expect(teaching.sourceIds.items.enum).toEqual(['f']);expect(teaching.activity.properties.sourceIds.items.enum).toEqual(['f']);expect(taskRequests[2].schema.properties.sourceIds.items.enum).toEqual(['f']);expect(taskRequests[4].schema.properties.sourceIds.items.enum).toEqual(['f']);expect(t.store.list('evidence')[0].assessment.sourceIds).toEqual(['f']);expect(t.store.list('usage').filter(usage=>usage.publicationStatus==='discarded')).toHaveLength(3);
});
it('repairs an answer leaked by the public rubric before a fresh attempt is shown',async()=>{
 const t=await setup(raw=>{const response=plan(raw.repair?'一条新路径依次经过0、7、2、0，指出最高能量。':'一条路径依次经过0、4、2、0，指出最高能量。');response.steps[2].activity!.rubric=[raw.repair?'从当前路径的全部能量值中找出最高值':'答出4即可继续'];return response;});
 const project=t.store.get('projects','p')!;t.store.put('projects',{...project,nearSteps:[{id:'near',capabilityId:'c',title:'先找一条路径的高点',objective:'先演示0、4、2、0，再尝试新例子。',reason:'先比较一条路径',completion:'答出4即可继续',sourceIds:['f']}]});
 const session=await t.service.start('p','c','practice',undefined,'near');expect(t.requests.filter(request=>JSON.parse(request.user).operation!=='review_teaching')).toHaveLength(2);expect(session.activity.rubric).toEqual(['从当前路径的全部能量值中找出最高值']);expect(session.activity.instruction).toContain('0、7、2、0');expect(t.inputs[0].instruction).toContain('不能复制近期步骤或示范中已经给出答案的题目');expect(t.store.list('evidence')).toEqual([]);
});
it.each(['independent','delayed','transfer'] as const)('repairs teaching before a %s check and constrains the actual generation schema',async(mode)=>{
 const t=await setup(raw=>{const input=raw.original??raw;const independent=input.intent==='independent'||input.mode==='delayed'||input.mode==='transfer';if(!independent||!raw.repair)return plan();return {steps:[{action:'check',title:'独立换例',content:'按题目作一次判断。',sourceIds:['f'],activity:{...task('新路径依次经过0、8、3、0，指出最高能量。'),rubric:['从整条路径中找出最高能量']}}]};});
 let session;if(mode==='independent'){const initial=await t.service.start('p','c');session=await t.service.nextStep(initial.id,'independent');}else session=await t.service.start('p','c',mode);
 const request=t.requests.filter(request=>JSON.parse(request.user).operation!=='review_teaching')[mode==='independent'?1:0];expect(request.schema.properties.steps.minItems).toBe(1);expect(request.schema.properties.steps.maxItems).toBe(1);expect(request.schema.properties.steps.items.properties.action.const).toBe('check');expect(request.schema.properties.steps.items.required).toContain('activity');expect(t.inputs.filter(input=>input.repair)).toHaveLength(1);expect(session.teaching?.current.action).toBe('check');expect(session.teaching?.upcoming).toEqual([]);expect(session.helpLevel).toBe(0);expect(t.store.list('evidence')).toEqual([]);
});
it('allows a topic newcomer with stated prerequisites to start with a short conceptual probe',async()=>{
 const t=await setup(()=>({steps:[{action:'attempt',title:'辨认两层存在性',content:'先用一个判断确认连接点，再按实际表现补充背景。',sourceIds:['f'],activity:{...task('连续性可保证每条路径有最高值。这是否同时保证路径族中的最小值被取到？'),rubric:['区分单条路径与整个路径族的存在性问题']}}]}));
 const background='熟悉赋范空间、连续映射、闭区间极值和实数集合的下确界；没有学习过minimax临界点理论。';t.service.saveStartingPoint('p',{familiarity:'new',background});const goal=t.store.get('projects','p')!.goal;const session=await t.service.start('p','c');
 expect(session.teaching?.current.action).toBe('attempt');expect(session.activity.instruction).toContain('是否同时保证');expect(t.inputs[0].entryContext).toEqual({topicFamiliarity:'new',priorKnowledge:'self_reported'});expect(t.store.get('projects','p')?.startingPoint?.background).toBe(background);expect(t.store.get('projects','p')?.goal).toBe(goal);expect(t.store.list('evidence')).toEqual([]);
});
it('keeps unspecified prerequisites unknown while offering an initial orientation',async()=>{
 const t=await setup(()=>plan());const session=await t.service.start('p','c');expect(t.inputs[0].entryContext).toEqual({topicFamiliarity:'unknown',priorKnowledge:'unknown'});expect(t.inputs[0].startingPoint.background).toBe('');expect(session.teaching?.current.action).toBe('explain');expect(t.store.list('evidence')).toEqual([]);
});
it('repairs a missing task table even when a different demonstration contains numbers',async()=>{
 const complete='下表列出一条离散路径的全部状态及能量。请指出最高能量对应的状态。\n| 状态 | 能量 |\n| --- | --- |\n| 甲 | 6 |\n| 乙 | 9 |\n| 丙 | 4 |';
 const t=await setup(raw=>{const response=plan(raw.repair?complete:'表格中列出某条离散路径的全部状态能量。请指出能量最大的状态。');response.steps[1].content='另一个已解示例：3、8、5、2 的最高值是 8；这个例子不是你的任务。';response.steps[2].content='下面是完整列出的路径，完成这次比较。';response.steps[2].activity!.rubric=['比较全部状态，指出最高能量对应的状态'];return response;});
 const session=await t.service.start('p','c');expect(t.requests.filter(request=>JSON.parse(request.user).operation!=='review_teaching')).toHaveLength(2);expect(session.activity.instruction).toBe(complete);expect(session.activity.instruction).toContain('| 乙 | 9 |');expect(session.activity.instruction).not.toContain('3、8、5、2');expect(t.store.list('usage').filter(usage=>usage.entryType!=='hold'&&usage.kind!=='独立核验教学').map(usage=>usage.publicationStatus)).toEqual(['discarded','published']);expect(t.store.list('evidence')).toEqual([]);
});
it('repairs a missing referenced code sample into an actual executable snippet',async()=>{
 const complete='请判断如下代码的输出：\n```js\nconst x = 2;\nconsole.log(x + 1);\n```';const t=await setup(raw=>{const response=plan(raw.repair?complete:'请判断如下代码的输出。');response.steps[2].activity!.rubric=['根据给出的赋值和运算判断输出'];return response;});const session=await t.service.start('p','c');expect(t.requests.filter(request=>JSON.parse(request.user).operation!=='review_teaching')).toHaveLength(2);expect(session.activity.instruction).toBe(complete);
});
it('allows explicitly learner-constructed input without inventing a supplied table',async()=>{
 const instruction='请自行构造一张包含三个数值的表格，再指出下表中的最大值。这里的下表是你自己构造的表。';const t=await setup(()=>plan(instruction));const session=await t.service.start('p','c');expect(t.requests.filter(request=>JSON.parse(request.user).operation!=='review_teaching')).toHaveLength(1);expect(session.activity.instruction).toBe(instruction);
});


describe('versioned verification and persistent correction',()=>{
 it('keeps reviewed explanations and different demonstrations compatible with a genuinely new independent first answer',async()=>{
  const t=await setup(input=>'answer' in input?assessment(input):plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.submit(s.id,'选择较小的路径最高值','reviewed-demo');expect(t.store.list('answerExposures').filter(e=>e.kind==='demonstration')).toHaveLength(2);expect(t.store.list('attempts')[0].helpLevel).toBe(0);expect(t.store.list('evidence')[0].status).toBe('independent');
 });
 it('revises the complete teaching unit once and independently reviews the replacement',async()=>{
  const t=await setup(input=>plan(input.revision?'修订题：数列2、6、3中最高值是哪一个？':'先检查题设中的条件是否满足。'),input=>input.teaching.origin==='correction'?reviewedTeaching(input):{...reviewedTeaching(input),status:'needs_correction',issues:[{kind:'conditions',message:'条件需明确'}]});const s=await t.service.start('p','c');expect(t.store.list('teachingVersions')).toHaveLength(2);expect(t.store.list('taskReviews')).toHaveLength(2);expect(s.activity.instruction).toContain('修订题');expect(t.service.getVerification(s.id).canAssess).toBe(true);expect(t.store.list('corrections')[0].action).toBe('replace');
 });
 it('saves an attempted answer when verification is uncertain and allows explicit verification to recover',async()=>{
  let ready=false;const t=await setup(input=>'answer' in input?assessment(input):plan(),input=>({...reviewedTeaching(input),status:ready?'ready':'uncertain'}));const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await expect(t.service.submit(s.id,'保留的思路','pending-answer')).rejects.toThrow();expect(t.store.get('attempts','pending-answer')?.text).toBe('保留的思路');expect(t.store.get('sessions',s.id)?.draft).toBe('保留的思路');expect(t.store.list('evidence')).toEqual([]);ready=true;await t.service.verify(s.id);await t.service.submit(s.id,'保留的思路','pending-answer');expect(t.store.list('evidence')).toHaveLength(1);
 });
 it('normalizes criterion text and order by stable IDs instead of rejecting equivalent wording',async()=>{
  const t=await setup(input=>'answer' in input?{...assessment(input),criteria:input.activity.rubric.map((_:string,i:number)=>({criterion:'等价表述'+i,criterionId:input.activity.rubricIds[i],result:'met',reason:'满足'})).reverse()}:plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.submit(s.id,'比较最高值','equivalent-criteria');expect(t.store.list('evidence')[0].assessment.criteria.map(c=>c.criterion)).toEqual(s.activity.rubric);
 });
 it('keeps a semantic challenge open without scoring it or silently sending private history',async()=>{
  const t=await setup(input=>'answer' in input?{dispute:{issue:'第三问的前提不满足',reason:'需要先核对题目'}}:plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.submit(s.id,'题设条件不足','challenge');const d=t.store.list('disputes')[0],count=t.inputs.length;await t.service.reviewDispute(d.id);expect(t.inputs).toHaveLength(count);expect(t.store.list('evidence')).toEqual([]);expect(t.service.getVerification(s.id).canAssess).toBe(false);await t.service.dispute(s.id,'仍是这个问题');expect(t.store.list('disputes')).toHaveLength(1);
 });
 it('reveals complete verification reasoning only as recorded help and preserves a prior independent attempt',async()=>{
  const t=await setup(input=>'answer' in input?assessment(input):plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.submit(s.id,'选择较小最高值','before-solution');const text=await t.service.viewReviewSolution(s.id);expect(text).toContain('条件');expect(text).toContain('核对解答');expect(t.store.get('attempts','before-solution')?.helpLevel).toBe(0);expect(t.store.get('sessions',s.id)?.helpLevel).toBe(4);expect(t.store.list('answerExposures').at(-1)?.text).toBe(text);
 });
});

it('preserves an explicit challenge in an exploration question instead of generating help that defends the task',async()=>{
 const t=await setup(input=>input.kind==='explore'?{dispute:{issue:'题目遗漏了必要条件',reason:'先核验题设'}}:plan());const s=await t.service.start('p','c');await t.service.help(s.id,'explore','这个条件不是题目保证的吗？');expect(t.store.list('disputes')).toHaveLength(1);expect(t.store.get('sessions',s.id)?.helpLevel).toBe(0);expect(t.service.getVerification(s.id).canAssess).toBe(false);
});
it('sends only explicitly previewed same-version assessments for a consented dispute and does not restore invalidated evidence',async()=>{
 const t=await setup(input=>'answer' in input?assessment(input):plan(),input=>({...reviewedTeaching(input),assessmentFindings:(input.disputedAssessments??[]).map((e:any)=>({evidenceId:e.evidenceId,verdict:'invalidate',reason:'原评审误判了等价表达'}))}));const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.submit(s.id,'比较最高值','to-review');const original=t.store.list('evidence')[0];t.store.put('evidence',{...original,id:'foreign-evidence',projectId:'foreign'});t.store.put('evidence',{...original,id:'other-version',teachingVersionId:'other',activitySnapshot:{...original.activitySnapshot!,teachingVersionId:'other'}});const d=await t.service.dispute(s.id,'这次评价忽略了我的有效解释');const count=t.inputs.length;await t.service.reviewDispute(d.id);expect(t.inputs).toHaveLength(count);await t.service.reviewDispute(d.id,{allowSendingPrivateContext:true});const sent=t.inputs.at(-1).disputedAssessments;expect(sent.map((e:any)=>e.evidenceId)).toEqual([original.id]);expect(t.requests.at(-1).schema.properties.assessmentFindings.items.properties.evidenceId.enum).toEqual([original.id]);expect(sent[0].answer).toBe('比较最高值');expect(t.store.list('corrections').some(c=>c.action==='invalidate'&&c.evidenceId===original.id)).toBe(true);expect(t.store.get('disputes',d.id)?.status).toBe('resolved');expect(t.store.get('evidence',original.id)).toEqual(original);
});
it('keeps confirmed corrections in adaptive context beyond the short teaching history and rejects dependent returns',async()=>{
 const t=await setup(input=>'answer' in input?assessment(input):input.intent==='continue'?plan('新任务：沿一路径的能量依次为1、6、2，指出最高值。'):plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.submit(s.id,'比较最高值','invalid-origin');const evidence=t.store.list('evidence')[0];t.store.put('corrections',{id:'persistent-correction',projectId:'p',teachingVersionId:s.teachingVersionId!,action:'invalidate',evidenceId:evidence.id,reason:'原题条件不足，不是学习者不会',createdAt:new Date().toISOString()});const due=t.store.list('reviews')[0];t.store.put('reviews',{...due,dueAt:'2026-01-01T00:00:00Z'});await expect(t.service.start('p','c',due.kind,due.id)).rejects.toThrow('原表现');await t.service.nextStep(s.id,'continue');const input=t.inputs.filter(input=>input.intent==='continue').at(-1);expect(input.evidence).toEqual([]);expect(input.corrections.some((c:any)=>c.evidenceId===evidence.id)).toBe(true);expect(input.history.some((step:any)=>step.action==='feedback')).toBe(false);
});

it('records feedback for unreviewed conceptual help without inventing an answer view or claiming independence',async()=>{
 const t=await setup(input=>'answer' in input?assessment(input):input.kind==='example'?{text:'不同例子：一条路径的能量可以先逐个观察。',sourceIds:['f'],scope:'other_example'}:plan());const s=await t.service.start('p','c');await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await t.service.help(s.id,'example');await t.service.submit(s.id,'比较最高值','unreviewed-example');expect(t.store.get('attempts','unreviewed-example')?.helpLevel).toBe(0);expect(t.store.list('evidence')[0].status).toBe('needs_review');expect(t.store.get('sessions',s.id)?.helpEvents.filter(h=>h.kind==='example')[0].level).toBe(0);expect(t.store.list('reviews')).toEqual([]);
});

describe('dispute concurrency and replacement integrity',()=>{
 it.each(['review','replacement_review'])('keeps a newly added challenge unresolved during %s',async(stage)=>{
  let t:Awaited<ReturnType<typeof setup>>,sessionId='';t=await setup(input=>input.revision?plan('修订题：路径甲和乙的最高值分别为7和9，比较候选上界。'):plan(),async input=>{if((stage==='review'&&input.dispute)||(stage==='replacement_review'&&input.teaching.origin==='correction'))await t.service.dispute(sessionId,'还有一个未经核对的新条件');return {...reviewedTeaching(input),...(input.dispute&&stage==='replacement_review'?{status:'needs_correction',issues:[{kind:'conditions',message:'初始条件需修订'}]}:{})};});const s=await t.service.start('p','c');sessionId=s.id;const dispute=await t.service.dispute(s.id,'先核对第一个条件');const result=await t.service.reviewDispute(dispute.id,{allowSendingPrivateContext:true});expect(result.status).toBe('unresolved');expect(result.messages.filter(m=>m.role==='user')).toHaveLength(2);expect(t.store.get('sessions',s.id)?.teachingVersionId).toBe(s.teachingVersionId);expect(t.service.getVerification(s.id).canAssess).toBe(false);expect(t.store.list('corrections').some(c=>c.action==='restore')).toBe(false);
 });
 it('does not commit an assessment when a challenge arrives while the assessor is returning',async()=>{
  let t:Awaited<ReturnType<typeof setup>>,sessionId='';t=await setup(async input=>{if('answer' in input){await t.service.dispute(sessionId,'评分期间发现题目少了条件');return assessment(input);}return plan();});const s=await t.service.start('p','c');sessionId=s.id;await t.service.nextStep(s.id,'continue');await t.service.nextStep(s.id,'continue');await expect(t.service.submit(s.id,'暂存作答','race-assessment')).rejects.toThrow('质疑');expect(t.store.get('attempts','race-assessment')?.text).toBe('暂存作答');expect(t.store.list('evidence')).toEqual([]);
 });
 it('binds a resolved correction to its replacement review and preserves it through backup validation',async()=>{
  const t=await setup(input=>input.revision?plan('修订题：一条路径的能量为1、6、2，指出最高值。'):plan(),input=>({...reviewedTeaching(input),...(input.dispute?{status:'needs_correction',issues:[{kind:'conditions',message:'旧任务条件需要修订'}]}:{})}));const s=await t.service.start('p','c');const d=await t.service.dispute(s.id,'请核对条件');const result=await t.service.reviewDispute(d.id,{allowSendingPrivateContext:true});expect(result.status).toBe('resolved');expect(t.store.get('taskReviews',result.reviewId!)?.teachingVersionId).toBe(result.replacementVersionId);const materialPath=join(t.store.dataDirectory,'notes.md');writeFileSync(materialPath,'本地原创测试材料');t.store.put('materials',{...t.store.get('materials','m')!,storedPath:materialPath});const file=join(t.store.dataDirectory,'replacement.reclimb');writeBackup(t.store,file);expect(readBackup(file).records.disputes.find((saved:any)=>saved.id===d.id)?.replacementVersionId).toBe(result.replacementVersionId);
 });
 it.each(['same_task','different_task'] as const)('attributes renamed and renumbered tasks according to the independently checked %s relation',async relation=>{
  const t=await setup(input=>'answer' in input?assessment(input):input.kind==='answer'?{text:'完整示范：比较两个最高能量，选较小者。',sourceIds:['f'],scope:'current_task'}:input.intent==='independent'?{steps:[{action:'check',title:'更名候选路径',content:'独立判断这一题。',sourceIds:['f'],activity:task('路径甲和乙最高能量分别为7和9，哪条给出的候选上界较小？')}]}:plan(),input=>({...reviewedTeaching(input),exposureRelations:(input.exposures??[]).map((e:any)=>({exposureId:e.id,relation,reason:relation==='same_task'?'与已完整示范题实质相同':'核对后是另一个实际任务'}))}));const s=await t.service.start('p','c');await t.service.help(s.id,'answer');await t.service.nextStep(s.id,'independent');await t.service.submit(s.id,'比较两条路径最高值','renamed-'+relation);expect(t.store.list('evidence')[0].status).toBe(relation==='same_task'?'assisted':'independent');
 });
 it('shows a migrated suspended legacy task as needing correction and creates a new reviewed version through the dispute flow',async()=>{
  const t=await setup(input=>input.revision?plan('修订题：能量序列1、4、2，找最高值。'):plan());const s=await t.service.start('p','c'),old=t.store.get('teachingVersions',s.teachingVersionId!)!,activity={...old.activity,id:'migration-task',teachingVersionId:undefined,rubricIds:undefined},steps=old.steps.map(step=>({...step,taskId:'migration-task',...(step.activity?{activity}:{})}));const legacy={...old,id:'migration-version',taskId:'migration-task',origin:'legacy' as const,activity,steps,contentHash:teachingContentHash({activity,steps,sources:old.sources})};t.store.put('teachingVersions',legacy);t.store.put('corrections',{id:'migration-stop',projectId:'p',teachingVersionId:legacy.id,action:'suspend',reason:'已核对的旧题错误',createdAt:new Date().toISOString()});t.store.put('sessions',{...s,teachingVersionId:undefined,activity,teaching:undefined});const calls=t.inputs.length;expect(t.service.getVerification(s.id)).toMatchObject({status:'needs_correction',canAssess:false});expect((await t.service.verify(s.id)).canAssess).toBe(false);expect(t.inputs).toHaveLength(calls);const d=await t.service.dispute(s.id,'旧题需要修订');const fixed=await t.service.reviewDispute(d.id,{allowSendingPrivateContext:true});expect(fixed.replacementVersionId).toBeTruthy();expect(t.store.get('teachingVersions',legacy.id)).toEqual(JSON.parse(JSON.stringify(legacy)));expect(t.service.getVerification(s.id).canAssess).toBe(true);
 });
});

it('corrects an abstract-logic shortcut by independently deriving a direct bound from all given facts',async()=>{
 const original='令J(t)=t²−t³/4，Γ为所有从0连续走到3的实值路径，L是各路径上J的最大值的下确界。有人说J(3)≤0不成立，因而L>0；这个推断有效吗？';const corrected='令J(t)=t²−t³/4，Γ为所有从0连续走到3的实值路径，L是各路径上J的最大值的下确界。利用每条路径都经过终点这一事实，给L一个统一下界并判断其正负。';const solution='J(3)=9−27/4=9/4>0。每条路径都含终点3，因此每条路径的最大值都至少是9/4；取下确界仍有L≥9/4>0。条件J(3)≤0失败本身提供J(3)>0，结合端点定义确实足够，不能仅按否定前件口号判无效。';
 const t=await setup(input=>{const result=plan(input.revision?corrected:original);result.steps[2].activity!.rubric=[input.revision?'利用所有路径共同的端点事实说明统一界':'指出条件失败不能支持正性推断'];return result;},input=>({...reviewedTeaching(input),status:input.teaching.origin==='correction'?'ready':'needs_correction',summary:'按完整题设独立推导后核对',privateSolution:solution,issues:input.teaching.origin==='correction'?[]:[{kind:'rubric',message:'原标准忽略了正端点值给出的统一正下界，错误否定了有效推断'}],mathChecks:[{id:'endpoint',kind:'polynomial_evaluate',claim:'终点能量为正',assumptions:['J按给定多项式定义'],coefficients:['0','0','1','-1/4'],at:'3',expected:'9/4'}]}));const s=await t.service.start('p','c');expect(s.activity.instruction).toBe(corrected);const reviews=t.store.list('taskReviews');expect(reviews.map(review=>review.status)).toEqual(['needs_correction','ready']);expect(JSON.parse(reviews[0].localChecks[0].details)).toMatchObject({status:'passed',actual:'9/4'});expect(reviews[0].privateSolution).toContain('L≥9/4>0');expect(t.inputs.filter(input=>input.operation==='review_teaching')).toHaveLength(2);expect(t.requests.find(request=>JSON.parse(request.user).operation==='review_teaching').system).toContain('全部给定事实');
});
