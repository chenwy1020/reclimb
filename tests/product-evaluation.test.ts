import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixturePath = resolve('docs/fixtures/product-evaluation/cases.json');
describe('原创教学质量评测集', () => {
  it('20个独立片段均包含正确、等价、错误、缺条件和诱导泄题参考', () => {
    expect(existsSync(fixturePath), '应提供可离线审查的原创案例').toBe(true);
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(fixture.authorship).toBe('original');
    expect(fixture.cases).toHaveLength(20);
    expect(new Set(fixture.cases.map((item: { id: string }) => item.id)).size).toBe(20);
    for (const item of fixture.cases) {
      expect(item.source.text.length).toBeGreaterThan(20);
      expect(item.reference.correct).not.toBe(item.reference.equivalent);
      expect(item.reference.correct).not.toBe(item.reference.incorrect);
      expect(item.reference.missingCondition.task.length).toBeGreaterThan(5);
      expect(item.reference.missingCondition.expected.length).toBeGreaterThan(5);
      expect(item.reference.leakageProbe.length).toBeGreaterThan(10);
    }
  });
});

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, vi } from 'vitest';
import {
  parseProductEvaluationArgs,
  runProductEvaluation,
} from '../scripts/validation/product-evaluation';
import type { ModelProvider } from '../src/main/provider';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function options(execute = false, price = 1) {
  const root = mkdtempSync(join(tmpdir(), 'reclimb-product-eval-'));
  roots.push(root);
  const config = join(root, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      providerName: 'offline fixture',
      baseUrl: 'https://provider.test/v1',
      model: 'fixture-model',
      apiKeyEnv: 'RECLIMB_PRODUCT_TEST_KEY',
      inputPriceCnyPerMillion: price,
      outputPriceCnyPerMillion: price,
      priceUpdatedAt: '仅自编测试价格',
    }),
  );
  return {
    workspace: join(root, 'new-isolated-ledger'),
    config,
    fixture: fixturePath,
    report: join(root, 'report.json'),
    cap: 3,
    execute,
  };
}

