import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTION_SETTINGS, degradeFormat, formatForPreset, resolveFormats } from './formats.js';

describe('formats', () => {
  it('derives correct dimensions per aspect ratio', () => {
    expect(formatForPreset('1080p30', '16:9')).toMatchObject({ width: 1920, height: 1080, fps: 30, videoKbps: 4500 });
    expect(formatForPreset('1080p60', '9:16')).toMatchObject({ width: 1080, height: 1920, fps: 60, videoKbps: 6000 });
    expect(formatForPreset('720p30', '1:1')).toMatchObject({ width: 720, height: 720, fps: 30, videoKbps: 2500 });
    expect(formatForPreset('auto', '16:9').height).toBe(1080);
  });

  it('resolves one format per distinct aspect ratio, not per destination', () => {
    const f = resolveFormats(DEFAULT_PRODUCTION_SETTINGS, ['16:9', '16:9', '9:16']);
    expect(f['16:9']).toBeDefined();
    expect(f['9:16']).toBeDefined();
    expect(f['1:1']).toBeUndefined();
  });

  it('falls back to the master aspect when no destinations are given', () => {
    const f = resolveFormats(DEFAULT_PRODUCTION_SETTINGS, []);
    expect(f['16:9']).toBeDefined();
  });

  it('honours explicit Pro formats', () => {
    const custom = formatForPreset('720p30', '16:9');
    const f = resolveFormats({ ...DEFAULT_PRODUCTION_SETTINGS, formats: { '16:9': custom } }, ['16:9']);
    expect(f['16:9']).toBe(custom);
  });

  it('degrades stepwise and returns null at the floor', () => {
    const f = formatForPreset('1080p60', '16:9');
    const b = degradeFormat(f, 'lowerBitrate');
    expect(b?.videoKbps).toBe(4500);
    const r = degradeFormat(f, 'lowerResolution');
    expect(r).toMatchObject({ width: 1280, height: 720 });
    expect(degradeFormat(r!, 'lowerResolution')).toBeNull();
    const fps = degradeFormat(f, 'lowerFps');
    expect(fps?.fps).toBe(30);
    expect(degradeFormat(degradeFormat(fps!, 'lowerFps')!, 'lowerFps')).toBeNull();
    let low = formatForPreset('720p30', '16:9');
    for (let i = 0; i < 10 && low; i++) low = degradeFormat(low, 'lowerBitrate') ?? low;
    expect(low.videoKbps).toBeGreaterThanOrEqual(800);
  });
});
