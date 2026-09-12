import { AdapterRegistry, PLATFORM_IDS, type PlatformId } from '@livetap/core';
import { mockProfile } from '../profiles/index.js';
import { MockDestinationAdapter, type MockScenario } from './MockDestinationAdapter.js';

export { MOCK_BANNER, MockAdapterError, MockDestinationAdapter } from './MockDestinationAdapter.js';
export type { MockBroadcastHandle, MockScenario, MockTimers } from './MockDestinationAdapter.js';
export { mulberry32 } from './rng.js';
export type { Rng } from './rng.js';
export { MOCK_BADGE_POOL, MOCK_DISPLAY_NAMES, MOCK_MESSAGES } from './corpus.js';

/**
 * A registry containing a mock adapter for every platform.
 *
 * Mock mode is isolated by construction: this is the only place mock adapters are created,
 * every profile is marked `mock: true`, and no adapter here can reach the network.
 * Per-platform scenario overrides let a demo script fail exactly one destination.
 */
export function createMockAdapters(
  scenario: MockScenario = {},
  overrides: Partial<Record<PlatformId, MockScenario>> = {},
): AdapterRegistry {
  const registry = new AdapterRegistry();
  for (const id of PLATFORM_IDS) {
    // Distinct seeds per platform so two mock chats do not read identically side by side.
    const seed = (scenario.seed ?? 20260911) + platformSeedOffset(id);
    registry.register(
      new MockDestinationAdapter(mockProfile(id), { ...scenario, seed, ...overrides[id] }),
    );
  }
  return registry;
}

function platformSeedOffset(id: PlatformId): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash % 10000);
}
