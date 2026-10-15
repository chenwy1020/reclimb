import { randomUUID } from 'node:crypto';
import type { Evidence, Review, WorkspaceSnapshot } from '../shared/types';
import { evidenceStanding } from '../shared/reliability-state';
import { reviewQueue, REVIEW_INTERVAL_DAYS } from '../shared/review-schedule';
import type { LearningStore } from './store';

const DAY = 24 * 60 * 60 * 1000;
const independent = (evidence: Evidence) =>
  evidence.helpLevel === 0 && ['independent', 'delayed', 'transfer'].includes(evidence.status);

function activeCapability(snapshot: WorkspaceSnapshot, evidence: Evidence): boolean {
  const project = snapshot.projects.find((p) => p.id === evidence.projectId);
  const capability = snapshot.capabilities.find((c) => c.id === evidence.capabilityId);
  return (
    !!project &&
    !project.trashedAt &&
    project.status === 'active' &&
    !!capability &&
    capability.projectId === project.id &&
    !capability.archived &&
    evidenceStanding(snapshot, evidence).effective
  );
}

function scheduleFrom(review: Review): NonNullable<Review['schedule']> {
  return (
    review.schedule ?? {
      version: 1,
      step: review.kind === 'transfer' ? 2 : 0,
      intervalDays: review.kind === 'transfer' ? 7 : 1,
    }
  );
}

function nextReview(evidence: Evidence, step: number, previousReviewId?: string): Review {
  const intervalDays = REVIEW_INTERVAL_DAYS[step];
  const review: Review = {
    id: randomUUID(),
    projectId: evidence.projectId,
    capabilityId: evidence.capabilityId,
    fromSessionId: evidence.sessionId,
    kind: step === 2 || step === 4 ? 'transfer' : 'delayed',
    dueAt: new Date(Date.parse(evidence.createdAt) + intervalDays * DAY).toISOString(),
    status: 'pending',
    ...(evidence.activitySnapshot ? { fromActivity: evidence.activitySnapshot } : {}),
    ...(evidence.taskId ? { fromTaskId: evidence.taskId } : {}),
    schedule: {
      version: 1,
      step,
      intervalDays,
      lastEvidenceId: evidence.id,
      ...(previousReviewId ? { previousReviewId } : {}),
    },
  };
  return review;
}

/** Call in the same transaction as assessment persistence; no models or network. */
export function scheduleAfterAssessment(
  store: LearningStore,
  evidence: Evidence,
  linked?: Review,
  validReturn = false,
): void {
  const snapshot = store.snapshot({ includeHandwriting: false });
  if (!activeCapability(snapshot, evidence)) return;
  const queue = reviewQueue(snapshot).filter((r) => r.capabilityId === evidence.capabilityId);
  if (linked) {
    if (!validReturn) return;
    const schedule = scheduleFrom(linked);
    if (evidence.status === linked.kind && independent(evidence)) {
      // Keep old optional invitations intact, but never fork a second continuous chain.
      const continuing = queue.find((r) => r.id !== linked.id);
      if (continuing) return;
      store.put(
        'reviews',
        nextReview(
          evidence,
          Math.min(schedule.step + 1, REVIEW_INTERVAL_DAYS.length - 1),
          linked.id,
        ),
      );
      return;
    }
    const assisted = evidence.status === 'assisted';
    const failed =
      evidence.assessment.outcome !== 'uncertain' &&
      (evidence.assessment.outcome === 'partial' ||
        evidence.assessment.outcome === 'not_yet' ||
        evidence.assessment.criteria.some((c) => c.result === 'partial' || c.result === 'not_yet'));
    if (!assisted && !failed) return;
    const intervalDays = assisted ? schedule.intervalDays : 1;
    store.put('reviews', {
      ...linked,
      status: 'pending',
      dueAt: new Date(Date.parse(evidence.createdAt) + intervalDays * DAY).toISOString(),
      schedule: {
        ...schedule,
        step: assisted ? schedule.step : 0,
        intervalDays,
        lastEvidenceId: evidence.id,
        needsRelearning: failed,
      },
    });
    return;
  }
  if (!queue.length && (independent(evidence) || evidence.status === 'assisted'))
    store.put('reviews', nextReview(evidence, 0));
}

/** Backfill only missing queues; old evidence and existing due dates are never rewritten. */
export function reconcileReviewSchedule(store: LearningStore): number {
  const snapshot = store.snapshot({ includeHandwriting: false });
  const changes: Review[] = [];
  const queues = new Map<string, Review[]>();
  for (const review of reviewQueue(snapshot)) {
    const queue = queues.get(review.capabilityId) ?? [];
    queue.push(review);
    queues.set(review.capabilityId, queue);
  }
  const latest = new Map<string, Evidence>();
  for (const evidence of [...snapshot.evidence].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    if (independent(evidence) && activeCapability(snapshot, evidence))
      latest.set(evidence.capabilityId, evidence);
  }
  for (const evidence of latest.values()) {
    const queue = queues.get(evidence.capabilityId) ?? [];
    if (queue.length) {
      if (!queue.some((r) => r.schedule)) {
        changes.push({ ...queue[0], schedule: scheduleFrom(queue[0]) });
      }
      continue;
    }
    const previous = snapshot.reviews.find((r) => r.completedEvidenceId === evidence.id);
    const step = previous
      ? Math.min(scheduleFrom(previous).step + 1, 4)
      : evidence.status === 'transfer'
        ? 3
        : evidence.status === 'delayed'
          ? 1
          : 0;
    changes.push(nextReview(evidence, step, previous?.id));
  }
  if (changes.length)
    store.transaction(() => {
      for (const review of changes) store.put('reviews', review);
    });
  return changes.length;
}
