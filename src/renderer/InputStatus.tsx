import { LoaderCircle, ShieldCheck } from 'lucide-react';
import type { RecordedInputReceipt, RecordInputRequest, WorkspaceSnapshot } from '../shared/types';
import { budgetUsed, timeLabel } from './ui';
export type RecordLocalInput = (
  sessionId: string,
  input: RecordInputRequest,
) => Promise<RecordedInputReceipt | undefined>;
export type RespondToInput = (sessionId: string, inputId: string) => Promise<void>;
export function responseAvailability(snapshot: WorkspaceSnapshot, busy: boolean) {
  if (busy)
    return 'AI 正在处理另一项请求。这条记录会保存在本机，稍后由你点击获取回应，不会自动排队。';
  if (!snapshot.settings.hasApiKey)
    return '尚未配置 AI 服务。这条记录会保存在本机，配置后可继续获取回应。';
  if (
    snapshot.settings.monthlyBudgetCny <= 0 ||
    budgetUsed(snapshot) >= snapshot.settings.monthlyBudgetCny * 0.9
  )
    return '本机预算暂不允许新的 AI 请求。这条记录会保存在本机，调整预算后可继续。';
  return '';
}
export function LocalRecordNotice({
  receipt,
  recording,
  error,
  availability,
  canAssess,
  kind = 'attempt',
}: {
  receipt?: RecordedInputReceipt;
  recording: boolean;
  error: string;
  availability: string;
  canAssess?: boolean;
  kind?: 'attempt' | 'note' | 'explore';
}) {
  return (
    <div className="local-record-notice" aria-live="polite">
      {recording ? (
        <p>
          <LoaderCircle size={13} className="spin" />
          正在保存在本机…
        </p>
      ) : receipt ? (
        <p className="record-saved">
          <ShieldCheck size={14} />
          已保存在本机 · {timeLabel(receipt.savedAt)}
        </p>
      ) : null}
      {error && (
        <p className="inline-error" role="alert">
          本机记录尚未保存：{error}
        </p>
      )}
      <p>
        先保存在本机，再获取 AI 回应。
        {kind === 'attempt' && !canAssess
          ? '当前暂不评分，可讨论思路；这次记录不作为能力证据。'
          : kind !== 'attempt'
            ? '笔记与探索不作为能力证据。'
            : '评价会按这次任务与帮助条件单独保留。'}
      </p>
      {availability && <p>{availability}</p>}
    </div>
  );
}
