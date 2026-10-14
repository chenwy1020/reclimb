import SettingsCard from './SettingsCard';
import { useState } from 'react';
import { AlertTriangle, Clock3, RotateCcw, Trash2, X } from 'lucide-react';
import type { Project, WorkspaceSnapshot } from '../shared/types';
import { trashDaysRemaining, trashedProjects } from '../shared/projects';
import { Button, dateLabel } from './ui';

export function ProjectDeleteModal({
  snapshot,
  project,
  busy,
  onCancel,
  onConfirm,
}: {
  snapshot: WorkspaceSnapshot;
  project: Project;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const counts = {
    materials: snapshot.materials.filter((item) => item.projectId === project.id).length,
    sessions: snapshot.sessions.filter((item) => item.projectId === project.id).length,
    attempts: snapshot.attempts.filter((item) => item.projectId === project.id).length,
    evidence: snapshot.evidence.filter((item) => item.projectId === project.id).length,
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="modal project-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-delete-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">RECENTLY DELETED</span>
            <h2 id="project-delete-title">删除“{project.title}”？</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭删除确认"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={20} />
          </button>
        </div>
        <div className="project-delete-body">
          <span className="delete-warning-icon">
            <Trash2 size={24} />
          </span>
          <div>
            <p>项目会移到“最近删除”，学习材料和过程暂时完整保留。</p>
            <div className="delete-project-summary">
              <span>{counts.materials} 份材料</span>
              <span>{counts.sessions} 次学习</span>
              <span>{counts.attempts} 次尝试</span>
              <span>{counts.evidence} 条能力证据</span>
            </div>
            <p className="muted">
              你可以在设置中恢复。30 天后，系统会永久删除项目及其全部本机资料。
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <Button disabled={busy} onClick={onCancel}>
            暂不删除
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void onConfirm()}>
            <Trash2 size={15} />
            移到最近删除
          </Button>
        </div>
      </section>
    </div>
  );
}

export function ProjectTrashPanel({
  snapshot,
  busy,
  onRestore,
  onPurge,
  now = new Date(),
}: {
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  onRestore: (projectId: string) => Promise<unknown>;
  onPurge: (projectId: string) => Promise<unknown>;
  now?: Date;
}) {
  const [confirmingId, setConfirmingId] = useState('');
  const projects = trashedProjects(snapshot.projects);
  return (
    <SettingsCard
      className="project-trash-card"
      title="最近删除"
      description="删除后的项目保留 30 天，期间可以完整恢复。"
      icon={<Trash2 size={21} />}
      actions={
        <> {projects.length > 0 && <span className="trash-count">{projects.length}</span>} </>
      }
    >
      {projects.length === 0 ? (
        <p className="trash-empty">这里没有已删除的项目。</p>
      ) : (
        <div className="trash-project-list">
          {projects.map((project) => {
            const confirming = confirmingId === project.id;
            return (
              <article className="trash-project" key={project.id}>
                <div className="trash-project-main">
                  <strong>{project.title}</strong>
                  <span>
                    <Clock3 size={13} />
                    {dateLabel(project.trashedAt!)}移入 · {trashDaysRemaining(project, now)}{' '}
                    天后自动永久删除
                  </span>
                </div>
                {confirming ? (
                  <div className="trash-confirm" role="alert">
                    <AlertTriangle size={16} />
                    <span>永久删除后，材料、学习过程和能力证据都无法恢复。</span>
                    <Button disabled={busy} onClick={() => setConfirmingId('')}>
                      取消
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={async () => {
                        const result = await onPurge(project.id);
                        if (result) setConfirmingId('');
                      }}
                    >
                      确认永久删除
                    </Button>
                  </div>
                ) : (
                  <div className="trash-actions">
                    <Button disabled={busy} onClick={() => void onRestore(project.id)}>
                      <RotateCcw size={14} />
                      恢复项目
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmingId(project.id)}
                    >
                      <Trash2 size={14} />
                      永久删除
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}
