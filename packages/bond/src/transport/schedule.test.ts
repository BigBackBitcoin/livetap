import { describe, expect, it } from 'vitest';
import { BondScheduler } from './schedule.js';
import { Reassembler, type BondChunk } from './reassemble.js';
import type { BondDecision } from '../policy/decide.js';

function decision(
  active: { handle: string; share: number; standby?: boolean }[],
  redundancy: BondDecision['redundancy'] = 'none',
): BondDecision {
  return {
    mode: 'aggregated',
    active: active.map((a) => ({ handle: a.handle, share: a.share, standby: a.standby ?? false })),
    redundancy,
    targetHeadroomBps: 0,
    usableCapacityBps: 10_000_000,
    health: 'protected',
    encoderCeilingBps: 6_000_000,
    reason: 'test',
  };
}

/** A realistic GOP: one big keyframe, then small inter-frames, with audio interleaved. */
function* mediaStream(count: number): Generator<BondChunk> {
  for (let i = 0; i < count; i += 1) {
    const isKey = i % 60 === 0;
    yield {
      seq: i,
      timestampUs: i * 16_666,
      frameType: isKey ? 'key' : i % 3 === 0 ? 'audio' : 'inter',
      bytes: isKey ? 40_000 : i % 3 === 0 ? 400 : 2_000,
    };
  }
}

describe('weighted distribution', () => {
  it('splits by bytes, not by chunk count', () => {
    /*
     * The defect this test exists for: chunks are not uniform. A keyframe can be twenty times the
     * size of the inter-frames around it, so alternating paths by COUNT produces wildly wrong
     * proportions by BYTES - and bytes are the only unit a network cares about.
     */
    const s = new BondScheduler(decision([{ handle: 'wifi', share: 0.7 }, { handle: 'cell', share: 0.3 }]));
    for (const chunk of mediaStream(600)) s.assign(chunk);

    const realised = s.realisedShares();
    expect(realised.wifi).toBeGreaterThan(0.66);
    expect(realised.wifi).toBeLessThan(0.74);
    expect(realised.cell).toBeGreaterThan(0.26);
    expect(realised.cell).toBeLessThan(0.34);
  });

  it('holds the split across very uneven chunk sizes', () => {
    const s = new BondScheduler(decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }]));
    // Alternating tiny and enormous: the worst case for a count-based scheduler.
    for (let i = 0; i < 400; i += 1) {
      s.assign({ seq: i, timestampUs: i, frameType: 'inter', bytes: i % 2 === 0 ? 100 : 50_000 });
    }
    const realised = s.realisedShares();
    expect(Math.abs(realised.a! - 0.5)).toBeLessThan(0.05);
  });

  it('self-corrects after a large frame instead of carrying the error forward', () => {
    const s = new BondScheduler(decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }]));
    s.assign({ seq: 0, timestampUs: 0, frameType: 'key', bytes: 100_000 });
    // One path is now 100 KB ahead. The next frames must go to the other one until it catches up.
    const next: string[] = [];
    for (let i = 1; i < 40; i += 1) {
      next.push(...s.assign({ seq: i, timestampUs: i, frameType: 'inter', bytes: 2_000 }).paths);
    }
    const first = s.stats().bytesByPath;
    expect(Math.abs((first.a ?? 0) - (first.b ?? 0))).toBeLessThan(100_000);
    expect(new Set(next).size).toBe(1);
  });

  it('sends everything one way when there is only one path', () => {
    const s = new BondScheduler(decision([{ handle: 'only', share: 1 }]));
    for (const chunk of mediaStream(100)) {
      expect(s.assign(chunk).paths).toEqual(['only']);
    }
    expect(s.stats().duplicatedChunks).toBe(0);
  });

  it('never sends media down a standby path', () => {
    // Standby carries probes. A creator who said "do not spend my data" must not find media on
    // the cellular path because the scheduler counted it as available.
    const s = new BondScheduler(
      decision([{ handle: 'wifi', share: 1 }, { handle: 'cell', share: 0, standby: true }], 'keyframe'),
    );
    for (const chunk of mediaStream(200)) {
      expect(s.assign(chunk).paths).not.toContain('cell');
    }
    expect(s.stats().bytesByPath.cell).toBeUndefined();
  });

  it('reports honestly that it has nowhere to send a chunk', () => {
    // Every path failed at once. A scheduler that pretended to place the chunk would make it
    // vanish silently, which is the one outcome the caller cannot detect or recover from.
    const s = new BondScheduler(decision([]));
    const result = s.assign({ seq: 0, timestampUs: 0, frameType: 'key', bytes: 1000 });
    expect(result.paths).toEqual([]);
  });
});

