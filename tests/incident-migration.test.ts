import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningStore, COLLECTIONS } from '../src/main/store';
import { applyKnownIncidentCorrections, KNOWN_INCIDENT } from '../src/main/incident-migration';
import { teachingContentHash } from '../src/main/verification-service';
import type { Activity, Session } from '../src/shared/types';

let directory: string;
let store: LearningStore;
const date = '2026-09-08T01:00:00.000Z';
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'reclimb-incident-')); store = await LearningStore.open(directory); });
afterEach(async () => { store?.close(); await rm(directory, { recursive: true, force: true }); });

function seed() {
  const { projectId, sessionId, capabilityId, tasks } = KNOWN_INCIDENT;
  const activities: Activity[] = tasks.map((task, index) => ({ id: task.taskId, title: `测试任务 ${index}`, instruction: `用于验证版本关联的原创题设 ${index}`, kind: 'application', rubric: ['说明理由'], sourceIds: [], assessmentBasis: 'ai' }));
  const steps = activities.map(activity => ({ id: `step-${activity.id}`, taskId: activity.id!, action: 'check' as const, title: activity.title, content: activity.instruction, activity, sourceIds: [], createdAt: date }));
  const session: Session = { id: sessionId, projectId, capabilityId, activity: activities[0], mode: 'practice', status: 'active', createdAt: date, updatedAt: date, draft: '保留用户草稿', helpLevel: 1, helpEvents: [], messages: [], checkpoint: '检查点', nextStep: '待继续', teaching: { version: 1, guidance: 'guided', confusionCount: 0, current: steps[0], history: steps.slice(1), upcoming: [] } };
  store.transaction(() => {
    store.put('projects', { id: projectId, title: '定点迁移测试', goal: '核对旧记录', status: 'active', createdAt: date, updatedAt: date });
    store.put('capabilities', { id: capabilityId, projectId, title: '数学', description: '测试关联', sourceIds: [], prerequisites: [], order: 0 });
    store.put('sessions', session);
    tasks.forEach((task, index) => task.evidenceIds.forEach((id, item) => {
      const attemptId = `attempt-${id}`, assessment = { outcome: 'met' as const, feedback: '原评价原样保留', criteria: [{ criterion: '说明理由', result: 'met' as const, reason: '旧理由' }], limitations: [], sourceIds: [] };
      store.put('attempts', { id: attemptId, requestId: attemptId, projectId, sessionId, text: `原作答 ${index}-${item}`, submittedAt: date, helpLevel: 0, mode: 'practice', taskId: task.taskId, activitySnapshot: activities[index], assessment });
      store.put('evidence', { id, projectId, sessionId, capabilityId, attemptId, taskId: task.taskId, activitySnapshot: activities[index], status: task.taskId === KNOWN_INCIDENT.exposedTaskId ? 'independent' : 'needs_review', helpLevel: 0, assessment, createdAt: date });
    }));
    store.put('reviews', { id: 'old-return', projectId, capabilityId, fromSessionId: sessionId, fromTaskId: KNOWN_INCIDENT.exposedTaskId, kind: 'delayed', dueAt: '2026-09-09T01:00:00.000Z', status: 'pending', fromActivity: activities.find(activity => activity.id === KNOWN_INCIDENT.exposedTaskId) });
  });
}

describe('exact known-incident append-only migration', () => {
  it('freezes three legacy tasks, invalidates six exact evaluations, and records exposure without modifying any old collection', () => {
    seed();
    const before = Object.fromEntries(COLLECTIONS.map(name => [name, store.list(name)]));
    const report = applyKnownIncidentCorrections(store);
    expect(report).toMatchObject({ versionsCreated: 3, correctionsCreated: 9, exposuresCreated: 1, skipped: [] });
    for (const name of COLLECTIONS.filter(name => !['teachingVersions', 'corrections', 'answerExposures'].includes(name))) expect(store.list(name)).toEqual(before[name]);
    const versions = store.list('teachingVersions');
    expect(versions.every(version => version.origin === 'legacy' && teachingContentHash(version) === version.contentHash)).toBe(true);
    expect(store.list('corrections').filter(correction => correction.action === 'invalidate').map(correction => correction.evidenceId).sort()).toEqual(KNOWN_INCIDENT.tasks.flatMap(task => [...task.evidenceIds]).sort());
    expect(store.list('corrections').filter(correction => correction.action === 'suspend')).toHaveLength(3);
    expect(store.get('reviews', 'old-return')?.status).toBe('pending');
    expect(store.list('answerExposures')[0]).toMatchObject({ taskId: KNOWN_INCIDENT.zeroMapTaskId, kind: 'feedback', projectId: KNOWN_INCIDENT.projectId, createdAt: date });
  });

  it('is idempotent across reopening an independently copied database and preserves the source database', async () => {
    seed();
    const original = Object.fromEntries(COLLECTIONS.map(name => [name, store.list(name)]));
    store.close();
    const copied = join(directory, 'copy'); await mkdir(copied); await copyFile(join(directory, 'learning.sqlite'), join(copied, 'learning.sqlite'));
    store = await LearningStore.open(copied);
    applyKnownIncidentCorrections(store);
    const migrated = Object.fromEntries(COLLECTIONS.map(name => [name, store.list(name)]));
    store.close(); store = await LearningStore.open(copied);
    expect(applyKnownIncidentCorrections(store)).toMatchObject({ versionsCreated: 0, correctionsCreated: 0, exposuresCreated: 0 });
    expect(Object.fromEntries(COLLECTIONS.map(name => [name, store.list(name)]))).toEqual(migrated);
    const source = await LearningStore.open(directory);
    try { expect(Object.fromEntries(COLLECTIONS.map(name => [name, source.list(name)]))).toEqual(original); } finally { source.close(); }
  });

  it('does not judge unrelated tasks by their content or migrate foreign project and session associations', () => {
    seed();
    const foreign = { ...store.get('sessions', KNOWN_INCIDENT.sessionId)!, projectId: 'other-project' };
    store.put('sessions', foreign);
    expect(applyKnownIncidentCorrections(store)).toMatchObject({ versionsCreated: 0, correctionsCreated: 0, exposuresCreated: 0 });
    expect(store.list('corrections')).toEqual([]);
  });

  it('does not invalidate a matching evidence ID when its task or attempt binding differs', () => {
    seed();
    const evidenceId = KNOWN_INCIDENT.tasks[0].evidenceIds[0];
    const evidence = store.get('evidence', evidenceId)!;
    store.put('attempts', { ...store.get('attempts', evidence.attemptId)!, taskId: 'unrelated-task' });
    const report = applyKnownIncidentCorrections(store);
    expect(report.skipped.some(item => item.includes(evidenceId))).toBe(true);
    expect(store.list('corrections').some(correction => correction.evidenceId === evidenceId)).toBe(false);
    expect(store.get('evidence', evidenceId)).toEqual(evidence);
  });

  it('uses a previously frozen matching legacy version without creating another or rewriting it', () => {
    seed(); applyKnownIncidentCorrections(store);
    const versions = store.list('teachingVersions');
    expect(applyKnownIncidentCorrections(store).versionsCreated).toBe(0);
    expect(store.list('teachingVersions')).toEqual(versions);
  });

  it('does nothing in an unrelated installation', () => {
    expect(applyKnownIncidentCorrections(store)).toMatchObject({ versionsCreated: 0, correctionsCreated: 0, exposuresCreated: 0 });
    expect(store.list('teachingVersions')).toEqual([]);
  });
});
