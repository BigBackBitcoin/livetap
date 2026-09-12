import { describe, expect, it } from 'vitest';
import type { DestinationConfig, IngestTarget } from '@livetap/core';
import { CustomRtmpAdapter, CustomRtmpConfigError } from './CustomRtmpAdapter.js';
import { customProfile } from '../profiles/index.js';

function config(ingest: Partial<IngestTarget> | undefined): DestinationConfig {
  return {
    id: 'custom-1',
    platform: 'custom',
    label: 'My server',
    aspectRatio: '16:9',
    enabled: true,
    mock: false,
    ingest: ingest as IngestTarget | undefined,
  };
}

describe('CustomRtmpAdapter', () => {
  const adapter = new CustomRtmpAdapter();

  it('uses the custom profile and derives supports() from it', () => {
    expect(adapter.profile).toBe(customProfile);
    expect(adapter.profile.mock).toBeUndefined();
    expect(adapter.supports('srt')).toBe(true);
    expect(adapter.supports('whip')).toBe(true);
    expect(adapter.supports('stop')).toBe(true);
    // No control plane means no chat, metadata or analytics.
    expect(adapter.supports('chatRead')).toBe(false);
    expect(adapter.supports('metadata')).toBe(false);
    expect(adapter.supports('analytics')).toBe(false);
    expect(adapter.supports('oauth')).toBe(false);
  });

  it('accepts a well-formed RTMP target and returns it unchanged', async () => {
    const ingest: IngestTarget = {
      protocol: 'rtmp',
      url: 'rtmp://ingest.example.com/live',
      streamKey: 'abc-123',
    };
    const result = await adapter.validate(config(ingest));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ingest).toEqual(ingest);
    const handle = await adapter.createBroadcast(config(ingest));
    expect(handle.ingest).toEqual(ingest);
    expect(handle.broadcastId).toBeUndefined();
    expect(handle.watchUrl).toBeUndefined();
  });

  it('accepts RTMPS, SRT and WHIP targets', async () => {
    const targets: IngestTarget[] = [
      { protocol: 'rtmps', url: 'rtmps://secure.example.com/live', streamKey: 'k' },
      { protocol: 'srt', url: 'srt://relay.example.com:9000' },
      { protocol: 'whip', url: 'https://whip.example.com/publish/abc' },
    ];
    for (const ingest of targets) {
      const result = await adapter.validate(config(ingest));
      expect(result.ok, `${ingest.protocol} should validate`).toBe(true);
    }
  });

  it('rejects missing, malformed and unsafe configuration with CONFIG_INVALID', async () => {
    const cases: Array<Partial<IngestTarget> | undefined> = [
      undefined,
      { protocol: 'rtmp', url: '', streamKey: 'k' },
      { protocol: 'rtmp', url: 'https://not-rtmp.example.com/live', streamKey: 'k' },
      { protocol: 'rtmp', url: 'rtmp://ingest.example.com/live' }, // no key
      { protocol: 'rtmps', url: 'rtmp://insecure.example.com/live', streamKey: 'k' },
      { protocol: 'rtmp', url: 'rtmp://ingest.example.com/live; rm -rf /', streamKey: 'k' },
      { protocol: 'rtmp', url: 'rtmp://ingest.example.com/live', streamKey: 'a b' },
      { protocol: 'srt', url: 'srt://relay.example.com' }, // no port
    ];
    for (const ingest of cases) {
      const result = await adapter.validate(config(ingest));
      expect(result.ok, `${JSON.stringify(ingest)} should be rejected`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONFIG_INVALID');
        expect(result.technical?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('throws from createBroadcast when the ingest is invalid', async () => {
    await expect(adapter.createBroadcast(config(undefined))).rejects.toBeInstanceOf(
      CustomRtmpConfigError,
    );
  });

  it('stops and disconnects without doing anything', async () => {
    const ingest: IngestTarget = { protocol: 'rtmp', url: 'rtmp://a.example/live', streamKey: 'k' };
    await expect(adapter.stopBroadcast({ ingest })).resolves.toBeUndefined();
    await expect(adapter.disconnect(undefined)).resolves.toBeUndefined();
  });

  it('makes no network calls (there is nothing to call)', () => {
    // Structural guarantee: the adapter takes no fetch and holds no client.
    expect(Object.keys(adapter)).toEqual(['profile']);
  });
});
