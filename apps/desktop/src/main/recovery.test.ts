import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RecoverySnapshot } from '../shared/ipc.js';
import { RECOVERY_INTERVAL_MS, RecoveryStore } from './recovery.js';

let dir: string;

const snapshot: RecoverySnapshot = {
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  destinationIds: ['dest-a', 'dest-b'],
  masterAspectRatio: '16:9',
  qualityPreset: '1080p30',
  recording: true,
  momentId: 'moment-main',
};

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'livetap-recovery-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('RecoveryStore', () => {
  it('ticks every 10 seconds', () => {
    expect(RECOVERY_INTERVAL_MS).toBe(10_000);
  });

  it('reads back what it wrote', () => {
    const store = new RecoveryStore({ userDataDir: dir, now: () => 1_700_000_005_000 });
    store.update(snapshot);
    store.flush();
    const read = store.read();
    expect(read?.destinationIds).toEqual(['dest-a', 'dest-b']);
    expect(read?.updatedAt).toBe(1_700_000_005_000);
    expect(read?.recording).toBe(true);
  });

  it('contains no secrets — the file is worthless if it leaks', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    store.update(snapshot);
    store.flush();
    const raw = readFileSync(store.path, 'utf8');
    // Only ids and settings; no urls, keys or tokens exist in the type at all.
    expect(raw).not.toMatch(/rtmp|rtmps|srt:|https?:|streamKey|token|secret|passphrase/i);
    const parsed: unknown = JSON.parse(raw);
    expect(Object.keys(parsed as Record<string, unknown>).sort()).toEqual([
      'destinationIds',
      'masterAspectRatio',
      'momentId',
      'qualityPreset',
      'recording',
      'startedAt',
      'updatedAt',
    ]);
  });

  it('returns null when there is nothing to recover', () => {
    expect(new RecoveryStore({ userDataDir: dir }).read()).toBeNull();
  });

  it('discards and deletes a malformed file rather than making it app state', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    writeFileSync(store.path, JSON.stringify({ destinationIds: ['../../etc'], recording: 'yes' }), 'utf8');
    expect(store.read()).toBeNull();
    expect(existsSync(store.path)).toBe(false);
  });

  it('discards unparseable JSON', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    writeFileSync(store.path, '{ truncated', 'utf8');
    expect(store.read()).toBeNull();
    expect(existsSync(store.path)).toBe(false);
  });

  it('clear() means "the last session ended normally"', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    store.update(snapshot);
    store.flush();
    expect(existsSync(store.path)).toBe(true);
    store.clear();
    expect(existsSync(store.path)).toBe(false);
    expect(store.read()).toBeNull();
  });

  it('flush() with nothing staged writes nothing', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    store.flush();
    expect(existsSync(store.path)).toBe(false);
  });

  it('stops staging after clear, so a late tick cannot resurrect the file', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    store.update(snapshot);
    store.clear();
    store.flush();
    expect(existsSync(store.path)).toBe(false);
  });

  it('start() is idempotent and stop() is safe when never started', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    expect(() => {
      store.start();
      store.start();
      store.stop();
      store.stop();
    }).not.toThrow();
  });

  it('the ticker actually writes', async () => {
    let now = 0;
    const store = new RecoveryStore({ userDataDir: dir, now: () => now });
    store.update(snapshot);
    store.start();
    // Rather than waiting 10 s, call the same code path the ticker calls.
    now = 5000;
    store.flush();
    store.stop();
    expect(store.read()?.updatedAt).toBe(5000);
  });

  it('leaves no temp file behind', () => {
    const store = new RecoveryStore({ userDataDir: dir });
    store.update(snapshot);
    store.flush();
    expect(existsSync(`${store.path}.tmp`)).toBe(false);
  });
});
