import type { Evidence, Review, WorkspaceSnapshot } from './types';
import type { AnswerExposure } from './reliability';
/** Unassigned source discussions can reveal a later unit's answer within this project. */
export function exposureCandidates(
  exposures: AnswerExposure[],
  projectId: string,
  capabilityId: string,
): AnswerExposure[] {
  return exposures.filter(
    (exposure) =>
      exposure.projectId === projectId &&
      (exposure.capabilityId === capabilityId ||
        (!exposure.teachingVersionId && exposure.taskId.startsWith('source-followup-'))),
  );
}
type Records = Pick<
  WorkspaceSnapshot,
  'teachingVersions' | 'taskReviews' | 'disputes' | 'corrections' | 'evidence'
>;
export interface Standing {
  effective: boolean;
  reason?: string;
}
export function derivesFromDispute(snapshot: Records, versionId: string): boolean {
  const seen = new Set<string>();
  let current: string | undefined = versionId;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (
      snapshot.disputes.some((d) => d.replacementVersionId === current) ||
      snapshot.corrections.some(
        (c) => c.disputeId && c.action === 'replace' && c.replacementVersionId === current,
      )
    )
      return true;
    current = snapshot.teachingVersions.find((v) => v.id === current)?.replacesVersionId;
  }
  return false;
}
export function versionStanding(snapshot: Records, versionId: string): Standing {
  const version = snapshot.teachingVersions.find((v) => v.id === versionId);
  if (!version) return { effective: false, reason: '核验版本不存在' };
  const correction = snapshot.corrections
    .filter((c) => c.teachingVersionId === versionId && !c.evidenceId)
    .at(-1);
  if (correction && correction.action !== 'restore')
    return { effective: false, reason: correction.reason };
  if (snapshot.disputes.some((d) => d.teachingVersionId === versionId && d.status !== 'resolved'))
    return { effective: false, reason: '这道题的质疑尚未解决' };
  const review = snapshot.taskReviews.filter((r) => r.teachingVersionId === versionId).at(-1);
  if (!review || review.contentHash !== version.contentHash || review.status !== 'ready')
    return { effective: false, reason: '这道题尚未通过独立核验' };
  return { effective: true };
}
function versionForTask(
  snapshot: Records,
  projectId: string,
  taskId?: string,
  explicit?: string,
): string | undefined {
  return (
    explicit ??
    (taskId
      ? snapshot.teachingVersions
          .filter((v) => v.projectId === projectId && v.taskId === taskId)
          .at(-1)?.id
      : undefined)
  );
}
export function evidenceStanding(snapshot: Records, evidence: Evidence): Standing {
  const correction = snapshot.corrections.filter((c) => c.evidenceId === evidence.id).at(-1);
  if (correction && correction.action !== 'restore')
    return { effective: false, reason: correction.reason };
  const versionId = versionForTask(
    snapshot,
    evidence.projectId,
    evidence.taskId ?? evidence.activitySnapshot?.id,
    evidence.teachingVersionId ?? evidence.activitySnapshot?.teachingVersionId,
  );
  const replaced = versionId
    ? snapshot.corrections.find(
        (c) =>
          c.teachingVersionId === versionId &&
          !c.evidenceId &&
          (c.action === 'invalidate' || c.action === 'replace'),
      )
    : undefined;
  if (replaced) return { effective: false, reason: replaced.reason };
  return versionId ? versionStanding(snapshot, versionId) : { effective: true };
}
export function reviewStanding(snapshot: Records, review: Review): Standing {
  if (review.schedule?.lastEvidenceId) {
    const basis = snapshot.evidence.find((e) => e.id === review.schedule!.lastEvidenceId);
    if (
      !basis ||
      basis.projectId !== review.projectId ||
      basis.capabilityId !== review.capabilityId
    )
      return { effective: false, reason: '这次排程所依据的表现记录不存在或不属于当前能力' };
    const state = evidenceStanding(snapshot, basis);
    if (!state.effective)
      return { effective: false, reason: '这次排程依赖的原表现已暂停或失效：' + state.reason };
  }
  const versionId = versionForTask(
    snapshot,
    review.projectId,
    review.fromTaskId ?? review.fromActivity?.id,
    review.fromActivity?.teachingVersionId,
  );
  if (versionId) {
    const state = versionStanding(snapshot, versionId);
    if (!state.effective) return state;
  }
  const origin = snapshot.evidence.filter(
    (e) =>
      e.sessionId === review.fromSessionId &&
      e.projectId === review.projectId &&
      e.capabilityId === review.capabilityId &&
      (!review.fromTaskId || e.taskId === review.fromTaskId) &&
      e.status !== 'needs_review',
  );
  if (origin.length && !origin.some((e) => evidenceStanding(snapshot, e).effective))
    return { effective: false, reason: '这次回访依赖的原表现已暂停或失效' };
  return { effective: true };
}

/** Machine conclusions remain applicable only while their recorded bases are effective. */
export function derivedStanding(
  snapshot: Records,
  derived: { basedOnEvidenceIds?: string[]; basedOnTeachingVersionIds?: string[] },
): Standing {
  for (const id of derived.basedOnEvidenceIds ?? []) {
    const evidence = snapshot.evidence.find((item) => item.id === id);
    if (!evidence) return { effective: false, reason: '原建议依赖的表现记录不存在' };
    const standing = evidenceStanding(snapshot, evidence);
    if (!standing.effective) return standing;
  }
  for (const id of derived.basedOnTeachingVersionIds ?? []) {
    const standing = versionStanding(snapshot, id);
    if (!standing.effective) return standing;
  }
  return { effective: true };
}
