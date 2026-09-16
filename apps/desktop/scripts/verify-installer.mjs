/**
 * Assert what the Windows installer actually contains.
 *
 *   node apps/desktop/scripts/verify-installer.mjs [path/to/LIVETAP-<v>-win-x64.exe]
 *
 * WHY THIS EXISTS
 * The same reason `apps/mobile/scripts/verify-apk.mjs` exists: every claim this repo makes in prose
 * about the shipped artifact rots the moment someone changes a build script, and a packaging run
 * that exits 0 proves only that electron-builder did not crash. It does not prove that FFmpeg is
 * inside, that the renderer is the real build rather than the demo, or that the placeholder page
 * did not quietly get packaged because a renderer build was skipped. Each of those has already
 * happened at least once in this repo's history. This turns each into an exit code.
 *
 * Unlike the APK, this artifact CAN be executed here, so this goes further than the APK verifier:
 * it runs the FFmpeg that shipped, from inside the unpacked application, and reads its version.
 * A file being present is not evidence that it works; a process that started is.
 *
 * Dependency-free: the asar is parsed with Node's own Buffer rather than `@electron/asar`, so this
 * runs on a checkout where only the installer and node exist.
 *
 * WHAT IT CANNOT PROVE
 * That the NSIS installer, when run, lays those files down correctly — that needs a machine to
 * install onto. It checks the unpacked tree electron-builder produced from exactly the same inputs,
 * plus the installer's own size and hash. That distinction is printed at the end rather than
 * glossed over.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeIdentity, identify } from './renderer-identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(here, '..');
const RELEASE = join(DESKTOP, 'release');
const UNPACKED = join(RELEASE, 'win-unpacked');

const version = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version;
const DEFAULT_INSTALLER = join(RELEASE, `LIVETAP-${version}-win-x64.exe`);
const argv = process.argv.slice(2);

/*
 * `--expect <sha>` and `--expect=<sha>` both work.
 *
 * The first version of this parser split flags from positionals with two filters, which meant the
 * space form's VALUE fell through into the positionals and was resolved as the installer path:
 * `--expect db9d89c` looked for an installer called `db9d89c`. It failed loudly rather than
 * quietly, which is the only reason it was not worse — but the documented invocation did not
 * work, and a flag that is wrong in its own usage line is a flag nobody trusts.
 */
const flags = [];
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) {
    positional.push(arg);
    continue;
  }
  flags.push(arg);
  if (arg === '--expect' && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
    flags.push(argv[i + 1]);
    i += 1;
  }
}
const installerPath = positional[0] ? resolve(positional[0]) : DEFAULT_INSTALLER;

/*
 * `--expect <sha>` is the OPERATOR's claim about which commit should be inside this artifact.
 *
 * The check below deliberately does NOT compare the recorded commit to HEAD. HEAD moves for
 * reasons that have nothing to do with the artifact, and routinely moves BECAUSE of it: package
 * from a clean tree, read the hashes, write them into the release notes, commit — and now HEAD is
 * one ahead of an artifact that is perfectly identified and perfectly current. A check no correct
 * release sequence can satisfy is a check somebody deletes.
 *
 * Worse, equality with HEAD is a coincidence detector. An artifact built ninety minutes ago from
 * a tree that has since been reset and rebuilt has the same HEAD and different bytes, and `==
 * HEAD` calls it fine. It fails the correct case and passes the incorrect one.
 *
 * So the script answers the question it can answer from the artifact alone — WHICH COMMIT IS THIS
 * FROM — and refuses to guess at the one only a person has: IS THAT THE COMMIT I WANT. `--expect`
 * is where that person says so.
 */
const expectCommit = (() => {
  const pair = flags.find((f) => f.startsWith('--expect='));
  if (pair) return pair.slice('--expect='.length);
  const i = flags.indexOf('--expect');
  return i >= 0 && flags[i + 1] !== undefined ? flags[i + 1] : null;
})();

/*
 * `--unversioned` narrows the CLAIM rather than switching the check off, exactly like
 * `--own-receiver` on the broadcast gate. A build from a source tarball with no `.git` genuinely
 * has no commit to name; the honest record of that is "unidentifiable", not a silent PASS that
 * reads as if identification had happened. A warning would not do: a PASS carries a claim, and
 * this script has already once reported 30/30 on a ninety-minute-old installer while everybody
 * believed it.
 */
