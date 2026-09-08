import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningStore } from '../src/main/store';
import { finishAssessment } from '../src/main/evidence';
import type { Assessment, Attempt, Review, Session } from '../src/shared/types';
const opened: LearningStore[] = [];
const start = '2026-09-07T00:00:00.000Z'; const later = '2026-09-08T00:00:00.000Z';
const good: Assessment = { outcome: 'met', feedback: '说明清楚', criteria: [{ criterion: '解释理由', result: 'met', reason: '给出了理由' }], limitations: [], sourceIds: ['fragment'] };
async function fixture() {
  const store = await LearningStore.open(mkdtempSync(join(tmpdir(), 'reclimb-evidence-'))); opened.push(store);
  store.transaction(() => {
    store.put('projects', { id: 'p', title: '项目', goal: '独立应用', status: 'active', createdAt: start, updatedAt: start });
    store.put('materials', { id: 'm', projectId: 'p', title: '材料', kind: 'text', originalName: '材料', storedPath: '', importedAt: start, warnings: [], fragmentCount: 1, summary: '' });
    store.put('fragments', { id: 'fragment', projectId: 'p', materialId: 'm', locator: '第 1 段', text: '归纳与迁移', ordinal: 0 });
    store.put('capabilities', { id: 'c', projectId: 'p', title: '能力', description: '', prerequisites: [], sourceIds: ['fragment'], order: 0 });
    addSession(store, 's', start);
  }); return store;
}
function addSession(store: LearningStore, id: string, createdAt: string, extra: Partial<Session> = {}) {
  const session: Session = { id, projectId: 'p', capabilityId: 'c', activity: { title: '解释', instruction: '说明这一概念的原因', kind: 'argument', rubric: ['解释理由'], sourceIds: ['fragment'], assessmentBasis: 'source' }, mode: 'practice', status: 'active', createdAt, updatedAt: createdAt, draft: '', helpLevel: 0, helpEvents: [], messages: [], checkpoint: '', nextStep: '', ...extra };
  store.put('sessions', session); const attempt: Attempt = { id: `a-${id}`, projectId: 'p', sessionId: id, text: '我的回答', submittedAt: createdAt, helpLevel: 0, requestId: `r-${id}` }; store.put('attempts', attempt); return session;
}
function review(store: LearningStore, kind: Review['kind']) { return store.list('reviews').find(r => r.kind === kind)!; }
afterEach(() => { for (const store of opened.splice(0)) store.close(); });
describe('finishAssessment', () => {
  it('records a first independent success atomically and schedules exactly two optional returns', async () => {
    const store = await fixture(); const evidence = finishAssessment(store, 'a-s', good, start);
    expect(evidence.status).toBe('independent'); expect(store.get('attempts', 'a-s')?.assessment).toEqual(good);
    expect(store.list('reviews')).toHaveLength(2); expect(review(store, 'delayed').dueAt).toBe(later); expect(review(store, 'transfer').dueAt).toBe('2026-09-14T00:00:00.000Z');
    expect(store.list('reviews').every(r => r.status === 'pending')).toBe(true);
  });
  it('deduplicates repeated assessment calls without replacing prior evidence', async () => {
    const store = await fixture(); const first = finishAssessment(store, 'a-s', good, start); const retry = finishAssessment(store, 'a-s', { ...good, outcome: 'not_yet' }, later);
    expect(retry).toEqual(first); expect(store.list('evidence')).toHaveLength(1); expect(store.list('reviews')).toHaveLength(2);
  });
  it('uses submitted help level and never rewrites independence after later help', async () => {
    const store = await fixture(); const session = store.get('sessions', 's')!; store.put('sessions', { ...session, helpLevel: 4 });
    expect(finishAssessment(store, 'a-s', good, start).status).toBe('independent');
    addSession(store, 'assisted', start); const attempt = store.get('attempts', 'a-assisted')!; store.put('attempts', { ...attempt, helpLevel: 1 });
    expect(finishAssessment(store, attempt.id, good, start).status).toBe('assisted');
  });
  it('requires met rubric evidence and preserves uncertain outcomes for review', async () => {
    const store = await fixture();
    expect(finishAssessment(store, 'a-s', { ...good, criteria: [] }, start).status).toBe('needs_review'); expect(store.list('reviews')).toHaveLength(0);
    addSession(store, 'partial', start); expect(finishAssessment(store, 'a-partial', { ...good, outcome: 'partial' }, start).status).toBe('needs_review');
    addSession(store, 'criterion', start); expect(finishAssessment(store, 'a-criterion', { ...good, criteria: [{ ...good.criteria[0], result: 'uncertain' }] }, start).status).toBe('needs_review');
  });
  it('requires a linked pending review, different session and 24 hours for delayed evidence', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    addSession(store, 'too-soon', '2026-09-07T23:59:00.000Z', { mode: 'delayed', dueReviewId: due.id });
    const early = finishAssessment(store, 'a-too-soon', good, '2026-09-07T23:59:00.000Z'); expect(early.status).toBe('independent'); expect(early.assessment.limitations.length).toBeGreaterThan(0); expect(store.get('reviews', due.id)?.status).toBe('pending');
    addSession(store, 'delayed', '2026-09-09T00:00:00.000Z', { mode: 'delayed', dueReviewId: due.id }); expect(finishAssessment(store, 'a-delayed', good, '2026-09-09T00:00:00.000Z').status).toBe('delayed'); expect(store.get('reviews', due.id)?.status).toBe('done'); expect(store.list('reviews')).toHaveLength(2);
  });
  it('does not call ordinary practice delayed and does not complete reviews with help', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    addSession(store, 'practice', later); expect(finishAssessment(store, 'a-practice', good, later).status).toBe('independent');
    addSession(store, 'helped', later, { mode: 'delayed', dueReviewId: due.id }); const attempt = store.get('attempts', 'a-helped')!; store.put('attempts', { ...attempt, helpLevel: 2 });
    expect(finishAssessment(store, attempt.id, good, later).status).toBe('assisted'); expect(store.get('reviews', due.id)?.status).toBe('pending');
  });
  it('requires a changed task and explicit transfer review without creating an endless review chain', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'transfer');
    addSession(store, 'same', later, { mode: 'transfer', dueReviewId: due.id }); const same = finishAssessment(store, 'a-same', good, later); expect(same.status).toBe('independent'); expect(same.assessment.limitations.length).toBeGreaterThan(0);
    const changed = addSession(store, 'changed', later, { mode: 'transfer', dueReviewId: due.id }); store.put('sessions', { ...changed, activity: { ...changed.activity, instruction: '在一个新的生活场景中应用并说明理由',transferCheck:{verdict:'valid',changedSituation:'从解释概念转为有干扰信息的实际判断',sharedPrinciple:'同一概念的适用条件',requiredAdaptation:'先从实际情境选择相关条件再应用',reason:'要求重新建模而不只是改写原题'} } });
    expect(finishAssessment(store, 'a-changed', good, later).status).toBe('transfer'); expect(store.get('reviews', due.id)?.completedSessionId).toBe('changed'); expect(store.list('reviews')).toHaveLength(2);
  });
  it('rejects cross-project source references with no partial persistence', async () => {
    const store = await fixture(); store.put('fragments', { id: 'foreign', projectId: 'other', materialId: 'foreign-material', locator: '', text: '外部', ordinal: 0 });
    expect(() => finishAssessment(store, 'a-s', { ...good, sourceIds: ['foreign'] }, start)).toThrow();
    expect(store.list('evidence')).toHaveLength(0); expect(store.get('attempts', 'a-s')?.assessment).toBeUndefined(); expect(store.list('reviews')).toHaveLength(0);
  });
  it('rejects cross-project sessions and capabilities', async () => {
    const store = await fixture(); const capability = store.get('capabilities', 'c')!; store.put('capabilities', { ...capability, projectId: 'other' });
    expect(() => finishAssessment(store, 'a-s', good, start)).toThrow(); expect(store.list('evidence')).toHaveLength(0);
  });
});

