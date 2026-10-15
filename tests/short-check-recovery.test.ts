import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningStore } from '../src/main/store';
import { LearningService } from '../src/main/learning-service';
import { reviewedTeaching } from './helpers/review-response';

const stores: LearningStore[] = [];
const roots: string[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const modes = ['diagnosis', 'delayed', 'transfer'] as const;
const defects = ['extra_criteria', 'extended', 'missing_size'] as const;
type Defect = (typeof defects)[number];
function plan(defect?: Defect) {
  const activity: Record<string, unknown> = {
    title: '比较单价',
    instruction: '甲包有3件，价格12元；乙包有5件，价格15元。哪包每件更便宜？说明依据。',
    kind: 'selection',
    rubric: ['比较同一单位的价格', '说明选择依据'],
    sourceIds: ['f'],
    assessmentBasis: 'source',
    workSize: 'short',
  };
  if (defect === 'extra_criteria')
    activity.rubric = [...(activity.rubric as string[]), '写出另一道例题'];
  if (defect === 'extended') activity.workSize = 'extended';
  if (defect === 'missing_size') delete activity.workSize;
  return {
    steps: [
      {
        action: 'check',
        title: '独立比较',
        content: '请说明比较依据。',
        sourceIds: ['f'],
        activity,
      },
    ],
  };
}
async function fixture(defect: Defect, recover = true) {
  const root = mkdtempSync(join(tmpdir(), 'reclimb-short-check-'));
  roots.push(root);
  const store = await LearningStore.open(root);
  stores.push(store);
  const now = new Date().toISOString();
  store.updateSettings({ monthlyBudgetCny: 100, studyMinutes: 60 });
  store.put('projects', {
    id: 'p',
    title: '比较单价',
    goal: '能按统一单位比较',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  store.put('materials', {
    id: 'm',
    projectId: 'p',
    title: '比较依据',
    kind: 'markdown',
    originalName: 'original.md',
    storedPath: '',
    importedAt: now,
    warnings: [],
    fragmentCount: 1,
    summary: '比较时先统一单位。',
  });
  store.put('fragments', {
    id: 'f',
    projectId: 'p',
    materialId: 'm',
    locator: '原创案例',
    ordinal: 0,
    text: '比较价格时应先换算为每件单价，再比较相同单位下的数值。',
  });
  store.put('capabilities', {
    id: 'c',
    projectId: 'p',
    title: '比较单价',
    description: '按相同单位比较',
    prerequisites: [],
    sourceIds: ['f'],
    order: 0,
  });
  const inputs: any[] = [];
  let generated = 0;
  const service = new LearningService(
    store,
    () => 'offline-test-key',
    () => ({
      complete: async (request) => {
        const input = JSON.parse(request.user);
        inputs.push(input);
        const response =
          input.operation === 'review_teaching'
            ? reviewedTeaching(input)
            : plan(++generated === 1 || !recover ? defect : undefined);
        return {
          text: JSON.stringify(response),
          inputTokens: 10,
          outputTokens: 10,
          usageKnown: true,
        };
      },
    }),
  );
  return { store, service, inputs };
}

describe('短验证的结构约束与有界恢复', () => {
  for (const mode of modes) {
    it.each(defects)(`${mode} 遇到 %s 后恢复一次，再独立核验才发布`, async (defect) => {
      const t = await fixture(defect);
      const session = await t.service.start('p', 'c', mode);
      expect(t.inputs).toHaveLength(3);
      expect(t.inputs[1].repair).toBeDefined();
      expect(t.inputs[2].operation).toBe('review_teaching');
      expect(session.activity.workSize).toBe('short');
      expect(session.activity.rubric).toHaveLength(2);
      expect(session.teaching?.current.action).toBe('check');
      expect(session.teaching?.upcoming).toEqual([]);
      expect(t.service.getVerification(session.id).canAssess).toBe(true);
      expect(t.store.list('evidence')).toEqual([]);
      expect(t.store.list('usage').filter((row) => row.kind === '生成学习活动')).toMatchObject([
        { validationStatus: 'invalid', publicationStatus: 'discarded', requestPhase: 'initial' },
        { validationStatus: 'valid', publicationStatus: 'published', requestPhase: 'repair' },
      ]);
    });
    it(`${mode} 两次仍超出限制就停止，不创建学习活动或能力证据`, async () => {
      const t = await fixture('extra_criteria', false);
      await expect(t.service.start('p', 'c', mode)).rejects.toThrow('格式恢复已停止');
      expect(t.inputs).toHaveLength(2);
      expect(t.inputs.some((input) => input.operation === 'review_teaching')).toBe(false);
      expect(t.store.list('sessions')).toEqual([]);
      expect(t.store.list('evidence')).toEqual([]);
      const generated = t.store.list('usage').filter((row) => row.kind === '生成学习活动');
      expect(generated).toHaveLength(2);
      expect(generated.every((row) => row.publicationStatus === 'discarded')).toBe(true);
    });
  }
});
