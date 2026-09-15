#!/usr/bin/env node
/**
 * What the studio costs while it is actually broadcasting.
 *
 * `perf-probe.mjs` measures a URL in a browser. That is the right tool for the marketing page and
 * the wrong one for this question: the numbers everyone quotes about LIVETAP's performance - 22.5
 * fps, eighteen canvases, a 3402 ms main-thread task - are about the studio with a camera open and
 * RTMP publishers connected, and neither the camera nor the publishers exist on the web surface.
 * A browser cannot open an RTMP socket, and a mock build has no compositor canvases at all, so a
 * measurement taken there is a measurement of a different program.
 *
 * So this drives the thing the gate drives: the BUILT desktop app, under Playwright, with
 * Chromium's fake capture device, publishing to a local MediaMTX. Real getUserMedia, real
 * FormatRenderer canvases, real MediaRecorder, real ffmpeg, real RTMP. The measurement window
 * opens only once bytes are confirmed on the wire, so "with a broadcast live" is a fact the script
 * checked rather than a state it assumed.
 *
 * What it reports, and why each number is here:
 *
 *   frame rate        rAF ticks the page can still deliver. This is the number a creator feels:
 *                     below ~50 the UI stops tracking the pointer.
 *   canvases          EVERY canvas that exists, not only the ones in the DOM. The compositor's
 *                     canvases are created with document.createElement and never appended, so
 *                     `document.querySelectorAll('canvas')` reports zero of the expensive ones.
 *                     A count that misses them is worse than no count.
 *   canvas pixels     Their total area. Three 1080-class formats is 5.3 megapixels PER COMPOSITED
 *                     FRAME, which is the budget the whole rest of the page competes with.
 *   draws/s           drawImage + putImageData per second, attributed per canvas. This answers
 *                     "how many times does one camera frame get copied", which is the actual cost.
 *   longest task      The worst single main-thread block in the window. One long task is one
 *                     synchronous loop; the profile slice below names it.
 *   React commits     How often the tree re-rendered. A preview that repaints because React
 *                     committed is a preview coupled to state it has nothing to do with.
 *
 * Usage:
 *   node apps/web/scripts/perf-studio.mjs
 *   node apps/web/scripts/perf-studio.mjs --seconds=10 --label=after --json=after.json
 *   node apps/web/scripts/perf-studio.mjs --profile         (CPU profile + long-task attribution)
 *   node apps/web/scripts/perf-studio.mjs --no-live         (preview only, no publishers)
 *   node apps/web/scripts/perf-studio.mjs --soak            (interact during the window)
 *
 * Requires a built desktop app (`npm run build -w @livetap/desktop`) and MediaMTX under
 * tools/mediamtx/ - both are checked, by name, before anything is claimed.
 *
 * Exit 0 when every threshold held, 1 when one did not, 2 when the run could not be performed.
 * A threshold that fails prints the measured value beside the budget, so the exit code is never
 * the only thing you have to go on.
 */
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadConfig,
  resolveMediaMtx,
  startMediaMtx,
  waitForPort,
} from '../../../infra/dev-harness/ingest/lib/harness.mjs';
import {
  addCustomDestination,
  dismissTour,
  goLive,
  pressEnd,
} from '../../../infra/dev-harness/broadcast/studio-controls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const desktopDir = path.join(repoRoot, 'apps', 'desktop');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const seconds = Number(arg('seconds', 8));
const label = arg('label', flag('no-live') ? 'studio, preview only' : 'studio, live broadcast');
const jsonOut = arg('json', '');
const wantProfile = flag('profile');
const wantLive = !flag('no-live');
const wantSoak = flag('soak');
const throttle = Number(arg('throttle', 1));

