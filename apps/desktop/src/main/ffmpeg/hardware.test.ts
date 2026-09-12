import { describe, expect, it } from 'vitest';

import type { HardwareReport } from './hardware.js';
import { chooseEncoder } from './hardware.js';

/** The honest report from the build host: nvenc/qsv/amf compiled in, none of them usable. */
const noGpu: HardwareReport = {
  ffmpegPath: 'ffmpeg',
  ffmpegVersion: 'ffmpeg version 9.0.1',
  all: [
    { encoder: 'h264_nvenc', kind: 'nvenc', status: 'UNAVAILABLE', detail: 'Cannot load nvcuda.dll', elapsedMs: 98 },
    { encoder: 'h264_qsv', kind: 'qsv', status: 'UNAVAILABLE', detail: 'Error creating a MFX session: -9.', elapsedMs: 215 },
    { encoder: 'h264_amf', kind: 'amf', status: 'UNAVAILABLE', detail: 'DLL amfrt64.dll failed to open', elapsedMs: 98 },
    { encoder: 'libx264', kind: 'software', status: 'PASS', elapsedMs: 232 },
  ],
  working: [{ encoder: 'libx264', kind: 'software', status: 'PASS', elapsedMs: 232 }],
  recommended: 'libx264',
  hardwareKinds: [],
};

const withNvenc: HardwareReport = {
  ffmpegPath: 'ffmpeg',
  ffmpegVersion: 'ffmpeg version 9.0.1',
  all: [
    { encoder: 'h264_nvenc', kind: 'nvenc', status: 'PASS', elapsedMs: 60 },
    { encoder: 'h264_qsv', kind: 'qsv', status: 'UNAVAILABLE', elapsedMs: 40 },
    { encoder: 'libx264', kind: 'software', status: 'PASS', elapsedMs: 220 },
  ],
  working: [
    { encoder: 'h264_nvenc', kind: 'nvenc', status: 'PASS', elapsedMs: 60 },
    { encoder: 'libx264', kind: 'software', status: 'PASS', elapsedMs: 220 },
  ],
  recommended: 'h264_nvenc',
  hardwareKinds: ['nvenc'],
};

describe('chooseEncoder', () => {
  it('auto picks working hardware when there is any', () => {
    expect(chooseEncoder('auto', withNvenc)).toBe('h264_nvenc');
  });

  it('auto falls back to libx264 when no hardware works', () => {
    expect(chooseEncoder('auto', noGpu)).toBe('libx264');
  });

  it('software always means libx264', () => {
    expect(chooseEncoder('software', withNvenc)).toBe('libx264');
    expect(chooseEncoder('software', noGpu)).toBe('libx264');
  });

  it('honours an explicit hardware preference that actually works', () => {
    expect(chooseEncoder('nvenc', withNvenc)).toBe('h264_nvenc');
  });

  it('falls back instead of failing at GO LIVE when the requested hardware does not work', () => {
    // This is the difference between "encoder unavailable" at 20:00 and a stream that just works.
    expect(chooseEncoder('nvenc', noGpu)).toBe('libx264');
    expect(chooseEncoder('qsv', withNvenc)).toBe('h264_nvenc');
    expect(chooseEncoder('videotoolbox', noGpu)).toBe('libx264');
  });

  it('treats webcodecs (a renderer-side option) as auto for the ffmpeg side', () => {
    expect(chooseEncoder('webcodecs', withNvenc)).toBe('h264_nvenc');
  });

  it('never returns something outside the working set', () => {
    const empty: HardwareReport = { ...noGpu, all: [], working: [], recommended: 'libx264', hardwareKinds: [] };
    expect(chooseEncoder('auto', empty)).toBe('libx264');
    expect(chooseEncoder('nvenc', empty)).toBe('libx264');
  });

  it('does not advertise a compiled-but-broken encoder as a hardware kind', () => {
    expect(noGpu.hardwareKinds).toEqual([]);
    expect(noGpu.all.filter((r) => r.status === 'UNAVAILABLE')).toHaveLength(3);
    // The reason must be preserved for Pro-mode diagnostics.
    expect(noGpu.all[0]?.detail).toContain('nvcuda.dll');
  });
});
