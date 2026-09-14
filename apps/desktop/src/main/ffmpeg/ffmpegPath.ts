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
  /**
   * Where it came from. `unavailable` means this is a PACKAGED build whose `resources/ffmpeg/`
   * directory is empty: `path` is then the absolute place the binary was expected, which does not
   * exist, so every probe fails and the engine reports UNAVAILABLE.
   */
  source: 'override' | 'bundled' | 'path' | 'unavailable';
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

  const bundled = options.resourcesPath
    ? path.join(options.resourcesPath, 'ffmpeg', platformDir(platform), binaryName(platform))
    : null;
  if (bundled && exists(bundled)) return { path: bundled, source: 'bundled', bundled: true };

  if (options.isPackaged === true) {
    /*
     * NO PATH FALLBACK IN A PACKAGED BUILD. Two reasons, and the second is the honesty one.
     * A PATH lookup would execute whatever is first on the user's PATH as the media engine. And
     * on a machine that happens to have ffmpeg installed, a build whose extraResources step was
     * missed would appear to work here and fail on every other user's machine. Returning the
     * absolute place the binary was expected makes the probe fail with a real ENOENT, which is
     * what turns `capabilities().verification` into UNAVAILABLE instead of a hopeful PASS.
     */
    return { path: bundled ?? path.join('resources', 'ffmpeg', platformDir(platform), binaryName(platform)), source: 'unavailable', bundled: false };
  }

  // Dev / CI / the headless verification script.
  return { path: binaryName(platform), source: 'path', bundled: false };
}

/** Same resolution for ffprobe, used by diagnostics and the verification script. */
export function resolveFfprobePath(options: FfmpegPathOptions = {}): ResolvedFfmpeg {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? defaultExists;
  const override = process.env.LIVETAP_FFPROBE_PATH;
  if (override && override.length > 0) return { path: override, source: 'override', bundled: false };
  const name = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const bundled = options.resourcesPath ? path.join(options.resourcesPath, 'ffmpeg', platformDir(platform), name) : null;
  if (bundled && exists(bundled)) return { path: bundled, source: 'bundled', bundled: true };
  if (options.isPackaged === true) {
    return { path: bundled ?? path.join('resources', 'ffmpeg', platformDir(platform), name), source: 'unavailable', bundled: false };
  }
  return { path: name, source: 'path', bundled: false };
}
