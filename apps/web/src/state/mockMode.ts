/**
 * Mock mode is the default, and the default is loud about itself (ADR-007).
 *
 * Two ways in: the build says so (`VITE_LIVETAP_MOCK_MODE` is anything but the string
 * `"false"`), or the deployment has no OAuth client configured at all, in which case
 * "Connect account" could not possibly work and pretending otherwise would be a lie.
 */
export function envMockMode(): boolean {
  const value = (import.meta.env as Record<string, string | undefined>).VITE_LIVETAP_MOCK_MODE;
  return value !== 'false';
}

/** One platform's row in `GET /api/oauth/config`. Public client ids only, never a secret. */
export interface PlatformConfigEntry {
  configured: boolean;
  clientId?: string;
}

export interface OAuthConfigResponse {
  /**
   * Keyed by platform, exactly as `configuredPlatforms()` builds it.
   *
   * This used to be typed as `string[]` and probed with `Array.isArray`, which is never true for
   * the object the endpoint actually returns. The consequence was not a type error but a silent
   * behavioural one: every probe concluded "no platforms configured", so a deployment WITH real
   * credentials still came up in mock mode and every destination was still simulated.
   */
  platforms?: Record<string, PlatformConfigEntry>;
  mockMode?: boolean;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

/** The platforms this deployment can actually sign a creator in to, with their public client ids. */
export function configuredPlatformIds(body: OAuthConfigResponse | null | undefined): string[] {
  const platforms = body?.platforms;
  if (!platforms || typeof platforms !== 'object') return [];
  return Object.entries(platforms)
    .filter(([, entry]) => Boolean(entry?.configured))
    .map(([id]) => id);
}

/** Where the broker lives. Empty on web (same origin); a real origin on desktop and mobile. */
export function brokerBaseUrl(): string {
  const value = (import.meta.env as Record<string, string | undefined>).VITE_LIVETAP_BROKER_URL;
  return (value ?? '').replace(/\/+$/, '');
}

/**
 * Resolve mock mode for this deployment. Never throws: a failed probe means mock mode,
 * because the honest answer to "can I reach a real platform?" without evidence is "no".
 */
export async function probeMockMode(fetchImpl?: FetchLike): Promise<boolean> {
  if (envMockMode()) return true;
  const doFetch = fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!doFetch) return true;
  try {
    const res = await doFetch(`${brokerBaseUrl()}/api/oauth/config`);
    if (!res.ok) return true;
    const body = (await res.json()) as OAuthConfigResponse;
    if (body.mockMode === true) return true;
    return configuredPlatformIds(body).length === 0;
  } catch {
    return true;
  }
}