describe('evidence boundary conditions', () => {
  it('rejects future submissions and submissions dated before their session', async () => {
    const store = await fixture(); const attempt = store.get('attempts', 'a-s')!;
    store.put('attempts', { ...attempt, submittedAt: later });
    expect(() => finishAssessment(store, attempt.id, good, start)).toThrow(); expect(store.list('evidence')).toHaveLength(0);
    store.put('attempts', { ...attempt, submittedAt: '2026-09-06T23:59:00.000Z' });
    expect(() => finishAssessment(store, attempt.id, good, start)).toThrow(); expect(store.list('evidence')).toHaveLength(0);
  });
  it('cannot reuse the originating session or a completed return to claim delayed ability', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    const original = store.get('sessions', 's')!; store.put('sessions', { ...original, mode: 'delayed', dueReviewId: due.id });
    store.put('attempts', { ...store.get('attempts', 'a-s')!, id: 'same-session-attempt', requestId: 'same-session-request', submittedAt: later, assessment: undefined });
    const same = finishAssessment(store, 'same-session-attempt', good, later); expect(same.status).toBe('independent'); expect(same.assessment.limitations.join('')).toContain('同一次会话');
    store.put('reviews', { ...due, status: 'done', completedSessionId: 'previous' });
    addSession(store, 'again', '2026-09-09T00:00:00.000Z', { mode: 'delayed', dueReviewId: due.id });
    expect(finishAssessment(store, 'a-again', good, '2026-09-09T00:00:00.000Z').status).toBe('independent'); expect(store.get('reviews', due.id)?.completedSessionId).toBe('previous');
  });
  it('downgrades unlinked delayed or transfer sessions instead of granting a special badge', async () => {
    const store = await fixture();
    for (const mode of ['delayed', 'transfer'] as const) {
      addSession(store, mode, later, { mode }); const evidence = finishAssessment(store, `a-${mode}`, good, later);
      expect(evidence.status).toBe('independent'); expect(evidence.assessment.limitations.join('')).toContain('没有关联');
    }
  });
  it('never creates extra returns after an assisted first success or another ordinary session', async () => {
    const store = await fixture(); store.put('attempts', { ...store.get('attempts', 'a-s')!, helpLevel: 3 });
    expect(finishAssessment(store, 'a-s', good, start).status).toBe('assisted'); expect(store.list('reviews')).toHaveLength(2);
    addSession(store, 'independent-later', later); finishAssessment(store, 'a-independent-later', good, later); expect(store.list('reviews')).toHaveLength(2);
  });
  it('rejects foreign sessions, review records and original material owners', async () => {
    const store = await fixture(); const session = store.get('sessions', 's')!;
    store.put('sessions', { ...session, projectId: 'other' }); expect(() => finishAssessment(store, 'a-s', good, start)).toThrow();
    store.put('sessions', session); const material = store.get('materials', 'm')!;
    store.put('materials', { ...material, projectId: 'other' }); expect(() => finishAssessment(store, 'a-s', good, start)).toThrow(); expect(store.list('evidence')).toHaveLength(0);
    store.put('materials', material); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    store.put('reviews', { ...due, projectId: 'other' }); addSession(store, 'foreign-review', later, { mode: 'delayed', dueReviewId: due.id });
    expect(() => finishAssessment(store, 'a-foreign-review', good, later)).toThrow(); expect(store.list('evidence')).toHaveLength(1); expect(store.get('attempts', 'a-foreign-review')?.assessment).toBeUndefined();
  });
});

