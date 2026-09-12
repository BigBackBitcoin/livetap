import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { TS_PACKET_SIZE, TsFanout } from './fanout.js';

/** A buffer of `count` well-formed 188-byte TS packets, each starting with the 0x47 sync byte. */
function tsPackets(count: number, fill = 0xa5): Buffer {
  const buffer = Buffer.alloc(count * TS_PACKET_SIZE, fill);
  for (let i = 0; i < count; i += 1) buffer[i * TS_PACKET_SIZE] = 0x47;
  return buffer;
}

/** Collect everything written to a PassThrough. */
function collector(): { stream: PassThrough; bytes: () => number; buffer: () => Buffer } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return {
    stream,
    bytes: () => chunks.reduce((total, c) => total + c.length, 0),
    buffer: () => Buffer.concat(chunks),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('TsFanout', () => {
  it('writes every byte to every sink, in order', async () => {
    const fanout = new TsFanout();
    const a = collector();
    const b = collector();
    const c = collector();
    fanout.addSink('a', a.stream);
    fanout.addSink('b', b.stream);
    fanout.addSink('c', c.stream);

    const data = tsPackets(30);
    // Feed it in awkward slices so chunk boundaries fall inside packets.
    for (let offset = 0; offset < data.length; offset += 97) {
      fanout.write(data.subarray(offset, Math.min(offset + 97, data.length)));
    }
    await flush();

    expect(a.bytes()).toBe(data.length);
    expect(b.bytes()).toBe(data.length);
    expect(c.bytes()).toBe(data.length);
    expect(a.buffer().equals(data)).toBe(true);
    expect(b.buffer().equals(data)).toBe(true);
  });

  it('only ever emits whole TS packets, so a late joiner starts aligned', async () => {
    const fanout = new TsFanout();
    const a = collector();
    fanout.addSink('a', a.stream);
    // 188 + 50 bytes: the 50-byte tail must be held back.
    fanout.write(tsPackets(1));
    fanout.write(Buffer.alloc(50, 1));
    await flush();
    expect(a.bytes()).toBe(TS_PACKET_SIZE);
    expect(a.bytes() % TS_PACKET_SIZE).toBe(0);
  });

  it('gives a sink attached mid-stream a packet-aligned start', async () => {
    const fanout = new TsFanout();
    const early = collector();
    fanout.addSink('early', early.stream);

    // Five whole packets, then the first 33 bytes of a sixth. The 33-byte fragment must be held in
    // the remainder rather than forwarded, because forwarding it would leave every later sink
    // permanently 33 bytes out of phase with the TS packet grid.
    const sixth = tsPackets(1, 0x31);
    fanout.write(tsPackets(5));
    fanout.write(sixth.subarray(0, 33));
    await flush();
    expect(early.bytes()).toBe(5 * TS_PACKET_SIZE);

    // A destination added right now must still start at a packet boundary.
    const late = collector();
    fanout.addSink('late', late.stream);
    fanout.write(sixth.subarray(33)); // completes the sixth packet
    fanout.write(tsPackets(4));
    await flush();

    expect(late.bytes() % TS_PACKET_SIZE).toBe(0);
    // The late sink's very first byte is a TS sync byte, so its ffmpeg can lock onto the stream.
    expect(late.buffer()[0]).toBe(0x47);
    expect(late.bytes()).toBe(5 * TS_PACKET_SIZE);
    expect(early.bytes()).toBe(10 * TS_PACKET_SIZE);
  });

  it('resyncs to the first sync byte if the stream starts misaligned', async () => {
    const fanout = new TsFanout();
    const a = collector();
    fanout.addSink('a', a.stream);
    fanout.write(Buffer.concat([Buffer.from([0x11, 0x22, 0x33]), tsPackets(2)]));
    await flush();
    expect(a.bytes()).toBe(2 * TS_PACKET_SIZE);
    expect(a.buffer()[0]).toBe(0x47);
  });

  it('a dead sink does not block the others (the whole point of this class)', async () => {
    const errors: Array<[string, string]> = [];
    const fanout = new TsFanout({ onSinkError: (id, error) => errors.push([id, error.message]) });
    const healthy = collector();
    // A sink whose write always fails, like a child whose stdin has closed (EPIPE).
    const broken = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('write EPIPE'));
      },
    });
    fanout.addSink('healthy', healthy.stream);
    fanout.addSink('broken', broken);

    fanout.write(tsPackets(4));
    await flush();
    fanout.write(tsPackets(4));
    await flush();

    expect(errors.map(([id]) => id)).toContain('broken');
    expect(fanout.has('broken')).toBe(false);
    expect(fanout.has('healthy')).toBe(true);
    expect(healthy.bytes()).toBe(8 * TS_PACKET_SIZE);
  });

  it('does not crash when a dead sink emits EPIPE after we stopped caring', async () => {
    // This is the exact bug found during verification: detaching the error listener let a late
    // async EPIPE become an unhandled 'error' event and take the whole main process down.
    const fanout = new TsFanout();
    const stream = new PassThrough();
    fanout.addSink('late-failer', stream);
    fanout.write(tsPackets(2));
    await flush();
    fanout.removeSink('late-failer');
    fanout.end();
    expect(() => stream.emit('error', new Error('write EPIPE'))).not.toThrow();
  });

  it('drops rather than buffering without bound when a sink stops draining', async () => {
    const drops: Array<[string, number]> = [];
    // Never call the write callback: simulate a sink whose socket is completely wedged.
    const wedged = new Writable({ write: () => undefined, highWaterMark: 1 });
    const fanout = new TsFanout({
      maxQueuedBytes: 4 * TS_PACKET_SIZE,
      onSinkDrop: (id, bytes) => drops.push([id, bytes]),
    });
    const healthy = collector();
    fanout.addSink('healthy', healthy.stream);
    fanout.addSink('wedged', wedged);

    // Flush between writes so the HEALTHY sink genuinely drains each time (its write callbacks are
    // asynchronous). Without this, even a healthy sink's queue counter would climb past the ceiling
    // and the test would prove nothing about which sink was at fault.
    for (let i = 0; i < 20; i += 1) {
      fanout.write(tsPackets(2));
      await flush();
    }

    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every(([id]) => id === 'wedged')).toBe(true);
    // The healthy sink got everything despite the wedged one.
    expect(healthy.bytes()).toBe(40 * TS_PACKET_SIZE);
    const stats = fanout.stats().find((s) => s.id === 'wedged');
    expect(stats?.bytesDropped).toBeGreaterThan(0);
    expect(fanout.worstDropPct()).toBeGreaterThan(0);
  });

  it('never pauses the source stream', async () => {
    const source = new PassThrough({ highWaterMark: 16 });
    const pause = vi.spyOn(source, 'pause');
    // A sink with a tiny watermark would normally cause a pipe() to pause the source.
    const slow = new Writable({ write: () => undefined, highWaterMark: 1 });
    const fanout = new TsFanout({ maxQueuedBytes: 2 * TS_PACKET_SIZE });
    fanout.addSink('slow', slow);
    fanout.attach(source);

    for (let i = 0; i < 10; i += 1) source.write(tsPackets(3));
    await flush();

    expect(pause).not.toHaveBeenCalled();
    expect(fanout.totalSourceBytes).toBe(30 * TS_PACKET_SIZE);
  });

  it('reports a sink that closes itself', async () => {
    const closed: string[] = [];
    const fanout = new TsFanout({ onSinkClosed: (id) => closed.push(id) });
    const stream = new PassThrough();
    fanout.addSink('gone', stream);
    stream.destroy();
    await flush();
    expect(closed).toEqual(['gone']);
    expect(fanout.sinkCount).toBe(0);
  });

  it('removeSink is idempotent and leaves siblings alone', async () => {
    const fanout = new TsFanout();
    const a = collector();
    const b = collector();
    fanout.addSink('a', a.stream);
    fanout.addSink('b', b.stream);
    expect(fanout.removeSink('a')).toBe(true);
    expect(fanout.removeSink('a')).toBe(false);
    fanout.write(tsPackets(2));
    await flush();
    expect(a.bytes()).toBe(0);
    expect(b.bytes()).toBe(2 * TS_PACKET_SIZE);
  });

  it('refuses to register the same sink id twice', () => {
    const fanout = new TsFanout();
    fanout.addSink('a', new PassThrough());
    expect(() => fanout.addSink('a', new PassThrough())).toThrow(/already exists/);
  });

  it('end() closes every sink so muxers can finalise their files', async () => {
    const fanout = new TsFanout();
    const a = new PassThrough();
    const b = new PassThrough();
    const ended: string[] = [];
    a.on('finish', () => ended.push('a'));
    b.on('finish', () => ended.push('b'));
    fanout.addSink('a', a);
    fanout.addSink('b', b);
    fanout.end();
    await flush();
    expect(ended.sort()).toEqual(['a', 'b']);
    expect(fanout.isEnded).toBe(true);
    // Writes after end are ignored rather than throwing.
    expect(() => fanout.write(tsPackets(1))).not.toThrow();
  });

  it('tracks per-sink byte counts for diagnostics', async () => {
    const fanout = new TsFanout();
    const a = collector();
    fanout.addSink('a', a.stream);
    fanout.write(tsPackets(7));
    await flush();
    const stats = fanout.stats();
    expect(stats).toHaveLength(1);
    expect(stats[0]?.bytesWritten).toBe(7 * TS_PACKET_SIZE);
    expect(stats[0]?.bytesDropped).toBe(0);
    expect(stats[0]?.alive).toBe(true);
    expect(fanout.worstDropPct()).toBe(0);
  });
});
