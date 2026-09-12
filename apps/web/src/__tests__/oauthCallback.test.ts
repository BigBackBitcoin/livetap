import { describe, expect, it } from 'vitest';
import { readPending, resolveCallback } from '../screens/OAuthCallback.js';
import type { PendingAuth } from '../screens/OAuthCallback.js';

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
