import type { Activity, Evidence, Session } from '../shared/types';
import type { TeachingStep } from '../shared/teaching';
import type { TeachingVersion, CorrectionRecord, AnswerExposure } from '../shared/reliability';
import { sourceExcerpt } from '../shared/materials';
import { teachingContentHash } from './verification-service';
import type { LearningStore } from './store';

/** Individually investigated 0.2 incidents. Never classify other learners' work by matching its text. */
export const KNOWN_INCIDENT = {
  projectId: '5b94d036-94d3-4bf4-b12b-c6e02eb4a4a1',
  sessionId: '91f1cfca-fedd-4a8e-ad24-4ca75ea3c206',
  capabilityId: '8ec01b92-a624-4d0a-ab48-9c3618410a99',
  zeroMapTaskId: '49006036-fd83-4a99-bac6-09f6c75dc355',
  exposedTaskId: '1f12bdae-a132-4fb7-8eb9-b45f1bd2f71e',
  tasks: [
    {
      taskId: '570c0ef1-40fb-4ad5-ad29-8ebf48f052a6',
      evidenceIds: [
        '666a022f-4de8-44b0-a08e-a0696d094c4f',
        '4e0bfaa1-704f-4e06-a5d3-e8fbcfd00022',
        'ba4cfe0f-98d7-4067-93d0-35b644eeb713',
        '2347c89d-d405-457d-a32b-bed2e9aead5f',
      ],
      reason:
        '已按原记录逐项复核：I(x)=x²−x³/4 时 I(3)=9/4>0，指定端点不满足能量条件。旧评价仍要求执行不成立的条件分支，并混用了严格与非严格的边界下界。暂停原题，停用这些评价；不据此补发能力认定。',
    },
    {
      taskId: '49006036-fd83-4a99-bac6-09f6c75dc355',
      evidenceIds: ['a525851c-fbd5-4cf0-bdf3-93c7aa5a1ab1'],
      reason:
        '已按原记录逐项复核：对任意方向写出 I′(0,0)(x₁,x₂)=0 已明确给出零线性映射，不能仅因未改用另一组方向变量或展开零系数而否定该表达。停用原评价，保留作答，不自动转为新的能力证据。',
    },
    {
      taskId: '1f12bdae-a132-4fb7-8eb9-b45f1bd2f71e',
      evidenceIds: ['2927cd12-4eb0-451d-a513-43b5e80357ab'],
      reason:
        '已按原记录逐项复核：先前反馈已公开同一零映射的答案，随后缩成填空并未形成新的独立任务。原独立完成归因失效，相应回访暂不再以此为依据；保留原作答和原评价，不改写为另一项学习表现。',
    },
  ],
} as const;

