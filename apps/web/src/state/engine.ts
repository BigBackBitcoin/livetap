/**
 * Which media engine this build gets, and why.
 *
 * This is a SEAM, deliberately. The store used to call `createEngineForEnvironment` directly,
 * which meant the only choice available was "browser or mock" and there was nowhere for the
 * desktop and Android engines to land. Both of those exist as fully built machinery that nothing
 * calls: the Electron main process runs a verified FFmpeg publisher behind an allow-listed IPC
 * bridge (`apps/desktop/src/preload/index.ts`), and the Android app ships a Capacitor plugin
 * wrapping RootEncoder. Selecting them is a decision about the host, not about media, so it lives
 * here rather than inside `packages/media`.
 *
 * The rule this file exists to enforce: the engine and the destinations must agree about whether
 * they are real. A mock engine feeding a real RTMP destination produces a UI that says LIVE while
 * nothing is broadcast, which is the single most dishonest state this product can reach.
 */

import { createEngineForEnvironment } from '@livetap/media';
import type { MediaEngine } from '@livetap/core';

export type EngineHost = 'browser' | 'desktop' | 'mobile' | 'mock';

export interface EngineChoice {
  engine: MediaEngine;
  /** The engine's own `kind`, as reported to the UI and the session log. */
  kind: string;
  /** Which host surface was detected. Recorded so the UI can explain what it is running on. */
  host: EngineHost;
}

export interface CreateEngineOptions {
  /** When true, a simulated engine is used whatever the host is. */
  mockMode?: boolean;
  /** Passed to the mock engine so a demo's timings are stated rather than inherited. */
  mock?: { connectDelayMs?: number };
}

/** The host globals the two native shells inject before the bundle runs. */
function hostWindow(): Record<string, unknown> | undefined {
  return (globalThis as unknown as { window?: Record<string, unknown> }).window;
}

/** True when the page is running inside the Electron shell, which injects `window.livetap`. */
export function isDesktopHost(): boolean {
  const w = hostWindow();
  return !!w && 'livetap' in w;
}

/** True when the page is running inside the Capacitor WebView on a phone. */
export function isMobileHost(): boolean {
  const w = hostWindow();
  return !!w && 'Capacitor' in w;
}

export async function createEngine(options: CreateEngineOptions = {}): Promise<EngineChoice> {
  const mockMode = options.mockMode ?? false;

  if (mockMode) {
    const engine = createEngineForEnvironment({ preferMock: true, mock: options.mock });
    return { engine, kind: engine.kind, host: 'mock' };
  }

  const engine = createEngineForEnvironment({ preferMock: false, mock: options.mock });
  const host: EngineHost = isDesktopHost() ? 'desktop' : isMobileHost() ? 'mobile' : 'browser';
  return { engine, kind: engine.kind, host };
}
