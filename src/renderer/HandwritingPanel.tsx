import OperationStatus from './OperationStatus';
import { flushAdditionalLocalDrafts } from './local-save-queue';
import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Tablet, X, RefreshCw, Check, Link as LinkIcon } from 'lucide-react';
import type { DesktopAction, Session, WorkspaceSnapshot } from '../shared/types';
import type {
  HandwritingServerStatus,
  HandwritingSubmission,
  HandwritingTarget,
} from '../shared/handwriting';
import { inkPageDataUrl } from '../shared/ink-svg';
import { Button, timeLabel, type Run } from './ui';
import type { RecordLocalInput } from './InputStatus';
import { HandwritingFeedback } from './HandwritingFeedback';
import { RichText } from './RichText';
import './handwriting.css';

type SavedInk = { record: HandwritingSubmission; target?: HandwritingTarget; pageCount: number };
export function HandwritingPanel({
  session,
  snapshot,
  busy,
  run,
  onSettings,
  onSource,
  onRecord,
}: {
  session: Session;
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  run: Run;
  onSettings: () => void;
  onSource: (id: string) => void;
  onRecord: RecordLocalInput;
}) {
  const [open, setOpen] = useState(false),
    [state, setState] = useState<HandwritingServerStatus>({ running: false, urls: [] }),
    [addresses, setAddresses] = useState<string[]>([]),
    [host, setHost] = useState(''),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false),
    [records, setRecords] = useState<SavedInk[]>([]),
    [selected, setSelected] = useState<HandwritingSubmission>(),
    [pageIndex, setPageIndex] = useState(0);
  const closing = useRef(false),
    viewRequest = useRef(0),
    sessionRef = useRef(session.id),
    generation = useRef(0),
    actionLock = useRef(false);
  sessionRef.current = session.id;
  const qr = useMemo(() => {
    if (!state.urls[0]) return '';
    const image = qrcode(0, 'M');
    image.addData(state.urls[0]);
    image.make();
    return image.createDataURL(5, 12);
  }, [state.urls[0]]);
  useEffect(() => {
    const current = ++generation.current;
    setSelected(undefined);
    setRecords([]);
    setError('');
    let active = true,
      fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const [status, ink] = await Promise.all([
          window.learning.request<HandwritingServerStatus>('handwriting.status'),
          window.learning.request<SavedInk[]>('handwriting.list', { sessionId: session.id }),
        ]);
        if (active && current === generation.current) {
          setState(status);
          setRecords(ink);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '连接状态暂时无法读取。');
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session.id]);
  useEffect(() => {
    if (open)
      void window.learning
        .request<string[]>('handwriting.addresses')
        .then((items) => {
          setAddresses(items);
          setHost((previous) => (items.includes(previous) ? previous : (items[0] ?? '127.0.0.1')));
        })
        .catch((e) => setError(e.message));
  }, [open]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>('[aria-label="关闭手写原稿"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (
        !document
          .querySelectorAll('.modal')
          .item(document.querySelectorAll('.modal').length - 1)
          ?.classList.contains('handwriting-viewer')
      )
        return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        void closeViewer();
      }
      if (event.key === 'Tab') {
        const controls = [
          ...document.querySelectorAll<HTMLElement>(
            '.handwriting-viewer button:not([disabled]),.handwriting-viewer summary,.handwriting-viewer textarea:not([disabled]),.handwriting-viewer input:not([disabled]),.handwriting-viewer select:not([disabled])',
          ),
        ].filter((el) => el.offsetParent !== null);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [selected?.id]);
  async function action(name: DesktopAction, payload: unknown = {}) {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    setError('');
    try {
      const status = await window.learning.request<HandwritingServerStatus>(name, payload);
      setState(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成。');
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  }
  async function closeViewer() {
    if (closing.current) return;
    closing.current = true;
    try {
      await flushAdditionalLocalDrafts();
      setSelected(undefined);
    } catch (e) {
      setError('核对草稿尚未保存，原稿保持打开：' + (e as Error).message);
    } finally {
      closing.current = false;
    }
  }
  async function show(record: HandwritingSubmission) {
    const id = session.id,
      request = ++viewRequest.current;
    setError('');
    try {
      await flushAdditionalLocalDrafts();
      const full = await window.learning.request<HandwritingSubmission>('handwriting.read', {
        id: record.id,
      });
      if (sessionRef.current === id && request === viewRequest.current) {
        setSelected(full);
        setPageIndex(0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '原稿暂时无法读取。');
    }
  }
  function sendTarget() {
    const step = session.teaching?.current,
      activity = step?.activity ?? session.activity;
    void action('handwriting.target', {
      sessionId: session.id,
      expected: {
        taskId: step?.taskId ?? activity.id ?? session.id,
        stepId: step?.id,
        teachingVersionId: activity.teachingVersionId ?? session.teachingVersionId,
      },
    });
  }
  const original = selected
    ? records.find((item) => item.record.id === selected.id)?.target
    : undefined;
  return (
    <section className="handwriting-panel" aria-label="iPad 手写原稿">
      <div className="handwriting-heading">
        <div>
          <h3>
            <Tablet size={19} />用 iPad 写下推导
          </h3>
          <p>电脑读材料，平板写推导或上传截图。原稿先保存，再识别、核对并获取反馈。</p>
        </div>
        <Button onClick={() => setOpen(!open)} aria-expanded={open}>
          iPad 手写
        </Button>
      </div>
      {!selected && (
        <OperationStatus
          snapshot={snapshot}
          projectId={session.projectId}
          handwritingIds={records.map((item) => item.record.id)}
          kinds={['handwriting_recognition']}
          busy={busy || working}
          run={run}
        />
      )}
      {error && (
        <p className="handwriting-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <div className="handwriting-pairing">
          <p className="handwriting-network-note">
            仅在可信的同一局域网使用。此连接不加密；开启期间只向确认的设备提供你发送的任务。关闭连接会撤销设备授权。
          </p>
          {!state.running ? (
            <div className="handwriting-controls">
              <label>
                电脑连接地址
                <select
                  aria-label="电脑连接地址"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                >
                  {(addresses.length ? addresses : ['127.0.0.1']).map((address) => (
                    <option key={address}>{address}</option>
                  ))}
                </select>
              </label>
              <Button
                variant="primary"
                disabled={working}
                onClick={() => void action('handwriting.start', { host })}
              >
                开启 iPad 连接
              </Button>
            </div>
          ) : (
            <>
              {state.error && <p role="status">{state.error}</p>}
              <div className="handwriting-connection">
                <div>{qr && <img className="handwriting-qr" src={qr} alt="iPad 配对二维码" />}</div>
                <div>
                  <strong>用 iPad 相机扫码，再在电脑确认短码</strong>
                  <p>也可复制配对链接到 iPad 的 Safari。链接含临时配对凭证，请勿转发。</p>
                  <input
                    aria-label="iPad 配对链接"
                    readOnly
                    value={state.urls[0] ?? ''}
                    onFocus={(e) => e.target.select()}
                  />
                  <div className="handwriting-controls">
                    <Button
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(state.urls[0] ?? '')
                          .catch(() => setError('请选中配对链接手动复制。'))
                      }
                    >
                      <LinkIcon size={14} />
                      复制配对链接
                    </Button>
                    <Button disabled={working} onClick={() => void action('handwriting.renew')}>
                      <RefreshCw size={14} />
                      换一个配对码
                    </Button>
                  </div>
                  <small>
                    配对码过期后可重新生成。防火墙询问时仅允许可信的专用网络；软件不会自动修改规则。
                  </small>
                </div>
              </div>
              {state.pending && (
                <div className="handwriting-confirm">
                  <strong>设备「{state.pending.name}」请求连接</strong>
                  <p>
                    确认 iPad 显示的短码也是 <b>{state.pending.code}</b> 后再允许。
                  </p>
                  <div className="handwriting-controls">
                    <Button
                      variant="primary"
                      disabled={working}
                      onClick={() => void action('handwriting.approve', { id: state.pending!.id })}
                    >
                      允许这台 iPad
                    </Button>
                    <Button
                      disabled={working}
                      onClick={() => void action('handwriting.reject', { id: state.pending!.id })}
                    >
                      拒绝连接
                    </Button>
                  </div>
                </div>
              )}
              <p role="status">
                {state.connected ? '已连接：' + state.connected.name : '等待 iPad 连接。'}
              </p>
              <div className="handwriting-controls">
                <Button variant="primary" disabled={working} onClick={sendTarget}>
                  发送当前任务到 iPad
                </Button>
                <Button disabled={working} onClick={() => void action('handwriting.stop')}>
                  关闭 iPad 连接
                </Button>
              </div>
              {state.target && (
                <p>
                  iPad 当前收到：{state.target.projectTitle} · {state.target.title}
                  。电脑切换任务不会替换已保存的草稿。
                </p>
              )}
            </>
          )}
        </div>
      )}
      {records.length > 0 && (
        <div className="handwriting-history">
          <h4>已经收到的手写原稿 · {records.length} 份</h4>
          {records
            .slice()
            .reverse()
            .map(({ record, target, pageCount }) => (
              <article key={record.id}>
                <div>
                  <strong>{target?.title ?? '原任务'}</strong>
                  <p>
                    <Check size={14} />
                    已保存 · {pageCount} 页 · {timeLabel(record.submittedAt)} · 原稿保留
                  </p>
                </div>
                <Button onClick={() => void show(record)}>查看原稿</Button>
              </article>
            ))}
        </div>
      )}
      {selected && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) void closeViewer();
          }}
        >
          <section
            className="modal handwriting-viewer"
            role="dialog"
            aria-modal="true"
            aria-label="手写原稿"
          >
            <div className="modal-heading">
              <div>
                <h2>我的手写原稿</h2>
                <p>
                  {original?.title} · {timeLabel(selected.submittedAt)}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭手写原稿"
                onClick={() => void closeViewer()}
              >
                <X />
              </button>
            </div>
            {error && (
              <p className="handwriting-error" role="alert">
                {error}
              </p>
            )}
            <p>学习者原稿 · 原任务与提交时的帮助条件一并保留。识别与确认文本显示在下方。</p>
            {original && (
              <details>
                <summary>核对当时的任务</summary>
                <RichText text={original.instruction} />
              </details>
            )}
            <div className="handwriting-controls">
              <Button disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>
                上一页
              </Button>
              <span>
                {pageIndex + 1} / {selected.pages.length}
              </span>
              <Button
                disabled={pageIndex === selected.pages.length - 1}
                onClick={() => setPageIndex(pageIndex + 1)}
              >
                下一页
              </Button>
            </div>
            <img
              className="handwriting-original"
              src={inkPageDataUrl(selected.pages[pageIndex])}
              alt={'手写原稿第 ' + (pageIndex + 1) + ' 页'}
            />
            {selected.note && <RichText text={selected.note} />}
            <OperationStatus
              snapshot={snapshot}
              projectId={session.projectId}
              handwritingIds={[selected.id]}
              kinds={['handwriting_recognition']}
              busy={busy || working}
              run={run}
            />
            <HandwritingFeedback
              key={selected.id}
              record={selected}
              session={session}
              snapshot={snapshot}
              busy={busy}
              run={run}
              onSettings={onSettings}
              onSource={onSource}
              onRecord={onRecord}
            />
          </section>
        </div>
      )}
    </section>
  );
}
