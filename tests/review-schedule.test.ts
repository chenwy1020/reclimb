import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningStore } from '../src/main/store';
import { finishAssessment } from '../src/main/evidence';
import { reconcileReviewSchedule } from '../src/main/review-scheduler';
import {
  dueReviewSummary,
  reviewQueue,
  weeklyOnTimeReviewCount,
} from '../src/shared/review-schedule';
import { readBackup, writeBackup } from '../src/main/backup';
import AdmZip from 'adm-zip';
import type { Assessment, Review, Session } from '../src/shared/types';

const opened: LearningStore[] = [];
const start = '2026-09-07T00:00:00.000Z';
const good: Assessment = {
  outcome: 'met',
  feedback: '说明清楚',
  criteria: [{ criterion: '解释理由', result: 'met', reason: '给出了理由' }],
  limitations: [],
  sourceIds: ['f'],
};
async function fixture() {
  const store = await LearningStore.open(mkdtempSync(join(tmpdir(), 'reclimb-schedule-')));
  opened.push(store);
  store.transaction(() => {
    store.put('projects', {
      id: 'p',
      title: '项目',
      goal: '独立应用',
      status: 'active',
      createdAt: start,
      updatedAt: start,
    });
    store.put('materials', {
      id: 'm',
      projectId: 'p',
      title: '材料',
      kind: 'text',
      originalName: '材料',
      storedPath: '',
      importedAt: start,
      warnings: [],
      fragmentCount: 1,
      summary: '',
    });
    store.put('fragments', {
      id: 'f',
      projectId: 'p',
      materialId: 'm',
      locator: '第 1 段',
      text: '归纳与迁移',
      ordinal: 0,
    });
    store.put('capabilities', {
      id: 'c',
      projectId: 'p',
      title: '能力',
      description: '',
      prerequisites: [],
      sourceIds: ['f'],
      order: 0,
    });
    submit(store, 'first', start);
  });
  return store;
}
function submit(
  store: LearningStore,
  id: string,
  at: string,
  review?: Review,
  helpLevel = 0,
  assessment = good,
) {
  const activity: Session['activity'] = {
    title: '解释',
    instruction: '新情境中说明概念的原因 ' + id,
    kind: 'argument',
    rubric: ['解释理由'],
    sourceIds: ['f'],
    assessmentBasis: 'source',
    ...(review?.kind === 'transfer'
      ? {
          transferCheck: {
            verdict: 'valid' as const,
            changedSituation: '有干扰信息的实际判断',
            sharedPrinciple: '概念的适用条件',
            requiredAdaptation: '重新选择条件',
            reason: '需要重新建模',
          },
        }
      : {}),
  };
  store.put('sessions', {
    id,
    projectId: 'p',
    capabilityId: 'c',
    activity,
    mode: review?.kind ?? 'practice',
    status: 'active',
    createdAt: at,
    updatedAt: at,
    draft: '',
    helpLevel,
    helpEvents: [],
    messages: [],
    checkpoint: '',
    nextStep: '',
    ...(review ? { dueReviewId: review.id } : {}),
  });
  store.put('attempts', {
    id: 'a-' + id,
    projectId: 'p',
    sessionId: id,
    text: '我的回答',
    submittedAt: at,
    helpLevel,
    requestId: 'r-' + id,
  });
  return finishAssessment(store, 'a-' + id, assessment, at);
}
const pending = (store: LearningStore) => store.list('reviews').filter((r) => r.status !== 'done');
afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

