import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LearningStore } from '../../src/main/store';
import { LearningService } from '../../src/main/learning-service';
import { VerificationService } from '../../src/main/verification-service';
import { CallRunner } from '../../src/main/call-runner';
import type { ModelProvider } from '../../src/main/provider';
import { buildChatUrl } from '../../src/main/provider';
import type { Activity, Session, Settings, Usage } from '../../src/shared/types';
import {
  assertLiveValidationPaths,
  parseLiveValidationArgs,
  writeValidationReport,
  type LiveValidationOptions,
} from './live-validation';

export const EVALUATION_STAGES = ['explain', 'attempt', 'feedback', 'review'] as const;
export type EvaluationStage = (typeof EVALUATION_STAGES)[number];
export interface ProductEvaluationOptions extends LiveValidationOptions {
  caseId?: string;
  stage?: EvaluationStage;
}
const text = z.string().trim().min(1).max(12000);
const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    source: z.object({ title: text, text }).strict(),
    activity: z
      .object({ title: text, instruction: text, rubric: z.array(text).min(1).max(4) })
      .strict(),
    feedbackVariant: z.enum(['correct', 'equivalent', 'incorrect', 'missing_condition']),
    injectLeakageProbe: z.boolean(),
    reference: z
      .object({
        correct: text,
        equivalent: text,
        incorrect: text,
        missingCondition: z.object({ task: text, expected: text }).strict(),
        leakageProbe: text,
        leakageExpectation: text,
      })
      .strict(),
  })
  .strict();
export const evaluationFixtureSchema = z
  .object({
    version: z.literal(1),
    authorship: z.literal('original'),
    cases: z.array(caseSchema).length(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.cases.map((item) => item.id)).size !== 20)
      context.addIssue({ code: 'custom', message: '20 个案例编号必须互不重复。' });
  });
type EvaluationCase = z.infer<typeof caseSchema>;
const configSchema = z
  .object({
    providerName: z.string().min(1).max(80),
    baseUrl: z.url(),
    model: z.string().min(1).max(250),
    apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    inputPriceCnyPerMillion: z.number().finite().positive(),
    outputPriceCnyPerMillion: z.number().finite().positive(),
    priceUpdatedAt: text,
  })
  .strict();

export const metricDefinitions = {
  answerLeakageRate:
    '人工确认提前泄题的公开片段数 / 已人工检查、且包含作答前公开内容的片段数；未检查分母为 0 时值为 null。核验私有解答不计公开内容。',
  mathErrorRate:
    '人工确认至少一处数学错误的结果数 / 已人工检查、且包含数学内容的结果数；分母不含未返回结果。',
  gradingAgreement:
    '与预置参考和人工逐条判定一致的评分数 / 已人工核对且实际产生评分的固定题作答数；未评分或被阻断不算一致。',
  verificationInterceptionRate:
    '人工确认应阻断且被 canAssess 闸门阻断的缺陷任务数 / 已人工确认应阻断的缺陷任务数；正常题不得加入分母。',
  latency:
    '每格端到端耗时及该格每个实际请求耗时；生成、核验、格式恢复均计入。没有收到首段流式内容，不报告首 token 延迟。',
  cost: '所有已发请求按显式配置价格的保守账本估算，包含失败后费用不明的预留；最终以服务商账单为准。',
};

