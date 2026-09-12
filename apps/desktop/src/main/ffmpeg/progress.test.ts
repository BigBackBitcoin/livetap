import { describe, expect, it } from 'vitest';

import { FfmpegStderrParser, classifyStderrLine, parseOutTime } from './progress.js';

/** A real `-progress pipe:2` block as ffmpeg 9.0.1 writes it. */
const BLOCK = [
  'frame=30',
  'fps=29.97',
  'stream_0_0_q=-1.0',
  'bitrate=4501.2kbits/s',
  'total_size=563200',
  'out_time_us=1000000',
  'out_time_ms=1000000',
  'out_time=00:00:01.000000',
  'dup_frames=0',
  'drop_frames=2',
  'speed=1.01x',
  'progress=continue',
  '',
].join('\n');

describe('FfmpegStderrParser', () => {
  it('parses a whole progress block', () => {
    const parser = new FfmpegStderrParser();
    const { progress, logs } = parser.push(BLOCK);
    expect(logs).toEqual([]);
    expect(progress).toHaveLength(1);
    const snapshot = progress[0];
    expect(snapshot).toMatchObject({
      frame: 30,
      fps: 29.97,
      bitrateKbps: 4501.2,
      totalSizeBytes: 563200,
      outTimeMs: 1000,
      dupFrames: 0,
      dropFrames: 2,
      speed: 1.01,
      ended: false,
    });
  });

  it('survives a chunk boundary in the middle of a line', () => {
    const parser = new FfmpegStderrParser();
    const midpoint = 37;
    const first = parser.push(BLOCK.slice(0, midpoint));
    const second = parser.push(BLOCK.slice(midpoint));
    expect(first.progress.length + second.progress.length).toBe(1);
    const snapshot = [...first.progress, ...second.progress][0];
    expect(snapshot?.frame).toBe(30);
    expect(snapshot?.bitrateKbps).toBe(4501.2);
  });

  it('handles one byte at a time', () => {
    const parser = new FfmpegStderrParser();
    const collected: number[] = [];
    for (const char of BLOCK) {
      for (const snapshot of parser.push(char).progress) {
        if (snapshot.frame !== undefined) collected.push(snapshot.frame);
      }
    }
    expect(collected).toEqual([30]);
  });

  it('marks the final block as ended', () => {
    const parser = new FfmpegStderrParser();
    const { progress } = parser.push('frame=900\nbitrate=4500.0kbits/s\nprogress=end\n');
    expect(progress[0]?.ended).toBe(true);
  });

  it('treats N/A as absent rather than zero', () => {
    const parser = new FfmpegStderrParser();
    const { progress } = parser.push('frame=10\nbitrate=N/A\nspeed=N/A\nprogress=continue\n');
    expect(progress[0]?.frame).toBe(10);
    expect(progress[0]?.bitrateKbps).toBeUndefined();
    expect(progress[0]?.speed).toBeUndefined();
  });

  it('falls back to out_time when out_time_us is missing', () => {
    const parser = new FfmpegStderrParser();
    const { progress } = parser.push('out_time=00:01:07.500000\nprogress=continue\n');
    expect(progress[0]?.outTimeMs).toBeCloseTo(67_500, 0);
  });

  it('keeps log lines separate from progress lines', () => {
    const parser = new FfmpegStderrParser();
    const { progress, logs } = parser.push(
      `frame=5\n[flv @ 0x1] rtmp://a/live/k: Broken pipe\nprogress=continue\nEnd of file\n`,
    );
    expect(progress).toHaveLength(1);
    expect(logs).toEqual(['[flv @ 0x1] rtmp://a/live/k: Broken pipe', 'End of file']);
  });

  it('does not mistake a log line containing = for progress', () => {
    const parser = new FfmpegStderrParser();
    const { progress, logs } = parser.push('[out#0/flv @ 0x1] Error opening output x=1\n');
    expect(progress).toEqual([]);
    expect(logs).toHaveLength(1);
  });

  it('flushes a trailing line with no newline', () => {
    const parser = new FfmpegStderrParser();
    expect(parser.push('Connection refused').logs).toEqual([]);
    expect(parser.flush().logs).toEqual(['Connection refused']);
  });
});

describe('parseOutTime', () => {
  it('converts hh:mm:ss.us to milliseconds', () => {
    expect(parseOutTime('00:00:07.951834')).toBeCloseTo(7951.834, 2);
    expect(parseOutTime('01:02:03.000000')).toBeCloseTo(3_723_000, 0);
  });
  it('returns undefined for junk', () => {
    expect(parseOutTime('N/A')).toBeUndefined();
    expect(parseOutTime('')).toBeUndefined();
  });
});

describe('classifyStderrLine', () => {
  const cases: Array<[string, string]> = [
    ['[flv @ 0x1] rtmp://a/live/k: Broken pipe', 'INGEST_DISCONNECTED'],
    ['av_interleaved_write_frame(): Broken pipe', 'INGEST_DISCONNECTED'],
    ['Error during demuxing: End of file', 'INGEST_DISCONNECTED'],
    ['[tcp @ 0x1] Connection to tcp://a:1935 failed: Connection refused', 'INGEST_REFUSED'],
    ['[tcp @ 0x1] ECONNREFUSED', 'INGEST_REFUSED'],
    ['Connection to tcp://a:1935 failed: Operation timed out', 'INGEST_TIMEOUT'],
    ['[rtmp @ 0x1] NetStream.Publish.BadName', 'INGEST_INVALID_KEY'],
    ['[tcp @ 0x1] Failed to resolve hostname live.example: getaddrinfo failed', 'NETWORK_OFFLINE'],
    ['[out#0] Error writing to file: No space left on device', 'DISK_FULL'],
  ];
  for (const [line, expected] of cases) {
    it(`maps ${JSON.stringify(line.slice(0, 48))} → ${expected}`, () => {
      expect(classifyStderrLine(line)).toBe(expected);
    });
  }

  it('maps the Windows socket error numbers ffmpeg prints instead of errno names', () => {
    expect(classifyStderrLine('[flv @ 0x1] Error number -10053 occurred')).toBe('INGEST_DISCONNECTED');
    expect(classifyStderrLine('[tcp @ 0x1] Error number -10061 occurred')).toBe('INGEST_REFUSED');
  });

  it('maps a failed RTMPS handshake to a refusal', () => {
    expect(classifyStderrLine('[rtmps @ 0x1] TLS handshake failed')).toBe('INGEST_REFUSED');
  });

  it('ignores noise so the UI does not raise a false alarm', () => {
    expect(classifyStderrLine('')).toBeNull();
    expect(classifyStderrLine('deprecated pixel format used, make sure you did set range correctly')).toBeNull();
    expect(classifyStderrLine('[vost#0:0] Past duration 0.7 too large')).toBeNull();
    expect(classifyStderrLine('frame= 900 fps= 30 q=-1.0 size=  4500kB')).toBeNull();
  });

  it('escalates an unrecognised line only when it reads like a failure', () => {
    expect(classifyStderrLine('Something unexpected happened')).toBeNull();
    expect(classifyStderrLine('[out#0/flv @ 0x1] Could not write header')).toBe('UNKNOWN');
  });
});
