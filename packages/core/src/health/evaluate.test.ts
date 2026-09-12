import { describe, expect, it } from 'vitest';
import type { EngineMetrics } from '../types/health.js';
import { evaluateHealth } from './evaluate.js';

const base = (over: Partial<EngineMetrics> = {}): EngineMetrics => ({
  encodedKbps: 4500,
  targetKbps: 4500,
  encoderDroppedPct: 0,
  networkDroppedPct: 0,
  renderFps: 30,
  targetFps: 30,
  updatedAt: 1000,
  ...over,
});

describe('evaluateHealth', () => {
  it('reports unknown when metrics are missing or stale', () => {
    expect(evaluateHealth(undefined, 1000).level).toBe('unknown');
    expect(evaluateHealth(base({ updatedAt: 0 }), 20_000).level).toBe('unknown');
  });

  it('reports excellent for perfect metrics', () => {
    const h = evaluateHealth(base(), 1000);
    expect(h.level).toBe('excellent');
    expect(h.suggestion).toBe('none');
    expect(h.headline).toBe('Stream is excellent');
  });

  it('flags network trouble and suggests lower bitrate', () => {
    const h = evaluateHealth(base({ networkDroppedPct: 6, encodedKbps: 2000 }), 1000);
    expect(['poor', 'critical']).toContain(h.level);
    expect(h.suggestion).toBe('lowerBitrate');
    expect(h.detail).toMatch(/connection/i);
    expect(h.reasons.join(' ')).toContain('network dropped frames 6.0%');
  });

  it('flags encoder overload and suggests lower resolution', () => {
    const h = evaluateHealth(base({ encoderDroppedPct: 8, renderFps: 18, cpuPct: 97 }), 1000);
    expect(['poor', 'critical']).toContain(h.level);
    expect(h.suggestion).toBe('lowerResolution');
    expect(h.detail).toMatch(/device/i);
  });

  it('is only fair for small dips', () => {
    const h = evaluateHealth(base({ networkDroppedPct: 1.5, encodedKbps: 3400 }), 1000);
    expect(h.level).toBe('fair');
    expect(h.suggestion).toBe('none');
  });
});

describe('evaluateHealth with destination state', () => {
  it('never says excellent while a destination is reconnecting', () => {
    const h = evaluateHealth(base(), 1000, { reconnecting: 1, degraded: 0, failed: 0 });
    expect(h.level).toBe('poor');
    expect(h.headline).toBe('One destination is reconnecting');
    expect(h.detail).toMatch(/other destinations keep streaming/);
  });
  it('caps at fair while a destination is degraded and keeps worse engine levels', () => {
    expect(evaluateHealth(base(), 1000, { reconnecting: 0, degraded: 2, failed: 0 }).level).toBe('fair');
    expect(evaluateHealth(base({ networkDroppedPct: 6, encodedKbps: 1500 }), 1000, { reconnecting: 0, degraded: 1, failed: 0 }).level).toBe('critical');
  });
  it('is unchanged when every destination is healthy', () => {
    expect(evaluateHealth(base(), 1000, { reconnecting: 0, degraded: 0, failed: 0 }).level).toBe('excellent');
  });
});
