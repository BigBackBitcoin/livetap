import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REASSEMBLE,
  Reassembler,
  recommendedDeadlineMs,
  type BondChunk,
} from './reassemble.js';

function chunk(seq: number, frameType: BondChunk['frameType'] = 'inter'): BondChunk {
  return { seq, timestampUs: seq * 33_333, frameType, bytes: 1200 };
}

/** Sequence numbers of whatever came out, for readable assertions. */
function seqs(chunks: BondChunk[]): number[] {
  return chunks.map((c) => c.seq);
}

describe('in order', () => {
  it('passes a clean stream straight through with no delay', () => {
    const r = new Reassembler();
    const out: number[] = [];
    for (let i = 0; i < 10; i += 1) out.push(...seqs(r.push(chunk(i), i * 33)));
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.depth).toBe(0);
    expect(r.stats().lost).toBe(0);
    expect(r.stats().maxHeldMs).toBe(0);
  });

  it('does not assume the stream starts at zero', () => {
    // A receiver joining a broadcast in progress, or one whose first packet was the lost one,
    // must not spend the session waiting for a chunk that was never coming.
    const r = new Reassembler();
    expect(seqs(r.push(chunk(5000), 0))).toEqual([5000]);
    expect(seqs(r.push(chunk(5001), 10))).toEqual([5001]);
    expect(r.stats().lost).toBe(0);
  });
});

describe('out of order', () => {
  it('holds an early arrival until the one before it turns up', () => {
    // The defining case: a fast Wi-Fi packet overtakes a slow cellular one.
    const r = new Reassembler();
    expect(seqs(r.push(chunk(0), 0))).toEqual([0]);
    expect(seqs(r.push(chunk(2), 10))).toEqual([]);
    expect(r.depth).toBe(1);
    expect(seqs(r.push(chunk(1), 20))).toEqual([1, 2]);
    expect(r.depth).toBe(0);
    expect(r.stats().lost).toBe(0);
  });

  it('reassembles a badly shuffled burst into the right order', () => {
    const r = new Reassembler();
    const out: number[] = [];
    for (const seq of [0, 4, 2, 1, 6, 3, 5]) out.push(...seqs(r.push(chunk(seq), 0)));
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.stats().lost).toBe(0);
  });

  it('records how long bonding actually cost, rather than assuming', () => {
    const r = new Reassembler();
    r.push(chunk(0), 0);
    r.push(chunk(2), 10);
    r.push(chunk(1), 150);
    // Chunk 2 waited from 10 to 150 to be released behind chunk 1. That delay is the price paid
    // for letting the slow path contribute, and the product has to be able to state it.
    expect(r.stats().maxHeldMs).toBe(140);
  });
});

describe('loss', () => {
  it('gives up on a missing chunk once its deadline passes, and says so', () => {
    const r = new Reassembler({ deadlineMs: 200 });
    r.push(chunk(0), 0);
    expect(seqs(r.push(chunk(2), 10))).toEqual([]);

    // Not yet: the missing chunk may still be in flight on a slow path.
    expect(seqs(r.drain(100))).toEqual([]);
    expect(r.depth).toBe(1);

    // Now. Waiting longer would convert one damaged frame into a stream freeze.
    expect(seqs(r.drain(300))).toEqual([2]);
    expect(r.stats().lost).toBe(1);
  });

  it('never stalls forever on a chunk that is not coming', () => {
    const r = new Reassembler({ deadlineMs: 100 });
    r.push(chunk(0), 0);
    r.push(chunk(5), 0);
    const released = seqs(r.drain(1000));
    expect(released).toEqual([5]);
    expect(r.stats().lost).toBe(4);
    expect(r.depth).toBe(0);
  });

  it('skips a whole run of lost chunks in one deadline, not one deadline each', () => {
    // A cellular path dropping for a second loses a run. Walking that run one deadline at a time
    // would add a full deadline of delay per lost chunk, turning a blip into seconds of lag.
    const r = new Reassembler({ deadlineMs: 200 });
    r.push(chunk(0), 0);
    r.push(chunk(50), 10);
    r.push(chunk(51), 10);
    const released = seqs(r.drain(300));
    expect(released).toEqual([50, 51]);
    expect(r.stats().lost).toBe(49);
  });

  it('counts a straggler that arrives after its gap was written off', () => {
    const r = new Reassembler({ deadlineMs: 100 });
    r.push(chunk(0), 0);
    r.push(chunk(2), 0);
    r.drain(200);
    // Chunk 1 finally arrives. It is far too late to be useful, and emitting it now would hand
    // the decoder a frame from the past.
    expect(seqs(r.push(chunk(1), 250))).toEqual([]);
    expect(r.stats().tooLate).toBe(1);
  });
});

