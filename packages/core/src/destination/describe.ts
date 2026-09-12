import type { DestinationSnapshot } from '../types/destination.js';

/**
 * Beginner-facing one-liner for a destination's reconnect state, e.g.
 * "Trying again in 4 s (attempt 2 of 10)". Empty when not reconnecting.
 */
export function describeReconnect(snapshot: DestinationSnapshot, now = Date.now()): { line: string; secondsLeft?: number } {
  if (snapshot.state !== 'RECONNECTING') return { line: '' };
  const attempt = Math.max(1, snapshot.reconnectAttempt);
  const of = snapshot.reconnectMaxAttempts ? ` of ${snapshot.reconnectMaxAttempts}` : '';
  if (snapshot.nextRetryAt !== undefined && snapshot.nextRetryAt > now) {
    const secondsLeft = Math.max(1, Math.ceil((snapshot.nextRetryAt - now) / 1000));
    return { line: `Trying again in ${secondsLeft} s (attempt ${attempt}${of})`, secondsLeft };
  }
  return { line: `Reconnecting now (attempt ${attempt}${of})` };
}
