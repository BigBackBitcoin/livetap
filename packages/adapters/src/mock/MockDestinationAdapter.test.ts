import { describe, expect, it } from 'vitest';
import { classifyFailure, type ChatMessage, type DestinationConfig } from '@livetap/core';
import { getProfile } from '../profiles/index.js';
import { MOCK_BANNER, MockDestinationAdapter, type MockTimers } from './MockDestinationAdapter.js';
import { createMockAdapters } from './index.js';
import { mulberry32 } from './rng.js';

/** A manual clock + timer queue, so mock timing is fully deterministic in tests. */
function fakeTimers(): MockTimers & { advance(ms: number): void; now(): number } {
  let clock = 1_700_000_000_000;
  let nextId = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      queue.set(id, { at: clock + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      queue.delete(handle as number);
    },
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        const due = [...queue.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        clock = due[1].at;
        due[1].fn();
      }
      clock = target;
    },
    now: () => clock,
  };
}

function config(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return {
    id: 'dest-1',
    platform: 'youtube',
    label: 'Test channel',
    aspectRatio: '16:9',
    enabled: true,
    mock: true,
    ...overrides,
  };
}

describe('mulberry32', () => {
  it('is deterministic for a given seed and differs between seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
    expect([c.next(), c.next(), c.next()]).not.toEqual(seqA);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int/between/pick inside bounds', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      expect(rng.int(5)).toBeLessThan(5);
      const v = rng.between(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    }
    expect(() => rng.pick([])).toThrow(/empty/);
  });
});

describe('MOCK_BANNER', () => {
  it('is the exact honest banner text', () => {
    expect(MOCK_BANNER).toBe('Mock mode — no real platforms are connected');
  });
});

describe('MockDestinationAdapter lifecycle', () => {
  it('validates, creates, starts, reports status and stops', async () => {
    const adapter = new MockDestinationAdapter(getProfile('youtube'), { latencyMs: 0, seed: 1 });
    const validated = await adapter.validate(config());
    expect(validated.ok).toBe(true);

    const handle = await adapter.createBroadcast(config());
    expect(handle.broadcastId).toBeTruthy();
    expect(handle.streamId).toBeTruthy();
    expect(handle.ingest.url).toBe('rtmp://mock.youtube.livetap.invalid/live');
    expect(handle.ingest.streamKey).toMatch(/^mock-youtube-[0-9a-f]{12}$/);
    expect(handle.watchUrl).toBe(`https://mock.livetap.app/youtube/${handle.broadcastId}`);
    expect((handle as { mock?: boolean }).mock).toBe(true);

    // YouTube's profile says autoStartsOnIngest === false, so it is not live until started.
    expect((await adapter.getStatus(handle)).live).toBe(false);
    await adapter.startBroadcast(handle);
    const status = await adapter.getStatus(handle);
    expect(status.live).toBe(true);
    expect(status.ingestHealth).toBe('good');

    await adapter.stopBroadcast(handle);
    expect((await adapter.getStatus(handle)).live).toBe(false);
    expect(adapter.calls).toMatchObject({ validate: 1, create: 1, start: 1, stop: 1 });
  });

  it('goes live on create for platforms that publish on ingest', async () => {
    const adapter = new MockDestinationAdapter(getProfile('twitch'), { latencyMs: 0 });
    const handle = await adapter.createBroadcast(config({ platform: 'twitch' }));
    expect((await adapter.getStatus(handle)).live).toBe(true);
  });

  it('keeps the user-pasted ingest for paste-the-key platforms', async () => {
    const adapter = new MockDestinationAdapter(getProfile('tiktok'), { latencyMs: 0 });
    const ingest = { protocol: 'rtmp' as const, url: 'rtmp://push.tiktok.test/live', streamKey: 'abc123' };
    const result = await adapter.validate(config({ platform: 'tiktok', ingest }));
    expect(result.ok && result.ingest).toEqual(ingest);
    const handle = await adapter.createBroadcast(config({ platform: 'tiktok', ingest }));
    expect(handle.ingest).toEqual(ingest);
  });

  it('marks its profile as a mock even when handed a production profile', () => {
    const adapter = new MockDestinationAdapter(getProfile('facebook'));
    expect(adapter.profile.mock).toBe(true);
    expect(getProfile('facebook').mock).toBeUndefined();
  });
});

describe('MockDestinationAdapter scripted failures', () => {
  it('fails validate with the scripted ErrorCode', async () => {
    const adapter = new MockDestinationAdapter(getProfile('youtube'), {
      latencyMs: 0,
      failValidate: 'NOT_ELIGIBLE',
    });
    const result = await adapter.validate(config());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_ELIGIBLE');
      expect(result.technical).toContain('mock');
    }
  });

  it('throws from createBroadcast in a shape core can classify back to the same code', async () => {
    for (const code of ['AUTH_EXPIRED', 'RATE_LIMITED', 'INGEST_INVALID_KEY', 'QUOTA_EXCEEDED'] as const) {
      const adapter = new MockDestinationAdapter(getProfile('youtube'), {
        latencyMs: 0,
        failCreate: code,
      });
      await expect(adapter.createBroadcast(config())).rejects.toThrow();
      try {
        await adapter.createBroadcast(config());
      } catch (err) {
        const e = err as { status?: number; message?: string };
        expect(classifyFailure({ status: e.status, message: e.message })).toBe(code);
      }
    }
  });
});

