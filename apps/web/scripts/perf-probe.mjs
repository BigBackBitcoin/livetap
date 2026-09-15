/**
 * What the page actually costs, measured on the built product.
 *
 * Reports: how many canvases exist, how many pixels they cover, how many are being repainted,
 * the frame rate the page sustains, and the longest main-thread task. The numbers this replaced
 * were taken by hand once and then quoted for weeks; these are taken on demand, so an optimisation
 * can be shown to have worked rather than asserted to have.
 *
 *   node apps/web/scripts/perf-probe.mjs [--url=http://localhost:4183/] [--seconds=6]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const seconds = Number(arg('seconds', 6));
const target = arg('url', 'http://localhost:4183/');
const label = arg('label', target);

const webDir = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
/*
 * Its own port, deliberately.
 *
 * Playwright's `webServer` owns 4173 and is configured with `reuseExistingServer`, so a probe
 * that starts and stops a server on that port while a suite is running pulls the floor out from
 * under it: the suite reuses the probe's server, the probe exits and kills it, and forty tests
 * fail with ERR_CONNECTION_REFUSED that have nothing wrong with them.
 */
const PROBE_PORT = '4183';

const server = spawn(process.execPath, ['scripts/preview-server.mjs', 'dist', PROBE_PORT], { cwd: webDir, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
const page = await context.newPage();

await page.addInitScript(() => {
  /*
   * Count draws by wrapping the two calls that actually move pixels, before any page script runs.
   * `drawImage` is the one that matters here: every composited frame of every format is one, and
   * the whole question is how many times one camera frame gets copied.
   */
  window.__draws = 0;
  window.__longest = 0;
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of ['drawImage', 'putImageData']) {
    const original = proto[name];
    proto[name] = function (...a) {
      window.__draws += 1;
      return original.apply(this, a);
    };
  }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > window.__longest) window.__longest = entry.duration;
    }
  }).observe({ entryTypes: ['longtask'] });
});

/*
 * CPU throttling, because "60 fps on the build machine" is not a finding. A 4x slowdown is the
 * conventional stand-in for a mid-range laptop and 6x for a phone; a page that holds up there is
 * one a creator can actually use while their machine is also encoding video.
 */
const throttle = Number(arg('throttle', 1));
if (throttle > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}

await page.goto(target, { waitUntil: 'load' });
await page.evaluate(() => {
  localStorage.setItem('livetap.onboarding', 'true');
  localStorage.setItem('livetap.intent', '"talking"');
  localStorage.setItem('livetap.mode', '"simple"');
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3000);

/*
 * Optional scripted interaction, so the probe can reach the state the page is SLOW in rather
 * than the state it happens to load in. The expensive moment is camera-on and scrolled to the
 * outputs, which is nothing like the top of a page that has not been touched.
 */
for (const selector of arg('click', '').split(',').filter(Boolean)) {
  const button = page.locator(selector).first();
  if (await button.count()) {
    await button.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
  } else {
    console.log(`  note  no element matched ${selector}`);
  }
}
const scrollTo = Number(arg('scroll', 0));
if (scrollTo > 0) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), scrollTo);
  await page.waitForTimeout(2500);
}

/*
 * A CPU profile over the measurement window, so "what is eating the frame" is answered by the
 * engine rather than guessed at from the shape of the code.
 */
const wantProfile = process.argv.includes('--profile');
let profiler = null;
if (wantProfile) {
  profiler = await context.newCDPSession(page);
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.setSamplingInterval', { interval: 200 });
  await profiler.send('Profiler.start');
}

const stats = await page.evaluate(async (secs) => {
  const canvases = [...document.querySelectorAll('canvas')];
  const inventory = canvases.map((c) => {
    const r = c.getBoundingClientRect();
    return {
      w: c.width,
      h: c.height,
      px: c.width * c.height,
      onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
      cls: c.className?.toString().slice(0, 40) ?? '',
    };
  });

  const before = window.__draws;
  let frames = 0;
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      frames += 1;
      if (performance.now() - start >= secs * 1000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const elapsed = (performance.now() - start) / 1000;

  return {
    canvases: inventory.length,
    onScreen: inventory.filter((c) => c.onScreen).length,
    pixels: inventory.reduce((n, c) => n + c.px, 0),
    onScreenPixels: inventory.filter((c) => c.onScreen).reduce((n, c) => n + c.px, 0),
    fps: frames / elapsed,
    drawsPerSecond: (window.__draws - before) / elapsed,
    longestTaskMs: window.__longest,
    biggest: inventory.sort((a, b) => b.px - a.px).slice(0, 6),
  };
}, seconds);

console.log(`\n  ${label}`);
console.log(`  canvases        ${stats.canvases} (${stats.onScreen} on screen)`);
console.log(`  canvas pixels   ${stats.pixels.toLocaleString()} (${stats.onScreenPixels.toLocaleString()} on screen)`);
console.log(`  frame rate      ${stats.fps.toFixed(1)} fps`);
console.log(`  draw calls      ${stats.drawsPerSecond.toFixed(0)}/s`);
console.log(`  longest task    ${stats.longestTaskMs.toFixed(0)} ms`);
console.log(`  biggest canvases:`);
for (const c of stats.biggest) console.log(`      ${String(c.w).padStart(5)}x${String(c.h).padEnd(5)} ${c.onScreen ? 'on ' : 'off'} ${c.cls}`);
console.log('');

if (profiler) {
  const { profile } = await profiler.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const [index, id] of (profile.samples ?? []).entries()) {
    const node = byId.get(id);
    if (!node) continue;
    const delta = profile.timeDeltas?.[index] ?? 0;
    const f = node.callFrame;
    const where = `${f.functionName || '(anonymous)'}  ${String(f.url).split('/').pop()}:${f.lineNumber + 1}`;
    self.set(where, (self.get(where) ?? 0) + delta);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
  console.log('  where the time went (self time, sampled):');
  for (const [where, us] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`      ${((us / total) * 100).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(5)} ms  ${where}`);
  }
  console.log('');
}

await browser.close();
server.kill();