describe('feedback attribution', () => {
  it('keeps submitted evidence independent but makes later revisions of the same task assisted', async () => {
    const store = await fixture(); const first = finishAssessment(store, 'a-s', good, start);
    expect(first.status).toBe('independent'); expect(store.get('attempts', 'a-s')?.helpLevel).toBe(0);
    const session = store.get('sessions', 's')!; expect(session.helpLevel).toBe(1); expect(session.helpEvents).toHaveLength(1); expect(session.helpEvents[0].id).toContain('assessment-feedback');
    store.put('attempts', { id: 'revision', projectId: 'p', sessionId: 's', text: '根据反馈修订', submittedAt: later, helpLevel: session.helpLevel, requestId: 'revision-request' });
    expect(finishAssessment(store, 'revision', good, later).status).toBe('assisted');
    expect(store.get('attempts', 'a-s')?.helpLevel).toBe(0); expect(store.get('evidence', first.id)?.status).toBe('independent');
    finishAssessment(store, 'revision', good, later); expect(store.get('sessions', 's')?.helpEvents).toHaveLength(2);
  });
  it('also counts feedback on uncertain answers without lowering prior help levels', async () => {
    const store = await fixture(); const session = store.get('sessions', 's')!; store.put('sessions', { ...session, helpLevel: 4 });
    expect(finishAssessment(store, 'a-s', { ...good, outcome: 'uncertain' }, start).status).toBe('needs_review');
    expect(store.get('sessions', 's')?.helpLevel).toBe(4); expect(store.get('sessions', 's')?.helpEvents).toHaveLength(1);
  });
});

