// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BrokerError,
  FACEBOOK_GRAPH_VERSION,
  LIVETAP_REDIRECT_URI,
  RATE_LIMIT_MAX,
  oauthBaseOverride,
  pollDeviceCode,
  revoke,
  startDeviceCode,
  validateRevokeInput,
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
  it('refuses a cross-site request that carries an Origin, which every page does', () => {
    expect(() =>
      assertSameOrigin(
        new Request(url, {
          headers: { host: 'livetap.app', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).toThrow(BrokerError);
    expect(() =>
      assertSameOrigin(
        new Request(url, {
          headers: { host: 'livetap.app', origin: 'https://other.livetap.app', 'sec-fetch-site': 'same-site' },
        }),
      ),
    ).toThrow(BrokerError);
  });

  /**
   * The two browser-driven ways to arrive cross-site with no Origin: a top-level navigation, and a
   * subresource load such as an <img> or a <script>. Both are still refused.
   */
  it('refuses a cross-site navigation or subresource load, which send no Origin', () => {
    for (const mode of ['navigate', 'no-cors']) {
      expect(() =>
        assertSameOrigin(
          new Request(url, {
            headers: { host: 'livetap.app', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': mode },
          }),
        ),
        mode,
      ).toThrow(BrokerError);
    }
  });

  /**
   * And the case that made this whole check wrong for the product it serves.
   *
   * The desktop renderer is a `file://` document and the phone's is `capacitor://`, so Chromium
   * marks every broker call cross-site and sends no Origin — there is no way for either to do
   * otherwise. Refusing on the header alone gave a blanket 403 to the entire desktop app: a
   * creator could sign in at the platform, approve the scopes, watch the callback land on the
   * loopback listener, and then have the code exchange fail, with the flow working right up to the
   * last step for a reason nothing in the UI could name. Found by driving the built app against a
   * real OAuth server; not visible from reading the code.
   *
   * No page can produce this shape: a cross-origin `fetch` from a document always carries an
   * Origin. And nothing here is cookie-authenticated — every call brings its own code or token —
   * so a request from a non-browser client was never a CSRF risk to begin with.
   */
  it('accepts a CORS-mode request with no Origin, which is what a native shell sends', () => {
    expect(() =>
      assertSameOrigin(
        new Request(url, {
          headers: { host: 'livetap.app', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' },
        }),
      ),
    ).not.toThrow();
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

describe('the private-use redirect is one exact string', () => {
  /*
   * On a desktop, any installed program can claim a URI scheme. Accepting `livetap://` with any
   * authority and any path meant the broker would exchange a code for a callback aimed anywhere,
   * which is the difference between the OS handing the reply to LIVETAP and handing it to
   * whatever registered the scheme most recently.
   */
  it('accepts the registered callback and refuses every other livetap:// spelling', () => {
    expect(isAllowedRedirectUri(LIVETAP_REDIRECT_URI)).toBe(true);
    expect(isAllowedRedirectUri('livetap://oauth/callback?next=x')).toBe(false);
    expect(isAllowedRedirectUri('livetap://attacker.example/callback')).toBe(false);
    expect(isAllowedRedirectUri('livetap://oauth/callback/..')).toBe(false);
  });
});

describe('Facebook renewal', () => {
  /*
   * Facebook issues no refresh_token, ever. A broker that sends grant_type=refresh_token here
   * gets a refusal, never renews, and the creator is silently signed out at about 60 days with
   * nothing in the UI explaining why.
   */
  it('sends fb_exchange_token with the access token, not a refresh_token grant', async () => {
    const cap: { url?: string; body?: string } = {};
    const fbEnv = { LIVETAP_FACEBOOK_APP_ID: 'fb-id', LIVETAP_FACEBOOK_APP_SECRET: 'fb-secret' };
    await refreshToken(
      { platform: 'facebook', refreshToken: 'LONG_LIVED_ACCESS_TOKEN' },
      fbEnv,
      fakeFetch(200, { access_token: 'AT2', expires_in: 5184000 }, cap),
    );
    const params = new URLSearchParams(cap.body);
    expect(params.get('grant_type')).toBe('fb_exchange_token');
    expect(params.get('fb_exchange_token')).toBe('LONG_LIVED_ACCESS_TOKEN');
    expect(params.get('refresh_token')).toBeNull();
    expect(cap.url).toContain(`/${FACEBOOK_GRAPH_VERSION}/`);
  });

  it('still sends the standard grant for the platforms that issue refresh tokens', async () => {
    const cap: { url?: string; body?: string } = {};
    await refreshToken({ platform: 'youtube', refreshToken: 'RT' }, env, fakeFetch(200, { access_token: 'AT' }, cap));
    expect(new URLSearchParams(cap.body).get('grant_type')).toBe('refresh_token');
  });
});

describe('revoke', () => {
  it('posts the token to the platform revocation endpoint', async () => {
    const cap: { url?: string; body?: string } = {};
    const result = await revoke({ platform: 'youtube', token: 'RT_TO_KILL' }, env, fakeFetch(200, {}, cap));
    expect(result).toEqual({ revoked: true });
    expect(cap.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(new URLSearchParams(cap.body).get('token')).toBe('RT_TO_KILL');
  });

  it('uses DELETE /me/permissions for Facebook, which publishes no RFC 7009 endpoint', async () => {
    const cap: { url?: string } = {};
    const fbEnv = { LIVETAP_FACEBOOK_APP_ID: 'fb-id', LIVETAP_FACEBOOK_APP_SECRET: 'fb-secret' };
    await revoke({ platform: 'facebook', token: 'AT' }, fbEnv, fakeFetch(200, { success: true }, cap));
    expect(cap.url).toContain('/me/permissions?access_token=AT');
  });

  /*
   * A creator who tapped Disconnect has already decided. An unreachable platform must not leave
   * them staring at an error beside a credential they still cannot get rid of, so this reports
   * honestly that the platform was not told and lets the caller delete the local copy anyway.
   */
  it('never rejects when the platform cannot be reached', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(revoke({ platform: 'youtube', token: 'RT' }, env, failing)).resolves.toEqual({ revoked: false });
  });

  it('validates its input like every other handler', () => {
    expect(() => validateRevokeInput({ platform: 'evil', token: 'aaaaaaaa' })).toThrow(BrokerError);
    expect(() => validateRevokeInput({ platform: 'youtube', token: 'short' })).toThrow(BrokerError);
    expect(validateRevokeInput({ platform: 'youtube', token: 'aaaaaaaaaa' }).platform).toBe('youtube');
  });
});

describe('device code grant', () => {
  it('starts a device flow with client_id and scopes, and never the client secret', async () => {
    const cap: { url?: string; body?: string } = {};
    const started = await startDeviceCode(
      'twitch',
      ['channel:read:stream_key'],
      env,
      fakeFetch(
        200,
        { device_code: 'DC', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate', expires_in: 1800, interval: 5 },
        cap,
      ),
    );
    expect(cap.url).toBe('https://id.twitch.tv/oauth2/device');
    const params = new URLSearchParams(cap.body);
    expect(params.get('client_id')).toBe('tw-id');
    expect(params.get('client_secret')).toBeNull();
    expect(started.userCode).toBe('ABCD-EFGH');
    expect(started.interval).toBe(5);
  });

  it('refuses a platform that documents no device endpoint', async () => {
    await expect(startDeviceCode('youtube', ['x'], env, fakeFetch(200, {}))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  // Most polls in a healthy flow land here, while the creator is still typing the code on their
  // phone. Turning the normal case into an error would make the client's job guesswork.
  it('reports a not-yet poll as pending rather than as a failure', async () => {
    await expect(
      pollDeviceCode('twitch', 'DC', ['channel:read:stream_key'], env, fakeFetch(400, { message: 'authorization_pending' })),
    ).resolves.toBeUndefined();
  });

  it('returns the token set once the creator has finished', async () => {
    const tokens = await pollDeviceCode(
      'twitch',
      'DC',
      ['channel:read:stream_key'],
      env,
      fakeFetch(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 14000, scope: ['channel:read:stream_key'] }),
    );
    expect(tokens).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' });
  });
});

describe('the fake-IdP override', () => {
  /*
   * The most dangerous line in the broker: a production deployment that honoured this would post
   * the owner's real client secret to whatever host the variable named.
   */
  it('is accepted only for a loopback http origin outside production', () => {
    expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'http://127.0.0.1:8789' })).toBe('http://127.0.0.1:8789');
    expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'http://localhost:8789/' })).toBe('http://localhost:8789');
    expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'http://127.0.0.1:8789', NODE_ENV: 'production' })).toBeUndefined();
    expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'https://127.0.0.1:8789' })).toBeUndefined();
    expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'http://evil.example.com' })).toBeUndefined();
    expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'not a url' })).toBeUndefined();
    expect(oauthBaseOverride({})).toBeUndefined();
  });

  it('redirects the token endpoint at the harness when it is set', async () => {
    const cap: { url?: string } = {};
    await exchangeCode(
      { platform: 'youtube', code: '4/abcd', redirectUri: 'http://127.0.0.1:53219/callback' },
      { ...env, LIVETAP_OAUTH_BASE: 'http://127.0.0.1:8789' },
      fakeFetch(200, { access_token: 'AT' }, cap),
    );
    expect(cap.url).toBe('http://127.0.0.1:8789/token');
  });
});
