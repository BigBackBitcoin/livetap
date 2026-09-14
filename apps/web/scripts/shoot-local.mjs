// Quick visual check of the built public page: screenshots at several viewports and scroll
// positions, console errors, and the hero band geometry. node scripts/shoot-local.mjs [base] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'docs/qa/local-shots';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function shoot(name, vp, opts = {}) {
  const ctx = await browser.newContext({
    viewport: vp,
    reducedMotion: opts.reduce ? 'reduce' : 'no-preference',
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    colorScheme: opts.dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('html.sc-ready');
  await page.waitForTimeout(opts.wait ?? 5200);
  const geo = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
    };
    return {
      band: r('[data-lt-band="act-hero"]'),
      title: r('[data-lt-band="act-hero"] .ltp-band__title'),
      tools: r('[data-lt-band="act-hero"] .ltp-band__tools'),
      surface: r('[data-lt-surface]'),
      frame: r('[data-lt-frame]'),
      canvas: r('[data-lt-canvas]'),
      video: r('[data-lt-layer="camera"] video'),
      videoPlaying: (() => {
        const v = document.querySelector('[data-lt-layer="camera"] video');
        return v ? { paused: v.paused, t: +v.currentTime.toFixed(2), ready: v.readyState, w: v.videoWidth } : null;
      })(),
      yourTurn: document.querySelector('[data-lt-yourturn]')?.dataset.ltYourturn,
      state: document.querySelector('[data-lt-surface]').dataset.scVerifyState,
      docH: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  await page.screenshot({ path: path.join(out, `${name}-0.png`) });
  const docH = geo.docH;
  const stops = opts.stops ?? [0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
  for (const [k, f] of stops.entries()) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), Math.round((docH - vp.height) * f));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${name}-${k + 1}.png`) });
  }
  console.log(name, JSON.stringify({ ...geo, errors: errors.slice(0, 6) }));
  await ctx.close();
}

await shoot('desk', { width: 1440, height: 900 });
await shoot('desk-short', { width: 1280, height: 720 }, { stops: [0.25] });
await shoot('desk-dark', { width: 1440, height: 900 }, { dark: true, stops: [0.25, 0.55] });
await shoot('phone', { width: 390, height: 844 }, { mobile: true, stops: [0.15, 0.35, 0.55, 0.75, 1] });
await shoot('tablet', { width: 768, height: 1024 }, { mobile: true, stops: [0.3, 0.7] });
await shoot('reduced', { width: 1440, height: 900 }, { reduce: true, stops: [0.25, 0.55] });
await browser.close();
