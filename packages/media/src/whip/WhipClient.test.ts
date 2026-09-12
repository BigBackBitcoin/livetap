// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { OutputFormat } from '@livetap/core';
import { WhipClient, WhipError, buildIceFragment, codeForStatus, parseLinkIceServers, resolveLocation } from './WhipClient.js';
import {
  FAKE_ANSWER_SDP,
  FakePeerConnection,
  asMediaStream,
  asPeerConnectionCtor,
  createFakeFetch,
  createFakeMediaStream,
  createFakeTrack,
  makeResponse,
  type FakeFetchResponseSpec,
} from '../testing/fakes.js';

const FORMAT: OutputFormat = {
  aspectRatio: '16:9',
  width: 1920,
  height: 1080,
  fps: 30,
  videoKbps: 4500,
  audioKbps: 160,
  codec: 'h264',
  keyframeIntervalSeconds: 2,
};

function build(
  handler?: (call: { url: string; method: string; headers: Record<string, string>; body?: string }) => FakeFetchResponseSpec,
  options: { token?: string; format?: OutputFormat } = {},
) {
  const stream = createFakeMediaStream([createFakeTrack('video'), createFakeTrack('audio')]);
  const fake = createFakeFetch(handler);
  const client = new WhipClient({
    endpoint: 'https://ingest.example.test/whip/live',
    token: options.token,
    stream: asMediaStream(stream),
    tracks: stream.getTracks() as unknown as MediaStreamTrack[],
    format: options.format,
    RTCPeerConnectionCtor: asPeerConnectionCtor(FakePeerConnection),
    fetch: fake.fetch,
    iceGatheringTimeoutMs: 10,
  });
  return { client, fake, stream };
}

