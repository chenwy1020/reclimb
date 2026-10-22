import { useRef, useState } from 'react';
import type { Fragment, WorkspaceSnapshot } from '../shared/types';
import { Button, type Run } from './ui';
export default function LocalLearningControls({
  snapshot,
  fragment,
  run,
}: {
  snapshot: WorkspaceSnapshot;
  fragment: Fragment;
  run: Run;
}) {
  const [question, setQuestion] = useState(''),
    [extra, setExtra] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    lock = useRef(false),
    request = useRef<{ key: string; id: string } | undefined>(undefined);
  const available = snapshot.fragments.filter(
    (f) => f.materialId === fragment.materialId && f.id !== fragment.id,
  );
  async function start(intent: 'explain' | 'practice') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const sourceIds = [fragment.id, ...extra.filter((id) => available.some((f) => f.id === id))],
      key = JSON.stringify([sourceIds, intent, question]);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    try {
      await run('lesson.startFromSources', {
        projectId: fragment.projectId,
        requestId: request.current.id,
        sourceIds,
        intent,
        question,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="local-start" aria-label="从当前材料开始">
      <strong>从这一段开始</strong>
      <label>
        此刻想弄清什么（可选）
        <textarea
          aria-label="当前材料的问题"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="可以直接解释，也可以写下卡住的一步"
        />
      </label>
      {available.length > 0 && (
        <details>
          <summary>一起选择相邻页段</summary>
          {available.map((f) => (
            <label className="checkbox-label" key={f.id}>
              <input
                type="checkbox"
                checked={extra.includes(f.id)}
                onChange={(e) =>
                  setExtra(e.target.checked ? [...extra, f.id] : extra.filter((id) => id !== f.id))
                }
              />
              {f.locator}
            </label>
          ))}
        </details>
      )}
      <div className="validation-toolbar">
        <Button disabled={busy} onClick={() => void start('explain')}>
          解释这里
        </Button>
        <Button disabled={busy} onClick={() => void start('practice')}>
          围绕这里练习
        </Button>
      </div>
      <small>来源与问题会先保存在本机。解释与练习需要调用模型；无需先建立全书路线。</small>
    </section>
  );
}