/**
 * The budgets, and what each one is actually for.
 *
 * A threshold has to be crossable by a regression and not by a noisy afternoon, and those two
 * requirements pull in opposite directions on a shared build host. So the budgets here are split
 * by how stable the thing being measured is:
 *
 *   SHARP, because these do not move at all between runs and a change in them is always a real
 *   change in the product: how many canvases exist, how many pixels they cover, and whether every
 *   picture on screen is the picture being encoded. A fourth compositor canvas, or a UI surface
 *   that starts drawing its own, trips these immediately.
 *
 *   LOOSE, because these swing 40% on a contended machine: frame rate and longest task. Measured
 *   on this GPU-less host with three 1080-class formats live, the studio held between 36% and 71%
 *   of the machine's own animation-frame ceiling across eleven runs. A budget inside that band
 *   would fail at random, so it sits below it and catches architectural regressions - a per-frame
 *   readback, a synchronous layout, a fourth format - rather than weather.
 *
 * Frame rate is expressed as a share of the CEILING the same run measured, never as absolute fps:
 * the same code is 31 fps on this VM and 120 on a creator's laptop, and an absolute threshold
 * tests the hardware rather than the product. `--ceiling=`, `--fps=`, `--pixels=`, `--canvases=`,
 * `--longtask=` and `--commits=` override them, for bisecting.
 */
const BUDGET = {
  ceilingFraction: Number(arg('ceiling', 0.3)),
  fps: Number(arg('fps', 0)),
  canvases: Number(arg('canvases', 3)),
  pixels: Number(arg('pixels', 6_000_000)),
  longTaskMs: Number(arg('longtask', 1500)),
  commits: Number(arg('commits', 90)),
};

/** Three destinations, three shapes: the worst case the product actually supports. */
const TARGETS = [
  { key: 'perfwide', label: 'Perf wide', aspect: '16:9' },
  { key: 'perftall', label: 'Perf vertical', aspect: '9:16' },
  { key: 'perfsquare', label: 'Perf square', aspect: '1:1' },
];

const cfg = loadConfig();
const rtmpBase = `rtmp://${cfg.host}:${cfg.rtmpPort}`;

/**
 * Refuse to measure, with the reason.
 *
 * It throws rather than exiting. `process.exit` from inside the run skipped the `finally` that
 * closes Electron, and the orphans that left behind were still compositing three 1080-class
 * canvases while the NEXT run took its numbers - which is how a measurement tool ends up poisoning
 * the machine it is measuring. The only `process.exit` in this file is the one at the end of main.
 */
class CannotMeasure extends Error {}

function die(message) {
  throw new CannotMeasure(message);
}

/**
 * The instrumentation, installed before a single line of application code runs.
 *
 * It must be an init script rather than an evaluate: React registers with the DevTools hook during
 * module evaluation, and a canvas created before the wrapper is installed is a canvas that never
 * appears in the inventory. Everything here is counting only - nothing throttles, defers or
 * suppresses work, because a probe that changes the thing it measures is not a probe.
 */
