import type { DestinationState } from '../types/destination.js';

/**
 * Events that can act on a destination.
 * The transition table is the single source of truth for the destination lifecycle.
 */
export type DestinationEvent =
  | 'CONNECT' // user starts authentication / validation
  | 'AUTH_OK' // credentials validated, ingest resolvable
  | 'AUTH_FAIL'
  | 'DISCONNECT' // user removes credentials
  | 'START' // production goes live; adapter creates broadcast + engine pushes
  | 'STREAM_UP' // ingest accepted data / platform reports live
  | 'STREAM_DEGRADED' // packet loss / bitrate collapse but still connected
  | 'STREAM_RECOVERED' // health back to normal
  | 'STREAM_LOST' // ingest connection dropped
  | 'RECONNECT_ATTEMPT' // begin an attempt
  | 'RECONNECT_FAIL' // attempt failed (may retry)
  | 'GIVE_UP' // retries exhausted
  | 'STOP' // user/production stop
  | 'STOPPED' // adapter confirmed end
  | 'RESET'; // return an ENDED/FAILED destination to READY for the next session

type Table = Partial<Record<DestinationState, Partial<Record<DestinationEvent, DestinationState>>>>;

const TRANSITIONS: Table = {
  DISCONNECTED: {
    CONNECT: 'AUTHENTICATING',
  },
  AUTHENTICATING: {
    AUTH_OK: 'READY',
    AUTH_FAIL: 'DISCONNECTED',
    DISCONNECT: 'DISCONNECTED',
  },
  READY: {
    START: 'STARTING',
    DISCONNECT: 'DISCONNECTED',
    AUTH_FAIL: 'DISCONNECTED',
    CONNECT: 'AUTHENTICATING',
  },
  STARTING: {
    STREAM_UP: 'LIVE',
    STREAM_LOST: 'RECONNECTING',
    AUTH_FAIL: 'FAILED',
    GIVE_UP: 'FAILED',
    STOP: 'STOPPING',
  },
  LIVE: {
    STREAM_DEGRADED: 'DEGRADED',
    STREAM_LOST: 'RECONNECTING',
    STOP: 'STOPPING',
    AUTH_FAIL: 'FAILED',
    GIVE_UP: 'FAILED',
  },
  DEGRADED: {
    STREAM_RECOVERED: 'LIVE',
    STREAM_LOST: 'RECONNECTING',
    STOP: 'STOPPING',
    GIVE_UP: 'FAILED',
  },
  RECONNECTING: {
    RECONNECT_ATTEMPT: 'RECONNECTING',
    RECONNECT_FAIL: 'RECONNECTING',
    STREAM_UP: 'LIVE',
    GIVE_UP: 'FAILED',
    STOP: 'STOPPING',
    AUTH_FAIL: 'FAILED',
  },
  FAILED: {
    RESET: 'READY',
    DISCONNECT: 'DISCONNECTED',
    STOP: 'ENDED',
    CONNECT: 'AUTHENTICATING',
  },
  STOPPING: {
    STOPPED: 'ENDED',
    GIVE_UP: 'ENDED',
  },
  ENDED: {
    RESET: 'READY',
    DISCONNECT: 'DISCONNECTED',
    START: 'STARTING',
  },
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: DestinationState,
    public readonly event: DestinationEvent,
  ) {
    super(`Invalid destination transition: ${from} --${event}-->`);
    this.name = 'InvalidTransitionError';
  }
}

/** Returns the next state or null when the event is not valid in the current state. */
export function nextDestinationState(
  from: DestinationState,
  event: DestinationEvent,
): DestinationState | null {
  return TRANSITIONS[from]?.[event] ?? null;
}

/** Like nextDestinationState but throws on invalid transitions. */
export function transitionDestination(from: DestinationState, event: DestinationEvent): DestinationState {
  const next = nextDestinationState(from, event);
  if (next === null) throw new InvalidTransitionError(from, event);
  return next;
}

export function canTransition(from: DestinationState, event: DestinationEvent): boolean {
  return nextDestinationState(from, event) !== null;
}

/** States in which the destination is actively part of a live production. */
export const ACTIVE_STATES: ReadonlySet<DestinationState> = new Set([
  'STARTING',
  'LIVE',
  'DEGRADED',
  'RECONNECTING',
]);

export function isActiveState(state: DestinationState): boolean {
  return ACTIVE_STATES.has(state);
}

/** States from which GO LIVE may start this destination. */
export function isStartable(state: DestinationState): boolean {
  return state === 'READY' || state === 'ENDED';
}
