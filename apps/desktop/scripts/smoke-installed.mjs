/**
 * Smoke the PACKAGED app, not the development one.
 *
 *   node apps/desktop/scripts/smoke-installed.mjs [path/to/LIVETAP.exe]
 *
 * `e2e/smoke.mjs` launches Electron against the `dist/` folders on disk. That proves the renderer
 * and the main process agree, and it is the right test while developing — but it is not the
 * artifact the owner receives. This one launches `release/win-unpacked/LIVETAP.exe`, which is the
 * exact binary the NSIS installer lays down, reading its renderer out of `app.asar` and its FFmpeg
 * out of `resources/ffmpeg/`. Everything that can only break during packaging — an asar path that
 * resolves in dev and not in a bundle, a missing extraResource, a preload that is no longer next to
 * where main looks for it — breaks here and nowhere earlier.
 *
 * It asserts three things and prints what it saw for each:
 *   1. a window opens and the LIVETAP shell renders (not a blank page, not a 404),
 *   2. the renderer is running in REAL mode (mock mode compiled out),
 *   3. main resolved a BUNDLED ffmpeg — `source: 'bundled'`, not 'path' and not 'unavailable'.
 *
 * (3) is the one that separates "an app opened" from "an app that can broadcast", and it can only
 * be asked of a packaged build: in dev, `resolveFfmpegPath()` legitimately falls back to PATH.
 */
import { _electron as electron } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(here, '..');
const DEFAULT_EXE = join(DESKTOP, 'release', 'win-unpacked', 'LIVETAP.exe');
const exePath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_EXE;

if (!existsSync(exePath)) {
  console.error(
    `[smoke-installed] no packaged app at ${exePath}. Run: npm run package:win -w @livetap/desktop`,
  );
  process.exit(1);
}

const outDir = join(DESKTOP, 'e2e', '__screenshots__');
mkdirSync(outDir, { recursive: true });

/*
 * A throwaway profile, for two reasons.
 *
 * Electron keys `requestSingleInstanceLock()` on the userData directory, and main takes that lock
 * (two LIVETAPs would race over vault.bin and the FFmpeg children). So any other LIVETAP already
 * running on this host - a dev instance, the broadcast harness - makes a packaged launch quit(0)
 * before `whenReady`, and the smoke test fails for a reason that has nothing to do with the
 * artifact. It also means this test would otherwise read and write the real profile: its vault,
 * its recordings, its recovery file.
 */
const userDataDir = mkdtempSync(join(tmpdir(), 'livetap-smoke-'));

const app = await electron.launch({
  executablePath: exePath,
  args: [`--user-data-dir=${userDataDir}`],
  cwd: dirname(exePath),
  env: { ...process.env, LIVETAP_SMOKE: '1' },
});

const window = await app.firstWindow();
await window.waitForLoadState('domcontentloaded');
await window.waitForTimeout(4000);

const title = await window.title();
const url = window.url();
const text = (await window.locator('body').innerText()).slice(0, 4000);
const notFound = /page not found|that page moved|not part of LIVETAP/i.test(text);
const placeholder = /renderer is not built/i.test(text);
const hasShell = /(What are you making|GO LIVE|Step 1 of 3)/i.test(text);

/*
 * Ask MAIN, not the renderer — and then ask MAIN'S OWN LOG.
 *
 * `app.evaluate` runs in the main process, but its only argument is the electron module: there is
 * no `require` and no dynamic import in that scope, so it can report `isPackaged` and
 * `process.resourcesPath` and nothing more. That is worth having (it proves this really is a
 * packaged app and where it thinks its resources are) but it is not the question.
 *
 * The question is what `resolveFfmpegPath()` DECIDED, and main already writes that decision to
 * `<userData>/logs/main.log` as `ffmpeg resolved { path, source }`. Reading it back is reading the
 * code under test rather than re-implementing its logic here and grading my own homework: if
 * ffmpegPath.ts ever changes its mind, this reads the new answer.
 */
const runtime = await app.evaluate(async ({ app: electronApp }) => ({
  isPackaged: electronApp.isPackaged,
  resourcesPath: process.resourcesPath,
  version: electronApp.getVersion(),
  electron: process.versions.electron,
}));

const mock = await window.evaluate(() => {
  const el = document.body.innerText;
  return { demoBanner: /demo mode|simulated|mock/i.test(el) };
});

await window.screenshot({ path: join(outDir, 'installed-first-window.png') });

const mainLog = join(userDataDir, 'logs', 'main.log');
const logText = existsSync(mainLog) ? readFileSync(mainLog, 'utf8') : '';
const resolvedLine = [...logText.matchAll(/ffmpeg resolved \{[\s\S]*?\}/g)].pop()?.[0] ?? null;
const ffmpeg = {
  logLine: resolvedLine,
  source: resolvedLine ? /source:\s*'([a-z]+)'/.exec(resolvedLine)?.[1] ?? null : null,
};

console.log(
  JSON.stringify(
    {
      exePath,
      userDataDir,
      title,
      url,
      notFound,
      placeholder,
      hasShell,
      runtime,
      ffmpeg,
      mock,
      sample: text.replace(/\s+/g, ' ').slice(0, 200),
    },
    null,
    2,
  ),
);
await app.close();

const failures = [];
if (notFound) failures.push('the renderer rendered a 404');
if (placeholder) failures.push('the packaging placeholder shipped instead of the app');
if (!hasShell) failures.push('the LIVETAP shell did not render');
if (!runtime.isPackaged) {
  failures.push('electron reports isPackaged=false: this is not a packaged app');
}
if (ffmpeg.source !== 'bundled') {
  failures.push(
    `main resolved ffmpeg source=${ffmpeg.source ?? '(nothing logged)'}; a packaged build must ` +
      "be 'bundled'. 'path' would mean it fell through to the user's machine, 'unavailable' that " +
      'the extraResources step shipped nothing.',
  );
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log('PASS: packaged app opens, renders the shell, and sees its bundled ffmpeg.');
