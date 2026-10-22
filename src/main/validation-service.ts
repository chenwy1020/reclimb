import { reconcileDerivedState, bindingDigest as operationDigest } from './operations';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  validationTaskSchema,
  trialRecordSchema,
  type ValidationTask,
  type ValidationRun,
  type Operation,
} from '../shared/remediation';
import type { Activity, Session } from '../shared/types';
import { evidenceStanding, reviewStanding } from '../shared/reliability-state';
import { LearningStore } from './store';
import { CallRunner } from './call-runner';
import { VerificationService } from './verification-service';
import { completeValidationRun } from './validation-runs';

const id = z.string().min(1).max(120),
  now = () => new Date().toISOString();
export const validationTaskInputSchema = validationTaskSchema
  .omit({
    id: true,
    projectId: true,
    setId: true,
    familyId: true,
    version: true,
    createdAt: true,
    supersedesId: true,
  })
  .extend({
    comparableGroup: z.string().max(120).default(''),
    conditions: z.string().max(4000).default(''),
    transferRationale: z.string().max(4000).default(''),
  })
  .superRefine((task, ctx) => {
    if (
      task.review.status === 'reviewed' &&
      (!task.review.reviewer.trim() || !task.review.basis.trim())
    )
      ctx.addIssue({
        code: 'custom',
        message: '人工核对必须记录核对者与依据；这不等同于专家认证。',
      });
  });
const startSchema = z
  .object({
    taskId: id,
    requestId: id,
    phase: z.enum(['before', 'after', 'delayed']),
    baselineRunId: id.optional(),
    selfReportedExposure: z.string().max(4000).default(''),
  })
  .strict();
const normalizedPrompt = (text: string) => text.replace(/\s+/g, '').normalize('NFKC');
const digest = operationDigest;

/** Withheld tasks live outside materials and ordinary teaching retrieval. */
const candidateRequestSchema = z
  .object({
    setId: id,
    requestId: id,
    topic: z.string().min(1).max(10000),
    count: z.number().int().min(1).max(5).default(2),
  })
  .strict();
