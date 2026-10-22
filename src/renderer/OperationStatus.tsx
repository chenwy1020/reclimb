import type { Operation } from '../shared/remediation';
import type { WorkspaceSnapshot } from '../shared/types';
import { Button, type Run } from './ui';
const labels = {
  saved: '已保存',
  running: '处理中',
  awaiting_confirmation: '等待核对',
  result_saved: '结果已保存',
  completed: '已完成',
  interrupted: '已中断',
  stale: '已过期',
};
export default function OperationStatus({
  snapshot,
  projectId,
  sessionId,
  handwritingIds,
  kinds,
  busy,
  run,
}: {
  snapshot: WorkspaceSnapshot;
  projectId: string;
  sessionId?: string;
  handwritingIds?: string[];
  kinds?: Operation['kind'][];
  busy: boolean;
  run: Run;
}) {
  const operations = (snapshot.operations ?? [])
    .filter(
      (o) =>
        o.projectId === projectId &&
        (!kinds || kinds.includes(o.kind)) &&
        (!sessionId || o.refs.sessionId === sessionId) &&
        (!handwritingIds ||
          (!!o.refs.handwritingId && handwritingIds.includes(o.refs.handwritingId))) &&
        o.phase !== 'completed',
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  if (!operations.length) return null;
  return (
    <section className="operation-status" aria-label="已保存操作的进度">
      {operations.map((operation) => (
        <article key={operation.id}>
          <strong>{labels[operation.phase]}</strong>
          <p>{operation.savedSummary}</p>
          {operation.failureReason && <p>{operation.failureReason}</p>}
          {operation.failureStage && (
            <small>
              中断阶段：
              {operation.failureStage === 'local_commit'
                ? '本机提交'
                : operation.failureStage === 'model_call'
                  ? '模型调用'
                  : operation.failureStage === 'binding_check'
                    ? '依据版本检查'
                    : operation.failureStage}
            </small>
          )}
          {operation.callIds.some((id) =>
            snapshot.usage.some(
              (u) => u.id === id && (u.status === 'uncertain' || u.status === 'reserved'),
            ),
          ) && <p>上次请求费用尚不确定，仍计入预算预留。</p>}
          <div>
            <Button onClick={() => void run('workspace.snapshot')}>重新读取（不调用模型）</Button>
            {operation.phase === 'result_saved' && (
              <Button
                disabled={busy}
                onClick={() => void run('operation.resume', { operationId: operation.id })}
              >
                完成本地保存（不调用模型）
              </Button>
            )}
            {(operation.phase === 'interrupted' || operation.phase === 'saved') && (
              <Button
                disabled={busy}
                onClick={() => void run('operation.retry', { operationId: operation.id })}
              >
                重新请求（可能收费）
              </Button>
            )}
          </div>
          {operation.phase === 'stale' && (
            <small>原结果保留归档，不能重新采用；请基于修订后的内容另做尝试。</small>
          )}
        </article>
      ))}
    </section>
  );
}
