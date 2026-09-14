/**
 * Which media engine this build gets, and why.
 *
 * This is a SEAM, deliberately. The store used to call `createEngineForEnvironment` directly,
 * which meant the only choice available was "browser or mock" and there was nowhere for the
 * desktop and Android engines to land. Both of those exist as fully built machinery that nothing
 * called: the Electron main process runs a verified FFmpeg publisher behind an allow-listed IPC
 * bridge (`apps/desktop/src/preload/index.ts`), and the Android app ships a Capacitor plugin
 * wrapping RootEncoder. Selecting them is a decision about the host, not about media, so it lives
 * here rather than inside `packages/media`.
 *
 * The rule this file exists to enforce: the engine and the destinations must agree about whether
 * they are real. A mock engine feeding a real RTMP destination produces a UI that says LIVE while
 * nothing is broadcast, which is the single most dishonest state this product can reach. Demo mode
 * therefore selects simulated ADAPTERS; it selects a simulated ENGINE too, and `MockEngine` refuses
 * any ingest target that is not itself a reserved, unreachable name rather than reporting a
 * destination up that receives no bytes.
 */

import { createEngineForEnvironment } from '@livetap/media';
import type { FormatRenderer } from '@livetap/media';
import type { AspectRatio, MediaEngine } from '@livetap/core';

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

/**
 * True when the page is running inside the Electron shell.
 *
 * Both markers are required. `livetapHost` is the shell's own declaration and `livetap.engine` is
 * the bridge the engine actually calls, so a build where the preload failed to load is detected
 * here instead of at GO LIVE.
 */
export function isDesktopHost(): boolean {
  const w = hostWindow();
  if (!w) return false;
  const marker = (w as { livetapHost?: { kind?: string } }).livetapHost;
  const bridge = (w as { livetap?: { engine?: unknown } }).livetap;
  return marker?.kind === 'desktop' && typeof bridge?.engine === 'object';
}

/** True when the page is running inside the Capacitor WebView on a phone. */
export function isMobileHost(): boolean {
  const w = hostWindow();
  return !!w && 'Capacitor' in w;
}

/**
 * The WHIP relay the web surface publishes through, from the build environment.
 *
 * A browser has no RTMP socket, so without this the web app can compose and preview but cannot
 * send anything anywhere. Empty (the default) means the web surface honestly reports RTMP
 * destinations as needing the desktop app, which is what BrowserEngine already does.
 */
function relayOptions(): { whipBaseUrl: string; whipUrl?: string; token?: string } | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const base = (env.VITE_LIVETAP_RELAY_URL ?? '').trim();
  const session = (env.VITE_LIVETAP_RELAY_WHIP_URL ?? '').trim();
  const token = (env.VITE_LIVETAP_RELAY_TOKEN ?? '').trim();
  if (base === '' && session === '') return undefined;
  return {
    whipBaseUrl: base,
    ...(session !== '' ? { whipUrl: session } : {}),
    ...(token !== '' ? { token } : {}),
  };
}

/**
 * The engine this process is running, so the UI can read the per-format pictures it is producing.
 *
 * There is exactly one engine in a running app, created here, and the alternative to recording it
 * was to widen the store's public surface with an accessor per thing the UI wants to look at. The
 * OutputStrip needs the canvases themselves (one per aspect ratio), which is not state and cannot
 * be mirrored through the store. Null until `createEngine` runs, and null for an engine a test
 * injected directly - in both cases the UI renders nothing rather than guessing.
 */
let current: MediaEngine | null = null;

/** The per-format compositors of the running engine, or null when there are none to show. */
export function currentFormatRenderer(): FormatRenderer | null {
  const candidate = current as { composer?: unknown } | null;
  const composer = candidate?.composer;
  if (!composer || typeof composer !== 'object') return null;
  const renderer = composer as Partial<FormatRenderer>;
  return typeof renderer.streamFor === 'function' && Array.isArray(renderer.aspects) ? (composer as FormatRenderer) : null;
}

/** The live picture for one aspect ratio, exactly as the encoder for that format sees it. */
export function outputStreamFor(aspect: AspectRatio): MediaStream | null {
  return currentFormatRenderer()?.streamFor(aspect) ?? null;
}

export async function createEngine(options: CreateEngineOptions = {}): Promise<EngineChoice> {
  const mockMode = options.mockMode ?? false;

  if (mockMode) {
    const engine = createEngineForEnvironment({ preferMock: true, mock: options.mock });
    current = engine;
    return { engine, kind: engine.kind, host: 'mock' };
  }

  if (isMobileHost()) {
    // Lazy: the native engine pulls in the Capacitor plugin bridge, which must never be part of
    // the web bundle. A phone build that cannot load it falls through to the browser engine rather
    // than leaving the app with no engine at all.
    const native = await loadMobileEngine();
    if (native) {
      current = native;
      return { engine: native, kind: native.kind, host: 'mobile' };
    }
  }

  const engine = createEngineForEnvironment({
    preferMock: false,
    mock: options.mock,
    browser: { ...(relayOptions() ? { relay: relayOptions()! } : {}) },
  });
  current = engine;
  const host: EngineHost = isDesktopHost() ? 'desktop' : isMobileHost() ? 'mobile' : 'browser';
  return { engine, kind: engine.kind, host };
}

async function loadMobileEngine(): Promise<MediaEngine | null> {
  try {
    const mod = (await import('@livetap/mobile')) as {
      MobileEngine?: new (options: { platform: string }) => MediaEngine;
    };
    if (!mod.MobileEngine) return null;
    const platform = readCapacitorPlatform();
    return new mod.MobileEngine({ platform });
  } catch {
    return null;
  }
}

function readCapacitorPlatform(): string {
  const w = hostWindow() as { Capacitor?: { getPlatform?: () => string } } | undefined;
  try {
    return w?.Capacitor?.getPlatform?.() ?? 'android';
  } catch {
    return 'android';
  }
}
