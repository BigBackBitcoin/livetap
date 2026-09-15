/**
 * The LIVETAP Bond relay: one public UDP port, N sessions, one reconstructed stream each.
 *
 * This is the piece that was previously "designed, not built", and building it is what makes
 * bonding real rather than architectural. It exists because the platforms cannot be changed:
 * YouTube expects one RTMP connection and always will, so multipath can only live between the
 * device and something LIVETAP controls, and this is that thing.
 *
 * THE ORDER OF OPERATIONS IS THE SECURITY DESIGN. A public UDP port that does work before
 * authenticating is a free amplifier for anyone who can spoof a source address, so every arriving
 * datagram is filtered cheapest-first:
 *
 *   1. Parse a 24-byte header.                     malformed -> drop, no allocation
 *   2. Look up the session.                        unknown + not a HELLO -> drop, no allocation
 *   3. Check the per-path replay window.           replayed -> drop, no AEAD
 *   4. Verify the AEAD tag.                        forged -> drop
 *   5. Only now may it touch reassembly state.
 *
 * A hostile datagram costs a map lookup and a bigint compare. A session is never created by a
 * datagram that has not authenticated.
 *
 * What the relay deliberately does NOT do: re-encode. The device already produced H.264 and AAC,
 * and the reconstructed stream is handed on byte-for-byte. Re-encoding would cost CPU per
 * destination, add latency and lose quality in exchange for nothing.
 */
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { PassThrough } from 'node:stream';
import { TypedEmitter } from './emitter.js';
import {
  BOND_VERSION,
  FrameType,
  HEADER_BYTES,
  decodeHeader,
  encodeHeader,
  type BondHeader,
} from '../wire/frame.js';
import { SecureChannel, relayAccept, type SessionToken, type StaticKeyPair } from '../wire/secure.js';
import { Reassembler, type BondChunk, type ReassembleStats } from '../transport/reassemble.js';
import type { KeyObject } from 'node:crypto';

const SEQ_BYTES = 4;
const FLAG_BYTES = 1;
const DATA_PREFIX = SEQ_BYTES + FLAG_BYTES;
const FLAG_DUPLICATE = 0b0000_0001;

export interface BondRelayOptions {
  readonly port: number;
  readonly address?: string;
  readonly relayStatic: StaticKeyPair;
  /** Public key of the broker whose tokens this relay honours. */
  readonly brokerPublicKey: KeyObject;
  /** How long to hold a gap before declaring it lost. */
  readonly deadlineMs?: number;
  /** Drop a session that has heard nothing for this long. */
  readonly idleTimeoutMs?: number;
  readonly now?: () => number;
}

/** What the relay reports about one running session. */
export interface RelaySessionStats {
  readonly sessionId: string;
  readonly paths: number;
  readonly bytesIn: number;
  readonly chunksOut: number;
  readonly reassembly: ReassembleStats;
  readonly startedAt: number;
}

export interface BondRelayEvents {
  /** A client authenticated. The stream carries reconstructed MPEG-TS. */
  session: { sessionId: string; token: SessionToken; stream: PassThrough };
  sessionEnded: { sessionId: string; stats: RelaySessionStats };
  pathJoined: { sessionId: string; pathId: number; from: string };
  /** A datagram was refused. Rate-limited by the caller if they log it. */
  refused: { reason: string; from: string };
  error: Error;
}

interface PathRecord {
  readonly id: number;
  /** Where the last authenticated datagram on this path came from. */
  address: string;
  port: number;
  received: number;
  lost: number;
  lastSeenAt: number;
}

interface Session {
  readonly id: bigint;
  readonly token: SessionToken;
  readonly channel: SecureChannel;
  readonly reassembler: Reassembler;
  readonly stream: PassThrough;
  readonly paths: Map<number, PathRecord>;
  readonly startedAt: number;
  bytesIn: number;
  chunksOut: number;
  lastSeenAt: number;
  highestSeq: number;
}

