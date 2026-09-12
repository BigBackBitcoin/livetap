// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserEngine, MockEngine, createEngineForEnvironment } from './index.js';

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
