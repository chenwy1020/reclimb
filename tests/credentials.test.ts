import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialsStore, type CredentialCipher } from '../src/main/credentials';
function cipher(): CredentialCipher {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12); const aes = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([aes.update(value, 'utf8'), aes.final()]);
      return Buffer.concat([iv, aes.getAuthTag(), ciphertext]);
    },
    decryptString(value) {
      const aes = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); aes.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([aes.update(value.subarray(28)), aes.final()]).toString('utf8');
    },
  };
}
function fixture(crypto = cipher()) {
  const directory = mkdtempSync(join(tmpdir(), 'reclimb-credentials-')); const path = join(directory, 'credentials.json');
  return { directory, path, crypto, store: new CredentialsStore(path, crypto) };
}
describe('endpoint-bound credentials', () => {
  it('encrypts the key and binding and reopens only for the same normalized endpoint', () => {
    const { path, crypto, store } = fixture();
    store.write('https://API.deepseek.com/', 'sk-private-example');
    expect(store.read('https://api.deepseek.com/chat/completions')).toBe('sk-private-example');
    expect(new CredentialsStore(path, crypto).read('https://api.deepseek.com')).toBe('sk-private-example');
    const raw = readFileSync(path, 'utf8'); expect(raw).not.toContain('sk-private-example'); expect(raw).not.toContain('api.deepseek.com');
  });
  it('returns no key for a changed host or API path without changing the original binding', () => {
    const { store } = fixture(); store.write('https://api.deepseek.com', 'sk-original');
    expect(store.read('https://other.example')).toBe(''); expect(store.read('https://api.deepseek.com/v1')).toBe('');
    expect(store.read('https://api.deepseek.com')).toBe('sk-original');
    store.write('https://other.example/v1', 'sk-other');
    expect(store.read('https://api.deepseek.com')).toBe(''); expect(store.read('https://other.example/v1/chat/completions')).toBe('sk-other');
  });
  it('refuses old unbound credentials even when their ciphertext can be decrypted', () => {
    const { store, path, crypto } = fixture();
    writeFileSync(path, JSON.stringify({ encrypted: crypto.encryptString('sk-legacy').toString('base64') }));
    expect(store.read('https://api.deepseek.com')).toBe('');
    writeFileSync(path, JSON.stringify({ version: 1, encrypted: crypto.encryptString('sk-legacy').toString('base64') }));
    expect(store.read('https://api.deepseek.com')).toBe('');
  });
  it('does not let editable outer metadata rebind an encrypted credential', () => {
    const { store, path } = fixture(); store.write('https://api.deepseek.com', 'sk-bound');
    const record = JSON.parse(readFileSync(path, 'utf8')); record.endpoint = 'https://other.example/chat/completions';
    writeFileSync(path, JSON.stringify(record)); expect(store.read('https://other.example')).toBe('');
  });
  it('keeps the old credential and exposes no secret when encryption fails', () => {
    const { path, crypto, store } = fixture(); store.write('https://api.deepseek.com', 'sk-old'); const before = readFileSync(path);
    const unavailable = new CredentialsStore(path, { ...crypto, isEncryptionAvailable: () => false });
    expect(() => unavailable.write('https://other.example', 'sk-new-sensitive')).toThrow(); expect(readFileSync(path)).toEqual(before);
    const failing = new CredentialsStore(path, { ...crypto, encryptString: () => { throw new Error('sk-new-sensitive failed'); } });
    let error: unknown; try { failing.write('https://other.example', 'sk-new-sensitive'); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain('sk-new-sensitive'); expect(store.read('https://api.deepseek.com')).toBe('sk-old');
  });
  it('cleans temporary ciphertext and preserves the original when atomic replacement fails', () => {
    const { directory, path, store } = fixture(); store.write('https://api.deepseek.com', 'sk-old'); const backup = join(directory, 'original.json');
    renameSync(path, backup); mkdirSync(path);
    try {
      expect(() => store.write('https://other.example', 'sk-never-cleartext')).toThrow();
      expect(readdirSync(directory).sort()).toEqual(['credentials.json', 'original.json']);
      expect(readFileSync(backup, 'utf8')).not.toContain('sk-never-cleartext');
    } finally { rmdirSync(path); renameSync(backup, path); }
    expect(store.read('https://api.deepseek.com')).toBe('sk-old');
  });
  it('treats corrupt ciphertext and decryption failure as disconnected', () => {
    const { path, store } = fixture(); writeFileSync(path, '{bad json'); expect(store.read('https://api.deepseek.com')).toBe('');
    store.write('https://api.deepseek.com', 'sk-valid'); const unavailable = new CredentialsStore(path, cipher()); expect(unavailable.read('https://api.deepseek.com')).toBe('');
    expect(store.read('http://untrusted.example')).toBe('');
  });
  it('clears credentials explicitly and when saving an empty key', () => {
    const { path, store } = fixture(); store.write('https://api.deepseek.com', 'sk-delete'); store.clear(); expect(existsSync(path)).toBe(false);
    store.clear(); store.write('https://api.deepseek.com', 'sk-delete'); store.write('https://api.deepseek.com', '  '); expect(store.read('https://api.deepseek.com')).toBe('');
  });
});