describe('WhipClient.publish', () => {
  beforeEach(() => {
    FakePeerConnection.reset();
  });

  it('POSTs the offer SDP with the WHIP content type and applies the answer', async () => {
    const { client, fake } = build();
    await client.publish();

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://ingest.example.test/whip/live');
    expect(call.headers['Content-Type']).toBe('application/sdp');
    expect(call.body).toContain('v=0');

    const pc = FakePeerConnection.instances[0]!;
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: FAKE_ANSWER_SDP });
  });

  it('sends a bearer token when one is configured and omits the header otherwise', async () => {
    const withToken = build(undefined, { token: 'super-secret' });
    await withToken.client.publish();
    expect(withToken.fake.calls[0]!.headers.Authorization).toBe('Bearer super-secret');

    FakePeerConnection.reset();
    const without = build();
    await without.client.publish();
    expect(without.fake.calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('creates sendonly transceivers for each published track', async () => {
    const { client } = build();
    await client.publish();
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.transceivers).toHaveLength(2);
    for (const transceiver of pc.transceivers) {
      expect((transceiver.init as { direction: string }).direction).toBe('sendonly');
    }
  });

  it('offers sendonly video+audio m-lines even with no live tracks', async () => {
    const fake = createFakeFetch();
    const client = new WhipClient({
      endpoint: 'https://ingest.example.test/whip/live',
      tracks: [],
      RTCPeerConnectionCtor: asPeerConnectionCtor(FakePeerConnection),
      fetch: fake.fetch,
      iceGatheringTimeoutMs: 10,
    });
    await client.publish();
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.transceivers.map((t) => t.trackOrKind)).toEqual(['video', 'audio']);
  });

  it('records the resource URL from a relative Location header', async () => {
    const { client } = build();
    await client.publish();
    expect(client.resourceUrl).toBe('https://ingest.example.test/whip/resource/1');
  });

  it('detects PATCH ICE restart support from Accept-Patch', async () => {
    const { client } = build();
    await client.publish();
    expect(client.supportsIceRestart).toBe(true);

    FakePeerConnection.reset();
    const noPatch = build(() => ({ status: 201, body: FAKE_ANSWER_SDP, headers: { Location: '/r/2' } }));
    await noPatch.client.publish();
    expect(noPatch.client.supportsIceRestart).toBe(false);
  });

  it('caps the video sender bitrate from the format', async () => {
    const { client } = build(undefined, { format: FORMAT });
    await client.publish();
    const pc = FakePeerConnection.instances[0]!;
    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
    expect(videoSender?.parameters.encodings?.[0]?.maxBitrate).toBe(4_500_000);
    expect(videoSender?.parameters.encodings?.[0]?.maxFramerate).toBe(30);
  });

  it('parses advertised ICE servers from Link headers', async () => {
    const { client } = build(() => ({
      status: 201,
      body: FAKE_ANSWER_SDP,
      headers: {
        Location: '/r/3',
        Link: '<turn:turn.example.test:3478>; rel="ice-server"; username="u"; credential="p"',
      },
    }));
    await client.publish();
    expect(client.advertisedIceServers).toEqual([
      { urls: 'turn:turn.example.test:3478', username: 'u', credential: 'p' },
    ]);
  });

  it('emits negotiated then connected when ICE comes up', async () => {
    const events: string[] = [];
    const { client } = build();
    client.on('negotiated', () => events.push('negotiated'));
    client.on('connected', () => events.push('connected'));
    await client.publish();
    expect(events).toEqual(['negotiated']);

    FakePeerConnection.instances[0]!.simulateConnected();
    expect(events).toEqual(['negotiated', 'connected']);
  });

  it('emits connected only once', async () => {
    let count = 0;
    const { client } = build();
    client.on('connected', () => {
      count += 1;
    });
    await client.publish();
    const pc = FakePeerConnection.instances[0]!;
    pc.simulateConnected();
    pc.simulateConnected();
    expect(count).toBe(1);
  });

  it('emits disconnected with INGEST_DISCONNECTED when ICE fails', async () => {
    const seen: Array<{ reason: string; code: string }> = [];
    const { client } = build();
    client.on('disconnected', (payload) => seen.push(payload));
    await client.publish();
    FakePeerConnection.instances[0]!.simulateFailed('failed');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.code).toBe('INGEST_DISCONNECTED');
    expect(seen[0]!.reason).toContain('failed');
  });

  it('throws a WhipError with status 401 for an unauthorised endpoint', async () => {
    const { client } = build(() => ({ status: 401, body: 'bad token' }));
    await expect(client.publish()).rejects.toBeInstanceOf(WhipError);

    FakePeerConnection.reset();
    const second = build(() => ({ status: 401, body: 'bad token' }));
    const error = await second.client.publish().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WhipError);
    const whipError = error as WhipError;
    expect(whipError.status).toBe(401);
    expect(whipError.code).toBe('INGEST_INVALID_KEY');
    expect(whipError.message).toContain('401');
  });

  it('maps other HTTP failures to honest error codes', async () => {
    const cases: Array<[number, string]> = [
      [403, 'INGEST_INVALID_KEY'],
      [404, 'INGEST_REFUSED'],
      [429, 'RATE_LIMITED'],
      [500, 'PLATFORM_ERROR'],
      [503, 'PLATFORM_ERROR'],
    ];
    for (const [status, code] of cases) {
      FakePeerConnection.reset();
      const { client } = build(() => ({ status }));
      const error = (await client.publish().catch((err: unknown) => err)) as WhipError;
      expect(error.status).toBe(status);
      expect(error.code).toBe(code);
    }
  });

  it('fails when the server returns 201 without an SDP answer', async () => {
    const { client } = build(() => ({ status: 201, body: '', headers: { Location: '/r/4' } }));
    const error = (await client.publish().catch((err: unknown) => err)) as WhipError;
    expect(error.code).toBe('INGEST_REFUSED');
    expect(error.message).toContain('no SDP answer');
  });

  it('reports an unreachable endpoint as NETWORK_OFFLINE', async () => {
    const client = new WhipClient({
      endpoint: 'https://ingest.example.test/whip/live',
      tracks: [],
      RTCPeerConnectionCtor: asPeerConnectionCtor(FakePeerConnection),
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
      iceGatheringTimeoutMs: 10,
    });
    const error = (await client.publish().catch((err: unknown) => err)) as WhipError;
    expect(error.code).toBe('NETWORK_OFFLINE');
    expect(error.status).toBeUndefined();
  });

  it('rejects a non-http endpoint before touching the network', async () => {
    const fake = createFakeFetch();
    const client = new WhipClient({
      endpoint: 'rtmp://live.example.test/app',
      tracks: [],
      RTCPeerConnectionCtor: asPeerConnectionCtor(FakePeerConnection),
      fetch: fake.fetch,
    });
    const error = (await client.publish().catch((err: unknown) => err)) as WhipError;
    expect(error.code).toBe('CONFIG_INVALID');
    expect(fake.calls).toHaveLength(0);
  });

  it('falls back to partial candidates when ICE gathering does not complete', async () => {
    const { client, fake } = build();
    // Force a gathering wait: the fake starts "complete", so flip it first.
    FakePeerConnection.prototype.iceGatheringState = 'gathering';
    try {
      await client.publish();
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]!.body).toContain('a=candidate');
    } finally {
      FakePeerConnection.prototype.iceGatheringState = 'complete';
    }
  });
});

