import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import HomePage from '../src/renderer/HomePage';
import EvidencePage from '../src/renderer/EvidencePage';
import type { WorkspaceSnapshot } from '../src/shared/types';

vi.mock('../src/renderer/PdfPageViewer', () => ({ default: () => null }));
const at = '2026-09-08T00:00:00.000Z';
const activity = {
  title: '解释理由的练习',
  instruction: '说明理由',
  kind: 'argument' as const,
  rubric: ['解释理由'],
  sourceIds: [],
  assessmentBasis: 'ai' as const,
};
const assessment = {
  outcome: 'met' as const,
  feedback: '给出了理由',
  criteria: [{ criterion: '解释理由', result: 'met' as const, reason: '成立' }],
  limitations: [],
  sourceIds: [],
};
function snapshot(): WorkspaceSnapshot {
  return {
    projects: [
      {
        id: 'p',
        title: '学习项目',
        goal: '解释理由',
        status: 'active',
        createdAt: at,
        updatedAt: at,
      },
    ],
    capabilities: [
      {
        id: 'c',
        projectId: 'p',
        title: '解释概念原因',
        description: '',
        prerequisites: [],
        sourceIds: [],
        order: 0,
      },
    ],
    sessions: [
      {
        id: 's',
        projectId: 'p',
        capabilityId: 'c',
        mode: 'practice',
        status: 'active',
        activity,
        messages: [],
        helpEvents: [],
        helpLevel: 0,
        draft: '',
        checkpoint: '',
        nextStep: '',
        createdAt: at,
        updatedAt: at,
      },
    ],
    attempts: [
      {
        id: 'a',
        projectId: 'p',
        sessionId: 's',
        text: '保留的亲自作答',
        submittedAt: at,
        helpLevel: 0,
        requestId: 'r',
      },
    ],
    evidence: [
      {
        id: 'e1',
        projectId: 'p',
        capabilityId: 'c',
        sessionId: 's',
        attemptId: 'a',
        status: 'independent',
        helpLevel: 0,
        assessment,
        createdAt: at,
      },
      {
        id: 'e2',
        projectId: 'p',
        capabilityId: 'c',
        sessionId: 's',
        attemptId: 'a',
        status: 'assisted',
        helpLevel: 2,
        assessment,
        createdAt: at,
      },
    ],
    reviews: [0, 1, 2, 3].map((i) => ({
      id: 'return-' + i,
      projectId: 'p',
      capabilityId: 'c',
      fromSessionId: 's',
      kind: 'delayed' as const,
      dueAt: at,
      status: 'pending' as const,
      schedule: { version: 1 as const, step: 0, intervalDays: 1, needsRelearning: i === 0 },
    })),
    materials: [],
    fragments: [],
    usage: [],
    sourceTranscriptions: [],
    teachingVersions: [],
    taskReviews: [],
    disputes: [],
    corrections: [],
    answerExposures: [],
    routeVersions: [],
    learningUnits: [],
    learningPositions: [],
    teachingObservations: [],
    understandingDrafts: [],
    readingLayouts: [],
    settings: {
      providerName: 'test',
      baseUrl: 'https://example.test',
      model: 'm',
      monthlyBudgetCny: 10,
      inputPriceCnyPerMillion: 1,
      outputPriceCnyPerMillion: 1,
      priceUpdatedAt: at,
      hasApiKey: false,
      personalGoal: '',
      studyMinutes: 8,
      confirmedPreferences: '',
    },
    dataDirectory: 'local',
  };
}
const home = (s: WorkspaceSnapshot) =>
  renderToStaticMarkup(
    createElement(HomePage, {
      snapshot: s,
      busy: false,
      onCreate: vi.fn(),
      navigate: vi.fn(),
      onSeed: vi.fn(),
      onReview: vi.fn(),
      run: vi.fn(),
    }),
  );
afterEach(() => vi.restoreAllMocks());

it('shows the full due workload and a session-size suggestion without hiding remaining due items', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-09T00:00:00.000Z'));
  const html = home(snapshot());
  expect(html).toContain('今天该回访 4 项，约 16 分钟');
  expect(html).toContain('这次先做 2 项');
  expect(html.match(/title="开始这次回访"/g)).toHaveLength(4);
  expect(html).toContain('本周按期独立通过');
});

it('puts the built-in example and direct AI service connection in the new-user entry', () => {
  const s = snapshot();
  s.projects = [];
  s.sessions = [];
  s.reviews = [];
  s.evidence = [];
  const html = home(s);
  expect(html).toContain('先试内置示例');
  expect(html).toContain('连接 AI 服务');
  expect(html).toContain('无需自建服务器');
});

it('groups evidence by capability, preserves original work, and leaves unearned stages unmarked', () => {
  const s = snapshot();
  const html = renderToStaticMarkup(
    createElement(EvidencePage, {
      snapshot: s,
      project: s.projects[0],
      evidence: s.evidence,
      busy: false,
      onSource: vi.fn(),
      onSession: vi.fn(),
      onReview: vi.fn(),
      run: vi.fn(),
    }),
  );
  expect(html.match(/data-capability-id="c"/g)).toHaveLength(1);
  expect(html.match(/class="evidence-card /g)).toHaveLength(2);
  expect(html).toContain('保留的亲自作答');
  expect(html).toMatch(/class="[^"]*stage-reached[^"]*"[^>]*>独立/);
  expect(html).toMatch(/class="[^"]*stage-pending[^"]*"[^>]*>迁移/);
  expect(html).toContain('下次回访');
  expect(html).toContain('先复习这次暴露的缺口');
});
