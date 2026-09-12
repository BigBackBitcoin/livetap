import { describe, expect, it } from 'vitest';
import { DEFAULT_RECONNECT_POLICY, reconnectDelayMs, shouldRetry } from './reconnect.js';

describe('reconnect backoff', () => {
  const noJitter = () => 0.5; // (0.5 - 0.5) * span = 0

  it('grows exponentially and caps at maxDelayMs', () => {
    const p = { ...DEFAULT_RECONNECT_POLICY, jitter: 0 };
    expect(reconnectDelayMs(p, 1, noJitter)).toBe(1000);
    expect(reconnectDelayMs(p, 2, noJitter)).toBe(2000);
    expect(reconnectDelayMs(p, 3, noJitter)).toBe(4000);
    expect(reconnectDelayMs(p, 6, noJitter)).toBe(30000);
    expect(reconnectDelayMs(p, 20, noJitter)).toBe(30000);
  });

  it('applies bounded jitter', () => {
    const p = { ...DEFAULT_RECONNECT_POLICY, jitter: 0.2 };
    expect(reconnectDelayMs(p, 1, () => 0)).toBe(900);
    expect(reconnectDelayMs(p, 1, () => 1)).toBe(1100);
  });

  it('never returns negative and treats attempt < 1 as 1', () => {
    const p = { ...DEFAULT_RECONNECT_POLICY, jitter: 1 };
    expect(reconnectDelayMs(p, 0, () => 0)).toBeGreaterThanOrEqual(0);
    expect(reconnectDelayMs(p, -5, noJitter)).toBe(1000);
  });

  it('respects maxAttempts and enabled', () => {
    expect(shouldRetry(DEFAULT_RECONNECT_POLICY, 1)).toBe(true);
    expect(shouldRetry(DEFAULT_RECONNECT_POLICY, 10)).toBe(true);
    expect(shouldRetry(DEFAULT_RECONNECT_POLICY, 11)).toBe(false);
    expect(shouldRetry({ ...DEFAULT_RECONNECT_POLICY, enabled: false }, 1)).toBe(false);
  });
});
