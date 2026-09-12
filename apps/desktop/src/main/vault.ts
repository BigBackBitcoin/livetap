/**
 * Secret vault.
 *
 * Every secret LIVETAP holds on desktop — OAuth refresh tokens, stream keys, SRT passphrases —
 * goes through here. Nothing is ever written to disk in plaintext:
 *
 *   secret ──safeStorage.encryptString──► ciphertext ──base64──► userData/vault.bin (JSON)
 *
 * `safeStorage` is backed by the OS credential store (DPAPI on Windows, Keychain on macOS), so the
 * ciphertext is bound to the user account and cannot be read by another user or copied to another
 * machine. If `isEncryptionAvailable()` is false (a Linux session with no keyring, a broken
 * Keychain) we REFUSE to store anything and say so — falling back to plaintext or to a hardcoded
 * key would be worse than not having the feature.
 *
 * The file is written atomically (temp + rename) so a crash mid-write cannot lose the whole vault,
 * and with mode 0o600 so other local users cannot read the ciphertext at all.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { VaultResult } from '../shared/ipc.js';
import { MAX_SECRET_BYTES, isVaultId } from '../shared/guards.js';

/** The slice of Electron's safeStorage we need. Injected so the vault is testable without Electron. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface VaultFile {
  version: 1;
  /** id → base64 ciphertext. */
  entries: Record<string, string>;
}

export interface VaultOptions {
  /** Directory to store `vault.bin` in — always `app.getPath('userData')` in production. */
  userDataDir: string;
  safeStorage: SafeStorageLike;
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

export class SecretVault {
  private readonly filePath: string;
  private readonly tempPath: string;
  private readonly safeStorage: SafeStorageLike;
  private readonly logger: VaultOptions['logger'];
  private cache: VaultFile | null = null;

  constructor(options: VaultOptions) {
    this.filePath = path.join(options.userDataDir, 'vault.bin');
    this.tempPath = `${this.filePath}.tmp`;
    this.safeStorage = options.safeStorage;
    this.logger = options.logger;
  }

  get path(): string {
    return this.filePath;
  }

  available(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private load(): VaultFile {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = { version: 1, entries: {} };
      return this.cache;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as { version?: unknown }).version === 1 &&
        typeof (parsed as { entries?: unknown }).entries === 'object' &&
        (parsed as { entries?: unknown }).entries !== null
      ) {
        const entries: Record<string, string> = {};
        for (const [key, value] of Object.entries((parsed as { entries: Record<string, unknown> }).entries)) {
          // Drop anything that does not look like one of our own entries rather than trusting it.
          if (isVaultId(key) && typeof value === 'string') entries[key] = value;
        }
        this.cache = { version: 1, entries };
        return this.cache;
      }
    } catch (error) {
      this.logger?.warn('vault file unreadable; starting a fresh vault', { error: String(error) });
    }
    this.cache = { version: 1, entries: {} };
    return this.cache;
  }

  private persist(file: VaultFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.tempPath, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
    renameSync(this.tempPath, this.filePath);
    this.cache = file;
  }

  set(id: string, secret: string): VaultResult {
    if (!isVaultId(id)) return { ok: false, reason: 'INVALID_ID' };
    if (Buffer.byteLength(secret, 'utf8') > MAX_SECRET_BYTES) return { ok: false, reason: 'TOO_LARGE' };
    if (!this.available()) return { ok: false, reason: 'ENCRYPTION_UNAVAILABLE' };
    try {
      const ciphertext = this.safeStorage.encryptString(secret);
      const file = this.load();
      this.persist({ version: 1, entries: { ...file.entries, [id]: ciphertext.toString('base64') } });
      return { ok: true };
    } catch (error) {
      this.logger?.warn('vault set failed', { id, error: String(error) });
      return { ok: false, reason: 'IO_ERROR' };
    }
  }

  get(id: string): VaultResult {
    if (!isVaultId(id)) return { ok: false, reason: 'INVALID_ID' };
    if (!this.available()) return { ok: false, reason: 'ENCRYPTION_UNAVAILABLE' };
    const entry = this.load().entries[id];
    if (entry === undefined) return { ok: false, reason: 'NOT_FOUND' };
    try {
      return { ok: true, secret: this.safeStorage.decryptString(Buffer.from(entry, 'base64')) };
    } catch (error) {
      // Ciphertext from another user account or a reset Keychain: not recoverable, report honestly.
      this.logger?.warn('vault decrypt failed', { id, error: String(error) });
      return { ok: false, reason: 'IO_ERROR' };
    }
  }

  delete(id: string): VaultResult {
    if (!isVaultId(id)) return { ok: false, reason: 'INVALID_ID' };
    const file = this.load();
    if (file.entries[id] === undefined) return { ok: false, reason: 'NOT_FOUND' };
    const entries = { ...file.entries };
    delete entries[id];
    try {
      this.persist({ version: 1, entries });
      return { ok: true };
    } catch (error) {
      this.logger?.warn('vault delete failed', { id, error: String(error) });
      return { ok: false, reason: 'IO_ERROR' };
    }
  }

  /** Ids only — never values. Safe to show in diagnostics. */
  list(): string[] {
    return Object.keys(this.load().entries).sort();
  }

  /** Remove the whole vault (sign-out-everywhere). */
  clear(): void {
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
    } catch (error) {
      this.logger?.warn('vault clear failed', { error: String(error) });
    }
    this.cache = { version: 1, entries: {} };
  }
}
