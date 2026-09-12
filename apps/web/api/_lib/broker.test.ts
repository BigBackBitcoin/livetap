// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BrokerError,
  RATE_LIMIT_MAX,
  assertSameOrigin,
  assertWithinRateLimit,
  configuredPlatforms,
  exchangeCode,
  isAllowedRedirectUri,
  rateLimitKey,
  requestHost,
  refreshToken,
  resetRateLimit,
  validateExchangeInput,
  validateRefreshInput,
} from './broker.js';

const env = {
  LIVETAP_YOUTUBE_CLIENT_ID: 'yt-id',
  LIVETAP_YOUTUBE_CLIENT_SECRET: 'yt-secret',
  LIVETAP_TWITCH_CLIENT_ID: 'tw-id',
  LIVETAP_TWITCH_CLIENT_SECRET: 'tw-secret',
};

function fakeFetch(status: number, body: unknown, capture: { url?: string; body?: string; headers?: Headers } = {}) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    capture.url = String(url);
    capture.body = String(init?.body ?? '');
    capture.headers = new Headers(init?.headers);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

describe('configuredPlatforms', () => {
  it('exposes only configured platforms and never secrets', () => {
    const c = configuredPlatforms(env);
    expect(c.youtube).toEqual({ configured: true, clientId: 'yt-id' });
    expect(c.kick).toEqual({ configured: false });
    expect(JSON.stringify(c)).not.toContain('secret');
  });
});

describe('validation', () => {
  it('accepts a valid exchange body', () => {
    const v = validateExchangeInput({ platform: 'youtube', code: '4/abcd', redirectUri: 'https://livetap.app/oauth/callback', codeVerifier: 'a'.repeat(43) });
    expect(v.platform).toBe('youtube');
  });
  it('rejects unknown platform, bad redirect, bad verifier', () => {
    expect(() => validateExchangeInput({ platform: 'evil', code: 'abcd', redirectUri: 'https://x/cb' })).toThrow(BrokerError);
    expect(() => validateExchangeInput({ platform: 'youtube', code: 'abcd', redirectUri: 'javascript:alert(1)' })).toThrow(BrokerError);
    expect(() => validateExchangeInput({ platform: 'youtube', code: 'abcd', redirectUri: 'https://x/cb', codeVerifier: 'short' })).toThrow(BrokerError);
    expect(() => validateExchangeInput(null)).toThrow(BrokerError);
    expect(() => validateRefreshInput({ platform: 'twitch', refreshToken: 'x' })).toThrow(BrokerError);
  });
  it('allows loopback and custom-scheme redirects for desktop/mobile', () => {
    expect(validateExchangeInput({ platform: 'twitch', code: 'abcd', redirectUri: 'http://127.0.0.1:53211/callback' }).redirectUri).toContain('127.0.0.1');
    expect(validateExchangeInput({ platform: 'twitch', code: 'abcd', redirectUri: 'livetap://oauth/callback' }).redirectUri).toContain('livetap://');
  });
});

describe('exchangeCode', () => {
  it('posts form-encoded credentials with the secret and returns a normalized token set', async () => {
    const cap: { url?: string; body?: string; headers?: Headers } = {};
    const tokens = await exchangeCode(
      { platform: 'youtube', code: '4/abcd', redirectUri: 'https://livetap.app/cb', codeVerifier: 'v'.repeat(43) },
      env,
      fakeFetch(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3599, scope: 'a b', token_type: 'Bearer' }, cap),
    );
    expect(cap.url).toBe('https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(cap.body);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('client_secret')).toBe('yt-secret');
    expect(params.get('code_verifier')).toBe('v'.repeat(43));
    expect(cap.headers?.get('content-type')).toContain('application/x-www-form-urlencoded');
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresIn: 3599, scope: ['a', 'b'], tokenType: 'Bearer' });
  });

  it('returns 501 NOT_CONFIGURED for platforms without secrets', async () => {
    await expect(exchangeCode({ platform: 'kick', code: 'abcd', redirectUri: 'https://x/cb' }, env, fakeFetch(200, {}))).rejects.toMatchObject({ status: 501, code: 'NOT_CONFIGURED' });
  });

  it('maps upstream failures without leaking codes or tokens', async () => {
    const err = await exchangeCode({ platform: 'twitch', code: 'SECRETCODE', redirectUri: 'https://x/cb' }, env, fakeFetch(400, { error: 'invalid_grant', error_description: 'Invalid authorization code' })).catch((e) => e);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err.status).toBe(400);
    expect(err.message).toContain('Invalid authorization code');
    expect(err.message).not.toContain('SECRETCODE');
    const err2 = await exchangeCode({ platform: 'twitch', code: 'abcd', redirectUri: 'https://x/cb' }, env, fakeFetch(503, {})).catch((e) => e);
    expect(err2.status).toBe(502);
    const err3 = await exchangeCode({ platform: 'twitch', code: 'abcd', redirectUri: 'https://x/cb' }, env, fakeFetch(429, {})).catch((e) => e);
    expect(err3.code).toBe('RATE_LIMITED');
  });
});