export interface IncidentMigrationReport {
  versionsCreated: number;
  correctionsCreated: number;
  exposuresCreated: number;
  skipped: string[];
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const prefix = 'known-incident-03-';

function boundEvidence(store: LearningStore, id: string, taskId: string): Evidence | undefined {
  const evidence = store.get('evidence', id);
  if (
    !evidence ||
    evidence.projectId !== KNOWN_INCIDENT.projectId ||
    evidence.sessionId !== KNOWN_INCIDENT.sessionId ||
    evidence.capabilityId !== KNOWN_INCIDENT.capabilityId ||
    evidence.taskId !== taskId
  )
    return undefined;
  const attempt = store.get('attempts', evidence.attemptId);
  if (
    !attempt ||
    attempt.projectId !== evidence.projectId ||
    attempt.sessionId !== evidence.sessionId ||
    attempt.taskId !== taskId ||
    (attempt.activitySnapshot && attempt.activitySnapshot.id !== taskId) ||
    (evidence.activitySnapshot && evidence.activitySnapshot.id !== taskId)
  )
    return undefined;
  return evidence;
}

function knownSteps(session: Session, taskId: string): TeachingStep[] {
  const teaching = session.teaching;
  const steps = teaching
    ? [
        ...teaching.history,
        teaching.current,
        ...teaching.upcoming,
        ...(teaching.returnStep ? [teaching.returnStep] : []),
        ...(teaching.returnUpcoming ?? []),
      ]
    : [];
  return [
    ...new Map(
      steps.filter((step) => step.taskId === taskId).map((step) => [step.id, step]),
    ).values(),
  ];
}

function freezeLegacy(
  store: LearningStore,
  session: Session,
  taskId: string,
  evidence: Evidence[],
  now: string,
  report: IncidentMigrationReport,
): TeachingVersion | undefined {
  const existing = store
    .list('teachingVersions', session.projectId)
    .find(
      (version) =>
        version.taskId === taskId &&
        version.capabilityId === session.capabilityId &&
        version.origin === 'legacy',
    );
  if (existing) {
    if (teachingContentHash(existing) !== existing.contentHash) {
      report.skipped.push(`版本校验失败：${existing.id}`);
      return undefined;
    }
    return existing;
  }
  const steps = knownSteps(session, taskId);
  const activity: Activity | undefined =
    evidence.find((item) => item.activitySnapshot?.id === taskId)?.activitySnapshot ??
    steps.find((step) => step.activity?.id === taskId)?.activity ??
    (session.activity.id === taskId ? session.activity : undefined);
  if (!activity) {
    report.skipped.push(`未找到原任务快照：${taskId}`);
    return undefined;
  }
  const sources = [];
  for (const sourceId of activity.sourceIds) {
    const fragment = store.get('fragments', sourceId);
    if (
      !fragment ||
      fragment.projectId !== session.projectId ||
      store.get('materials', fragment.materialId)?.projectId !== session.projectId
    ) {
      report.skipped.push(`原任务来源关联缺失：${taskId}`);
      return undefined;
    }
    const ids =
      activity.sourceVersions?.find((item) => item.fragmentId === sourceId)?.transcriptionIds ?? [];
    const transcriptions = ids.map((id) => store.get('sourceTranscriptions', id));
    if (
      transcriptions.some(
        (item) =>
          !item ||
          item.status !== 'confirmed' ||
          item.fragmentId !== sourceId ||
          item.projectId !== session.projectId ||
          item.materialId !== fragment.materialId,
      )
    ) {
      report.skipped.push(`原转录版本关联缺失：${taskId}`);
      return undefined;
    }
    const excerpt = sourceExcerpt(
      fragment,
      transcriptions.filter((item): item is NonNullable<typeof item> => !!item),
      5000,
    );
    sources.push({
      id: fragment.id,
      locator: fragment.locator,
      ...excerpt,
      warnings: [
        ...excerpt.warnings,
        '旧档案迁移按原任务引用冻结现存来源；当时完整模型输入未保存，不声称复原全部历史上下文。',
      ],
    });
  }
  const originalSteps = steps.length
    ? steps
    : [
        {
          id: prefix + 'step-' + taskId,
          taskId,
          action: 'check' as const,
          title: activity.title,
          content: activity.instruction,
          sourceIds: [...activity.sourceIds],
          activity: copy(activity),
          createdAt: session.createdAt,
        },
      ];
  const body = { activity: copy(activity), steps: copy(originalSteps), sources };
  const version: TeachingVersion = {
    id: prefix + 'version-' + taskId,
    projectId: session.projectId,
    capabilityId: session.capabilityId,
    taskId,
    version: 1,
    ...body,
    contentHash: teachingContentHash(body),
    createdAt: now,
    origin: 'legacy',
  };
  if (store.get('teachingVersions', version.id)) {
    report.skipped.push(`迁移版本编号冲突：${taskId}`);
    return undefined;
  }
  store.put('teachingVersions', version);
  report.versionsCreated++;
  return version;
}

/** Startup migration adds reviewed corrections only. All preexisting entities stay byte-for-byte equivalent. */
export function applyKnownIncidentCorrections(store: LearningStore): IncidentMigrationReport {
  const report: IncidentMigrationReport = {
    versionsCreated: 0,
    correctionsCreated: 0,
    exposuresCreated: 0,
    skipped: [],
  };
  const session = store.get('sessions', KNOWN_INCIDENT.sessionId);
  const capability = store.get('capabilities', KNOWN_INCIDENT.capabilityId);
  if (
    !session ||
    session.projectId !== KNOWN_INCIDENT.projectId ||
    session.capabilityId !== KNOWN_INCIDENT.capabilityId ||
    !store.get('projects', KNOWN_INCIDENT.projectId) ||
    capability?.projectId !== KNOWN_INCIDENT.projectId
  )
    return report;
  return store.transaction(() => {
    const now = new Date().toISOString();
    const versions = new Map<string, TeachingVersion>();
    const appendCorrection = (record: CorrectionRecord) => {
      if (!store.get('corrections', record.id)) {
        store.put('corrections', record);
        report.correctionsCreated++;
      }
    };
    for (const task of KNOWN_INCIDENT.tasks) {
      const evidence = task.evidenceIds.flatMap((id) => {
        const item = boundEvidence(store, id, task.taskId);
        if (!item) {
          if (store.get('evidence', id)) report.skipped.push(`评价与任务关联不匹配：${id}`);
          return [];
        }
        return [item];
      });
      const version = freezeLegacy(store, session, task.taskId, evidence, now, report);
      if (!version) continue;
      versions.set(task.taskId, version);
      appendCorrection({
        id: prefix + 'suspend-' + task.taskId,
        projectId: session.projectId,
        teachingVersionId: version.id,
        action: 'suspend',
        reason: task.reason,
        createdAt: now,
      });
      for (const item of evidence)
        appendCorrection({
          id: prefix + 'invalidate-' + item.id,
          projectId: session.projectId,
          teachingVersionId: version.id,
          evidenceId: item.id,
          action: 'invalidate',
          reason: task.reason,
          createdAt: now,
        });
    }
    const original = boundEvidence(
      store,
      KNOWN_INCIDENT.tasks[1].evidenceIds[0],
      KNOWN_INCIDENT.zeroMapTaskId,
    );
    const later = boundEvidence(
      store,
      KNOWN_INCIDENT.tasks[2].evidenceIds[0],
      KNOWN_INCIDENT.exposedTaskId,
    );
    const originalVersion = versions.get(KNOWN_INCIDENT.zeroMapTaskId);
    if (
      original &&
      later &&
      originalVersion &&
      Date.parse(original.createdAt) <=
        Date.parse(store.get('attempts', later.attemptId)!.submittedAt)
    ) {
      const exposure: AnswerExposure = {
        id: prefix + 'exposure-' + later.id,
        projectId: session.projectId,
        capabilityId: session.capabilityId,
        sessionId: session.id,
        taskId: KNOWN_INCIDENT.zeroMapTaskId,
        teachingVersionId: originalVersion.id,
        kind: 'feedback',
        text: '已复核的旧反馈曾公开 I′(0,0)(φ₁,φ₂)=φ₁·0+φ₂·0=0。随后同一算式改成填空，属于已见答案；本条只补记当时已发生的帮助，不构成新的学习表现。',
        createdAt: original.createdAt,
      };
      if (!store.get('answerExposures', exposure.id)) {
        store.put('answerExposures', exposure);
        report.exposuresCreated++;
      }
    }
    return report;
  });
}
