import { afterEach, describe, expect, it } from 'vitest';

import type { RecorderSupport } from './diagnostics.js';
import {
  CANDIDATE_MIME_TYPES,
  RECORDER_TIMESLICE_MS,
  describeRecorderSupport,
  probeRecorderSupport,
  recorderOptions,  KEYFRAME_INTERVAL_MS,
} from './diagnostics.js';

interface Globals {
  MediaRecorder?: unknown;
  VideoEncoder?: unknown;
}

const globals = globalThis as Globals;

afterEach(() => {
  delete globals.MediaRecorder;
  delete globals.VideoEncoder;
});

function stubMediaRecorder(supported: string[]): void {
  globals.MediaRecorder = { isTypeSupported: (type: string) => supported.includes(type) };
}

function stubVideoEncoder(supportedCodecs: string[]): void {
  globals.VideoEncoder = {
    isConfigSupported: (config: { codec: string }) =>
      Promise.resolve({ supported: supportedCodecs.includes(config.codec) }),
  };
}

describe('CANDIDATE_MIME_TYPES', () => {
  it('puts H.264 first, because H.264 is what RTMP needs', () => {
    expect(CANDIDATE_MIME_TYPES[0]).toContain('h264');
    const firstVpIndex = CANDIDATE_MIME_TYPES.findIndex((m) => m.includes('vp8') || m.includes('vp9'));
    const lastH264Index = CANDIDATE_MIME_TYPES.reduce(
      (last, m, i) => (/h264|avc1/.test(m) ? i : last),
      -1,
    );
    expect(lastH264Index).toBeLessThan(firstVpIndex);
  });
});

describe('probeRecorderSupport', () => {
  it('chooses H.264 and reports the single-encode path when Chromium offers it', async () => {
    // This is what the build host actually reports (Electron 38.8.6 / Chrome 140).
    stubMediaRecorder(['video/webm;codecs=h264,opus', 'video/webm;codecs=h264', 'video/webm;codecs=vp9,opus']);
    stubVideoEncoder(['avc1.640028']);
    const report = await probeRecorderSupport();
    expect(report.chosen).toBe('video/webm;codecs=h264,opus');
    expect(report.h264).toBe(true);
    expect(report.hardwareRelief).toBe(true);
    expect(report.webCodecs.available).toBe(true);
    expect(report.webCodecs.h264Configs['avc1.640028']).toBe(true);
    expect(report.webCodecs.h264Configs['avc1.42E01E']).toBe(false);
  });

  it('falls back to VP9 and flags that main will have to transcode', async () => {
    stubMediaRecorder(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']);
    const report = await probeRecorderSupport();
    expect(report.chosen).toBe('video/webm;codecs=vp9,opus');
    expect(report.h264).toBe(false);
    expect(report.hardwareRelief).toBe(false);
  });

  it('reports honestly when MediaRecorder does not exist at all', async () => {
    const report = await probeRecorderSupport();
    expect(report.chosen).toBeNull();
    expect(report.h264).toBe(false);
    expect(Object.values(report.supported).every((v) => v === false)).toBe(true);
    expect(report.webCodecs.available).toBe(false);
  });

  it('survives an isTypeSupported that throws', async () => {
    globals.MediaRecorder = {
      isTypeSupported: () => {
        throw new Error('codec policy blocked');
      },
    };
    const report = await probeRecorderSupport();
    expect(report.chosen).toBeNull();
  });

  it('survives a VideoEncoder that rejects', async () => {
    stubMediaRecorder(['video/webm;codecs=h264,opus']);
    globals.VideoEncoder = { isConfigSupported: () => Promise.reject(new Error('nope')) };
    const report = await probeRecorderSupport();
    expect(report.h264).toBe(true);
    expect(Object.values(report.webCodecs.h264Configs).every((v) => v === false)).toBe(true);
  });

  it('probes at the size it was asked about', async () => {
    const seen: Array<{ width: number; height: number }> = [];
    stubMediaRecorder([]);
    globals.VideoEncoder = {
      isConfigSupported: (config: { width: number; height: number }) => {
        seen.push({ width: config.width, height: config.height });
        return Promise.resolve({ supported: true });
      },
    };
    await probeRecorderSupport(1080, 1920);
    expect(seen[0]).toEqual({ width: 1080, height: 1920 });
  });
});

describe('describeRecorderSupport', () => {
  it('explains the good path in beginner language', () => {
    const report: RecorderSupport = {
      supported: {},
      chosen: 'video/webm;codecs=h264,opus',
      h264: true,
      hardwareRelief: true,
      webCodecs: { available: true, h264Configs: { 'avc1.640028': true } },
    };
    const lines = describeRecorderSupport(report);
    expect(lines.join(' ')).toContain('encodes once and never re-encodes');
    expect(lines.join(' ')).toContain('avc1.640028');
  });

  it('explains the transcode path without jargon', () => {
    const lines = describeRecorderSupport({
      supported: {},
      chosen: 'video/webm;codecs=vp9,opus',
      h264: false,
      hardwareRelief: false,
      webCodecs: { available: false, h264Configs: {} },
    });
    expect(lines.join(' ')).toContain('converts video once on the CPU');
  });

  it('says so when there is nothing to stream with', () => {
    const lines = describeRecorderSupport({
      supported: {},
      chosen: null,
      h264: false,
      hardwareRelief: false,
      webCodecs: { available: false, h264Configs: {} },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('cannot stream');
  });

  it('notes when WebCodecs is present but useless at this resolution', () => {
    const lines = describeRecorderSupport({
      supported: {},
      chosen: 'video/webm;codecs=h264,opus',
      h264: true,
      hardwareRelief: true,
      webCodecs: { available: true, h264Configs: { 'avc1.42E01E': false } },
    });
    expect(lines.join(' ')).toContain('no working H.264 configuration');
  });
});

describe('recorderOptions', () => {
  it('converts kbps to the bits-per-second MediaRecorder wants', () => {
    expect(recorderOptions('video/webm;codecs=h264,opus', 4500, 160)).toEqual({
      mimeType: 'video/webm;codecs=h264,opus',
      videoBitsPerSecond: 4_500_000,
      audioBitsPerSecond: 160_000,
      videoKeyFrameIntervalDuration: 2000,
    });
  });

  /**
   * Chromium left alone emits a keyframe about every 7.2 s. Measured with ffprobe on a real
   * recording from this host: keyframes at 2.058, 9.383, 16.620, 23.831 seconds.
   *
   * That is longer than Twitch permits (4 s), longer than a new viewer should stare at nothing,
   * and - the reason it was found - longer than the window a RECONNECTING destination has to lock
   * onto the stream before ffmpeg gives up, which made "the failed destination reconnects
   * independently" impossible on desktop.
   */
  it('asks for a keyframe every 2 seconds, which is what platforms and reconnect both need', () => {
    expect(KEYFRAME_INTERVAL_MS).toBe(2000);
    expect(recorderOptions('video/webm', 4500, 160).videoKeyFrameIntervalDuration).toBe(
      KEYFRAME_INTERVAL_MS,
    );
    // Twitch's documented ceiling. A change that crosses it should fail here, not at a platform.
    expect(KEYFRAME_INTERVAL_MS).toBeLessThanOrEqual(4000);
  });

  it('uses a 1-second timeslice: ~330 KB a chunk, a 1.7 ms IPC send (measured)', () => {
    expect(RECORDER_TIMESLICE_MS).toBe(1000);
  });
});