export class ValidationService {
  private candidatesInFlight = new Map<string, { digest: string; promise: Promise<void> }>();
  constructor(
    private store: LearningStore,
    private runner?: CallRunner,
  ) {}
  private project(projectId: string) {
    const p = this.store.get('projects', projectId);
    if (!p || p.trashedAt) throw new Error('学习项目不存在。');
    if (p.status === 'paused') throw new Error('请先恢复这个学习项目。');
    return p;
  }
  private task(taskId: string) {
    const task = this.store.get('validationTasks', id.parse(taskId));
    if (!task) throw new Error('验证任务不存在。');
    this.project(task.projectId);
    return task;
  }
  private set(setId: string) {
    const set = this.store.get('validationSets', id.parse(setId));
    if (!set) throw new Error('验证任务集不存在。');
    this.project(set.projectId);
    return set;
  }
  createSet(value: unknown) {
    const p = z
      .object({
        projectId: id,
        title: z.string().trim().min(1).max(500),
        description: z.string().max(4000).default(''),
      })
      .strict()
      .parse(value);
    this.project(p.projectId);
    const stamp = now(),
      set = { ...p, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.store.put('validationSets', set);
    return set;
  }
  importTasks(value: unknown): ValidationTask[] {
    const p = z
        .object({
          setId: id,
          tasks: z.array(validationTaskInputSchema).min(1).max(100),
          knownExposure: z.boolean().default(true),
        })
        .strict()
        .parse(value),
      set = this.set(p.setId);
    for (const task of p.tasks)
      if (
        task.capabilityId &&
        this.store.get('capabilities', task.capabilityId)?.projectId !== set.projectId
      )
        throw new Error('验证目标不属于本项目。');
    for (const task of p.tasks) this.checkTransfer(task, set.id, set.projectId);
    const tasks = p.tasks.map((task) => ({
      ...task,
      id: randomUUID(),
      projectId: set.projectId,
      setId: set.id,
      familyId: randomUUID(),
      version: 1,
      createdAt: now(),
      review: {
        ...task.review,
        ...(task.review.status === 'reviewed'
          ? { reviewedAt: task.review.reviewedAt ?? now() }
          : {}),
      },
    }));
    this.store.transaction(() => {
      for (const task of tasks) {
        this.store.put('validationTasks', task);
        if (p.knownExposure) this.exposure(task, 'known', '录入者声明已看过题设或参考解。');
      }
      this.store.put('validationSets', { ...set, updatedAt: now() });
    });
    return tasks;
  }
  editTask(taskId: string, value: unknown): ValidationTask {
    const old = this.task(taskId),
      fields = validationTaskInputSchema.parse(value);
    if (this.store.list('validationTasks', old.projectId).some((t) => t.supersedesId === old.id))
      throw new Error('此任务已有新版本，请编辑最新版本。');
    if (
      fields.capabilityId &&
      this.store.get('capabilities', fields.capabilityId)?.projectId !== old.projectId
    )
      throw new Error('验证目标不属于本项目。');
    this.checkTransfer(fields, old.setId, old.projectId, old.familyId);
    const task = {
      ...fields,
      id: randomUUID(),
      projectId: old.projectId,
      setId: old.setId,
      familyId: old.familyId,
      version: old.version + 1,
      supersedesId: old.id,
      createdAt: now(),
    };
    this.store.transaction(() => {
      this.store.put('validationTasks', task);
      this.exposure(task, 'known', '编辑题设或标准时已接触任务内容。');
      for (const run of this.store
        .list('validationRuns', old.projectId)
        .filter((r) => r.taskId === old.id)) {
        const session = this.store.get('sessions', run.sessionId);
        if (session?.teachingVersionId)
          this.store.put('corrections', {
            id: randomUUID(),
            projectId: old.projectId,
            teachingVersionId: session.teachingVersionId,
            action: 'invalidate',
            reason: '验证题设或评分条件已修订；旧版结果保留归档，不再支持有效能力结论。',
            createdAt: now(),
          });
      }
      reconcileDerivedState(this.store);
    });
    return task;
  }
  private checkTransfer(
    task: { transferFromTaskId?: string; capabilityId?: string },
    setId: string,
    projectId: string,
    familyId?: string,
  ) {
    if (!task.transferFromTaskId) return;
    const source = this.store.get('validationTasks', task.transferFromTaskId);
    if (
      !source ||
      source.projectId !== projectId ||
      source.setId !== setId ||
      source.familyId === familyId
    )
      throw new Error('迁移来源必须是同一任务集中的另一固定任务。');
    if (task.capabilityId && source.capabilityId && task.capabilityId !== source.capabilityId)
      throw new Error('迁移任务与来源必须检验同一能力。');
  }
  private exposure(
    task: ValidationTask,
    kind: 'answer' | 'hint' | 'known' | 'repeat',
    detail: string,
    runId?: string,
  ) {
    const record = {
      id: randomUUID(),
      projectId: task.projectId,
      taskId: task.id,
      runId,
      kind,
      detail,
      createdAt: now(),
    };
    this.store.put('validationExposures', record);
    return record;
  }
  readTask(taskId: string): ValidationTask {
    const task = this.task(taskId);
    this.store.transaction(() => {
      this.exposure(task, 'answer', '通过任务编辑／核对入口查看题设及参考解。');
      const family = new Set(
        this.store
          .list('validationTasks', task.projectId)
          .filter(
            (t) =>
              t.familyId === task.familyId ||
              normalizedPrompt(t.prompt) === normalizedPrompt(task.prompt),
          )
          .map((t) => t.id),
      );
      for (const run of this.store
        .list('validationRuns', task.projectId)
        .filter((r) => family.has(r.taskId) && r.status === 'active'))
        this.noteHelp(run.sessionId, 'answer', '作答期间打开任务编辑／核对入口。');
    });
    return task;
  }
  readAnswer(runId: string) {
    const run = this.store.get('validationRuns', id.parse(runId));
    if (!run) throw new Error('验证记录不存在。');
    const task = this.task(run.taskId);
    this.noteHelp(run.sessionId, 'answer');
    return { text: task.referenceAnswer };
  }
  noteHelp(
    sessionId: string,
    kind: 'hint' | 'answer' | 'known',
    detail = '学习者主动请求帮助。',
  ): void {
    const run = this.store.list('validationRuns').find((r) => r.sessionId === sessionId);
    if (!run) return;
    const task = this.task(run.taskId),
      session = this.store.get('sessions', sessionId);
    if (!session) return;
    this.store.transaction(() => {
      const exposure = this.exposure(task, kind, detail, run.id);
      this.store.put('validationRuns', {
        ...run,
        exposures: [...run.exposures, { kind, detail, createdAt: exposure.createdAt }],
      });
      this.store.put('sessions', {
        ...session,
        helpLevel: Math.max(session.helpLevel, kind === 'answer' ? 4 : 1),
        helpEvents: [
          ...session.helpEvents,
          {
            id: randomUUID(),
            kind: kind === 'answer' ? 'answer' : 'hint',
            level: kind === 'answer' ? 4 : 1,
            scope: 'current_task',
            taskId: session.activity.id,
            createdAt: exposure.createdAt,
          },
        ],
      });
      if (kind === 'answer')
        this.store.put('answerExposures', {
          id: randomUUID(),
          projectId: run.projectId,
          capabilityId: session.capabilityId,
          sessionId,
          taskId: session.activity.id!,
          teachingVersionId: session.teachingVersionId,
          kind: 'answer',
          text: task.referenceAnswer,
          createdAt: exposure.createdAt,
        });
    });
  }
  start(value: unknown): ValidationRun {
    const p = startSchema.parse(value),
      task = this.task(p.taskId),
      existing = this.store
        .list('validationRuns', task.projectId)
        .find((r) => r.requestId === p.requestId);
    if (existing) {
      if (
        existing.taskId !== p.taskId ||
        existing.phase !== p.phase ||
        existing.baselineRunId !== p.baselineRunId ||
        existing.selfReportedExposure !== p.selfReportedExposure
      )
        throw new Error('请求编号已用于另一验证，请使用新的编号。');
      return existing;
    }
    if (this.store.list('validationTasks', task.projectId).some((t) => t.supersedesId === task.id))
      throw new Error('此任务已有新版本，请选择最新版本。');
    const baseline = p.baselineRunId
      ? this.store.get('validationRuns', p.baselineRunId)
      : undefined;
    if (
      p.baselineRunId &&
      (!baseline || baseline.projectId !== task.projectId || baseline.setId !== task.setId)
    )
      throw new Error('前测记录不属于此任务集。');
    if (p.phase === 'delayed' && !baseline)
      throw new Error('延迟验证需要先关联一条前测或后测记录。');
    if (
      baseline &&
      (p.phase === 'before' ||
        (p.phase === 'after' && baseline.phase !== 'before') ||
        (p.phase === 'delayed' && baseline.phase === 'delayed'))
    )
      throw new Error('基准记录的阶段顺序不合法。');
    const baselineAttempt = baseline
      ? this.store
          .list('attempts', task.projectId)
          .find((a) =>
            baseline.attemptId ? a.id === baseline.attemptId : a.sessionId === baseline.sessionId,
          )
      : undefined;
    if (baseline && !baselineAttempt) throw new Error('请先提交基准任务的作答，再开始关联验证。');
    if (baselineAttempt && Date.parse(baselineAttempt.submittedAt) > Date.now())
      throw new Error('基准提交时间晚于本次开始时间。');
    this.checkTransfer(task, task.setId, task.projectId, task.familyId);
    const isTransfer = !!task.transferFromTaskId;
    if (isTransfer && (!baseline || baseline.taskId !== task.transferFromTaskId))
      throw new Error('迁移验证需要关联其来源任务的已提交记录。');
    const familyIds = new Set(
      this.store
        .list('validationTasks', task.projectId)
        .filter(
          (t) =>
            t.familyId === task.familyId ||
            normalizedPrompt(t.prompt) === normalizedPrompt(task.prompt),
        )
        .map((t) => t.id),
    );
    const prior = this.store
      .list('validationRuns', task.projectId)
      .filter((r) => familyIds.has(r.taskId));
    const known = this.store
      .list('validationExposures', task.projectId)
      .filter((e) => familyIds.has(e.taskId));
    const baselineTask = baseline ? this.task(baseline.taskId) : undefined;
    const comparable =
      !!baselineTask &&
      !!task.comparableGroup &&
      task.comparableGroup === baselineTask.comparableGroup &&
      task.conditions === baselineTask.conditions;
    const capabilityId =
      task.capabilityId ??
      (comparable || isTransfer
        ? this.store.get('sessions', baseline!.sessionId)?.capabilityId
        : undefined) ??
      (prior[0] ? this.store.get('sessions', prior[0].sessionId)?.capabilityId : undefined) ??
      randomUUID();
    if (
      isTransfer &&
      capabilityId !== this.store.get('sessions', baseline!.sessionId)?.capabilityId
    )
      throw new Error('迁移验证必须对应基准作答的同一能力。');
    const stamp = now(),
      runId = randomUUID(),
      sessionId = randomUUID();
    return this.store.transaction(() => {
      if (!this.store.get('capabilities', capabilityId))
        this.store.put('capabilities', {
          id: capabilityId,
          projectId: task.projectId,
          title: task.title,
          description: '固定验证任务：' + task.conditions,
          sourceIds: [],
          prerequisites: [],
          order: this.store.list('capabilities', task.projectId).length,
        });
      const exposures = known.map((e) => ({
        kind: e.kind,
        detail: e.detail,
        createdAt: e.createdAt,
      }));
      if (prior.length) {
        const e = this.exposure(task, 'repeat', '本系统已记录同一任务或其旧版本的使用。', runId);
        exposures.push({ kind: e.kind, detail: e.detail, createdAt: e.createdAt });
      }
      if (p.selfReportedExposure.trim()) {
        const e = this.exposure(task, 'known', p.selfReportedExposure, runId);
        exposures.push({ kind: e.kind, detail: e.detail, createdAt: e.createdAt });
      }
      const activity: Activity = {
        id: randomUUID(),
        title: task.title,
        instruction: task.prompt,
        kind: 'application',
        rubric: task.rubric,
        referenceAnswer: task.referenceAnswer,
        sourceIds: [],
        assessmentBasis: task.source.kind === 'ai' ? 'ai' : 'rule',
      };
      if (isTransfer) {
        const normalized = (text: string) => text.replace(/\s+/g, '').normalize('NFKC');
        activity.transferCheck =
          normalized(task.prompt) === normalized(baselineTask!.prompt)
            ? {
                changedSituation: '',
                sharedPrinciple: '',
                requiredAdaptation: '',
                verdict: 'same_task',
                reason: '题设内容相同，换名称不能证明迁移。',
              }
            : task.review.status === 'reviewed' && task.transferCheck
              ? task.transferCheck
              : {
                  changedSituation: '',
                  sharedPrinciple: '',
                  requiredAdaptation: '',
                  verdict: 'uncertain',
                  reason: '尚未人工核对情境变化与所需适应。',
                };
      }
      const step = {
        id: randomUUID(),
        taskId: activity.id!,
        action: 'check' as const,
        title: task.title,
        content: task.prompt,
        sourceIds: [],
        activity,
        createdAt: stamp,
      };
      // Creation is local; verification can be requested separately, never generates a worked example.
      const verifier = new VerificationService(this.store, this.runner!);
      const version = verifier.createVersion({
        projectId: task.projectId,
        capabilityId,
        activity,
        steps: [step],
        sources: [],
      });
      if (task.review.status === 'reviewed')
        this.store.put('taskReviews', {
          id: randomUUID(),
          projectId: task.projectId,
          teachingVersionId: version.id,
          contentHash: version.contentHash,
          status: 'ready',
          summary:
            '人工核对记录：' +
            task.review.reviewer +
            '；依据：' +
            task.review.basis +
            '。不等同于专家认证。',
          privateSolution: task.referenceAnswer,
          issues: [],
          branches: [],
          exposureRelations: [],
          localChecks: [],
          createdAt: stamp,
          reviewPolicyVersion: 'validation-human-record-1',
          reviewerModel: '人工核对：' + task.review.reviewer,
        });
      let reviewId: string | undefined;
      if ((p.phase === 'delayed' || isTransfer) && baseline) {
        const baseSession = this.store.get('sessions', baseline.sessionId),
          candidates = this.store
            .list('reviews', task.projectId)
            .filter(
              (r) =>
                r.kind === (isTransfer ? 'transfer' : 'delayed') &&
                r.fromSessionId === baseline.sessionId &&
                r.status === 'pending' &&
                Date.parse(r.dueAt) <= Date.parse(stamp) &&
                r.capabilityId === capabilityId &&
                reviewStanding(this.store.snapshot(), r).effective,
            );
        reviewId = candidates[0]?.id;
        if (!baseSession) throw new Error('基准会话不存在。');
      }
      const session: Session = {
        id: sessionId,
        projectId: task.projectId,
        capabilityId,
        activity: version.activity,
        teachingVersionId: version.id,
        mode: isTransfer ? 'transfer' : p.phase === 'delayed' ? 'delayed' : 'practice',
        status: 'active',
        createdAt: stamp,
        updatedAt: stamp,
        draft: '',
        helpLevel: exposures.length ? 4 : 0,
        helpEvents: [],
        messages: [],
        checkpoint: '独立验证：先作答，再核对表现。',
        nextStep: '提交这次独立尝试',
        dueReviewId: reviewId,
        teaching: {
          version: 1,
          current: version.steps[0],
          upcoming: [],
          history: [],
          guidance: 'independent',
          confusionCount: 0,
        },
      };
      this.store.put('sessions', session);
      const run: ValidationRun = {
        id: runId,
        projectId: task.projectId,
        requestId: p.requestId,
        setId: task.setId,
        taskId: task.id,
        sessionId,
        phase: p.phase,
        kind: isTransfer ? 'transfer' : 'standard',
        baselineRunId: p.baselineRunId,
        baselineAttemptId: baselineAttempt?.id,
        status: 'active',
        startedAt: stamp,
        selfReportedExposure: p.selfReportedExposure,
        exposures,
      };
      this.store.put('validationRuns', run);
      return run;
    });
  }
  results(setId: string) {
    const set = this.set(setId),
      snapshot = this.store.snapshot();
    return this.store
      .list('validationRuns', set.projectId)
      .filter((r) => r.setId === setId)
      .map((run) => {
        const task = this.task(run.taskId),
          session = this.store.get('sessions', run.sessionId)!,
          attempt = snapshot.attempts.find((a) =>
            run.attemptId ? a.id === run.attemptId : a.sessionId === run.sessionId,
          ),
          evidence = attempt
            ? snapshot.evidence.find((e) => e.attemptId === attempt.id)
            : undefined;
        const baseline = run.baselineRunId
            ? this.store.get('validationRuns', run.baselineRunId)
            : undefined,
          baseTask = baseline ? this.task(baseline.taskId) : undefined;
        const baseAttempt = run.baselineAttemptId
          ? snapshot.attempts.find(
              (a) => a.id === run.baselineAttemptId && a.sessionId === baseline?.sessionId,
            )
          : undefined;
        const validStages =
          !!baseline &&
          ((run.phase === 'after' && baseline.phase === 'before') ||
            (run.phase === 'delayed' && baseline.phase !== 'delayed'));
        const comparisonReason = !attempt
          ? '本次作答尚未提交。'
          : !validStages
            ? '基准阶段顺序不符合前测、后测、延迟测关系。'
            : !baseAttempt || baseAttempt.submittedAt > run.startedAt
              ? '基准尚未在本次开始前提交，或缺少固定基准作答。'
              : !baseTask ||
                  !task.comparableGroup ||
                  task.comparableGroup !== baseTask.comparableGroup ||
                  task.conditions !== baseTask.conditions
                ? '未预先声明同组同条件关系。'
                : '';
        const boundary = attempt?.submittedAt ?? now(),
          exposures = this.store
            .list('validationExposures', run.projectId)
            .filter((e) => (e.runId === run.id || e.taskId === task.id) && e.createdAt <= boundary);
        const independence = (
          attempt
            ? attempt.helpLevel > 0
            : run.exposures.length || exposures.length || session.helpLevel > 0
        )
          ? 'exposed'
          : 'no_recorded_help';
        return {
          ...run,
          taskTitle: task.title,
          taskVersion: task.version,
          conditions: task.conditions,
          source: task.source,
          reviewer: task.review.reviewer,
          reviewBasis: task.review.basis,
          basis:
            task.source.kind === 'ai'
              ? task.review.status === 'reviewed'
                ? 'AI 候选／人工核对记录'
                : '模型判断／未人工核对'
              : task.review.status === 'reviewed'
                ? '固定任务／人工核对记录'
                : '固定任务／尚未核对',
          independence,
          independenceLimit: '仅依据本系统记录及用户自述，无法排除系统外的接触或帮助。',
          comparable: comparisonReason === '',
          comparisonReason,
          comparisonBaseline:
            baseAttempt && baseTask && baseline
              ? {
                  attemptId: baseAttempt.id,
                  taskTitle: baseTask.title,
                  phase: baseline.phase,
                  helpLevel: baseAttempt.helpLevel,
                  elapsedSeconds: Math.max(
                    0,
                    (Date.parse(baseAttempt.submittedAt) - Date.parse(baseline.startedAt)) / 1000,
                  ),
                  assessment: baseAttempt.assessment,
                  errors:
                    baseAttempt.assessment?.criteria
                      .filter((c) => c.result !== 'met' && c.result !== 'not_applicable')
                      .map((c) => ({
                        criterion: c.criterion,
                        result: c.result,
                        reason: c.reason,
                      })) ?? [],
                }
              : undefined,
          helpLevel: attempt?.helpLevel ?? session.helpLevel,
          elapsedSeconds: attempt
            ? Math.max(0, (Date.parse(attempt.submittedAt) - Date.parse(run.startedAt)) / 1000)
            : undefined,
          attemptId: attempt?.id,
          evidenceId: evidence?.id,
          assessment: attempt?.assessment,
          effective: evidence ? evidenceStanding(snapshot, evidence).effective : false,
          evidenceStatus: evidence?.status,
          errors:
            attempt?.assessment?.criteria
              .filter((c) => c.result !== 'met' && c.result !== 'not_applicable')
              .map((c) => ({ criterion: c.criterion, result: c.result, reason: c.reason })) ?? [],
        };
      });
  }
  completeRuns(sessionId: string): void {
    completeValidationRun(this.store, sessionId);
  }
  recordTrial(value: unknown) {
    const p = trialRecordSchema.omit({ id: true, createdAt: true }).parse(value);
    this.project(p.projectId);
    for (const runId of p.runIds)
      if (this.store.get('validationRuns', runId)?.projectId !== p.projectId)
        throw new Error('试用记录包含其他项目的验证。');
    const record = { ...p, id: randomUUID(), createdAt: now() };
    this.store.put('trialRecords', record);
    return record;
  }
  exportReport(projectId: string): string {
    this.project(projectId);
    const runs = this.store.list('validationSets', projectId).flatMap((s) => this.results(s.id)),
      trials = this.store.list('trialRecords', projectId);
    const labels = { passed: '通过', failed: '失败', unverified: '未验证' };
    return (
      '# 独立验证与实际试用记录\n\n这些记录不构成学习有效性证明；独立性判断仅依据系统记录与用户自述。\n\n' +
      runs
        .map(
          (r) =>
            '## ' +
            r.taskTitle +
            ' · ' +
            r.phase +
            ' · v' +
            r.taskVersion +
            '\n\n' +
            JSON.stringify(r, null, 2),
        )
        .join('\n\n') +
      '\n\n## 实际设备与跨日记录\n\n' +
      (trials.length
        ? trials
            .map(
              (t) =>
                '- ' +
                labels[t.status] +
                ' · ' +
                t.kind +
                ' · ' +
                t.environment +
                '\n  协议：' +
                t.protocol +
                '\n  观察：' +
                t.observations,
            )
            .join('\n')
        : '实际设备：未验证。真人跨日：未验证。')
    );
  }
  async resumeOperation(operationId: string): Promise<void> {
    const operation = this.store.get('operations', operationId);
    if (
      !operation ||
      operation.kind !== 'validation_candidates' ||
      operation.phase !== 'result_saved'
    )
      throw new Error('没有可直接提交的候选结果。');
    await this.generateCandidates(operation.binding);
  }
  async generateCandidates(value: unknown): Promise<void> {
    const p = candidateRequestSchema.parse(value),
      key = p.setId + '|' + p.requestId,
      fingerprint = digest(p),
      running = this.candidatesInFlight.get(key);
    if (running) {
      if (running.digest !== fingerprint) throw new Error('请求编号已用于其他内容。');
      return running.promise;
    }
    const promise = this.performCandidates(p);
    this.candidatesInFlight.set(key, { digest: fingerprint, promise });
    try {
      await promise;
    } finally {
      this.candidatesInFlight.delete(key);
    }
  }
  private async performCandidates(p: z.infer<typeof candidateRequestSchema>) {
    const set = this.set(p.setId);
    const bindingDigest = digest(p),
      old = this.store
        .list('operations', set.projectId)
        .find((o) => o.kind === 'validation_candidates' && o.requestId === p.requestId);
    if (old && old.bindingDigest !== bindingDigest) throw new Error('请求编号已用于其他内容。');
    if (old?.phase === 'completed') return;
    const schema = z.object({ tasks: z.array(validationTaskInputSchema).min(1).max(p.count) });
    let operation: Operation = old ?? {
      id: randomUUID(),
      projectId: set.projectId,
      requestId: p.requestId,
      kind: 'validation_candidates',
      phase: 'saved',
      refs: { validationSetId: set.id },
      binding: p,
      bindingDigest,
      savedSummary: '候选要求已保存在本机',
      callIds: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.store.put('operations', operation);
    let result: z.infer<typeof schema>;
    if (operation.phase === 'result_saved') result = schema.parse(operation.result);
    else {
      if (!this.runner) throw new Error('尚未配置模型连接。');
      const callId = randomUUID();
      operation = {
        ...operation,
        phase: 'running',
        callIds: [...operation.callIds, callId],
        updatedAt: now(),
      };
      this.store.put('operations', operation);
      try {
        result = await this.runner.run(
          '独立验证候选',
          {
            topic: p.topic,
            count: p.count,
            instruction:
              '生成固定题设、参考解与评分条件。只作为待人工复核的模型候选，source.kind必须ai，source.citation明确模型生成。review.status必须unreviewed，reviewer和basis为空。comparableGroup默认空，不能自称已证明任务可比；conditions说明测试条件。transferRationale默认空。不要引用不存在的来源。',
          },
          { schema, requestId: callId },
        );
        result.tasks = result.tasks.map((t) => ({
          ...t,
          source: { kind: 'ai', citation: 'AI 生成候选，来源未由外部核实' },
          review: { status: 'unreviewed', reviewer: '', basis: '' },
          comparableGroup: '',
          transferRationale: '',
          capabilityId: undefined,
          transferFromTaskId: undefined,
          transferCheck: undefined,
        }));
        operation = {
          ...operation,
          phase: 'result_saved',
          result,
          callIds: [
            ...new Set([
              ...operation.callIds,
              ...this.store
                .list('usage')
                .filter((u) => u.operationId && operation.callIds.includes(u.operationId))
                .map((u) => u.id),
            ]),
          ],
          updatedAt: now(),
        };
        this.store.put('operations', operation);
      } catch (error) {
        this.store.put('operations', {
          ...operation,
          phase: 'interrupted',
          failureStage: '模型调用',
          failureReason: error instanceof Error ? error.message : '调用中断',
          updatedAt: now(),
        });
        throw error;
      }
    }
    try {
      this.store.transaction(() => {
        this.importTasks({ setId: set.id, tasks: result.tasks, knownExposure: false });
        this.store.put('operations', {
          ...operation,
          phase: 'completed',
          failureStage: undefined,
          failureReason: undefined,
          updatedAt: now(),
        });
        for (const callId of operation.callIds) {
          const usage = this.store.get('usage', callId);
          if (usage) this.store.put('usage', { ...usage, publicationStatus: 'published' });
        }
      });
    } catch (error) {
      this.store.put('operations', {
        ...operation,
        phase: 'result_saved',
        failureStage: 'local_commit',
        failureReason: error instanceof Error ? error.message : '本机提交中断',
        updatedAt: now(),
      });
      throw error;
    }
  }
}
