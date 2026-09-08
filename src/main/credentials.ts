import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildChatUrl } from './provider';

/** Electron safeStorage satisfies this interface; tests can inject another authenticated cipher. */
export interface CredentialCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
const PURPOSE = 'reclimb-endpoint-credential';

/** The service endpoint is inside the encrypted payload, alongside the key. */
export class CredentialsStore {
  private readonly filePath: string;
  constructor(filePath: string, private readonly cipher: CredentialCipher) { this.filePath = resolve(filePath); }

  read(baseUrl: string): string {
    try {
      const endpoint = buildChatUrl(baseUrl);
      if (!this.cipher.isEncryptionAvailable() || !existsSync(this.filePath) || statSync(this.filePath).size > 65536) return '';
      const record: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!record || typeof record !== 'object') return '';
      const envelope = record as { version?: unknown; encrypted?: unknown };
      if (envelope.version !== 1 || typeof envelope.encrypted !== 'string' || !envelope.encrypted) return '';
      const plain = this.cipher.decryptString(Buffer.from(envelope.encrypted, 'base64'));
      const value: unknown = JSON.parse(plain);
      if (!value || typeof value !== 'object') return '';
      const credential = value as { purpose?: unknown; version?: unknown; endpoint?: unknown; key?: unknown };
      if (credential.purpose !== PURPOSE || credential.version !== 1 || credential.endpoint !== endpoint) return '';
      if (typeof credential.key !== 'string' || !credential.key.trim() || credential.key.length > 4096) return '';
      return credential.key;
    } catch {
      // An old, corrupt, unavailable, or differently-bound record is disconnected.
      return '';
    }
  }

  write(baseUrl: string, key: string): void {
    const endpoint = buildChatUrl(baseUrl);
    const cleanKey = key.trim();
    if (!cleanKey) { this.clear(); return; }
    if (cleanKey.length > 4096) throw new Error('AI密钥过长，未保存。');
    let ciphertext: Buffer;
    try {
      if (!this.cipher.isEncryptionAvailable()) throw new Error('Encryption is unavailable');
      ciphertext = this.cipher.encryptString(JSON.stringify({ purpose: PURPOSE, version: 1, endpoint, key: cleanKey }));
      if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) throw new Error('Encryption returned no ciphertext');
    } catch {
      // Encryption implementations may include their plaintext input in error messages.
      throw new Error('系统密钥保护不可用或加密失败，原凭据已保留，未保存新密钥。');
    }
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify({ version: 1, encrypted: ciphertext.toString('base64') }), 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, this.filePath);
    } catch {
      throw new Error('密钥未能安全保存，原凭据已保留。请检查本机数据目录后重试。');
    } finally {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* No plaintext was written. */ } }
      if (existsSync(temporary)) { try { unlinkSync(temporary); } catch { /* Any leftover is encrypted only. */ } }
    }
  }

  clear(): void {
    try { if (existsSync(this.filePath)) unlinkSync(this.filePath); }
    catch { throw new Error('本机凭据暂时无法移除，请检查数据目录后重试。'); }
  }
}
