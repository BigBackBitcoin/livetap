import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  classifySample,
  isPending,
  isUsable,
  nextPathState,
  type PathEvent,
} from './stateMachine.js';
import type { PathSample, PathState } from './types.js';

/** A sample of a path that is behaving perfectly, which individual tests then spoil. */
function sample(overrides: Partial<PathSample> = {}): PathSample {
  return {
    at: 1000,
    throughputBps: 8_000_000,
    rttMs: 30,
    jitterMs: 4,
    loss: 0,
    retransmitRate: 0,
    atCapacity: false,
    ...overrides,
  };
}

describe('nextPathState', () => {
  it('walks a new network from nothing to carrying traffic', () => {
    let state: PathState = 'UNAVAILABLE';
    state = nextPathState(state, { kind: 'appeared' });
    expect(state).toBe('DISCOVERING');
    state = nextPathState(state, { kind: 'probeStarted' });
    expect(state).toBe('TESTING');
    state = nextPathState(state, { kind: 'probeSucceeded' });
    expect(state).toBe('HEALTHY');
  });

  it('never lets the OS opinion alone put a path into service', () => {
    // `appeared` means the OS is offering a network. That is not evidence it reaches our relay,
    // and a path must not be schedulable until a probe has come back.
    const state = nextPathState('UNAVAILABLE', { kind: 'appeared' });
    expect(isUsable(state)).toBe(false);
    expect(isPending(state)).toBe(true);
  });

  it('treats a withdrawn network as failed from every single state', () => {
    const states: PathState[] = [
      'UNAVAILABLE',
      'DISCOVERING',
      'TESTING',
      'HEALTHY',
      'DEGRADED',
      'SATURATED',
      'UNSTABLE',
      'FAILED',
      'RECOVERING',
    ];
    for (const state of states) {
      expect(nextPathState(state, { kind: 'disappeared' })).toBe('FAILED');
    }
  });

  it('recovers only when the OS offers the network again, not when a probe replies', () => {
    // A probe cannot travel down a network we no longer hold, so a success here is a stale reply
    // from before the loss. Believing it would put a dead path straight back into the schedule.
    expect(nextPathState('FAILED', { kind: 'probeSucceeded' })).toBe('FAILED');
    expect(nextPathState('FAILED', { kind: 'measured', sample: sample() })).toBe('FAILED');
    expect(nextPathState('FAILED', { kind: 'appeared' })).toBe('RECOVERING');
  });

  it('re-tests a recovering path before trusting it again', () => {
    let state: PathState = nextPathState('FAILED', { kind: 'appeared' });
    expect(state).toBe('RECOVERING');
    expect(isUsable(state)).toBe(false);
    state = nextPathState(state, { kind: 'probeStarted' });
    expect(state).toBe('TESTING');
    state = nextPathState(state, { kind: 'probeSucceeded' });
    expect(state).toBe('HEALTHY');
  });

  it('does not send an in-service path back to TESTING when a probe replies', () => {
    // Probes keep running while a path carries traffic. A reply is good news, not a reason to
    // pull the path out of service and re-qualify it.
    expect(nextPathState('HEALTHY', { kind: 'probeSucceeded' })).toBe('HEALTHY');
    expect(nextPathState('DEGRADED', { kind: 'probeSucceeded' })).toBe('DEGRADED');
    expect(nextPathState('SATURATED', { kind: 'probeSucceeded' })).toBe('SATURATED');
  });

  it('fails an in-service path whose probe stops coming back', () => {
    const states: PathState[] = ['HEALTHY', 'DEGRADED', 'SATURATED', 'UNSTABLE'];
    for (const state of states) {
      expect(nextPathState(state, { kind: 'probeFailed' })).toBe('FAILED');
    }
  });

  it('ignores events that mean nothing in the current state', () => {
    const noise: PathEvent[] = [
      { kind: 'probeStarted' },
      { kind: 'measured', sample: sample() },
    ];
    for (const event of noise) {
      expect(nextPathState('UNAVAILABLE', event)).toBe('UNAVAILABLE');
    }
  });
});

