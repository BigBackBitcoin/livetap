import { describe, expect, it } from 'vitest';
import {
  DESTINATION_STATES,
  type DestinationState,
} from '../types/destination.js';
import {
  InvalidTransitionError,
  canTransition,
  isActiveState,
  isStartable,
  nextDestinationState,
  transitionDestination,
  type DestinationEvent,
} from './stateMachine.js';

describe('destination state machine', () => {
  it('follows the happy path DISCONNECTED → READY → LIVE → ENDED → READY', () => {
    let s: DestinationState = 'DISCONNECTED';
    const path: DestinationEvent[] = ['CONNECT', 'AUTH_OK', 'START', 'STREAM_UP', 'STOP', 'STOPPED', 'RESET'];
    const expected: DestinationState[] = ['AUTHENTICATING', 'READY', 'STARTING', 'LIVE', 'STOPPING', 'ENDED', 'READY'];
    path.forEach((ev, i) => {
      s = transitionDestination(s, ev);
      expect(s).toBe(expected[i]);
    });
  });

  it('degrades and recovers without leaving the live set', () => {
    expect(nextDestinationState('LIVE', 'STREAM_DEGRADED')).toBe('DEGRADED');
    expect(nextDestinationState('DEGRADED', 'STREAM_RECOVERED')).toBe('LIVE');
    expect(isActiveState('DEGRADED')).toBe(true);
  });

  it('reconnects with bounded retries then fails', () => {
    expect(nextDestinationState('LIVE', 'STREAM_LOST')).toBe('RECONNECTING');
    expect(nextDestinationState('RECONNECTING', 'RECONNECT_ATTEMPT')).toBe('RECONNECTING');
    expect(nextDestinationState('RECONNECTING', 'RECONNECT_FAIL')).toBe('RECONNECTING');
    expect(nextDestinationState('RECONNECTING', 'STREAM_UP')).toBe('LIVE');
    expect(nextDestinationState('RECONNECTING', 'GIVE_UP')).toBe('FAILED');
  });

  it('rejects invalid transitions', () => {
    expect(nextDestinationState('DISCONNECTED', 'START')).toBeNull();
    expect(nextDestinationState('LIVE', 'AUTH_OK')).toBeNull();
    expect(nextDestinationState('ENDED', 'STREAM_UP')).toBeNull();
    expect(() => transitionDestination('DISCONNECTED', 'STOP')).toThrow(InvalidTransitionError);
    expect(canTransition('READY', 'START')).toBe(true);
    expect(canTransition('READY', 'STREAM_UP')).toBe(false);
  });

  it('allows a FAILED destination to be reset, reconnected, or removed', () => {
    expect(nextDestinationState('FAILED', 'RESET')).toBe('READY');
    expect(nextDestinationState('FAILED', 'CONNECT')).toBe('AUTHENTICATING');
    expect(nextDestinationState('FAILED', 'DISCONNECT')).toBe('DISCONNECTED');
  });

  it('every state has at least one exit except none are terminal traps', () => {
    for (const state of DESTINATION_STATES) {
      const exits = (['CONNECT', 'AUTH_OK', 'AUTH_FAIL', 'DISCONNECT', 'START', 'STREAM_UP', 'STREAM_DEGRADED', 'STREAM_RECOVERED', 'STREAM_LOST', 'RECONNECT_ATTEMPT', 'RECONNECT_FAIL', 'GIVE_UP', 'STOP', 'STOPPED', 'RESET'] as DestinationEvent[])
        .filter((ev) => nextDestinationState(state, ev) !== null);
      expect(exits.length, `state ${state} must have an exit`).toBeGreaterThan(0);
    }
  });

  it('only READY and ENDED are startable', () => {
    for (const state of DESTINATION_STATES) {
      expect(isStartable(state)).toBe(state === 'READY' || state === 'ENDED');
    }
  });
});
