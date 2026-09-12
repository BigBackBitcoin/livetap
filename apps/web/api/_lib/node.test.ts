// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { nodeHandler, toWebRequest } from './node.js';
import { handle as configHandle } from '../oauth/config.js';
import { handle as tokenHandle } from '../oauth/token.js';

function fakeReq(method: string, url: string, headers: Record<string, string>, body?: string): IncomingMessage {
  const em = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string>; readable: boolean };
  em.method = method;
  em.url = url;
  em.headers = headers;
  em.readable = true;
  queueMicrotask(() => {
    if (body) em.emit('data', Buffer.from(body));
    em.emit('end');
  });
  return em as unknown as IncomingMessage;
}

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    end: (t: string) => {
      res.body = t;
    },
    body: '',
    headers,
  };
  return res as unknown as ServerResponse & { body: string; headers: Record<string, string> };
}

describe('node adapter', () => {
  it('builds an absolute Web Request with headers and body', async () => {
    const r = await toWebRequest(fakeReq('POST', '/api/oauth/token', { host: 'livetap.vercel.app', 'content-type': 'application/json' }, '{"a":1}'));
    expect(r.url).toBe('https://livetap.vercel.app/api/oauth/token');
    expect(r.method).toBe('POST');
    expect(await r.json()).toEqual({ a: 1 });
  });

  it('serves GET /api/oauth/config as JSON 200', async () => {
    const res = fakeRes();
    await nodeHandler(configHandle)(fakeReq('GET', '/api/oauth/config', { host: 'x' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toHaveProperty('platforms');
  });

  it('returns 501 NOT_CONFIGURED for token exchange without secrets', async () => {
    const res = fakeRes();
    await nodeHandler(tokenHandle)(
      fakeReq('POST', '/api/oauth/token', { host: 'x', 'content-type': 'application/json' }, JSON.stringify({ platform: 'youtube', code: 'abcd1234', redirectUri: 'https://x/oauth/callback' })),
      res,
    );
    expect(res.statusCode).toBe(501);
    expect(JSON.parse(res.body).error).toBe('NOT_CONFIGURED');
  });
});
