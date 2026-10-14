import { createHash, randomUUID } from 'node:crypto';
import { LearningStore } from './store';
import {
  handwritingSubmitSchema,
  handwritingTargetSchema,
  type HandwritingTarget,
  type HandwritingReceipt,
  type HandwritingSubmission,
} from '../shared/handwriting';

export interface HandwritingListItem {
  record: HandwritingSubmission;
  pageCount: number;
  target: HandwritingTarget;
}
export class HandwritingService {
  private readonly listCache = new Map<
    string,
    { projectId: string; items: HandwritingListItem[] }
  >();
  constructor(private store: LearningStore) {}
  target(
    sessionId: string,
    expected?: { taskId: string; stepId?: string; teachingVersionId?: string },
  ): HandwritingTarget {
    const session = this.store.get('sessions', sessionId);
    if (!session) throw new Error('这次学习不存在。');
    const project = this.store.get('projects', session.projectId);
    if (!project || project.trashedAt) throw new Error('项目已删除，请先恢复后发送到 iPad。');
    const step = session.teaching?.current,
      activity = step?.activity ?? session.activity;
    if (
      expected &&
      (expected.taskId !== (step?.taskId ?? activity.id ?? session.id) ||
        expected.stepId !== step?.id ||
        expected.teachingVersionId !== (activity.teachingVersionId ?? session.teachingVersionId))
    )
      throw new Error('题目已经更新，请查看当前任务后重新发送；没有替换 iPad 的原草稿。');
    const target = handwritingTargetSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      projectTitle: project.title,
      sessionId: session.id,
      taskId: step?.taskId ?? activity.id ?? session.id,
      stepId: step?.id,
      teachingVersionId: activity.teachingVersionId ?? session.teachingVersionId,
      title: step?.title ?? activity.title,
      instruction: [step?.content, activity.instruction]
        .filter((text, i, all) => text && all.indexOf(text) === i)
        .join('\n\n'),
      sourceIds: activity.sourceIds,
      sourceVersions: activity.sourceVersions,
      helpLevel: session.helpLevel,
      mode: session.mode,
      reviewId: session.dueReviewId,
      createdAt: new Date().toISOString(),
    });
    this.store.put('handwritingTargets', target);
    return target;
  }
  getTarget(id: string): HandwritingTarget | undefined {
    const target = this.store.get('handwritingTargets', id);
    if (!target) return;
    const project = this.store.get('projects', target.projectId),
      session = this.store.get('sessions', target.sessionId);
    if (!project || project.trashedAt || !session || session.projectId !== target.projectId) return;
    return target;
  }
  list(sessionId: string): HandwritingListItem[] {
    const session = this.store.get('sessions', sessionId);
    if (!session) throw new Error('这次学习不存在。');
    const project = this.store.get('projects', session.projectId);
    if (!project || project.trashedAt) throw new Error('项目已删除，请先恢复后查看手写原稿。');
    let cached = this.listCache.get(sessionId);
    if (!cached || cached.projectId !== project.id) {
      const items = this.store
        .list('handwritings', project.id)
        .filter((record) => record.sessionId === sessionId)
        .map((record) => {
          const target = this.getTarget(record.targetId);
          if (!target || target.projectId !== record.projectId || target.sessionId !== sessionId)
            throw new Error('手写原稿与原任务的关联无法核对，请检查学习档案。');
          const { pages, ...metadata } = record;
          return { record: { ...metadata, pages: [] }, pageCount: pages.length, target };
        });
      cached = { projectId: project.id, items };
    }
    // Bound the cache to recent session metadata; no arrays of strokes are retained.
    this.listCache.delete(sessionId);
    this.listCache.set(sessionId, cached);
    if (this.listCache.size > 20) this.listCache.delete(this.listCache.keys().next().value!);
    return structuredClone(cached.items);
  }
  save(body: unknown): HandwritingReceipt {
    const input = handwritingSubmitSchema.parse(body),
      hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = this.store
      .list('handwritings')
      .find((item) => item.requestId === input.requestId);
    if (previous) {
      if (previous.contentHash !== hash)
        throw new Error('同一提交编号已对应其他原稿，请保留草稿并重新提交。');
      if (!this.getTarget(previous.targetId)) throw new Error('原项目已删除，请先恢复。');
      return this.receipt(previous);
    }
    const target = this.getTarget(input.targetId);
    if (!target)
      throw new Error('原任务已不在当前档案中。草稿仍在 iPad，请先恢复原项目或导出草稿。');
    if (!input.pages.some((page) => page.image || page.strokes.length) && !input.note.trim())
      throw new Error('请先写下笔迹或补充文字。');
    const session = this.store.get('sessions', target.sessionId)!;
    let helpLevel = target.helpLevel;
    // Capture help delivered after pairing as well, without treating handwriting as assessed ability.
    for (const event of session.helpEvents)
      if ((event.taskId ?? target.taskId) === target.taskId)
        helpLevel = Math.max(helpLevel, event.level);
    for (const exposure of this.store.list('answerExposures', target.projectId))
      if (exposure.sessionId === session.id && exposure.taskId === target.taskId) helpLevel = 4;
    const version = target.teachingVersionId
      ? this.store.get('teachingVersions', target.teachingVersionId)
      : undefined;
    if (
      target.teachingVersionId &&
      (!version || version.projectId !== target.projectId || version.taskId !== target.taskId)
    )
      throw new Error('原教学版本无法核对，草稿已保留，请先检查档案。');
    const record: HandwritingSubmission = {
      id: randomUUID(),
      projectId: target.projectId,
      sessionId: target.sessionId,
      targetId: target.id,
      requestId: input.requestId,
      contentHash: hash,
      submittedAt: new Date().toISOString(),
      helpLevel,
      pages: input.pages,
      note: input.note,
      author: 'learner',
      status: 'saved_unassessed',
    };
    this.store.transaction(() => this.store.put('handwritings', record));
    this.listCache.delete(target.sessionId);
    return this.receipt(record);
  }
  private receipt(record: HandwritingSubmission): HandwritingReceipt {
    return {
      id: record.id,
      requestId: record.requestId,
      targetId: record.targetId,
      savedAt: record.submittedAt,
      status: 'saved_unassessed',
    };
  }
}
