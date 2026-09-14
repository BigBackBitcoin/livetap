// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimit } from '../../api/_lib/broker.js';
import {
  EARLY_ACCESS_RATE_LIMIT_MAX,
  handle,
  handleGet,
  handlePost,
} from '../../api/early-access.js';

const WEBHOOK_URL = 'https://hooks.example.com/notify';
const ENABLED_ENV = { LIVETAP_EARLY_ACCESS_WEBHOOK: WEBHOOK_URL } as NodeJS.ProcessEnv;
const DISABLED_ENV = {} as NodeJS.ProcessEnv;

function fakeFetch(status: number, body: unknown = {}, capture: { url?: string; body?: string } = {}) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    capture.url = String(url);
    capture.body = String(init?.body ?? '');
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://livetap.vercel.app/api/early-access', {
    method: 'POST',
    headers: { host: 'livetap.vercel.app', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => resetRateLimit());

describe('GET /api/early-access', () => {
  it('reports disabled with no method exposed when the webhook env var is unset', async () => {
    const res = await handleGet(DISABLED_ENV);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enabled: false, method: 'none' });
  });

  it('reports enabled, and never leaks the webhook URL', async () => {
    const res = await handleGet(ENABLED_ENV);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ enabled: true, method: 'webhook' });
    expect(JSON.stringify(data)).not.toContain('hooks.example.com');
  });
});

describe('POST /api/early-access when disabled', () => {
  it('returns 503 NOT_CONFIGURED without ever calling fetch', async () => {
    const spy = vi.fn();
    const res = await handlePost(
      postRequest({ email: 'friend@example.com', consent: true }),
      DISABLED_ENV,
      spy as unknown as typeof fetch,
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/early-access when enabled', () => {
  it('forwards email, platform, consentAt and source, and returns 202', async () => {
    const cap: { url?: string; body?: string } = {};
    const res = await handlePost(
      postRequest({ email: 'friend@example.com', consent: true, platform: 'mac' }),
      ENABLED_ENV,
      fakeFetch(200, { ok: true }, cap),
    );
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(cap.url).toBe(WEBHOOK_URL);
    const forwarded = JSON.parse(cap.body ?? '{}');
    expect(forwarded.email).toBe('friend@example.com');
    expect(forwarded.platform).toBe('mac');
    expect(forwarded.source).toBe('livetap.vercel.app');
    expect(() => new Date(forwarded.consentAt).toISOString()).not.toThrow();
    expect(new Date(forwarded.consentAt).toISOString()).toBe(forwarded.consentAt);
  });

  it('rejects a malformed email with 400', async () => {
    const res = await handlePost(
      postRequest({ email: 'not-an-email', consent: true }),
      ENABLED_ENV,
      fakeFetch(200, {}),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a request missing consent with 400', async () => {
    const res = await handlePost(
      postRequest({ email: 'friend@example.com' }),
      ENABLED_ENV,
      fakeFetch(200, {}),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unknown platform with 400', async () => {
    const res = await handlePost(
      postRequest({ email: 'friend@example.com', consent: true, platform: 'linux' }),
      ENABLED_ENV,
      fakeFetch(200, {}),
    );
    expect(res.status).toBe(400);
  });

  it('maps a failing webhook to 502', async () => {
    const res = await handlePost(
      postRequest({ email: 'friend@example.com', consent: true }),
      ENABLED_ENV,
      fakeFetch(500, {}),
    );
    expect(res.status).toBe(502);
  });
});

describe('same-origin enforcement', () => {
  it('refuses a cross-origin POST with 403', async () => {
    const res = await handle(
      postRequest({ email: 'friend@example.com', consent: true }, { origin: 'https://evil.example' }),
    );
    expect(res.status).toBe(403);
  });
});

describe('rate limiting', () => {
  it('allows five requests from one IP in the window, then refuses the sixth with 429', async () => {
    const reqFrom = () =>
      postRequest(
        { email: 'friend@example.com', consent: true },
        { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' },
      );

    for (let i = 0; i < EARLY_ACCESS_RATE_LIMIT_MAX; i++) {
      const res = await handle(reqFrom());
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }
    const sixth = await handle(reqFrom());
    expect(sixth.status).toBe(429);
  });
});

describe('method handling', () => {
  it('rejects methods other than GET and POST', async () => {
    const res = await handle(new Request('https://livetap.vercel.app/api/early-access', { method: 'DELETE' }));
    expect(res.status).toBe(405);
  });
});