describe('refreshToken', () => {
  it('posts a refresh grant', async () => {
    const cap: { body?: string } = {};
    const t = await refreshToken({ platform: 'twitch', refreshToken: 'RT12345678' }, env, fakeFetch(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 14400, scope: ['chat:read'] }, cap));
    expect(new URLSearchParams(cap.body).get('grant_type')).toBe('refresh_token');
    expect(t.refreshToken).toBe('RT2');
    expect(t.scope).toEqual(['chat:read']);
  });
});

describe('assertSameOrigin', () => {
  it('accepts same-origin and no-origin requests, rejects cross-origin', () => {
    expect(() => assertSameOrigin(new Request('https://livetap.app/api/oauth/token', { headers: { host: 'livetap.app', origin: 'https://livetap.app' } }))).not.toThrow();
    expect(() => assertSameOrigin(new Request('https://livetap.app/api/oauth/token', { headers: { host: 'livetap.app' } }))).not.toThrow();
    expect(() => assertSameOrigin(new Request('https://livetap.app/api/oauth/token', { headers: { host: 'livetap.app', origin: 'https://evil.example' } }))).toThrow(BrokerError);
  });
});

// ---------------------------------------------------------------------------
// SECURITY REVIEW 2026-09 — SEC-W1/W2/W3 regressions.
// ---------------------------------------------------------------------------

describe('SEC-W1 Sec-Fetch-Site', () => {
  const url = 'https://livetap.app/api/oauth/token';
  it('refuses a browser request that declares itself cross-site even without an Origin header', () => {
    expect(() =>
      assertSameOrigin(new Request(url, { headers: { host: 'livetap.app', 'sec-fetch-site': 'cross-site' } })),
    ).toThrow(BrokerError);
    expect(() =>
      assertSameOrigin(new Request(url, { headers: { host: 'livetap.app', 'sec-fetch-site': 'same-site' } })),
    ).toThrow(BrokerError);
  });
  it('still accepts same-origin browser requests and header-less non-browser clients', () => {
    expect(() =>
      assertSameOrigin(
        new Request(url, { headers: { host: 'livetap.app', origin: 'https://livetap.app', 'sec-fetch-site': 'same-origin' } }),
      ),
    ).not.toThrow();
    // A user typing the URL / a direct navigation reports "none".
    expect(() =>
      assertSameOrigin(new Request(url, { headers: { host: 'livetap.app', 'sec-fetch-site': 'none' } })),
    ).not.toThrow();
    // curl and the desktop app send neither header.
    expect(() => assertSameOrigin(new Request(url, { headers: { host: 'livetap.app' } }))).not.toThrow();
  });
});

