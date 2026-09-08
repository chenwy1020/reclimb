import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningStore } from '../src/main/store';
import type { Fragment, Project, Settings } from '../src/shared/types';
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
const opened: LearningStore[] = [];
const project = (id = 'project-a'): Project => ({ id, title: '学习空间', goal: '独立运用', status: 'active', createdAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z' });
async function open(directory = mkdtempSync(join(tmpdir(), 'reclimb-store-'))) { const store = await LearningStore.open(directory); opened.push(store); return store; }
afterEach(() => { for (const store of opened.splice(0)) store.close(); });
describe('LearningStore', () => {
  it('persists a real SQLite file and reopens in the same data directory', async () => {
    const store = await open(); const directory = store.snapshot().dataDirectory;
    store.put('projects', project()); store.close();
    expect(readFileSync(join(directory, 'learning.sqlite')).subarray(0, 16).toString()).toBe('SQLite format 3\0');
    const reopened = await open(directory); expect(reopened.get('projects', 'project-a')).toEqual(project());
  });
  it('keeps separate data directories isolated', async () => {
    const one = await open(); const two = await open(); one.put('projects', project());
    expect(two.list('projects')).toEqual([]);
  });
  it('rolls back entity, settings and search changes together after an error', async () => {
    const store = await open(); const before = store.getSettings();
    expect(() => store.transaction(() => {
      store.put('projects', project()); store.updateSettings({ personalGoal: '不应保存' });
      store.put('fragments', { id: 'f', projectId: 'project-a', materialId: 'm', locator: '第一段', ordinal: 0, text: '递归与递推' });
      throw new Error('interrupt');
    })).toThrow('interrupt');
    expect(store.list('projects')).toEqual([]); expect(store.getSettings()).toEqual(before); expect(store.searchFragments('project-a', '递归')).toEqual([]);
    const reopened = await open(store.snapshot().dataDirectory); expect(reopened.list('fragments')).toEqual([]);
  });
  it('commits together and supports nested rollback without losing outer work', async () => {
    const store = await open();
    store.transaction(() => {
      store.put('projects', project());
      expect(() => store.transaction(() => { store.put('projects', project('discard')); throw new Error('nested'); })).toThrow('nested');
      store.updateSettings({ studyMinutes: 35 });
    });
    const reopened = await open(store.snapshot().dataDirectory);
    expect(reopened.list('projects').map(p => p.id)).toEqual(['project-a']); expect(reopened.getSettings().studyMinutes).toBe(35);
  });
  it('indexes Chinese text locally and scopes results by project', async () => {
    const store = await open(); const fragment: Fragment = { id: 'f1', projectId: 'project-a', materialId: 'm', locator: '第 2 段', ordinal: 0, text: '学习迁移需要理解概念并独立运用。递归通过自身调用解决问题。' };
    store.put('fragments', fragment); store.put('fragments', { ...fragment, id: 'f2', projectId: 'other' });
    expect(store.searchFragments('project-a', '递归').map(f => f.id)).toEqual(['f1']);
    expect(store.searchFragments('project-a', '学习迁移')[0]?.id).toBe('f1');
    store.put('fragments', { ...fragment, text: '完全替换内容' }); expect(store.searchFragments('project-a', '递归')).toEqual([]);
    store.remove('fragments', 'f2'); expect(store.searchFragments('other', '递归')).toEqual([]);
    expect(store.searchFragments('project-a', '   ')).toEqual([]);
  });
  it('only persists non-secret settings and labels provisional prices', async () => {
    const store = await open();
    store.updateSettings({ personalGoal: '掌握算法', hasApiKey: true, apiKey: 'sk-must-not-persist', secret: 'another-secret' } as Partial<Settings>);
    expect(store.getSettings()).toMatchObject({ hasApiKey: false, model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com', monthlyBudgetCny: 0, inputPriceCnyPerMillion: 10, outputPriceCnyPerMillion: 30 });
    expect(store.getSettings().priceUpdatedAt).toContain('估算');
    expect(JSON.stringify(store.snapshot())).not.toContain('sk-must-not-persist');
    expect(readFileSync(join(store.snapshot().dataDirectory, 'learning.sqlite')).toString()).not.toContain('sk-must-not-persist');
  });
  it('rejects corrupted data without silently replacing it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'reclimb-corrupt-')); const bytes = Buffer.from('not a sqlite database'); writeFileSync(join(directory, 'learning.sqlite'), bytes);
    await expect(LearningStore.open(directory)).rejects.toThrow(); expect(readFileSync(join(directory, 'learning.sqlite'))).toEqual(bytes);
  });
  it('rejects unapproved table names', async () => {
    const store = await open(); expect(() => store.list('projects; DROP TABLE projects' as never)).toThrow();
  });
});

describe('atomic persistence failure', () => {
  it('restores in-memory state when the database cannot be atomically replaced', async () => {
    const store = await open(); store.put('projects', project());
    const path = join(store.dataDirectory, 'learning.sqlite'); const backup = join(store.dataDirectory, 'original.sqlite');
    renameSync(path, backup); mkdirSync(path);
    try {
      expect(() => store.transaction(() => { store.put('projects', project('must-not-exist')); store.updateSettings({ personalGoal: 'must-not-persist' }); })).toThrow();
      expect(store.get('projects', 'must-not-exist')).toBeUndefined(); expect(store.getSettings().personalGoal).toBe('');
    } finally { rmdirSync(path); renameSync(backup, path); }
    const reopened = await open(store.dataDirectory); expect(reopened.list('projects').map(p => p.id)).toEqual(['project-a']);
  });
});

describe('temporary Windows file locks', () => {
  it('retries only temporary lock errors and publishes the complete transaction after recovery', async () => {
    const store = await open(); store.put('projects', project());
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const rename = vi.mocked(renameSync); rename.mockClear();
    const sleep = vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out');
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      for (const code of ['EPERM', 'EBUSY', 'EACCES']) rename.mockImplementationOnce(() => { throw Object.assign(new Error('temporary lock'), { code }); });
      expect(() => store.transaction(() => { store.put('projects', project('committed')); store.updateSettings({ personalGoal: '完整保存' }); })).not.toThrow();
      expect(rename).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.reduce((total, call) => total + Number(call[3]), 0)).toBeLessThan(500);
      const reopened = await open(store.dataDirectory); expect(reopened.get('projects', 'committed')).toBeDefined(); expect(reopened.getSettings().personalGoal).toBe('完整保存');
    } finally { clock.mockRestore(); rename.mockReset(); rename.mockImplementation(actual.renameSync); sleep.mockRestore(); }
  });
  it('stops bounded retries and preserves disk and memory when the lock persists', async () => {
    const store = await open(); store.put('projects', project());
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const path = join(store.dataDirectory, 'learning.sqlite'); const before = readFileSync(path);
    const rename = vi.mocked(renameSync); rename.mockClear();
    const sleep = vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out');
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      rename.mockImplementation(() => { throw Object.assign(new Error('persistent lock'), { code: 'EPERM' }); });
      expect(() => store.transaction(() => { store.put('projects', project('rolled-back')); store.updateSettings({ personalGoal: '不应保存' }); })).toThrow('persistent lock');
      expect(rename.mock.calls.length).toBeGreaterThan(1); expect(rename.mock.calls.length).toBeLessThanOrEqual(6);
      expect(sleep.mock.calls.reduce((total, call) => total + Number(call[3]), 0)).toBeLessThan(500);
      // Keep disk assertions outside the simulated rename: CI I/O is not the clock under test.
      expect(readFileSync(path)).toEqual(before); expect(store.get('projects', 'rolled-back')).toBeUndefined(); expect(store.getSettings().personalGoal).toBe('');
      expect(readdirSync(store.dataDirectory).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally { clock.mockRestore(); rename.mockReset(); rename.mockImplementation(actual.renameSync); sleep.mockRestore(); }
  });
  it('stops immediately at the elapsed deadline and still rolls back the transaction', async () => {
    const store = await open(); store.put('projects', project());
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const path = join(store.dataDirectory, 'learning.sqlite'); const before = readFileSync(path);
    const rename = vi.mocked(renameSync); rename.mockClear();
    const sleep = vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out');
    let elapsed = 0; const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    try {
      rename.mockImplementation(() => { elapsed = 401; throw Object.assign(new Error('lock exceeded deadline'), { code: 'EBUSY' }); });
      expect(() => store.put('projects', project('too-late'))).toThrow('lock exceeded deadline');
      expect(rename).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
      expect(readFileSync(path)).toEqual(before); expect(store.get('projects', 'too-late')).toBeUndefined();
      expect(readdirSync(store.dataDirectory).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally { clock.mockRestore(); rename.mockReset(); rename.mockImplementation(actual.renameSync); sleep.mockRestore(); }
  });
  it('does not retry an unrelated disk error', async () => {
    const store = await open(); const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const rename = vi.mocked(renameSync); rename.mockClear(); const sleep = vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out');
    try {
      rename.mockImplementationOnce(() => { throw Object.assign(new Error('disk I/O failure'), { code: 'EIO' }); });
      expect(() => store.put('projects', project('failed'))).toThrow('disk I/O failure'); expect(rename).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
    } finally { rename.mockReset(); rename.mockImplementation(actual.renameSync); sleep.mockRestore(); }
  });
});
