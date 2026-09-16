import { describe, expect, it } from 'vitest';
import type { ConnectionHealth } from '@livetap/core';
import type { BondHealth } from '@livetap/bond/browser';

/**
 * `ConnectionHealth` is declared in `@livetap/core` rather than imported from `@livetap/bond`, so
 * that core stays dependency-free and the web bundle can never reach the bonding package's Node
 * surface through a type import that someone later makes a value import.
 *
 * The cost of that decision is two declarations of one union, and the risk is that they drift: a
 * member added to Bond and not to core would be reported by an engine and unrepresentable in the
 * metrics a UI reads. Core's comment promises a type-level assertion catches it. This is it, and
 * it fails at COMPILE time in both directions -- a member in either union that the other lacks is
 * a build error, not a test failure discovered later.
 */
const FROM_BOND: Record<BondHealth, true> = {
  excellent: true,
  protected: true,
  degraded: true,
  insufficient: true,
  offline: true,
};

// Assignable both ways only when the two key sets are identical.
const FROM_CORE: Record<ConnectionHealth, true> = FROM_BOND;
const BACK: Record<BondHealth, true> = FROM_CORE;

describe('ConnectionHealth and BondHealth', () => {
  it('have not drifted apart', () => {
    expect(Object.keys(BACK).sort()).toEqual([
      'degraded',
      'excellent',
      'insufficient',
      'offline',
      'protected',
    ]);
  });
});
