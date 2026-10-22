import { afterEach, describe, expect, it, vi } from 'vitest';
import { monthSpend } from '../src/main/budget';
import { budgetUsed } from '../src/renderer/ui';
import type { Usage, WorkspaceSnapshot } from '../src/shared/types';

type BudgetRow = Pick<Usage, 'createdAt' | 'status' | 'estimatedCny' | 'entryType'>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('local calendar budget', () => {
  it.each([
    ['Asia/Shanghai', '2026-09-30T16:00:00.000Z', '2026-09-30T15:59:59.999Z'],
    ['America/Los_Angeles', '2026-10-01T07:00:00.000Z', '2026-10-01T06:59:59.999Z'],
  ])('resets at local midnight in %s and keeps outstanding holds', (timezone, start, before) => {
    vi.stubEnv('TZ', timezone);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(start));
    const rows: BudgetRow[] = [
      { createdAt: before, status: 'completed', estimatedCny: 20 },
      { createdAt: start, status: 'completed', estimatedCny: 2 },
      { createdAt: start, status: 'uncertain', estimatedCny: 3 },
      { createdAt: before, status: 'reserved', estimatedCny: 4, entryType: 'hold' },
      { createdAt: start, status: 'failed', estimatedCny: 50 },
    ];
    expect(monthSpend(rows)).toBe(9);
    expect(budgetUsed({ usage: rows } as WorkspaceSnapshot)).toBe(9);
  });

  it('uses local timestamps for an explicitly selected month', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai');
    expect(monthSpend([
      { createdAt: '2026-09-30T16:00:00.000Z', status: 'completed', estimatedCny: 2 },
      { createdAt: '2026-09-30T15:59:59.999Z', status: 'completed', estimatedCny: 20 },
    ], '2026-10')).toBe(2);
  });
});
