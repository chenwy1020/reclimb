import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeProductEvaluation } from '../scripts/validation/summarize-product-evaluation';

const caseIds = JSON.parse(
  readFileSync('docs/fixtures/product-evaluation/cases.json', 'utf8'),
).cases.map((item: { id: string }) => item.id) as string[];
const stages = ['explain', 'attempt', 'feedback', 'review'];
function report() {
  return {
    version: 1,
    execute: true,
    fixtureHash: 'original-fixture',
    model: 'offline-fixture-model',
    results: caseIds.flatMap((caseId, index) =>
      stages.map((stage) => ({
        caseId,
        stage,
        model: 'offline-fixture-model',
        status: 'awaiting_human_review',
        durationMs: (index + 1) * 100,
        requestCount: 1,
        estimatedCny: 0.01,
        requests: [{ id: caseId + '/' + stage, durationMs: 100 }],
        actual:
          stage === 'feedback'
            ? {
                responseMode: 'assessment',
                assessments: [{ assessment: { outcome: 'met' } }],
                canAssess: true,
              }
            : { publicOutput: { text: '原创测试结果' }, canAssess: true },
      })),
    ),
  };
}

describe('真实评测结果汇总', () => {
  it('80格均有返回时仍保留未人工核对的全部质量指标为null', () => {
    const summary = summarizeProductEvaluation([report()], caseIds);
    expect(summary).toMatchObject({
      expectedCells: 80,
      reportedCells: 80,
      returnedCells: 80,
      errorCells: 0,
      requestCount: 80,
      missingCells: [],
    });
    expect(summary.estimatedCny).toBeCloseTo(0.8);
    expect(summary.metricsByReviewer.human.gradingAgreement).toEqual({
      numerator: 0,
      denominator: 0,
      value: null,
    });
    expect(summary.metricsByReviewer.agent.mathErrorRate).toEqual({
      numerator: 0,
      denominator: 0,
      value: null,
    });
    expect(summary.reviewTemplate).toHaveLength(80);
  });
  it('拒绝重复格和重复请求，避免重试被重复统计或计费', () => {
    const value = report();
    expect(() => summarizeProductEvaluation([value, value], caseIds)).toThrow('重复评测格');
    value.results[1].requests[0].id = value.results[0].requests[0].id;
    expect(() => summarizeProductEvaluation([value], caseIds)).toThrow('重复');
  });
  it('案例编号相同但材料内容已变时，不能把报告套入另一版参考', () => {
    expect(() => summarizeProductEvaluation([report()], caseIds, [], 'different-fixture')).toThrow(
      '与汇总材料版本不一致',
    );
    expect(
      summarizeProductEvaluation([report()], caseIds, [], 'original-fixture').reportedCells,
    ).toBe(80);
  });
  it('缺失和失败明确列出，不将失败当作已审查的正确结果', () => {
    const value = report();
    value.results.pop();
    const failing = value.results[0];
    value.results[0] = { ...failing, status: 'error', actual: undefined } as any;
    const summary = summarizeProductEvaluation([value], caseIds);
    expect(summary).toMatchObject({
      reportedCells: 79,
      returnedCells: 78,
      errorCells: 1,
      missingCells: ['absolute-value/review'],
    });
    expect(summary.reviewTemplate).toHaveLength(78);
  });
  it('代理评阅与人工评分一致率分开，讨论不能进入评分分母', () => {
    const value = report(),
      template = summarizeProductEvaluation([value], caseIds).reviewTemplate.find(
        (item) => item.caseId === 'linear-water' && item.stage === 'feedback',
      )!;
    const reviewed = {
      ...template,
      reviewer: '独立测试评阅',
      reviewed: true,
      gradingApplicable: true,
      gradingAgrees: true,
      mathApplicable: true,
      mathError: false,
      notes: '核对13升及容量条件，逐项评分一致。',
    };
    const summary = summarizeProductEvaluation([value], caseIds, [reviewed]);
    expect(summary.metricsByReviewer.agent.gradingAgreement).toEqual({
      numerator: 1,
      denominator: 1,
      value: 1,
    });
    expect(summary.metricsByReviewer.human.gradingAgreement.value).toBeNull();
    const feedback = value.results.find(
      (item) => item.caseId === 'linear-water' && item.stage === 'feedback',
    )!;
    feedback.actual = { responseMode: 'discussion', canAssess: false } as any;
    expect(() => summarizeProductEvaluation([value], caseIds, [reviewed])).toThrow(
      '不能纳入评分一致分母',
    );
  });
});
