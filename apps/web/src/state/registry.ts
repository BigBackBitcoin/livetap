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
 *
 * A real build is NOT all-or-nothing. Four platforms have real adapters; the rest are either
 * paste-key (Instagram, TikTok, X) or impossible (LinkedIn). A real registry registers the real
 * adapter where one exists, the real custom-RTMP adapter for everything that takes a pasted key,
 * and nothing at all for the rest, so a platform LIVETAP cannot serve fails loudly at connect
 * instead of quietly simulating.
 */

import {
  createMockAdapters,
  CustomRtmpAdapter,
  FacebookAdapter,
  KickAdapter,
  PLATFORM_PROFILES,
  TwitchAdapter,
  YouTubeAdapter,
} from '@livetap/adapters';
import { AdapterRegistry, type PlatformId, type PlatformProfile } from '@livetap/core';
import { brokerBaseUrl, configuredPlatformIds, type OAuthConfigResponse } from './mockMode.js';
import { tokenProviderFor } from './tokens.js';

export type RegistryKind = 'mock' | 'real' | 'injected';

export interface RegistryChoice {
  registry: AdapterRegistry;
  kind: RegistryKind;
  /** Platforms this registry can actually sign a creator in to. Empty on a mock build. */
  connectable: PlatformId[];
}

export interface CreateRegistryOptions {
  /** When true, every destination is simulated and nothing can reach a platform. */
  mockMode?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Platforms whose live capability is a stream key the creator pastes, with or without an account.
 * They get the real custom-RTMP adapter, which pushes real bytes to whatever they pasted.
 */
const PASTE_KEY_PLATFORMS: readonly PlatformId[] = ['instagram', 'tiktok', 'x'];

export async function createRegistry(options: CreateRegistryOptions = {}): Promise<RegistryChoice> {
  const mockMode = options.mockMode ?? true;
  if (mockMode) return { registry: createMockAdapters(), kind: 'mock', connectable: [] };

  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  const config = await readConfig(doFetch);
  const connectable = configuredPlatformIds(config) as PlatformId[];

  const registry = new AdapterRegistry();
  // Always present, on every build: a destination the creator pasted a URL and key into needs no
  // account and no credentials, and is the one path that works with nothing configured at all.
  registry.register(new CustomRtmpAdapter());
  for (const platform of PASTE_KEY_PLATFORMS) {
    registry.register(new CustomRtmpAdapter(pasteKeyProfile(platform)));
  }

  if (!doFetch) {
    // No fetch means no platform API can be reached at all, so only the paste path is honest.
    return { registry, kind: 'real', connectable: [] };
  }

  for (const platform of connectable) {
    const tokenProvider = tokenProviderFor(platform);
    if (platform === 'youtube') {
      registry.register(new YouTubeAdapter({ fetch: doFetch, tokenProvider }));
    } else if (platform === 'twitch') {
      const clientId = config?.platforms?.twitch?.clientId;
      // Helix refuses every request without Client-Id, so a Twitch adapter with no client id is
      // an adapter that can only fail. Leaving it unregistered says that at connect time.
      if (clientId) registry.register(new TwitchAdapter({ fetch: doFetch, tokenProvider, clientId }));
    } else if (platform === 'kick') {
      registry.register(new KickAdapter({ fetch: doFetch, tokenProvider }));
    } else if (platform === 'facebook') {
      registry.register(new FacebookAdapter({ fetch: doFetch, tokenProvider }));
    }
  }

  return { registry, kind: 'real', connectable: connectable.filter((p) => registry.get(p) !== undefined) };
}

async function readConfig(doFetch: typeof fetch | undefined): Promise<OAuthConfigResponse | undefined> {
  if (!doFetch) return undefined;
  try {
    const response = await doFetch(`${brokerBaseUrl()}/api/oauth/config`);
    if (!response.ok) return undefined;
    return (await response.json()) as OAuthConfigResponse;
  } catch {
    return undefined;
  }
}

/**
 * A paste-key platform's own profile, wearing the custom adapter.
 *
 * The profile has to stay the platform's own: it carries the aspect ratios, the bitrate ceiling
 * and the eligibility notes the UI reads, and swapping in `customProfile` would make an Instagram
 * destination claim it accepts 16:9. Only the machinery behind it is the generic RTMP sender,
 * which is exactly what these platforms hand a creator.
 */
function pasteKeyProfile(platform: PlatformId): PlatformProfile {
  return PLATFORM_PROFILES[platform];
}
