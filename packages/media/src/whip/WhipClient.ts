/**
 * WhipClient - WHIP (WebRTC-HTTP Ingestion Protocol, draft-ietf-wish-whip / RFC 9725) publisher.
 *
 * Flow:
 *   1. Create an RTCPeerConnection with sendonly transceivers for the tracks we publish.
 *   2. Prefer H.264 (every WHIP ingest and every RTMP relay speaks it) and cap the bitrate.
 *   3. createOffer + setLocalDescription, then gather ICE with a 2s cap (trickle-less fallback:
 *      whatever candidates we have at the deadline are sent).
 *   4. POST the offer SDP with `Content-Type: application/sdp` (+ optional bearer token).
 *   5. Expect 201 Created + `Location` (the resource URL) + the answer SDP in the body.
 *   6. DELETE the resource URL to end the session.
 *   7. ICE restart via PATCH only when the server advertised `Accept-Patch:
 *      application/trickle-ice-sdpfrag`; otherwise the caller reconnects from scratch.
 *
 * Everything is injected (RTCPeerConnection constructor, fetch, timers) so this is unit-testable
 * without a browser.
 */
import { TypedEmitter } from '@livetap/core';
import type { ErrorCode, OutputFormat } from '@livetap/core';

export interface FetchResponseLike {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;

export type RTCPeerConnectionCtor = new (config?: RTCConfiguration) => RTCPeerConnection;

export interface WhipClientOptions {
  /** WHIP endpoint URL (the ingest URL the destination gave us). */
  endpoint: string;
  /** Bearer token (WHIP auth). Never logged. */
  token?: string;
  /** Tracks to publish. When omitted, `stream.getTracks()` is used. */
  tracks?: MediaStreamTrack[];
  stream?: MediaStream | null;
  /** Drives maxBitrate / maxFramerate on the video sender. */
  format?: OutputFormat;
  RTCPeerConnectionCtor: RTCPeerConnectionCtor;
  fetch: FetchLike;
  iceServers?: RTCIceServer[];
  /** How long to wait for full ICE gathering before sending what we have. Default 2000ms. */
  iceGatheringTimeoutMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  now?: () => number;
}

export interface WhipEvents extends Record<string, unknown> {
  /** SDP exchange completed (HTTP 201 + answer applied). Media may not be flowing yet. */
  negotiated: { resourceUrl: string | null; status: number };
  /** ICE reached connected/completed - media is flowing. */
  connected: { resourceUrl: string | null };
  /** ICE failed/disconnected/closed, or the session was closed locally. */
  disconnected: { reason: string; code: ErrorCode };
  state: { ice: string; connection: string };
}

export class WhipError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;

