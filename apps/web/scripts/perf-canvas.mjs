#!/usr/bin/env node
/**
 * What one composited frame costs, and which canvas decisions change that.
 *
 * `perf-studio.mjs` measures the product; this measures the primitive underneath it. It exists
 * because a plausible optimisation went the wrong way and a whole-product A/B took thirteen
 * minutes to say so without saying why. Asking `drawImage` directly takes about a minute and
 * answers the actual question: for THIS machine's rasteriser, does an opaque context help? Does a
 * full-canvas clip cost anything? Does an attached `captureStream` change the price of a draw?
 *
 * Those are not questions to answer from folklore. "Use `alpha: false`, it is faster" is true of
 * many browsers on many machines and it is a claim about a specific rasteriser, not a law. A
 * GPU-less Windows VM compositing through SwiftShader is exactly where such advice inverts, and
 * the only way to know is to time it where the product runs.
 *
 * Every variant draws the SAME live camera frame into the SAME size of canvas the studio uses,
 * back to back, interleaved across rounds so that a passing background process cannot land on one
 * variant and be mistaken for a property of it.
 *
 *   node apps/web/scripts/perf-canvas.mjs
 *   node apps/web/scripts/perf-canvas.mjs --rounds=8 --draws=40
 *
 * Exit 0 always: this is an instrument, not a gate.
 */
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
};

const rounds = arg('rounds', 6);
const drawsPerRound = arg('draws', 30);

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({ permissions: ['camera'] });
const page = await context.newPage();
/*
 * A secure origin, because `navigator.mediaDevices` does not exist on `about:blank` and a
 * benchmark of the camera path needs the camera. The page is served from nowhere - the request is
 * fulfilled in-process - but Chromium treats https:// as a secure context all the same.
 */
await page.route('https://livetap.invalid/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>bench</title>' }),
);
await page.goto('https://livetap.invalid/');

const result = await page.evaluate(
  async ({ rounds: roundCount, drawsPerRound: perRound }) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 600));

    const make = (w, h, alpha, capture) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha });
      ctx.imageSmoothingQuality = 'low';
      // An attached capture is not a detail: the studio's canvases all have one, and a canvas
      // that must hand a frame to a MediaStreamTrack may be rasterised differently from one that
      // nobody is reading.
      const captured = capture ? canvas.captureStream(30) : null;
      return { canvas, ctx, captured };
    };

    /**
     * The four decisions under test, at the studio's real master size.
     *
     * `clip` reproduces exactly what the compositor did for a full-frame camera layer: save, set a
     * path to the whole canvas, clip to it, draw, restore.
     */
    const variants = [
      { name: 'alpha:true  no clip   captured', alpha: true, clip: false, capture: true },
      { name: 'alpha:false no clip   captured', alpha: false, clip: false, capture: true },
      { name: 'alpha:true  full clip captured', alpha: true, clip: true, capture: true },
      { name: 'alpha:false full clip captured', alpha: false, clip: true, capture: true },
      { name: 'alpha:true  no clip   plain', alpha: true, clip: false, capture: false },
      { name: 'alpha:false no clip   plain', alpha: false, clip: false, capture: false },
    ].map((v) => ({ ...v, ...make(1920, 1080, v.alpha, v.capture), samples: [] }));

    const drawOnce = (v) => {
      const { ctx } = v;
      const started = performance.now();
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 1920, 1080);
      ctx.save();
      ctx.globalAlpha = 1;
      if (v.clip) {
        ctx.beginPath();
        ctx.rect(0, 0, 1920, 1080);
        ctx.clip();
      }
      // `cover` from 1280x720 into 1920x1080 is the same 1.5x upscale the studio performs.
      ctx.drawImage(video, 0, 0, 1920, 1080);
      ctx.restore();
      ctx.restore();
      return performance.now() - started;
    };

    // Warm every variant first, so nobody pays for a lazily allocated backing store in round 1.
    for (const v of variants) for (let i = 0; i < 5; i += 1) drawOnce(v);

    for (let round = 0; round < roundCount; round += 1) {
      for (const v of variants) {
        for (let i = 0; i < perRound; i += 1) v.samples.push(drawOnce(v));
      }
      // Let a frame go by so the capture tracks actually consume what was drawn.
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }

    const median = (xs) => {
      const s = xs.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    return variants.map((v) => ({
      name: v.name,
      median: median(v.samples),
      p10: v.samples.slice().sort((a, b) => a - b)[Math.floor(v.samples.length * 0.1)],
      p90: v.samples.slice().sort((a, b) => a - b)[Math.floor(v.samples.length * 0.9)],
      n: v.samples.length,
    }));
  },
  { rounds, drawsPerRound },
);

