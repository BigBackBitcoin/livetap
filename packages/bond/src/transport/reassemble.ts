/**
 * Putting one media stream back together after it travelled several ways at once.
 *
 * This is the part of bonding that people underestimate. Sending across several paths is easy;
 * the hard problem is that a fast Wi-Fi packet and a slow cellular packet sent in that order
 * arrive in the other order, and a naive receiver either emits them wrong or waits forever for
 * something that is never coming. Both failures look like a broken stream to a viewer.
 *
 * So this is a deadline-driven reorder buffer, and the deadline is the whole design:
 *
 *   WAITING IS BOUNDED. Every gap gets a deadline the moment it appears. When the deadline passes
 *   the gap is declared lost, the buffer moves past it, and everything behind it is released. A
 *   reorder buffer that can stall indefinitely has converted a packet loss - which costs one
 *   damaged frame - into a stream freeze, which costs the broadcast.
 *
 *   THE DEADLINE IS THE PRICE OF BONDING. It is latency deliberately added so that a slow path
 *   can still contribute. It must be tuned against the slowest path's round trip rather than
 *   guessed, and it is reported, because "how much delay did bonding cost us" is a number the
 *   product has to be able to answer rather than hand-wave.
 *
 *   LOSS IS COUNTED, NEVER PAPERED OVER. Every skipped sequence number is reported. Section 49 of
 *   the mission forbids a networking layer that hides failures, and a reassembler that silently
 *   drops a gap is the quietest possible way to do exactly that.
 *
 * Duplicates are expected here rather than exceptional: keyframe redundancy deliberately sends the
 * same chunk down two paths, so the second copy arriving is a success, not an anomaly.
 */

/** The frame classes the scheduler and the reassembler both care about. */
export type FrameType = 'key' | 'inter' | 'audio';

/** One unit of media as it travels. Payload is opaque here; only the envelope matters. */
export interface BondChunk {
  /** Monotonic, gapless at the sender, per stream. The only thing ordering depends on. */
  readonly seq: number;
  /** Presentation timestamp in microseconds, carried through untouched. */
  readonly timestampUs: number;
  readonly frameType: FrameType;
  readonly bytes: number;
  /**
   * The media itself, when there is any.
   *
   * Optional because the reassembler's logic is about ORDER and does not care what it is ordering -
   * every test above drives it with envelopes alone. The relay puts the real payload here so that
   * one tested implementation serves both, rather than the production path quietly growing a second
   * reassembler that nothing has ever tried to break.
   *
   * `Uint8Array` rather than `Buffer`: this module must stay usable in a browser bundle.
   */
  readonly payload?: Uint8Array;
}

export interface ReassembleOptions {
  /**
   * How long to wait for a missing chunk before declaring it lost, in milliseconds.
   *
   * This is the latency bonding costs. Too small and a slow path's contribution is thrown away as
   * fast as it arrives; too large and the stream is needlessly delayed. It should track the
   * slowest active path's round trip, which is why `recommendedDeadlineMs` exists below.
   */
  readonly deadlineMs: number;
  /**
   * Hard ceiling on buffered chunks.
   *
   * A second line of defence for the case the deadline cannot catch: a sender that races far ahead
   * while one chunk is missing would otherwise buffer without limit. Memory on a phone mid
   * broadcast is not somewhere to discover an unbounded queue.
   */
  readonly maxDepth: number;
}

export const DEFAULT_REASSEMBLE: ReassembleOptions = {
  deadlineMs: 400,
  maxDepth: 512,
};

export interface ReassembleStats {
  /** Chunks handed on, in order. */
  readonly emitted: number;
  /** Sequence numbers declared lost because their deadline passed. */
  readonly lost: number;
  /** Copies of a chunk already seen. Expected when keyframe redundancy is on. */
  readonly duplicates: number;
  /** Chunks that turned up after their gap had already been declared lost. */
  readonly tooLate: number;
  /** Chunks released early because the buffer hit `maxDepth`. */
  readonly forced: number;
  /** The largest number of chunks held at once, for tuning `maxDepth`. */
  readonly peakDepth: number;
  /** Longest a chunk waited to be released, in milliseconds. The real cost of bonding. */
  readonly maxHeldMs: number;
}

interface Held {
  readonly chunk: BondChunk;
  readonly arrivedAt: number;
}

/**
 * Ordered reconstruction with a bounded wait.
 *
 * Deliberately not an event emitter: `push` and `drain` return what is ready, so a caller in a
 * test drives it with a clock it controls and a caller in production drives it with a real one,
 * and neither can behave differently from the other.
 */
export class Reassembler {
  private readonly options: ReassembleOptions;
  private buffer = new Map<number, Held>();
  private next = 0;
  private started = false;
  /** When the current gap at `next` was first noticed. Undefined when there is no gap. */
  private gapSince: number | undefined;
  private seen = new Set<number>();

  private emitted = 0;
  private lost = 0;
  private duplicates = 0;
  private tooLate = 0;
  private forced = 0;
  private peakDepth = 0;
  private maxHeldMs = 0;

  constructor(options: Partial<ReassembleOptions> = {}) {
    this.options = { ...DEFAULT_REASSEMBLE, ...options };
  }