describe('duplicates', () => {
  it('treats a second copy as success, not as an anomaly', () => {
    // Keyframe redundancy deliberately sends the same chunk two ways. The second copy arriving is
    // the feature working.
    const r = new Reassembler();
    expect(seqs(r.push(chunk(0, 'key'), 0))).toEqual([0]);
    expect(seqs(r.push(chunk(0, 'key'), 5))).toEqual([]);
    expect(r.stats().duplicates).toBe(1);
    expect(r.stats().emitted).toBe(1);
  });

  it('lets the second copy fill a gap when the first never arrived', () => {
    // This is the entire point of duplication: the copy that got through is the one that counts.
    const r = new Reassembler({ deadlineMs: 500 });
    r.push(chunk(0), 0);
    r.push(chunk(2), 10);
    // Chunk 1's first copy was lost on Wi-Fi; its duplicate arrives over cellular, in time.
    expect(seqs(r.push(chunk(1, 'key'), 120))).toEqual([1, 2]);
    expect(r.stats().lost).toBe(0);
  });

  it('ignores a duplicate of something already buffered', () => {
    const r = new Reassembler();
    r.push(chunk(0), 0);
    r.push(chunk(3), 0);
    r.push(chunk(3), 1);
    expect(r.stats().duplicates).toBe(1);
    expect(r.depth).toBe(1);
  });
});

describe('bounds', () => {
  it('refuses to buffer without limit when a sender races ahead', () => {
    // Memory on a phone mid broadcast is not where you want to find an unbounded queue.
    const r = new Reassembler({ maxDepth: 16, deadlineMs: 100_000 });
    r.push(chunk(0), 0);
    for (let i = 2; i < 60; i += 1) r.push(chunk(i), 0);
    expect(r.depth).toBeLessThanOrEqual(16);
    expect(r.stats().forced).toBeGreaterThan(0);
  });

  it('does not trip the ceiling on a burst that resolves itself', () => {
    const r = new Reassembler({ maxDepth: 16 });
    for (const seq of [0, 8, 7, 6, 5, 4, 3, 2, 1]) r.push(chunk(seq), 0);
    expect(r.stats().forced).toBe(0);
    expect(r.stats().lost).toBe(0);
  });

  it('does not grow its duplicate memory without limit over a long broadcast', () => {
    const r = new Reassembler({ maxDepth: 8 });
    for (let i = 0; i < 5000; i += 1) r.push(chunk(i), i);
    // The window only has to be wide enough to cover anything that could still be in flight.
    expect(r.stats().emitted).toBe(5000);
    expect(r.depth).toBe(0);
  });
});

describe('end of stream', () => {
  it('releases what it is holding when the broadcast ends', () => {
    // A buffer that only moves when something arrives holds the last chunks forever, which is how
    // the end of a stream goes missing.
    const r = new Reassembler({ deadlineMs: 10_000 });
    r.push(chunk(0), 0);
    r.push(chunk(2), 0);
    r.push(chunk(3), 0);
    expect(seqs(r.flush(100))).toEqual([2, 3]);
    expect(r.depth).toBe(0);
    expect(r.stats().lost).toBe(1);
  });
});

describe('recommendedDeadlineMs', () => {
  it('asks for almost no buffer when the paths are alike, however slow they are', () => {
    // Identical paths do not reorder each other. What costs latency is the SPREAD.
    const slowButEven = recommendedDeadlineMs([
      { rttMs: 200, jitterMs: 5 },
      { rttMs: 205, jitterMs: 5 },
    ]);
    expect(slowButEven).toBeLessThanOrEqual(180);
  });

  it('asks for more when one path is much slower than the other', () => {
    const lopsided = recommendedDeadlineMs([
      { rttMs: 20, jitterMs: 4 },
      { rttMs: 400, jitterMs: 40 },
    ]);
    const even = recommendedDeadlineMs([
      { rttMs: 20, jitterMs: 4 },
      { rttMs: 25, jitterMs: 4 },
    ]);
    expect(lopsided).toBeGreaterThan(even);
  });

  it('never returns a delay worse than the loss it prevents', () => {
    const absurd = recommendedDeadlineMs([
      { rttMs: 20, jitterMs: 1 },
      { rttMs: 30_000, jitterMs: 5000 },
    ]);
    // A broadcast two seconds behind is one whose chat no longer makes sense.
    expect(absurd).toBeLessThanOrEqual(1200);
  });

  it('has a sensible answer for a single path', () => {
    expect(recommendedDeadlineMs([{ rttMs: 30, jitterMs: 5 }])).toBeGreaterThan(0);
    expect(recommendedDeadlineMs([])).toBe(120);
  });
});

describe('the defaults', () => {
  it('are bounded enough to be safe on a phone', () => {
    expect(DEFAULT_REASSEMBLE.deadlineMs).toBeLessThanOrEqual(600);
    expect(DEFAULT_REASSEMBLE.maxDepth).toBeLessThanOrEqual(1024);
  });
});
