import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { LearningStore } from '../src/main/store';
import { writeBackup, readBackup, prepareRestore } from '../src/main/backup';
import { finishAssessment } from '../src/main/evidence';
import { teachingContentHash, VerificationService } from '../src/main/verification-service';
import { versionStanding, evidenceStanding } from '../src/shared/reliability-state';
import { applyKnownIncidentCorrections, KNOWN_INCIDENT } from '../src/main/incident-migration';
import { CallRunner } from '../src/main/call-runner';
import type { Activity, Assessment, Session } from '../src/shared/types';
import type { TeachingVersion, TaskReview } from '../src/shared/reliability';

let directory: string, store: LearningStore;
const first = '2026-09-01T00:00:00.000Z', later = '2026-09-03T00:00:00.000Z';
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'reclimb-reliability-integration-')); store = await LearningStore.open(join(directory, 'one'));
  store.put('projects', { id: 'p', title: '核验集成测试', goal: '保存可信表现', status: 'active', createdAt: first, updatedAt: first });
  store.put('capabilities', { id: 'c', projectId: 'p', title: '有限比较', description: '比较给定数值', prerequisites: [], sourceIds: [], order: 0 });
});
afterEach(() => { vi.useRealTimers(); store?.close(); rmSync(directory, { recursive: true, force: true }); });

function version(taskId: string, twoCriteria = false, example?: string, replaces?: TeachingVersion): TeachingVersion {
  const id = `version-${taskId}`;
  const activity: Activity = { id: taskId, teachingVersionId: id, title: '比较给定数值', instruction: '比较 2 和 3。第二条只有指定的条件成立时才适用。', kind: 'application', rubric: ['比较两个值', ...(twoCriteria ? ['条件成立时再解释路径'] : [])], rubricIds: ['criterion-1', ...(twoCriteria ? ['criterion-2'] : [])], sourceIds: [], assessmentBasis: 'ai' };
  const body = { activity, sources: [], steps: [...(example ? [{ id: `example-${taskId}`, taskId, action: 'demonstrate' as const, title: '不同例子', content: example, sourceIds: [], createdAt: first }] : []), { id: `step-${taskId}`, taskId, action: 'check' as const, title: activity.title, content: activity.instruction, sourceIds: [], activity, createdAt: first }] };
  const record: TeachingVersion = { id, taskId, projectId: 'p', capabilityId: 'c', version: replaces ? replaces.version + 1 : 1, ...body, contentHash: teachingContentHash(body), origin: replaces ? 'correction' : 'generated', createdAt: first, ...(replaces ? { replacesVersionId: replaces.id } : {}) };
  store.put('teachingVersions', record);
  const review: TaskReview = { id: `check-${taskId}`, projectId: 'p', teachingVersionId: id, contentHash: record.contentHash, status: 'ready', summary: '形式与分支核对完成', privateSolution: '2 小于 3。条件不成立。', issues: [], branches: twoCriteria ? [{ id: 'branch-1', condition: '指定条件', applicability: 'does_not_apply', criterionIndexes: [1], expectedBehavior: '说明条件不适用' }] : [], exposureRelations: [], localChecks: [], createdAt: first, reviewerModel: 'local-test' };
  store.put('taskReviews', review); return record;
}
function session(id: string, v: TeachingVersion, at = first, dueReviewId?: string): void {
  const record: Session = { id, projectId: 'p', capabilityId: 'c', activity: v.activity, teachingVersionId: v.id, mode: dueReviewId ? 'delayed' : 'practice', status: 'active', createdAt: at, updatedAt: at, draft: '我的草稿', helpLevel: 0, helpEvents: [], messages: [], checkpoint: '', nextStep: '', ...(dueReviewId ? { dueReviewId } : {}) };
  store.put('sessions', record);
  store.put('attempts', { id: `attempt-${id}`, requestId: `attempt-${id}`, projectId: 'p', sessionId: id, taskId: v.taskId, teachingVersionId: v.id, activitySnapshot: v.activity, submittedAt: at, text: '2 小于 3，条件分支不适用。', helpLevel: 0, mode: record.mode, ...(dueReviewId ? { reviewId: dueReviewId } : {}) });
}
function assessment(v: TeachingVersion): Assessment {
  return { outcome: 'met', feedback: '比较正确', criteria: v.activity.rubric.map((criterion, index) => ({ criterion, criterionId: v.activity.rubricIds![index], result: index === 0 ? 'met' : 'not_applicable', reason: index === 0 ? '说明 2<3' : '核验确定条件不适用' })), limitations: [], sourceIds: [] };
}
function mutateBackup(source: string, change: (records: any) => void): string {
  const archive = new AdmZip(source), manifest = JSON.parse(archive.readAsText('manifest.json'));
  change(manifest.records); archive.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  const changed = join(directory, 'changed.reclimb'); archive.writeZip(changed); return changed;
}

