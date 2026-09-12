// @vitest-environment node
/**
 * SECURITY REVIEW 2026-09 — SEC-A4.
 *
 * `redact()` is the only thing between a platform's error body (or a URL we
 * built) and an error message that reaches a log, a toast or a diagnostics
 * export. It had no tests of its own; these pin the fields it must mask and,
 * just as importantly, that it does NOT mask the diagnostic text around them.
 */
import { describe, expect, it } from 'vitest';

import { HttpError, redact, request, withQuery } from './http.js';
import type { FetchLike, FetchResponse } from './http.js';

const MASK = '••••';

describe('redact', () => {
  it('masks bearer tokens', () => {
    expect(redact('Authorization: Bearer ya29.a0AfB_abcdef-123')).toBe(`Authorization: Bearer ${MASK}`);
    expect(redact('bearer oauth2-token==')).toBe(`bearer ${MASK}`);
  });

  it('masks the stream key in an RTMP publish URL', () => {
    expect(redact('rtmps://live.twitch.tv/app/live_1234_SECRET')).toBe(`rtmps://live.twitch.tv/app/${MASK}`);
    expect(redact('rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl')).toBe(
      `rtmp://a.rtmp.youtube.com/live2/${MASK}`,
    );
  });

  it('masks every credential-bearing query parameter, SRT and WHIP included', () => {
    for (const field of [
      'access_token',
      'refresh_token',
      'id_token',
      'token',
      'key',
      'stream_key',
      'streamid',
      'passphrase',
      'secret',
      'client_secret',
      'code',
      'code_verifier',
      'password',
      'signature',
      'authorization',
    ]) {
      const out = redact(`https://api.example/x?${field}=SUPERSECRETVALUE&page=2`);
      expect(out, field).not.toContain('SUPERSECRETVALUE');
      // The non-secret parameter survives, so the URL is still diagnosable.
      expect(out, field).toContain('page=2');
    }
  });

  it('masks userinfo credentials in a URL', () => {
    expect(redact('rtsp://relayhook:hookpassword@127.0.0.1:8554/live')).toBe(`rtsp://${MASK}@127.0.0.1:8554/live`);
    expect(redact('https://user:pw@api.example/v1')).toBe(`https://${MASK}@api.example/v1`);
  });

  it('masks a full SRT destination with both credentials', () => {
    const out = redact('srt://ingest.example.com:9000?streamid=abc123&passphrase=hunter2');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('srt://ingest.example.com:9000');
  });

  it('leaves text with no secret untouched and caps the length', () => {
    expect(redact('HTTP 404: The live chat is no longer live.')).toBe('HTTP 404: The live chat is no longer live.');
    expect(redact('x'.repeat(2000))).toHaveLength(500);
    expect(redact(undefined as unknown as string)).toBe('');
  });
});

describe('HttpError', () => {
  it('redacts the URL it stores, so the error object itself carries no secret', () => {
    const err = new HttpError(403, 'forbidden', 'https://api.example/v1?access_token=SECRET123');
    expect(err.url).not.toContain('SECRET123');
    expect(err.url).toContain(MASK);
    expect(err.status).toBe(403);
  });
});

describe('request error mapping', () => {
  const respond = (status: number, body: string): FetchLike =>
    (async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        statusText: 'x',
        json: async () => JSON.parse(body) as unknown,
        text: async () => body,
      }) satisfies FetchResponse) as FetchLike;

  it('does not leak a token echoed back inside a platform error body', async () => {
    const err = await request(
      respond(400, JSON.stringify({ error_description: 'bad code=AUTHCODE123 for token=TOKEN456' })),
      { url: 'https://api.example/v1', token: 'TOKEN456' },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    const httpErr = err as HttpError;
    expect(httpErr.message).not.toContain('AUTHCODE123');
    expect(httpErr.message).not.toContain('TOKEN456');
    // The human-readable part is preserved.
    expect(httpErr.message).toContain('bad code=');
  });

  it('truncates a huge non-JSON error body instead of logging all of it', async () => {
    const err = await request(respond(500, 'E'.repeat(5000)), { url: 'https://api.example/v1' }).catch(
      (e: unknown) => e,
    );
    expect((err as HttpError).message.length).toBeLessThanOrEqual(500);
  });

  it('sends the token only in the Authorization header, never in the URL', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const spy: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    };
    await request(spy, { url: withQuery('https://api.example/v1', { part: 'id' }), token: 'TOKEN456' });
    expect(seenUrl).not.toContain('TOKEN456');
    expect(seenHeaders['Authorization']).toBe('Bearer TOKEN456');
  });
});
