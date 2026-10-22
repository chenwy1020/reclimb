import type { Review, WorkspaceSnapshot } from './types';
import { evidenceStanding, reviewStanding } from './reliability-state';

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 30, 90] as const;
export const REVIEW_MINUTES = 4;

/** Round-robin capabilities, retaining chronological order inside each capability. */
export function interleaveReviews(reviews: Review[]): Review[] {
  const groups = new Map<string, Review[]>();
  for (const review of [...reviews].sort(
    (a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id),
  )) {
    const key = review.projectId + ':' + review.capabilityId;
    const group = groups.get(key) ?? [];
    group.push(review);
    groups.set(key, group);
  }
  const result: Review[] = [];
  for (let index = 0; ; index++) {
    const next = [...groups.values()].flatMap((group) => (group[index] ? [group[index]] : []));
    if (!next.length) return result;
    result.push(...next);
  }
}

export function reviewQueue(
  snapshot: WorkspaceSnapshot,
  now = Date.now(),
  dueOnly = false,
): Review[] {
  const active = new Set(
    snapshot.projects.filter((p) => !p.trashedAt && p.status === 'active').map((p) => p.id),
  );
  return interleaveReviews(
    snapshot.reviews.filter((review) => {
      const capability = snapshot.capabilities.find(
        (c) => c.id === review.capabilityId && c.projectId === review.projectId,
      );
      const origin = snapshot.sessions.find(
        (s) =>
          s.id === review.fromSessionId &&
          s.projectId === review.projectId &&
          s.capabilityId === review.capabilityId,
      );
      const due = Date.parse(review.dueAt);
      return (
        active.has(review.projectId) &&
        !!capability &&
        !capability.archived &&
        !!origin &&
        review.status !== 'done' &&
        Number.isFinite(due) &&
        (!dueOnly || due <= now) &&
        reviewStanding(snapshot, review).effective
      );
    }),
  );
}

/** A completed independent return is on time only on its locally scheduled calendar day. */
export function weeklyOnTimeReviewCount(snapshot: WorkspaceSnapshot, now = Date.now()): number {
  const week = new Date(now);
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  const visible = new Set(snapshot.projects.filter((p) => !p.trashedAt).map((p) => p.id));
  const counted = new Set<string>();
  for (const review of snapshot.reviews) {
    if (
      review.status !== 'done' ||
      !visible.has(review.projectId) ||
      !reviewStanding(snapshot, review).effective
    )
      continue;
    const evidence = snapshot.evidence.find(
      (e) =>
        e.id === review.completedEvidenceId ||
        (!review.completedEvidenceId &&
          e.sessionId === review.completedSessionId &&
          e.reviewId === review.id &&
          e.status === review.kind),
    );
    if (
      !evidence ||
      evidence.helpLevel !== 0 ||
      evidence.status !== review.kind ||
      !evidenceStanding(snapshot, evidence).effective
    )
      continue;
    const attempt = snapshot.attempts.find((a) => a.id === evidence.attemptId);
    const submitted = Date.parse(attempt?.submittedAt ?? evidence.createdAt);
    const due = Date.parse(review.dueAt);
    const end = new Date(due);
    end.setHours(24, 0, 0, 0);
    if (
      submitted >= week.getTime() &&
      submitted <= now &&
      submitted >= due &&
      submitted < end.getTime()
    )
      counted.add(evidence.id);
  }
  return counted.size;
}

export function dueReviewSummary(snapshot: WorkspaceSnapshot, now = Date.now()) {
  const reviews = reviewQueue(snapshot, now, true);
  return {
    reviews,
    count: reviews.length,
    estimatedMinutes: reviews.length * REVIEW_MINUTES,
    weeklyOnTimeIndependent: weeklyOnTimeReviewCount(snapshot, now),
  };
}
