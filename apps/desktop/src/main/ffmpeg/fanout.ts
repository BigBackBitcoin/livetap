/**
 * In-process MPEG-TS fan-out: one encoder's stdout copied to N sender stdins.
 *
 * This is the piece that makes "one encode, many destinations" true on desktop, and the reason we
 * do NOT use ffmpeg's `tee` muxer as the primary topology. `tee` takes a fixed output list, so
 * adding or removing a destination means restarting the encoder — every other destination blips and
 * every viewer sees a reconnect. Here the encoder is untouched for the whole broadcast and a
 * destination is one cheap `-c copy` process we can start, kill and restart at will.
 *
 * Invariants, all unit-tested:
 *  1. The source is NEVER paused. A wedged destination (full socket buffer, hung platform) must not
 *     apply backpressure to the encoder, because that would stall every other destination and the
 *     recording too. Instead each sink has its own bounded queue and drops when it overflows.
 *  2. Every live sink receives every byte, in order, with no interleaving.
 *  3. A sink that errors or closes is removed and reported; the others keep going.
 *  4. Writes to sinks are aligned to whole 188-byte TS packets, so a sink attached mid-broadcast
 *     starts on a packet boundary and its ffmpeg locks onto the stream at the next PAT/PMT
 *     (the encoder emits those every 100 ms — see buildEncoderArgv).
 */

import type { Readable, Writable } from 'node:stream';

/** MPEG-TS packet size. The whole point of using TS internally: it is self-synchronising. */
export const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;

export interface FanoutOptions {
  /**
   * Per-sink queue ceiling. Above this the sink drops whole aligned blocks rather than buffering
   * without bound. 4 MB ≈ 7 s of a 4.5 Mbps stream: long enough to ride out a hiccup, short enough
   * that a dead destination cannot eat memory.
   */
  maxQueuedBytes?: number;
  packetSize?: number;
  onSinkError?: (id: string, error: Error) => void;
  onSinkDrop?: (id: string, droppedBytes: number, totalDroppedBytes: number) => void;
  onSinkClosed?: (id: string) => void;
}

export interface SinkStats {
  id: string;
  bytesWritten: number;
  bytesDropped: number;
  queuedBytes: number;
  alive: boolean;
}

interface Sink {
  id: string;
  stream: Writable;
  bytesWritten: number;
  bytesDropped: number;
  queuedBytes: number;
  alive: boolean;
  detach: () => void;
}

export class TsFanout {
  private readonly sinks = new Map<string, Sink>();
  private readonly maxQueuedBytes: number;
  private readonly packetSize: number;
  private readonly options: FanoutOptions;
  /** Bytes received that do not yet complete a TS packet. */
  private remainder: Buffer = Buffer.alloc(0);
  private source: Readable | null = null;
  private sourceBytes = 0;
  private resynced = false;
  private ended = false;

  constructor(options: FanoutOptions = {}) {
    this.options = options;
    this.maxQueuedBytes = options.maxQueuedBytes ?? 4 * 1024 * 1024;
    this.packetSize = options.packetSize ?? TS_PACKET_SIZE;
  }

  /** Pipe an encoder's stdout in. Deliberately uses `data` (flowing mode) and never `pause()`. */
  attach(source: Readable): void {
    this.source = source;
    source.on('data', (chunk: Buffer | string) => {
      this.write(typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : chunk);
    });
    source.on('end', () => this.end());
    source.on('error', () => this.end());
  }

  get totalSourceBytes(): number {
    return this.sourceBytes;
  }