function instrumentation() {
  const w = /** @type {any} */ (window);
  w.__lt = {
    canvases: new Set(),
    drawsByCanvas: new WeakMap(),
    draws: 0,
    drawMs: 0,
    /** A bounded ring of per-copy costs, so the report can quote a median rather than a mean. */
    drawSamples: [],
    commits: 0,
    captureStreamCalls: 0,
    longTasks: [],
    /** Synchronous calls that are known to be able to block for a long time, and what they cost. */
    sync: {},
  };

  const note = (name, ms) => {
    const bucket = w.__lt.sync[name] ?? (w.__lt.sync[name] = { calls: 0, totalMs: 0, worstMs: 0 });
    bucket.calls += 1;
    bucket.totalMs += ms;
    if (ms > bucket.worstMs) bucket.worstMs = ms;
  };

  // --- every canvas, including the ones that never reach the DOM -------------------------------
  const createElement = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...rest) {
    const el = createElement.call(this, tag, ...rest);
    if (typeof tag === 'string' && tag.toLowerCase() === 'canvas') w.__lt.canvases.add(el);
    return el;
  };

  /*
   * How many times a frame gets copied, onto what, and WHAT EACH COPY COSTS.
   *
   * The cost per copy is the metric to trust on a contended machine. Frames per second is what a
   * creator feels, but it also moves when an unrelated process wakes up; the wall time of a single
   * `drawImage` onto a 1080-class canvas is a property of the compositor and the rasteriser, and
   * it barely moves. When the two disagree, the per-copy number is the one measuring this code.
   */
  const ctx2d = CanvasRenderingContext2D.prototype;
  for (const name of ['drawImage', 'putImageData']) {
    const original = ctx2d[name];
    ctx2d[name] = function (...a) {
      const started = performance.now();
      try {
        return original.apply(this, a);
      } finally {
        const cost = performance.now() - started;
        w.__lt.draws += 1;
        w.__lt.drawMs += cost;
        w.__lt.drawSamples.push(cost);
        if (w.__lt.drawSamples.length > 4000) w.__lt.drawSamples.shift();
        const canvas = this.canvas;
        if (canvas) w.__lt.drawsByCanvas.set(canvas, (w.__lt.drawsByCanvas.get(canvas) ?? 0) + 1);
      }
    };
  }

  // --- the synchronous calls that can block for seconds ----------------------------------------
  const timed = (object, name, reportAs) => {
    const original = object?.[name];
    if (typeof original !== 'function') return;
    object[name] = function (...a) {
      const started = performance.now();
      try {
        return original.apply(this, a);
      } finally {
        note(reportAs, performance.now() - started);
      }
    };
  };
  timed(HTMLCanvasElement.prototype, 'captureStream', 'canvas.captureStream');
  timed(HTMLCanvasElement.prototype, 'toDataURL', 'canvas.toDataURL');
  timed(CanvasRenderingContext2D.prototype, 'getImageData', 'ctx.getImageData');
  timed(Storage.prototype, 'setItem', 'localStorage.setItem');
  timed(Storage.prototype, 'getItem', 'localStorage.getItem');
  timed(JSON, 'stringify', 'JSON.stringify');
  timed(JSON, 'parse', 'JSON.parse');

  const capture = HTMLCanvasElement.prototype.captureStream;
  HTMLCanvasElement.prototype.captureStream = function (...a) {
    w.__lt.captureStreamCalls += 1;
    return capture.apply(this, a);
  };

  // --- React commits, via the hook React looks for at module scope -------------------------------
  if (!w.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let nextId = 1;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      isDisabled: false,
      checkDCE() {},
      inject(renderer) {
        const id = nextId++;
        this.renderers.set(id, renderer);
        return id;
      },
      onCommitFiberRoot() {
        w.__lt.commits += 1;
      },
      onPostCommitFiberRoot() {},
      onCommitFiberUnmount() {},
    };
  }

  // --- the blocks themselves ---------------------------------------------------------------------
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__lt.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* no longtask support: the table says 0 and says why */
  }
}