const unversioned = flags.includes('--unversioned');

/*
 * The identity rules live in `renderer-identity.mjs` and are asked in TWO places: here, of the
 * finished artifact, and at prepackage, of the renderer about to be packed. One implementation
 * because two staleness rules at two pipeline stages is exactly how checks A and B ended up
 * agreeing with each other about a tree that had moved on.
 */

/*
 * An installer WITHOUT ffmpeg measured 94 MB on this host (docs/release/DESKTOP_RELEASE.md §2);
 * with the two ~220 MB GPL binaries compressed in it measures well over 200 MB. So a floor of
 * 150 MB separates the two cases with a wide margin either side. This is a heuristic on the
 * installer, deliberately: NSIS embeds an LZMA archive that cannot be read without unpacking it,
 * so the file-level proof is done on `win-unpacked/`, which electron-builder produced from exactly
 * the same inputs in the same run. Stated here rather than implied.
 */
const INSTALLER_MIN_BYTES = 150 * 1024 * 1024;

/* ------------------------------------------------------------------ asar reading */

/**
 * Parse an asar archive header.
 *
 * Layout: four little-endian uint32s, then the JSON, then the file payloads.
 *   [0..4)   4            — payload size of the size pickle, always 4
 *   [4..8)   headerSize   — the header pickle including its alignment padding
 *   [8..12)  payloadSize  — the header pickle's payload (headerSize minus padding)
 *   [12..16) jsonLength   — the JSON string's length
 *   [16..)   the JSON, then file payloads at `8 + headerSize + entry.offset`
 */
function readAsar(file) {
  const bytes = readFileSync(file);
  const headerSize = bytes.readUInt32LE(4);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 16, 16 + jsonLength));
  const dataOffset = 8 + headerSize;

  /** Flatten the directory tree into `path -> {size, read()}`. */
  const files = new Map();
  (function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, path);
      else if (typeof entry.offset === 'string') {
        const start = dataOffset + Number(entry.offset);
        files.set(path, {
          size: entry.size,
          read: () => bytes.subarray(start, start + entry.size),
        });
      } else {
        // `unpacked: true` entries live on disk next to the archive, not inside it.
        files.set(path, { size: entry.size ?? 0, unpacked: true, read: () => Buffer.alloc(0) });
      }
    }
  })(json, '');
  return files;
}

/* ------------------------------------------------------------------ assertions */

const results = [];
let failed = 0;

/* Facts the report prints whether or not anything failed: WHICH tree this artifact came from. */
const provenance = [];

function check(label, ok, detail) {
  results.push({ label, ok, detail });
  if (!ok) failed += 1;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/* --- 1. the installer itself ----------------------------------------------------- */

if (!existsSync(installerPath)) {
  console.error(
    `[verify-installer] no installer at ${installerPath}.\n` +
      'Run: npm run package:win -w @livetap/desktop   (needs Node >= 20.19; this host has a ' +
      'portable one at tools/node22/node)',
  );
  process.exit(1);
}

const installerBytes = readFileSync(installerPath);
const installerSha = sha256(installerBytes);
check(`installer exists: ${installerPath}`, true);
check(
  `installer carries its payload (${installerBytes.length.toLocaleString()} B >= ` +
    `${INSTALLER_MIN_BYTES.toLocaleString()} B)`,
  installerBytes.length >= INSTALLER_MIN_BYTES,
  'an installer this small cannot contain the bundled FFmpeg',
);

for (const sibling of ['.blockmap']) {
  check(`${sibling} emitted next to the installer`, existsSync(`${installerPath}${sibling}`));
}
check('latest.yml (electron-updater feed) emitted', existsSync(join(RELEASE, 'latest.yml')));

/* --- 2. the unpacked application ------------------------------------------------- */

check(`win-unpacked/ present at ${UNPACKED}`, existsSync(UNPACKED));
check('LIVETAP.exe present', existsSync(join(UNPACKED, 'LIVETAP.exe')));

/*
 * The path is `resources/ffmpeg/win/ffmpeg.exe`, not `resources/ffmpeg/ffmpeg.exe`: the `win`
 * segment comes from `platformDir()` in src/main/ffmpeg/ffmpegPath.ts, which is what the running
 * app joins onto `process.resourcesPath`. Verifying any other path would verify a file the app
 * never opens.
 */
const FFMPEG_DIR = join(UNPACKED, 'resources', 'ffmpeg', 'win');
const shippedFfmpeg = join(FFMPEG_DIR, 'ffmpeg.exe');
const shippedFfprobe = join(FFMPEG_DIR, 'ffprobe.exe');

for (const [label, binary] of [
  ['ffmpeg.exe', shippedFfmpeg],
  ['ffprobe.exe', shippedFfprobe],
]) {
  const present = existsSync(binary);
  check(
    `resources/ffmpeg/win/${label} shipped${present ? ` (${statSync(binary).size.toLocaleString()} B)` : ''}`,
    present,
    'without it the packaged app resolves source=unavailable and can never broadcast',
  );
  if (!present) continue;

  // Run the copy that shipped. Not the one on PATH, not the one in resources/ — this one.
  const run = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 60_000 });
  const first = `${run.stdout ?? ''}`.split(/\r?\n/)[0]?.trim() ?? '';
  check(
    `resources/ffmpeg/win/${label} RUNS: ${first || '(no output)'}`,
    run.status === 0 && first.startsWith(`${label.replace('.exe', '')} version`),
    run.error ? run.error.message : `exit ${run.status}`,
  );
}