describe('continuous short returns', () => {
  it('keeps one next return and lengthens successful independent intervals through ninety days', async () => {
    const store = await fixture();
    expect(pending(store)).toHaveLength(1);
    const first = pending(store)[0];
    expect(first.dueAt).toBe('2026-09-08T00:00:00.000Z');
    submit(store, 'day1', first.dueAt, first);
    expect(pending(store)).toHaveLength(1);
    expect(pending(store)[0].dueAt).toBe('2026-09-11T00:00:00.000Z');
    const next = pending(store)[0];
    submit(store, 'day4', next.dueAt, next);
    expect(pending(store)[0].dueAt).toBe('2026-09-18T00:00:00.000Z');
    const transfer = pending(store)[0];
    expect(transfer.kind).toBe('transfer');
    submit(store, 'day11', transfer.dueAt, transfer);
    expect(pending(store)[0].dueAt).toBe('2026-10-18T00:00:00.000Z');
    const month = pending(store)[0];
    submit(store, 'day41', month.dueAt, month);
    expect(pending(store)[0].dueAt).toBe('2027-01-16T00:00:00.000Z');
    expect(store.list('reviews').filter((r) => r.status === 'done')).toHaveLength(4);
  });

  it('keeps assisted work out of completion while rescheduling at the same interval', async () => {
    const store = await fixture();
    const first = pending(store)[0];
    submit(store, 'day1', first.dueAt, first);
    const due = pending(store)[0];
    expect(due.dueAt).toBe('2026-09-11T00:00:00.000Z');
    const assisted = submit(store, 'helped', due.dueAt, due, 2);
    expect(assisted.status).toBe('assisted');
    expect(pending(store)).toHaveLength(1);
    expect(store.get('reviews', due.id)?.dueAt).toBe('2026-09-14T00:00:00.000Z');
    expect(store.get('reviews', due.id)?.completedEvidenceId).toBeUndefined();
  });

  it('brings a failed return back within forty-eight hours and records a relearning need', async () => {
    const store = await fixture();
    const first = pending(store)[0];
    submit(store, 'day1', first.dueAt, first);
    const due = pending(store)[0];
    submit(store, 'failed', due.dueAt, due, 0, {
      ...good,
      outcome: 'not_yet',
      criteria: [{ ...good.criteria[0], result: 'not_yet' }],
    });
    expect(store.get('reviews', due.id)?.dueAt).toBe('2026-09-12T00:00:00.000Z');
    expect(store.get('reviews', due.id)?.schedule?.needsRelearning).toBe(true);
    expect(pending(store)).toHaveLength(1);
    const count = store.list('reviews').length;
    finishAssessment(store, 'a-failed', good, '2026-09-13T00:00:00.000Z');
    expect(store.list('reviews')).toHaveLength(count);
    expect(store.get('reviews', due.id)?.dueAt).toBe('2026-09-12T00:00:00.000Z');
  });

  it('treats a definite failed criterion as a failed return even when the overall label says met', async () => {
    const store = await fixture();
    const first = pending(store)[0];
    submit(store, 'day1', first.dueAt, first);
    const due = pending(store)[0];
    submit(store, 'criterion-failed', due.dueAt, due, 0, {
      ...good,
      criteria: [{ ...good.criteria[0], result: 'not_yet' }],
    });
    expect(store.get('reviews', due.id)?.dueAt).toBe('2026-09-12T00:00:00.000Z');
    expect(store.get('reviews', due.id)?.schedule?.needsRelearning).toBe(true);
  });

  it('keeps uncertain grading from changing a due date or declaring a relearning need', async () => {
    const store = await fixture();
    const due = pending(store)[0];
    const before = store.get('reviews', due.id);
    submit(store, 'uncertain', due.dueAt, due, 0, {
      ...good,
      outcome: 'uncertain',
      criteria: [{ ...good.criteria[0], result: 'uncertain' }],
    });
    expect(store.get('reviews', due.id)).toEqual(before);
  });
});

