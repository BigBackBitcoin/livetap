/**
 * A `Writable` that puts MPEG-TS on a Bond session.
 *
 * This is the whole integration surface. The desktop broadcast pipeline already ends in
 * `TsFanout.addSink(id, stream)`, where a sink is normally the stdin of an `ffmpeg -c copy` child
 * pushing RTMP. A Bond destination is the same shape: a `Writable` that happens to encrypt what it
 * is given and send it to a relay instead of to a socket ffmpeg owns.
 *
 * Because it is the same shape, all four of the fan-out's existing guarantees apply unchanged - the
 * source is never paused, every live sink gets every byte in order, a failing sink is removed while
 * the others continue, and writes arrive aligned to whole 188-byte TS packets. Bond did not have to
 * ask for any of those; they were already true, which is why this file is short.
 *
 * THE CONTRACT THAT MATTERS: `_write` always calls back immediately. Never signalling back-pressure
 * is deliberate and is the reason the fan-out's first invariant survives. A sink that blocked would
 * apply pressure to the encoder, and an encoder that stalls because the network had an opinion is
 * precisely the failure this whole layer exists to prevent. Bond's own bounded outbox absorbs a
 * burst and drops honestly when it cannot; that is the right place for the decision, because only
 * Bond knows what the paths can currently carry.
 */
import { Writable } from 'node:stream';
import type { BondClient } from './BondClient.js';

export interface BondSinkOptions {
  /** Named in logs and telemetry. Usually the destination id. */
  readonly label?: string;
}

export class BondSink extends Writable {
  private bytesIn = 0;

  constructor(
    private readonly client: BondClient,
    private readonly options: BondSinkOptions = {},
  ) {
    // `decodeStrings: false` would hand through strings; we want Buffers and nothing else.
    super({ highWaterMark: 1024 * 1024 });
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.bytesIn += chunk.length;
    try {
      this.client.write(chunk);
    } catch (error) {
      /*
       * Swallowed on purpose, and this is the important line in the file.
       *
       * An error here would propagate into the fan-out, which would remove this sink - correct -
       * but `Writable` also destroys the stream on a callback error, and a destroyed sink cannot
       * come back when the network does. Bond reports its own trouble through `health` and
       * `pathLost`, where the policy engine can act on it. A transient send failure must not end a
       * destination permanently.
       */
      void error;
    }
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    // The session is closed by whoever owns the client, not by the sink: one client can carry
    // several aspect ratios, and the first one to finish must not take the others down.
    callback();
  }

  /** Bytes handed to Bond by the fan-out. Compare with telemetry to see what actually left. */
  get written(): number {
    return this.bytesIn;
  }

  get label(): string {
    return this.options.label ?? 'bond';
  }
}
