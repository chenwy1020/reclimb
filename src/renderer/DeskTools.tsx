import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui';

export function DeskTools({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    function keydown(event: KeyboardEvent) {
      // Source and handwriting dialogs keep their own keyboard interactions.
      if (
        Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(
          (dialog) => dialog !== panel.current && dialog.getClientRects().length > 0,
        )
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      } else if (event.key === 'Tab') {
        const items = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]',
          ) ?? [],
        ).filter((item) => {
          if (!item.checkVisibility()) return false;
          for (let parent = item.parentElement; parent; parent = parent.parentElement) {
            if (
              parent instanceof HTMLDetailsElement &&
              !parent.open &&
              !parent.querySelector(':scope > summary')?.contains(item)
            )
              return false;
          }
          return true;
        });
        const first = items[0],
          last = items.at(-1);
        if (!first) {
          event.preventDefault();
          panel.current?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === panel.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === panel.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return (
    <div
      className="desk-tools-backdrop"
      hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        id="desk-tools"
        className="desk-tools"
        ref={panel}
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-label="学习工具"
        tabIndex={-1}
      >
        <header className="desk-tools-heading">
          <div>
            <h2>学习工具</h2>
            <p>材料、帮助和记录在这里。关闭后继续当前任务。</p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="关闭学习工具">
            <X size={18} />
          </Button>
        </header>
        <div className="desk-tools-content">{children}</div>
      </section>
    </div>
  );
}
