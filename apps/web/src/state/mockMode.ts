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

/**
 * Where the token broker lives.
 *
 * Empty on web, where it is the same origin. On desktop and mobile there IS no origin — the
 * renderer is a `file://` or `capacitor://` document — so an empty value means every broker call
 * resolves against `file://` and fails, and the app can only ever tell the creator that sign-in is
 * not set up. That is what was happening: `VITE_LIVETAP_BROKER_URL` was read here and set by no
 * build in this repository, and the shipped bundle folded this function to `return ""`.
 *
 * So the native shells get a default rather than nothing. `DEFAULT_NATIVE_BROKER` is the public
 * deployment, which is where the broker actually runs; it holds the client secrets that must never
 * be in a binary, which is the whole reason a broker exists. A build can still override it, and a
 * self-hoster must.
 */
export const DEFAULT_NATIVE_BROKER = 'https://livetap.vercel.app';

function isNativeShell(): boolean {
  const w = (globalThis as unknown as { window?: Record<string, unknown> }).window;
  if (!w) return false;
  if ('livetapHost' in w || 'Capacitor' in w) return true;
  const protocol = (w.location as { protocol?: string } | undefined)?.protocol;
  return protocol === 'file:' || protocol === 'capacitor:';
}

export function brokerBaseUrl(): string {
  const value = (import.meta.env as Record<string, string | undefined>).VITE_LIVETAP_BROKER_URL;
  const configured = (value ?? '').replace(/\/+$/, '');
  if (configured !== '') return configured;
  return isNativeShell() ? DEFAULT_NATIVE_BROKER : '';
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
