/**
 * Deciding which path each piece of media actually goes down.
 *
 * The policy engine says "Wi-Fi 70%, cellular 30%". This turns that into a decision per chunk, and
 * the gap between those two is bigger than it looks. Chunks are not uniform - a keyframe can be
 * twenty times the size of the inter-frames around it - so alternating paths by COUNT produces
 * wildly wrong proportions by BYTES, which is the only unit a network cares about. A scheduler
 * that sends every other chunk to a 1 Mbps path will drown it while believing it is being fair.
 *
 * So allocation is tracked in bytes, using credit accumulation: every chunk grants each path an
 * entitlement equal to its share of that chunk's size, and the chunk goes to whoever is owed most.
 * The long-run split converges on the shares exactly, whatever the size distribution does, and it
 * self-corrects after a large frame instead of carrying the error forward.
 *
 * Duplication is the other half. When the policy asks for keyframe protection, a keyframe goes
 * down its chosen path AND the best other one, because a lost keyframe is seconds of visible
 * damage - everything after it references it - while a lost inter-frame is one flawed frame nobody
 * notices. Audio rides with it: silence is more noticeable than a smeared picture.
 */
import type { BondDecision } from '../policy/decide.js';
import type { BondChunk } from './reassemble.js';

/** Where one chunk was sent. More than one entry means it was deliberately duplicated. */
export interface ChunkAssignment {
  readonly chunk: BondChunk;
  readonly paths: readonly string[];
  /** True when the extra copies are redundancy rather than striping. */
  readonly duplicated: boolean;
}

export interface SchedulerStats {
  /** Bytes sent down each path, including duplicates. The number that has to match the shares. */
  readonly bytesByPath: Readonly<Record<string, number>>;
  readonly chunks: number;
  readonly duplicatedChunks: number;
  /** Extra bytes spent on redundancy. This is what the creator pays for protection. */
  readonly redundantBytes: number;
}

/**
 * Turns a decision plus a stream of chunks into per-path sends.
 *
 * Stateful because fairness is a running property, and deliberately synchronous and pure of I/O so
 * it can be driven by a test at whatever speed it likes.
 */
export class BondScheduler {
  private shares = new Map<string, number>();
  private credit = new Map<string, number>();
  private redundancy: BondDecision['redundancy'] = 'none';
  private order: string[] = [];

  private bytesByPath = new Map<string, number>();
  private chunks = 0;
  private duplicatedChunks = 0;
  private redundantBytes = 0;

  constructor(decision?: BondDecision) {
    if (decision) this.update(decision);
  }

  /**
   * Adopt a new decision.
   *
   * Credit is kept for paths that survive the change and discarded for paths that leave. Resetting
   * everything on each decision would make the shares wrong for a while after every reallocation,
   * and reallocations happen exactly when the stream can least afford to be misrouted.
   */
  update(decision: BondDecision): void {
    const carrying = decision.active.filter((a) => !a.standby && a.share > 0);
    this.shares = new Map(carrying.map((a) => [a.handle, a.share]));
    this.order = carrying.map((a) => a.handle);
    this.redundancy = decision.redundancy;

    for (const handle of [...this.credit.keys()]) {
      if (!this.shares.has(handle)) this.credit.delete(handle);
    }
    for (const handle of this.shares.keys()) {
      if (!this.credit.has(handle)) this.credit.set(handle, 0);
    }
  }

  /**
   * Choose the path or paths for one chunk.
   *
   * Returns an empty path list when there is nowhere to send it. That is a real state - every path
   * failed at once - and the caller has to handle it rather than have a chunk silently vanish into
   * a scheduler that pretended to place it.
   */
  assign(chunk: BondChunk): ChunkAssignment {
    if (this.order.length === 0) {
      return { chunk, paths: [], duplicated: false };
    }

    // Everyone earns their share of this chunk, then the most-owed path carries it.
    for (const handle of this.order) {
      this.credit.set(handle, (this.credit.get(handle) ?? 0) + (this.shares.get(handle) ?? 0) * chunk.bytes);
    }

    const primary = this.mostOwed();
    this.credit.set(primary, (this.credit.get(primary) ?? 0) - chunk.bytes);
    this.record(primary, chunk.bytes);

    const paths = [primary];
    if (this.shouldDuplicate(chunk)) {
      /*
       * The copy goes to the path that is NOT carrying the original, chosen by entitlement so the
       * duplicate load spreads too. Sending both copies down one path protects against nothing:
       * the failure being insured against is a path dying, not a random bit flip.
       */
      const backup = this.mostOwed(primary);
      if (backup !== undefined) {
        this.record(backup, chunk.bytes);
        this.redundantBytes += chunk.bytes;
        this.duplicatedChunks += 1;
        paths.push(backup);
      }
    }

    this.chunks += 1;
    return { chunk, paths, duplicated: paths.length > 1 };
  }

  stats(): SchedulerStats {
    return {
      bytesByPath: Object.fromEntries(this.bytesByPath),
      chunks: this.chunks,
      duplicatedChunks: this.duplicatedChunks,
      redundantBytes: this.redundantBytes,
    };
  }

  /** The proportion of bytes each path actually carried. What the shares promised, measured. */
  realisedShares(): Record<string, number> {
    const total = [...this.bytesByPath.values()].reduce((sum, b) => sum + b, 0);
    if (total === 0) return {};
    return Object.fromEntries([...this.bytesByPath].map(([handle, bytes]) => [handle, bytes / total]));
  }

  private shouldDuplicate(chunk: BondChunk): boolean {
    if (this.order.length < 2) return false;
    if (this.redundancy === 'full') return true;
    if (this.redundancy === 'none') return false;
    return chunk.frameType === 'key' || chunk.frameType === 'audio';
  }

  /** The path owed the most bytes, optionally excluding one. Ties break on decision order. */
  private mostOwed(exclude?: string): string {
    let best: string | undefined;
    let bestCredit = -Infinity;
    for (const handle of this.order) {
      if (handle === exclude) continue;
      const credit = this.credit.get(handle) ?? 0;
      if (credit > bestCredit) {
        bestCredit = credit;
        best = handle;
      }
    }
    return best as string;
  }

  private record(handle: string, bytes: number): void {
    this.bytesByPath.set(handle, (this.bytesByPath.get(handle) ?? 0) + bytes);
  }
}
