#!/usr/bin/env node
/**
 * Put a working FFmpeg + FFprobe into `apps/desktop/resources/ffmpeg/<platform>/`.
 *
 *   node tools/acquire-ffmpeg.mjs [--force] [--platform win|mac|linux]
 *
 * WHY THIS EXISTS
 * The packaged desktop app never looks on PATH (see `apps/desktop/src/main/ffmpeg/ffmpegPath.ts`:
 * a PATH lookup in a packaged build would execute whatever happens to be first on the user's PATH
 * as the media engine, and would make "does streaming work?" depend on the user's machine). So the
 * binaries have to be IN the installer. They are large (222 MB each for the gyan.dev full static
 * build, which links every codec in) and GPL-licensed, so they are not committed — which means
 * every fresh checkout starts with an empty `resources/ffmpeg/` and an installer that cannot put a
 * byte on the wire. This script closes that gap reproducibly.
 *
 * WHAT IT DOES, IN ORDER
 *   1. Looks for ffmpeg/ffprobe on PATH and resolves shims to the real executable. On Windows a
 *      WinGet-installed ffmpeg is a 151-byte reparse point under `WinGet\Links\`; copying that
 *      verbatim produces an installer containing a link to a directory that does not exist on the
 *      user's machine, which is worse than shipping nothing because it fails at broadcast time
 *      rather than at install time.
 *   2. Copies both binaries into the destination.
 *   3. PROVES what it placed by executing `<dest>/ffmpeg -version` and `<dest>/ffprobe -version`
 *      and asserting both start. A copy that succeeded is not evidence; a process that ran is.
 *   4. Writes `resources/ffmpeg/BUILD_INFO.txt` — the exact build string, the configure line and
 *      the SHA-256 of each binary. THIRD_PARTY_NOTICES.md points at that file, and the GPLv3
 *      source offer has to name the exact build it is an offer for.
 *
 * If nothing usable is on PATH it prints the exact download URL and the exact destination path and
 * exits non-zero. It deliberately does NOT download: pulling hundreds of megabytes of GPL binaries
 * over the network unattended, from a mirror whose checksum this repo does not pin, is not
 * something a build step should do behind the operator's back.
 *
 * Dependency-free on purpose: it runs before `npm install` has necessarily produced anything more
 * than node itself, and it is the one step that a human may have to run by hand on a fresh machine.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const RESOURCES = join(REPO, 'apps', 'desktop', 'resources', 'ffmpeg');

/**
 * A real ffmpeg.exe is tens to hundreds of megabytes; a WinGet link stub is 151 bytes and a
 * .cmd/.bat shim is a few hundred. Anything under this is a pointer, not a program.
 */
const MIN_REAL_BINARY_BYTES = 4 * 1024 * 1024;

const args = process.argv.slice(2);
const force = args.includes('--force');
const platformArg = (() => {
  const i = args.indexOf('--platform');
  return i >= 0 ? args[i + 1] : undefined;
})();

/** Same mapping as `platformDir()` in ffmpegPath.ts. Kept in step with it by hand; a mismatch here
 *  puts the binaries in a folder the app never looks in, which the verify step then catches. */
function platformDir(platform) {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'mac';
  return 'linux';
}

const dirName = platformArg ?? platformDir(process.platform);
const isWindowsTarget = dirName === 'win';
const exe = isWindowsTarget ? '.exe' : '';
const DEST = join(RESOURCES, dirName);

/** Where to get a GPL build by hand, per platform. Printed on failure — never fetched. */
const DOWNLOAD = {
  win: {
    url: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.1-full_build.7z',
    note:
      'gyan.dev "full" build (GPLv3, --enable-gpl --enable-version3). Latest-release alias: ' +
      'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z — unpack and take bin/ffmpeg.exe ' +
      'and bin/ffprobe.exe.',
  },
  mac: {
    url: 'https://evermeet.cx/ffmpeg/',
    note:
      'evermeet.cx publishes GPL static builds of ffmpeg and ffprobe for macOS. Take a build whose ' +
      'architecture matches the dmg being produced, and remember it must be signed with the app ' +
      'under the hardened runtime (docs/release/DESKTOP_RELEASE.md §4).',
  },
  linux: {
    url: 'https://johnvansickle.com/ffmpeg/',
    note: 'johnvansickle.com static builds (GPL). Linux is not a launch target.',
  },
}[dirName] ?? { url: '(unknown platform)', note: '' };

