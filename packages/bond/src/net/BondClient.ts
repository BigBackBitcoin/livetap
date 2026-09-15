/**
 * The sending half of LIVETAP Bond: real UDP sockets, real crypto, real paths.
 *
 * This is the file that turns the Bond package from a library into a networking layer. Everything
 * above it - the policy engine, the scorer, the capacity estimator, the scheduler - was written to
 * be driven by something, and this is the something.
 *
 * Node-only, deliberately. It uses `node:dgram`, so it runs in the Electron main process (where
 * FFmpeg already lives) and in the relay's test harness, and it is NOT part of the web bundle. The
 * browser cannot bind a socket to an interface, so there is nothing here for it to use; see
 * `browserCapabilities()` for why that is a platform fact rather than a gap.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: a broadcast must never die because bonding had an opinion.
 * Every failure path here degrades - to fewer paths, to one path, to reporting honestly that it
 * cannot send - and none of them throws into the media pipeline.
 */
import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { TypedEmitter } from './emitter.js';
import {
  CHUNK_PAYLOAD_BYTES,
  FrameType,
  HEADER_BYTES,
  TAG_BYTES,
  chunkTs,
  decodeHeader,
  encodeHeader,
  hasRandomAccessPoint,
  BOND_VERSION,
} from '../wire/frame.js';
import {
  SecureChannel,
  clientFinish,
  clientHello,
  newSessionId,
  type PendingHandshake,
} from '../wire/secure.js';
import { decide, type BondDecision } from '../policy/decide.js';
import { BondScheduler } from '../transport/schedule.js';
import { estimateCapacity, usefulCeilingFor, type CapacityEstimate } from '../path/capacity.js';
import { classifySample } from '../path/stateMachine.js';
import { DEFAULT_BOND_POLICY, type BondPolicy, type MeteredState, type NetworkPath, type PathState, type PathTransport } from '../path/types.js';
import type { KeyObject } from 'node:crypto';

/** How the payload of a DATA record is laid out, inside the AEAD. */
const SEQ_BYTES = 4;
const FLAG_BYTES = 1;
const DATA_PREFIX = SEQ_BYTES + FLAG_BYTES;

const FLAG_DUPLICATE = 0b0000_0001;
const FLAG_RANDOM_ACCESS = 0b0000_0010;

/** One local address Bond may send from. */
export interface BondPathSpec {
  /** Local address to bind. Empty means "let the OS choose", which is the single-path case. */
  readonly localAddress?: string;
  readonly transport: PathTransport;
  readonly label: string;
  readonly metered: MeteredState;
}

export interface BondClientOptions {
  readonly relayHost: string;
  readonly relayPort: number;
  /** The relay's long-term X25519 public key, 32 raw bytes. */
  readonly relayStaticPublic: KeyObject;
  /** The broker-signed session token. */
  readonly tokenBlob: Buffer;
  readonly policy?: BondPolicy;
  /** What the encoder is producing, for the policy engine. */
  readonly streamBitrateBps?: number;
  /**
   * Ceiling on how fast datagrams leave, bits per second. Defaults to 3x the stream bitrate.
   *
   * Pacing is not politeness, it is correctness. Measured on loopback before this existed: writing
   * 400 chunks in a tight loop delivered 97 of them, because 542 KB arrived at the relay faster
   * than any kernel receive buffer could absorb and the rest were discarded before the relay's
   * process ever saw them. An encoder emits in bursts - a keyframe is twenty times an inter-frame -
   * so smoothing those bursts is the sender's job, not the receiver's problem.
   */
  readonly paceBps?: number;
  /** Overridable for tests. */
  readonly now?: () => number;
}

export interface BondClientEvents {
  /** The engine changed its mind about paths or allocation. */
  decision: BondDecision;
  /** A path left service. */
  pathLost: { pathId: number; label: string };
  /** A path entered service. */
  pathUp: { pathId: number; label: string };
  /** Something the creator may need to know. Never jargon. */
  health: { health: BondDecision['health']; reason: string };
  error: Error;
}

interface LivePath {
  readonly id: number;
  readonly spec: BondPathSpec;
  socket: Socket;
  state: PathState;
  capacity: CapacityEstimate | undefined;
  /** Bytes handed to the socket since the last sample. */
  sentBytes: number;
  deliveredBytes: number;
  rttMs: number;
  jitterMs: number;
  loss: number;
  lastAckAt: number;
  failures: number;
  offeredBps: number;
}