describe('真实评测的显式授权与离线契约', () => {
  it('默认只校验80格，不需要密钥、不创建账本、不将未审指标记为0', async () => {
    vi.stubEnv('RECLIMB_PRODUCT_TEST_KEY', '');
    const input = options();
    const report = await runProductEvaluation(input);
    expect(report).toMatchObject({
      status: 'dry_run',
      selectedCells: 80,
      totalAvailableCells: 80,
      requestCount: 0,
      metrics: {
        answerLeakageRate: null,
        mathErrorRate: null,
        gradingAgreement: null,
        verificationInterceptionRate: null,
        manuallyReviewed: 0,
      },
    });
    expect(report.results).toHaveLength(80);
    expect(existsSync(input.workspace)).toBe(false);
    expect(existsSync(input.report)).toBe(false);
  });
  it('必须明确execute，拒绝超额cap与旧文档中的10元', () => {
    const input = options();
    const args = [
      '--workspace',
      input.workspace,
      '--config',
      input.config,
      '--fixture',
      input.fixture,
      '--report',
      input.report,
      '--cap',
      '3',
    ];
    expect(parseProductEvaluationArgs(args)).toMatchObject({ execute: false, cap: 3 });
    expect(
      parseProductEvaluationArgs([
        ...args,
        '--execute',
        '--case',
        'linear-water',
        '--stage',
        'feedback',
      ]),
    ).toMatchObject({ execute: true, caseId: 'linear-water', stage: 'feedback' });
    expect(() => parseProductEvaluationArgs([...args.slice(0, -1), '10'])).toThrow('不超过 3');
    expect(() => parseProductEvaluationArgs([...args, '--stage', 'unknown'])).toThrow('stage');
  });
  it('执行前缺少密钥或目标账本已存在时停止，保留原数据', async () => {
    const input = options(true);
    vi.stubEnv('RECLIMB_PRODUCT_TEST_KEY', '');
    await expect(runProductEvaluation(input)).rejects.toThrow('环境变量为空');
    expect(existsSync(input.workspace)).toBe(false);
    const occupied = { ...input, workspace: join(input.config, '..') };
    await expect(runProductEvaluation(occupied)).rejects.toThrow();
    expect(readFileSync(input.config, 'utf8')).toContain('fixture-model');
  });
  it('新目录、明确测试密钥和合成provider时，真正运行核验后评分并保留人工待审', async () => {
    const input = { ...options(true), caseId: 'linear-water', stage: 'feedback' as const };
    vi.stubEnv('RECLIMB_PRODUCT_TEST_KEY', 'offline-test-secret');
    let calls = 0;
    const inputs: any[] = [];
    const provider: ModelProvider = {
      complete: async (request) => {
        calls++;
        const value = JSON.parse(request.user);
        inputs.push(value);
        const output =
          value.operation === 'review_teaching'
            ? {
                status: 'ready',
                summary: '仅用于本机流程测试',
                issues: [],
                privateSolution: '5+2×4=13，未达到容量上限。',
                branches: [],
                exposureRelations: [],
                sourceChecks: [],
                assessmentFindings: [],
                mathChecks: [],
              }
            : {
                outcome: 'met',
                feedback: '正确给出13升，并说明尚未达到容量上限。',
                criteria: value.activity.rubric.map((criterion: string, index: number) => ({
                  criterion,
                  criterionId: value.activity.rubricIds[index],
                  result: 'met',
                  reason: '给出了关系和边界条件',
                })),
                limitations: [],
                sourceIds: value.activity.sourceIds,
              };
        return {
          text: JSON.stringify(output),
          inputTokens: 10,
          outputTokens: 10,
          usageKnown: true,
        };
      },
    };
    const report = await runProductEvaluation(input, () => provider);
    expect(report).toMatchObject({
      status: 'awaiting_human_review',
      selectedCells: 1,
      requestCount: 2,
      estimatedCny: 0.00004,
    });
    expect(calls).toBe(2);
    expect(inputs[0].instruction).toContain('不得增加公开题干和rubric未要求的必述句');
    expect(inputs[0].instruction).toContain('不能仅凭正确结果替代');
    expect(inputs[1].instruction).toContain('公式、数值关系或等价表述已经清楚表达');
    expect(inputs[1].instruction).toContain('缺少所要求推理');
    expect(inputs[1].instruction).toContain('只有全部标准满足才met');
    const result = (report.results as any[])[0];
    expect(result.actual).toMatchObject({
      answerVariant: 'correct',
      responseMode: 'assessment',
      canAssess: true,
    });
    expect(result.actual.assessments[0].assessment.outcome).toBe('met');
    expect(result.humanReview).toMatchObject({
      status: 'pending',
      gradingAgrees: null,
      mathematicalError: null,
    });
    expect(JSON.stringify(report)).not.toContain('offline-test-secret');
  });
  it('预算预留不足时不调用provider，停止后续格且不伪报完成', async () => {
    const input = {
      ...options(true, 100000),
      caseId: 'linear-water',
      stage: 'feedback' as const,
      cap: 0.01,
    };
    vi.stubEnv('RECLIMB_PRODUCT_TEST_KEY', 'offline-test-secret');
    let calls = 0;
    const report = await runProductEvaluation(input, () => ({
      complete: async () => {
        calls++;
        throw new Error('不应发送');
      },
    }));
    expect(calls).toBe(0);
    expect(report).toMatchObject({ status: 'stopped_early', requestCount: 0, estimatedCny: 0 });
    expect((report.results as any[])[0].status).toBe('error');
  });
  it.each([false, true])(
    '区分信息不足的合法判断题与强求唯一值的缺条件题（强求唯一值=%s）',
    async (requiresUniqueValue) => {
      const input = { ...options(true), caseId: 'linear-water', stage: 'feedback' as const };
      vi.stubEnv('RECLIMB_PRODUCT_TEST_KEY', 'offline-test-secret');
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
      const item = fixture.cases[0];
      item.source = {
        title: '独立性与信息是否充分',
        text: '独立事件的交概率等于边缘概率之积。未给独立性时，仅凭两个边缘概率不能确定交概率。',
      };
      item.activity.instruction =
        '已知P(A)=0.6、P(B)=0.5，未说明是否独立。能否直接推出P(A∩B)=0.3？说明依据。';
      item.activity.rubric = ['给出由题设支持的判断', '说明独立性条件与推理依据'];
      item.reference.correct = '不能仅凭这些信息推出0.3；独立性未给定，交概率可以不同。';
      item.reference.missingCondition = {
        task: '已知P(A)=0.6、P(B)=0.5，未说明是否独立。请给出P(A∩B)唯一的数值答案。',
        expected: '条件不足，不能给出唯一值；交概率可在0.1到0.5之间。',
      };
      item.feedbackVariant = requiresUniqueValue ? 'missing_condition' : 'correct';
      input.fixture = join(input.config, '..', 'paired-fixture.json');
      writeFileSync(input.fixture, JSON.stringify(fixture));
      const inputs: any[] = [];
      const report = await runProductEvaluation(input, () => ({
        complete: async (request) => {
          const value = JSON.parse(request.user);
          inputs.push(value);
          let response: unknown;
          if (value.operation === 'review_teaching') {
            response = {
              status: 'ready',
              summary: '合成核验结果：独立性未给定，须按当前问题区分判断任务与唯一数值任务。',
              issues: [],
              privateSolution:
                '边缘概率只能给出交概率在0.1到0.5之间，0.3不是唯一可能。可以确定“不能由此推出0.3”，不能确定交概率的唯一值。',
              branches: [
                {
                  id: 'information',
                  condition: requiresUniqueValue
                    ? '确定交概率所需的独立性或联合分布'
                    : '题设没有给定独立性',
                  applicability: requiresUniqueValue ? 'unknown' : 'applies',
                  // Empty indices must never bypass the unknown-condition gate.
                  criterionIndexes: requiresUniqueValue ? [] : [0, 1],
                  expectedBehavior: requiresUniqueValue
                    ? '补充联合分布后才能给唯一值。'
                    : '认可不能直接推出及其依据。',
                },
              ],
              exposureRelations: [],
              sourceChecks: [],
              assessmentFindings: [],
              mathChecks: [],
            };
          } else if (value.operation === 'discuss_input') {
            response = {
              text: '已保留条件不足这一判断；当前题目要求唯一值，先补充必要条件再评价。',
              sourceIds: value.activity.sourceIds,
              scope: 'current_task',
            };
          } else {
            response = {
              outcome: 'met',
              feedback: '明确区分了可否推出与实际概率的数值。',
              criteria: value.activity.rubric.map((criterion: string, index: number) => ({
                criterion,
                criterionId: value.activity.rubricIds[index],
                result: 'met',
                reason: '给出题设支持的判断与独立性依据。',
              })),
              limitations: [],
              sourceIds: value.activity.sourceIds,
            };
          }
          return {
            text: JSON.stringify(response),
            inputTokens: 10,
            outputTokens: 10,
            usageKnown: true,
          };
        },
      }));
      expect(report.status).toBe('awaiting_human_review');
      expect(inputs).toHaveLength(2);
      expect(inputs[0].instruction).toContain('信息不足本身可以是合法结论');
      expect(inputs[0].instruction).toContain('仍须标记相关unknown并阻断');
      expect(inputs[0].instruction).toContain('不为不影响当前判断的额外假设制造unknown');
      const actual = (report.results as any[])[0].actual;
      if (requiresUniqueValue) {
        expect(actual).toMatchObject({
          canAssess: false,
          responseMode: 'discussion',
          syntheticEvidenceCount: 0,
        });
        expect(actual.verification[0]).toMatchObject({
          status: 'uncertain',
          blockingReasons: [{ code: 'condition_unknown' }],
        });
        expect(actual.assessments.every((attempt: any) => !attempt.assessment)).toBe(true);
        expect(inputs[1].operation).toBe('discuss_input');
      } else {
        expect(actual).toMatchObject({
          canAssess: true,
          responseMode: 'assessment',
          syntheticEvidenceCount: 1,
        });
        expect(actual.verification[0].status).toBe('ready');
        expect(actual.assessments[0].assessment.outcome).toBe('met');
        expect(inputs[1].answer).toBe(item.reference.correct);
      }
    },
  );
});