describe('old archives and safe schedule backfill', () => {
  it('suspends the exact failed assessment basis after withdrawal and rebuilds from valid history', async () => {
    const store = await fixture();
    const due = pending(store)[0];
    const failed = submit(store, 'withdrawn-failure', due.dueAt, due, 0, {
      ...good, outcome: 'not_yet', criteria: [{ ...good.criteria[0], result: 'not_yet' }],
    });
    expect(reviewQueue(store.snapshot())[0].schedule?.needsRelearning).toBe(true);
    store.put('corrections', { id: 'withdraw-failure', projectId: 'p', teachingVersionId: 'legacy-version', evidenceId: failed.id, action: 'invalidate', reason: '评分错误', createdAt: '2026-09-09T00:00:00.000Z' });
    expect(reviewQueue(store.snapshot())).toHaveLength(0);
    expect(reconcileReviewSchedule(store)).toBe(1);
    const queue = reviewQueue(store.snapshot());
    expect(queue).toHaveLength(1);
    expect(queue[0].schedule?.needsRelearning).toBeUndefined();
    expect(queue[0].schedule?.lastEvidenceId).toBe(store.list('evidence')[0].id);
  });
  it('does not let another valid result in the same session substitute for a withdrawn schedule basis', async () => {
    const store = await fixture();
    const basis = store.list('evidence')[0];
    store.put('evidence', { ...basis, id: 'other-valid-result', attemptId: 'other-attempt' });
    store.put('corrections', { id: 'withdraw-exact-basis', projectId: 'p', teachingVersionId: 'legacy-version', evidenceId: basis.id, action: 'invalidate', reason: '此判断撤回', createdAt: '2026-09-09T00:00:00.000Z' });
    expect(reviewQueue(store.snapshot())).toHaveLength(0);
  });
  it('does no write transaction and reads one lightweight snapshot when all queues already exist', async () => {
    const store = await fixture();
    const snapshots = vi.spyOn(store, 'snapshot');
    const transactions = vi.spyOn(store, 'transaction');
    expect(reconcileReviewSchedule(store)).toBe(0);
    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveBeenCalledWith({ includeHandwriting: false });
    expect(transactions).not.toHaveBeenCalled();
    snapshots.mockRestore();
    transactions.mockRestore();
  });
  it('preserves both legacy invitations and their due dates without forking recurring chains', async () => {
    const store = await fixture();
    const first = pending(store)[0];
    store.put('reviews', { ...first, schedule: undefined });
    const transfer: Review = {
      ...first,
      id: 'old-transfer',
      kind: 'transfer',
      dueAt: '2026-09-14T00:00:00.000Z',
      schedule: undefined,
    };
    store.put('reviews', transfer);
    expect(reconcileReviewSchedule(store)).toBe(1);
    expect(reconcileReviewSchedule(store)).toBe(0);
    expect(
      pending(store)
        .map((r) => r.dueAt)
        .sort(),
    ).toEqual(['2026-09-08T00:00:00.000Z', '2026-09-14T00:00:00.000Z']);
    submit(store, 'legacy-day1', first.dueAt, store.get('reviews', first.id));
    expect(pending(store)).toHaveLength(1);
    expect(pending(store)[0].id).toBe('old-transfer');
    submit(store, 'legacy-transfer', transfer.dueAt, transfer);
    expect(pending(store)).toHaveLength(1);
    expect(pending(store)[0].dueAt).toBe('2026-10-14T00:00:00.000Z');
  });

  it('fills a missing queue once from valid independent history without rewriting history', async () => {
    const store = await fixture();
    const initial = pending(store)[0];
    store.remove('reviews', initial.id);
    const before = JSON.stringify(store.list('evidence'));
    expect(reconcileReviewSchedule(store)).toBe(1);
    expect(reconcileReviewSchedule(store)).toBe(0);
    expect(pending(store)).toHaveLength(1);
    expect(pending(store)[0].dueAt).toBe('2026-09-08T00:00:00.000Z');
    expect(JSON.stringify(store.list('evidence'))).toBe(before);
  });

  it('does not revive invalidated evidence or queue trashed, paused, or archived work', async () => {
    const store = await fixture();
    const first = pending(store)[0];
    const evidence = store.list('evidence')[0];
    store.put('corrections', {
      id: 'withdraw',
      projectId: 'p',
      teachingVersionId: 'legacy-version',
      evidenceId: evidence.id,
      action: 'invalidate',
      reason: '原判断撤回',
      createdAt: '2026-09-08T00:00:00.000Z',
    });
    expect(reviewQueue(store.snapshot())).toHaveLength(0);
    expect(reconcileReviewSchedule(store)).toBe(0);
    store.remove('reviews', first.id);
    expect(reconcileReviewSchedule(store)).toBe(0);
    const project = store.get('projects', 'p')!;
    store.put('projects', { ...project, trashedAt: '2026-09-08T00:00:00.000Z' });
    submit(store, 'after-trash', '2026-09-09T00:00:00.000Z');
    expect(pending(store)).toHaveLength(0);
    expect(reconcileReviewSchedule(store)).toBe(0);
    store.put('projects', { ...project, status: 'paused' });
    expect(reconcileReviewSchedule(store)).toBe(0);
    store.put('projects', project);
    store.put('capabilities', { ...store.get('capabilities', 'c')!, archived: true });
    expect(reconcileReviewSchedule(store)).toBe(0);
  });

  it('round-trips schedule state and rejects a foreign evidence reference in a backup', async () => {
    const store = await fixture();
    const storedPath = join(store.dataDirectory, 'material.txt');
    writeFileSync(storedPath, '归纳与迁移');
    store.put('materials', {
      ...store.get('materials', 'm')!,
      storedPath,
      originalName: 'material.txt',
    });
    const file = join(store.dataDirectory, 'schedule.reclimb');
    writeBackup(store, file);
    expect(readBackup(file).records.reviews[0].schedule).toEqual(pending(store)[0].schedule);
    const zip = new AdmZip(file);
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    manifest.records.reviews[0].schedule.lastEvidenceId = 'does-not-exist';
    zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    zip.writeZip(file);
    expect(() => readBackup(file)).toThrow();
  });
});