/** Read the inventory and run the frame-rate window, inside the page. */
async function sample(win, windowSeconds) {
  return win.evaluate(async (secs) => {
    const w = /** @type {any} */ (window);
    const median = (xs) => {
      if (xs.length === 0) return 0;
      const sorted = xs.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const lt = w.__lt;
    const all = new Set([...lt.canvases, ...document.querySelectorAll('canvas')]);
    const inventory = [...all].map((c) => ({
      w: c.width,
      h: c.height,
      px: c.width * c.height,
      inDom: c.isConnected === true,
      draws: lt.drawsByCanvas.get(c) ?? 0,
      cls: (c.className?.toString?.() ?? '').slice(0, 32),
    }));

    const drawsBefore = lt.draws;
    const drawMsBefore = lt.drawMs;
    lt.drawSamples.length = 0;
    const commitsBefore = lt.commits;
    const perCanvasBefore = inventory.map((entry, i) => lt.drawsByCanvas.get([...all][i]) ?? 0);
    lt.longTasks.length = 0;

    let frames = 0;
    const start = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        frames += 1;
        if (performance.now() - start >= secs * 1000) resolve(undefined);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const elapsed = (performance.now() - start) / 1000;

    const list = [...all];
    const perCanvas = inventory.map((entry, i) => ({
      ...entry,
      drawsPerSecond: ((lt.drawsByCanvas.get(list[i]) ?? 0) - perCanvasBefore[i]) / elapsed,
    }));

    /*
     * The honesty invariant, checked rather than assumed.
     *
     * No UI surface may show a picture that is not the picture being encoded for that format. The
     * preview and the output tile for the master aspect are both supposed to be pointed at the
     * SAME MediaStream object - the one `FormatRenderer.streamFor(master)` returns and the encoder
     * publishes. If a refactor ever swapped one of them for a copy, a second capture or a canvas
     * of its own, these two would stop being the same object, and the creator would be watching a
     * picture nobody receives. It is one `===` and it is worth more than any number above it.
     */
    const previewEl = document.querySelector('.lt-preview__video');
    const outputEls = [...document.querySelectorAll('.lt-output__video')];
    const liveVideo = (el) =>
      !!el && el.srcObject instanceof MediaStream && el.srcObject.getVideoTracks().some((t) => t.readyState === 'live');
    const honesty = {
      previewHasLiveStream: liveVideo(previewEl),
      previewIsPainting: !!previewEl && previewEl.videoWidth > 0 && !previewEl.paused,
      outputs: outputEls.length,
      outputsWithLiveStream: outputEls.filter(liveVideo).length,
      outputsPainting: outputEls.filter((el) => el.videoWidth > 0 && !el.paused).length,
      // The preview's stream must BE one of the output streams, not merely look like one.
      previewSharesAnOutputStream: outputEls.some((el) => el.srcObject && el.srcObject === previewEl?.srcObject),
      // Every tile must show a DISTINCT format; two tiles on one stream would be a fake shape.
      distinctOutputStreams: new Set(outputEls.map((el) => el.srcObject).filter(Boolean)).size,
    };

    const worst = lt.longTasks.slice().sort((a, b) => b.duration - a.duration)[0] ?? null;
    return {
      honesty,
      windowStartedAt: start,
      elapsed,
      fps: frames / elapsed,
      canvases: perCanvas.length,
      canvasesInDom: perCanvas.filter((c) => c.inDom).length,
      pixels: perCanvas.reduce((n, c) => n + c.px, 0),
      drawsPerSecond: (lt.draws - drawsBefore) / elapsed,
      drawCount: lt.draws - drawsBefore,
      msPerDraw: lt.draws > drawsBefore ? (lt.drawMs - drawMsBefore) / (lt.draws - drawsBefore) : 0,
      medianMsPerDraw: median(lt.drawSamples),
      drawBusyFraction: (lt.drawMs - drawMsBefore) / (elapsed * 1000),
      commits: lt.commits - commitsBefore,
      captureStreamCalls: lt.captureStreamCalls,
      longestTaskMs: worst?.duration ?? 0,
      longestTaskAt: worst?.startTime ?? 0,
      longTaskCount: lt.longTasks.length,
      longTaskTotalMs: lt.longTasks.reduce((n, t) => n + t.duration, 0),
      sync: lt.sync,
      inventory: perCanvas.sort((a, b) => b.px - a.px),
    };
  }, windowSeconds);
}

/** Self time from a CPU profile, optionally restricted to one interval of page time. */
function selfTime(profile, anchor, fromPageMs, toPageMs) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const totals = new Map();
  let at = profile.startTime;
  for (const [index, id] of (profile.samples ?? []).entries()) {
    const delta = profile.timeDeltas?.[index] ?? 0;
    at += delta;
    if (anchor !== null && fromPageMs !== undefined) {
      const pageMs = anchor.pageMs + (at - anchor.profileUs) / 1000;
      if (pageMs < fromPageMs || pageMs > toPageMs) continue;
    }
    const node = byId.get(id);
    if (!node) continue;
    const f = node.callFrame;
    const where = `${f.functionName || '(anonymous)'}  ${String(f.url).split('/').pop()}:${f.lineNumber + 1}`;
    totals.set(where, (totals.get(where) ?? 0) + delta);
  }
  return totals;
}

function printSelfTime(title, totals) {
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  if (total === 0) {
    console.log(`  ${title}: no samples landed in this interval`);
    return;
  }
  console.log(`  ${title}`);
  for (const [where, us] of [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`      ${((us / total) * 100).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${where}`);
  }
}

async function api(route) {
  const res = await fetch(`http://${cfg.host}:${cfg.apiPort}${route}`);
  if (!res.ok) throw new Error(`control API ${route} -> HTTP ${res.status}`);
  return res.json();
}

async function bytesOnAnyPath() {
  const list = await api('/v3/rtmpconns/list');
  return (list.items ?? [])
    .filter((c) => c.state === 'publish')
    .reduce((total, c) => total + (c.bytesReceived ?? 0), 0);
}