export class BondRelay extends TypedEmitter<BondRelayEvents> {
  private readonly options: BondRelayOptions;
  private readonly now: () => number;
  private socket: Socket | null = null;
  private readonly sessions = new Map<string, Session>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: BondRelayOptions) {
    super();
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  async listen(): Promise<number> {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('message', (datagram, from) => this.onDatagram(datagram, from));
    socket.on('error', (error) => this.emit('error', error));

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(this.options.port, this.options.address, () => {
        socket.off('error', reject);
        resolve();
      });
    });

    /*
     * Size the kernel receive buffer, because the default is nowhere near enough and the failure is
     * silent.
     *
     * Measured on loopback before this line existed: a client sent 400 datagrams (542 KB) and the
     * relay reassembled 97 of them while reporting ZERO loss - because the ~64 KB default buffer
     * overflowed and the kernel discarded the rest before this process ever saw them. Loss the
     * reassembler cannot see is loss it cannot report, which is the worst possible shape for a
     * layer whose whole promise is honesty about failure.
     *
     * 8 MB is about ten seconds of a 6 Mbps stream: long enough to ride out a scheduling hiccup on
     * a busy relay, short enough to be a bounded per-socket cost. Every serious UDP media receiver
     * does this; the default exists for DNS-sized traffic, not video.
     */
    try {
      socket.setRecvBufferSize(8 * 1024 * 1024);
    } catch {
      // Some platforms cap this below what we asked for and some refuse outright. Neither is fatal
      // - it just means a smaller cushion - and a relay that will not start because it could not
      // get its preferred buffer size is worse than one that runs with a smaller one.
    }

    this.sweeper = setInterval(() => this.sweep(), 500);
    this.sweeper.unref?.();
    return (socket.address() as { port: number }).port;
  }

  async close(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const key of [...this.sessions.keys()]) this.endSession(key, 'relay closing');
    const socket = this.socket;
    this.socket = null;
    if (socket) await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  stats(): RelaySessionStats[] {
    return [...this.sessions.values()].map((session) => this.statsFor(session));
  }

  // -------------------------------------------------------------------------------------------

  private onDatagram(datagram: Buffer, from: RemoteInfo): void {
    const header = decodeHeader(datagram);
    if (!header) {
      this.emit('refused', { reason: 'malformed header', from: from.address });
      return;
    }

    const key = header.sessionId.toString(16);
    const session = this.sessions.get(key);

    if (header.type === FrameType.HELLO) {
      if (session) return; // already established; a repeated HELLO is noise or a replay
      this.onHello(datagram, header, from);
      return;
    }

    if (!session) {
      // No session, and not an attempt to make one. Nothing is allocated.
      this.emit('refused', { reason: 'unknown session', from: from.address });
      return;
    }

    const body = session.channel.openRecord(
      datagram.subarray(0, HEADER_BYTES),
      header.pathId,
      header.counter,
      datagram.subarray(HEADER_BYTES),
    );
    if (!body) {
      // Failed replay check or failed authentication. Indistinguishable on purpose: telling an
      // attacker which one would let them map the replay window.
      this.emit('refused', { reason: 'authentication', from: from.address });
      return;
    }

    session.lastSeenAt = this.now();
    session.bytesIn += datagram.length;

    switch (header.type) {
      case FrameType.PATH_HELLO:
        this.onPathHello(session, header, from);
        break;
      case FrameType.DATA:
        this.onData(session, header, from, body);
        break;
      case FrameType.BYE:
        this.endSession(key, 'client said goodbye');
        break;
      default:
        break;
    }
  }

  private onHello(datagram: Buffer, header: BondHeader, from: RemoteInfo): void {
    const result = relayAccept({
      hello: datagram.subarray(HEADER_BYTES),
      relayStatic: this.options.relayStatic,
      brokerPublicKey: this.options.brokerPublicKey,
      nowSeconds: Math.floor(this.now() / 1000),
    });

    if (!result.ok) {
      this.emit('refused', { reason: result.reason, from: from.address });
      return;
    }

    const key = header.sessionId.toString(16);
    const now = this.now();
    const session: Session = {
      id: header.sessionId,
      token: result.token,
      channel: new SecureChannel(result.sessionKey),
      reassembler: new Reassembler({ deadlineMs: this.options.deadlineMs ?? 400 }),
      stream: new PassThrough(),
      paths: new Map([[header.pathId, { id: header.pathId, address: from.address, port: from.port, received: 0, lost: 0, lastSeenAt: now }]]),
      startedAt: now,
      bytesIn: datagram.length,
      chunksOut: 0,
      lastSeenAt: now,
      highestSeq: -1,
    };
    this.sessions.set(key, session);

    const welcomeHeader = encodeHeader({
      version: BOND_VERSION,
      type: FrameType.WELCOME,
      pathId: header.pathId,
      counter: 0n,
      sessionId: header.sessionId,
    });
    this.socket?.send(Buffer.concat([welcomeHeader, result.datagram]), from.port, from.address);

    this.emit('session', { sessionId: key, token: result.token, stream: session.stream });
  }

  private onPathHello(session: Session, header: BondHeader, from: RemoteInfo): void {
    /*
     * A path joining an established session. Reaching here means the datagram was sealed under the
     * session key, which is the proof that matters: only the client holds it. No second handshake,
     * which is what makes adding a path when Wi-Fi dies fast enough to be worth doing.
     *
     * Note the source address is RECORDED rather than checked. A path legitimately arrives from an
     * address the relay has never seen - that is the entire point - and a NAT can change it
     * mid-session. Authentication is cryptographic here, never by address.
     */
    if (!session.paths.has(header.pathId)) {
      session.paths.set(header.pathId, {
        id: header.pathId,
        address: from.address,
        port: from.port,
        received: 0,
        lost: 0,
        lastSeenAt: this.now(),
      });
      this.emit('pathJoined', { sessionId: session.id.toString(16), pathId: header.pathId, from: from.address });
    }
    this.acknowledge(session, header.pathId, from);
  }

  private onData(session: Session, header: BondHeader, from: RemoteInfo, body: Buffer): void {
    if (body.length < DATA_PREFIX) return;

    let path = session.paths.get(header.pathId);
    if (!path) {
      // Data on a path that never said hello. It authenticated, so it is genuinely ours; register
      // it rather than dropping media on a technicality.
      path = { id: header.pathId, address: from.address, port: from.port, received: 0, lost: 0, lastSeenAt: this.now() };
      session.paths.set(header.pathId, path);
      this.emit('pathJoined', { sessionId: session.id.toString(16), pathId: header.pathId, from: from.address });
    }
    path.address = from.address;
    path.port = from.port;
    path.lastSeenAt = this.now();
    path.received += 1;

    const seq = body.readUInt32BE(0);
    const flags = body.readUInt8(SEQ_BYTES);
    const payload = body.subarray(DATA_PREFIX);

    const chunk: BondChunk = {
      seq,
      timestampUs: 0,
      frameType: (flags & FLAG_DUPLICATE) !== 0 ? 'key' : 'inter',
      bytes: payload.length,
      payload,
    };

    const ready = session.reassembler.push(chunk, this.now());
    this.writeOut(session, ready);

    // Acknowledge on the path it arrived on, so each path is measured independently. An ACK that
    // went out one path would tell the client nothing about the others.
    this.acknowledge(session, header.pathId, from);
  }

  private writeOut(session: Session, chunks: readonly BondChunk[]): void {
    for (const chunk of chunks) {
      if (!chunk.payload) continue;
      session.chunksOut += 1;
      session.highestSeq = Math.max(session.highestSeq, chunk.seq);
      // `write` returning false is back-pressure from the destination. Deliberately ignored: a slow
      // destination must never stall reconstruction for a stream that other destinations are
      // reading too. PassThrough buffers, and the consumer is an ffmpeg process that keeps up.
      session.stream.write(Buffer.from(chunk.payload));
    }
  }

  private acknowledge(session: Session, pathId: number, from: RemoteInfo): void {
    const path = session.paths.get(pathId);
    if (!path || !this.socket) return;
    const stats = session.reassembler.stats();

    const body = Buffer.allocUnsafe(20);
    body.writeUInt32BE(Math.max(0, session.highestSeq), 0);
    body.writeUInt32BE(path.received * 1316, 4); // delivered bytes on this path
    body.writeUInt32BE(Math.min(0xffff_ffff, stats.lost), 8);
    body.writeBigUInt64BE(BigInt(this.now()), 12);

    try {
      const counter = session.channel.nextCounter(pathId);
      const header = encodeHeader({
        version: BOND_VERSION,
        type: FrameType.ACK,
        pathId,
        counter,
        sessionId: session.id,
      });
      const sealed = session.channel.sealRecord(header, pathId, counter, body);
      this.socket.send(Buffer.concat([header, sealed]), from.port, from.address);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Time-driven work: release gaps whose deadline has passed, and drop dead sessions.
   *
   * The reassembler must be advanced by a clock as well as by arrivals, or a stream that stops
   * arriving holds its last chunks forever - which is how the end of a broadcast goes missing.
   */
  private sweep(): void {
    const now = this.now();
    const idleTimeout = this.options.idleTimeoutMs ?? 10_000;
    for (const [key, session] of this.sessions) {
      this.writeOut(session, session.reassembler.drain(now));
      if (now - session.lastSeenAt > idleTimeout) this.endSession(key, 'idle');
    }
  }

  private endSession(key: string, reason: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    // Everything still held goes out, gaps and all: the tail of a broadcast is still the broadcast.
    this.writeOut(session, session.reassembler.flush(this.now()));
    session.stream.end();
    this.emit('sessionEnded', { sessionId: key, stats: this.statsFor(session) });
    void reason;
  }

  private statsFor(session: Session): RelaySessionStats {
    return {
      sessionId: session.id.toString(16),
      paths: session.paths.size,
      bytesIn: session.bytesIn,
      chunksOut: session.chunksOut,
      reassembly: session.reassembler.stats(),
      startedAt: session.startedAt,
    };
  }
}
