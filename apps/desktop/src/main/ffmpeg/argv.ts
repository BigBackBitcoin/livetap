/**
 * FFmpeg argv builders.
 *
 * Everything that ever reaches a child process is built here, as an ARRAY of arguments, by pure
 * functions with no I/O. There is no string concatenation of a command line anywhere in the desktop
 * app and `spawn` is always called without `shell`, so shell metacharacters have no meaning. These
 * builders additionally REFUSE suspicious input as a second line of defence (defence in depth for
 * the day someone adds a shell somewhere, and to catch corrupt config early with a clear error).
 *
 * Topology these argv describe (see docs/architecture/DESKTOP_ARCHITECTURE.md):
 *
 *   renderer MediaRecorder(h264/opus)                       ┌─ sender A: -c copy -f flv  → rtmp://a
 *        │ IPC chunks                                       │
 *        ▼                                                  ├─ sender B: -c copy -f flv  → rtmps://b
 *   encoder ffmpeg: -f matroska -i pipe:0                    │
 *        -c:v copy  -c:a aac  -f mpegts pipe:1 ──► fan-out ──┼─ sender C: -c copy -f mpegts → srt://c
 *                                                            │
 *                                                            └─ recorder: -c copy -f mp4  → file
 *
 * One encode per aspect ratio. Senders never re-encode, so adding, removing or restarting one
 * destination costs one tiny process and never touches the encoder or the other destinations.
 */

import type { AspectRatio, IngestTarget } from '@livetap/core';
import type { EncoderSettings, OutputFormat } from '@livetap/core';
import { composeRtmpPublishUrl, validateIngest } from '@livetap/core';

/** Thrown when a caller tries to build argv from input that was not validated or is hostile. */
export class ArgvRefusedError extends Error {
  readonly reasons: string[];
  constructor(message: string, reasons: string[] = []) {
    super(message);
    this.name = 'ArgvRefusedError';
    this.reasons = reasons;
  }
}

/**
 * Characters that must never appear in a URL, path or option value we hand to a child process.
 * A URL containing any of these is either corrupt or an injection attempt; either way we refuse.
 * (`|` and `:` are meaningful to the tee muxer, `;&$<>` to shells, quotes/backticks to both.)
 */
