/**
 * Assert what the Android APK actually contains.
 *
 *   node apps/mobile/scripts/verify-apk.mjs [path/to/app-debug.apk]
 *
 * WHY THIS EXISTS
 * There is no emulator image on this build host and no nested virtualisation, so nothing about the
 * Android app can be proven by running it. What CAN be proven is what shipped: which classes are in
 * the dex, which permissions and service types the merged manifest declares, which plugins
 * Capacitor registered, and whether the WebView bundle is the real application. Every one of those
 * is a claim this repo makes in prose elsewhere, and prose rots. This turns each of them into an
 * exit code.
 *
 * It reads the APK as a zip with Node's own zlib (no aapt, no apkanalyzer, no Android SDK), so it
 * also runs in CI on a machine with no SDK installed. The one thing it cannot read is the binary
 * AndroidManifest.xml inside the APK (that is AXML, not text), so manifest claims are checked
 * against the MERGED manifest Gradle writes next to the APK, which is the exact input to it.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(here, '..');
const DEFAULT_APK = join(
  MOBILE,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'debug',
  'app-debug.apk',
);
/**
 * Where AGP leaves the merged manifest. Two spellings because AGP has moved this between
 * `merged_manifest` and `merged_manifests` across versions and the task name differs with it; the
 * first one that exists is used, and none existing is itself a failure rather than a skip.
 */
const MERGED_MANIFESTS = [
  ['merged_manifest', 'processDebugMainManifest'],
  ['merged_manifests', 'processDebugMainManifest'],
  ['merged_manifests', 'processDebugManifest'],
].map(([dir, task]) =>
  join(MOBILE, 'android', 'app', 'build', 'intermediates', dir, 'debug', task, 'AndroidManifest.xml'),
);

const apkPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_APK;

/* ------------------------------------------------------------------ zip reading */

/**
 * Read a zip's central directory and return every entry's name plus its decompressed bytes.
 *
 * Only stored (0) and deflate (8) are handled, which is everything an APK uses. The central
 * directory is walked backwards from the end-of-central-directory record rather than scanning local
 * headers forward, because an APK's signing block sits between the entries and the directory.
 */