/**
 * A live Bond session.
 *
 * Owns the sockets, the session key, the path registry, the schedule and the policy loop. One
 * instance per broadcast.
 */
export class BondClient extends TypedEmitter<BondClientEvents> {
  private readonly options: BondClientOptions;
  private readonly now: () => number;
  private readonly sessionId = newSessionId();
  private channel: SecureChannel | null = null;
  private pending: PendingHandshake | null = null;
  private readonly paths = new Map<number, LivePath>();
  private nextPathId = 1;
  private seq = 0;
  private scheduler = new BondScheduler();
  private decision: BondDecision | null = null;
  private decisionAt = 0;
  private policyTimer: ReturnType<typeof setInterval> | null = null;
  private residue = Buffer.alloc(0);
  private closed = false;
  /** Datagrams waiting for pacing tokens. Bounded; see `enqueue`. */
  private outbox: { datagram: Buffer; path: LivePath }[] = [];
  private paceTokens = 0;
  private lastPaceAt = 0;
  private paceTimer: ReturnType<typeof setInterval> | null = null;
  private droppedForPace = 0;

  constructor(options: BondClientOptions) {
    super();
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  get sessionIdValue(): bigint {
    return this.sessionId;
  }

  /**
   * Open the session over one path.
   *
   * The handshake runs on the FIRST path only. Everything after it joins with a cheap
   * authenticated PATH_HELLO, which is what makes adding a path mid-broadcast - the Wi-Fi-just-died
   * case - fast enough to be worth doing.
   */
  async connect(spec: BondPathSpec = { transport: 'other', label: 'Network', metered: 'unknown' }): Promise<void> {
    const path = await this.openSocket(spec);
    const hello = clientHello({
      relayStaticPublic: this.options.relayStaticPublic,
      tokenBlob: this.options.tokenBlob,
      sessionId: this.sessionId,
    });
    this.pending = hello.pending;

    const header = encodeHeader({
      version: BOND_VERSION,
      type: FrameType.HELLO,
      pathId: path.id,
      counter: 0n,
      sessionId: this.sessionId,
    });

    const sessionKey = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the relay did not answer within 5 s')), 5000);
      const onMessage = (datagram: Buffer): void => {
        const parsed = decodeHeader(datagram);
        if (!parsed || parsed.type !== FrameType.WELCOME) return;
        const key = clientFinish(this.pending!, datagram.subarray(HEADER_BYTES));
        if (!key) {
          // Not from the relay we dialled. Keep waiting rather than trusting it.
          return;
        }
        clearTimeout(timer);
        path.socket.off('message', onMessage);
        resolve(key);
      };
      path.socket.on('message', onMessage);
      path.socket.send(Buffer.concat([header, hello.datagram]), this.options.relayPort, this.options.relayHost, (error) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });

    this.channel = new SecureChannel(sessionKey);
    path.state = 'HEALTHY';
    this.listen(path);
    this.emit('pathUp', { pathId: path.id, label: spec.label });
    this.startPolicyLoop();
    this.reconsider();
  }

  /**
   * Add a path to a session that is already running.
   *
   * No second handshake: `PATH_HELLO` is sealed under the session key, which proves possession of
   * it, which is exactly the property that matters. A path that cannot produce a valid PATH_HELLO
   * is not a path of this session.
   */
  async addPath(spec: BondPathSpec): Promise<number> {
    if (!this.channel) throw new Error('connect() first: there is no session to add a path to');
    const path = await this.openSocket(spec);
    const counter = this.channel.nextCounter(path.id);
    const header = encodeHeader({
      version: BOND_VERSION,
      type: FrameType.PATH_HELLO,
      pathId: path.id,
      counter,
      sessionId: this.sessionId,
    });
    const sealed = this.channel.sealRecord(header, path.id, counter, Buffer.from(spec.label, 'utf8'));
    path.socket.send(Buffer.concat([header, sealed]), this.options.relayPort, this.options.relayHost);
    path.state = 'TESTING';
    this.listen(path);
    return path.id;
  }

