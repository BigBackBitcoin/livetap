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

export interface OAuthConfigResponse {
  platforms?: string[];
  mockMode?: boolean;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

/**
 * Resolve mock mode for this deployment. Never throws: a failed probe means mock mode,
 * because the honest answer to "can I reach a real platform?" without evidence is "no".
 */
export async function probeMockMode(fetchImpl?: FetchLike): Promise<boolean> {
  if (envMockMode()) return true;
  const doFetch = fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!doFetch) return true;
  try {
    const res = await doFetch('/api/oauth/config');
    if (!res.ok) return true;
    const body = (await res.json()) as OAuthConfigResponse;
    if (body.mockMode === true) return true;
    return !Array.isArray(body.platforms) || body.platforms.length === 0;
  } catch {
    return true;
  }
}
