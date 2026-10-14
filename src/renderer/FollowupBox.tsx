import { useRef, useState } from 'react';
import { ArrowRight, MessageCircle, Sparkles } from 'lucide-react';
import type { RecordInputRequest, RecordedInputReceipt, WorkspaceSnapshot } from '../shared/types';
import { Button } from './ui';
import {
  LocalRecordNotice,
  responseAvailability,
  type RecordLocalInput,
  type RespondToInput,
} from './InputStatus';

import { InputRecord } from './InputRecord';
import { followupsForAnchor } from './followup-placement';

type Anchor = NonNullable<RecordInputRequest['followup']>;
/** Each composer belongs to one visible source; saving never changes the main task draft. */
export function FollowupBox({
  sessionId,
  anchor,
  title,
  snapshot,
  busy,
  onRecord,
  allowExample = false,
  onRespond = async () => {},
  onSettings = () => {},
  onSource = () => {},
  composerOnly = false,
}: {
  sessionId: string;
  anchor: Pick<Anchor, 'kind' | 'id' | 'teachingVersionId' | 'historyIndex'>;
  title: string;
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  onRecord: RecordLocalInput;
  allowExample?: boolean;
  onRespond?: RespondToInput;
  onSettings?: () => void;
  onSource?: (id: string) => void;
  composerOnly?: boolean;
}) {
  const session = snapshot.sessions.find((item) => item.id === sessionId);
  const entries = session && !composerOnly ? followupsForAnchor(session, anchor) : [];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<Anchor['intent']>('question');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<RecordedInputReceipt>();
  const lock = useRef(false);
  const request = useRef<{ fingerprint: string; id: string } | undefined>(undefined);
  async function save() {
    if (lock.current || !text.trim()) return;
    const captured = text;
    const fingerprint = JSON.stringify([
      sessionId,
      anchor.kind,
      anchor.id,
      anchor.teachingVersionId,
      anchor.historyIndex,
      intent,
      text,
    ]);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await onRecord(sessionId, {
        requestId: request.current.id,
        kind: 'explore',
        text,
        followup: { ...anchor, intent },
      });
      if (result) {
        request.current = undefined;
        setReceipt(result);
        setText((current) => (current === captured ? '' : current));
      }
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="followup-box" data-followup-kind={anchor.kind} data-followup-id={anchor.id}>
      <div className="followup-actions">
        <Button
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setIntent('question');
          }}
        >
          <MessageCircle size={14} />
          {anchor.kind === 'source' ? '从这段原文提问' : '继续追问'}
        </Button>
        {allowExample && (
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(true);
              setIntent('example');
              setReceipt(undefined);
              setText(
                (current) =>
                  current ||
                  '请围绕这段内容给一个具体示范，解释关键步骤，再留一个可以由我自己尝试的相邻问题。',
              );
            }}
          >
            <Sparkles size={14} />
            为这段举例
          </Button>
        )}
      </div>
      {open && (
        <section className="followup-composer" aria-label={'针对' + title + '继续学习'}>
          <p className="followup-target">
            针对：<strong>{title}</strong>
          </p>
          <p className="quiet-note">
            沿着这段内容继续讨论，原任务与作答草稿保留。提出问题不算获得答案帮助；实际返回的提示或示范会如实记录。
          </p>
          <textarea
            aria-label="针对这段的追问"
            rows={3}
            maxLength={100000}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setReceipt(undefined);
            }}
            placeholder="指出具体哪一步、哪句话没跟上，或写下你的解释、反例与想法…"
          />
          <div className="followup-actions">
            <Button variant="primary" disabled={saving || !text.trim()} onClick={() => void save()}>
              {saving ? '正在保存…' : '保存并继续讨论'}
              <ArrowRight size={14} />
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              收起追问
            </Button>
          </div>
          <LocalRecordNotice
            receipt={receipt}
            recording={saving}
            error={error}
            availability={responseAvailability(snapshot, busy)}
            kind="explore"
          />
        </section>
      )}
      {session && entries.length > 0 && (
        <section className="inline-followup-thread" aria-label="这段内容的连续追问">
          {entries.map((message, index) => (
            <div key={message.inputId} className="inline-followup-turn">
              <p className="quiet-note">
                第 {index + 1} 条{message.followup?.parentMessageId ? ' · 沿着所选回应继续' : ''}
              </p>
              <InputRecord
                message={message}
                session={session}
                snapshot={snapshot}
                busy={busy}
                onRespond={onRespond}
                onSettings={onSettings}
                onSource={onSource}
                renderFollowup={(r) => (
                  <FollowupBox
                    sessionId={sessionId}
                    anchor={{ kind: 'message', id: r.id }}
                    title={r.text.slice(0, 70)}
                    snapshot={snapshot}
                    busy={busy}
                    onRecord={onRecord}
                    onRespond={onRespond}
                    onSettings={onSettings}
                    onSource={onSource}
                    allowExample
                    composerOnly
                  />
                )}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
