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

/**
 * BOND'S JUDGMENT REACHES THE CREATOR.
 *
 * Everything else in this evaluator is a proxy: a stream under target might be a congested uplink
 * or an encoder that cannot keep up, and it has to guess from the shape of the numbers. Bond
 * measures the path, so when it has an opinion it is evidence — and it carries the one thing this
 * function could never produce on its own, a bitrate the network has actually been shown to hold.
 */
describe('connection health from Bond', () => {
  const healthy = (over: Partial<EngineMetrics> = {}): EngineMetrics => ({
    encodedKbps: 6000,
    targetKbps: 6000,
    encoderDroppedPct: 0,
    networkDroppedPct: 0,
    renderFps: 30,
    targetFps: 30,
    updatedAt: 1_000,
    ...over,
  });

  it('says the connection dropped, rather than leaving a healthy-looking readout', () => {
    const h = evaluateHealth(healthy({ connectionHealth: 'offline' }), 1_000);
    expect(h.level).toBe('critical');
    expect(h.headline).toMatch(/connection dropped/i);
  });

  /* The number is the point: "try about 2500 kbps" is actionable, "lower your bitrate" is homework. */
  it('names a bitrate the network can actually carry', () => {
    const h = evaluateHealth(
      healthy({ connectionHealth: 'insufficient', recommendedKbps: 2500 }),
      1_000,
    );
    expect(h.level).toBe('poor');
    expect(h.detail).toMatch(/2500 kbps/);
    expect(h.suggestion).toBe('lowerBitrate');
  });

  it('does not promise a number it does not have', () => {
    const h = evaluateHealth(healthy({ connectionHealth: 'insufficient' }), 1_000);
    expect(h.detail).not.toMatch(/kbps\./);
    expect(h.suggestion).toBe('lowerBitrate');
  });

  /*
   * Bond knows about the network and nothing else. An excellent path over a stalling encoder is
   * still a bad broadcast, and clearing it would be the exact "LIVE with nothing working" lie the
   * product keeps designing against.
   */
  it('never clears an encoder problem just because the network is fine', () => {
    const struggling = healthy({
      connectionHealth: 'excellent',
      encoderDroppedPct: 9,
      renderFps: 12,
    });
    const h = evaluateHealth(struggling, 1_000);
    expect(['poor', 'critical']).toContain(h.level);
    expect(h.suggestion).not.toBe('none');
  });

  it('leaves the assessment alone when Bond has no opinion', () => {
    const withBond = evaluateHealth(healthy({ connectionHealth: 'excellent' }), 1_000);
    const without = evaluateHealth(healthy(), 1_000);
    expect(withBond).toEqual(without);
  });
});