  /**
   * Hand Bond a run of MPEG-TS bytes.
   *
   * Never throws and never blocks. A caller in the media pipeline must be able to treat this like
   * writing to a socket that always accepts, because the alternative is back-pressure reaching the
   * encoder - and an encoder that stalls because the network had an opinion is the failure this
   * whole layer exists to prevent.
   */
  write(ts: Buffer): void {
    if (this.closed || !this.channel) return;
    const joined = this.residue.length > 0 ? Buffer.concat([this.residue, ts]) : ts;
    const { chunks, rest } = chunkTs(joined);
    this.residue = Buffer.from(rest);
    for (const chunk of chunks) this.sendChunk(chunk);
  }

  private sendChunk(payload: Buffer): void {
    const channel = this.channel;
    if (!channel) return;

    const randomAccess = hasRandomAccessPoint(payload);
    const seq = this.seq++;
    const assignment = this.scheduler.assign({
      seq,
      timestampUs: 0,
      frameType: randomAccess ? 'key' : 'inter',
      bytes: payload.length,
    });

    if (assignment.paths.length === 0) {
      // Nowhere to send it. Honest silence: the policy loop already knows and has said so.
      return;
    }

    const body = Buffer.allocUnsafe(DATA_PREFIX + payload.length);
    body.writeUInt32BE(seq, 0);
    body.writeUInt8((randomAccess ? FLAG_RANDOM_ACCESS : 0), SEQ_BYTES);
    payload.copy(body, DATA_PREFIX);

    for (const [index, handle] of assignment.paths.entries()) {
      const path = this.paths.get(Number(handle));
      if (!path) continue;
      if (index > 0) body.writeUInt8(body.readUInt8(SEQ_BYTES) | FLAG_DUPLICATE, SEQ_BYTES);

      try {
        const counter = channel.nextCounter(path.id);
        const header = encodeHeader({
          version: BOND_VERSION,
          type: FrameType.DATA,
          pathId: path.id,
          counter,
          sessionId: this.sessionId,
        });
        const sealed = channel.sealRecord(header, path.id, counter, body);
        this.enqueue(Buffer.concat([header, sealed]), path);
      } catch (error) {
        // Counter exhaustion, or a socket that died between the check and the send. Neither is a
        // reason to take the broadcast down.
        this.notePathTrouble(path);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /** Current view of every path, in the shape the policy engine consumes. */
  snapshot(): NetworkPath[] {
    const streamBitrate = this.options.streamBitrateBps ?? 6_000_000;
    return [...this.paths.values()].map((path) => ({
      handle: String(path.id),
      transport: path.spec.transport,
      label: path.spec.label,
      state: path.state,
      metered: path.spec.metered,
      independence: 'declared' as const,
      failureCount: path.failures,
      estimatedCapacityBps: path.capacity?.bps,
      sample: {
        at: this.now(),
        throughputBps: path.deliveredBytes * 8,
        rttMs: path.rttMs,
        jitterMs: path.jitterMs,
        loss: path.loss,
        retransmitRate: path.loss,
        atCapacity: path.loss > 0.02 && path.offeredBps > 0,
      },
      ...(streamBitrate ? {} : {}),
    }));
  }

  telemetry(): BondClientTelemetry {
    const decision = this.decision;
    return {
      sessionId: this.sessionId.toString(16),
      mode: decision?.mode ?? 'single',
      health: decision?.health ?? 'offline',
      reason: decision?.reason ?? 'Starting up.',
      aggregateBps: [...this.paths.values()].reduce((sum, p) => sum + p.deliveredBytes * 8, 0),
      headroomBps: decision?.targetHeadroomBps ?? 0,
      encoderCeilingBps: decision?.encoderCeilingBps ?? 0,
      paths: [...this.paths.values()].map((path) => ({
        pathId: path.id,
        label: path.spec.label,
        transport: path.spec.transport,
        state: path.state,
        metered: path.spec.metered,
        throughputBps: path.deliveredBytes * 8,
        rttMs: path.rttMs,
        loss: path.loss,
        share: decision?.active.find((a) => a.handle === String(path.id))?.share ?? 0,
        standby: decision?.active.find((a) => a.handle === String(path.id))?.standby ?? false,
      })),
      droppedForPace: this.droppedForPace,
      scheduler: this.scheduler.stats(),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.policyTimer) clearInterval(this.policyTimer);
    /*
     * Send whatever is still queued before saying goodbye. These are the last seconds of the
     * broadcast and the pacing budget no longer matters; what matters is that the end of the stream
     * is not thrown away because a timer stopped.
     */
    if (this.paceTimer) clearInterval(this.paceTimer);
    this.paceTimer = null;
    for (const pending of this.outbox) this.transmit(pending.datagram, pending.path);
    this.outbox = [];
    await new Promise((resolve) => setTimeout(resolve, 50));

    const channel = this.channel;
    for (const path of this.paths.values()) {
      try {
        if (channel) {
          const counter = channel.nextCounter(path.id);
          const header = encodeHeader({
            version: BOND_VERSION,
            type: FrameType.BYE,
            pathId: path.id,
            counter,
            sessionId: this.sessionId,
          });
          const sealed = channel.sealRecord(header, path.id, counter, Buffer.alloc(0));
          /*
           * WAIT FOR THE GOODBYE TO LEAVE before closing the socket.
           *
           * `send` is asynchronous, so closing immediately after it can discard the datagram while
           * it is still queued - which made an orderly shutdown depend on timing luck. The relay
           * then holds the session open until its idle timeout and the tail of the broadcast sits
           * in a reorder buffer nobody is draining. Ending a stream is the one operation a creator
           * is entitled to have work every single time.
           */
          await new Promise<void>((resolve) => {
            path.socket.send(
              Buffer.concat([header, sealed]),
              this.options.relayPort,
              this.options.relayHost,
              () => resolve(),
            );
          });
        }
      } catch {
        // A path that cannot say goodbye is a path that is already gone. Not worth reporting.
      }
      await new Promise<void>((resolve) => path.socket.close(() => resolve()));
    }
    this.paths.clear();
  }

  // -------------------------------------------------------------------------------------------

  private async openSocket(spec: BondPathSpec): Promise<LivePath> {
    const id = this.nextPathId++;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      // Binding to a specific local address IS per-path binding on a desktop: the OS routes by
      // source address, so two sockets bound to two interfaces genuinely leave by two interfaces.
      socket.bind({ address: spec.localAddress, port: 0 }, () => {
        socket.off('error', reject);
        resolve();
      });
    });

    const path: LivePath = {
      id,
      spec,
      socket,
      state: 'DISCOVERING',
      capacity: undefined,
      sentBytes: 0,
      deliveredBytes: 0,
      rttMs: 0,
      jitterMs: 0,
      loss: 0,
      lastAckAt: this.now(),
      failures: 0,
      offeredBps: 0,
    };
    this.paths.set(id, path);
    socket.on('error', () => this.notePathTrouble(path));
    return path;
  }

  private listen(path: LivePath): void {
    path.socket.on('message', (datagram) => {
      const header = decodeHeader(datagram);
      if (!header || !this.channel) return;
      if (header.sessionId !== this.sessionId) return;
      if (header.type !== FrameType.ACK) return;

      const body = this.channel.openRecord(
        datagram.subarray(0, HEADER_BYTES),
        header.pathId,
        header.counter,
        datagram.subarray(HEADER_BYTES),
      );
      if (!body || body.length < 20) return;

      const delivered = body.readUInt32BE(4);
      const lost = body.readUInt32BE(8);
      const sentAtEcho = body.readBigUInt64BE(12);

      const now = this.now();
      const rtt = Math.max(0, now - Number(sentAtEcho));
      path.jitterMs = path.rttMs === 0 ? 0 : Math.abs(rtt - path.rttMs);
      path.rttMs = path.rttMs === 0 ? rtt : path.rttMs * 0.8 + rtt * 0.2;
      path.deliveredBytes = delivered;
      path.loss = delivered + lost > 0 ? lost / (delivered + lost) : 0;
      path.lastAckAt = now;
      if (path.state === 'TESTING' || path.state === 'RECOVERING' || path.state === 'DISCOVERING') {
        path.state = 'HEALTHY';
        this.emit('pathUp', { pathId: path.id, label: path.spec.label });
      }
    });
  }

  private notePathTrouble(path: LivePath): void {
    if (path.state === 'FAILED') return;
    path.state = 'FAILED';
    path.failures += 1;
    path.capacity = { bps: 0, measured: true };
    this.emit('pathLost', { pathId: path.id, label: path.spec.label });
    this.reconsider();
  }

  /**
   * Queue a datagram, sending immediately when there are tokens for it.
   *
   * The fast path is synchronous: a well-behaved encoder producing at real time always has tokens
   * waiting, so pacing adds no latency at all in the normal case. The queue only fills during a
   * burst, and it is bounded - when it overflows the OLDEST datagram is dropped, because in live
   * media the newest frame is the one a viewer is waiting for and an old one that has not left yet
   * is already too late to be worth the bandwidth.
   *
   * A drop here is real loss and is reported as such. The relay will see the gap, the reassembler
   * will count it, and the creator's health will reflect it. That is the point: a sender that
   * silently discarded media would be exactly the dishonesty this layer forbids.
   */
  private enqueue(datagram: Buffer, path: LivePath): void {
    this.refillTokens();
    if (this.outbox.length === 0 && this.paceTokens >= datagram.length) {
      this.paceTokens -= datagram.length;
      this.transmit(datagram, path);
      return;
    }

    this.outbox.push({ datagram, path });
    const ceiling = this.outboxCeiling();
    while (this.outbox.length > ceiling) {
      this.outbox.shift();
      this.droppedForPace += 1;
    }
    this.startPacer();
  }

  /** About two seconds of the stream. Long enough to smooth a keyframe, short enough to stay live. */
  private outboxCeiling(): number {
    const bitrate = this.options.streamBitrateBps ?? 6_000_000;
    return Math.max(64, Math.ceil((bitrate * 2) / 8 / CHUNK_PAYLOAD_BYTES));
  }

  private refillTokens(): void {
    const now = this.now();
    if (this.lastPaceAt === 0) {
      this.lastPaceAt = now;
      // Start with one burst's worth so the first keyframe does not wait for tokens to accrue.
      this.paceTokens = this.burstBytes();
      return;
    }
    const elapsed = Math.max(0, now - this.lastPaceAt);
    this.lastPaceAt = now;
    const perMs = this.paceBytesPerSecond() / 1000;
    this.paceTokens = Math.min(this.burstBytes(), this.paceTokens + elapsed * perMs);
  }

  private paceBytesPerSecond(): number {
    const bps = this.options.paceBps ?? (this.options.streamBitrateBps ?? 6_000_000) * 3;
    return bps / 8;
  }

  /** How far ahead of the pace a burst may run. 256 KB is a large keyframe and then some. */
  private burstBytes(): number {
    return 256 * 1024;
  }

  private startPacer(): void {
    if (this.paceTimer || this.closed) return;
    this.paceTimer = setInterval(() => this.drainOutbox(), 2);
    this.paceTimer.unref?.();
  }

  private drainOutbox(): void {
    this.refillTokens();
    while (this.outbox.length > 0) {
      const next = this.outbox[0]!;
      if (this.paceTokens < next.datagram.length) break;
      this.paceTokens -= next.datagram.length;
      this.outbox.shift();
      this.transmit(next.datagram, next.path);
    }
    if (this.outbox.length === 0 && this.paceTimer) {
      clearInterval(this.paceTimer);
      this.paceTimer = null;
    }
  }

  private transmit(datagram: Buffer, path: LivePath): void {
    path.sentBytes += datagram.length;
    path.socket.send(datagram, this.options.relayPort, this.options.relayHost, (error) => {
      if (error) this.notePathTrouble(path);
    });
  }

  private startPolicyLoop(): void {
    if (this.policyTimer) return;
    this.policyTimer = setInterval(() => this.reconsider(), 500);
    // Never let the policy loop hold the process open: a broadcast that has ended must be able to
    // exit even if something forgot to close the client.
    this.policyTimer.unref?.();
  }

  /** One turn of the engine: measure, classify, decide, apply. */
  private reconsider(): void {
    if (this.closed) return;
    const now = this.now();
    const streamBitrateBps = this.options.streamBitrateBps ?? 6_000_000;
    const ceiling = usefulCeilingFor(streamBitrateBps);

    for (const path of this.paths.values()) {
      // A path that has stopped acknowledging is a path that has stopped carrying.
      if (path.state === 'HEALTHY' && now - path.lastAckAt > 3000) {
        this.notePathTrouble(path);
        continue;
      }
      const sample = {
        at: now,
        throughputBps: path.deliveredBytes * 8,
        rttMs: path.rttMs,
        jitterMs: path.jitterMs,
        loss: path.loss,
        retransmitRate: path.loss,
        atCapacity: path.loss > 0.02 && path.offeredBps > 0,
      };
      path.capacity = estimateCapacity({
        previous: path.capacity,
        sample,
        offeredBps: path.offeredBps,
        ceilingBps: ceiling,
      });
      if (path.state === 'HEALTHY' || path.state === 'DEGRADED' || path.state === 'SATURATED') {
        path.state = classifySample(sample, { baselineRttMs: path.rttMs || undefined, recentTransitions: 0 });
      }
    }

    const decision = decide({
      paths: this.snapshot(),
      policy: this.options.policy ?? DEFAULT_BOND_POLICY,
      streamBitrateBps,
      now,
      previous: this.decision ?? undefined,
      previousAt: this.decision ? this.decisionAt : undefined,
    });

    const changed =
      !this.decision ||
      this.decision.mode !== decision.mode ||
      this.decision.health !== decision.health ||
      this.decision.active.length !== decision.active.length;

    if (changed) this.decisionAt = now;
    this.decision = decision;
    this.scheduler.update(decision);

    for (const path of this.paths.values()) {
      const allocation = decision.active.find((a) => a.handle === String(path.id));
      path.offeredBps = allocation && !allocation.standby ? allocation.share * streamBitrateBps : 0;
    }

    if (changed) {
      this.emit('decision', decision);
      this.emit('health', { health: decision.health, reason: decision.reason });
    }
  }
}

export interface BondPathTelemetry {
  readonly pathId: number;
  readonly label: string;
  readonly transport: PathTransport;
  readonly state: PathState;
  readonly metered: MeteredState;
  readonly throughputBps: number;
  readonly rttMs: number;
  readonly loss: number;
  readonly share: number;
  readonly standby: boolean;
}

export interface BondClientTelemetry {
  readonly sessionId: string;
  readonly mode: BondDecision['mode'];
  readonly health: BondDecision['health'];
  readonly reason: string;
  readonly aggregateBps: number;
  readonly headroomBps: number;
  readonly encoderCeilingBps: number;
  /** Datagrams the sender dropped because its queue overflowed. Real loss, reported as such. */
  readonly droppedForPace: number;
  readonly paths: readonly BondPathTelemetry[];
  readonly scheduler: ReturnType<BondScheduler['stats']>;
}

/**
 * Real desktop path discovery.
 *
 * Every non-internal IPv4 address the OS is offering is a candidate local bind address, and binding
 * a UDP socket to one is genuinely per-path routing: the kernel picks the egress interface from the
 * source address. This is the desktop equivalent of Android's `Network.getSocketFactory()`.
 *
 * Deliberately conservative about what it calls a path. Loopback is excluded (it goes nowhere),
 * link-local 169.254/16 is excluded (it means DHCP failed), and virtual adapters are reported with
 * transport `other` rather than guessed at, because a VPN or a hypervisor bridge usually egresses
 * through an interface already in the list and counting it twice would be the exact over-claim the
 * path-versus-radio rule forbids.
 */
export function discoverDesktopPaths(): BondPathSpec[] {
  const found: BondPathSpec[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4') continue;
      if (address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      found.push({
        localAddress: address.address,
        transport: classifyInterface(name),
        label: prettyName(name),
        metered: 'unknown',
      });
    }
  }
  return found;
}

function classifyInterface(name: string): PathTransport {
  const lower = name.toLowerCase();
  if (/(wi-?fi|wlan|wlp|wireless)/.test(lower)) return 'wifi';
  if (/(ethernet|^eth|enp|eno|ens)/.test(lower)) return 'ethernet';
  if (/(cellular|wwan|rmnet|modem|lte|5g)/.test(lower)) return 'cellular';
  if (/(usb|rndis|ncm|tether)/.test(lower)) return 'usb';
  return 'other';
}

function prettyName(name: string): string {
  const transport = classifyInterface(name);
  if (transport === 'wifi') return 'Wi-Fi';
  if (transport === 'ethernet') return 'Ethernet';
  if (transport === 'cellular') return 'Mobile data';
  if (transport === 'usb') return 'USB tether';
  return name;
}

export { CHUNK_PAYLOAD_BYTES, HEADER_BYTES, TAG_BYTES };