/* ------------------------------------------------------------------ PATH lookup */

/**
 * Find `name` on PATH and return the REAL file it points at.
 *
 * Deliberately not `which`/`where`: those print the shim's own path, and on this host that shim is
 * the thing we must not copy. PATHEXT is honoured on Windows so `ffmpeg` finds `ffmpeg.exe`.
 */
function findOnPath(name) {
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const exts = isWindowsTarget
    ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)]
    : [''];

  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      let stat;
      try {
        stat = lstatSync(candidate);
      } catch {
        continue;
      }
      if (!stat.isFile() && !stat.isSymbolicLink()) continue;

      // Resolve symlinks, junctions and WinGet reparse points to the executable behind them.
      let real = candidate;
      try {
        real = realpathSync.native(candidate);
      } catch {
        try {
          real = realpathSync(candidate);
        } catch {
          /* keep the literal path and let the size check below judge it */
        }
      }

      let size = 0;
      try {
        size = statSync(real).size;
      } catch {
        continue;
      }
      if (size < MIN_REAL_BINARY_BYTES) {
        // A .cmd/.bat wrapper, or a link we could not resolve. Say so rather than copying it.
        console.warn(
          `[acquire-ffmpeg] skipping ${candidate} -> ${real} (${size} B): too small to be a real ` +
            'binary; it is a shim this script could not resolve.',
        );
        continue;
      }
      return real;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ proof */

/** Run `<binary> -version` and return its first line, or null if it did not start. */
function versionLineOf(binary) {
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) return null;
  const first = `${result.stdout ?? ''}`.split(/\r?\n/)[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function fullVersionOutput(binary) {
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 30_000 });
  return `${result.stdout ?? ''}`;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/* ------------------------------------------------------------------ main */

mkdirSync(DEST, { recursive: true });

const wanted = ['ffmpeg', 'ffprobe'];
const placed = {};
let failed = false;

for (const name of wanted) {
  const target = join(DEST, name + exe);

  if (!force && existsSync(target) && statSync(target).size >= MIN_REAL_BINARY_BYTES) {
    console.log(`[acquire-ffmpeg] already present: ${target}`);
    placed[name] = target;
    continue;
  }

  const source = findOnPath(name);
  if (!source) {
    console.error(
      `\n[acquire-ffmpeg] MISSING: ${name}${exe}\n` +
        `  needed at : ${target}\n` +
        `  download  : ${DOWNLOAD.url}\n` +
        `  ${DOWNLOAD.note}\n` +
        `  Then re-run: node tools/acquire-ffmpeg.mjs\n`,
    );
    failed = true;
    continue;
  }

  copyFileSync(source, target);
  if (!isWindowsTarget) chmodSync(target, 0o755);
  console.log(
    `[acquire-ffmpeg] copied ${source} -> ${target} (${statSync(target).size.toLocaleString()} B)`,
  );
  placed[name] = target;
  copyLicenseBeside(source);
}

/**
 * Ship the licence WITH the binary, not only in a repo file.
 *
 * GPLv3 §4 requires the licence text to accompany each copy conveyed. `resources/ffmpeg/` is copied
 * wholesale into the installed app by `extraResources`, so a file dropped here ends up inside the
 * installation the owner receives — which is the copy the obligation attaches to. Distribution
 * builds lay the licence out as `<root>/LICENSE` and `<root>/README.txt` next to `bin/`, so that is
 * where this looks; if a build is laid out differently the files are simply absent and the doc in
 * THIRD_PARTY_NOTICES.md is the fallback record.
 */
function copyLicenseBeside(sourceBinary) {
  const root = dirname(dirname(sourceBinary)); // <root>/bin/ffmpeg.exe -> <root>
  for (const [from, to] of [
    ['LICENSE', 'FFMPEG-LICENSE.txt'],
    ['README.txt', 'FFMPEG-BUILD-README.txt'],
  ]) {
    const src = join(root, from);
    if (!existsSync(src)) continue;
    const dst = join(DEST, to);
    if (existsSync(dst) && !force) continue;
    copyFileSync(src, dst);
    console.log(`[acquire-ffmpeg] copied ${src} -> ${dst}`);
  }
}