describe('complete v3 reliability and restore graph', () => {
  it('does not call a dispute replacement a fresh independent task, but allows an unseen pre-publication repair',()=>{
    const original=version('old'),hiddenRepair=version('hidden',false,undefined,original);session('hidden-session',hiddenRepair);
    expect(finishAssessment(store,'attempt-hidden-session',assessment(hiddenRepair),first).status).toBe('independent');
    const repaired=version('repaired',false,undefined,original);session('old-session',original);session('repaired-session',repaired,later);
    store.put('disputes',{id:'d',projectId:'p',sessionId:'old-session',taskId:original.taskId,teachingVersionId:original.id,contentHash:original.contentHash,issue:'原题有错',status:'resolved',messages:[],createdAt:first,updatedAt:first,replacementVersionId:repaired.id});
    const evidence=finishAssessment(store,'attempt-repaired-session',assessment(repaired),later);
    expect(evidence.status).toBe('needs_review');expect(evidence.helpLevel).toBe(0);expect(evidence.assessment.limitations.join('')).toContain('修订');
  });
  it('preserves task, dispute and evidence correction scopes through a complete backup roundtrip', async () => {
    const v = version('task'); session('session', v);
    const evidence = finishAssessment(store, 'attempt-session', assessment(v), first);
    store.put('disputes', { id: 'dispute', projectId: 'p', sessionId: 'session', taskId: v.taskId, teachingVersionId: v.id, contentHash: v.contentHash, issue: '评价有误', status: 'resolved', messages: [], createdAt: later, updatedAt: later, reviewId: 'check-task' });
    store.put('corrections', { id: 'suspend', projectId: 'p', teachingVersionId: v.id, action: 'suspend', reason: '待核对', createdAt: later, disputeId: 'dispute' });
    store.put('corrections', { id: 'invalidate-evidence', projectId: 'p', teachingVersionId: v.id, evidenceId: evidence.id, action: 'invalidate', reason: '旧评价无效', createdAt: later, disputeId: 'dispute', reviewId: 'check-task' });
    store.put('corrections', { id: 'restore-question', projectId: 'p', teachingVersionId: v.id, action: 'restore', reason: '题目可继续用', createdAt: later, disputeId: 'dispute', reviewId: 'check-task' });
    const archive = join(directory, 'valid.reclimb'); writeBackup(store, archive); await prepareRestore(archive, join(directory, 'restored'));
    const restored = await LearningStore.open(join(directory, 'restored'));
    try {
      expect(restored.get('evidence', evidence.id)).toEqual(evidence);
      expect(versionStanding(restored.snapshot(), v.id).effective).toBe(true);
      expect(evidenceStanding(restored.snapshot(), evidence)).toMatchObject({ effective: false, reason: '旧评价无效' });
      expect(restored.list('corrections')).toEqual(store.list('corrections'));
    } finally { restored.close(); }
  });

  it('backs up a completed delayed check with one met criterion and one verified inapplicable branch, rejecting a forged branch', () => {
    const origin = version('origin'); session('origin-session', origin); finishAssessment(store, 'attempt-origin-session', assessment(origin), first);
    const due = store.list('reviews').find(review => review.kind === 'delayed')!;
    const current = version('return', true); session('return-session', current, later, due.id);
    const completed = finishAssessment(store, 'attempt-return-session', assessment(current), later);
    expect(completed.status).toBe('delayed'); expect(store.get('reviews', due.id)?.status).toBe('done');
    const archive = join(directory, 'completed.reclimb'); expect(() => writeBackup(store, archive)).not.toThrow();
    expect(readBackup(archive).records.evidence.find(item => item.id === completed.id)?.assessment.criteria[1].result).toBe('not_applicable');
    const forged = mutateBackup(archive, records => { records.taskReviews.find((review: any) => review.teachingVersionId === current.id).branches[0].applicability = 'applies'; });
    expect(() => readBackup(forged)).toThrow();
  });

  it('rejects a correction justified by an unrelated teaching review from the same project', () => {
    const original = version('original'), unrelated = version('unrelated'); session('session', original);
    store.put('corrections', { id: 'restore', projectId: 'p', teachingVersionId: original.id, action: 'restore', reason: '恢复题目', createdAt: later, reviewId: 'check-original' });
    const archive = join(directory, 'valid.reclimb'); writeBackup(store, archive);
    const forged = mutateBackup(archive, records => { records.corrections[0].reviewId = `check-${unrelated.taskId}`; });
    expect(() => readBackup(forged)).toThrow();
  });

  it('roundtrips a resolved dispute whose successful review belongs to its direct replacement, rejecting an unrelated review', async () => {
    const original = version('original'); session('session', original);
    const evidence = finishAssessment(store, 'attempt-session', assessment(original), first);
    const replacement = version('corrected', false, undefined, original); version('unrelated');
    const dispute = { id: 'replaced-dispute', projectId: 'p', sessionId: 'session', taskId: original.taskId, teachingVersionId: original.id, contentHash: original.contentHash, issue: '原条件需要修订', status: 'resolved' as const, messages: [], createdAt: later, updatedAt: later, reviewId: 'check-corrected', replacementVersionId: replacement.id };
    store.put('disputes', dispute);
    store.put('corrections', { id: 'replace-original', projectId: 'p', teachingVersionId: original.id, action: 'replace', reason: '已生成并核验直接修订版本', createdAt: later, disputeId: dispute.id, reviewId: 'check-corrected', replacementVersionId: replacement.id });
    store.put('corrections', { id: 'invalidate-old-evaluation', projectId: 'p', teachingVersionId: original.id, action: 'invalidate', reason: '旧题评价失效', createdAt: later, disputeId: dispute.id, reviewId: 'check-corrected', evidenceId: evidence.id });
    store.put('sessions', { ...store.get('sessions', 'session')!, activity: replacement.activity, teachingVersionId: replacement.id });
    const archive = join(directory, 'replacement.reclimb'); writeBackup(store, archive); await prepareRestore(archive, join(directory, 'replacement-restored'));
    const restored = await LearningStore.open(join(directory, 'replacement-restored'));
    try {
      expect(restored.get('disputes', dispute.id)).toEqual(dispute);
      expect(restored.get('evidence', evidence.id)?.teachingVersionId).toBe(original.id);
      expect(restored.get('sessions', 'session')?.teachingVersionId).toBe(replacement.id);
      expect(evidenceStanding(restored.snapshot(), evidence).effective).toBe(false);
    } finally { restored.close(); }
    const forged = mutateBackup(archive, records => { records.disputes[0].reviewId = 'check-unrelated'; });
    expect(() => readBackup(forged)).toThrow(/争议|核验|版本/);
  });

  it('rejects assigning an evidence record to a different legacy version than its frozen attempt', () => {
    const original = version('original'); session('session', original); const evidence = finishAssessment(store, 'attempt-session', assessment(original), first);
    const body = { activity: original.activity, steps: original.steps.map(step => ({ ...step, content: '另一教学版本的说明' })), sources: [] };
    const other: TeachingVersion = { ...original, id: 'other-legacy-version', ...body, origin: 'legacy', contentHash: teachingContentHash(body) }; store.put('teachingVersions', other);
    store.put('taskReviews', { ...store.get('taskReviews', 'check-original')!, id: 'other-legacy-review', teachingVersionId: other.id, contentHash: other.contentHash });
    const archive = join(directory, 'valid.reclimb'); writeBackup(store, archive);
    const forged = mutateBackup(archive, records => { records.evidence.find((item: any) => item.id === evidence.id).teachingVersionId = other.id; });
    expect(() => readBackup(forged)).toThrow();
  });

  it('keeps normal different-example teaching assessable after its already reviewed explanation becomes visible', () => {
    const example = '不同例子：比较 7 与 9。原题 2 与 3 的答案没有展示。';
    const v = version('task', false, example); session('session', v);
    store.put('answerExposures', { id: 'shown-example', projectId: 'p', capabilityId: 'c', sessionId: 'session', taskId: v.taskId, teachingVersionId: v.id, kind: 'demonstration', text: example, createdAt: first });
    expect(() => finishAssessment(store, 'attempt-session', assessment(v), first)).not.toThrow();
  });

  it('does not promote later unreviewed help to independent evidence merely because it carries the same teaching version ID', () => {
    const v = version('task'); session('session', v);
    store.put('answerExposures', { id: 'later-help', projectId: 'p', capabilityId: 'c', sessionId: 'session', taskId: v.taskId, teachingVersionId: v.id, kind: 'demonstration', text: '题目答案是 2 小于 3。', createdAt: first });
    const evidence = finishAssessment(store, 'attempt-session', assessment(v), first);
    expect(evidence.status).toBe('needs_review');
    expect(evidence.assessment.limitations.join('')).toMatch(/已见|关系|独立/);
    expect(store.get('attempts', 'attempt-session')?.assessment).toBeDefined();
  });

  it('keeps content review and feedback available after sixty historical exposures without asserting unverified independence', async () => {
    const v = version('task'); session('session', v); store.updateSettings({ monthlyBudgetCny: 100 });
    store.transaction(() => { for (let i = 0; i < 61; i++) store.put('answerExposures', { id: `old-exposure-${i}`, projectId: 'p', capabilityId: 'c', sessionId: 'session', taskId: `old-task-${i}`, kind: 'feedback', text: `早先任务 ${i} 的反馈`, createdAt: first }); });
    const runner = new CallRunner(store, () => 'test-only', () => ({ complete: async request => {
      const input = JSON.parse(request.user);
      return { text: JSON.stringify({ status: 'ready', summary: '题目与标准一致', issues: [], privateSolution: '2 小于 3', branches: [], exposureRelations: input.exposures.map((item: any) => ({ exposureId: item.id, relation: 'different_task', reason: '已提供记录是不同任务' })), assessmentFindings: [], mathChecks: [] }), inputTokens: 1, outputTokens: 1, usageKnown: true };
    } }));
    const service = new VerificationService(store, runner), reviewed = await service.review(v, { force: true });
    expect(reviewed.status).toBe('ready'); expect(reviewed.exposureCoverageComplete).toBe(false);
    expect(service.getView(v.id).canAssess).toBe(true);
    const evidence = finishAssessment(store, 'attempt-session', assessment(v), first);
    expect(evidence.status).toBe('needs_review'); expect(store.get('attempts', 'attempt-session')?.assessment).toBeDefined();
  });

  it('honors a reduced current-month budget even when consuming a hold created in the previous month', async () => {
    vi.setSystemTime(new Date('2026-09-30T23:59:59.000Z'));
    store.updateSettings({ monthlyBudgetCny: 0.1, inputPriceCnyPerMillion: 1, outputPriceCnyPerMillion: 1 });
    const complete = vi.fn(async () => ({ text: '{}', inputTokens: 1, outputTokens: 1, usageKnown: true }));
    const runner = new CallRunner(store, () => 'test-only', () => ({ complete }));
    await runner.withReservation('预留生成与核验', 0.08, async reservationId => {
      vi.setSystemTime(new Date('2026-10-01T00:00:01.000Z'));
      store.updateSettings({ monthlyBudgetCny: 0.005 });
      await expect(runner.run('核验', {}, { reservationId, maxOutputTokens: 6000 })).rejects.toThrow(/预算/);
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('uses portable IDs for the exact incident migration and can immediately write a full backup', () => {
    const incident = KNOWN_INCIDENT, task = incident.tasks[0];
    store.put('projects', { id: incident.projectId, title: '定点测试', goal: '验证便携备份', status: 'active', createdAt: first, updatedAt: first });
    store.put('capabilities', { id: incident.capabilityId, projectId: incident.projectId, title: '定点能力', description: '', sourceIds: [], prerequisites: [], order: 0 });
    const activity: Activity = { id: task.taskId, title: '原任务', instruction: '保留题目', rubric: ['说明理由'], kind: 'application', sourceIds: [], assessmentBasis: 'ai' };
    store.put('sessions', { id: incident.sessionId, projectId: incident.projectId, capabilityId: incident.capabilityId, activity, mode: 'practice', status: 'active', createdAt: first, updatedAt: first, draft: '', helpLevel: 0, helpEvents: [], messages: [], checkpoint: '', nextStep: '' });
    applyKnownIncidentCorrections(store);
    const archive = join(directory, 'incident.reclimb'); expect(() => writeBackup(store, archive)).not.toThrow();
    expect(readBackup(archive).records.teachingVersions[0].origin).toBe('legacy');
  });
});