describe('cross-flow review regressions', () => {
  it('does not label a return delayed after recent answer exposure in the original session', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    const original = store.get('sessions', 's')!;
    store.put('sessions', { ...original, helpLevel: 4, helpEvents: [...original.helpEvents, { id: 'recent-answer', kind: 'answer', level: 4, createdAt: '2026-09-08T00:30:00.000Z' }] });
    addSession(store, 'recent-exposure', '2026-09-08T01:00:00.000Z', { mode: 'delayed', dueReviewId: due.id });
    const evidence = finishAssessment(store, 'a-recent-exposure', good, '2026-09-08T01:00:00.000Z');
    expect(evidence.status).toBe('independent'); expect(store.get('reviews', due.id)?.status).toBe('pending');
    expect(evidence.assessment.limitations.join('')).toContain('24');
  });
  it('does not roll back a changed goal or pause while route generation is awaiting AI', async () => {
    const { LearningService } = await import('../src/main/learning-service');
    const store = await fixture(); store.updateSettings({ monthlyBudgetCny: 100 });
    let release!: (value: { text: string; inputTokens: number; outputTokens: number; usageKnown: boolean }) => void;
    const model = { complete: () => new Promise<{ text: string; inputTokens: number; outputTokens: number; usageKnown: boolean }>(resolve => { release = resolve; }) };
    const service = new LearningService(store, () => 'test-key', () => model);
    const pending = service.generateRoute('p');
    const old = store.get('projects', 'p')!; store.put('projects', { ...old, goal: '用户刚修改的目标', status: 'paused', updatedAt: later });
    release({ text: JSON.stringify({ summary: '旧目标的路线', nearSteps: [0,1].map(i=>({capabilityTitle:'新能力',title:'步骤'+i,objective:'识别一个对象',completion:'说明对象即可',prerequisites:[],reason:'先建立对象',sourceIds:['fragment']})), capabilities: [{ title: '新能力', description: '旧目标所需', prerequisites: [], sourceIds: ['fragment'] },...['额外辨认','额外判断'].map(title=>({title,description:'简短能力',prerequisites:[],sourceIds:['fragment']}))] }), inputTokens: 10, outputTokens: 10, usageKnown: true });
    // Rejecting a stale generation is valid; overwriting the user's newer changes is not.
    await pending.catch(() => undefined);
    expect(store.get('projects', 'p')?.goal).toBe('用户刚修改的目标'); expect(store.get('projects', 'p')?.status).toBe('paused');
  });
  it('keeps prior evidence attached to its original capability when a new route reuses the title', async () => {
    const { LearningService } = await import('../src/main/learning-service');
    const store = await fixture(); store.updateSettings({ monthlyBudgetCny: 100 });
    const original = store.get('capabilities', 'c')!; const evidence = finishAssessment(store, 'a-s', good, start);
    const model = { complete: async () => ({ text: JSON.stringify({ summary: '调整后的路线', nearSteps: [0,1].map(i=>({capabilityTitle:original.title,title:'步骤'+i,objective:'识别一个对象',completion:'说明对象即可',prerequisites:[],reason:'先建立对象',sourceIds:['fragment']})), capabilities: [{ title: original.title, description: '完全不同的新能力要求', prerequisites: [], sourceIds: ['fragment'] },...['额外辨认','额外判断'].map(title=>({title,description:'简短能力',prerequisites:[],sourceIds:['fragment']}))] }), inputTokens: 10, outputTokens: 10, usageKnown: true }) };
    const service = new LearningService(store, () => 'test-key', () => model);
    await service.generateRoute('p');
    expect(store.get('capabilities', evidence.capabilityId)?.description).toBe(original.description);
    const revised = store.list('capabilities', 'p').find(cap => cap.description === '完全不同的新能力要求');
    expect(revised).toBeDefined(); expect(revised?.id).not.toBe(evidence.capabilityId);
  });
});