const HOSTILE = /[\s"'`$;|&<>\\^*?()[\]{}\r\n\t\0]/;

/** Refuse anything that is not a clean single-token value. */
export function assertCleanToken(value: string, what: string): void {
  if (value.length === 0) throw new ArgvRefusedError(`${what} is empty.`);
  if (value.length > 2048) throw new ArgvRefusedError(`${what} is too long.`);
  const match = HOSTILE.exec(value);
  if (match) {
    throw new ArgvRefusedError(`${what} contains a character that is not allowed.`, [
      `illegal character ${JSON.stringify(match[0])} at index ${match.index}`,
    ]);
  }
  if (value.startsWith('-')) {
    // A value starting with `-` would be parsed by ffmpeg as another option.
    throw new ArgvRefusedError(`${what} must not start with "-".`);
  }
}

/**
 * Same idea as `assertCleanToken`, for a composed URL.
 *
 * URLs legitimately contain `?`, `=`, `%` and `&`, which `assertCleanToken` refuses — and they have
 * to, because SRT carries `streamid`/`passphrase` as query parameters and some RTMP providers put a
 * token there. So the base and the query string are checked separately: the base keeps the strict
 * rules (no whitespace, quotes, shell metacharacters, or `|` — the tee slave separator), and the
 * query must be well-formed `key=value` pairs from a conservative charset. The user-supplied parts
 * were already checked by `validateIngest`, which rejects `&` and quotes in user input; any `&`
 * here is one we generated ourselves while joining parameters.
 */
const HOSTILE_URL = /[\s"'`$;|&<>\\^*(){}[\]\r\n\t\0]/;
const QUERY_PAIR = /^[A-Za-z0-9_.~%+-]+=[A-Za-z0-9_.~%:+-]*$/;

export function assertCleanUrl(value: string, what: string): void {
  if (value.length === 0) throw new ArgvRefusedError(`${what} is empty.`);
  if (value.length > 2048) throw new ArgvRefusedError(`${what} is too long.`);
  if (value.startsWith('-')) throw new ArgvRefusedError(`${what} must not start with "-".`);

  const queryIndex = value.indexOf('?');
  const base = queryIndex === -1 ? value : value.slice(0, queryIndex);
  const match = HOSTILE_URL.exec(base);
  if (match) {
    throw new ArgvRefusedError(`${what} contains a character that is not allowed.`, [
      `illegal character ${JSON.stringify(match[0])} at index ${match.index}`,
    ]);
  }
  if (queryIndex !== -1) {
    const query = value.slice(queryIndex + 1);
    if (query.includes('?')) throw new ArgvRefusedError(`${what} has more than one query string.`);
    for (const pair of query.split('&')) {
      if (!QUERY_PAIR.test(pair)) {
        throw new ArgvRefusedError(`${what} has a query parameter that is not allowed.`, [
          `malformed parameter at ${JSON.stringify(pair.slice(0, 40))}`,
        ]);
      }
    }
  }
}

/** Local filesystem paths may contain spaces and backslashes, so they get a narrower check. */
export function assertCleanPath(value: string, what: string): void {
  if (value.length === 0) throw new ArgvRefusedError(`${what} is empty.`);
  if (value.length > 4096) throw new ArgvRefusedError(`${what} is too long.`);
  if (/[\r\n\0]/.test(value)) throw new ArgvRefusedError(`${what} contains a control character.`);
  if (value.startsWith('-')) throw new ArgvRefusedError(`${what} must not start with "-".`);
}

/* ---------------------------------------------------------------- encoders */

/** Where the encoder process gets its input from. */
export type EncoderSource =
  | {
      kind: 'pipe';
      /**
       * Demuxer for the renderer's byte stream. Chromium's MediaRecorder reports
       * `video/webm;codecs=h264` as supported but actually emits `video/x-matroska;codecs=avc1`,
       * so `matroska` is the correct demuxer for the H.264 path (measured, see DESKTOP_ARCHITECTURE).
       */
      container: 'matroska' | 'webm' | 'mp4';
      /** true → `-c:v copy` (no re-encode in main); false → transcode with `videoEncoder`. */
      videoPassthrough: boolean;
    }
  | {
      /** Synthetic source for headless verification and diagnostics. */
      kind: 'lavfi';
      durationSeconds?: number;
    };

export interface EncoderArgvSpec {
  format: OutputFormat;
  encoder: EncoderSettings;
  /** Resolved ffmpeg video encoder name, e.g. `libx264` or `h264_nvenc`. Ignored when passthrough. */
  videoEncoder: string;
  source: EncoderSource;
  /** Emit `-progress pipe:2` so metrics arrive on stderr (stdout carries the mpegts stream). */
  progress?: boolean;
}

const ALLOWED_VIDEO_ENCODERS = new Set([
  'libx264',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_videotoolbox',
  'h264_mf',
  'libx265',
  'hevc_nvenc',
  'hevc_qsv',
  'hevc_amf',
  'hevc_videotoolbox',
]);

/** Rate-control args for the resolved encoder. Hardware encoders use different option names. */
function rateControlArgs(spec: EncoderArgvSpec): string[] {
  const { format, encoder, videoEncoder } = spec;
  const kbps = Math.round(format.videoKbps);
  const bufsize = kbps * 2;
  const cbr = encoder.rateControl === 'cbr';

  if (videoEncoder === 'libx264' || videoEncoder === 'libx265') {
    const params = cbr ? 'nal-hrd=cbr:scenecut=0' : 'scenecut=0';
    return [
      '-preset',
      encoder.softwarePreset,
      '-profile:v',
      'high',
      '-b:v',
      `${kbps}k`,
      '-maxrate',
      `${kbps}k`,
      '-minrate',
      cbr ? `${kbps}k` : '0',
      '-bufsize',
      `${bufsize}k`,
      videoEncoder === 'libx264' ? '-x264-params' : '-x265-params',
      params,
    ];
  }
  if (videoEncoder.endsWith('_nvenc')) {
    return [
      '-preset',
      'p4',
      '-tune',
      'll',
      '-rc',
      cbr ? 'cbr' : 'vbr',
      '-b:v',
      `${kbps}k`,
      '-maxrate',
      `${kbps}k`,
      '-bufsize',
      `${bufsize}k`,
    ];
  }
  if (videoEncoder.endsWith('_qsv')) {
    return ['-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${bufsize}k`, '-low_delay_brc', '1'];
  }
  if (videoEncoder.endsWith('_amf')) {
    return ['-usage', 'lowlatency', '-rc', cbr ? 'cbr' : 'vbr_peak', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`];
  }
  if (videoEncoder.endsWith('_videotoolbox')) {
    return ['-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-realtime', '1'];
  }
  // h264_mf and anything else: plain bitrate.
  return ['-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${bufsize}k`];
}

/**
 * Build the argv for one "encoder" process: exactly ONE per aspect ratio.
 * Its stdout is an MPEG-TS elementary stream that the in-process fan-out copies to every sender.
 */
export function buildEncoderArgv(spec: EncoderArgvSpec): string[] {
  const { format, source } = spec;
  if (!Number.isInteger(format.width) || !Number.isInteger(format.height)) {
    throw new ArgvRefusedError('Output format dimensions must be integers.');
  }
  if (format.width < 128 || format.height < 128 || format.width > 7680 || format.height > 4320) {
    throw new ArgvRefusedError('Output format dimensions are out of range.');
  }
  if (format.videoKbps < 200 || format.videoKbps > 60000) {
    throw new ArgvRefusedError('Video bitrate is out of range.');
  }

  const gop = Math.max(1, Math.round(format.keyframeIntervalSeconds * format.fps));

  const argv: string[] = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  if (spec.progress !== false) argv.push('-stats_period', '1', '-progress', 'pipe:2');

  const videoArgs: string[] = [];
  const audioArgs: string[] = ['-c:a', 'aac', '-b:a', `${Math.round(format.audioKbps)}k`, '-ar', '48000', '-ac', '2'];

  if (source.kind === 'pipe') {
    // The renderer's stream has no duration and is not seekable; be explicit about the demuxer so
    // ffmpeg does not stall probing, and generate PTS because MediaRecorder timestamps restart at 0.
    argv.push('-fflags', '+genpts+discardcorrupt', '-f', source.container, '-i', 'pipe:0');
    argv.push('-map', '0:v:0', '-map', '0:a:0?');
    if (source.videoPassthrough) {
      videoArgs.push('-c:v', 'copy');
    } else {
      if (!ALLOWED_VIDEO_ENCODERS.has(spec.videoEncoder)) {
        throw new ArgvRefusedError(`Unknown video encoder ${JSON.stringify(spec.videoEncoder)}.`);
      }
      videoArgs.push(
        '-c:v',
        spec.videoEncoder,
        '-pix_fmt',
        'yuv420p',
        '-s',
        `${format.width}x${format.height}`,
        '-r',
        String(format.fps),
        ...rateControlArgs(spec),
        '-g',
        String(gop),
        '-keyint_min',
        String(gop),
      );
    }
  } else {
    if (!ALLOWED_VIDEO_ENCODERS.has(spec.videoEncoder)) {
      throw new ArgvRefusedError(`Unknown video encoder ${JSON.stringify(spec.videoEncoder)}.`);
    }
    // `-re` paces the synthetic source at wall-clock speed so CPU numbers mean something.
    argv.push(
      '-re',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${format.width}x${format.height}:rate=${format.fps}`,
      '-re',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
    );
    if (source.durationSeconds !== undefined) {
      if (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0 || source.durationSeconds > 86400) {
        throw new ArgvRefusedError('lavfi duration is out of range.');
      }
      argv.push('-t', String(source.durationSeconds));
    }
    argv.push('-map', '0:v:0', '-map', '1:a:0');
    videoArgs.push(
      '-c:v',
      spec.videoEncoder,
      '-pix_fmt',
      'yuv420p',
      ...rateControlArgs(spec),
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
    );
  }

  argv.push(...videoArgs, ...audioArgs);
  // MPEG-TS is the internal transport: self-synchronising, so a sender can join mid-stream.
  // `resend_headers` + a 100 ms PAT/PMT period mean a late joiner locks on within ~0.1 s.
  argv.push(
    '-f',
    'mpegts',
    '-mpegts_flags',
    '+resend_headers',
    '-pat_period',
    '0.1',
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
    '-flush_packets',
    '1',
    'pipe:1',
  );
  return argv;
}

/* ----------------------------------------------------------------- senders */

export interface SenderArgvSpec {
  ingest: IngestTarget;
  /** Used only for FLV/SRT tuning hints. */
  format?: Pick<OutputFormat, 'videoKbps'>;
  progress?: boolean;
}

/**
 * Build the argv for one "sender" process: reads the shared MPEG-TS on stdin, copies both streams
 * (no re-encode, ~1 % of a core) and publishes to exactly one destination.
 *
 * The ingest target is re-validated with `validateIngest` from packages/core here, so an unvalidated
 * or hostile target can never reach a child process even if a caller forgets to check.
 */
export function buildSenderArgv(spec: SenderArgvSpec): string[] {
  const validation = validateIngest(spec.ingest);
  if (!validation.ok) {
    throw new ArgvRefusedError('Ingest target failed validation; refusing to build argv.', validation.errors);
  }

  const argv: string[] = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  if (spec.progress !== false) argv.push('-stats_period', '1', '-progress', 'pipe:2');
  // Map video+audio EXPLICITLY. `-map 0` also picks up the data/EPG streams an MPEG-TS input
  // carries, which FLV and MP4 reject with EPERM ("Operation not permitted") and the whole
  // output dies. Measured on this host — see DESKTOP_ENGINE_VERIFICATION.md.
  argv.push('-fflags', '+nobuffer', '-f', 'mpegts', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?');

  switch (spec.ingest.protocol) {
    case 'rtmp':
    case 'rtmps': {
      const url = composeRtmpPublishUrl(spec.ingest);
      assertCleanUrl(url, 'Stream URL');
      if (!/^rtmps?:\/\//i.test(url)) throw new ArgvRefusedError('Stream URL must be rtmp:// or rtmps://.');
      argv.push('-c', 'copy', '-f', 'flv', '-flvflags', 'no_duration_filesize', url);
      return argv;
    }
    case 'srt': {
      const url = buildSrtUrl(spec.ingest);
      assertCleanUrl(url, 'SRT URL');
      argv.push('-c', 'copy', '-f', 'mpegts', url);
      return argv;
    }
    case 'whip': {
      assertCleanUrl(spec.ingest.url, 'WHIP endpoint');
      if (!/^https:\/\//i.test(spec.ingest.url)) throw new ArgvRefusedError('WHIP endpoint must be https://.');
      // The whip muxer requires H.264 + Opus, so this path transcodes audio back to Opus (video is
      // still copied — never a second video encode). WHIP exists for custom/relay destinations
      // only; no major platform accepts it (ADR-012).
      argv.push('-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2');
      if (spec.ingest.streamKey) {
        assertCleanToken(spec.ingest.streamKey, 'WHIP bearer token');
        argv.push('-authorization', spec.ingest.streamKey);
      }
      argv.push('-f', 'whip', spec.ingest.url);
      return argv;
    }
    default:
      throw new ArgvRefusedError('Unknown ingest protocol.');
  }
}

/**
 * Compose the SRT caller URL. Query parameters are appended only from validated, token-clean
 * values; `streamid` and `passphrase` are the only two we ever add.
 */
export function buildSrtUrl(ingest: IngestTarget): string {
  assertCleanUrl(ingest.url, 'SRT URL');
  const params: string[] = [];
  const existing = ingest.url.includes('?');
  if (ingest.streamId) {
    assertCleanToken(ingest.streamId, 'SRT stream id');
    params.push(`streamid=${encodeURIComponent(ingest.streamId)}`);
  }
  if (ingest.passphrase) {
    assertCleanToken(ingest.passphrase, 'SRT passphrase');
    params.push(`passphrase=${encodeURIComponent(ingest.passphrase)}`);
  }
  if (params.length === 0) return ingest.url;
  return `${ingest.url}${existing ? '&' : '?'}${params.join('&')}`;
}

/* --------------------------------------------------------------- recording */

export interface RecordingArgvSpec {
  filePath: string;
  container: 'mp4' | 'mkv' | 'webm';
  progress?: boolean;
}

/**
 * The recorder is just another sender: `-c copy` off the shared MPEG-TS, so recording costs no
 * extra encode (RecordingSettings.source is always 'program').
 *
 * mp4 uses fragmented output (`frag_keyframe+empty_moov`) so a crash or a kill still leaves a
 * playable file instead of a moov-less stub. `webm` cannot hold H.264/AAC, so it is mapped to
 * Matroska and the caller is expected to surface the real container.
 */
export function buildRecordingArgv(spec: RecordingArgvSpec): string[] {
  assertCleanPath(spec.filePath, 'Recording path');
  const argv: string[] = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  if (spec.progress !== false) argv.push('-stats_period', '1', '-progress', 'pipe:2');
  argv.push('-f', 'mpegts', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy');
  if (spec.container === 'mp4') {
    // MPEG-TS carries AAC as ADTS; MP4 needs an AudioSpecificConfig. ffmpeg inserts
    // `aac_adtstoasc` automatically for a plain MP4, but NOT when the moov is written up front for
    // `frag_keyframe+empty_moov` - the recording then dies a fraction of a second in with
    // "Error submitting a packet to the muxer: Operation not permitted". Measured on this host;
    // see docs/qa/DESKTOP_ENGINE_VERIFICATION.md for the four variants tried.
    argv.push('-bsf:a', 'aac_adtstoasc', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4');
  } else {
    argv.push('-f', 'matroska');
  }
  argv.push('-y', spec.filePath);
  return argv;
}

/** Extension actually written for a requested container (webm is impossible for H.264/AAC). */
export function recordingExtension(container: 'mp4' | 'mkv' | 'webm'): 'mp4' | 'mkv' {
  return container === 'mp4' ? 'mp4' : 'mkv';
}

/* ------------------------------------------------------- hardware probing */

/** 1-second synthetic encode to `-f null -`: the only honest way to know an encoder works. */
export function buildEncoderProbeArgv(encoderName: string): string[] {
  if (!ALLOWED_VIDEO_ENCODERS.has(encoderName)) {
    throw new ArgvRefusedError(`Refusing to probe unknown encoder ${JSON.stringify(encoderName)}.`);
  }
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=1',
    '-c:v',
    encoderName,
    '-f',
    'null',
    '-',
  ];
}

/* ----------------------------------------------------- tee muxer (fallback) */

/**
 * Escaping for the tee muxer, documented because it is the obvious alternative topology and its
 * quoting rules are a trap. Inside a tee output list `|` separates slaves and `:` separates the
 * option block from the URL, so BOTH must be backslash-escaped inside a slave URL — and RTMP URLs
 * always contain `:`. In an argv array one backslash is correct (a shell would need two).
 */
export function escapeTeeSlaveUrl(url: string): string {
  return url.replace(/[\\|:]/g, (c) => `\\${c}`);
}

export interface TeeSlave {
  /** Muxer name, e.g. `flv` or `mp4`. */
  format: string;
  url: string;
  /** `ignore` keeps the encoder alive when this slave fails; `abort` kills everything. */
  onfail?: 'ignore' | 'abort';
  /**
   * Wrap the slave in the fifo pseudo-muxer so a stalled network output cannot block the encoder.
   * Tune it with the GLOBAL `-fifo_options` from `teeGlobalArgs()`, not per-slave — see below.
   */
  useFifo?: boolean;
  /**
   * Per-slave fifo queue depth. Prefer `teeGlobalArgs()` instead.
   *
   * Only ONE fifo option is expressible in the per-slave form: entries inside a slave's
   * `fifo_options` are separated by `:`, the same separator tee uses for its own option block, and
   * ffmpeg 9.0.1 rejects it escaped at every backslash depth tried — a two-option value fails with
   * "Unknown option 'recover_any_error'" and that slave silently writes ZERO bytes with exit code 0.
   * The global form has no such limit. Both measured on this host; see
   * docs/qa/DESKTOP_ENGINE_VERIFICATION.md.
   */
  fifoQueueSize?: number;
}

/** Options for the fifo pseudo-muxer, passed globally so several can be set at once. */
export interface TeeFifoOptions {
  attemptRecovery?: boolean;
  recoverAnyError?: boolean;
  /** Seconds between recovery attempts. */
  recoveryWaitTime?: number;
  /** Drop packets rather than blocking the encoder when a slave's queue overflows. */
  dropPktsOnOverflow?: boolean;
  queueSize?: number;
}

/**
 * Global tee arguments, to be placed immediately BEFORE the tee output string.
 *
 * This is the correct way to configure fifo behaviour: as a global `-fifo_options` value the
 * `:`-separated list parses fine, so all five options can be set together — which the per-slave
 * form cannot do (see `TeeSlave.fifoQueueSize`). Verified on this host:
 * `-f tee -use_fifo 1 -fifo_options attempt_recovery=1:recovery_wait_time=2:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=240`
 * exits 0 with every slave receiving its full stream.
 */
export function teeGlobalArgs(options: TeeFifoOptions = {}): string[] {
  const parts: string[] = [];
  if (options.attemptRecovery) parts.push('attempt_recovery=1');
  if (options.recoverAnyError) parts.push('recover_any_error=1');
  if (options.recoveryWaitTime !== undefined) {
    if (!Number.isFinite(options.recoveryWaitTime) || options.recoveryWaitTime < 0 || options.recoveryWaitTime > 3600) {
      throw new ArgvRefusedError('tee fifo recovery wait time is out of range.');
    }
    parts.push(`recovery_wait_time=${options.recoveryWaitTime}`);
  }
  if (options.dropPktsOnOverflow) parts.push('drop_pkts_on_overflow=1');
  if (options.queueSize !== undefined) {
    if (!Number.isInteger(options.queueSize) || options.queueSize < 1 || options.queueSize > 100_000) {
      throw new ArgvRefusedError('tee fifo queue size is out of range.');
    }
    parts.push(`queue_size=${options.queueSize}`);
  }
  const argv = ['-f', 'tee', '-use_fifo', '1'];
  if (parts.length > 0) argv.push('-fifo_options', parts.join(':'));
  return argv;
}

/**
 * Build a single `-f tee` output string. NOT the default topology: tee is a static output list, so
 * adding or removing one destination means restarting the encoder, which blips every other
 * destination. Kept (and tested) as the documented fallback and for reference.
 */
export function buildTeeOutput(slaves: TeeSlave[]): string {
  if (slaves.length === 0) throw new ArgvRefusedError('tee needs at least one slave.');
  // THE ANCHOR RULE. If every slave fails to open, ffmpeg does not survive `onfail=ignore` — it
  // exits non-zero having written nothing ("Output file does not contain any stream"). Verified on
  // this host: two dead RTMP slaves → exit -1, both outputs 0 bytes. So any tee invocation with
  // network slaves must include at least one slave that cannot fail (a local file, or `[f=null]-`)
  // to anchor the process while the network outputs recover.
  const hasAnchor = slaves.some((slave) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(slave.url) || slave.format === 'null');
  if (!hasAnchor) {
    throw new ArgvRefusedError(
      'tee needs an anchor slave (a local file or [f=null]-): if every network slave fails to open, ffmpeg exits.',
    );
  }
  return slaves
    .map((slave) => {
      assertCleanToken(slave.format, 'tee slave format');
      // `-` is ffmpeg's stdout sink and the canonical `[f=null]-` anchor; it is the one URL allowed
      // to start with a dash. Everything else gets the path-level check, then tee escaping.
      if (slave.url !== '-') assertCleanPath(slave.url, 'tee slave URL');
      const opts = [`f=${slave.format}`];
      if (slave.onfail) opts.push(`onfail=${slave.onfail}`);
      if (slave.useFifo) {
        opts.push('use_fifo=1');
        if (slave.fifoQueueSize !== undefined) {
          if (!Number.isInteger(slave.fifoQueueSize) || slave.fifoQueueSize < 1 || slave.fifoQueueSize > 100_000) {
            throw new ArgvRefusedError('tee fifo queue size is out of range.');
          }
          opts.push(`fifo_options=queue_size=${slave.fifoQueueSize}`);
        }
      }
      return `[${opts.join(':')}]${escapeTeeSlaveUrl(slave.url)}`;
    })
    .join('|');
}

/* ------------------------------------------------------------------ helpers */

/** Aspect ratios, in the order the engine starts encoders. Stable for deterministic tests. */
export const ASPECT_ORDER: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];
