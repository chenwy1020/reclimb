import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { EVALUATION_STAGES, evaluationFixtureSchema } from './product-evaluation';
import { writeValidationReport } from './live-validation';

const reviewSchema = z
  .object({
    caseId: z.string().min(1),
    stage: z.enum(EVALUATION_STAGES),
    reviewerKind: z.enum(['human', 'agent']),
    reviewer: z.string().min(1),
    reviewed: z.boolean(),
    leakageApplicable: z.boolean().nullable(),
    answerLeaked: z.boolean().nullable(),
    mathApplicable: z.boolean().nullable(),
    mathError: z.boolean().nullable(),
    gradingApplicable: z.boolean().nullable(),
    gradingAgrees: z.boolean().nullable(),
    blockingApplicable: z.boolean().nullable(),
    correctlyBlocked: z.boolean().nullable(),
    notes: z.string(),
  })
  .strict();
export type QualityReview = z.infer<typeof reviewSchema>;
const requestSchema = z
  .object({
    id: z.string(),
    durationMs: z.number().nonnegative().optional(),
    reportedModel: z.string().optional(),
  })
  .passthrough();
const cellSchema = z
  .object({
    caseId: z.string(),
    stage: z.enum(EVALUATION_STAGES),
    model: z.string(),
    status: z.enum(['awaiting_human_review', 'error', 'not_run']),
    durationMs: z.number().nonnegative().optional(),
    requestCount: z.number().int().nonnegative().optional(),
    estimatedCny: z.number().nonnegative().optional(),
    requests: z.array(requestSchema).optional(),
    actual: z
      .object({
        responseMode: z.string().optional(),
        canAssess: z.boolean().optional(),
        assessments: z
          .array(z.object({ assessment: z.unknown().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
    error: z.string().optional(),
    reference: z.unknown().optional(),
  })
  .passthrough();
const reportSchema = z
  .object({
    version: z.literal(1),
    execute: z.literal(true),
    fixtureHash: z.string(),
    model: z.string(),
    results: z.array(cellSchema),
  })
  .passthrough();
type Cell = z.infer<typeof cellSchema>;
const keyOf = (value: { caseId: string; stage: string }) => value.caseId + '/' + value.stage;
const ratio = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
const percentile = (values: number[], percent: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(percent * values.length) - 1)]
    : null;

export function summarizeProductEvaluation(
  reports: unknown[],
  caseIds: string[],
  reviewValues: unknown[] = [],
  expectedFixtureHash?: string,
) {
  if (caseIds.length !== 20 || new Set(caseIds).size !== 20)
    throw new Error('汇总必须使用20个独立原创案例。');
  const parsed = reports.map((report) => reportSchema.parse(report));
  if (new Set(parsed.map((report) => report.fixtureHash)).size > 1)
    throw new Error('不能混合不同版本的评测材料。');
  if (expectedFixtureHash && parsed.some((report) => report.fixtureHash !== expectedFixtureHash))
    throw new Error('报告与汇总材料版本不一致。');
  if (new Set(parsed.map((report) => report.model)).size > 1)
    throw new Error('不同请求模型应分别汇总。');
  const expected = new Set(
    caseIds.flatMap((caseId) => EVALUATION_STAGES.map((stage) => keyOf({ caseId, stage }))),
  );
  const cells = new Map<string, Cell>();
  const requestIds = new Set<string>();
  for (const report of parsed)
    for (const cell of report.results) {
      const key = keyOf(cell);
      if (!expected.has(key)) throw new Error('报告包含评测集之外的案例：' + key);
      if (cell.model !== report.model) throw new Error('单格请求模型与报告模型不一致。');
      if (cells.has(key)) throw new Error('存在重复评测格；请明确选择要纳入的尝试报告：' + key);
      if ((cell.requestCount ?? 0) !== (cell.requests?.length ?? 0))
        throw new Error('请求计数与逐请求记录不一致：' + key);
      for (const request of cell.requests ?? []) {
        if (requestIds.has(request.id)) throw new Error('请求记录重复，不能重复计费。');
        requestIds.add(request.id);
      }
      cells.set(key, cell);
    }
  const reviews = reviewValues.map((value) => reviewSchema.parse(value));
  const reviewedKeys = new Set<string>();
  for (const review of reviews) {
    const cell = cells.get(keyOf(review)),
      key = review.reviewerKind + ':' + keyOf(review);
    if (reviewedKeys.has(key)) throw new Error('同一类评阅者不能重复计数一个评测格。');
    reviewedKeys.add(key);
    if (!cell) throw new Error('评分表引用了不存在的评测格。');
    if (!review.reviewed) {
      if (
        [
          review.leakageApplicable,
          review.answerLeaked,
          review.mathApplicable,
          review.mathError,
          review.gradingApplicable,
          review.gradingAgrees,
          review.blockingApplicable,
          review.correctlyBlocked,
        ].some((value) => value !== null)
      )
        throw new Error('未评阅格的质量判断必须全部为 null。');
      continue;
    }
    if (!cell.actual || cell.status !== 'awaiting_human_review')
      throw new Error('未返回有效结果的格不能计为质量评阅完成。');
    if (!review.notes.trim()) throw new Error('已评阅格必须记录判断依据。');
    if (
      review.gradingApplicable === true &&
      (cell.actual.responseMode !== 'assessment' ||
        !cell.actual.assessments?.some((attempt) => !!attempt.assessment))
    )
      throw new Error('讨论或没有实际评分的结果不能纳入评分一致分母。');
    if (review.leakageApplicable === true && cell.stage === 'feedback')
      throw new Error('反馈阶段发生在作答后，不能冒充作答前泄题分母。');
    for (const [applicable, judgment] of [
      [review.leakageApplicable, review.answerLeaked],
      [review.mathApplicable, review.mathError],
      [review.gradingApplicable, review.gradingAgrees],
      [review.blockingApplicable, review.correctlyBlocked],
    ]) {
      if (applicable !== true && judgment !== null)
        throw new Error('不适用或尚未判断适用性的指标不能填写通过/失败。');
    }
  }
  const metrics = Object.fromEntries(
    (['human', 'agent'] as const).map((kind) => {
      const selected = reviews.filter((review) => review.reviewerKind === kind && review.reviewed);
      const score = (applicable: keyof QualityReview, judgment: keyof QualityReview) => {
        const usable = selected.filter(
          (review) => review[applicable] === true && typeof review[judgment] === 'boolean',
        );
        return ratio(usable.filter((review) => review[judgment] === true).length, usable.length);
      };
      return [
        kind,
        {
          reviewedCells: selected.length,
          answerLeakageRate: score('leakageApplicable', 'answerLeaked'),
          mathErrorRate: score('mathApplicable', 'mathError'),
          gradingAgreement: score('gradingApplicable', 'gradingAgrees'),
          verificationInterceptionRate: score('blockingApplicable', 'correctlyBlocked'),
        },
      ];
    }),
  );
  const values = [...cells.values()],
    attempted = values.filter((cell) => cell.status !== 'not_run');
  const durations = attempted.flatMap((cell) =>
    cell.durationMs === undefined ? [] : [cell.durationMs],
  );
  return {
    version: 1,
    model: parsed[0]?.model ?? null,
    fixtureHash: parsed[0]?.fixtureHash ?? null,
    expectedCells: 80,
    reportedCells: cells.size,
    returnedCells: values.filter((cell) => cell.status === 'awaiting_human_review' && cell.actual)
      .length,
    errorCells: values.filter((cell) => cell.status === 'error').length,
    skippedCells: values.filter((cell) => cell.status === 'not_run').length,
    missingCells: [...expected].filter((key) => !cells.has(key)),
    requestCount: requestIds.size,
    estimatedCny: values.reduce((sum, cell) => sum + (cell.estimatedCny ?? 0), 0),
    latencyMs: {
      measuredCells: durations.length,
      median: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
      totalCellDuration: durations.reduce((sum, value) => sum + value, 0),
    },
    stageCounts: Object.fromEntries(
      EVALUATION_STAGES.map((stage) => [
        stage,
        {
          returned: values.filter(
            (cell) =>
              cell.stage === stage && cell.status === 'awaiting_human_review' && cell.actual,
          ).length,
          errors: values.filter((cell) => cell.stage === stage && cell.status === 'error').length,
        },
      ]),
    ),
    metricsByReviewer: metrics,
    interpretation:
      'agent 仅为代理按原文与独立参考复核，不是人工评分一致率；human 分母为0时保留null。实际服务账单可能与保守费用估算不同。总格耗时相加不是并发运行的墙钟耗时。',
    failures: values
      .filter((cell) => cell.status === 'error')
      .map((cell) => ({
        caseId: cell.caseId,
        stage: cell.stage,
        error: cell.error,
        requestCount: cell.requestCount,
      })),
    reviewTemplate: values
      .filter((cell) => cell.status === 'awaiting_human_review' && cell.actual)
      .map((cell) => ({
        caseId: cell.caseId,
        stage: cell.stage,
        reviewerKind: 'agent',
        reviewer: '待填写评阅者',
        reviewed: false,
        leakageApplicable: null,
        answerLeaked: null,
        mathApplicable: null,
        mathError: null,
        gradingApplicable: null,
        gradingAgrees: null,
        blockingApplicable: null,
        correctlyBlocked: null,
        notes: '',
      })),
  };
}

function read(file: string): unknown {
  if (!isAbsolute(file)) throw new Error('汇总输入须为明确绝对路径。');
  const bytes = readFileSync(file);
  if (bytes.byteLength > 8_000_000) throw new Error('单个汇总输入超过8 MB。');
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
export async function main(args: string[]) {
  if (
    args.length !== 4 ||
    args[0] !== '--manifest' ||
    args[2] !== '--report' ||
    !isAbsolute(args[3]) ||
    !args[3].endsWith('.json')
  )
    throw new Error('需要 --manifest 绝对路径 --report 新的绝对路径.json。');
  const manifest = z
    .object({
      fixture: z.string(),
      reports: z.array(z.string()).min(1).max(80),
      reviews: z.string().optional(),
    })
    .strict()
    .parse(read(args[1]));
  const fixture = evaluationFixtureSchema.parse(read(manifest.fixture));
  const reviews = manifest.reviews ? z.array(reviewSchema).parse(read(manifest.reviews)) : [];
  const summary = summarizeProductEvaluation(
    manifest.reports.map(read),
    fixture.cases.map((item) => item.id),
    reviews,
    createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
  );
  writeValidationReport(args[3], summary);
  process.stdout.write(
    JSON.stringify({
      reportedCells: summary.reportedCells,
      returnedCells: summary.returnedCells,
      errorCells: summary.errorCells,
      missingCells: summary.missingCells.length,
      requestCount: summary.requestCount,
      estimatedCny: summary.estimatedCny,
    }) + '\n',
  );
}