  /**
   * Feed bytes in. Exposed separately from `attach` so tests can drive the fan-out deterministically
   * without a real child process.
   */
  write(chunk: Buffer): void {
    if (this.ended || chunk.length === 0) return;
    this.sourceBytes += chunk.length;

    let data = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk]) : chunk;

    // ffmpeg's mpegts muxer starts on a sync byte, but resync once anyway so a truncated first read
    // (or a test feeding arbitrary bytes) cannot misalign every subsequent packet.
    if (!this.resynced) {
      const syncIndex = data.indexOf(TS_SYNC_BYTE);
      if (syncIndex === -1) {
        this.remainder = data.subarray(Math.max(0, data.length - this.packetSize));
        return;
      }
      if (syncIndex > 0) data = data.subarray(syncIndex);
      this.resynced = true;
    }

    const alignedLength = data.length - (data.length % this.packetSize);
    if (alignedLength === 0) {
      this.remainder = data;
      return;
    }
    const aligned = data.subarray(0, alignedLength);
    this.remainder = alignedLength === data.length ? Buffer.alloc(0) : Buffer.from(data.subarray(alignedLength));

    for (const sink of this.sinks.values()) {
      this.writeToSink(sink, aligned);
    }
  }

  private writeToSink(sink: Sink, aligned: Buffer): void {
    if (!sink.alive) return;
    if (sink.stream.destroyed || sink.stream.writableEnded) {
      this.killSink(sink, undefined, 'closed');
      return;
    }
    if (sink.queuedBytes + aligned.length > this.maxQueuedBytes) {
      sink.bytesDropped += aligned.length;
      this.options.onSinkDrop?.(sink.id, aligned.length, sink.bytesDropped);
      return;
    }
    sink.queuedBytes += aligned.length;
    try {
      // The return value is intentionally ignored: honouring backpressure here would pause the
      // encoder and therefore every other destination. Our own bounded queue is the limiter.
      sink.stream.write(aligned, (error) => {
        sink.queuedBytes = Math.max(0, sink.queuedBytes - aligned.length);
        if (error) this.killSink(sink, error, 'error');
      });
      sink.bytesWritten += aligned.length;
    } catch (error) {
      this.killSink(sink, error instanceof Error ? error : new Error(String(error)), 'error');
    }
  }

  /** Register a destination. It starts receiving at the next whole-packet boundary. */
  addSink(id: string, stream: Writable): void {
    if (this.sinks.has(id)) throw new Error(`Fan-out sink ${id} already exists.`);
    const sink: Sink = {
      id,
      stream,
      bytesWritten: 0,
      bytesDropped: 0,
      queuedBytes: 0,
      alive: true,
      detach: () => undefined,
    };
    /**
     * The `error` listener is attached for the LIFE OF THE STREAM and is never removed — not on
     * `removeSink`, not on `end()`, not after the sink is already dead.
     *
     * A child's stdin can emit EPIPE asynchronously, well after the write that caused it and well
     * after we stopped caring about the sink. With no listener attached at that moment, Node turns
     * that into an unhandled `error` event and takes the whole main process down — i.e. one dead
     * destination kills the broadcast, the exact failure this class exists to prevent. (Observed on
     * this host: the mp4 recorder rejected a packet, we tore the sink down, and the trailing EPIPE
     * crashed the process. See DESKTOP_ENGINE_VERIFICATION.md.)
     */
    const onError = (error: Error): void => this.killSink(sink, error, 'error');
    const onClose = (): void => this.killSink(sink, undefined, 'closed');
    stream.on('error', onError);
    stream.on('close', onClose);
    // Only the `close` listener is detachable; `error` stays so late failures stay swallowed.
    sink.detach = () => {
      stream.off('close', onClose);
    };
    this.sinks.set(id, sink);
  }

  /** Unregister a destination without touching the others. Does not end the underlying stream. */
  removeSink(id: string): boolean {
    const sink = this.sinks.get(id);
    if (!sink) return false;
    sink.alive = false;
    sink.detach();
    this.sinks.delete(id);
    return true;
  }

  private killSink(sink: Sink, error: Error | undefined, reason: 'error' | 'closed'): void {
    if (!sink.alive) return;
    sink.alive = false;
    sink.detach();
    this.sinks.delete(sink.id);
    if (reason === 'error') {
      this.options.onSinkError?.(sink.id, error ?? new Error('Fan-out sink failed.'));
    } else {
      this.options.onSinkClosed?.(sink.id);
    }
  }

  has(id: string): boolean {
    return this.sinks.has(id);
  }

  get sinkCount(): number {
    return this.sinks.size;
  }

  stats(): SinkStats[] {
    return [...this.sinks.values()].map((sink) => ({
      id: sink.id,
      bytesWritten: sink.bytesWritten,
      bytesDropped: sink.bytesDropped,
      queuedBytes: sink.queuedBytes,
      alive: sink.alive,
    }));
  }

  /** Worst per-sink drop ratio, as a percentage. Feeds EngineMetrics.networkDroppedPct. */
  worstDropPct(): number {
    let worst = 0;
    for (const sink of this.sinks.values()) {
      const total = sink.bytesWritten + sink.bytesDropped;
      if (total === 0) continue;
      worst = Math.max(worst, (sink.bytesDropped / total) * 100);
    }
    return worst;
  }

  /** Flush the remainder and end every sink's stream (graceful stop, lets muxers finalise). */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const sink of [...this.sinks.values()]) {
      sink.alive = false;
      sink.detach();
      if (!sink.stream.destroyed && !sink.stream.writableEnded) {
        try {
          sink.stream.end();
        } catch {
          // Already gone; nothing to do.
        }
      }
    }
    this.sinks.clear();
    if (this.source) {
      this.source.removeAllListeners('data');
      this.source = null;
    }
  }

  get isEnded(): boolean {
    return this.ended;
  }
}
