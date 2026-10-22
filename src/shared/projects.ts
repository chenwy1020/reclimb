import type { Project } from './types';

export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const projectTrashPayload = (id: string): { id: string } => ({ id });

export function isTrashed(project: Project): boolean {
  return typeof project.trashedAt === 'string';
}
export function visibleProjects(projects: Project[]): Project[] {
  return projects.filter((project) => !isTrashed(project));
}
export function trashedProjects(projects: Project[]): Project[] {
  return projects.filter(isTrashed).sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!));
}
export function trashDaysRemaining(project: Project, now = new Date()): number {
  if (!project.trashedAt) return 0;
  const elapsed = now.getTime() - Date.parse(project.trashedAt);
  if (!Number.isFinite(elapsed)) return 0;
  return Math.max(
    0,
    Math.min(
      TRASH_RETENTION_DAYS,
      Math.ceil((TRASH_RETENTION_MS - elapsed) / (24 * 60 * 60 * 1000)),
    ),
  );
}
