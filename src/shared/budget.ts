import type { Usage } from './types';

type BudgetRow = Pick<Usage, 'createdAt' | 'status' | 'estimatedCny' | 'entryType'>;

function localMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Use the same local calendar and outstanding reservations in the UI and request gate. */
export function monthSpend(rows: BudgetRow[], month = localMonth(new Date())): number {
  return rows
    .filter(
      (row) =>
        row.status !== 'failed' &&
        (localMonth(new Date(row.createdAt)) === month ||
          (row.entryType === 'hold' && row.status === 'reserved')),
    )
    .reduce((sum, row) => sum + Math.max(0, row.estimatedCny), 0);
}
