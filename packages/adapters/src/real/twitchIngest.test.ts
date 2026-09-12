import { describe, expect, it } from 'vitest';
import { TwitchAdapter } from './TwitchAdapter.js';
import {
  createIngestCache,
  ingestFromTemplate,
  resolveIngest,
  selectIngest,
  TWITCH_FALLBACK_INGEST_URL,
  TWITCH_INGEST_CACHE_MS,
  TWITCH_INGEST_LIST_URL,
  TWITCH_INGEST_RETRY_MS,
} from './twitchIngest.js';
import type { FetchLike } from './http.js';
import { createFakeFetch, type FakeRoute } from '../testing/fakeFetch.js';

/** Shape of one `GET https://ingest.twitch.tv/ingests` entry. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Frankfurt, Germany',
    url_template: 'rtmp://fra.contribute.live-video.net/app/{stream_key}',
    url_template_secure: 'rtmps://fra.contribute.live-video.net/app/{stream_key}',
    priority: 10,
    availability: 1,
    default: false,
    ...overrides,
  };
}

function ingestRoutes(body: unknown): FakeRoute[] {
  return [{ match: 'ingest.twitch.tv/ingests', body }];
}

describe('resolveIngest picks a PoP from the official list', () => {
  it('chooses the default entry even when another has a lower priority', async () => {
    const fake = createFakeFetch(
      ingestRoutes({
        ingests: [
          entry({ name: 'Nearest', priority: 1, default: false }),
          entry({
            name: 'San Francisco, CA',
            priority: 99,
            default: true,
            url_template: 'rtmp://sfo.contribute.live-video.net/app/{stream_key}',
            url_template_secure: 'rtmps://sfo.contribute.live-video.net/app/{stream_key}',
          }),
        ],
      }),
    );
    const resolved = await resolveIngest(fake.fetch);
    expect(resolved).toEqual({
      protocol: 'rtmps',
      url: 'rtmps://sfo.contribute.live-video.net/app',
      name: 'San Francisco, CA',
    });
    expect(resolved.technical).toBeUndefined();
    expect(fake.sequence()).toEqual([`GET ${TWITCH_INGEST_LIST_URL}`]);
    // The request is unauthenticated: no bearer token may be attached to it.
    expect(fake.calls[0]?.headers['Authorization']).toBeUndefined();
  });

  it('falls back to the lowest priority when no entry is marked default, skipping downed PoPs', async () => {
    const fake = createFakeFetch(
      ingestRoutes({
        ingests: [
          entry({
            name: 'Down but nearest',
            priority: 1,
            availability: 0,
            url_template_secure: 'rtmps://down.contribute.live-video.net/app/{stream_key}',
          }),
          entry({
            name: 'Amsterdam',
            priority: 5,
            url_template_secure: 'rtmps://ams.contribute.live-video.net/app/{stream_key}',
          }),
          entry({
            name: 'Tokyo',
            priority: 40,
            url_template_secure: 'rtmps://tyo.contribute.live-video.net/app/{stream_key}',
          }),
        ],
      }),
    );
    const resolved = await resolveIngest(fake.fetch);
    expect(resolved.url).toBe('rtmps://ams.contribute.live-video.net/app');
    expect(resolved.name).toBe('Amsterdam');
  });

  it('prefers url_template_secure (RTMPS) and only uses plain RTMP when there is no secure form', async () => {
    const secure = await resolveIngest(
      createFakeFetch(ingestRoutes({ ingests: [entry({ default: true })] })).fetch,
    );
    expect(secure).toMatchObject({
      protocol: 'rtmps',
      url: 'rtmps://fra.contribute.live-video.net/app',
    });

    const plain = await resolveIngest(
      createFakeFetch(
        ingestRoutes({ ingests: [entry({ default: true, url_template_secure: undefined })] }),
      ).fetch,
    );
    expect(plain).toMatchObject({
      protocol: 'rtmp',
      url: 'rtmp://fra.contribute.live-video.net/app',
    });
  });

  it('strips the {stream_key} placeholder without ever handling a key', async () => {
    const resolved = await resolveIngest(
      createFakeFetch(
        ingestRoutes({
          ingests: [
            entry({
              default: true,
              url_template_secure: 'rtmps://sfo.contribute.live-video.net/app/{stream_key}',
            }),
          ],
        }),
      ).fetch,
    );
    expect(resolved.url).toBe('rtmps://sfo.contribute.live-video.net/app');
    expect(resolved.url).not.toContain('{stream_key}');
    expect(resolved.url.endsWith('/app')).toBe(true);
  });
});

describe('resolveIngest degrades honestly', () => {
  it('falls back to the documented default and records a non-secret note when the fetch throws', async () => {
    // No route matches, so the fake fetch throws -- the same shape as a dead network.
    const fake = createFakeFetch([]);
    const resolved = await resolveIngest(fake.fetch);
    expect(resolved).toMatchObject({ protocol: 'rtmp', url: TWITCH_FALLBACK_INGEST_URL });
    expect(resolved.technical).toMatch(/ingest list unavailable/i);
    expect(resolved.name).toBeUndefined();
  });

  it('falls back on an HTTP error, and the note carries no secret', async () => {
    const fake = createFakeFetch([
      { match: 'ingest.twitch.tv/ingests', status: 500, body: { message: 'boom' } },
    ]);
    const resolved = await resolveIngest(fake.fetch);
    expect(resolved.url).toBe(TWITCH_FALLBACK_INGEST_URL);
    expect(resolved.technical).toContain('HTTP 500');
    expect(resolved.technical).not.toMatch(/live_|Bearer/);
  });

  it('falls back when the list is present but unusable', async () => {
    for (const body of [
      {},
      { ingests: 'nope' },
      { ingests: [] },
      { ingests: [null, 42, 'x'] },
      { ingests: [entry({ availability: 0 })] },
      { ingests: [entry({ url_template: 'ws://evil.example/app/{stream_key}', url_template_secure: undefined })] },
      { ingests: [entry({ url_template: 'rtmp://user:pw@fra.contribute.live-video.net/app/{stream_key}', url_template_secure: undefined })] },
    ]) {
      const resolved = await resolveIngest(createFakeFetch(ingestRoutes(body)).fetch);
      expect(resolved.url).toBe(TWITCH_FALLBACK_INGEST_URL);
      expect(resolved.technical).toBeDefined();
    }
  });

  it('rejects templates that are not plain RTMP/RTMPS URLs with a host', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'not a url',
      'ws://host/app/{stream_key}',
      'https://host/app/{stream_key}',
      'javascript:alert(1)',
      'rtmp:///app/{stream_key}',
      'rtmp://host/app/{stream_key}\r\nHost: evil',
      `rtmp://host/${'a'.repeat(3000)}`,
    ]) {
      expect(ingestFromTemplate(bad)).toBeUndefined();
    }
    expect(ingestFromTemplate('rtmp://host/app/{stream_key}')).toEqual({
      protocol: 'rtmp',
      url: 'rtmp://host/app',
    });
  });

  it('selectIngest on junk returns undefined rather than guessing', () => {
    expect(selectIngest(undefined)).toBeUndefined();
    expect(selectIngest({})).toBeUndefined();
    expect(selectIngest([])).toBeUndefined();
  });
});

describe('resolveIngest caches the list', () => {
  it('serves a second call from the cache without a second fetch', async () => {
    const fake = createFakeFetch(
      ingestRoutes({ ingests: [entry({ default: true })] }),
    );
    const cache = createIngestCache();
    let now = 1_000;
    const options = { cache, now: () => now };

    const first = await resolveIngest(fake.fetch, options);
    const second = await resolveIngest(fake.fetch, options);
    expect(second).toEqual(first);
    expect(fake.calls).toHaveLength(1);

    // Still inside the hour: no refetch.
    now += TWITCH_INGEST_CACHE_MS - 1;
    await resolveIngest(fake.fetch, options);
    expect(fake.calls).toHaveLength(1);

    // Past the hour: refetched.
    now += 2;
    await resolveIngest(fake.fetch, options);
    expect(fake.calls).toHaveLength(2);
  });

  it('retries a failed lookup long before an hour, so one blip does not pin the fallback', async () => {
    let listBody: unknown = undefined;
    const fetchImpl: FetchLike = async () => {
      if (listBody === undefined) throw new Error('network down');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(listBody);
        },
        async json() {
          return listBody;
        },
      };
    };
    const cache = createIngestCache();
    let now = 0;
    const options = { cache, now: () => now };

    const failed = await resolveIngest(fetchImpl, options);
    expect(failed.url).toBe(TWITCH_FALLBACK_INGEST_URL);

    listBody = { ingests: [entry({ default: true })] };
    // The failure is cached, but only briefly.
    expect((await resolveIngest(fetchImpl, options)).url).toBe(TWITCH_FALLBACK_INGEST_URL);
    now += TWITCH_INGEST_RETRY_MS + 1;
    expect((await resolveIngest(fetchImpl, options)).url).toBe(
      'rtmps://fra.contribute.live-video.net/app',
    );
  });
});

describe('TwitchAdapter uses the resolved PoP', () => {
  const credential = {
    id: 'cred-tw',
    platform: 'twitch',
    accountId: '1234567',
    accountLabel: 'adalovelace',
  };
  const config = {
    id: 'dest-tw',
    platform: 'twitch' as const,
    label: 'adalovelace',
    aspectRatio: '16:9' as const,
    enabled: true,
    mock: false,
  };

  function adapter(routes: FakeRoute[]) {
    const fake = createFakeFetch(routes);
    return {
      fake,
      adapter: new TwitchAdapter({
        fetch: fake.fetch,
        tokenProvider: async () => 'tw-access-token',
        apiBase: 'https://api.test/helix',
        clientId: 'livetap-client-id',
      }),
    };
  }

  it('returns the RTMPS PoP from the list, and resolves it once across two go-lives', async () => {
    const { adapter: tw, fake } = adapter([
      { match: '/streams/key', body: { data: [{ stream_key: 'live_1234567_secret' }] } },
      ...ingestRoutes({ ingests: [entry({ default: true })] }),
    ]);
    const handle = await tw.createBroadcast(config, credential);
    expect(handle.ingest).toEqual({
      protocol: 'rtmps',
      url: 'rtmps://fra.contribute.live-video.net/app',
      streamKey: 'live_1234567_secret',
    });
    expect(tw.lastIngestNote).toBeUndefined();

    await tw.createBroadcast(config, credential);
    // Two key fetches, but only one ingest-list fetch.
    expect(fake.sequence().filter((c) => c.includes('ingest.twitch.tv'))).toHaveLength(1);
    // The unauthenticated list request never carries the key or the token.
    for (const call of fake.calls) {
      if (call.url.includes('ingest.twitch.tv')) {
        expect(call.headers['Authorization']).toBeUndefined();
        expect(call.url).not.toContain('live_1234567_secret');
      }
    }
  });

  it('still goes live on the default ingest, with a note, when the list is unreachable', async () => {
    const { adapter: tw } = adapter([
      { match: '/streams/key', body: { data: [{ stream_key: 'live_1234567_secret' }] } },
    ]);
    const handle = await tw.createBroadcast(config, credential);
    expect(handle.ingest).toEqual({
      protocol: 'rtmp',
      url: TWITCH_FALLBACK_INGEST_URL,
      streamKey: 'live_1234567_secret',
    });
    expect(tw.lastIngestNote).toMatch(/ingest list unavailable/i);
    expect(tw.lastIngestNote).not.toContain('live_1234567_secret');
  });

  it('validate() reports the resolved ingest too', async () => {
    const { adapter: tw } = adapter([
      {
        match: '/channels',
        body: { data: [{ broadcaster_id: '1234567', broadcaster_login: 'adalovelace' }] },
      },
      { match: '/streams/key', body: { data: [{ stream_key: 'k' }] } },
      ...ingestRoutes({ ingests: [entry({ default: true })] }),
    ]);
    const result = await tw.validate(config, credential);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ingest?.url).toBe('rtmps://fra.contribute.live-video.net/app');
      expect(result.ingest?.protocol).toBe('rtmps');
    }
  });

  it('an explicit ingestUrl pins the PoP and skips the list entirely', async () => {
    const fake = createFakeFetch([
      { match: '/streams/key', body: { data: [{ stream_key: 'k' }] } },
    ]);
    const tw = new TwitchAdapter({
      fetch: fake.fetch,
      tokenProvider: async () => 'tw-access-token',
      apiBase: 'https://api.test/helix',
      clientId: 'livetap-client-id',
      ingestUrl: 'rtmps://pinned.test/app',
    });
    const handle = await tw.createBroadcast(config, credential);
    expect(handle.ingest).toEqual({
      protocol: 'rtmps',
      url: 'rtmps://pinned.test/app',
      streamKey: 'k',
    });
    expect(fake.sequence().some((c) => c.includes('ingest.twitch.tv'))).toBe(false);
  });
});