describe('WhipClient lifecycle', () => {
  beforeEach(() => {
    FakePeerConnection.reset();
  });

  it('DELETEs the resource and closes the peer connection', async () => {
    const { client, fake } = build();
    await client.publish();
    await client.close();

    const del = fake.calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('https://ingest.example.test/whip/resource/1');
    expect(FakePeerConnection.instances[0]!.closed).toBe(true);
    expect(client.isClosed).toBe(true);
  });

  it('close is idempotent and emits disconnected once', async () => {
    let count = 0;
    const { client } = build();
    client.on('disconnected', () => {
      count += 1;
    });
    await client.publish();
    await client.close();
    await client.close();
    expect(count).toBe(1);
  });

  it('stops emitting disconnected for ICE changes after close', async () => {
    let count = 0;
    const { client } = build();
    await client.publish();
    client.on('disconnected', () => {
      count += 1;
    });
    await client.close();
    FakePeerConnection.instances[0]!.simulateFailed('disconnected');
    expect(count).toBe(1);
  });

  it('refuses to publish after close', async () => {
    const { client } = build();
    await client.publish();
    await client.close();
    await expect(client.publish()).rejects.toBeInstanceOf(WhipError);
  });

  it('PATCHes an ICE restart only when the server advertised support', async () => {
    const { client, fake } = build();
    await client.publish();
    const restarted = await client.restartIce();
    expect(restarted).toBe(true);
    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['Content-Type']).toBe('application/trickle-ice-sdpfrag');
    expect(patch?.body).toContain('a=ice-ufrag:');
    expect(FakePeerConnection.instances[0]!.offerOptions).toContainEqual({ iceRestart: true });
  });

  it('declines an ICE restart when Accept-Patch was absent', async () => {
    const { client, fake } = build(() => ({ status: 201, body: FAKE_ANSWER_SDP, headers: { Location: '/r/9' } }));
    await client.publish();
    expect(await client.restartIce()).toBe(false);
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('reports a failed PATCH as unsupported so the caller reconnects from scratch', async () => {
    const { client } = build((call) =>
      call.method === 'PATCH'
        ? { status: 500 }
        : { status: 201, body: FAKE_ANSWER_SDP, headers: { Location: '/r/1', 'Accept-Patch': 'application/trickle-ice-sdpfrag' } },
    );
    await client.publish();
    expect(await client.restartIce()).toBe(false);
  });

  it('returns stats from the peer connection and null when there is none', async () => {
    const { client } = build();
    expect(await client.getStats()).toBeNull();
    await client.publish();
    FakePeerConnection.instances[0]!.setStats({ a: { type: 'outbound-rtp', kind: 'video', bytesSent: 10 } });
    const stats = await client.getStats();
    expect(stats).not.toBeNull();
  });
});

describe('WHIP helpers', () => {
  it('codeForStatus maps status families', () => {
    expect(codeForStatus(401)).toBe('INGEST_INVALID_KEY');
    expect(codeForStatus(408)).toBe('INGEST_TIMEOUT');
    expect(codeForStatus(418)).toBe('INGEST_REFUSED');
    expect(codeForStatus(502)).toBe('PLATFORM_ERROR');
    expect(codeForStatus(200)).toBe('UNKNOWN');
  });

  it('resolveLocation handles absolute, relative and missing headers', () => {
    expect(resolveLocation('https://other.test/r/1', 'https://a.test/whip')).toBe('https://other.test/r/1');
    expect(resolveLocation('/r/2', 'https://a.test/whip/live')).toBe('https://a.test/r/2');
    expect(resolveLocation(null, 'https://a.test/whip')).toBeNull();
    expect(resolveLocation('://bad', 'not a url')).toBeNull();
  });

  it('buildIceFragment keeps only the ICE-relevant lines', () => {
    const fragment = buildIceFragment(
      ['v=0', 'a=group:BUNDLE 0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:0', 'a=ice-ufrag:u', 'a=ice-pwd:p', 'a=candidate:1 1 udp 1 1.2.3.4 1 typ host', 'a=sendonly'].join('\r\n'),
    );
    expect(fragment).toContain('m=video');
    expect(fragment).toContain('a=ice-ufrag:u');
    expect(fragment).toContain('a=candidate:');
    expect(fragment).not.toContain('a=group:BUNDLE');
    expect(fragment).not.toContain('a=sendonly');
  });

  it('buildIceFragment returns null for unusable SDP', () => {
    expect(buildIceFragment('')).toBeNull();
    expect(buildIceFragment('v=0\r\na=ice-ufrag:u')).toBeNull();
  });

  it('parseLinkIceServers ignores links that are not ice-server', () => {
    expect(parseLinkIceServers(null)).toEqual([]);
    expect(parseLinkIceServers('<https://a.test>; rel="next"')).toEqual([]);
    expect(parseLinkIceServers('<stun:stun.example.test:3478>; rel="ice-server"')).toEqual([
      { urls: 'stun:stun.example.test:3478' },
    ]);
  });

  it('makeResponse exposes headers case-insensitively', async () => {
    const response = makeResponse({ status: 201, body: 'x', headers: { Location: '/a' } });
    expect(response.headers.get('location')).toBe('/a');
    expect(response.headers.get('LOCATION')).toBe('/a');
    expect(await response.text()).toBe('x');
  });
});