describe('delayed evidence after other recorded learning', () => {
  it('restarts the delay after support or an attempt in another session for the same capability', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    const side = addSession(store, 'side-practice', '2026-09-08T00:15:00.000Z');
    store.put('sessions', { ...side, helpLevel: 2, helpEvents: [{ id: 'side-hint', kind: 'hint', level: 2, createdAt: '2026-09-08T00:30:00.000Z' }] });
    addSession(store, 'after-side-practice', '2026-09-08T01:00:00.000Z', { mode: 'delayed', dueReviewId: due.id });
    const evidence = finishAssessment(store, 'a-after-side-practice', good, '2026-09-08T01:00:00.000Z');
    expect(evidence.status).toBe('independent'); expect(store.get('reviews', due.id)?.status).toBe('pending');
  });
  it('counts a recent ungraded attempt even when no help was requested', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    addSession(store, 'ungraded-practice', '2026-09-08T00:30:00.000Z');
    addSession(store, 'after-ungraded', '2026-09-08T01:00:00.000Z', { mode: 'delayed', dueReviewId: due.id });
    expect(finishAssessment(store, 'a-after-ungraded', good, '2026-09-08T01:00:00.000Z').status).toBe('independent');
  });
  it('counts persisted feedback even if a legacy session has no corresponding help event', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    const original = store.get('sessions', 's')!;
    store.put('sessions', { ...original, messages: [{ id: 'legacy-feedback', role: 'assistant', kind: 'feedback', text: '新的针对性解释', createdAt: '2026-09-08T00:30:00.000Z' }] });
    addSession(store, 'after-feedback', '2026-09-08T01:00:00.000Z', { mode: 'delayed', dueReviewId: due.id });
    expect(finishAssessment(store, 'a-after-feedback', good, '2026-09-08T01:00:00.000Z').status).toBe('independent');
  });
  it('does not count its own unassisted test or help delivered after that test was submitted', async () => {
    const store = await fixture(); const first = finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    addSession(store, 'valid-delayed', later, { mode: 'delayed', dueReviewId: due.id });
    const original = store.get('sessions', 's')!;
    store.put('sessions', { ...original, helpEvents: [...original.helpEvents, { id: 'after-submission', kind: 'answer', level: 4, createdAt: '2026-09-08T00:30:00.000Z' }] });
    expect(finishAssessment(store, 'a-valid-delayed', good, '2026-09-08T01:00:00.000Z').status).toBe('delayed');
    expect(store.get('evidence', first.id)?.status).toBe('independent');
  });
  it('does not reset the delay because the learner practised another capability', async () => {
    const store = await fixture(); finishAssessment(store, 'a-s', good, start); const due = review(store, 'delayed');
    store.put('capabilities', { ...store.get('capabilities', 'c')!, id: 'unrelated' });
    const side = addSession(store, 'unrelated-practice', '2026-09-08T00:30:00.000Z', { capabilityId: 'unrelated' });
    store.put('sessions', { ...side, helpEvents: [{ id: 'unrelated-answer', kind: 'answer', level: 4, createdAt: '2026-09-08T00:45:00.000Z' }] });
    addSession(store, 'still-valid', '2026-09-08T01:00:00.000Z', { mode: 'delayed', dueReviewId: due.id });
    expect(finishAssessment(store, 'a-still-valid', good, '2026-09-08T01:00:00.000Z').status).toBe('delayed');
  });
});


