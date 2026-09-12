import type { ReconnectPolicy } from '../types/production.js';

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  enabled: true,
  maxAttempts: 10,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitter: 0.2,
};

/**
 * Exponential backoff with bounded jitter.
 * attempt is 1-based. Deterministic when `random` is injected (tests).
 */
export function reconnectDelayMs(
  policy: ReconnectPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  const a = Math.max(1, Math.floor(attempt));
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * Math.pow(policy.multiplier, a - 1));
  const jitterSpan = base * Math.max(0, Math.min(1, policy.jitter));
  // Jitter in [-span/2, +span/2]
  const jitter = (random() - 0.5) * jitterSpan;
  return Math.max(0, Math.round(base + jitter));
}

export function shouldRetry(policy: ReconnectPolicy, attempt: number): boolean {
  return policy.enabled && attempt <= policy.maxAttempts;
}
