/**
 * The four things that stood between a creator and a connected account.
 *
 * All four were found by building the desktop app and driving it, through its own UI, against a
 * real OAuth server — not by reading the code, which is why none of them had been noticed. Each
 * one breaks the flow at a different point and none of them produces a message anybody could act
 * on, which is the property that makes this class of bug expensive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_NATIVE_BROKER, brokerBaseUrl } from './mockMode.js';
import { refreshingFetch, saveTokens, readTokens, forgetTokens } from './tokens.js';

const host = globalThis as unknown as { window?: Record<string, unknown> };
const originalWindow = host.window;

afterEach(async () => {
  host.window = originalWindow;
  await forgetTokens('youtube');
  vi.restoreAllMocks();
});

describe('where the broker lives', () => {
  it('is the same origin on the web, where there is one', () => {
    host.window = { location: { protocol: 'https:' } };
    expect(brokerBaseUrl()).toBe('');
  });

  /*
   * The bug: `VITE_LIVETAP_BROKER_URL` was read here and set by NO build in this repository, so
   * the shipped desktop bundle folded this function to `return ""` and every broker call resolved
   * against `file://`. Connect account could only ever answer "no sign-in set up" and drop the
   * creator on the paste-a-key form — on a build where sign-in was fully implemented and working.
   */
  it('falls back to the deployment on a desktop shell, which has no origin of its own', () => {
    host.window = { livetapHost: { kind: 'desktop' }, location: { protocol: 'file:' } };
    expect(brokerBaseUrl()).toBe(DEFAULT_NATIVE_BROKER);
  });

  it('falls back on a phone too', () => {
    host.window = { Capacitor: {}, location: { protocol: 'https:' } };
    expect(brokerBaseUrl()).toBe(DEFAULT_NATIVE_BROKER);
  });

  it('is a real https origin, because a broker holds the client secrets', () => {
    expect(DEFAULT_NATIVE_BROKER).toMatch(/^https:\/\//);
  });
});

describe('renewing a sign-in that died before it said it would', () => {
  beforeEach(async () => {
    host.window = {};
    await saveTokens('youtube', {
      accessToken: 'stale-access',
      refreshToken: 'good-refresh',
      scopes: ['youtube'],
      // Deliberately far in the future: the clock-based refresh will NOT fire, which is the whole
      // point. A Testing-status Google authorization dies on day seven whatever this says.
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
  });

  function brokerReturns(accessToken: string): Response {
    return new Response(JSON.stringify({ accessToken, refreshToken: 'rotated-refresh', expiresIn: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('renews once on a 401 and retries the request with the new token', async () => {
    const seen: string[] = [];
    const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '';
      if (url.includes('/api/oauth/')) return brokerReturns('fresh-access');
      seen.push(auth);
      return new Response('', { status: auth === 'Bearer fresh-access' ? 200 : 401 });
    });

    const wrapped = refreshingFetch('youtube', inner as unknown as typeof fetch);
    const response = await wrapped('https://youtube.test/v3/liveBroadcasts', {
      headers: { Authorization: 'Bearer stale-access' },
    });

    expect(response.status).toBe(200);
    expect(seen).toEqual(['Bearer stale-access', 'Bearer fresh-access']);
    expect((await readTokens('youtube'))?.accessToken).toBe('fresh-access');
    // And the rotated refresh token was kept, or the next renewal has nothing to use.
    expect((await readTokens('youtube'))?.refreshToken).toBe('rotated-refresh');
  });

  it('does not retry forever: one renewal, then the platform has the last word', async () => {
    let platformCalls = 0;
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/oauth/')) return brokerReturns('fresh-access');
      platformCalls += 1;
      return new Response('', { status: 401 });
    });

    const response = await refreshingFetch('youtube', inner as unknown as typeof fetch)(
      'https://youtube.test/v3/liveBroadcasts',
      { headers: { Authorization: 'Bearer stale-access' } },
    );

    expect(response.status).toBe(401);
    expect(platformCalls).toBe(2);
  });

  it('leaves a 401 alone when the request carried no authorization of ours', async () => {
    const inner = vi.fn(async () => new Response('', { status: 401 }));
    const response = await refreshingFetch('youtube', inner as unknown as typeof fetch)(
      'https://youtube.test/public',
    );

    expect(response.status).toBe(401);
    // One call. A 401 on a request we did not authorise is the platform answering something else.
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('hands back the original 401 when the refresh token is dead too', async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/oauth/')) return new Response('', { status: 400 });
      return new Response('', { status: 401 });
    });

    const response = await refreshingFetch('youtube', inner as unknown as typeof fetch)(
      'https://youtube.test/v3/liveBroadcasts',
      { headers: { Authorization: 'Bearer stale-access' } },
    );

    // The platform's own answer, not a second and less informative failure of ours.
    expect(response.status).toBe(401);
  });

  it('never sends two authorization headers when the caller used a lower-case one', async () => {
    const headersSeen: Array<Record<string, string>> = [];
    const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/oauth/')) return brokerReturns('fresh-access');
      headersSeen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response('', { status: headersSeen.length === 1 ? 401 : 200 });
    });

    await refreshingFetch('youtube', inner as unknown as typeof fetch)('https://youtube.test/v3/x', {
      headers: { authorization: 'Bearer stale-access' },
    });

    const retry = headersSeen[1] ?? {};
    const authHeaders = Object.keys(retry).filter((k) => k.toLowerCase() === 'authorization');
    expect(authHeaders).toEqual(['Authorization']);
    expect(retry['Authorization']).toBe('Bearer fresh-access');
  });
});