describe('SEC-W2 redirectUri allow-list', () => {
  it('refuses an https redirectUri that is not this deployment', () => {
    expect(isAllowedRedirectUri('https://evil.example/oauth/callback', 'livetap.app')).toBe(false);
    expect(() =>
      validateExchangeInput(
        { platform: 'youtube', code: '4/abcd', redirectUri: 'https://evil.example/oauth/callback' },
        'livetap.app',
      ),
    ).toThrow(BrokerError);
  });
  it('accepts this deployment, loopback and the private-use scheme', () => {
    expect(isAllowedRedirectUri('https://livetap.app/oauth/callback', 'livetap.app')).toBe(true);
    expect(isAllowedRedirectUri('https://LIVETAP.APP/oauth/callback', 'livetap.app')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:53211/callback', 'livetap.app')).toBe(true);
    expect(isAllowedRedirectUri('livetap://oauth/callback', 'livetap.app')).toBe(true);
  });
  it('refuses non-loopback http and every other scheme', () => {
    expect(isAllowedRedirectUri('http://evil.example/cb', 'livetap.app')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)', 'livetap.app')).toBe(false);
    expect(isAllowedRedirectUri('data:text/html,x', 'livetap.app')).toBe(false);
    expect(isAllowedRedirectUri('file:///etc/passwd', 'livetap.app')).toBe(false);
  });
  it('is not fooled by a userinfo or port prefix that looks like our host', () => {
    expect(isAllowedRedirectUri('https://livetap.app@evil.example/cb', 'livetap.app')).toBe(false);
    expect(isAllowedRedirectUri('https://livetap.app.evil.example/cb', 'livetap.app')).toBe(false);
    expect(isAllowedRedirectUri('https://livetap.app:8443/cb', 'livetap.app')).toBe(false);
  });
});

describe('SEC-W3 in-memory rate limiter', () => {
  beforeEach(() => resetRateLimit());

  const reqFrom = (ip: string): Request =>
    new Request('https://livetap.app/api/oauth/token', {
      headers: { host: 'livetap.app', 'x-forwarded-for': `${ip}, 10.0.0.1` },
    });

  it('allows the budget then refuses with RATE_LIMITED', () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(() => assertWithinRateLimit(reqFrom('203.0.113.9'), now, RATE_LIMIT_MAX, 60_000)).not.toThrow();
    }
    const err = (() => {
      try {
        assertWithinRateLimit(reqFrom('203.0.113.9'), now, RATE_LIMIT_MAX, 60_000);
      } catch (e) {
        return e as BrokerError;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(BrokerError);
    expect(err?.status).toBe(429);
    expect(err?.code).toBe('RATE_LIMITED');
  });

  it('buckets per client and rolls over when the window expires', () => {
    const now = 2_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      try {
        assertWithinRateLimit(reqFrom('198.51.100.1'), now, RATE_LIMIT_MAX, 60_000);
      } catch {
        /* expected on the last one */
      }
    }
    // A different client is unaffected.
    expect(() => assertWithinRateLimit(reqFrom('198.51.100.2'), now, RATE_LIMIT_MAX, 60_000)).not.toThrow();
    // And the first client recovers once the window passes.
    expect(() => assertWithinRateLimit(reqFrom('198.51.100.1'), now + 60_001, RATE_LIMIT_MAX, 60_000)).not.toThrow();
  });

  it('uses only the first x-forwarded-for hop, so a spoofed tail cannot split the bucket', () => {
    expect(rateLimitKey(reqFrom('203.0.113.5'))).toBe('203.0.113.5');
    expect(
      rateLimitKey(new Request('https://livetap.app/api/oauth/token', { headers: { host: 'livetap.app' } })),
    ).toBe('unknown');
  });
});

describe('SEC-W2 requestHost', () => {
  it('prefers the first x-forwarded-host hop, so a custom domain still matches', () => {
    expect(
      requestHost(
        new Request('https://x/api/oauth/token', {
          headers: { host: 'livetap.vercel.app', 'x-forwarded-host': 'livetap.app, proxy.internal' },
        }),
      ),
    ).toBe('livetap.app');
  });
  it('falls back to host, and to undefined when neither is present', () => {
    expect(requestHost(new Request('https://x/api/oauth/token', { headers: { host: 'livetap.app' } }))).toBe(
      'livetap.app',
    );
    // Neither header present: undefined, which makes isAllowedRedirectUri fall
    // back to the shape check rather than compare against a host we invented.
    expect(requestHost(new Request('https://x/a', { headers: { 'x-forwarded-host': '' } }))).toBeUndefined();
    expect(requestHost(new Request('https://x/a'))).toBeUndefined();
  });
});
