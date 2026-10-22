import { draftKey, newId, snapshotDraft, type LocalDraft } from './draft';
export interface PairCredentials {
  token: string;
  workspaceId: string;
}
let opening: Promise<IDBDatabase> | undefined;
function open() {
  return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('reclimb-handwriting', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('drafts', { keyPath: 'key' });
      db.createObjectStore('connection');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      opening = undefined;
      reject(new Error('无法打开本机草稿存储。请保留当前页面并下载原稿。'));
    };
    request.onblocked = () => {
      opening = undefined;
      reject(new Error('草稿存储正被另一个页面占用，请关闭旧页面后重试。'));
    };
  }));
}
async function read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function write(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('本机保存没有完成，请下载原稿。'));
    tx.objectStore(store).put(value, key);
  });
}
// Per loaded editor object, never per key: refreshing a list or another local
// editor must not advance the baseline of an older in-memory draft.
const baselines = new WeakMap<LocalDraft, { key: string; text: string }>();
export interface DraftSaveResult {
  key: string;
  conflict?: LocalDraft['conflict'];
  stale?: boolean;
}
export async function saveDraft(snapshot: LocalDraft, owner = snapshot): Promise<DraftSaveResult> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const baseline = baselines.get(owner),
      key = baseline?.key ?? owner.key;
    const candidate = {
      ...snapshotDraft(snapshot),
      key,
      ...(owner.conflict ? { conflict: owner.conflict } : {}),
    };
    const candidateText = JSON.stringify(candidate),
      tx = db.transaction('drafts', 'readwrite'),
      store = tx.objectStore('drafts');
    let written: LocalDraft | undefined,
      result: DraftSaveResult = { key, conflict: candidate.conflict };
    tx.oncomplete = () => {
      if (written) {
        owner.key = written.key;
        owner.conflict = written.conflict;
        baselines.set(owner, { key: written.key, text: JSON.stringify(written) });
      }
      resolve(result);
    };
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error('本机保存没有完成，请保留页面并重试。'));
    const request = store.get(key);
    request.onsuccess = () => {
      const existing = request.result as LocalDraft | undefined,
        existingText = existing ? JSON.stringify(existing) : undefined;
      if (existingText === candidateText) {
        written = candidate;
        return;
      }
      if (existingText !== baseline?.text) {
        // An unchanged old view may remain open without overwriting or manufacturing
        // a new copy. A later edit still compares against its original baseline.
        if (baseline?.text === candidateText) {
          result = { ...result, stale: true };
          return;
        }
        const originalKey = draftKey(candidate.workspaceId, candidate.target.id);
        written = {
          ...candidate,
          key: originalKey + '#conflict-' + newId(),
          conflict: { ofKey: originalKey, createdAt: new Date().toISOString() },
        };
        store.add(written);
        result = { key: written.key, conflict: written.conflict };
        return;
      }
      written = candidate;
      store.put(written);
    };
  });
}
export async function loadDraft(key: string) {
  const draft = await read<LocalDraft>('drafts', key);
  if (draft) baselines.set(draft, { key: draft.key, text: JSON.stringify(draft) });
  return draft;
}
export async function listDrafts(workspaceId: string) {
  const db = await open();
  return new Promise<LocalDraft[]>((resolve, reject) => {
    const request = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as LocalDraft[])
          .filter((draft) => draft.workspaceId === workspaceId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    request.onerror = () => reject(request.error);
  });
}
export const loadCredentials = () => read<PairCredentials>('connection', 'credentials');
export const saveCredentials = (value: PairCredentials) =>
  write('connection', value, 'credentials');
export const loadSelection = () => read<string>('connection', 'selection');
export const saveSelection = (key: string) => write('connection', key, 'selection');
