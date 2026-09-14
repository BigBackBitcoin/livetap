// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserEngine, DesktopEngine, MockEngine, createEngineForEnvironment, isDesktopHost } from './index.js';

function stubMediaDevices(value: unknown): () => void {
  const nav = globalThis.navigator as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(nav, 'mediaDevices');
  const previous = nav.mediaDevices;
  Object.defineProperty(nav, 'mediaDevices', { value, configurable: true, writable: true });
  return () => {
    if (had) Object.defineProperty(nav, 'mediaDevices', { value: previous, configurable: true, writable: true });
    else delete nav.mediaDevices;
  };
}

/** Stand in for what apps/desktop/src/preload/index.ts exposes on the real window. */
function stubDesktopHost(): () => void {
  const w = globalThis.window as unknown as Record<string, unknown>;
  w.livetapHost = { kind: 'desktop' };
  w.livetap = { engine: { capabilities: () => Promise.resolve({}) } };
  return () => {
    delete w.livetapHost;
    delete w.livetap;
  };
}

describe('createEngineForEnvironment', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('returns the MockEngine when explicitly preferred', () => {
    cleanups.push(stubMediaDevices({ getUserMedia: () => Promise.resolve() }));
    const engine = createEngineForEnvironment({ preferMock: true });
    expect(engine).toBeInstanceOf(MockEngine);
    expect(engine.kind).toBe('mock');
  });

  it('returns the MockEngine when the environment has no mediaDevices', () => {
    cleanups.push(stubMediaDevices(undefined));
    expect(createEngineForEnvironment().kind).toBe('mock');
  });

  it('returns the BrowserEngine when getUserMedia exists', () => {
    cleanups.push(stubMediaDevices({ getUserMedia: () => Promise.resolve() }));
    const engine = createEngineForEnvironment();
    expect(engine).toBeInstanceOf(BrowserEngine);
    expect(engine.kind).toBe('browser');
  });

  it('returns the DesktopEngine inside the Electron shell, which is the only engine that can publish RTMP there', () => {
    cleanups.push(stubMediaDevices({ getUserMedia: () => Promise.resolve() }));
    cleanups.push(stubDesktopHost());
    expect(isDesktopHost()).toBe(true);
    const engine = createEngineForEnvironment();
    expect(engine).toBeInstanceOf(DesktopEngine);
    expect(engine.kind).toBe('ffmpeg');
  });

  it('does not pick the desktop engine from the marker alone when the bridge is missing', () => {
    cleanups.push(stubMediaDevices({ getUserMedia: () => Promise.resolve() }));
    const w = globalThis.window as unknown as Record<string, unknown>;
    w.livetapHost = { kind: 'desktop' };
    cleanups.push(() => {
      delete w.livetapHost;
    });
    expect(isDesktopHost()).toBe(false);
    expect(createEngineForEnvironment()).toBeInstanceOf(BrowserEngine);
  });

  it('still honours preferMock inside the desktop shell', () => {
    cleanups.push(stubMediaDevices({ getUserMedia: () => Promise.resolve() }));
    cleanups.push(stubDesktopHost());
    expect(createEngineForEnvironment({ preferMock: true })).toBeInstanceOf(MockEngine);
  });

  it('passes options through to the chosen engine', async () => {
    cleanups.push(stubMediaDevices(undefined));
    const engine = createEngineForEnvironment({ mock: { connectDelayMs: 1 } });
    expect((await engine.capabilities()).verification).toBe('SIMULATED');
  });

  it('never hands back an engine that claims RTMP it does not have', async () => {
    cleanups.push(stubMediaDevices({ getUserMedia: () => Promise.resolve() }));
    const caps = await createEngineForEnvironment({ browser: { RTCPeerConnectionCtor: null } }).capabilities();
    expect(caps.rtmp).toBe(false);
    expect(caps.whip).toBe(false);
  });
});