describe('task-scoped evidence in continuous teaching', () => {
  it('uses the submitted task snapshot even after moving to a different task, without tainting that new task', async () => {
    const store=await fixture();const original=store.get('sessions','s')!;const frozen={...original.activity,id:'old-task'};
    store.put('attempts',{...store.get('attempts','a-s')!,taskId:'old-task',stepId:'old-step',activitySnapshot:frozen});
    store.put('sessions',{...original,activity:{...original.activity,id:'new-task',instruction:'新的诊断任务',rubric:['诊断错误']},helpLevel:0});
    const result=finishAssessment(store,'a-s',good,start);expect(result.status).toBe('independent');expect(result.activitySnapshot).toEqual(frozen);expect(result.taskId).toBe('old-task');expect(store.get('sessions','s')?.helpLevel).toBe(0);expect(store.get('sessions','s')?.helpEvents.at(-1)).toMatchObject({taskId:'old-task',scope:'current_task'});expect(review(store,'transfer').fromActivity).toEqual(frozen);
  });
  it('does not infer transfer from different wording or an absent semantic check', async () => {
    const store=await fixture();finishAssessment(store,'a-s',good,start);const due=review(store,'transfer');
    const s=addSession(store,'paraphrase',later,{mode:'transfer',dueReviewId:due.id});store.put('sessions',{...s,activity:{...s.activity,instruction:'请说一说此概念为什么成立'}});
    const result=finishAssessment(store,'a-paraphrase',good,later);expect(result.status).toBe('independent');expect(result.assessment.limitations.join('')).toContain('迁移');expect(store.get('reviews',due.id)?.status).toBe('pending');
  });
  it('requires concrete adaptation even if a model says valid', async () => {
    const store=await fixture();finishAssessment(store,'a-s',good,start);const due=review(store,'transfer');const s=addSession(store,'empty-check',later,{mode:'transfer',dueReviewId:due.id});
    store.put('sessions',{...s,activity:{...s.activity,instruction:'更换数字再作答',transferCheck:{verdict:'valid',changedSituation:'',sharedPrinciple:'同一原理',requiredAdaptation:'',reason:'新的题目'}}});
    expect(finishAssessment(store,'a-empty-check',good,later).status).toBe('independent');
  });
});

describe('completed review identity after continuous learning',()=>{
 it('freezes the exact successful return evidence and task',async()=>{
  const store=await fixture();finishAssessment(store,'a-s',good,start);const due=review(store,'delayed');const session=addSession(store,'return',later,{mode:'delayed',dueReviewId:due.id});store.put('sessions',{...session,activity:{...session.activity,id:'return-task'}});store.put('attempts',{...store.get('attempts','a-return')!,taskId:'return-task',activitySnapshot:{...session.activity,id:'return-task'}});
  const result=finishAssessment(store,'a-return',good,later);expect(result.reviewId).toBe(due.id);expect(store.get('reviews',due.id)).toMatchObject({completedEvidenceId:result.id,completedTaskId:'return-task'});
 });
 it('anchors a legacy completed review before changing the same session to another task without rewriting its evidence',async()=>{
  const {LearningService}=await import('../src/main/learning-service');const store=await fixture();store.updateSettings({monthlyBudgetCny:100});finishAssessment(store,'a-s',good,start);const due=review(store,'delayed');addSession(store,'return',later,{mode:'delayed',dueReviewId:due.id});const result=finishAssessment(store,'a-return',good,later);const completed=store.get('reviews',due.id)!;store.put('reviews',{...completed,completedEvidenceId:undefined,completedTaskId:undefined});const originalEvidence=store.list('evidence');
  const model={complete:async()=>({text:JSON.stringify({steps:[{action:'check',title:'新任务',content:'现在换个独立判断',sourceIds:['fragment'],activity:{title:'新的选择',instruction:'从两个方案中选择并说明差异',kind:'selection',rubric:['说明选择理由'],sourceIds:['fragment'],assessmentBasis:'source'}}]}),inputTokens:10,outputTokens:10,usageKnown:true})};
  const service=new LearningService(store,()=> 'test-key',()=>model);await service.nextStep('return','independent');expect(store.get('sessions','return')?.mode).toBe('practice');expect(store.get('sessions','return')?.dueReviewId).toBeUndefined();expect(store.get('reviews',due.id)?.completedEvidenceId).toBe(result.id);expect(store.list('evidence')).toEqual(originalEvidence);
 });
});