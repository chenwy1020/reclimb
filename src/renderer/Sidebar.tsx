import { evidenceStanding } from '../shared/reliability-state';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import {
  BookOpen,
  Compass,
  FolderOpen,
  Home,
  Mountain,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sprout,
  ShieldCheck,
} from 'lucide-react';
import type { WorkspaceSnapshot } from '../shared/types';
import { visibleProjects } from '../shared/projects';
import type { Page } from './ui';
import { createSidebarController } from './sidebar-state';
export const navigationPages: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: '学习首页', icon: Home },
  { id: 'route', label: '学习路线', icon: Compass },
  { id: 'desk', label: '学习桌', icon: BookOpen },
  { id: 'evidence', label: '能力记录', icon: Sprout },
  { id: 'validation', label: '独立验证', icon: ShieldCheck },
  { id: 'settings', label: '设置', icon: Settings },
];
export function useSidebar() {
  const [controller] = useState(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      /* The sidebar also works without persistent preferences. */
    }
    return createSidebarController(storage);
  });
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => () => controller.clearTimers(), [controller]);
  return {
    controller,
    state,
    style: {
      '--sidebar-expanded-width': state.width + 'px',
      '--sidebar-reserved-width': state.mode === 'pinned' ? state.width + 'px' : '64px',
    } as CSSProperties,
  };
}
export default function Sidebar({
  snapshot,
  page,
  projectId,
  navigate,
  onCreate,
  layout,
  modalOpen,
}: {
  snapshot: WorkspaceSnapshot;
  page: Page;
  projectId: string;
  navigate: (page: Page, projectId?: string) => Promise<void>;
  onCreate: () => void;
  layout: ReturnType<typeof useSidebar>;
  modalOpen: boolean;
}) {
  const { controller: c, state } = layout;
  const projects = visibleProjects(snapshot.projects);
  const projectIds = new Set(projects.map((project) => project.id));
  const evidenceCount = snapshot.evidence.filter(
    (e) => projectIds.has(e.projectId) && evidenceStanding(snapshot, e).effective,
  ).length;
  const root = useRef<HTMLElement>(null),
    reveal = useRef<HTMLButtonElement>(null);
  const skipFocus = useRef(false);
  function focusContent() {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.main')?.focus({ preventScroll: true }),
    );
  }
  async function go(next: Page, id?: string) {
    await navigate(next, id);
    focusContent();
  }
  function dismiss() {
    c.escape();
    skipFocus.current = true;
    reveal.current?.focus({ preventScroll: true });
    queueMicrotask(() => {
      skipFocus.current = false;
    });
  }
  useEffect(() => {
    if (!state.expanded || state.mode === 'pinned') return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        c.focusLeave();
        c.pointerLeave();
      }
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [state.expanded, state.mode, c]);
  return (
    <aside
      ref={root}
      className={
        'sidebar immersive-sidebar ' +
        (state.expanded ? 'is-expanded' : 'is-collapsed') +
        (state.mode === 'pinned' ? ' is-pinned' : '') +
        (state.resizing ? ' is-resizing' : '')
      }
      aria-label="学习空间导航"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') c.pointerEnter();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') c.pointerLeave();
      }}
      onFocusCapture={() => {
        if (!skipFocus.current) c.focusEnter();
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) c.focusLeave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !modalOpen && state.mode === 'auto' && state.expanded) {
          e.preventDefault();
          e.stopPropagation();
          dismiss();
        }
      }}
    >
      <div className="sidebar-head">
        <button
          className="brand"
          onClick={() => void go('home')}
          aria-label="重登，回到学习首页"
          title="重登，回到学习首页"
        >
          <span className="brand-mark">
            <Mountain size={25} strokeWidth={1.8} />
          </span>
          <span className="sidebar-detail">
            <strong>
              重登<span className="brand-dot">.</span>
            </strong>
            <small>把所学，变成自己的能力</small>
          </span>
        </button>
      </div>
      <div className="sidebar-layout-controls">
        <button
          ref={reveal}
          className="sidebar-reveal"
          aria-label={state.expanded ? '收起导航' : '展开导航'}
          title={state.expanded ? '收起导航（Escape）' : '展开导航'}
          aria-expanded={state.expanded}
          aria-controls="sidebar-project-list"
          onPointerDown={() => {
            skipFocus.current = true;
          }}
          onPointerCancel={() => {
            skipFocus.current = false;
          }}
          onClick={() => {
            skipFocus.current = false;
            if (state.mode === 'pinned') c.togglePinned();
            c.toggleOpen();
            if (c.getSnapshot().expanded) c.focusEnter();
          }}
        >
          {state.expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          <span className="sidebar-detail">
            {state.mode === 'pinned' ? '固定展开中' : '自动收起'}
          </span>
        </button>
        {state.expanded && (
          <button
            className="sidebar-pin"
            aria-label={state.mode === 'pinned' ? '取消固定，自动收起' : '固定展开导航'}
            title={state.mode === 'pinned' ? '取消固定，自动收起' : '固定展开导航'}
            aria-pressed={state.mode === 'pinned'}
            onClick={() => c.togglePinned()}
          >
            {state.mode === 'pinned' ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
        )}
      </div>
      <div className="sidebar-label sidebar-detail">我的学习空间</div>
      <nav aria-label="主导航">
        {navigationPages.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={'nav-item ' + (page === id ? 'active' : '')}
            aria-label={label}
            aria-current={page === id ? 'page' : undefined}
            title={label}
            onClick={() => void go(id)}
          >
            <Icon size={19} strokeWidth={1.7} />
            <span className="sidebar-detail">{label}</span>
            {id === 'evidence' && evidenceCount > 0 && (
              <span className="nav-count sidebar-detail">{evidenceCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-divider" />
      {!state.expanded && (
        <button
          className="sidebar-project-reveal"
          title="展开学习项目"
          aria-label="展开学习项目"
          onClick={() => {
            c.focusEnter();
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLElement>('.project-nav,.projects-label button')
                ?.focus(),
            );
          }}
        >
          <FolderOpen size={19} />
        </button>
      )}
      <section
        id="sidebar-project-list"
        className="sidebar-project-section"
        hidden={!state.expanded}
      >
        <div className="sidebar-label projects-label">
          学习项目
          <button title="新建学习项目" aria-label="新建学习项目" onClick={onCreate}>
            <Plus size={16} />
          </button>
        </div>
        <div className="sidebar-projects">
          {projects.length ? (
            projects.map((p, i) => (
              <button
                key={p.id}
                className={
                  'project-nav ' +
                  (p.id === projectId && page !== 'home' && page !== 'settings' ? 'selected' : '')
                }
                onClick={() => void go('route', p.id)}
                title={p.title}
              >
                <span className={'project-dot dot-' + (i % 3)} />
                <span>{p.title}</span>
                {p.status === 'paused' && <Pause size={12} />}
              </button>
            ))
          ) : (
            <p className="sidebar-empty">
              一本书、一门课，
              <br />
              或一种你想获得的能力。
            </p>
          )}
        </div>
      </section>
      <div className="sidebar-bottom">
        <div className="local-note sidebar-detail">
          <ShieldCheck size={15} />
          <span>学习记录，保存在你的电脑</span>
        </div>
      </div>
      {state.expanded && (
        <div
          className="sidebar-resize"
          role="separator"
          tabIndex={0}
          aria-label="调整导航宽度"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={360}
          aria-valuenow={state.width}
          aria-valuetext={state.width + ' 像素'}
          title="拖动调整宽度；左右方向键微调"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            c.beginResize();
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) c.setWidth(e.clientX);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            c.endResize();
          }}
          onPointerCancel={() => c.endResize()}
          onLostPointerCapture={() => c.endResize()}
          onKeyDown={(e) => {
            const width =
              e.key === 'ArrowLeft'
                ? state.width - 8
                : e.key === 'ArrowRight'
                  ? state.width + 8
                  : e.key === 'Home'
                    ? 220
                    : e.key === 'End'
                      ? 360
                      : null;
            if (width !== null) {
              e.preventDefault();
              c.setWidth(width);
              c.endResize();
            }
          }}
        />
      )}
    </aside>
  );
}
