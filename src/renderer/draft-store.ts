export interface TaskDraft {
  id: string;
  taskId?: string;
  stepId?: string;
  text: string;
}
export function createDraftStore(save: (draft: TaskDraft) => Promise<void>) {
  const entries = new Map<string, TaskDraft & { dirty: boolean; revision: number }>();
  let running: Promise<void> | undefined;
  const key = (draft: TaskDraft) => draft.id + '|' + (draft.taskId || '');
  const hasDirty = () => [...entries.values()].some((d) => d.dirty);
  return {
    bind(draft: TaskDraft): TaskDraft {
      const existing = entries.get(key(draft));
      if (existing) {
        existing.stepId = draft.stepId;
        return { ...existing };
      }
      entries.set(key(draft), { ...draft, dirty: false, revision: 0 });
      return draft;
    },
    change(draft: TaskDraft) {
      const previous = entries.get(key(draft));
      entries.set(key(draft), { ...draft, dirty: true, revision: (previous?.revision || 0) + 1 });
    },
    hasDirty,
    clear() {
      entries.clear();
    },
    flush() {
      if (running) return running;
      const drain = async () => {
        while (hasDirty()) {
          const entry = [...entries.entries()].find(([, value]) => value.dirty);
          if (!entry) break;
          const [id, current] = entry;
          const captured = { ...current };
          await save(captured);
          const latest = entries.get(id);
          if (latest?.revision === captured.revision) latest.dirty = false;
        }
      };
      running = drain().finally(() => {
        running = undefined;
      });
      return running;
    },
  };
}
