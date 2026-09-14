import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPending, resolveCallback } from '../screens/OAuthCallback.js';
import type { PendingAuth } from '../screens/OAuthCallback.js';
import { beginAuth, completeAuth, missingScopes, PKCE_SESSION_KEY } from '../state/oauthFlow.js';
import type { DesktopOAuthBridge } from '../state/oauthFlow.js';
import {
  forgetTokens,
  readTokens,
  refreshTokens,
  revokeTokens,
  saveTokens,
  tokenProviderFor,
  REFRESH_MARGIN_MS,
} from '../state/tokens.js';

const pending: PendingAuth = {
  platform: 'youtube',
  state: 'the-state-we-generated',
  codeVerifier: 'verifier-abc',
  redirectUri: 'https://livetap.example/oauth/callback',
};

/**
 * The `state` check is the whole security of this page: without it, anyone who can make the
 * user's browser open this URL can trade their own authorization code for a token bound to the
 * user's session. A mismatched state is refused outright, never "tried anyway".
 */
describe('OAuth callback', () => {
  it('accepts a callback whose state matches the request this device started', () => {
    const result = resolveCallback(
      'https://livetap.example/oauth/callback?code=abc123&state=the-state-we-generated',
      pending,
    );
    expect(result).toEqual({
      kind: 'ok',
      platform: 'youtube',
      code: 'abc123',
      codeVerifier: 'verifier-abc',
      redirectUri: 'https://livetap.example/oauth/callback',
    });
  });

  it('rejects a callback whose state does not match', () => {
    const result = resolveCallback(
      'https://livetap.example/oauth/callback?code=abc123&state=an-attackers-state',
      pending,
    );
    expect(result).toEqual({ kind: 'mismatch' });
  });

  it('rejects a callback with no state at all', () => {
    const result = resolveCallback('https://livetap.example/oauth/callback?code=abc123', pending);
    expect(result).toEqual({ kind: 'mismatch' });
  });

  it('rejects a code that arrives when this device started nothing', () => {
    const result = resolveCallback(
      'https://livetap.example/oauth/callback?code=abc123&state=whatever',
      null,
    );
    expect(result).toEqual({ kind: 'missing' });
  });

  it('reports a platform refusal in the platform’s own words', () => {
    const result = resolveCallback(
      'https://livetap.example/oauth/callback?error=access_denied&error_description=The+user+said+no',
      pending,
    );
    expect(result).toEqual({ kind: 'denied', reason: 'The user said no' });
  });

  it('treats a malformed callback as an error rather than throwing', () => {
    expect(() => resolveCallback('not a url at all', pending)).not.toThrow();
    expect(resolveCallback('not a url at all', pending).kind).toBe('denied');
  });

  it('reads nothing from a storage that holds nothing, or holds nonsense', () => {
    expect(readPending(null)).toBeNull();
    const storage = {
      getItem: (): string | null => 'not json',
      removeItem: (): void => undefined,
    };
    expect(readPending(storage)).toBeNull();
  });

  it('reads a pending request back out of session storage', () => {
    const storage = {
      getItem: (): string | null => JSON.stringify(pending),
      removeItem: (): void => undefined,
    };
    expect(readPending(storage)?.state).toBe('the-state-we-generated');
  });
});

/* -------------------------------------------------------------------------
 * The flow itself. Before this existed, `buildAuthorizeUrl` had no non-test
 * caller, `PKCE_SESSION_KEY` was written by nothing at all, and the desktop
 * preload exposed an OAuth bridge no renderer code ever touched.
 * ---------------------------------------------------------------------- */

/** A sessionStorage that records everything written to it, so leaks are provable. */
function recordingStorage(): {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  written: Map<string, string>;
} {
  const written = new Map<string, string>();
  return {
    written,
    storage: {
      getItem: (k) => written.get(k) ?? null,
      setItem: (k, v) => {
        written.set(k, v);
      },
      removeItem: (k) => {
        written.delete(k);
      },
    },
  };
}

