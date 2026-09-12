/**
 * Crash recovery.
 *
 * If LIVETAP (or the machine) dies mid-broadcast, the next launch should be able to say
 * "you were live to 3 destinations — want to pick up where you left off?" instead of losing the
 * session silently. While the production is LIVE, main writes a small snapshot every 10 seconds.
 *
 * What the snapshot deliberately does NOT contain: ingest URLs, stream keys, OAuth tokens, or any
 * other secret. It holds destination IDs and settings only; the renderer resolves those IDs back to
 * real destinations through the vault, which is separately encrypted. That way a stale
 * `session-recovery.json` left behind on disk is worthless to anyone who finds it.
 *
 * The file is cleared on a clean stop and on a clean quit, so its mere presence at launch means
 * "the last session ended abnormally".
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RecoverySnapshot } from '../shared/ipc.js';
import { isRecoverySnapshot } from '../shared/guards.js';

export const RECOVERY_INTERVAL_MS = 10_000;

export interface RecoveryStoreOptions {
  userDataDir: string;
  now?: () => number;
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

export class RecoveryStore {
  private readonly filePath: string;
  private readonly tempPath: string;
  private readonly now: () => number;
  private readonly logger: RecoveryStoreOptions['logger'];
  private timer: NodeJS.Timeout | null = null;
  private latest: RecoverySnapshot | null = null;

  constructor(options: RecoveryStoreOptions) {
    this.filePath = path.join(options.userDataDir, 'session-recovery.json');
    this.tempPath = `${this.filePath}.tmp`;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger;
  }

  get path(): string {
    return this.filePath;
  }

  /**
   * Read a snapshot left by a previous run. Anything that fails the guard is deleted rather than
   * handed to the renderer — a hand-edited or truncated file must not become app state.
   */
  read(): RecoverySnapshot | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (isRecoverySnapshot(parsed)) return parsed;
      this.logger?.warn('discarding malformed session-recovery.json');
    } catch (error) {
      this.logger?.warn('session-recovery.json unreadable', { error: String(error) });
    }
    this.clear();
    return null;
  }

  /** Stage the snapshot the ticker will write. Called by the renderer while live. */
  update(snapshot: RecoverySnapshot): void {
    this.latest = { ...snapshot, updatedAt: this.now() };
  }

  /** Start the 10-second ticker. Idempotent. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), RECOVERY_INTERVAL_MS);
    // `unref` so a forgotten ticker can never keep the process alive at quit.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Write the staged snapshot now (also called once immediately when going live). */
  flush(): void {
    if (!this.latest) return;
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.tempPath, JSON.stringify({ ...this.latest, updatedAt: this.now() }), {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(this.tempPath, this.filePath);
    } catch (error) {
      this.logger?.warn('could not write session-recovery.json', { error: String(error) });
    }
  }

  /** Clean stop / clean quit: the session ended normally, so there is nothing to recover. */
  clear(): void {
    this.stop();
    this.latest = null;
    try {
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
      if (existsSync(this.tempPath)) unlinkSync(this.tempPath);
    } catch (error) {
      this.logger?.warn('could not clear session-recovery.json', { error: String(error) });
    }
  }
}