  constructor(message: string, code: ErrorCode, status?: number) {
    super(message);
    this.name = 'WhipError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_ICE_TIMEOUT_MS = 2000;
const TRICKLE_ICE_FRAGMENT = 'application/trickle-ice-sdpfrag';

export class WhipClient extends TypedEmitter<WhipEvents> {
  private readonly options: WhipClientOptions;
  private readonly fetchFn: FetchLike;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;

  private pc: RTCPeerConnection | null = null;
  private resource: string | null = null;
  private acceptsIceRestart = false;
  private connectedEmitted = false;
  private closed = false;
  private advertised: RTCIceServer[] = [];

  constructor(options: WhipClientOptions) {
    super();
    this.options = options;
    this.fetchFn = options.fetch;
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** The WHIP resource URL from the `Location` header; null when the server did not send one. */
  get resourceUrl(): string | null {
    return this.resource;
  }

  /** True when the server advertised `Accept-Patch: application/trickle-ice-sdpfrag`. */
  get supportsIceRestart(): boolean {
    return this.acceptsIceRestart;
  }

  /** ICE servers the server advertised through `Link` headers (RFC 9725 section 4.1). */
  get advertisedIceServers(): RTCIceServer[] {
    return this.advertised;
  }

  get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Publish. Resolves once the SDP exchange succeeded and the answer is applied.
   * Throws WhipError (with `status` for HTTP failures) - the caller turns that into an
   * `outputLost` event rather than letting it escape.
   */
  async publish(): Promise<void> {
    if (this.closed) throw new WhipError('WHIP session already closed', 'CONFIG_INVALID');
    const endpoint = this.options.endpoint;
    if (!/^https?:\/\//i.test(endpoint)) {
      throw new WhipError('WHIP endpoint must be an http(s) URL', 'CONFIG_INVALID');
    }

    const pc = new this.options.RTCPeerConnectionCtor({
      iceServers: this.options.iceServers ?? [],
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;
    this.wireStateEvents(pc);

    const tracks = this.options.tracks ?? this.options.stream?.getTracks() ?? [];
    this.addTransceivers(pc, tracks);
    this.preferH264(pc);

    let offerSdp: string;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitForIceGathering(pc);
      offerSdp = pc.localDescription?.sdp ?? offer.sdp ?? '';
    } catch (err) {
      throw new WhipError(`Could not create a WHIP offer: ${describe(err)}`, 'ENCODER_FAILED');
    }
    if (!offerSdp) throw new WhipError('Empty local SDP offer', 'ENCODER_FAILED');

    let response: FetchResponseLike;
    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/sdp', Accept: 'application/sdp' }),
        body: offerSdp,
      });
    } catch (err) {
      throw new WhipError(`WHIP endpoint unreachable: ${describe(err)}`, 'NETWORK_OFFLINE');
    }

    if (response.status < 200 || response.status >= 300) {
      const body = await safeText(response);
      throw new WhipError(
        `WHIP POST failed with ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        codeForStatus(response.status),
        response.status,
      );
    }

    this.resource = resolveLocation(response.headers.get('location'), endpoint);
    this.acceptsIceRestart = (response.headers.get('accept-patch') ?? '').includes(TRICKLE_ICE_FRAGMENT);
    this.advertised = parseLinkIceServers(response.headers.get('link'));

    const answer = await safeText(response);
    if (!answer.includes('v=0')) {
      throw new WhipError('WHIP server returned no SDP answer', 'INGEST_REFUSED', response.status);
    }
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (err) {
      throw new WhipError(`WHIP answer rejected locally: ${describe(err)}`, 'INGEST_REFUSED', response.status);
    }

    await this.applyBitrate(pc);
    this.emit('negotiated', { resourceUrl: this.resource, status: response.status });
    // Some stacks are already connected by the time the answer lands.
    this.maybeEmitConnected(pc);
  }

  /**
   * ICE restart. Returns false when the server did not advertise PATCH support (or the PATCH
   * failed) - the caller should then tear down and publish a fresh session.
   */
  async restartIce(): Promise<boolean> {
    const pc = this.pc;
    if (!pc || this.closed || !this.acceptsIceRestart || !this.resource) return false;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await this.waitForIceGathering(pc);
      const sdp = pc.localDescription?.sdp ?? offer.sdp ?? '';
      const fragment = buildIceFragment(sdp);
      if (!fragment) return false;
      const res = await this.fetchFn(this.resource, {
        method: 'PATCH',
        headers: this.headers({ 'Content-Type': TRICKLE_ICE_FRAGMENT }),
        body: fragment,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async getStats(): Promise<RTCStatsReport | null> {
    try {
      return (await this.pc?.getStats()) ?? null;
    } catch {
      return null;
    }
  }

  /** End the session: DELETE the resource (best effort) and close the peer connection. */
  async close(reason = 'closed locally'): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const resource = this.resource;
    if (resource) {
      try {
        await this.fetchFn(resource, { method: 'DELETE', headers: this.headers({}) });
      } catch {
        /* the session is gone either way */
      }
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.emit('disconnected', { reason, code: 'INGEST_DISCONNECTED' });
  }

  // ------------------------------------------------------------------ internals

  private headers(extra: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    return headers;
  }

  private addTransceivers(pc: RTCPeerConnection, tracks: MediaStreamTrack[]): void {
    const streams = this.options.stream ? [this.options.stream] : [];
    let added = 0;
    for (const track of tracks) {
      try {
        pc.addTransceiver(track, { direction: 'sendonly', streams });
        added += 1;
      } catch {
        /* a track that cannot be added must not abort the whole session */
      }
    }
    if (added === 0) {
      // No live tracks yet (headless / preview not ready): still offer sendonly m-lines so the
      // server can answer and we can replace the tracks later.
      for (const kind of ['video', 'audio'] as const) {
        try {
          pc.addTransceiver(kind, { direction: 'sendonly' });
        } catch {
          /* ignore */
        }
      }
    }
  }

  private preferH264(pc: RTCPeerConnection): void {
    try {
      const senderCaps = (globalThis as { RTCRtpSender?: { getCapabilities?: (k: string) => RTCRtpCapabilities | null } })
        .RTCRtpSender;
      const caps = senderCaps?.getCapabilities?.('video');
      const codecs = caps?.codecs;
      if (!codecs || codecs.length === 0) return;
      const h264 = codecs.filter((c) => /h264/i.test(c.mimeType));
      if (h264.length === 0) return;
      const ordered = [...h264, ...codecs.filter((c) => !/h264/i.test(c.mimeType))];
      for (const transceiver of pc.getTransceivers()) {
        const kind = transceiver.sender?.track?.kind ?? transceiver.receiver?.track?.kind;
        if (kind && kind !== 'video') continue;
        transceiver.setCodecPreferences?.(ordered);
      }
    } catch {
      /* codec preferences are an optimisation, never a requirement */
    }
  }

  private async applyBitrate(pc: RTCPeerConnection): Promise<void> {
    const format = this.options.format;
    if (!format) return;
    for (const sender of safeSenders(pc)) {
      if (sender.track && sender.track.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        const encodings = params.encodings && params.encodings.length > 0 ? params.encodings : [{}];
        const first = encodings[0];
        if (first) {
          first.maxBitrate = Math.round(format.videoKbps * 1000);
          first.maxFramerate = format.fps;
        }
        await sender.setParameters({ ...params, encodings });
      } catch {
        /* older stacks reject setParameters before negotiation; the encoder default is fine */
      }
    }
  }

  private wireStateEvents(pc: RTCPeerConnection): void {
    const report = (): void => {
      this.emit('state', { ice: String(pc.iceConnectionState), connection: String(pc.connectionState ?? '') });
    };
    const onChange = (): void => {
      report();
      const ice = String(pc.iceConnectionState);
      const conn = String(pc.connectionState ?? '');
      if (ice === 'connected' || ice === 'completed' || conn === 'connected') {
        this.maybeEmitConnected(pc);
        return;
      }
      if (ice === 'failed' || ice === 'disconnected' || ice === 'closed' || conn === 'failed') {
        if (this.closed) return;
        this.emit('disconnected', {
          reason: `ICE ${ice}${conn ? ` / connection ${conn}` : ''}`,
          code: 'INGEST_DISCONNECTED',
        });
      }
    };
    try {
      pc.oniceconnectionstatechange = onChange;
      pc.onconnectionstatechange = onChange;
    } catch {
      /* fakes may not expose the setters */
    }
  }

  private maybeEmitConnected(pc: RTCPeerConnection): void {
    const ice = String(pc.iceConnectionState ?? '');
    const conn = String(pc.connectionState ?? '');
    const up = ice === 'connected' || ice === 'completed' || conn === 'connected';
    if (!up || this.connectedEmitted || this.closed) return;
    this.connectedEmitted = true;
    this.emit('connected', { resourceUrl: this.resource });
  }

  /**
   * Wait for ICE gathering to complete, but never longer than `iceGatheringTimeoutMs`.
   * On timeout we publish the candidates gathered so far (trickle-less WHIP tolerates this).
   */
  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    const timeoutMs = this.options.iceGatheringTimeoutMs ?? DEFAULT_ICE_TIMEOUT_MS;
    if (String(pc.iceGatheringState) === 'complete') return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.clearTimeoutFn(timer);
        try {
          pc.onicegatheringstatechange = null;
          pc.onicecandidate = null;
        } catch {
          /* ignore */
        }
        resolve();
      };
      const timer = this.setTimeoutFn(finish, Math.max(0, timeoutMs));
      const check = (): void => {
        if (String(pc.iceGatheringState) === 'complete') finish();
      };
      try {
        pc.onicegatheringstatechange = check;
        pc.onicecandidate = (event) => {
          if (!event.candidate) finish();
        };
      } catch {
        finish();
      }
      check();
    });
  }
}

// -------------------------------------------------------------------- helpers

/** HTTP status to LIVETAP ErrorCode. 401/403 means the stream key / bearer token is wrong. */
export function codeForStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'INGEST_INVALID_KEY';
  if (status === 404 || status === 405 || status === 406 || status === 415) return 'INGEST_REFUSED';
  if (status === 408 || status === 504) return 'INGEST_TIMEOUT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PLATFORM_ERROR';
  if (status >= 400) return 'INGEST_REFUSED';
  return 'UNKNOWN';
}

/** Resolve a possibly-relative `Location` header against the endpoint. */
export function resolveLocation(location: string | null, endpoint: string): string | null {
  if (!location) return null;
  try {
    return new URL(location, endpoint).toString();
  } catch {
    return null;
  }
}

/**
 * Build a trickle-ICE SDP fragment for a PATCH ICE restart.
 * Best effort: mid / ufrag / pwd / candidate lines per m-section.
 */
export function buildIceFragment(sdp: string): string | null {
  if (!sdp) return null;
  const lines = sdp.split(/\r?\n/);
  const out: string[] = [];
  let sawSection = false;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      sawSection = true;
      out.push(line);
      continue;
    }
    if (!sawSection) continue;
    if (
      line.startsWith('a=mid:') ||
      line.startsWith('a=ice-ufrag:') ||
      line.startsWith('a=ice-pwd:') ||
      line.startsWith('a=candidate:') ||
      line.startsWith('a=end-of-candidates')
    ) {
      out.push(line);
    }
  }
  if (out.length === 0) return null;
  return `${out.join('\r\n')}\r\n`;
}

/** Parse `Link: <turn:...>; rel="ice-server"; username="..."; credential="..."` headers. */
export function parseLinkIceServers(header: string | null): RTCIceServer[] {
  if (!header) return [];
  const servers: RTCIceServer[] = [];
  for (const part of header.split(/,(?=\s*<)/)) {
    const urlMatch = /<([^>]+)>/.exec(part);
    if (!urlMatch || !urlMatch[1]) continue;
    if (!/rel\s*=\s*"?ice-server"?/i.test(part)) continue;
    const server: RTCIceServer = { urls: urlMatch[1] };
    const username = /username\s*=\s*"([^"]*)"/i.exec(part);
    const credential = /credential\s*=\s*"([^"]*)"/i.exec(part);
    if (username?.[1]) server.username = username[1];
    if (credential?.[1]) server.credential = credential[1];
    servers.push(server);
  }
  return servers;
}

function safeSenders(pc: RTCPeerConnection): RTCRtpSender[] {
  try {
    return pc.getSenders?.() ?? [];
  } catch {
    return [];
  }
}

async function safeText(response: FetchResponseLike): Promise<string> {
  try {
    return (await response.text()) ?? '';
  } catch {
    return '';
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
