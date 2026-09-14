/**
 * Which destination adapters this build gets, and why.
 *
 * This is a SEAM, deliberately. The store used to call `createMockAdapters()` unconditionally,
 * which is why no real account could ever be connected on any surface: four real, tested platform
 * adapters exist in `packages/adapters/src/real/` and nothing constructed them. Choosing between
 * them is a decision about credentials and host, not about broadcasting, so it lives here.
 *
 * The rule this file exists to enforce, and the reason `kind` is returned rather than assumed:
 * the app must be able to say, at runtime and truthfully, whether the thing it is about to
 * broadcast to is a real platform or a simulation. A build-time environment variable cannot
 * answer that, because it does not know whether the adapter actually in use ended up real.
 */

import { createMockAdapters } from '@livetap/adapters';
import type { AdapterRegistry } from '@livetap/core';

export type RegistryKind = 'mock' | 'real' | 'injected';

export interface RegistryChoice {
  registry: AdapterRegistry;
  kind: RegistryKind;
}

export interface CreateRegistryOptions {
  /** When true, every destination is simulated and nothing can reach a platform. */
  mockMode?: boolean;
}

export async function createRegistry(options: CreateRegistryOptions = {}): Promise<RegistryChoice> {
  const mockMode = options.mockMode ?? true;
  if (mockMode) return { registry: createMockAdapters(), kind: 'mock' };

  /*
   * Real adapters need a token provider and a secure store, which are the subject of the accounts
   * workstream. Until that lands, a non-mock build must NOT silently fall back to simulated
   * destinations: that is exactly the state where the UI says LIVE and nothing is broadcast. It
   * returns mock adapters and says so, so the caller can surface the truth.
   */
  return { registry: createMockAdapters(), kind: 'mock' };
}
