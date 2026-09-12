// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BrokerError,
  assertSameOrigin,
  configuredPlatforms,
  exchangeCode,
  refreshToken,
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