function readZip(bytes) {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const entryCount = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < entryCount; i += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);

    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEocd(bytes) {
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 70000; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ assertions */

const results = [];
let failed = 0;

function check(label, ok, detail) {
  results.push({ label, ok, detail });
  if (!ok) failed += 1;
}

if (!existsSync(apkPath)) {
  console.error(`[verify-apk] no APK at ${apkPath}. Run bash apps/mobile/scripts/build-android.sh`);
  process.exit(1);
}

const apkBytes = readFileSync(apkPath);
const entries = readZip(apkBytes);

/* --- 1. the native classes that do the streaming ------------------------------- */

// Class names live in the dex string pool as plain UTF-8, so a byte search over the concatenated
// dex files answers "did this class ship" without a dex parser.
const dexNames = [...entries.keys()].filter((n) => /^classes\d*\.dex$/.test(n));
const dex = Buffer.concat(dexNames.map((n) => entries.get(n)));
check(`dex present (${dexNames.length} file(s), ${dex.length} bytes)`, dexNames.length > 0);

const REQUIRED_CLASSES = [
  // LIVETAP's own native halves.
  'Lapp/livetap/capacitor/livestream/LiveStreamPlugin;',
  'Lapp/livetap/capacitor/livestream/LiveForegroundService;',
  'Lapp/livetap/capacitor/livestream/SecureStorePlugin;',
  // The encoder, its camera source and its microphone source: without these there is no picture,
  // no sound and no RTMP socket, whatever the plugin says.
  'Lcom/pedro/library/generic/GenericStream;',
  'Lcom/pedro/encoder/input/sources/video/Camera2Source;',
  'Lcom/pedro/encoder/input/sources/audio/MicrophoneSource;',
  // The preview surface. Its absence is the difference between a real preview and a logged TODO.
  'Lcom/pedro/library/view/OpenGlView;',
];
for (const name of REQUIRED_CLASSES) {
  check(`dex contains ${name}`, dex.includes(Buffer.from(name, 'utf8')));
}

/* --- 2. the methods the JavaScript bridge calls --------------------------------- */

// @PluginMethod names are exported to JavaScript by name, so a missing one is a call that rejects
// at runtime with "not implemented" on a device nobody can debug.
const REQUIRED_METHODS = [
  'startPreview',
  'stopPreview',
  'switchCamera',
  'setMute',
  'startStream',
  'stopStream',
  'startRecording',
  'stopRecording',
  'capabilities',
];
for (const method of REQUIRED_METHODS) {
  check(`dex exports LiveStream.${method}`, dex.includes(Buffer.from(method, 'utf8')));
}

/* --- 3. Capacitor plugin registration ------------------------------------------- */

const pluginsJson = entries.get('assets/capacitor.plugins.json');
check('assets/capacitor.plugins.json present', Boolean(pluginsJson));
if (pluginsJson) {
  const plugins = JSON.parse(pluginsJson.toString('utf8'));
  const classpaths = plugins.map((p) => p.classpath);
  check(
    'LiveStreamPlugin registered with the bridge',
    classpaths.includes('app.livetap.capacitor.livestream.LiveStreamPlugin'),
    classpaths.join(', '),
  );
  check(
    'SecureStorePlugin registered with the bridge',
    classpaths.includes('app.livetap.capacitor.livestream.SecureStorePlugin'),
  );
}

/* --- 4. the Capacitor runtime config -------------------------------------------- */

const configJson = entries.get('assets/capacitor.config.json');
check('assets/capacitor.config.json present', Boolean(configJson));
if (configJson) {
  const config = JSON.parse(configJson.toString('utf8'));
  check('appId is app.livetap.mobile', config.appId === 'app.livetap.mobile', config.appId);
  check(
    'debug build has webContentsDebuggingEnabled',
    config.android?.webContentsDebuggingEnabled === true,
    'a sideloaded alpha with a white screen and no inspector cannot be diagnosed',
  );
  check(
    'no live-reload server.url is baked in',
    config.server?.url === undefined,
    'a server.url would point the shipped app at a laptop that is not there',
  );
}

/* --- 5. the WebView bundle is the real application ------------------------------ */

const index = entries.get('assets/public/index.html');
check('assets/public/index.html present', Boolean(index));
if (index) {
  const html = index.toString('utf8');
  check(
    'the app shell, not the marketing page, is the phone entry point',
    html.includes('id="root"'),
    'stage-web.mjs promotes app.html to index.html',
  );
  check(
    'no apple-touch-icon pointing at a marketing asset the bundle does not carry',
    !html.includes('/brand/'),
    '/brand/ is deliberately not copied into www/, so any link to it 404s on the phone',
  );
}

const bundleNames = [...entries.keys()].filter((n) =>
  n.startsWith('assets/public/assets/') && n.endsWith('.js'),
);
const bundle = Buffer.concat(bundleNames.map((n) => entries.get(n))).toString('utf8');
check(`web bundle present (${bundleNames.length} chunks)`, bundleNames.length > 0);
check(
  'the bundle reaches the native plugin at all',
  bundle.includes('LiveStream'),
  'MobileEngine is unreachable if registerPlugin("LiveStream") never ships',
);
check(
  'the bundle reaches the native secure store',
  bundle.includes('LivetapSecureStore'),
  'without this, stream keys and tokens live in a Map that dies with the process',
);

/*
 * Demo mode must be compiled OUT of the phone bundle.
 *
 * `envMockMode()` in apps/web/src/state/mockMode.ts is
 * `import.meta.env.VITE_LIVETAP_MOCK_MODE !== 'false'`. Vite substitutes the env value as a
 * literal at build time and leaves the comparison standing, so the shipped bundle carries
 * `return"false"!=="false"` when the flag was set and `return"<whatever>"!=="false"` when it was
 * not. Everything downstream hangs off that one boolean: mock adapters, a mock engine, and a UI
 * that can say LIVE while nothing at all leaves the phone.
 *
 * With the flag missing entirely the substitution is `void 0` and the comparison folds away to
 * `return!0`, which is why "no comparison found" is a FAILURE here and not a pass. If a future
 * bundler folds it in both directions, re-read the chunk and update the pattern; do not delete the
 * check.
 */
const mockComparisons = [...bundle.matchAll(/return"([^"]*)"!=="false"/g)].map((m) => m[1]);
check(
  'demo mode is compiled out (VITE_LIVETAP_MOCK_MODE=false reached the web build)',
  mockComparisons.length > 0 && mockComparisons.every((value) => value === 'false'),
  mockComparisons.length === 0
    ? 'envMockMode() left no comparison in the bundle, which means the flag was absent and it ' +
      'folded to "yes, simulate everything"'
    : `envMockMode() compares against ${mockComparisons.map((v) => JSON.stringify(v)).join(', ')}`,
);

/*
 * The rest of the production configuration, read off the FINISHED artifact.
 *
 * Same two values verify-staged-web.mjs checks before packaging, asserted again here because this
 * is the file that actually goes on a phone and the staging step can be skipped -- `npm run
 * sync:android` stages whatever happens to be in apps/web/dist. Both are compiled in at build
 * time, so an APK missing them cannot be fixed by configuring anything afterwards.
 *
 * Reported always, fatal only under LIVETAP_REQUIRE_PRODUCTION_CONFIG=1, because a sideloaded demo
 * APK is a legitimate thing to build and this script must not refuse to verify one.
 */
const REQUIRE_PRODUCTION = process.env.LIVETAP_REQUIRE_PRODUCTION_CONFIG === '1';
for (const [name, value, consequence] of [
  [
    'a relay is compiled in, so this phone can reach more than one destination',
    (process.env.VITE_LIVETAP_RELAY_URL ?? '').trim(),
    'without it the device is capped at ONE destination: one encoder, one RTMP socket',
  ],
  [
    'a token broker origin is compiled in, so connecting an account can work',
    (process.env.VITE_LIVETAP_BROKER_URL ?? '').trim(),
    'without it /api/oauth/token resolves to the in-APK asset server and OAuth cannot complete',
  ],
]) {
  const present = value !== '' && bundle.includes(value);
  if (REQUIRE_PRODUCTION) check(name, present, present ? value : consequence);
  else if (present) check(name, true, value);
  else check(`${name} — NOT SET`, true, `${consequence} (not fatal: this is not a production build)`);
}

/* --- 6. the merged manifest ------------------------------------------------------ */

const mergedManifestPath = MERGED_MANIFESTS.find((p) => existsSync(p));
if (mergedManifestPath) {
  // Comments survive the merge, and this repo's manifests explain themselves at length. Strip them
  // or a check for the absence of something finds the note saying why it is absent.
  const manifest = readFileSync(mergedManifestPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

  /*
   * Package id, version and SDK range, straight off the artifact rather than out of build.gradle.
   * build.gradle is the SOURCE of these values; this is the CHECK that what Gradle actually wrote
   * into the merged manifest still matches what this repo tells the owner and Play to expect
   * (apps/mobile/android/app/build.gradle defaultConfig, apps/mobile/android/variables.gradle).
   * minSdk 26 is a floor RootEncoder's Camera2/MediaCodec path and notification channels need;
   * targetSdk 36 is Play's requirement for new apps and updates from 2026-08-31.
   */
  const packageMatch = manifest.match(/<manifest[^>]*\spackage="([^"]+)"/);
  check('manifest package id is app.livetap.mobile', packageMatch?.[1] === 'app.livetap.mobile', packageMatch?.[1]);

  const versionCodeMatch = manifest.match(/android:versionCode="(\d+)"/);
  check('manifest declares a numeric versionCode', Boolean(versionCodeMatch), 'no android:versionCode attribute found');

  const versionNameMatch = manifest.match(/android:versionName="([^"]+)"/);
  check(
    'manifest declares a non-empty versionName',
    Boolean(versionNameMatch?.[1]),
    'no android:versionName attribute found',
  );

  const usesSdkMatch = manifest.match(/<uses-sdk[^/]*android:minSdkVersion="(\d+)"[^/]*android:targetSdkVersion="(\d+)"/);
  check(
    'minSdkVersion is 26 (RootEncoder Camera2/MediaCodec floor)',
    usesSdkMatch?.[1] === '26',
    usesSdkMatch?.[1] ?? 'no <uses-sdk android:minSdkVersion=...> found',
  );
  check(
    'targetSdkVersion is 36 (Play requirement for new apps/updates from 2026-08-31)',
    usesSdkMatch?.[2] === '36',
    usesSdkMatch?.[2] ?? 'no <uses-sdk android:targetSdkVersion=...> found',
  );

  const REQUIRED_PERMISSIONS = [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.INTERNET',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_CAMERA',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  ];
  for (const permission of REQUIRED_PERMISSIONS) {
    check(`manifest declares ${permission}`, manifest.includes(`"${permission}"`));
  }
  check(
    'the foreground service survived the manifest merge with its types',
    manifest.includes('app.livetap.capacitor.livestream.LiveForegroundService') &&
      /foregroundServiceType="[^"]*camera[^"]*microphone/.test(manifest),
    'Android 14+ throws at startForeground() when the type does not match the permissions held',
  );
  check(
    'the livetap:// OAuth callback is registered',
    manifest.includes('android:scheme="livetap"'),
    undefined,
  );
  check(
    'no autoVerify App Link on a host nobody owns',
    !manifest.includes('livetap.example'),
    'a failed assetlinks check costs an install-time round trip and shows the creator a broken domain',
  );
  check('backups are off so ciphertext cannot outlive its Keystore key', manifest.includes('android:allowBackup="false"'));
} else {
  check(
    'merged manifest available for inspection',
    false,
    `looked in ${MERGED_MANIFESTS.join(', ')}; run a Gradle build first`,
  );
}

/* ------------------------------------------------------------------ report */

for (const { label, ok, detail } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `: ${detail}` : ''}`);
}
const sha = createHash('sha256').update(apkBytes).digest('hex');
console.log(
  `\n[verify-apk] ${results.length - failed}/${results.length} checks passed on ` +
    `${apkPath} (${apkBytes.length} bytes, sha256 ${sha.slice(0, 16)}…)`,
);
console.log(
  '[verify-apk] NOTE: this proves what SHIPPED, not that it WORKS. Camera output, permission ' +
    'dialogs, the live notification and real RTMP from a handset are owner hardware. See ' +
    'docs/release/ANDROID_MANUAL_TEST.md.',
);
process.exit(failed === 0 ? 0 : 1);
