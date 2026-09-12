import { describe, expect, it } from 'vitest';
import { describeReconnect } from './describe.js';
import type { DestinationSnapshot } from '../types/destination.js';

const snap = (over: Partial<DestinationSnapshot>): DestinationSnapshot => ({
  config: { id: 'd', platform: 'twitch', label: 'Twitch', aspectRatio: '16:9', enabled: true, mock: true },
  state: 'RECONNECTING',
  reconnectAttempt: 2,
  reconnectMaxAttempts: 10,
  stateChangedAt: 0,
  ...over,
});

describe('describeReconnect', () => {
  it('counts down to the next attempt and shows attempt n of max', () => {
    expect(describeReconnect(snap({ nextRetryAt: 4_400 }), 1_000).line).toBe('Trying again in 4 s (attempt 2 of 10)');
  });
  it('rounds up and never shows 0 s', () => {
    expect(describeReconnect(snap({ nextRetryAt: 1_100 }), 1_000).line).toBe('Trying again in 1 s (attempt 2 of 10)');
  });
  it('says reconnecting now once the timer has fired', () => {
    expect(describeReconnect(snap({ nextRetryAt: undefined }), 1_000).line).toBe('Reconnecting now (attempt 2 of 10)');
  });
  it('omits the max when the policy is unknown and is empty outside RECONNECTING', () => {
    expect(describeReconnect(snap({ reconnectMaxAttempts: undefined, nextRetryAt: 3_000 }), 1_000).line).toBe('Trying again in 2 s (attempt 2)');
    expect(describeReconnect(snap({ state: 'LIVE' }), 1_000).line).toBe('');
  });
});
