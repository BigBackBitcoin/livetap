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
 * A real build is NOT all-or-nothing, and it is not all-or-nothing per platform either. There
 * are two real ways to reach a platform and this file registers whichever one is available:
 *
 *   LEVEL 1  LIVETAP holds an OAuth client for the platform, signs the creator in, fetches the
 *            stream key itself and never shows it to them. This is the goal, and the platform's
 *            own adapter does it.
 *   LEVEL 3  Nobody registered an OAuth client, so the creator copies the ingest address and
 *            stream key off their own studio page and pastes both. The real custom-RTMP adapter
 *            does it, wearing that platform's own profile, and puts real bytes on a real wire.
 *
 * Before this, level 3 existed only for Instagram, TikTok and X, and a build with nothing
 * configured — the normal state of every build an owner can run today — simply had no adapter
 * for YouTube, Twitch, Facebook or Kick at all, so those platforms failed at connect with
 * nothing the creator could do about it. They now fall back rather than vanish.
 *
 * The fallback is one-directional and must stay that way: a platform whose OAuth client IS
 * configured keeps its API adapter and is never downgraded to paste, because downgrading would
 * take the stream key back out of LIVETAP's hands and put it in the creator's.
 */

import {
  createMockAdapters,
  CustomRtmpAdapter,
  FacebookAdapter,
  KickAdapter,
  PASTE_CAPABLE_PLATFORMS,
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
  /**
   * Platforms this registry can actually sign a creator in to. Empty on a mock build, and empty
   * on a real build with no OAuth client configured.
   *
   * This is the set that got a real API adapter, tracked as the adapters are built rather than
   * derived afterwards from `registry.get(...) !== undefined`. Since every paste-capable
   * platform now has *an* adapter, asking the registry would answer "yes, connectable" for a
   * platform whose only adapter takes a pasted key — which is exactly the lie this field exists
   * to prevent.
   */
  connectable: PlatformId[];
  /**
   * Platforms that got the paste adapter because no API path was available to them in this
   * build. The creator can broadcast to every one of these today, by pasting two values.
   */
  pasteOnly: PlatformId[];
}

export interface CreateRegistryOptions {
  /** When true, every destination is simulated and nothing can reach a platform. */
  mockMode?: boolean;
  fetchImpl?: typeof fetch;
}

export async function createRegistry(options: CreateRegistryOptions = {}): Promise<RegistryChoice> {
  const mockMode = options.mockMode ?? true;
  if (mockMode) {
    return { registry: createMockAdapters(), kind: 'mock', connectable: [], pasteOnly: [] };
  }

  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  const config = await readConfig(doFetch);

  const registry = new AdapterRegistry();
  // Always present, on every build: a destination the creator pasted a URL and key into needs no
  // account and no credentials, and is the one path that works with nothing configured at all.
  registry.register(new CustomRtmpAdapter());

  // Level 1 first, so the paste pass below can see which platforms are already spoken for.
  // Without `fetch` no platform API can be reached at all, so there is nothing to register.
  const connectable: PlatformId[] = [];
  if (doFetch) {
    for (const platform of configuredPlatformIds(config) as PlatformId[]) {
      if (registerApiAdapter(registry, platform, doFetch, config)) connectable.push(platform);
    }
  }

  // Level 3: everything the API path did not claim. Registering the platform's own profile, not
  // `customProfile`, is the whole point — the profile carries the aspect ratios, the bitrate
  // ceiling and the eligibility notes the UI reads, and the generic one would make an Instagram
  // destination claim it accepts 16:9.
  const pasteOnly: PlatformId[] = [];
  for (const platform of PASTE_CAPABLE_PLATFORMS) {
    if (registry.get(platform) !== undefined) continue;
    registry.register(new CustomRtmpAdapter(pasteKeyProfile(platform)));
    pasteOnly.push(platform);
  }

  return { registry, kind: 'real', connectable, pasteOnly };
}

/**
 * Build the platform's own API adapter, or decline and say nothing.
 *
 * Returns false when this build cannot actually sign the creator in to the platform, which is
 * the caller's cue to leave it to the paste path.
 */
function registerApiAdapter(
  registry: AdapterRegistry,
  platform: PlatformId,
  doFetch: typeof fetch,
  config: OAuthConfigResponse | undefined,
): boolean {
  const tokenProvider = tokenProviderFor(platform);
  if (platform === 'youtube') {
    registry.register(new YouTubeAdapter({ fetch: doFetch, tokenProvider }));
    return true;
  }
  if (platform === 'twitch') {
    const clientId = config?.platforms?.twitch?.clientId;
    // Helix refuses every request without Client-Id, so a Twitch adapter with no client id is
    // an adapter that can only fail. Declining here hands Twitch to the paste path instead,
    // which needs no client id and works.
    if (!clientId) return false;
    registry.register(new TwitchAdapter({ fetch: doFetch, tokenProvider, clientId }));
    return true;
  }
  if (platform === 'kick') {
    registry.register(new KickAdapter({ fetch: doFetch, tokenProvider }));
    return true;
  }
  if (platform === 'facebook') {
    registry.register(new FacebookAdapter({ fetch: doFetch, tokenProvider }));
    return true;
  }
  // Instagram, TikTok and X have OAuth that grants no live capability, and LinkedIn is
  // partner-only. None of them has an API adapter to register, configured or not.
  return false;
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