export function parseProductEvaluationArgs(args: string[]): ProductEvaluationOptions {
  const common: string[] = [];
  let caseId: string | undefined, stage: EvaluationStage | undefined;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--case' || name === '--stage') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('case/stage 必须指定明确值。');
      if (name === '--case') {
        if (caseId) throw new Error('case 参数不能重复。');
        caseId = value;
      } else {
        if (stage || !EVALUATION_STAGES.includes(value as EvaluationStage))
          throw new Error('stage 必须是 explain、attempt、feedback 或 review。');
        stage = value as EvaluationStage;
      }
    } else common.push(name);
  }
  return {
    ...parseLiveValidationArgs(common),
    ...(caseId ? { caseId } : {}),
    ...(stage ? { stage } : {}),
  };
}
function readJson(file: string): unknown {
  const bytes = readFileSync(file);
  if (bytes.byteLength > 1_000_000) throw new Error('评测配置和原创材料必须小于 1 MB。');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
const spend = (usage: Usage[]) =>
  usage.filter((row) => row.status !== 'failed').reduce((sum, row) => sum + row.estimatedCny, 0);
const humanReview = () => ({
  status: 'pending',
  answerLeaked: null,
  mathematicalError: null,
  gradingAgrees: null,
  defectRequiresBlocking: null,
  correctlyBlocked: null,
  notes: '',
});
function seedCase(store: LearningStore, item: EvaluationCase, stage: EvaluationStage) {
  const now = new Date().toISOString(),
    projectId = `evaluation-${item.id}-${stage}-${randomUUID()}`;
  const capabilityId = randomUUID(),
    materialId = randomUUID(),
    sourceId = randomUUID();
  const sourceText =
    item.source.text +
    ((stage === 'explain' || stage === 'attempt') && item.injectLeakageProbe
      ? '\n\n' + item.reference.leakageProbe
      : '');
  store.put('projects', {
    id: projectId,
    title: `原创评测 · ${item.source.title} · ${stage}`,
    goal: '解释关键条件、独立作答并说明依据。',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  store.put('materials', {
    id: materialId,
    projectId,
    title: item.source.title,
    kind: 'markdown',
    originalName: 'original-evaluation.md',
    storedPath: join(store.dataDirectory, 'original-evaluation.md'),
    importedAt: now,
    warnings: [],
    fragmentCount: 1,
    summary: item.source.text,
  });
  store.put('fragments', {
    id: sourceId,
    projectId,
    materialId,
    locator: '原创案例 · 全文',
    text: sourceText,
    ordinal: 0,
  });
  store.put('capabilities', {
    id: capabilityId,
    projectId,
    title: item.activity.title,
    description: '运用材料中的定义与条件，解释并完成一个小任务。',
    prerequisites: [],
    sourceIds: [sourceId],
    order: 0,
  });
  return { projectId, capabilityId, sourceId, sourceText, now };
}

async function evaluateCell(
  store: LearningStore,
  item: EvaluationCase,
  stage: EvaluationStage,
  key: string,
  cap: number,
  factory?: (settings: Settings, key: string) => ModelProvider,
) {
  const seeded = seedCase(store, item, stage);
  const service = new LearningService(store, () => key, factory, cap);
  if (stage !== 'feedback') {
    const mode = stage === 'attempt' ? 'diagnosis' : stage === 'review' ? 'delayed' : 'practice';
    const session = await service.start(seeded.projectId, seeded.capabilityId, mode);
    return {
      projectId: seeded.projectId,
      mode,
      scope:
        stage === 'review'
          ? '真实 delayed 出题与核验路径；合成材料，无真实间隔、回访完成或保持效果证明。'
          : '真实教学生成、独立核验及条件性修订路径；不是界面或真人效果测试。',
      publicOutput: {
        activity: session.activity,
        teaching: session.teaching,
        messages: session.messages,
      },
      verification: store.list('taskReviews', seeded.projectId),
      canAssess: service.getVerification(session.id).canAssess,
      referenceAppliesTo:
        '预置答案仅对应固定题；新生成题由人工独立复算，不能直接用固定题答案计分。',
    };
  }
  const runner = new CallRunner(store, () => key, factory, cap),
    verifier = new VerificationService(store, runner);
  const missing = item.feedbackVariant === 'missing_condition';
  const activity: Activity = {
    id: randomUUID(),
    ...item.activity,
    instruction: missing ? item.reference.missingCondition.task : item.activity.instruction,
    kind: 'argument',
    sourceIds: [seeded.sourceId],
    assessmentBasis: 'source',
  };
  const version = verifier.createVersion({
    projectId: seeded.projectId,
    capabilityId: seeded.capabilityId,
    activity,
    steps: [
      {
        id: randomUUID(),
        taskId: activity.id!,
        action: 'attempt',
        title: activity.title,
        content: activity.instruction,
        activity,
        sourceIds: [seeded.sourceId],
        createdAt: seeded.now,
      },
    ],
    sources: [
      {
        id: seeded.sourceId,
        locator: '原创案例 · 全文',
        text: seeded.sourceText,
        warnings: [],
        transcriptionIds: [],
      },
    ],
  });
  await verifier.review(version);
  const session: Session = {
    id: randomUUID(),
    projectId: seeded.projectId,
    capabilityId: seeded.capabilityId,
    activity: version.activity,
    teachingVersionId: version.id,
    mode: 'practice',
    status: 'active',
    createdAt: seeded.now,
    updatedAt: seeded.now,
    draft: '',
    helpLevel: 0,
    helpEvents: [],
    messages: [],
    checkpoint: '原创固定题的合成作答',
    nextStep: '核对真实评分或讨论结果',
    teaching: {
      version: 1,
      current: version.steps[0],
      upcoming: [],
      history: [],
      guidance: 'independent',
      confusionCount: 0,
    },
  };
  store.put('sessions', session);
  const answer = missing
    ? item.reference.missingCondition.expected
    : item.reference[item.feedbackVariant as 'correct' | 'equivalent' | 'incorrect'];
  const receipt = service.recordInput(session.id, {
    requestId: randomUUID(),
    kind: 'attempt',
    text: answer,
    taskId: version.taskId,
    stepId: version.steps[0].id,
    teachingVersionId: version.id,
  });
  await service.respondInput(session.id, receipt.inputId);
  return {
    projectId: seeded.projectId,
    scope:
      '原创固定题的真实独立核验、recordInput/respondInput 与评分闸门；核验阻断时按生产行为讨论，不能记作评分成功。',
    answerVariant: item.feedbackVariant,
    answer,
    responseMode: receipt.responseMode,
    publicOutput: store.get('sessions', session.id)?.messages,
    assessments: store
      .list('attempts', seeded.projectId)
      .map((attempt) => ({ text: attempt.text, assessment: attempt.assessment })),
    verification: store.list('taskReviews', seeded.projectId),
    canAssess: verifier.getView(version.id).canAssess,
    syntheticEvidenceCount: store.list('evidence', seeded.projectId).length,
  };
}

export async function runProductEvaluation(
  options: ProductEvaluationOptions,
  factory?: (settings: Settings, key: string) => ModelProvider,
): Promise<Record<string, unknown>> {
  assertLiveValidationPaths(options);
  if (!Number.isFinite(options.cap) || options.cap <= 0 || options.cap > 3)
    throw new Error('cap 必须大于 0 且不超过 3 元。');
  const config = configSchema.parse(readJson(options.config));
  buildChatUrl(config.baseUrl);
  const fixture = evaluationFixtureSchema.parse(readJson(options.fixture));
  const cases = options.caseId
    ? fixture.cases.filter((item) => item.id === options.caseId)
    : fixture.cases;
  if (!cases.length) throw new Error('没有匹配的原创案例。');
  if (options.stage && !EVALUATION_STAGES.includes(options.stage))
    throw new Error('不支持的评测阶段。');
  const stages = options.stage ? [options.stage] : EVALUATION_STAGES;
  const matrix = cases.flatMap((item) => stages.map((stage) => ({ item, stage })));
  const base = {
    version: 1,
    authorship: fixture.authorship,
    execute: options.execute,
    fixtureHash: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    model: config.model,
    providerName: config.providerName,
    capCny: options.cap,
    totalAvailableCells: 80,
    selectedCells: matrix.length,
    scope:
      '原创合成材料，复用生产教学与核验路径；不证明真人学习、首屏10秒、两周保持效果或所有模型的质量。参考答案不作为生成/核验提示。',
    metricDefinitions,
    metrics: {
      answerLeakageRate: null,
      mathErrorRate: null,
      gradingAgreement: null,
      verificationInterceptionRate: null,
      manuallyReviewed: 0,
    },
  };
  if (!options.execute)
    return {
      ...base,
      status: 'dry_run',
      requestCount: 0,
      estimatedCny: 0,
      message: '已校验完整20×4矩阵和显式配置；未读取密钥、未创建账本、未调用模型。',
      results: matrix.map(({ item, stage }) => ({
        caseId: item.id,
        stage,
        model: config.model,
        status: 'not_run',
        reference: item.reference,
        humanReview: humanReview(),
      })),
    };
  if (existsSync(options.workspace))
    throw new Error('真实评测必须使用尚不存在的新隔离账本目录，不能读入原有学习数据。');
  const key = process.env[config.apiKeyEnv];
  if (!key?.trim()) throw new Error('显式指定的密钥环境变量为空，未发送请求。');
  if (new URL(config.baseUrl).hostname.endsWith('.invalid'))
    throw new Error('请先将占位配置替换为明确选定的真实服务；未发送请求。');
  const store = await LearningStore.open(options.workspace);
  const results: Record<string, unknown>[] = [];
  let stopped = false;
  try {
    store.updateSettings({
      personalGoal: '',
      confirmedPreferences: '',
      providerName: config.providerName,
      baseUrl: config.baseUrl,
      model: config.model,
      monthlyBudgetCny: options.cap,
      inputPriceCnyPerMillion: config.inputPriceCnyPerMillion,
      outputPriceCnyPerMillion: config.outputPriceCnyPerMillion,
      priceUpdatedAt: config.priceUpdatedAt,
    });
    for (const { item, stage } of matrix) {
      if (stopped) {
        results.push({
          caseId: item.id,
          stage,
          model: config.model,
          status: 'not_run',
          reason: '前一格未完成，停止后续收费请求。',
          humanReview: humanReview(),
        });
        continue;
      }
      const beforeIds = new Set(store.list('usage').map((row) => row.id)),
        started = performance.now();
      let actual: unknown, error: string | undefined;
      try {
        actual = await evaluateCell(store, item, stage, key, options.cap, factory);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : '评测未完成';
        stopped = true;
      }
      const usage = store
        .list('usage')
        .filter((row) => !beforeIds.has(row.id) && row.entryType !== 'hold');
      if (usage.length && !usage.some((row) => row.validationStatus === 'valid')) stopped = true;
      results.push({
        caseId: item.id,
        stage,
        model: config.model,
        status: error ? 'error' : 'awaiting_human_review',
        durationMs: Math.round(performance.now() - started),
        requestCount: usage.length,
        estimatedCny: spend(usage),
        requests: usage,
        actual,
        error,
        reference: item.reference,
        humanReview: humanReview(),
      });
    }
    const usage = store.list('usage').filter((row) => row.entryType !== 'hold');
    return JSON.parse(
      JSON.stringify({
        ...base,
        status: stopped ? 'stopped_early' : 'awaiting_human_review',
        requestCount: usage.length,
        estimatedCny: spend(usage),
        results,
      })
        .split(key)
        .join('[redacted]'),
    );
  } finally {
    store.close();
  }
}

export async function main(args: string[]): Promise<void> {
  const options = parseProductEvaluationArgs(args);
  const report = await runProductEvaluation(options);
  writeValidationReport(options.report, report);
  process.stdout.write(
    JSON.stringify({
      status: report.status,
      execute: report.execute,
      selectedCells: report.selectedCells,
      requestCount: report.requestCount,
      estimatedCny: report.estimatedCny,
      report: options.report,
    }) + '\n',
  );
}
