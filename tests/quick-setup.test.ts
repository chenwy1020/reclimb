import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LearningStore } from '../src/main/store';
import SettingsPage from '../src/renderer/SettingsPage';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
async function renderSettings() {
  const root = mkdtempSync(join(tmpdir(), 'reclimb-quick-setup-'));
  roots.push(root);
  const store = await LearningStore.open(root);
  try {
    return renderToStaticMarkup(createElement(SettingsPage, {
      snapshot: store.snapshot(), used: 0, busy: false, run: vi.fn(), onRestore: vi.fn(),
    }));
  } finally { store.close(); }
}

describe('首次连接与设置分类', () => {
  it('首次进入直接呈现连接表单和测试费用说明', async () => {
    const html = await renderSettings();
    expect(html).toContain('aria-label="快速连接 AI"');
    expect(html).toContain('保存并测试连接');
    expect(html).toContain('小额请求');
    expect(html).toContain('无需自建服务器');
  });
  it('首次聚焦 AI 分类，隐藏的分类仍保留已挂载的设置表单', async () => {
    const html = await renderSettings();
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>AI 与费用/);
    expect(html).toMatch(/id="settings-learning"[^>]*hidden=""/);
    expect(html).toContain('每次希望学习多久');
    expect(html).toMatch(/id="settings-data"[^>]*hidden=""/);
    expect(html).toContain('创建完整备份');
  });
});

import { quickConnectionProfile } from '../src/renderer/QuickSetup';
import { CredentialsStore, type CredentialCipher } from '../src/main/credentials';
import { ModelProfileManager } from '../src/main/model-profile-manager';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function testCipher(): CredentialCipher {
  const secret = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12), aes = createCipheriv('aes-256-gcm', secret, iv);
      const body = Buffer.concat([aes.update(value, 'utf8'), aes.final()]);
      return Buffer.concat([iv, aes.getAuthTag(), body]);
    },
    decryptString(value) {
      const aes = createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12));
      aes.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([aes.update(value.subarray(28)), aes.final()]).toString('utf8');
    },
  };
}
const connection = {
  baseUrl: 'https://example.invalid/v1', model: ' new-model ',
  inputPriceCnyPerMillion: 8, outputPriceCnyPerMillion: 16,
  priceUpdatedAt: '仅自编测试价格',
};

describe('快速连接的配置隔离', () => {
  it('同名新配置不会改动旧配置、已选模型或旧密钥', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reclimb-setup-isolation-'));
    roots.push(root);
    const store = await LearningStore.open(root);
    try {
      const credentials = new CredentialsStore(join(root, 'keys.json'), testCipher());
      const manager = new ModelProfileManager(store, credentials);
      const originalId = manager.save({
        ...connection, name: 'new-model · example.invalid', providerName: '原配置',
        model: 'old-model', enabled: true,
      }, 'original-test-key');
      manager.activate(originalId);
      const before = store.getSettings().modelProfiles!.find((item) => item.id === originalId);
      const profile = quickConnectionProfile(connection, store.getSettings().modelProfiles!);
      expect(profile).not.toHaveProperty('id');
      const created = manager.save(profile, 'new-test-key');
      expect(created).not.toBe(originalId);
      expect(store.getSettings().modelProfiles!.find((item) => item.id === originalId)).toEqual(before);
      expect(store.getSettings().activeModelProfileId).toBe(originalId);
      expect(credentials.read(originalId, connection.baseUrl)).toBe('original-test-key');
      expect(manager.context(created).settings.model).toBe('new-model');
      expect(profile.name).toBe('new-model · example.invalid 2');
    } finally { store.close(); }
  });
  it.each([
    'http://example.invalid/v1',
    'https://user:secret@example.invalid/v1',
    'https://example.invalid/v1?api_key=example',
    'https://example.invalid/v1#example',
  ])('保存前拒绝含凭据、参数或非 HTTPS 的快速连接地址：%s', (baseUrl) => {
    expect(() => quickConnectionProfile({ ...connection, baseUrl }, [])).toThrow('HTTPS');
  });
});
