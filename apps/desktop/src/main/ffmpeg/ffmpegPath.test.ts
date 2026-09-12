import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { binaryName, platformDir, resolveFfmpegPath, resolveFfprobePath } from './ffmpegPath.js';

const originalOverride = process.env.LIVETAP_FFMPEG_PATH;

afterEach(() => {
  if (originalOverride === undefined) delete process.env.LIVETAP_FFMPEG_PATH;
  else process.env.LIVETAP_FFMPEG_PATH = originalOverride;
  delete process.env.LIVETAP_FFPROBE_PATH;
});

describe('platformDir / binaryName', () => {
  it('maps platforms to the extraResources layout', () => {
    expect(platformDir('win32')).toBe('win');
    expect(platformDir('darwin')).toBe('mac');
    expect(platformDir('linux')).toBe('linux');
    expect(binaryName('win32')).toBe('ffmpeg.exe');
    expect(binaryName('darwin')).toBe('ffmpeg');
  });
});

describe('resolveFfmpegPath', () => {
  it('prefers the bundled binary in a packaged app', () => {
    const expected = path.join('C:\\app\\resources', 'ffmpeg', 'win', 'ffmpeg.exe');
    const resolved = resolveFfmpegPath({
      resourcesPath: 'C:\\app\\resources',
      platform: 'win32',
      isPackaged: true,
      exists: (candidate) => candidate === expected,
    });
    expect(resolved.path).toBe(expected);
    expect(resolved.source).toBe('bundled');
    expect(resolved.bundled).toBe(true);
  });

  it('looks in the mac directory on darwin', () => {
    const expected = path.join('/App/Contents/Resources', 'ffmpeg', 'mac', 'ffmpeg');
    const resolved = resolveFfmpegPath({
      resourcesPath: '/App/Contents/Resources',
      platform: 'darwin',
      exists: (candidate) => candidate === expected,
    });
    expect(resolved.path).toBe(expected);
    expect(resolved.bundled).toBe(true);
  });

  it('falls back to PATH in dev, and says so honestly', () => {
    const resolved = resolveFfmpegPath({ platform: 'win32', exists: () => false });
    expect(resolved.path).toBe('ffmpeg.exe');
    expect(resolved.source).toBe('path');
    // `bundled: false` is what main uses to log loudly in a packaged build.
    expect(resolved.bundled).toBe(false);
  });

  it('reports the PATH fallback even when resourcesPath is set but the binary is missing', () => {
    const resolved = resolveFfmpegPath({
      resourcesPath: 'C:\\app\\resources',
      platform: 'win32',
      isPackaged: true,
      exists: () => false,
    });
    expect(resolved.source).toBe('path');
    expect(resolved.bundled).toBe(false);
  });

  it('honours an explicit override, used by the verification script', () => {
    const resolved = resolveFfmpegPath({ override: 'D:\\tools\\ffmpeg.exe', platform: 'win32', exists: () => true });
    expect(resolved.path).toBe('D:\\tools\\ffmpeg.exe');
    expect(resolved.source).toBe('override');
    expect(resolved.bundled).toBe(false);
  });

  it('reads the override from the environment', () => {
    process.env.LIVETAP_FFMPEG_PATH = '/usr/local/bin/ffmpeg';
    expect(resolveFfmpegPath({ platform: 'linux', exists: () => false }).path).toBe('/usr/local/bin/ffmpeg');
  });

  it('ignores an empty override', () => {
    process.env.LIVETAP_FFMPEG_PATH = '';
    expect(resolveFfmpegPath({ platform: 'linux', exists: () => false }).source).toBe('path');
  });
});

describe('resolveFfprobePath', () => {
  it('resolves ffprobe next to ffmpeg', () => {
    const expected = path.join('C:\\app\\resources', 'ffmpeg', 'win', 'ffprobe.exe');
    const resolved = resolveFfprobePath({
      resourcesPath: 'C:\\app\\resources',
      platform: 'win32',
      exists: (candidate) => candidate === expected,
    });
    expect(resolved.path).toBe(expected);
    expect(resolved.bundled).toBe(true);
  });

  it('falls back to PATH', () => {
    expect(resolveFfprobePath({ platform: 'darwin', exists: () => false }).path).toBe('ffprobe');
  });
});