describe('redundancy', () => {
  it('duplicates keyframes and audio, and nothing else', () => {
    const s = new BondScheduler(
      decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }], 'keyframe'),
    );
    for (const chunk of mediaStream(180)) {
      const result = s.assign(chunk);
      if (chunk.frameType === 'key' || chunk.frameType === 'audio') {
        expect(result.paths).toHaveLength(2);
        expect(result.duplicated).toBe(true);
      } else {
        expect(result.paths).toHaveLength(1);
      }
    }
  });

  it('puts the copy on a different path from the original', () => {
    // The failure being insured against is a path dying. Two copies down one path protect against
    // nothing at all.
    const s = new BondScheduler(
      decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }], 'keyframe'),
    );
    for (const chunk of mediaStream(240)) {
      const result = s.assign(chunk);
      if (result.duplicated) expect(new Set(result.paths).size).toBe(2);
    }
  });

  it('refuses to duplicate when there is only one path to duplicate onto', () => {
    const s = new BondScheduler(decision([{ handle: 'only', share: 1 }], 'full'));
    for (const chunk of mediaStream(60)) expect(s.assign(chunk).paths).toHaveLength(1);
    expect(s.stats().redundantBytes).toBe(0);
  });

  it('states what redundancy cost, so the creator could be told', () => {
    const s = new BondScheduler(
      decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }], 'keyframe'),
    );
    for (const chunk of mediaStream(120)) s.assign(chunk);
    expect(s.stats().redundantBytes).toBeGreaterThan(0);
    const totalSent = Object.values(s.stats().bytesByPath).reduce((sum, b) => sum + b, 0);
    expect(s.stats().redundantBytes).toBeLessThan(totalSent);
  });
});

describe('reallocation', () => {
  it('keeps the fairness it had built up for paths that survive a change', () => {
    // Resetting on every decision makes the shares wrong for a while after each reallocation, and
    // reallocations happen exactly when the stream can least afford to be misrouted.
    const s = new BondScheduler(decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }]));
    for (let i = 0; i < 100; i += 1) s.assign({ seq: i, timestampUs: i, frameType: 'inter', bytes: 2000 });

    s.update(decision([{ handle: 'a', share: 0.8 }, { handle: 'b', share: 0.2 }]));
    for (let i = 100; i < 1100; i += 1) s.assign({ seq: i, timestampUs: i, frameType: 'inter', bytes: 2000 });

    // The tail dominates, so the realised split should be close to the new weights.
    const realised = s.realisedShares();
    expect(realised.a).toBeGreaterThan(0.7);
  });

  it('drops a path that has left, immediately', () => {
    const s = new BondScheduler(decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }]));
    for (let i = 0; i < 50; i += 1) s.assign({ seq: i, timestampUs: i, frameType: 'inter', bytes: 2000 });

    s.update(decision([{ handle: 'a', share: 1 }]));
    for (let i = 50; i < 100; i += 1) {
      expect(s.assign({ seq: i, timestampUs: i, frameType: 'inter', bytes: 2000 }).paths).toEqual(['a']);
    }
  });
});

describe('scheduler and reassembler together', () => {
  it('reconstructs the exact stream after striping it across paths with different delays', () => {
    /*
     * The end-to-end property the whole transport exists for. Media goes out across two paths with
     * very different latencies, arrives interleaved and out of order, and has to come back as the
     * original sequence with nothing missing and nothing repeated.
     */
    const s = new BondScheduler(decision([{ handle: 'fast', share: 0.6 }, { handle: 'slow', share: 0.4 }]));
    const r = new Reassembler({ deadlineMs: 400 });

    const delays: Record<string, number> = { fast: 20, slow: 180 };
    const inFlight: { chunk: BondChunk; arriveAt: number }[] = [];

    let sentAt = 0;
    const original: number[] = [];
    for (const chunk of mediaStream(300)) {
      original.push(chunk.seq);
      const assignment = s.assign(chunk);
      for (const path of assignment.paths) {
        inFlight.push({ chunk, arriveAt: sentAt + delays[path]! });
      }
      sentAt += 16;
    }

    // Deliver in arrival order, which is NOT send order.
    inFlight.sort((a, b) => a.arriveAt - b.arriveAt || a.chunk.seq - b.chunk.seq);
    const received: number[] = [];
    for (const packet of inFlight) {
      received.push(...r.push(packet.chunk, packet.arriveAt).map((c) => c.seq));
    }
    received.push(...r.flush(sentAt + 1000).map((c) => c.seq));

    expect(received).toEqual(original);
    expect(r.stats().lost).toBe(0);
  });

  it('survives one path dying mid-stream, losing only what was in flight on it', () => {
    const s = new BondScheduler(decision([{ handle: 'a', share: 0.5 }, { handle: 'b', share: 0.5 }]));
    const r = new Reassembler({ deadlineMs: 200 });

    const arrivals: { chunk: BondChunk; at: number }[] = [];
    let t = 0;
    for (const chunk of mediaStream(200)) {
      const assignment = s.assign(chunk);
      for (const path of assignment.paths) {
        // Path b stops delivering entirely after chunk 100.
        if (path === 'b' && chunk.seq >= 100) continue;
        arrivals.push({ chunk, at: t + 30 });
      }
      t += 16;
    }

    arrivals.sort((a, b) => a.at - b.at || a.chunk.seq - b.chunk.seq);
    const received: number[] = [];
    for (const packet of arrivals) received.push(...r.push(packet.chunk, packet.at).map((c) => c.seq));
    received.push(...r.flush(t + 5000).map((c) => c.seq));

    // Everything that arrived came out in order, exactly once, and the hole is reported.
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(new Set(received).size).toBe(received.length);
    expect(r.stats().lost).toBeGreaterThan(0);
    // And the surviving path's chunks after the failure still got through.
    expect(received.filter((seq) => seq >= 100).length).toBeGreaterThan(0);
  });
});