  /**
   * Take one arriving chunk. Returns whatever became releasable because of it, in order.
   *
   * The first chunk to arrive defines the start of the stream. It is deliberately NOT assumed to
   * be sequence zero: a receiver that joins a broadcast already in progress, or one whose first
   * packet was the one that got lost, must not spend the rest of the session waiting for a chunk
   * that was never coming.
   */
  push(chunk: BondChunk, now: number): BondChunk[] {
    if (!this.started) {
      this.started = true;
      this.next = chunk.seq;
    }

    if (chunk.seq < this.next) {
      // Either a duplicate of something already emitted, or a straggler from a gap we gave up on.
      if (this.seen.has(chunk.seq)) this.duplicates += 1;
      else this.tooLate += 1;
      return [];
    }

    if (this.buffer.has(chunk.seq)) {
      this.duplicates += 1;
      return [];
    }

    this.buffer.set(chunk.seq, { chunk, arrivedAt: now });
    this.peakDepth = Math.max(this.peakDepth, this.buffer.size);

    const ready = this.releaseContiguous(now);

    // Depth ceiling. Only after trying the normal path, so a burst that resolves itself does not
    // trip it. Forcing a release skips the missing chunk exactly as a deadline would.
    while (this.buffer.size > this.options.maxDepth) {
      this.forced += 1;
      this.skipGap();
      ready.push(...this.releaseContiguous(now));
    }

    return ready;
  }

  /**
   * Advance time without a new arrival.
   *
   * Necessary because a stream that stops arriving still has to release what it is holding. A
   * buffer that only moves when something arrives will hold the last few chunks of a broadcast
   * forever, which is how the end of a stream goes missing.
   */
  drain(now: number): BondChunk[] {
    const out: BondChunk[] = [];
    while (this.gapExpired(now)) {
      this.skipGap();
      out.push(...this.releaseContiguous(now));
    }
    return out;
  }

  /** Release everything held, in order, gaps and all. For the end of a broadcast. */
  flush(now: number): BondChunk[] {
    const out: BondChunk[] = [];
    const remaining = [...this.buffer.keys()].sort((a, b) => a - b);
    for (const seq of remaining) {
      if (seq > this.next) this.lost += seq - this.next;
      this.next = seq;
      out.push(...this.releaseContiguous(now));
    }
    return out;
  }

  stats(): ReassembleStats {
    return {
      emitted: this.emitted,
      lost: this.lost,
      duplicates: this.duplicates,
      tooLate: this.tooLate,
      forced: this.forced,
      peakDepth: this.peakDepth,
      maxHeldMs: this.maxHeldMs,
    };
  }

  /** Chunks currently waiting. Zero means the stream is keeping up. */
  get depth(): number {
    return this.buffer.size;
  }

  private gapExpired(now: number): boolean {
    if (this.buffer.size === 0) return false;
    if (this.buffer.has(this.next)) return false;
    if (this.gapSince === undefined) return false;
    return now - this.gapSince >= this.options.deadlineMs;
  }

  /**
   * Give up on the chunk at `next`.
   *
   * Jumps straight to the lowest sequence actually held rather than stepping one at a time: a
   * cellular path dropping for a second loses a run of chunks, and walking that run one deadline
   * at a time would add a full deadline of delay per lost chunk.
   */
  private skipGap(): void {
    const lowest = Math.min(...this.buffer.keys());
    if (lowest <= this.next) return;
    this.lost += lowest - this.next;
    this.next = lowest;
    this.gapSince = undefined;
  }

  private releaseContiguous(now: number): BondChunk[] {
    const out: BondChunk[] = [];
    for (;;) {
      const held = this.buffer.get(this.next);
      if (!held) break;
      this.buffer.delete(this.next);
      this.seen.add(this.next);
      this.maxHeldMs = Math.max(this.maxHeldMs, now - held.arrivedAt);
      out.push(held.chunk);
      this.emitted += 1;
      this.next += 1;
    }

    /*
     * Start or clear the gap clock. The deadline runs from when the gap was NOTICED, not from when
     * the missing chunk was sent, because the sender's clock is not available here and does not
     * need to be.
     */
    if (this.buffer.size > 0 && !this.buffer.has(this.next)) {
      this.gapSince ??= now;
    } else {
      this.gapSince = undefined;
    }

    /*
     * `seen` exists only to tell a duplicate from a straggler, and both questions are about the
     * recent past. Keeping every sequence number for a multi-hour broadcast is a slow memory leak,
     * so it is trimmed to a window comfortably wider than anything that could still be in flight.
     */
    if (this.seen.size > this.options.maxDepth * 4) {
      const cutoff = this.next - this.options.maxDepth * 2;
      for (const seq of this.seen) if (seq < cutoff) this.seen.delete(seq);
    }

    return out;
  }
}

/**
 * How long to wait for a straggler, given the paths actually in use.
 *
 * The slowest path's round trip is what sets this: waiting less means systematically discarding
 * whatever that path contributes, which is the same as not having bonded at all. The half-RTT
 * approximation is one-way delay, and the margin absorbs jitter.
 *
 * Bounded at both ends on purpose. Below the floor the buffer cannot absorb ordinary jitter; above
 * the ceiling the delay is worse than the loss it is preventing, and a broadcast that is two
 * seconds behind is a broadcast whose chat no longer makes sense.
 */
export function recommendedDeadlineMs(
  paths: readonly { rttMs: number; jitterMs: number }[],
  bounds: { floorMs?: number; ceilingMs?: number } = {},
): number {
  const floor = bounds.floorMs ?? 120;
  const ceiling = bounds.ceilingMs ?? 1200;
  if (paths.length === 0) return floor;

  const worst = paths.reduce(
    (max, p) => Math.max(max, p.rttMs / 2 + p.jitterMs * 2),
    0,
  );
  const fastest = paths.reduce((min, p) => Math.min(min, p.rttMs / 2), Infinity);
  // What matters is the SPREAD: identical paths need almost no buffer however slow they are.
  const spread = worst - fastest;
  return Math.round(Math.max(floor, Math.min(ceiling, spread * 1.5 + floor)));
}
