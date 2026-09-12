import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SafeStorageLike } from './vault.js';
import { SecretVault } from './vault.js';

/**
 * Stand-in for Electron's safeStorage. The "encryption" is a reversible transform — the point is
 * to prove the vault never writes the PLAINTEXT, and that it refuses to work when the OS
 * credential store is unavailable.
 */
function fakeSafeStorage(available = true): SafeStorageLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => {
      calls.push('encrypt');
      return Buffer.from(`ENC::${plainText}`, 'utf8');
    },
    decryptString: (encrypted: Buffer) => {
      calls.push('decrypt');
      const text = encrypted.toString('utf8');
      if (!text.startsWith('ENC::')) throw new Error('bad ciphertext');
      return text.slice(5);
    },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'livetap-vault-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SecretVault', () => {
  it('round-trips a secret', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(vault.set('oauth:youtube:UC1', 'refresh-token-abc')).toEqual({ ok: true });
    expect(vault.get('oauth:youtube:UC1')).toEqual({ ok: true, secret: 'refresh-token-abc' });
  });

  it('never writes the plaintext to disk', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    vault.set('ingest:dest-1', 'live_1234567890_supersecretkey');
    const raw = readFileSync(path.join(dir, 'vault.bin'), 'utf8');
    expect(raw).not.toContain('live_1234567890_supersecretkey');
    expect(raw).not.toContain('supersecret');
    // What IS on disk is base64 of the ciphertext.
    expect(raw).toContain(Buffer.from('ENC::live_1234567890_supersecretkey', 'utf8').toString('base64'));
  });

  it('refuses everything when OS encryption is unavailable, rather than falling back to plaintext', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage(false) });
    expect(vault.available()).toBe(false);
    expect(vault.set('id', 'secret')).toEqual({ ok: false, reason: 'ENCRYPTION_UNAVAILABLE' });
    expect(vault.get('id')).toEqual({ ok: false, reason: 'ENCRYPTION_UNAVAILABLE' });
    // And nothing was written at all.
    expect(existsSync(path.join(dir, 'vault.bin'))).toBe(false);
  });

  it('treats a safeStorage that throws as unavailable', () => {
    const throwing: SafeStorageLike = {
      isEncryptionAvailable: () => {
        throw new Error('keyring exploded');
      },
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    };
    const vault = new SecretVault({ userDataDir: dir, safeStorage: throwing });
    expect(vault.available()).toBe(false);
    expect(vault.set('id', 's').reason).toBe('ENCRYPTION_UNAVAILABLE');
  });

  it('reports NOT_FOUND rather than an empty secret', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(vault.get('never-stored')).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(vault.delete('never-stored')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('rejects an invalid id without touching the store', () => {
    const storage = fakeSafeStorage();
    const vault = new SecretVault({ userDataDir: dir, safeStorage: storage });
    expect(vault.set('../../escape', 's')).toEqual({ ok: false, reason: 'INVALID_ID' });
    expect(vault.get('a b')).toEqual({ ok: false, reason: 'INVALID_ID' });
    expect(vault.delete('a/b')).toEqual({ ok: false, reason: 'INVALID_ID' });
    expect(storage.calls).toEqual([]);
  });

  it('rejects an oversized secret', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(vault.set('id', 'x'.repeat(8193))).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('deletes one entry and keeps the rest', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    vault.set('a', '1');
    vault.set('b', '2');
    expect(vault.delete('a')).toEqual({ ok: true });
    expect(vault.get('a').reason).toBe('NOT_FOUND');
    expect(vault.get('b')).toEqual({ ok: true, secret: '2' });
  });

  it('lists ids but never values', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    vault.set('z:one', 'secret-one');
    vault.set('a:two', 'secret-two');
    const list = vault.list();
    expect(list).toEqual(['a:two', 'z:one']); // sorted, ids only
    expect(JSON.stringify(list)).not.toContain('secret');
  });

  it('persists across instances', () => {
    const storage = fakeSafeStorage();
    new SecretVault({ userDataDir: dir, safeStorage: storage }).set('keep', 'me');
    const second = new SecretVault({ userDataDir: dir, safeStorage: storage });
    expect(second.get('keep')).toEqual({ ok: true, secret: 'me' });
  });

  it('starts fresh rather than crashing on a corrupt vault file', () => {
    writeFileSync(path.join(dir, 'vault.bin'), 'this is not json', 'utf8');
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(vault.list()).toEqual([]);
    expect(vault.set('new', 'value')).toEqual({ ok: true });
    expect(vault.get('new').secret).toBe('value');
  });

  it('drops entries in the file that do not look like ours', () => {
    writeFileSync(
      path.join(dir, 'vault.bin'),
      JSON.stringify({ version: 1, entries: { 'good-id': 'RU5DOjp4', '../bad': 'RU5DOjp5', worse: 42 } }),
      'utf8',
    );
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(vault.list()).toEqual(['good-id']);
  });

  it('reports IO_ERROR when the ciphertext cannot be decrypted (another user, reset keychain)', () => {
    const storage = fakeSafeStorage();
    const vault = new SecretVault({ userDataDir: dir, safeStorage: storage });
    vault.set('id', 'value');
    writeFileSync(
      path.join(dir, 'vault.bin'),
      JSON.stringify({ version: 1, entries: { id: Buffer.from('garbage').toString('base64') } }),
      'utf8',
    );
    const fresh = new SecretVault({ userDataDir: dir, safeStorage: storage });
    expect(fresh.get('id')).toEqual({ ok: false, reason: 'IO_ERROR' });
  });

  it('rejects a wrong file version rather than guessing', () => {
    writeFileSync(path.join(dir, 'vault.bin'), JSON.stringify({ version: 99, entries: { a: 'b' } }), 'utf8');
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(vault.list()).toEqual([]);
  });

  it('clear() removes the file entirely', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    vault.set('a', '1');
    expect(existsSync(vault.path)).toBe(true);
    vault.clear();
    expect(existsSync(vault.path)).toBe(false);
    expect(vault.list()).toEqual([]);
  });

  it('writes atomically, leaving no temp file behind', () => {
    const vault = new SecretVault({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    vault.set('a', '1');
    expect(existsSync(`${vault.path}.tmp`)).toBe(false);
  });
});
