import { describe, expect, it } from 'vitest';

import type { IngestTarget } from '@livetap/core';
import type { EncoderSettings, OutputFormat } from '@livetap/core';

import {
  ArgvRefusedError,
  assertCleanPath,
  assertCleanToken,
  assertCleanUrl,
  buildEncoderArgv,
  buildEncoderProbeArgv,
  buildRecordingArgv,
  buildSenderArgv,
  buildSrtUrl,
  buildTeeOutput,
  escapeTeeSlaveUrl,
  recordingExtension,
  teeGlobalArgs,
} from './argv.js';

const format: OutputFormat = {
  aspectRatio: '16:9',
  width: 1920,
  height: 1080,
  fps: 30,
  videoKbps: 4500,
  audioKbps: 160,
  codec: 'h264',
  keyframeIntervalSeconds: 2,
};

const encoder: EncoderSettings = { preference: 'software', softwarePreset: 'veryfast', rateControl: 'cbr' };

/** Find the value that follows a flag in an argv array. */
function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

describe('assertCleanToken', () => {
  it('accepts a plain token', () => {
    expect(() => assertCleanToken('rtmp://a.example/live/key', 'url')).not.toThrow();
  });

  // Each of these is a real injection primitive if a shell ever appears in the chain.
  const hostile = [
    'rtmp://a/live/key; rm -rf /',
    'rtmp://a/live/key && curl evil.example',
    'rtmp://a/live/key | nc evil 1',
    'rtmp://a/live/`whoami`',
    'rtmp://a/live/$(id)',
    'rtmp://a/live/key\nrtmp://evil/x',
    'rtmp://a/live/key\r\n',
    'rtmp://a/live/"quoted"',
    "rtmp://a/live/'quoted'",
    'rtmp://a/live/key with space',
    'rtmp://a/live/<redirect',
    'rtmp://a/live/key\u0000',
  ];
  for (const value of hostile) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      expect(() => assertCleanToken(value, 'url')).toThrow(ArgvRefusedError);
    });
  }

  it('refuses a value that would be read as another ffmpeg option', () => {
    expect(() => assertCleanToken('-i', 'url')).toThrow(/must not start with/);
  });

  it('refuses an over-long value', () => {
    expect(() => assertCleanToken(`rtmp://a/${'x'.repeat(4000)}`, 'url')).toThrow(/too long/);
  });
});

describe('assertCleanUrl', () => {
  it('allows a query string, which assertCleanToken refuses', () => {
    expect(() => assertCleanToken('srt://h:9000?streamid=abc', 'u')).toThrow();
    expect(() => assertCleanUrl('srt://h:9000?streamid=abc', 'u')).not.toThrow();
  });

  it('allows several generated parameters', () => {
    expect(() => assertCleanUrl('srt://h:9000?streamid=abc&passphrase=s3cret', 'u')).not.toThrow();
  });

  it('still refuses shell metacharacters in the base', () => {
    expect(() => assertCleanUrl('srt://h:9000;id?streamid=a', 'u')).toThrow(ArgvRefusedError);
    expect(() => assertCleanUrl('rtmp://h/live/`id`', 'u')).toThrow(ArgvRefusedError);
  });

  it('refuses a malformed query parameter', () => {
    expect(() => assertCleanUrl('srt://h:9000?streamid', 'u')).toThrow(/query parameter/);
    expect(() => assertCleanUrl('srt://h:9000?a=1&;b=2', 'u')).toThrow(/query parameter/);
  });

  it('refuses more than one query string', () => {
    expect(() => assertCleanUrl('srt://h:9000?a=1?b=2', 'u')).toThrow(/query string/);
  });
});

describe('assertCleanPath', () => {
  it('accepts a Windows path with spaces', () => {
    expect(() => assertCleanPath('C:\\Users\\Some One\\rec.mp4', 'path')).not.toThrow();
  });
  it('refuses control characters and option-looking paths', () => {
    expect(() => assertCleanPath('C:\\rec\n.mp4', 'path')).toThrow(ArgvRefusedError);
    expect(() => assertCleanPath('-f', 'path')).toThrow(ArgvRefusedError);
  });
});

