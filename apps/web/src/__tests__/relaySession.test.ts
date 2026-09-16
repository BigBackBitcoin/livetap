/**
 * The relay session client.
 *
 * Two things matter here and neither is the happy path. First, stream keys go over this wire and
 * nowhere else in the browser, so the request body has to be exactly what the relay validates and
 * nothing more. Second, END must not be blockable by the relay — a creator whose relay has
 * restarted still has to be able to stop, and a `closeRelaySession` that threw would take that
 * away at the worst possible moment.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  RelayError,
  closeRelaySession,
  openRelaySession,
  toRelayDestination,
} from '../state/relaySession.js';

const ok = (body: unknown, status = 201) =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);

const dest = { url: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'abcd-efgh', aspectRatio: '16:9' as const };

describe('opening a relay session', () => {
  it('sends the destinations and returns the session', async () => {
    const fetchImpl = ok({ sessionId: 's1', whipUrl: 'https://relay/live/s1/whip', whipAuthorization: 'u:p' });
    const session = await openRelaySession([dest], { baseUrl: 'https://relay', fetchImpl });

    expect(session).toEqual({
      sessionId: 's1',
      whipUrl: 'https://relay/live/s1/whip',
      whipAuthorization: 'u:p',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://relay/sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ destinations: [dest] });
  });

  it('tolerates a trailing slash on the base URL rather than producing //sessions', async () => {
    const fetchImpl = ok({ sessionId: 's', whipUrl: 'w' });
    await openRelaySession([dest], { baseUrl: 'https://relay/', fetchImpl });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://relay/sessions');
  });

  it('presents the bearer token when one is configured, and omits the header when not', async () => {
    const withToken = ok({ sessionId: 's', whipUrl: 'w' });
    await openRelaySession([dest], { baseUrl: 'https://relay', token: 'secret', fetchImpl: withToken });
    expect(((withToken.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).authorization)
      .toBe('Bearer secret');

    const without = ok({ sessionId: 's', whipUrl: 'w' });
    await openRelaySession([dest], { baseUrl: 'https://relay', fetchImpl: without });
    expect(((without.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).authorization)
      .toBeUndefined();
  });

  it("surfaces the relay's own refusal verbatim, because it is the actionable part", async () => {
    // "this relay is not configured for 9:16 re-encoding" is something an operator can fix.
    // "The relay refused this broadcast" is not.
    const fetchImpl = ok(
      { errors: ['destinations[0]: this relay is not configured for 9:16 re-encoding.'] },
      400,
    );
    await expect(openRelaySession([dest], { baseUrl: 'https://relay', fetchImpl })).rejects.toThrow(
      /not configured for 9:16 re-encoding/,
    );
  });

  it("reads the relay's actual 400 shape, where the useful half is in `details`", async () => {
    /*
     * The relay answers `{ error: 'Invalid destinations.', details: [...] }`. Reading only `error`
     * showed a creator "Invalid destinations." and threw away the sentence naming which one and
     * why — and this client was written against an assumed shape, so it did exactly that.
     */
    const fetchImpl = ok(
      { error: 'Invalid destinations.', details: ['destinations[1]: Stream key is required.'] },
      400,
    );
    await expect(openRelaySession([dest], { baseUrl: 'https://relay', fetchImpl })).rejects.toThrow(
      /destinations\[1\]: Stream key is required\./,
    );
  });

  it('names the machine that did not answer, rather than saying fetch failed', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      openRelaySession([dest], { baseUrl: 'https://relay.example', fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/relay at https:\/\/relay\.example did not answer/);
  });

  it('refuses an answer that is not a session, so a wrong URL fails here and not at GO LIVE', async () => {
    const fetchImpl = ok({ hello: 'world' });
    await expect(openRelaySession([dest], { baseUrl: 'https://relay', fetchImpl })).rejects.toThrow(
      RelayError,
    );
  });

  it('will not open a session with nothing to forward to', async () => {
    const fetchImpl = ok({});
    await expect(openRelaySession([], { baseUrl: 'https://relay', fetchImpl })).rejects.toThrow(
      /at least one destination/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('closing a relay session', () => {
  it('NEVER throws, because END must not be blockable by the relay', async () => {
    // A relay that restarted has forgotten the session. The creator still gets to stop.
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('connection refused');
    });
    await expect(
      closeRelaySession('s1', { baseUrl: 'https://relay', fetchImpl: fetchImpl as never }),
    ).resolves.toBe(false);
  });

  it('reports whether the relay actually confirmed the teardown', async () => {
    expect(await closeRelaySession('s1', { baseUrl: 'https://relay', fetchImpl: ok({}, 204) })).toBe(true);
    expect(await closeRelaySession('s1', { baseUrl: 'https://relay', fetchImpl: ok({}, 404) })).toBe(false);
  });

  it('escapes the session id rather than pasting it into a URL', async () => {
    const fetchImpl = ok({}, 204);
    await closeRelaySession('a/../b', { baseUrl: 'https://relay', fetchImpl });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://relay/sessions/a%2F..%2Fb');
  });
});

describe('building a relay destination from app config', () => {
  it('carries the stream key separately, and one entry means one account', async () => {
    const built = toRelayDestination(
      {
        id: 'youtube-2',
        platform: 'youtube',
        label: 'Carter Live',
        aspectRatio: '9:16',
        enabled: true,
        ingest: { url: 'rtmp://a.rtmp.youtube.com/live2', protocol: 'rtmp' },
      } as never,
      'key-for-the-second-channel',
    );
    expect(built).toEqual({
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'key-for-the-second-channel',
      protocol: 'rtmp',
      aspectRatio: '9:16',
    });
  });

  it('returns null for a destination with no ingest, rather than sending a useless row', async () => {
    expect(toRelayDestination({ id: 'x', platform: 'youtube' } as never, 'k')).toBeNull();
  });
});