/*
 * The transcode fallback in src/main/ffmpeg/argv.ts asks for libx264 by name. A build without it
 * would pass every check above and then fail at GO LIVE on any source that cannot be passed
 * through — which is most of them.
 */
if (existsSync(shippedFfmpeg)) {
  const encoders = spawnSync(shippedFfmpeg, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const list = `${encoders.stdout ?? ''}`;
  check('shipped ffmpeg has libx264 (the transcode fallback names it)', / libx264 /.test(list));
  check('shipped ffmpeg has aac (every RTMP destination requires it)', / aac /.test(list));

  const protocols = spawnSync(shippedFfmpeg, ['-hide_banner', '-protocols'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const proto = `${protocols.stdout ?? ''}`;
  check('shipped ffmpeg speaks rtmp', /^\s*rtmp\s*$/m.test(proto));
  check('shipped ffmpeg speaks rtmps (YouTube and Twitch ingest)', /^\s*rtmps\s*$/m.test(proto));
}

/*
 * GPLv3 §4: the licence text must accompany every copy conveyed. The installed application IS a
 * copy conveyed, so the text has to be inside it and not only in a repo file nobody receives.
 */
check(
  'FFMPEG-LICENSE.txt travels with the binary (GPLv3 §4)',
  existsSync(join(FFMPEG_DIR, 'FFMPEG-LICENSE.txt')),
);
const buildInfoPath = join(UNPACKED, 'resources', 'ffmpeg', 'BUILD_INFO.txt');
check('BUILD_INFO.txt records the exact build that shipped', existsSync(buildInfoPath));

/* --- 3. what is inside app.asar --------------------------------------------------- */

const asarPath = join(UNPACKED, 'resources', 'app.asar');
check('resources/app.asar present', existsSync(asarPath));

let asar = new Map();
if (existsSync(asarPath)) {
  asar = readAsar(asarPath);
  const renderer = [...asar.keys()].filter((f) => f.startsWith('dist/renderer/'));
  const main = [...asar.keys()].filter((f) => f.startsWith('dist/main/'));
  const preload = [...asar.keys()].filter((f) => f.startsWith('dist/preload/'));

  check(`app.asar contains dist/renderer/ (${renderer.length} files)`, renderer.length > 0);
  check(`app.asar contains dist/main/ (${main.length} files)`, main.length > 0);
  check(`app.asar contains dist/preload/ (${preload.length} files)`, preload.length > 0);
  check('the main entry point is in the archive', asar.has('dist/main/index.cjs'));
  check('the preload script is in the archive', asar.has('dist/preload/index.cjs'));
  check(
    `the renderer has a real asset bundle (${renderer.filter((f) => f.startsWith('dist/renderer/assets/')).length} chunks)`,
    renderer.some((f) => f.startsWith('dist/renderer/assets/') && f.endsWith('.js')),
    'a renderer with no assets/ is the packaging placeholder, not the app',
  );
  check('the shell entry point dist/renderer/app.html shipped', asar.has('dist/renderer/app.html'));

  const appHtml = asar.get('dist/renderer/app.html');
  if (appHtml) {
    const html = appHtml.read().toString('utf8');
    check(
      'app.html is the React shell, not packaging/renderer-placeholder.html',
      !/renderer is not built|placeholder/i.test(html) && /<div id="root"/.test(html),
      html.replace(/\s+/g, ' ').slice(0, 160),
    );
  }

  // Source maps and tests are excluded by `files:` in electron-builder.yml. If that ever stops
  // being true the app ships its own source, which is a leak and a size regression at once.
  check(
    'no source maps shipped',
    ![...asar.keys()].some((f) => f.endsWith('.map')),
    [...asar.keys()].filter((f) => f.endsWith('.map')).slice(0, 3).join(', '),
  );

  /* --- 4. the renderer is the REAL build, not the demo ---------------------------- */

  /*
   * Two independent witnesses, because one of them is a fact about a minifier's output.
   *
   * (a) dist/renderer/build-mode.json — written by scripts/build-renderer.mjs AFTER Vite exits, so
   *     it can only describe a build that happened. It states the answer in a form that cannot
   *     drift with a toolchain bump.
   * (b) the constant Vite folded into the chunk. `envMockMode()` in apps/web/src/state/mockMode.ts
   *     is `value !== 'false'` over `import.meta.env.VITE_LIVETAP_MOCK_MODE`; Vite substitutes the
   *     env value as a literal and leaves the comparison standing, so a real build carries
   *     `return"false"!=="false"`. With the flag ABSENT the substitution is `void 0` and the whole
   *     thing folds to `return!0` — "simulate everything" — which is why finding NO comparison is a
   *     FAILURE here and not a pass.
   *
   * They must agree. If a future bundler folds the comparison away in both directions, re-read
   * mockMode.ts and update the pattern; do not delete the check.
   */
  const modeEntry = asar.get('dist/renderer/build-mode.json');
  check(
    'dist/renderer/build-mode.json shipped (says which build this is)',
    Boolean(modeEntry),
    'written by scripts/build-renderer.mjs; its absence means the renderer was built some other way',
  );
  let declaredMock = null;
  if (modeEntry) {
    const mode = JSON.parse(modeEntry.read().toString('utf8'));
    declaredMock = mode.mockMode;
    check(
      `build-mode.json declares mockMode=${mode.mockMode} (built ${mode.builtAt})`,
      mode.mockMode === false && mode.viteEnv?.VITE_LIVETAP_MOCK_MODE === 'false',
      'this installer carries the DEMO renderer: every adapter and the engine are simulated',
    );

    /*
     * Is this installer the one you just built, or the one from last time?
     *
     * Nothing above can tell. Every check here reads the artifact, and a stale artifact is
     * internally consistent with itself: its asar, its build-mode.json and its folded constant all
     * agree, because they all came from the same older build. This passed 30/30 on an installer
     * that was ninety minutes old, while electron-builder had in fact failed and left the previous
     * one in place — and the SHA-256 matching the last build's exactly was the most convincing
     * possible way to be wrong about what was being shipped.
     *
     * So: the renderer on disk is where the next build's bytes come from, and if it is NEWER than
     * the installer, the installer does not contain it.
     */
    const rendererMode = join(DESKTOP, 'dist', 'renderer', 'build-mode.json');
    if (existsSync(rendererMode)) {
      const onDisk = JSON.parse(readFileSync(rendererMode, 'utf8'));
      const packagedAt = Date.parse(mode.builtAt ?? '');
      const builtAt = Date.parse(onDisk.builtAt ?? '');
      check(
        'the unpacked app contains the renderer currently on disk, not an older one',
        Number.isFinite(packagedAt) && Number.isFinite(builtAt) && packagedAt >= builtAt,
        `dist/renderer was built at ${onDisk.builtAt} and this app.asar carries ${mode.builtAt}. ` +
          'electron-builder most likely failed and left the previous output in release/. ' +
          'Check the packaging output rather than trusting release/.',
      );

      /*
       * And the same question about the INSTALLER, which is the thing that ships.
       *
       * electron-builder writes `win-unpacked/` first and the .exe last, so a run that dies in
       * between leaves a fresh unpacked directory beside a stale installer — and every check above
       * reads the unpacked one. That is not hypothetical: it is what this script did, passing
       * 30/30 while the .exe on disk was ninety minutes and several fixes old.
       */
      const installerAt = statSync(installerPath).mtimeMs;
      const rendererAt = statSync(rendererMode).mtimeMs;
      check(
        'the INSTALLER is newer than the renderer it is supposed to contain',
        installerAt >= rendererAt,
        `the .exe was written ${Math.round((rendererAt - installerAt) / 60000)} minutes BEFORE the ` +
          'renderer it claims to carry. The packaging run did not finish; the artifact in release/ ' +
          'is the previous one.',
      );

      /*
       * C: WHICH TREE THIS ARTIFACT CAME FROM.
       *
       * A and B are both anchored to `dist/renderer` on disk — they compare the artifact to the
       * renderer, never the renderer to its source. So they catch a repack that died between
       * `win-unpacked/` and the `.exe`, and they are blind to a renderer that is itself stale.
       * Both artifacts shipped today were internally consistent all the way down and described a
       * tree that had moved on. Three checks, three different failures: repack died, renderer
       * stale, renderer from another tree.
       */
      const identity = identify(mode, { unversioned });
      check(
        'the renderer inside this installer can be identified',
        identity.ok,
        identity.ok ? '' : identity.detail,
      );
      if (identity.ok) {
        if (expectCommit !== null && identity.commit !== null) {
          check(
            `the renderer was built from ${expectCommit}`,
            identity.commit.startsWith(expectCommit) || expectCommit.startsWith(identity.commit),
            `this artifact is from ${identity.commit}, and you asked for ${expectCommit}.`,
          );
        }
        provenance.push(describeIdentity(identity));
      }
    }
  }

  const chunks = [...asar.keys()].filter(
    (f) => f.startsWith('dist/renderer/assets/') && f.endsWith('.js'),
  );
  const bundle = Buffer.concat(chunks.map((f) => asar.get(f).read())).toString('utf8');
  const comparisons = [...bundle.matchAll(/return"([^"]*)"!=="false"/g)].map((m) => m[1]);
  const foldedReal = comparisons.length > 0 && comparisons.every((v) => v === 'false');
  check(
    'demo mode is compiled OUT of the shipped bundle (VITE_LIVETAP_MOCK_MODE=false reached vite)',
    foldedReal,
    comparisons.length === 0
      ? 'envMockMode() left no comparison in the bundle. Either the flag was absent (and it folded ' +
        'to "yes, simulate everything"), or mockMode.ts changed shape — read it and update this ' +
        'pattern rather than deleting the check.'
      : `envMockMode() compares against ${comparisons.map((v) => JSON.stringify(v)).join(', ')}`,
  );
  check(
    'both witnesses agree about which build this is',
    declaredMock === false && foldedReal,
    `build-mode.json says mockMode=${declaredMock}; the folded constant says ` +
      `${foldedReal ? 'real' : 'not real'}`,
  );
}

/* --- 5. the update feed ----------------------------------------------------------- */

const updateYml = join(UNPACKED, 'resources', 'app-update.yml');
if (existsSync(updateYml)) {
  const feed = readFileSync(updateYml, 'utf8');
  // Not a failure: auto-update is deliberately unwired and unsigned (DESKTOP_RELEASE.md §5). It is
  // reported so nobody later mistakes the placeholder for a configured release channel.
  const placeholder = /REPLACE_WITH/.test(feed);
  console.log(
    `[verify-installer] NOTE: app-update.yml ${placeholder ? 'still holds REPLACE_WITH placeholders — this build will never find an update (intentional)' : 'names a real release repository'}`,
  );
}

/* ------------------------------------------------------------------ report */

for (const { label, ok, detail } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `: ${detail}` : ''}`);
}

console.log(
  `\n[verify-installer] ${results.length - failed}/${results.length} checks passed\n` +
    `  artifact : ${installerPath}\n` +
    `  version  : ${version}\n` +
    `  bytes    : ${installerBytes.length.toLocaleString()}\n` +
    `  sha256   : ${installerSha}` +
    provenance.map((line) => `
  from     : ${line}`).join(''),
);
console.log(
  '[verify-installer] NOTE: this proves what was PACKAGED. It does not prove that running the ' +
    'NSIS installer lays it down correctly on a clean machine, and it does not prove a real ' +
    'platform accepted a stream. Those are docs/release/ALPHA_RELEASE.md steps for the owner.',
);
process.exit(failed === 0 ? 0 : 1);
