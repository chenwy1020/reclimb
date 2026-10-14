import type { Usage } from './types';

const counter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A missing report is unknown, not a measured cache miss. */
export function validatedCacheCounters(
  inputTokens: unknown,
  hit: unknown,
  miss?: unknown,
): { cacheHitTokens?: number; cacheMissTokens?: number } {
  if (!counter(inputTokens) || !counter(hit) || hit > inputTokens) return {};
  const remaining = miss === undefined ? inputTokens - hit : miss;
  if (!counter(remaining) || remaining !== inputTokens - hit) return {};
  return { cacheHitTokens: hit, cacheMissTokens: remaining };
}

const localMonth = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
export function summarizeCacheUsage(rows: readonly Usage[], month = localMonth(new Date())) {
  const calls = rows.filter(
    (row) =>
      row.entryType !== 'hold' &&
      row.status !== 'reserved' &&
      localMonth(new Date(row.createdAt)) === month,
  );
  let reportedCalls = 0,
    hitTokens = 0,
    missTokens = 0,
    durationCalls = 0,
    totalDurationMs = 0;
  for (const row of calls) {
    if (row.cacheHitTokens !== undefined && row.cacheMissTokens !== undefined) {
      const measured = validatedCacheCounters(
        row.inputTokens,
        row.cacheHitTokens,
        row.cacheMissTokens,
      );
      if (measured.cacheHitTokens !== undefined) {
        reportedCalls++;
        hitTokens += measured.cacheHitTokens;
        missTokens += measured.cacheMissTokens!;
      }
    }
    if (counter(row.durationMs)) {
      durationCalls++;
      totalDurationMs += row.durationMs;
    }
  }
  return {
    calls: calls.length,
    reportedCalls,
    unreportedCalls: calls.length - reportedCalls,
    hitTokens,
    missTokens,
    inputTokens: calls.reduce(
      (sum, row) => sum + (counter(row.inputTokens) ? row.inputTokens : 0),
      0,
    ),
    outputTokens: calls.reduce(
      (sum, row) => sum + (counter(row.outputTokens) ? row.outputTokens : 0),
      0,
    ),
    estimatedCny: calls.reduce(
      (sum, row) =>
        sum + (Number.isFinite(row.estimatedCny) && row.estimatedCny >= 0 ? row.estimatedCny : 0),
      0,
    ),
    repairCalls: calls.filter((row) => row.requestPhase === 'repair').length,
    unknownPhaseCalls: calls.filter((row) => row.requestPhase === undefined).length,
    hitRate: hitTokens + missTokens > 0 ? hitTokens / (hitTokens + missTokens) : undefined,
    durationCalls,
    meanDurationMs: durationCalls > 0 ? totalDurationMs / durationCalls : undefined,
  };
}
export type CacheGrouping = 'model' | 'operation' | 'thread';
export function groupCacheUsage(
  rows: readonly Usage[],
  by: CacheGrouping,
  month = localMonth(new Date()),
) {
  const groups = new Map<string, { label: string; rows: Usage[] }>();
  for (const row of rows) {
    if (
      row.entryType === 'hold' ||
      row.status === 'reserved' ||
      localMonth(new Date(row.createdAt)) !== month
    )
      continue;
    const key =
      by === 'operation'
        ? row.kind
        : by === 'thread'
          ? (row.threadId ?? 'unlinked')
          : JSON.stringify([
              row.modelProfileId ?? 'legacy',
              row.providerName ?? '',
              row.requestedModel ?? row.model,
            ]);
    const label =
      by === 'operation'
        ? row.kind
        : by === 'thread'
          ? row.threadId
            ? '追问支线 ' + row.threadId.slice(0, 8)
            : '未记录支线 / 其他操作'
          : (row.profileName ?? '旧版配置') + ' · ' + (row.requestedModel ?? row.model);
    const group = groups.get(key) ?? { label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups]
    .map(([key, group]) => ({ key, label: group.label, ...summarizeCacheUsage(group.rows, month) }))
    .sort((a, b) => b.inputTokens - a.inputTokens || a.key.localeCompare(b.key));
}