describe('buildEncoderArgv', () => {
  it('copies video when the renderer already produced H.264 (the single-encode path)', () => {
    const argv = buildEncoderArgv({
      format,
      encoder,
      videoEncoder: 'libx264',
      source: { kind: 'pipe', container: 'matroska', videoPassthrough: true },
    });
    expect(argv).toContain('-c:v');
    expect(valueAfter(argv, '-c:v')).toBe('copy');
    // Audio is still transcoded Opus → AAC, which RTMP requires.
    expect(valueAfter(argv, '-c:a')).toBe('aac');
    expect(argv).not.toContain('libx264');
    // Matroska, not webm: Chromium emits x-matroska for the H.264 path.
    expect(valueAfter(argv, '-f')).toBe('matroska');
    expect(argv).toContain('pipe:0');
    // stdout carries the MPEG-TS, so progress must go to stderr.
    expect(valueAfter(argv, '-progress')).toBe('pipe:2');
    expect(argv[argv.length - 1]).toBe('pipe:1');
  });

  it('transcodes when the renderer could only produce VP8/VP9', () => {
    const argv = buildEncoderArgv({
      format,
      encoder,
      videoEncoder: 'libx264',
      source: { kind: 'pipe', container: 'webm', videoPassthrough: false },
    });
    expect(valueAfter(argv, '-c:v')).toBe('libx264');
    expect(valueAfter(argv, '-preset')).toBe('veryfast');
    expect(valueAfter(argv, '-s')).toBe('1920x1080');
    expect(valueAfter(argv, '-b:v')).toBe('4500k');
    // 2 s keyframe interval at 30 fps = a 60-frame GOP, fixed so platforms can segment.
    expect(valueAfter(argv, '-g')).toBe('60');
    expect(valueAfter(argv, '-keyint_min')).toBe('60');
    expect(valueAfter(argv, '-x264-params')).toBe('nal-hrd=cbr:scenecut=0');
  });

  it('emits an mpegts output that a late joiner can lock onto', () => {
    const argv = buildEncoderArgv({
      format,
      encoder,
      videoEncoder: 'libx264',
      source: { kind: 'lavfi' },
    });
    expect(valueAfter(argv, '-mpegts_flags')).toBe('+resend_headers');
    expect(valueAfter(argv, '-pat_period')).toBe('0.1');
  });

  it('paces a synthetic source at wall-clock speed so CPU numbers mean something', () => {
    const argv = buildEncoderArgv({ format, encoder, videoEncoder: 'libx264', source: { kind: 'lavfi' } });
    expect(argv.filter((a) => a === '-re')).toHaveLength(2);
    expect(argv).toContain('testsrc2=size=1920x1080:rate=30');
    expect(argv).toContain('sine=frequency=440:sample_rate=48000');
  });

  it('uses vbr rate control when asked', () => {
    const argv = buildEncoderArgv({
      format,
      encoder: { ...encoder, rateControl: 'vbr' },
      videoEncoder: 'libx264',
      source: { kind: 'lavfi' },
    });
    expect(valueAfter(argv, '-x264-params')).toBe('scenecut=0');
    expect(valueAfter(argv, '-minrate')).toBe('0');
  });

  it('uses the right option names for each hardware encoder family', () => {
    const nvenc = buildEncoderArgv({ format, encoder, videoEncoder: 'h264_nvenc', source: { kind: 'lavfi' } });
    expect(valueAfter(nvenc, '-rc')).toBe('cbr');
    expect(valueAfter(nvenc, '-tune')).toBe('ll');
    const qsv = buildEncoderArgv({ format, encoder, videoEncoder: 'h264_qsv', source: { kind: 'lavfi' } });
    expect(valueAfter(qsv, '-low_delay_brc')).toBe('1');
    const vt = buildEncoderArgv({ format, encoder, videoEncoder: 'h264_videotoolbox', source: { kind: 'lavfi' } });
    expect(valueAfter(vt, '-realtime')).toBe('1');
  });

  it('refuses an unknown encoder name rather than passing it to ffmpeg', () => {
    expect(() =>
      buildEncoderArgv({ format, encoder, videoEncoder: 'evil; rm -rf /', source: { kind: 'lavfi' } }),
    ).toThrow(ArgvRefusedError);
  });

  it('refuses out-of-range formats', () => {
    expect(() =>
      buildEncoderArgv({ format: { ...format, width: 7 }, encoder, videoEncoder: 'libx264', source: { kind: 'lavfi' } }),
    ).toThrow(/out of range/);
    expect(() =>
      buildEncoderArgv({
        format: { ...format, width: 1920.5 },
        encoder,
        videoEncoder: 'libx264',
        source: { kind: 'lavfi' },
      }),
    ).toThrow(/integers/);
    expect(() =>
      buildEncoderArgv({
        format: { ...format, videoKbps: 999_999 },
        encoder,
        videoEncoder: 'libx264',
        source: { kind: 'lavfi' },
      }),
    ).toThrow(/bitrate/);
  });

  it('refuses an absurd lavfi duration', () => {
    expect(() =>
      buildEncoderArgv({ format, encoder, videoEncoder: 'libx264', source: { kind: 'lavfi', durationSeconds: 0 } }),
    ).toThrow(/duration/);
  });

  it('never contains a shell', () => {
    const argv = buildEncoderArgv({ format, encoder, videoEncoder: 'libx264', source: { kind: 'lavfi' } });
    for (const arg of argv) {
      expect(typeof arg).toBe('string');
      expect(arg).not.toMatch(/[;&|`]/);
    }
  });
});

describe('buildSenderArgv', () => {
  const rtmp: IngestTarget = { protocol: 'rtmp', url: 'rtmp://live.example/app', streamKey: 'abc-123' };

  it('copies both streams — a sender never re-encodes', () => {
    const argv = buildSenderArgv({ ingest: rtmp });
    expect(valueAfter(argv, '-c')).toBe('copy');
    expect(argv).toContain('-f');
    expect(argv[argv.length - 1]).toBe('rtmp://live.example/app/abc-123');
    expect(valueAfter(argv, '-flvflags')).toBe('no_duration_filesize');
  });

  it('maps video and audio explicitly, because `-map 0` pulls in TS data streams FLV rejects', () => {
    const argv = buildSenderArgv({ ingest: rtmp });
    expect(argv).toContain('0:v:0');
    expect(argv).toContain('0:a:0?');
    const mapIndexes = argv.reduce<number[]>((acc, a, i) => (a === '-map' ? [...acc, i] : acc), []);
    expect(mapIndexes).toHaveLength(2);
  });

  it('refuses an ingest target that fails core validateIngest', () => {
    // No stream key.
    expect(() => buildSenderArgv({ ingest: { protocol: 'rtmp', url: 'rtmp://live.example/app' } })).toThrow(
      ArgvRefusedError,
    );
    // Not a URL at all.
    expect(() => buildSenderArgv({ ingest: { protocol: 'rtmp', url: 'not a url', streamKey: 'k' } })).toThrow(
      ArgvRefusedError,
    );
    // https where rtmp is required.
    expect(() => buildSenderArgv({ ingest: { protocol: 'rtmp', url: 'https://x.example', streamKey: 'k' } })).toThrow(
      ArgvRefusedError,
    );
  });

  it('refuses metacharacters in the URL and in the stream key', () => {
    expect(() =>
      buildSenderArgv({ ingest: { protocol: 'rtmp', url: 'rtmp://live.example/app;id', streamKey: 'k' } }),
    ).toThrow(ArgvRefusedError);
    expect(() =>
      buildSenderArgv({ ingest: { protocol: 'rtmp', url: 'rtmp://live.example/app', streamKey: 'k`id`' } }),
    ).toThrow(ArgvRefusedError);
    expect(() =>
      buildSenderArgv({ ingest: { protocol: 'rtmp', url: 'rtmp://live.example/app', streamKey: 'k|nc' } }),
    ).toThrow(ArgvRefusedError);
  });

  it('carries the ArgvRefusedError reasons through for Pro-mode diagnostics', () => {
    try {
      buildSenderArgv({ ingest: { protocol: 'rtmp', url: 'rtmp://live.example/app' } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ArgvRefusedError);
      if (error instanceof ArgvRefusedError) expect(error.reasons.join(' ')).toMatch(/Stream key is required/);
    }
  });

  it('requires rtmps:// for an rtmps destination', () => {
    expect(() =>
      buildSenderArgv({ ingest: { protocol: 'rtmps', url: 'rtmp://live.example/app', streamKey: 'k' } }),
    ).toThrow(ArgvRefusedError);
    expect(() =>
      buildSenderArgv({ ingest: { protocol: 'rtmps', url: 'rtmps://live.example/app', streamKey: 'k' } }),
    ).not.toThrow();
  });

  it('sends SRT as mpegts with its parameters url-encoded', () => {
    const argv = buildSenderArgv({
      ingest: { protocol: 'srt', url: 'srt://127.0.0.1:8890', streamId: 'publish:live/srt', passphrase: 'hunter2xx' },
    });
    expect(valueAfter(argv, '-f')).toBe('mpegts'); // input format
    const url = argv[argv.length - 1] ?? '';
    expect(url).toContain('streamid=publish%3Alive%2Fsrt');
    expect(url).toContain('passphrase=hunter2xx');
  });

  it('publishes WHIP with Opus audio and copied video, never a second video encode', () => {
    const argv = buildSenderArgv({
      ingest: { protocol: 'whip', url: 'https://relay.example/whip/live', streamKey: 'bearer-token' },
    });
    expect(valueAfter(argv, '-c:v')).toBe('copy');
    expect(valueAfter(argv, '-c:a')).toBe('libopus');
    expect(valueAfter(argv, '-authorization')).toBe('bearer-token');
    expect(argv[argv.length - 1]).toBe('https://relay.example/whip/live');
  });

  it('refuses a non-https WHIP endpoint', () => {
    expect(() => buildSenderArgv({ ingest: { protocol: 'whip', url: 'http://relay.example/whip' } })).toThrow(
      ArgvRefusedError,
    );
  });
});

describe('buildSrtUrl', () => {
  it('keeps a url with no parameters untouched', () => {
    expect(buildSrtUrl({ protocol: 'srt', url: 'srt://h:9000' })).toBe('srt://h:9000');
  });
  it('appends with & when the url already has a query', () => {
    const url = buildSrtUrl({ protocol: 'srt', url: 'srt://h:9000?latency=200', streamId: 'x' });
    expect(url).toBe('srt://h:9000?latency=200&streamid=x');
  });
  it('refuses hostile parameter values', () => {
    expect(() => buildSrtUrl({ protocol: 'srt', url: 'srt://h:9000', streamId: 'a b' })).toThrow(ArgvRefusedError);
  });
});

describe('buildRecordingArgv', () => {
  it('records by copying the program stream — never a second encode', () => {
    const argv = buildRecordingArgv({ filePath: 'C:\\rec\\out.mp4', container: 'mp4' });
    expect(valueAfter(argv, '-c')).toBe('copy');
    expect(argv[argv.length - 1]).toBe('C:\\rec\\out.mp4');
  });

  it('adds aac_adtstoasc for fragmented mp4, without which the recording dies immediately', () => {
    const argv = buildRecordingArgv({ filePath: '/tmp/out.mp4', container: 'mp4' });
    expect(valueAfter(argv, '-bsf:a')).toBe('aac_adtstoasc');
    expect(valueAfter(argv, '-movflags')).toBe('+frag_keyframe+empty_moov+default_base_moof');
  });

  it('uses matroska for mkv and for webm, which cannot hold H.264/AAC', () => {
    expect(valueAfter(buildRecordingArgv({ filePath: '/tmp/a.mkv', container: 'mkv' }), '-f')).toBe('mpegts');
    const mkv = buildRecordingArgv({ filePath: '/tmp/a.mkv', container: 'mkv' });
    expect(mkv).toContain('matroska');
    expect(buildRecordingArgv({ filePath: '/tmp/a.mkv', container: 'webm' })).toContain('matroska');
    expect(recordingExtension('webm')).toBe('mkv');
    expect(recordingExtension('mp4')).toBe('mp4');
  });

  it('refuses a path that would be read as an option', () => {
    expect(() => buildRecordingArgv({ filePath: '-f', container: 'mp4' })).toThrow(ArgvRefusedError);
  });
});

describe('buildEncoderProbeArgv', () => {
  it('probes with a one-second synthetic encode to /dev/null', () => {
    const argv = buildEncoderProbeArgv('h264_nvenc');
    expect(argv).toContain('testsrc2=size=640x360:rate=30:duration=1');
    expect(valueAfter(argv, '-c:v')).toBe('h264_nvenc');
    expect(argv.slice(-3)).toEqual(['-f', 'null', '-']);
  });
  it('refuses to probe an arbitrary string', () => {
    expect(() => buildEncoderProbeArgv('$(curl evil)')).toThrow(ArgvRefusedError);
  });
});

describe('tee muxer (documented fallback)', () => {
  it('escapes the characters tee treats as separators', () => {
    expect(escapeTeeSlaveUrl('rtmp://h:1935/live/key')).toBe('rtmp\\://h\\:1935/live/key');
    expect(escapeTeeSlaveUrl('a|b')).toBe('a\\|b');
    expect(escapeTeeSlaveUrl('C:\\rec\\a.ts')).toBe('C\\:\\\\rec\\\\a.ts');
  });

  it('builds a slave list with per-output failure isolation', () => {
    const out = buildTeeOutput([
      { format: 'flv', url: 'rtmp://a.example/live/k1', onfail: 'ignore' },
      { format: 'mpegts', url: '/tmp/rec.ts', onfail: 'ignore', useFifo: true, fifoQueueSize: 120 },
    ]);
    expect(out.split('|')).toHaveLength(2);
    expect(out).toContain('[f=flv:onfail=ignore]');
    expect(out).toContain('use_fifo=1:fifo_options=queue_size=120');
    expect(out).toContain('rtmp\\://a.example/live/k1');
  });

  it('emits only one per-slave fifo option, because ffmpeg cannot parse a nested separator there', () => {
    const out = buildTeeOutput([
      { format: 'mpegts', url: '/tmp/anchor.ts' },
      { format: 'flv', url: 'rtmp://a/x', useFifo: true, fifoQueueSize: 60 },
    ]);
    expect(out.match(/fifo_options=/g)).toHaveLength(1);
    expect(out).not.toContain('\\:recover_any_error');
  });

  it('refuses an empty slave list and a silly queue size', () => {
    expect(() => buildTeeOutput([])).toThrow(ArgvRefusedError);
    expect(() =>
      buildTeeOutput([
        { format: 'mpegts', url: '/tmp/anchor.ts' },
        { format: 'flv', url: 'rtmp://a/x', useFifo: true, fifoQueueSize: 0 },
      ]),
    ).toThrow(/queue size/);
  });

  it('refuses a slave list with no anchor, because ffmpeg dies if every slave fails to open', () => {
    // Measured: two dead RTMP slaves with onfail=ignore → exit -1, zero bytes written anywhere.
    expect(() =>
      buildTeeOutput([
        { format: 'flv', url: 'rtmp://a/x', onfail: 'ignore' },
        { format: 'flv', url: 'rtmp://b/y', onfail: 'ignore' },
      ]),
    ).toThrow(/anchor/);
  });

  it('accepts a local file or a null sink as the anchor', () => {
    expect(() =>
      buildTeeOutput([
        { format: 'flv', url: 'rtmp://a/x', onfail: 'ignore' },
        { format: 'mp4', url: 'C:\\rec\\out.mp4' },
      ]),
    ).not.toThrow();
    expect(() =>
      buildTeeOutput([
        { format: 'flv', url: 'rtmp://a/x', onfail: 'ignore' },
        { format: 'null', url: '-' },
      ]),
    ).not.toThrow();
  });
});

describe('teeGlobalArgs', () => {
  it('puts every fifo option in ONE global value, which the per-slave form cannot express', () => {
    const argv = teeGlobalArgs({
      attemptRecovery: true,
      recoverAnyError: true,
      recoveryWaitTime: 2,
      dropPktsOnOverflow: true,
      queueSize: 240,
    });
    expect(argv.slice(0, 4)).toEqual(['-f', 'tee', '-use_fifo', '1']);
    expect(valueAfter(argv, '-fifo_options')).toBe(
      'attempt_recovery=1:recover_any_error=1:recovery_wait_time=2:drop_pkts_on_overflow=1:queue_size=240',
    );
  });

  it('omits -fifo_options entirely when nothing was asked for', () => {
    expect(teeGlobalArgs()).toEqual(['-f', 'tee', '-use_fifo', '1']);
  });

  it('refuses out-of-range values', () => {
    expect(() => teeGlobalArgs({ queueSize: 0 })).toThrow(/queue size/);
    expect(() => teeGlobalArgs({ recoveryWaitTime: -1 })).toThrow(/recovery wait time/);
  });
});