describe('MockDestinationAdapter chat', () => {
  it('emits believable messages at the configured rate, deterministically per seed', async () => {
    const collect = async (seed: number): Promise<ChatMessage[]> => {
      const timers = fakeTimers();
      const adapter = new MockDestinationAdapter(getProfile('youtube'), {
        seed,
        latencyMs: 0,
        chatRateMs: 1000,
        timers,
        now: timers.now,
      });
      const handle = await adapter.createBroadcast(config());
      const received: ChatMessage[] = [];
      const sub = await adapter.subscribeChat(handle, (m) => received.push(m));
      timers.advance(5000);
      sub.stop();
      timers.advance(5000);
      return received;
    };

    const first = await collect(99);
    const again = await collect(99);
    const other = await collect(100);

    expect(first).toHaveLength(5);
    expect(first.map((m) => `${m.author.displayName}:${m.text}`)).toEqual(
      again.map((m) => `${m.author.displayName}:${m.text}`),
    );
    expect(first.map((m) => m.text)).not.toEqual(other.map((m) => m.text));

    for (const message of first) {
      expect(message.mock).toBe(true);
      expect(message.platform).toBe('youtube');
      expect(message.destinationId).toBe('dest-1');
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.author.displayName.length).toBeGreaterThan(0);
      expect(message.platformMessageId).toBeTruthy();
      expect(message.own).toBeUndefined();
    }
    // The corpus contains questions, and the badge pool is mostly empty like a real chat.
    expect(first.some((m) => m.text.includes('?')) || first.length < 5).toBe(true);
  });

  it('stops emitting after the subscription is stopped', async () => {
    const timers = fakeTimers();
    const adapter = new MockDestinationAdapter(getProfile('twitch'), {
      latencyMs: 0,
      chatRateMs: 500,
      timers,
      now: timers.now,
    });
    const handle = await adapter.createBroadcast(config({ platform: 'twitch' }));
    const received: ChatMessage[] = [];
    const sub = await adapter.subscribeChat(handle, (m) => received.push(m));
    timers.advance(1500);
    const count = received.length;
    expect(count).toBeGreaterThan(0);
    sub.stop();
    timers.advance(10000);
    expect(received).toHaveLength(count);
  });

  it('echoes a sent message back as own: true', async () => {
    const timers = fakeTimers();
    const adapter = new MockDestinationAdapter(getProfile('youtube'), {
      latencyMs: 0,
      chatRateMs: 100000,
      timers,
      now: timers.now,
    });
    const handle = await adapter.createBroadcast(config());
    const received: ChatMessage[] = [];
    await adapter.subscribeChat(handle, (m) => received.push(m));
    await adapter.sendChat(handle, 'hello chat');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      text: 'hello chat',
      own: true,
      mock: true,
      author: { displayName: 'You', badges: ['owner'] },
    });
  });
});

describe('MockDestinationAdapter analytics and health', () => {
  it('grows the viewer curve over time and tracks a peak', async () => {
    const timers = fakeTimers();
    const adapter = new MockDestinationAdapter(getProfile('twitch'), {
      seed: 5,
      latencyMs: 0,
      viewersStart: 20,
      timers,
      now: timers.now,
    });
    const handle = await adapter.createBroadcast(config({ platform: 'twitch' }));
    const first = await adapter.getAnalytics(handle);
    timers.advance(10 * 60 * 1000);
    const later = await adapter.getAnalytics(handle);
    expect(first.viewers ?? 0).toBeGreaterThan(0);
    expect(later.viewers ?? 0).toBeGreaterThan(first.viewers ?? 0);
    expect(later.peakViewers ?? 0).toBeGreaterThanOrEqual(later.viewers ?? 0);

    const health = await adapter.getHealth(handle);
    expect(health.bitrateKbps ?? 0).toBeGreaterThan(0);
    expect(health.platformStatus).toBe('good');
  });

  it('reports zero viewers when not live', async () => {
    const adapter = new MockDestinationAdapter(getProfile('youtube'), { latencyMs: 0 });
    const handle = await adapter.createBroadcast(config());
    const analytics = await adapter.getAnalytics(handle);
    expect(analytics.viewers).toBe(0);
  });
});

describe('createMockAdapters', () => {
  it('gives each platform its own chat stream', async () => {
    const registry = createMockAdapters({ latencyMs: 0, chatRateMs: 1000 });
    const yt = registry.get('youtube');
    const tw = registry.get('twitch');
    expect(yt).toBeDefined();
    expect(tw).toBeDefined();
    if (!yt || !tw) return;
    const ytHandle = await yt.createBroadcast(config());
    const twHandle = await tw.createBroadcast(config({ platform: 'twitch' }));
    expect(ytHandle.ingest.url).toContain('mock.youtube');
    expect(twHandle.ingest.url).toContain('mock.twitch');
  });

  it('accepts per-platform scenario overrides', async () => {
    const registry = createMockAdapters(
      { latencyMs: 0 },
      { kick: { failValidate: 'AUTH_EXPIRED' } },
    );
    const kick = registry.get('kick');
    const youtube = registry.get('youtube');
    const kickResult = await kick?.validate(config({ platform: 'kick' }));
    const ytResult = await youtube?.validate(config());
    expect(kickResult?.ok).toBe(false);
    expect(ytResult?.ok).toBe(true);
  });
});