/** Answers the broker endpoints the flow calls, and records what it was asked. */
function brokerFetch(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/api/oauth/config')) {
      return new Response(
        JSON.stringify({
          platforms: { youtube: { configured: true, clientId: 'yt-client' }, kick: { configured: false } },
          mockMode: false,
        }),
        { status: 200 },
      );
    }
    if (url.endsWith('/api/oauth/token')) {
      return new Response(
        JSON.stringify({
          accessToken: 'AT-1',
          refreshToken: 'RT-1',
          expiresIn: 3600,
          scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
          ...overrides,
        }),
        { status: 200 },
      );
    }
    if (url.endsWith('/api/oauth/refresh')) {
      return new Response(
        JSON.stringify({ accessToken: 'AT-2', refreshToken: 'RT-2', expiresIn: 3600 }),
        { status: 200 },
      );
    }
    if (url.endsWith('/api/oauth/revoke')) {
      return new Response(JSON.stringify({ revoked: true }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** The desktop preload's OAuth bridge, with a loopback that answers immediately. */
function fakeDesktop(overrides: Partial<DesktopOAuthBridge> = {}): DesktopOAuthBridge & { opened: string[] } {
  const opened: string[] = [];
  let redirectUri = '';
  const state = 'state-from-the-main-process';
  return {
    opened,
    async startLoopback(options) {
      redirectUri = `http://${options?.host ?? '127.0.0.1'}:53219/callback`;
      return { redirectUri, port: 53219, state };
    },
    async openExternal(url) {
      opened.push(url);
      return { ok: true };
    },
    async waitForCallback() {
      return `${redirectUri}?code=the-code&state=${state}`;
    },
    ...overrides,
  };
}

beforeEach(async () => {
  await forgetTokens('youtube');
});

afterEach(async () => {
  await forgetTokens('youtube');
});

describe('beginAuth on desktop', () => {
  it('signs in end to end without the page ever navigating', async () => {
    const desktop = fakeDesktop();
    const { fetchImpl } = brokerFetch();
    const outcome = await beginAuth('youtube', { desktop, fetchImpl, storage: null });

    expect(outcome.kind).toBe('connected');
    if (outcome.kind === 'connected') {
      expect(outcome.account.scopes).toContain('https://www.googleapis.com/auth/youtube.force-ssl');
    }
    const stored = await readTokens('youtube');
    expect(stored?.accessToken).toBe('AT-1');
    expect(stored?.refreshToken).toBe('RT-1');
  });

  /*
   * The two-state collision this seam was widened to avoid: the loopback listener refuses any
   * callback whose state does not match the one IT generated, so a renderer that made its own
   * would build an authorize URL the listener is guaranteed to reject.
   */
  it('uses the state the main process generated, never one of its own', async () => {
    const desktop = fakeDesktop();
    const { fetchImpl } = brokerFetch();
    await beginAuth('youtube', { desktop, fetchImpl, storage: null });
    const authorizeUrl = new URL(desktop.opened[0] ?? '');
    expect(authorizeUrl.searchParams.get('state')).toBe('state-from-the-main-process');
  });

  it('sends a real PKCE challenge and asks for the loopback spelling the platform registered', async () => {
    const desktop = fakeDesktop();
    const { fetchImpl } = brokerFetch();
    await beginAuth('youtube', { desktop, fetchImpl, storage: null });
    const authorizeUrl = new URL(desktop.opened[0] ?? '');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Google requires the literal IP for an installed app.
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53219/callback');
  });

  it('reports a closed browser window as a failure that saved nothing', async () => {
    const desktop = fakeDesktop({
      waitForCallback: async () => {
        throw new Error('Sign-in timed out.');
      },
    });
    const { fetchImpl } = brokerFetch();
    const outcome = await beginAuth('youtube', { desktop, fetchImpl, storage: null });
    expect(outcome.kind).toBe('failed');
    expect(await readTokens('youtube')).toBeUndefined();
  });

  it('says so plainly when this build has no credentials for the platform', async () => {
    const { fetchImpl } = brokerFetch();
    const outcome = await beginAuth('kick', { desktop: fakeDesktop(), fetchImpl, storage: null });
    expect(outcome.kind).toBe('unavailable');
  });
});

describe('beginAuth on web', () => {
  it('parks the verifier for the round trip and leaves for the platform', async () => {
    const { storage, written } = recordingStorage();
    const { fetchImpl } = brokerFetch();
    let navigatedTo = '';
    const outcome = await beginAuth('youtube', {
      fetchImpl,
      storage,
      desktop: undefined,
      origin: 'https://livetap.app',
      navigate: (url) => {
        navigatedTo = url;
      },
    });

    expect(outcome.kind).toBe('redirected');
    expect(navigatedTo).toContain('accounts.google.com');
    const pending = JSON.parse(written.get(PKCE_SESSION_KEY) ?? '{}') as PendingAuth;
    expect(pending.platform).toBe('youtube');
    expect(pending.redirectUri).toBe('https://livetap.app/oauth/callback');
    expect(new URL(navigatedTo).searchParams.get('state')).toBe(pending.state);
  });
});

describe('completeAuth', () => {
  it('stores the token set and reports the account, and stores nothing else anywhere', async () => {
    const { storage, written } = recordingStorage();
    const { fetchImpl } = brokerFetch();
    const pendingWeb: PendingAuth = {
      platform: 'youtube',
      state: 's-1',
      codeVerifier: 'v'.repeat(64),
      redirectUri: 'https://livetap.app/oauth/callback',
    };
    storage.setItem(PKCE_SESSION_KEY, JSON.stringify(pendingWeb));

    const outcome = await completeAuth('https://livetap.app/oauth/callback?code=abc&state=s-1', {
      fetchImpl,
      storage,
    });
    expect(outcome.kind).toBe('connected');
    expect((await readTokens('youtube'))?.accessToken).toBe('AT-1');

    // The pending record is cleared, and no token was ever written to page storage.
    expect(written.has(PKCE_SESSION_KEY)).toBe(false);
    const everythingWritten = JSON.stringify([...written.values()]);
    expect(everythingWritten).not.toContain('AT-1');
    expect(everythingWritten).not.toContain('RT-1');
    expect(JSON.stringify(localStorage)).not.toContain('AT-1');
  });

  it('refuses a callback whose state does not match and stores nothing', async () => {
    const { storage } = recordingStorage();
    const { fetchImpl, calls } = brokerFetch();
    storage.setItem(
      PKCE_SESSION_KEY,
      JSON.stringify({ platform: 'youtube', state: 's-1', redirectUri: 'https://livetap.app/oauth/callback' }),
    );
    const outcome = await completeAuth('https://livetap.app/oauth/callback?code=abc&state=attacker', {
      fetchImpl,
      storage,
    });
    expect(outcome.kind).toBe('failed');
    expect(calls.some((c) => c.url.endsWith('/api/oauth/token'))).toBe(false);
    expect(await readTokens('youtube')).toBeUndefined();
  });
});

describe('scope introspection', () => {
  /*
   * Kick's consent screen has a tick box per permission, so "authorized" and "granted what we
   * asked for" are different facts. Saying so right after the connect is the difference between
   * a five second fix and a failure at GO LIVE.
   */
  it('names the permission a Kick creator withheld', () => {
    expect(missingScopes('kick', ['user:read', 'channel:read', 'channel:write'])).toContain('streamkey:read');
    expect(missingScopes('youtube', ['https://www.googleapis.com/auth/youtube.force-ssl'])).toEqual([]);
  });

  it('says nothing when the platform reported no scopes at all', () => {
    expect(missingScopes('kick', undefined)).toEqual([]);
  });
});

describe('token renewal', () => {
  it('renews inside the margin and hands back the new token', async () => {
    const { fetchImpl } = brokerFetch();
    const now = (): number => 1_000_000;
    await saveTokens('youtube', {
      accessToken: 'AT-1',
      refreshToken: 'RT-1',
      expiresAt: now() + REFRESH_MARGIN_MS - 1,
      scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    });
    const provider = tokenProviderFor('youtube', { fetchImpl, now });
    expect(await provider()).toBe('AT-2');
  });

  it('does not renew a token that is still comfortably alive', async () => {
    const { fetchImpl, calls } = brokerFetch();
    const now = (): number => 1_000_000;
    await saveTokens('youtube', {
      accessToken: 'AT-1',
      expiresAt: now() + 10 * 60_000,
      scopes: [],
    });
    expect(await tokenProviderFor('youtube', { fetchImpl, now })()).toBe('AT-1');
    expect(calls).toHaveLength(0);
  });

  /*
   * Twitch device-code and Kick refresh tokens are single use. Keeping the old one after a
   * successful refresh works exactly once, and then signs the creator out for no visible reason.
   */
  it('persists the rotated refresh token, because the old one is already dead', async () => {
    const { fetchImpl } = brokerFetch();
    const now = (): number => 1_000_000;
    const current = {
      accessToken: 'AT-1',
      refreshToken: 'RT-1',
      expiresAt: now(),
      scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    };
    await saveTokens('youtube', current);
    await refreshTokens('youtube', current, { fetchImpl, now });
    const stored = await readTokens('youtube');
    expect(stored?.refreshToken).toBe('RT-2');
    expect(stored?.expiresAt).toBe(now() + 3600 * 1000);
  });

  /*
   * A YouTube app in Google's Testing status has its authorization expire seven days after
   * consent, taking the refresh token with it, every week. `status: 401` is what makes core's
   * classifier humanize that as "needs you to sign in again" rather than as an error code.
   */
  it('fails as an expired sign-in, not as an error code, when there is nothing to renew with', async () => {
    const { fetchImpl } = brokerFetch();
    await expect(tokenProviderFor('youtube', { fetchImpl })()).rejects.toMatchObject({ status: 401 });
  });
});

describe('disconnect', () => {
  it('tells the platform and then deletes the local copy', async () => {
    const { fetchImpl, calls } = brokerFetch();
    await saveTokens('youtube', { accessToken: 'AT-1', refreshToken: 'RT-1', scopes: [] });
    expect(await revokeTokens('youtube', { fetchImpl })).toBe(true);
    const revokeCall = calls.find((c) => c.url.endsWith('/api/oauth/revoke'));
    // The refresh token, not the access token: revoking only the access token leaves a refresh
    // token able to mint another one, and Disconnect would not mean disconnected.
    expect(revokeCall?.body).toMatchObject({ platform: 'youtube', token: 'RT-1' });
    expect(await readTokens('youtube')).toBeUndefined();
  });

  it('still deletes the local copy when the platform cannot be reached', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await saveTokens('youtube', { accessToken: 'AT-1', refreshToken: 'RT-1', scopes: [] });
    expect(await revokeTokens('youtube', { fetchImpl: failing })).toBe(false);
    expect(await readTokens('youtube')).toBeUndefined();
  });
});
