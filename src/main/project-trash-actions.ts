import { z } from 'zod';

export type ProjectTrashAction = 'project.trash' | 'project.restore' | 'project.purge';
export interface ProjectTrashOperations {
  trash(projectId: string): unknown;
  restore(projectId: string): unknown;
  purge(projectId: string): unknown;
}
const payloadSchema = z.object({ id: z.string().min(1).max(120) }).strict();

export function handleProjectTrashAction(
  operations: ProjectTrashOperations,
  action: ProjectTrashAction,
  payload: unknown,
  busy = false,
): unknown {
  const { id } = payloadSchema.parse(payload);
  if (busy) throw new Error('当前 AI 请求尚未结束，请稍后再管理项目。');
  if (action === 'project.trash') return operations.trash(id);
  if (action === 'project.restore') return operations.restore(id);
  return operations.purge(id);
}
