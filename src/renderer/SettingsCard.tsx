import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './settings-card.css';

/** Keep editors mounted when folded: a disclosure must never discard unsaved input. */
export default function SettingsCard({
  title,
  description,
  icon,
  actions,
  children,
  className = '',
  defaultOpen = false,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen),
    contentId = useId(),
    descriptionId = useId();
  return (
    <section className={'settings-card collapsible-settings-card ' + className} aria-label={title}>
      <div className="settings-card-heading">
        <h2>
          <button
            type="button"
            className="settings-card-toggle"
            aria-label={title}
            aria-expanded={open}
            aria-controls={contentId}
            aria-describedby={descriptionId}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="soft-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="settings-card-label">
              <span>{title}</span>
              <span className="settings-card-description" id={descriptionId}>
                {description}
              </span>
            </span>
            <ChevronDown className="settings-card-chevron" size={18} aria-hidden="true" />
          </button>
        </h2>
      </div>
      <div id={contentId} className="settings-card-content" hidden={!open}>
        {actions && <div className="settings-card-actions">{actions}</div>}
        {children}
      </div>
    </section>
  );
}