if (failed) {
  console.error('[acquire-ffmpeg] FAILED: the packaged app would report ffmpeg UNAVAILABLE.');
  process.exit(1);
}

// The loop above skips a binary that is already in place, and with it the licence copy. Catch that
// case here so a second run on a half-populated directory still satisfies the GPL obligation.
if (!existsSync(join(DEST, 'FFMPEG-LICENSE.txt'))) {
  const fallback = findOnPath('ffmpeg');
  if (fallback) copyLicenseBeside(fallback);
}
if (!existsSync(join(DEST, 'FFMPEG-LICENSE.txt'))) {
  console.warn(
    `[acquire-ffmpeg] WARNING: no FFMPEG-LICENSE.txt in ${DEST}. GPLv3 §4 requires the licence ` +
      'text to accompany the binary. Copy the build\'s LICENSE file there before distributing.',
  );
}

/*
 * Proof, not optimism: execute what was placed. A binary can copy cleanly and still refuse to run
 * (wrong architecture, a half-written file, a missing runtime DLL). Only run the destination copy
 * when it is native to this host — a mac binary staged from a Windows box cannot be executed here,
 * and pretending otherwise would be exactly the dishonesty this check exists to prevent.
 */
const nativeTarget = dirName === platformDir(process.platform);
const versions = {};
if (nativeTarget) {
  for (const name of wanted) {
    const line = versionLineOf(placed[name]);
    if (!line) {
      console.error(`[acquire-ffmpeg] FAILED: ${placed[name]} did not run (\`-version\` failed).`);
      process.exit(1);
    }
    if (!line.startsWith(`${name} version`)) {
      console.error(
        `[acquire-ffmpeg] FAILED: ${placed[name]} ran but identified itself as "${line}", ` +
          `not a ${name} build.`,
      );
      process.exit(1);
    }
    versions[name] = line;
    console.log(`[acquire-ffmpeg] VERIFIED ${name}: ${line}`);
  }
} else {
  console.warn(
    `[acquire-ffmpeg] staged for "${dirName}" on a ${process.platform} host: cannot execute the ` +
      'copies to verify them. Run this script on the target platform before shipping that build.',
  );
}

/* --------------------------------------------------------- BUILD_INFO.txt */

/*
 * THIRD_PARTY_NOTICES.md cites this file for "exact build and SHA-256 recorded at packaging time",
 * and GPLv3 §6 obliges an offer for the source of THIS build, not of ffmpeg in general. So the
 * configure line goes in verbatim: it is what names every GPL component linked into the binary.
 */
if (nativeTarget) {
  const output = fullVersionOutput(placed.ffmpeg);
  const configuration =
    output.split(/\r?\n/).find((l) => l.startsWith('configuration:')) ?? 'configuration: (unknown)';
  const info = [
    'FFmpeg binaries bundled with the LIVETAP desktop app',
    '',
    `platform-dir : ${dirName}`,
    `recorded     : ${new Date().toISOString()}`,
    `recorded-on  : ${process.platform} ${process.arch}`,
    '',
    `ffmpeg       : ${versions.ffmpeg}`,
    `ffprobe      : ${versions.ffprobe}`,
    '',
    `sha256 ffmpeg${exe}  : ${sha256(placed.ffmpeg)}`,
    `sha256 ffprobe${exe} : ${sha256(placed.ffprobe)}`,
    `bytes  ffmpeg${exe}  : ${statSync(placed.ffmpeg).size}`,
    `bytes  ffprobe${exe} : ${statSync(placed.ffprobe).size}`,
    '',
    configuration,
    '',
    'License: this is a GPL build (--enable-gpl --enable-version3, linking libx264). Distributing',
    'it obliges LIVETAP to ship the GPL text and a written offer of the corresponding source for',
    'exactly this build. See THIRD_PARTY_NOTICES.md.',
    '',
    'Regenerate with: node tools/acquire-ffmpeg.mjs --force',
    '',
  ].join('\n');
  const infoPath = join(RESOURCES, 'BUILD_INFO.txt');
  writeFileSync(infoPath, info, 'utf8');
  console.log(`[acquire-ffmpeg] wrote ${infoPath}`);
}

console.log(`[acquire-ffmpeg] OK — ${DEST} is ready for packaging.`);