console.log('');
console.log(`  one 1280x720 camera frame drawn into a 1920x1080 canvas, ${rounds} interleaved rounds`);
console.log('  -------------------------------------------------------------------------------');
console.log(`  ${'variant'.padEnd(34)} ${'median'.padStart(8)} ${'p10'.padStart(8)} ${'p90'.padStart(8)}   n`);
const baseline = result[0].median;
for (const r of result) {
  const delta = ((r.median - baseline) / baseline) * 100;
  console.log(
    `  ${r.name.padEnd(34)} ${r.median.toFixed(2).padStart(8)} ${r.p10.toFixed(2).padStart(8)} ${r.p90.toFixed(2).padStart(8)}   ${r.n}   ${`${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`.padStart(6)}`,
  );
}
console.log('');
console.log('  All times in milliseconds. The first row is the baseline the percentages are against.');
console.log('');

/*
 * The second question, and the one that turned out to matter.
 *
 * The studio composes three formats from ONE camera. Each `MomentCompositor` ran its own
 * animation-frame loop, so whether the three draws of a given camera frame happened inside one
 * task or were scattered across three was an accident of when each loop happened to start. That
 * is not a scheduling detail: a `<video>` frame has to be converted before it can be drawn, and
 * the second and third draw of the same frame in the same task can reuse that conversion, while
 * three draws in three tasks each pay for it.
 *
 * If that is true here, then "one shared loop for all formats" is worth more than every canvas
 * flag above put together - and the fix belongs in FormatRenderer, not in the canvas setup.
 */
const batching = await page.evaluate(
  async ({ rounds: roundCount }) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 600));

    /** The studio's real set: one canvas per aspect ratio, each with a live capture attached. */
    const sizes = [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ];
    const build = () =>
      sizes.map(([w, h]) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        canvas.captureStream(30);
        return { canvas, ctx, w, h };
      });

    const batched = build();
    const split = build();

    const draw = (target) => {
      const started = performance.now();
      target.ctx.drawImage(video, 0, 0, target.w, target.h);
      return performance.now() - started;
    };

    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
    for (const t of [...batched, ...split]) for (let i = 0; i < 5; i += 1) draw(t);

    const batchedSamples = [];
    const splitSamples = [];
    for (let round = 0; round < roundCount; round += 1) {
      // All three formats of one camera frame, inside a single task.
      await nextFrame();
      for (const t of batched) batchedSamples.push(draw(t));
      // The same three draws, one per animation frame, which is what independent loops drift into.
      for (const t of split) {
        await nextFrame();
        splitSamples.push(draw(t));
      }
    }

    const stats = (xs) => {
      const s = xs.slice().sort((a, b) => a - b);
      return { median: s[Math.floor(s.length / 2)], total: xs.reduce((a, b) => a + b, 0), n: xs.length };
    };
    /* First draw of a frame pays the conversion; draws 2 and 3 are the ones that can reuse it. */
    const firstOfEach = batchedSamples.filter((_, i) => i % 3 === 0);
    const restOfEach = batchedSamples.filter((_, i) => i % 3 !== 0);
    return {
      batched: stats(batchedSamples),
      split: stats(splitSamples),
      batchedFirst: stats(firstOfEach),
      batchedRest: stats(restOfEach),
    };
  },
  { rounds },
);

console.log('  three formats of one camera frame: together in one task, or one per task');
console.log('  -------------------------------------------------------------------------------');
const show = (name, s) => console.log(`  ${name.padEnd(46)} ${s.median.toFixed(2).padStart(8)} ms median   n=${s.n}`);
show('all three in one task', batching.batched);
show('   ... of which the FIRST draw of the frame', batching.batchedFirst);
show('   ... of which the 2nd and 3rd draw', batching.batchedRest);
show('one draw per animation frame (independent loops)', batching.split);
const saving = ((batching.split.median - batching.batched.median) / batching.split.median) * 100;
console.log('');
console.log(`  batching the three draws is ${saving >= 0 ? `${saving.toFixed(0)}% cheaper per draw` : `${(-saving).toFixed(0)}% MORE expensive per draw`}.`);
console.log('');

await browser.close();
