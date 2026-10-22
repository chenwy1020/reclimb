import type { FollowupTarget, Session, SessionMessage, WorkspaceSnapshot } from '../shared/types';
export type VisibleAnchor = Omit<FollowupTarget, 'intent'>;
function sameAnchor(a: VisibleAnchor, b: VisibleAnchor) {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    (a.kind !== 'step' ||
      (a.teachingVersionId === b.teachingVersionId &&
        (a.historyIndex === undefined ||
          b.historyIndex === undefined ||
          a.historyIndex === b.historyIndex)))
  );
}
export function followupsForAnchor(session: Session, anchor: VisibleAnchor): SessionMessage[] {
  const roots = new Set(
    session.messages
      .filter(
        (m) =>
          m.role === 'user' &&
          m.inputId &&
          m.followup?.rootInputId === m.inputId &&
          sameAnchor(m.followup, anchor),
      )
      .map((m) => m.inputId),
  );
  return session.messages.filter(
    (m) => m.role === 'user' && m.inputId && m.followup && roots.has(m.followup.rootInputId),
  );
}
export function hasInlineHome(
  message: SessionMessage,
  session: Session,
  snapshot: WorkspaceSnapshot,
): boolean {
  const root = session.messages.find(
      (m) => m.role === 'user' && m.inputId === message.followup?.rootInputId,
    ),
    anchor = root?.followup;
  if (!anchor || anchor.rootInputId !== root?.inputId) return false;
  if (anchor.kind === 'source')
    return (snapshot.fragments ?? []).some(
      (f) => f.id === anchor.id && f.projectId === session.projectId,
    );
  if (anchor.kind === 'step')
    return [
      ...(session.teaching?.history ?? []),
      ...(session.teaching ? [session.teaching.current] : []),
    ].some(
      (step) =>
        step.id === anchor.id &&
        (step.teachingVersionId ??
          step.activity?.teachingVersionId ??
          (step === session.teaching?.current ? session.teachingVersionId : undefined)) ===
          anchor.teachingVersionId,
    );
  const target = session.messages.find((m) => m.id === anchor.id && m.role === 'assistant');
  if (!target) return false;
  if (target.inputId) {
    const owner = session.messages.find((m) => m.role === 'user' && m.inputId === target.inputId);
    if (owner?.handwritingId)
      return (
        !owner.followup &&
        target.handwritingId === owner.handwritingId &&
        target.handwritingTranscriptionId === owner.handwritingTranscriptionId
      );
    return (
      !!owner &&
      !owner.followup &&
      !(
        owner.attemptId &&
        (snapshot.attempts ?? []).some((a) => a.id === owner.attemptId && a.assessment)
      )
    );
  }
  return (
    !['assessment', 'feedback', 'attempt', 'orientation', 'review_solution'].includes(
      target.kind ?? '',
    ) &&
    (!session.teaching || target.kind !== 'teaching')
  );
}