describe('local review workload and weekly outcome', () => {
  it('interleaves due capabilities, excludes future and unavailable work, and estimates short task time', async () => {
    const store = await fixture();
    const first = pending(store)[0];
    store.put('reviews', { ...first, id: 'same-capability', dueAt: '2026-09-08T01:00:00.000Z' });
    store.put('capabilities', { ...store.get('capabilities', 'c')!, id: 'other' });
    store.put('sessions', {
      ...store.get('sessions', 'first')!,
      id: 'other-session',
      capabilityId: 'other',
    });
    store.put('reviews', {
      ...first,
      id: 'other-review',
      capabilityId: 'other',
      fromSessionId: 'other-session',
      schedule: undefined,
      dueAt: '2026-09-08T02:00:00.000Z',
    });
    store.put('reviews', { ...first, id: 'tomorrow', dueAt: '2026-09-10T00:00:00.000Z' });
    const summary = dueReviewSummary(store.snapshot(), Date.parse('2026-09-09T00:00:00.000Z'));
    expect(summary.reviews.map((r) => r.id)).toEqual([first.id, 'other-review', 'same-capability']);
    expect(summary.count).toBe(3);
    expect(summary.estimatedMinutes).toBe(12);
  });

  it('counts completed independent returns on their due day once in the current local week', async () => {
    const store = await fixture();
    const first = pending(store)[0];
    submit(store, 'on-time', first.dueAt, first);
    const now = Date.parse('2026-09-09T12:00:00.000Z');
    expect(weeklyOnTimeReviewCount(store.snapshot(), now)).toBe(1);
    const later = pending(store)[0];
    submit(store, 'late', '2026-09-12T00:00:00.000Z', later);
    expect(weeklyOnTimeReviewCount(store.snapshot(), Date.parse('2026-09-12T12:00:00.000Z'))).toBe(
      1,
    );
    expect(weeklyOnTimeReviewCount(store.snapshot(), Date.parse('2026-09-15T12:00:00.000Z'))).toBe(
      0,
    );
    const evidence = store.get('reviews', first.id)!.completedEvidenceId!;
    store.put('corrections', {
      id: 'withdraw-on-time',
      projectId: 'p',
      teachingVersionId: 'legacy-version',
      evidenceId: evidence,
      action: 'invalidate',
      reason: '判断撤回',
      createdAt: '2026-09-09T00:00:00.000Z',
    });
    expect(weeklyOnTimeReviewCount(store.snapshot(), now)).toBe(0);
  });
});
