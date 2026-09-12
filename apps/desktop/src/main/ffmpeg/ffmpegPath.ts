/**
 * Where the FFmpeg binary comes from.
 *
 * Production: a binary we ship, unpacked next to the app in `resources/ffmpeg/<platform>/`. Never
 * PATH in production — a PATH lookup would let anything earlier on the user's PATH be executed as
 * the media engine, and would also make "does streaming work?" depend on the user's machine.
 *
 * Development / CI / the headless verification script: fall back to `ffmpeg` on PATH.
 *
 * Licensing note (full text in docs/architecture/DESKTOP_ARCHITECTURE.md): the binaries we ship are
 * GPL-licensed builds (libx264 is GPL). LIVETAP stays MIT because FFmpeg runs as a SEPARATE PROCESS
 * invoked over pipes and a documented CLI — mere aggregation, not a derived work. We therefore must
 * (a) ship FFmpeg's licence and source offer in THIRD_PARTY_NOTICES.md, (b) not link FFmpeg into
 * the app binary, and (c) not use `-enable-nonfree` builds.
 */

import { accessSync, constants } from 'node:fs';
import path from 'node:path';

export interface FfmpegPathOptions {
  /** `process.resourcesPath` in a packaged Electron app; undefined in dev. */
  resourcesPath?: string | undefined;
  platform?: NodeJS.Platform;
  /** Injected for tests. */
  isPackaged?: boolean;
  /** Injected for tests: returns true when the path exists and is executable. */
  exists?: (candidate: string) => boolean;
  /** Explicit override, e.g. `LIVETAP_FFMPEG_PATH`. Used by the verification script. */
  override?: string | undefined;
}

export interface ResolvedFfmpeg {
  /** Absolute path, or the bare name `ffmpeg`/`ffmpeg.exe` when falling back to PATH. */
  path: string;
  source: 'override' | 'bundled' | 'path';
  /** Honest label for diagnostics: a PATH fallback is not a shippable configuration. */
  bundled: boolean;
}

/** Sub-directory of `resources/ffmpeg` for a platform. */
export function platformDir(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'mac';
  return 'linux';
}

export function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function defaultExists(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveFfmpegPath(options: FfmpegPathOptions = {}): ResolvedFfmpeg {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? defaultExists;

  const override = options.override ?? process.env.LIVETAP_FFMPEG_PATH;
  if (override && override.length > 0) {
    return { path: override, source: 'override', bundled: false };
  }

  if (options.resourcesPath) {
    const bundled = path.join(options.resourcesPath, 'ffmpeg', platformDir(platform), binaryName(platform));
    if (exists(bundled)) return { path: bundled, source: 'bundled', bundled: true };
  }

  // Dev fallback. In a packaged build this means the extraResources step was missed; callers should
  // surface that as UNVERIFIED rather than pretending the engine is production-ready.
  return { path: binaryName(platform), source: 'path', bundled: false };
}

/** Same resolution for ffprobe, used by diagnostics and the verification script. */
export function resolveFfprobePath(options: FfmpegPathOptions = {}): ResolvedFfmpeg {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? defaultExists;
  const override = process.env.LIVETAP_FFPROBE_PATH;
  if (override && override.length > 0) return { path: override, source: 'override', bundled: false };
  const name = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  if (options.resourcesPath) {
    const bundled = path.join(options.resourcesPath, 'ffmpeg', platformDir(platform), name);
    if (exists(bundled)) return { path: bundled, source: 'bundled', bundled: true };
  }
  return { path: name, source: 'path', bundled: false };
}
