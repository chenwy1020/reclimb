import type { LearningStore } from './store';
import {
  knowledgeMemory,
  type KnowledgeMemory,
  type KnowledgeMemoryEntry,
} from '../shared/knowledge-graph';
import type { TeachingVersion } from '../shared/reliability';
import { OperationBindingError } from './operations';

export interface PriorLearningTask {
  evidenceId: string;
  title: string;
  instruction: string;
  incomplete?: boolean;
}
/** Only public task statements are sent to the generator/reviewer, never private solutions. */
function tasksForEntries(
  store: LearningStore,
  entries: KnowledgeMemoryEntry[],
): PriorLearningTask[] {
  return entries.map((entry) => {
    const savedEvidence = store.get('evidence', entry.evidenceId),
      savedAttempt = store.get('attempts', entry.attemptId);
    const evidence =
      savedEvidence?.projectId === entry.sourceProjectId &&
      savedEvidence.capabilityId === entry.sourceCapabilityId &&
      savedEvidence.attemptId === entry.attemptId &&
      savedEvidence.sessionId === entry.sessionId
        ? savedEvidence
        : undefined;
    const attempt =
      savedAttempt?.projectId === entry.sourceProjectId &&
      savedAttempt.sessionId === entry.sessionId
        ? savedAttempt
        : undefined;
    const versionId = evidence?.teachingVersionId ?? attempt?.teachingVersionId,
      version = versionId ? store.get('teachingVersions', versionId) : undefined,
      taskId = evidence?.taskId ?? attempt?.taskId;
    const frozenVersion =
      version?.projectId === entry.sourceProjectId &&
      version.capabilityId === entry.sourceCapabilityId &&
      (!taskId || version.taskId === taskId)
        ? version
        : undefined;
    // A session can move on to another activity; it is not a historical task snapshot.
    const activity =
        evidence?.activitySnapshot ?? attempt?.activitySnapshot ?? frozenVersion?.activity,
      instruction = activity?.instruction ?? '';
    return {
      evidenceId: entry.evidenceId,
      title: activity?.title.slice(0, 500) ?? '',
      instruction: instruction.slice(0, 6000),
      ...(!instruction.trim() || instruction.length > 6000 ? { incomplete: true } : {}),
    };
  });
}
export function priorLearningTasks(
  store: LearningStore,
  memory: KnowledgeMemory,
): PriorLearningTask[] {
  return tasksForEntries(store, memory.entries);
}
/** Historical exposure survives a withdrawn relation and same-task source revisions. */
export function priorLearningTasksForVersion(
  store: LearningStore,
  version: TeachingVersion,
  explicit: PriorLearningTask[] = [],
): PriorLearningTask[] {
  const lineage = new Set<string>();
  let current: TeachingVersion | undefined = version;
  while (
    current &&
    current.projectId === version.projectId &&
    current.capabilityId === version.capabilityId &&
    !lineage.has(current.id)
  ) {
    lineage.add(current.id);
    current = current.replacesVersionId
      ? store.get('teachingVersions', current.replacesVersionId)
      : undefined;
  }
  const entries = store
    .list('knowledgeUses', version.projectId)
    .filter(
      (use) =>
        use.targetCapabilityId === version.capabilityId && lineage.has(use.teachingVersionId),
    )
    .flatMap((use) => use.entries);
  const tasks = new Map<string, PriorLearningTask>();
  for (const task of [...tasksForEntries(store, entries), ...explicit])
    if (!tasks.has(task.evidenceId)) tasks.set(task.evidenceId, task);
  return [...tasks.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}
export function assertKnowledgeCurrent(
  store: LearningStore,
  memory: KnowledgeMemory | undefined,
): void {
  if (
    memory &&
    knowledgeMemory(store.snapshot(), memory.projectId, memory.capabilityId).fingerprint !==
      memory.fingerprint
  )
    throw new OperationBindingError(
      '生成期间关联或历史依据发生变化，请根据当前记录重新请求。原有学习进度已保留。',
    );
}