describe('classifySample', () => {
  const context = { baselineRttMs: 30, recentTransitions: 0 };

  it('calls a clean path healthy', () => {
    expect(classifySample(sample(), context)).toBe('HEALTHY');
  });

  it('calls a lossy path degraded', () => {
    expect(classifySample(sample({ loss: 0.05 }), context)).toBe('DEGRADED');
  });

  it('calls a slow path degraded even with no loss at all', () => {
    expect(classifySample(sample({ rttMs: 400 }), context)).toBe('DEGRADED');
  });

  it('calls a path that keeps resending degraded', () => {
    expect(classifySample(sample({ retransmitRate: 0.2 }), context)).toBe('DEGRADED');
  });

  it('separates a full path from a broken one', () => {
    // The signature of saturation is delay growing while loss does not: the queue in front of the
    // bottleneck is filling because WE filled it. That is not a reason to take traffic away.
    const full = sample({ atCapacity: true, rttMs: 30 * 3, loss: 0 });
    expect(classifySample(full, context)).toBe('SATURATED');

    // The same delay with loss alongside it is a path in trouble, not a path that is merely busy.
    const broken = sample({ atCapacity: true, rttMs: 30 * 3, loss: 0.05 });
    expect(classifySample(broken, context)).toBe('DEGRADED');
  });

  it('never concludes saturation from delay alone when nothing is pushing the path', () => {
    // 400 ms is far past the saturation multiple (30 x 2.5 = 75) and would be called SATURATED if
    // the rule were about delay alone. Without `atCapacity` there is no reason to believe WE
    // caused it, so the honest reading is a path that has become slow: DEGRADED, give it less.
    const idleButSlow = sample({ atCapacity: false, rttMs: 400 });
    expect(classifySample(idleButSlow, context)).toBe('DEGRADED');
  });

  it('leaves a path alone when its delay grew but is still comfortably fast', () => {
    // Deliberate: 120 ms is four times this path's baseline and still fine for live media. The
    // degraded test is an absolute threshold, not a relative one, because demoting a path that is
    // delivering perfectly well costs a reschedule and buys nothing.
    expect(classifySample(sample({ rttMs: 120 }), context)).toBe('HEALTHY');
  });

  it('judges saturation against the path own baseline, not a fixed number', () => {
    // 150 ms is saturation for a 30 ms Wi-Fi path and unremarkable for a 120 ms cellular one.
    const at150 = sample({ atCapacity: true, rttMs: 150 });
    expect(classifySample(at150, { baselineRttMs: 30, recentTransitions: 0 })).toBe('SATURATED');
    expect(classifySample(at150, { baselineRttMs: 120, recentTransitions: 0 })).toBe('HEALTHY');
  });

  it('cannot conclude saturation with no baseline to compare against', () => {
    const noBaseline = { recentTransitions: 0 };
    expect(classifySample(sample({ atCapacity: true, rttMs: 500 }), noBaseline)).toBe('DEGRADED');
  });

  it('calls a flapping path unstable however good its current numbers look', () => {
    // A path that keeps coming back costs a reschedule every time. The damage is the churn, and a
    // perfect sample taken during a good moment must not clear it.
    const flapping = { baselineRttMs: 30, recentTransitions: DEFAULT_THRESHOLDS.flapCount };
    expect(classifySample(sample(), flapping)).toBe('UNSTABLE');
  });

  it('calls a jittery path unstable rather than merely slow', () => {
    expect(classifySample(sample({ jitterMs: 200 }), context)).toBe('UNSTABLE');
  });
});

describe('isUsable / isPending', () => {
  it('lets a degraded or saturated path keep carrying traffic', () => {
    // Both are still delivering. Dropping them because they are imperfect is how a bond makes a
    // stream worse than a single path would have been.
    expect(isUsable('DEGRADED')).toBe(true);
    expect(isUsable('SATURATED')).toBe(true);
  });

  it('keeps unqualified, unstable and dead paths out of the schedule', () => {
    for (const state of ['UNAVAILABLE', 'DISCOVERING', 'TESTING', 'UNSTABLE', 'FAILED', 'RECOVERING'] as PathState[]) {
      expect(isUsable(state)).toBe(false);
    }
  });
});
