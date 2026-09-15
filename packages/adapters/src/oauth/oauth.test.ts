import { describe, expect, it } from 'vitest';
import { PLATFORM_IDS } from '@livetap/core';
import {
  PLATFORM_OAUTH,
  buildAuthorizeUrl,
  computeCodeChallenge,
  generateCodeVerifier,
  generatePkce,
  generateState,
  getOAuthConfig,
  parseCallback,
} from './index.js';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(computeCodeChallenge(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    const pair = await generatePkce({ verifier });
    expect(pair).toEqual({
      codeVerifier: verifier,
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      codeChallengeMethod: 'S256',
      encoding: 'base64url',
    });
  });

  it('produces base64url output with no padding or unsafe characters', async () => {
    const pair = await generatePkce();
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
  });

  it('supports TikTok\'s documented hex encoding of the same digest', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const hex = await computeCodeChallenge(verifier, 'hex');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // Same bytes, different encoding.
    const fromBase64 = Buffer.from('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'base64url');
    expect(hex).toBe(fromBase64.toString('hex'));
  });

  it('generates verifiers of legal length and rejects illegal ones', () => {
    expect(generateCodeVerifier(43)).toHaveLength(43);
    expect(generateCodeVerifier(128)).toHaveLength(128);
    expect(() => generateCodeVerifier(42)).toThrow(RangeError);
    expect(() => generateCodeVerifier(129)).toThrow(RangeError);
  });

  it('rejects a supplied verifier that breaks the length rule', async () => {
    await expect(generatePkce({ verifier: 'too-short' })).rejects.toBeInstanceOf(RangeError);
  });

  it('generates distinct, URL-safe state values', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe('buildAuthorizeUrl', () => {
  const base = {
    clientId: 'client-123',
    redirectUri: 'http://127.0.0.1:52111/callback',
    state: 'state-xyz',
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  };

  it('builds the YouTube URL with PKCE and offline access', () => {
    const url = new URL(buildAuthorizeUrl('youtube', base));
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.force-ssl');
    expect(url.searchParams.get('code_challenge')).toBe(base.codeChallenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-xyz');
  });

  it('never sends a code_challenge to Twitch, which documents no PKCE', () => {
    const url = new URL(buildAuthorizeUrl('twitch', base));
    expect(`${url.origin}${url.pathname}`).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('code_challenge')).toBeNull();
    expect(url.searchParams.get('code_challenge_method')).toBeNull();
    expect(url.searchParams.get('scope')?.split(' ')).toContain('channel:read:stream_key');
    expect(url.searchParams.get('scope')?.split(' ')).toContain('user:read:chat');
  });

  it('builds the Kick URL with mandatory PKCE and state', () => {
    const url = new URL(buildAuthorizeUrl('kick', base));
    expect(url.origin).toBe('https://id.kick.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-xyz');
    expect(url.searchParams.get('scope')?.split(' ')).toContain('streamkey:read');
    expect(() => buildAuthorizeUrl('kick', { ...base, state: '' })).toThrow(/state/);
  });

  it('uses client_key for TikTok and comma-separated scopes', () => {
    const url = new URL(buildAuthorizeUrl('tiktok', base));
    expect(url.searchParams.get('client_key')).toBe('client-123');
    expect(url.searchParams.get('client_id')).toBeNull();
    expect(url.searchParams.get('scope')).toBe('user.info.basic');
  });

  it('never requests X broadcast scopes, which map to no endpoint', () => {
    const url = new URL(buildAuthorizeUrl('x', base));
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).not.toContain('broadcast');
    expect(scope.split(' ')).toContain('offline.access');
  });

  it("uses LinkedIn's separate native-pkce endpoint, and refuses to build a URL without one", () => {
    const withPkce = new URL(buildAuthorizeUrl('linkedin', base));
    expect(withPkce.pathname).toBe('/oauth/native-pkce/authorization');

    /*
     * This used to assert that omitting the challenge quietly fell back to the non-PKCE endpoint.
     * That is the downgrade spelled out as a feature: a caller who forgot to generate a verifier
     * got a working authorize URL with no proof-of-possession on it, for every platform including
     * the two that mandate PKCE. The fallback is gone; asking for it is now a programming error.
     */
    expect(() => buildAuthorizeUrl('linkedin', { ...base, codeChallenge: undefined })).toThrow(
      /requires PKCE/i,
    );
  });

  it('supports Facebook Login for Business config_id instead of scopes', () => {
    const url = new URL(buildAuthorizeUrl('facebook', { ...base, configId: 'cfg-1' }));
    expect(url.searchParams.get('config_id')).toBe('cfg-1');
    expect(url.searchParams.get('scope')).toBeNull();
  });

  it('honours explicit scopes and extra params', () => {
    const url = new URL(
      buildAuthorizeUrl('facebook', {
        ...base,
        scopes: ['publish_video'],
        extraParams: { nonce: 'n-1' },
      }),
    );
    expect(url.searchParams.get('scope')).toBe('publish_video');
    expect(url.searchParams.get('nonce')).toBe('n-1');
  });

  it('refuses to invent an OAuth flow for custom destinations', () => {
    expect(() => buildAuthorizeUrl('custom', base)).toThrow(/no OAuth/);
    expect(() => getOAuthConfig('custom')).toThrow(/no OAuth/);
  });

  it.each(PLATFORM_IDS.filter((id) => id !== 'custom'))(
    '%s config is well formed',
    (id) => {
      const config = getOAuthConfig(id);
      expect(config.authorizeUrl).toMatch(/^https:\/\//);
      expect(config.tokenUrl).toMatch(/^https:\/\//);
      expect(config.clientIdParam.length).toBeGreaterThan(0);
      expect(config.notes.length).toBeGreaterThan(0);
      // Every authorize URL must parse and every platform must produce a usable URL.
      const url = new URL(buildAuthorizeUrl(id, base));
      expect(url.searchParams.get(config.clientIdParam)).toBe('client-123');
      expect(url.searchParams.get('redirect_uri')).toBe(base.redirectUri);
    },
  );

  it('has no OAuth entry for custom', () => {
    expect(PLATFORM_OAUTH.custom).toBeUndefined();
  });
});

describe('parseCallback', () => {
  it('reads code and state from a loopback redirect', () => {
    expect(parseCallback('http://127.0.0.1:52111/callback?code=abc&state=xyz')).toEqual({
      code: 'abc',
      state: 'xyz',
    });
  });

  it('reads an error and its description', () => {
    expect(
      parseCallback('https://livetap.app/cb?error=access_denied&error_description=User%20said%20no'),
    ).toEqual({ error: 'access_denied', errorDescription: 'User said no' });
  });

  it('falls back to the fragment when the query has nothing', () => {
    expect(parseCallback('http://localhost:3000/cb#code=frag&state=s1')).toEqual({
      code: 'frag',
      state: 's1',
    });
  });

  it('accepts a bare query string', () => {
    expect(parseCallback('?code=bare&state=s2')).toEqual({ code: 'bare', state: 's2' });
  });

  it('reports invalid_request instead of throwing on junk', () => {
    expect(parseCallback('not a url at all')).toEqual({ error: 'invalid_request' });
    expect(parseCallback('https://livetap.app/cb')).toEqual({ error: 'invalid_request' });
  });
});

/**
 * These are research facts, not preferences, and each one has a failure mode behind it. They are
 * asserted so that a future edit that "tidies" one of them fails here instead of in production.
 */
describe('what the platform research changed', () => {
  it('spells loopback the way each platform registered it', () => {
    // Google requires the literal IP for an installed app. Kick's console registers the name,
    // and a provider compares redirect_uri as a string, so the two are not interchangeable.
    expect(getOAuthConfig('youtube').loopbackHost).toBe('127.0.0.1');
    expect(getOAuthConfig('kick').loopbackHost).toBe('localhost');
  });

  it('gives Twitch a device endpoint, because Twitch documents no PKCE at all', () => {
    expect(getOAuthConfig('twitch').pkce).toBe('none');
    expect(getOAuthConfig('twitch').deviceAuthorizationUrl).toBe('https://id.twitch.tv/oauth2/device');
  });

  it('renews Facebook with fb_exchange_token, because it never issues a refresh token', () => {
    expect(getOAuthConfig('facebook').refreshGrant).toBe('fb_exchange_token');
    expect(getOAuthConfig('youtube').refreshGrant).toBe('refresh_token');
    expect(getOAuthConfig('twitch').refreshGrant).toBe('refresh_token');
  });

  it('pins one Graph version across authorize and the API', () => {
    const facebook = getOAuthConfig('facebook');
    expect(facebook.authorizeUrl).toContain('/v25.0/');
    expect(facebook.tokenUrl).toContain('/v25.0/');
    expect(facebook.revokeUrl).toContain('/v25.0/');
  });

  it('knows where each platform takes a token back, so Disconnect can mean disconnected', () => {
    expect(getOAuthConfig('youtube').revokeUrl).toBe('https://oauth2.googleapis.com/revoke');
    expect(getOAuthConfig('twitch').revokeUrl).toBe('https://id.twitch.tv/oauth2/revoke');
    expect(getOAuthConfig('kick').revokeUrl).toBe('https://id.kick.com/oauth/revoke');
  });

  it('records the YouTube Testing-status expiry, which is the classic multistreaming bug', () => {
    const notes = getOAuthConfig('youtube').notes.join(' ');
    expect(notes).toContain('7 days after consent');
  });

  it('records that Twitch ingest comes from the list, never from a constant', () => {
    expect(getOAuthConfig('twitch').notes.join(' ')).toContain('ingest.twitch.tv/ingests');
  });

  it('records that Kick lets the creator untick the stream key scope', () => {
    expect(getOAuthConfig('kick').notes.join(' ')).toContain('streamkey:read');
  });
});