async function receiverIsUp() {
  try {
    await api('/v3/paths/list');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(path.join(desktopDir, 'dist', 'main', 'index.cjs'))) {
    die('no built desktop main process. Run: npm run build -w @livetap/desktop');
  }
  if (!fs.existsSync(path.join(desktopDir, 'dist', 'renderer', 'app.html'))) {
    die('no built desktop renderer. Run: npm run build -w @livetap/desktop');
  }

  let server = null;
  if (wantLive) {
    try {
      resolveMediaMtx(cfg);
    } catch (error) {
      die(`${error.message}`);
    }
    if (!(await receiverIsUp())) {
      server = startMediaMtx(cfg);
      await server.ready();
      await waitForPort(cfg.host, cfg.rtmpPort, { timeoutMs: 15_000 });
    }
  }

  const app = await electron.launch({
    args: [
      desktopDir,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    cwd: desktopDir,
  });

  let result = null;
  let exitCode = 0;
  try {
    const win = await app.firstWindow();
    win.setDefaultTimeout(15_000);
    await win.waitForLoadState('domcontentloaded');
    await win.addInitScript(instrumentation);
    await win.evaluate(() => {
      localStorage.setItem('livetap.onboarding', 'true');
      localStorage.setItem('livetap.intent', '"talking"');
      localStorage.setItem('livetap.mode', '"simple"');
      localStorage.removeItem('livetap.destinations');
      localStorage.removeItem('livetap.realBroadcastAck');
    });
    // The reload is what puts the instrumentation ahead of React and of the first canvas.
    await win.reload();
    await win.waitForTimeout(2500);

    /*
     * What this machine can do at all, right now, measured in this same process.
     *
     * Settings has no camera and no compositor, so its frame rate is the display's, minus whatever
     * else the host is busy with. It matters because "60 fps" is not a universal target: this build
     * host is a GPU-less VM whose rAF ceiling is around 31, so a studio at 30 fps here is at the
     * ceiling and a studio at 30 fps on a creator's 120 Hz laptop is a quarter of it. Reporting the
     * studio's frame rate as a FRACTION of the ceiling is the only version of the number that means
     * the same thing on two machines - and the only one that does not quietly become a lie when the
     * build host is under load from something else.
     */
    await win.evaluate(() => {
      location.hash = '#/app/settings';
    });
    await win.waitForTimeout(1500);
    const ceilingFps = await win.evaluate(async () => {
      let frames = 0;
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          frames += 1;
          if (performance.now() - start >= 3000) resolve(undefined);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return frames / ((performance.now() - start) / 1000);
    });

    /*
     * Through the shared controls, deliberately.
     *
     * This used to spell the Destinations form out inline and it broke the moment the submit
     * button's label changed, reporting a performance failure that was really a copy edit.
     * `studio-controls.mjs` is the one place in this repo that knows how to press LIVETAP's
     * controls, and a probe is not a good enough reason for a second one.
     */
    if (wantLive) {
      for (const target of TARGETS) {
        await addCustomDestination(win, {
          label: target.label,
          url: `${rtmpBase}/live`,
          streamKey: target.key,
          aspect: target.aspect,
        });
      }
    }

    await win.evaluate(() => {
      location.hash = '#/app';
    });
    await win.waitForTimeout(1500);
    // The tour offer is a real part of the product, and also a card that can sit over GO LIVE.
    await dismissTour(win).catch(() => undefined);

    if (wantLive) {
      await goLive(win);
      // The countdown runs inside the button; nothing reaches a server until it ends.
      await win.waitForTimeout(6000);
      const deadline = Date.now() + 30_000;
      let bytes = 0;
      while (Date.now() < deadline) {
        bytes = await bytesOnAnyPath();
        if (bytes > 0) break;
        await win.waitForTimeout(1000);
      }
      if (bytes === 0) {
        const screen = await win.evaluate(() => document.body.innerText.slice(0, 900));
        die(`GO LIVE produced no publisher, so there is no live broadcast to measure.\n\n${screen}`);
      }
      // Let the encoders settle so the window measures a steady broadcast, not its first second.
      await win.waitForTimeout(2500);
    } else {
      await win.waitForTimeout(3000);
    }

    let cdp = null;
    if (throttle > 1 || wantProfile) {
      try {
        cdp = await app.context().newCDPSession(win);
      } catch {
        cdp = null;
      }
    }
    if (cdp && throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

    let anchor = null;
    if (cdp && wantProfile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      await cdp.send('Profiler.start');
      // One anchor point tying the profiler's clock to the page's, so a long task recorded in page
      // time can be sliced out of a profile recorded in microseconds of another epoch.
      const pageMs = await win.evaluate(() => performance.now());
      anchor = { pageMs, profileUs: null };
    }

    /*
     * The soak: press on the product while the window is open. A page is fast until something
     * asks it to change, and every number above is worth less if it was taken on a studio nobody
     * touched. Runs in parallel with the measurement window on purpose.
     */
    const soak = wantSoak
      ? (async () => {
          for (let i = 0; i < 6; i += 1) {
            await win
              .evaluate((route) => {
                location.hash = route;
              }, i % 2 === 0 ? '#/app/destinations' : '#/app')
              .catch(() => undefined);
            await win.waitForTimeout(Math.round((seconds * 1000) / 8));
          }
        })()
      : Promise.resolve();

    result = await sample(win, seconds);
    result.ceilingFps = ceilingFps;
    result.fractionOfCeiling = ceilingFps > 0 ? result.fps / ceilingFps : 0;
    await soak;

    let profile = null;
    if (cdp && wantProfile) {
      const stopped = await cdp.send('Profiler.stop');
      profile = stopped.profile;
      if (anchor) anchor.profileUs = profile.startTime;
    }

    report(result, label);

    if (profile) {
      console.log('');
      printSelfTime('where the whole window went (self time, sampled):', selfTime(profile, null));
      if (result.longestTaskMs > 0 && anchor?.profileUs != null) {
        console.log('');
        printSelfTime(
          `inside the longest task (${result.longestTaskMs.toFixed(0)} ms at t+${result.longestTaskAt.toFixed(0)} ms):`,
          selfTime(profile, anchor, result.longestTaskAt - 5, result.longestTaskAt + result.longestTaskMs + 5),
        );
      }
      console.log('');
    }

    exitCode = verdict(result);

    if (wantLive) {
      await pressEnd(win, { timeout: 20_000 }).catch(() => undefined);
      await win.waitForTimeout(3000);
    }
  } finally {
    await app.close().catch(() => undefined);
    if (server) await server.stop().catch(() => undefined);
  }

  if (jsonOut && result) {
    fs.writeFileSync(path.resolve(repoRoot, jsonOut), `${JSON.stringify({ label, budget: BUDGET, ...result }, null, 2)}\n`);
    console.log(`  written  ${jsonOut}\n`);
  }

  process.exit(exitCode);
}

function report(r, title) {
  const n = (x) => Math.round(x).toLocaleString();
  console.log('');
  console.log(`  ${title}   (${r.elapsed.toFixed(1)} s window, ${wantLive ? 'broadcast live' : 'preview only'}${wantSoak ? ', soaking' : ''})`);
  console.log('  ---------------------------------------------------------------');
  console.log(`  frame rate        ${r.fps.toFixed(1)} fps of a ${r.ceilingFps.toFixed(1)} fps ceiling  =  ${(r.fractionOfCeiling * 100).toFixed(0)}%   budget >= ${Math.round(BUDGET.ceilingFraction * 100)}%`);
  console.log(`  cost per copy     ${r.medianMsPerDraw.toFixed(2)} ms median, ${r.msPerDraw.toFixed(2)} ms mean, over ${r.drawCount} copies`);
  console.log(`  main thread       ${(r.drawBusyFraction * 100).toFixed(0)}% of the window was inside drawImage`);
  console.log(`  canvases          ${r.canvases} (${r.canvasesInDom} in the DOM)       budget <= ${BUDGET.canvases}`);
  console.log(`  canvas pixels     ${n(r.pixels)}                budget <= ${n(BUDGET.pixels)}`);
  console.log(`  draw calls        ${n(r.drawsPerSecond)}/s`);
  console.log(`  React commits     ${r.commits} in the window           budget <= ${BUDGET.commits}`);
  console.log(`  longest task      ${r.longestTaskMs.toFixed(0)} ms                    budget <= ${BUDGET.longTaskMs} ms`);
  console.log(`  blocked total     ${r.longTaskTotalMs.toFixed(0)} ms over ${r.longTaskCount} long task(s)`);
  console.log(`  captureStream     ${r.captureStreamCalls} call(s) since load`);
  const h = r.honesty;
  console.log('');
  console.log('  is every picture on screen the picture being encoded?');
  console.log(`      preview         ${h.previewHasLiveStream ? 'live engine stream' : 'NO LIVE STREAM'}, ${h.previewIsPainting ? 'painting' : 'NOT PAINTING'}`);
  console.log(`      output tiles    ${h.outputsWithLiveStream}/${h.outputs} on a live engine stream, ${h.outputsPainting}/${h.outputs} painting, ${h.distinctOutputStreams} distinct stream(s)`);
  console.log(`      shared object   ${h.previewSharesAnOutputStream ? 'yes - the preview IS an encoded output, not a copy' : 'NO - the preview is not one of the encoded outputs'}`);
  console.log('');
  console.log('  every canvas that exists:');
  for (const c of r.inventory) {
    console.log(
      `      ${String(c.w).padStart(5)}x${String(c.h).padEnd(5)} ${c.inDom ? 'dom' : '   '} ${n(c.drawsPerSecond).padStart(5)} draws/s  ${c.cls}`,
    );
  }
  const sync = Object.entries(r.sync)
    .filter(([, v]) => v.worstMs >= 1)
    .sort((a, b) => b[1].worstMs - a[1].worstMs);
  if (sync.length > 0) {
    console.log('');
    console.log('  synchronous calls that blocked (worst single call, since load):');
    for (const [name, v] of sync) {
      console.log(`      ${v.worstMs.toFixed(0).padStart(6)} ms worst  ${v.totalMs.toFixed(0).padStart(6)} ms total  ${String(v.calls).padStart(5)} calls  ${name}`);
    }
  }
  console.log('');
}

function verdict(r) {
  const failures = [];
  if (r.fractionOfCeiling < BUDGET.ceilingFraction) {
    failures.push(
      `the studio holds ${(r.fractionOfCeiling * 100).toFixed(0)}% of this machine's ${r.ceilingFps.toFixed(1)} fps ceiling, under the ${Math.round(BUDGET.ceilingFraction * 100)}% budget`,
    );
  }
  const h = r.honesty;
  if (wantLive) {
    if (!h.previewHasLiveStream) failures.push('the program preview is not showing a live engine stream');
    if (!h.previewSharesAnOutputStream) {
      failures.push('the program preview is not one of the encoded output streams - it is showing a copy');
    }
    if (h.outputs > 0 && h.outputsWithLiveStream < h.outputs) {
      failures.push(`${h.outputs - h.outputsWithLiveStream} output tile(s) are not on a live engine stream`);
    }
    if (h.outputs > 1 && h.distinctOutputStreams < h.outputs) {
      failures.push(`${h.outputs} output tiles share only ${h.distinctOutputStreams} stream(s): a tile is showing another format's picture`);
    }
  }
  if (BUDGET.fps > 0 && r.fps < BUDGET.fps) failures.push(`frame rate ${r.fps.toFixed(1)} fps is below the ${BUDGET.fps} fps budget`);
  if (r.pixels > BUDGET.pixels) failures.push(`canvas pixels ${Math.round(r.pixels).toLocaleString()} is over the ${BUDGET.pixels.toLocaleString()} budget`);
  if (r.canvases > BUDGET.canvases) {
    failures.push(
      `${r.canvases} canvases exist, over the budget of ${BUDGET.canvases} (one per composed format and nothing else)`,
    );
  }
  if (r.longestTaskMs > BUDGET.longTaskMs) failures.push(`longest task ${r.longestTaskMs.toFixed(0)} ms is over the ${BUDGET.longTaskMs} ms budget`);
  if (r.commits > BUDGET.commits) failures.push(`${r.commits} React commits is over the ${BUDGET.commits} budget`);
  if (failures.length === 0) {
    console.log('  PASS  every budget held.\n');
    return 0;
  }
  for (const line of failures) console.log(`  FAIL  ${line}`);
  console.log('');
  return 1;
}

main().catch((error) => {
  if (error instanceof CannotMeasure) console.error(`\n  cannot measure: ${error.message}\n`);
  else console.error(`\n  perf-studio failed: ${error?.stack ?? error}\n`);
  process.exit(2);
});
