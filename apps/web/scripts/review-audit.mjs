// Deployed-experience review for the audit closure: evidence screenshots per chapter and per
// viewport, plus the measurements the closure matrix cites. Run against production:
//   node scripts/review-audit.mjs https://livetap.vercel.app ../../docs/qa/deployed-review-2
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? 'https://livetap.vercel.app').replace(/\/$/, '');
const out = process.argv[3] ?? '../../docs/qa/deployed-review-2';
fs.mkdirSync(out, { recursive: true });
const results = {};
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

const ACTS = ['act-hero', 'act-break', 'act-shape', 'act-moments', 'act-outputs', 'act-versus', 'act-pro', 'act-make'];

async function open(name, vp, opts = {}) {
  const ctx = await browser.newContext({
    viewport: vp,
    reducedMotion: opts.reduce ? 'reduce' : 'no-preference',
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    colorScheme: opts.dark ? 'dark' : 'light',
    deviceScaleFactor: 1,
    permissions: opts.camera ? ['camera'] : [],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.__listeners = [];
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, o) {
      if (/^(wheel|mousewheel|touchmove|touchstart)$/.test(type)) {
        const passive = typeof o === 'object' && o ? !!o.passive : false;
        const t = this === window ? 'window' : this === document ? 'document' : this.tagName || String(this);
        window.__listeners.push(`${type}:${passive ? 'passive' : 'BLOCKING'}:${t}`);
      }
      return orig.call(this, type, fn, o);
    };
    window.__cls = 0;
    window.__lcp = '';
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          const n = e.element;
          window.__lcp = `${Math.round(e.startTime)}ms ${n ? n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0] : '?'}`;
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
  });
  const t0 = Date.now();
  const resp = await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('html.sc-ready');
  return { ctx, page, errors, status: resp?.status(), loadMs: Date.now() - t0, name, vp };
}

async function toAct(page, id, p = 0.5) {
  const y = await page.evaluate(
    ([actId, at]) => {
      const el = document.getElementById(actId);
      const top = el.getBoundingClientRect().top + scrollY;
      return Math.round(top + Math.max(el.offsetHeight - innerHeight, 1) * at);
    },
    [id, p],
  );
  await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
  await page.waitForTimeout(500);
}

const shot = (page, file) => page.screenshot({ path: path.join(out, file) });

/** Park at a chapter and wait for its band; report what the page thinks is active if it fails. */
async function atBand(page, id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await toAct(page, id, 0.5);
    try {
      await page.waitForFunction((a) => document.body.dataset.ltAct === a, id, { timeout: 2500 });
      await page.waitForSelector(`[data-lt-band="${id}"].is-here`, { timeout: 2500 });
      await page.waitForTimeout(250);
      return;
    } catch {
      const act = await page.evaluate(() => `${document.body.dataset.ltAct} y=${scrollY}`);
      console.log(`  band ${id} not shown (attempt ${attempt + 1}); page says ${act}`);
    }
  }
}

async function review(name, vp, opts = {}) {
  const s = await open(name, vp, opts);
  const { page } = s;
  await page.waitForTimeout(5200);
  const r = { status: s.status, loadMs: s.loadMs, vp };
  r.first = await page.evaluate(() => {
    const v = document.querySelector('[data-lt-layer="camera"] video');
    const band = document.querySelector('[data-lt-band="act-hero"]');
    const title = band?.querySelector('.ltp-band__title');
    const tb = title?.getBoundingClientRect();
    const covering = tb
      ? (document.elementFromPoint(tb.left + 10, tb.top + 10)?.closest('[data-lt-band="act-hero"]') ? 'band' : 'OTHER')
      : 'none';
    return {
      bandHere: band?.classList.contains('is-here'),
      title: title?.textContent?.trim().replace(/\s+/g, ' '),
      titleCoveredBy: covering,
      video: v ? { paused: v.paused, t: +v.currentTime.toFixed(2), ready: v.readyState } : null,
      yourTurn: document.querySelector('[data-lt-golive-sub]')?.dataset.ltYourturn,
      liveCount: document.querySelectorAll('[data-lt-state="LIVE"]').length,
      state: document.querySelector('[data-lt-surface]').dataset.scVerifyState,
      format: document.querySelector('[data-lt-stage]').dataset.ltFormat,
      intent: document.querySelector('[data-lt-intent][aria-pressed="true"]')?.dataset.ltIntent,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      cls: +window.__cls.toFixed(3),
      lcp: window.__lcp,
      listeners: window.__listeners,
      downloadWord: /\bDownload\b/.test(document.body.innerText),
      docH: document.documentElement.scrollHeight,
    };
  });
  await shot(page, `${name}-hero.png`);

  // Scroll by real input from the middle of the surface, then keys.
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(400);
  r.wheelFromCentre = await page.evaluate(() => scrollY);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.mouse.move(vp.width * 0.15, vp.height * 0.45);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(400);
  r.wheelFromTile = await page.evaluate(() => scrollY);
  await page.evaluate(() => scrollTo(0, 0));
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(400);
  r.pageDown = await page.evaluate(() => scrollY);
  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  r.end = await page.evaluate(() => scrollY);
  await page.keyboard.press('Home');
  await page.waitForTimeout(400);
  r.home = await page.evaluate(() => scrollY);
  if (opts.mobile) {
    await page.touchscreen.tap(vp.width / 2, vp.height * 0.3);
    const cdp = await s.ctx.newCDPSession(page);
    const x = vp.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: vp.height * 0.7 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: vp.height * 0.7 - i * 40 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
    r.touchSwipe = await page.evaluate(() => scrollY);
    await page.evaluate(() => scrollTo(0, 0));
  }

  // Every chapter: band shown, screenshot, shape control works here.
  r.chapters = {};
  for (const id of ACTS) {
    await toAct(page, id, 0.5);
    const c = await page.evaluate((actId) => {
      const band = document.querySelector(`[data-lt-band="${actId}"]`);
      const active = document.body.dataset.ltAct;
      const b = band?.getBoundingClientRect();
      return {
        active,
        bandHere: band ? band.classList.contains('is-here') : null,
        bandTop: b ? Math.round(b.top) : null,
        bandBottom: b ? Math.round(b.bottom) : null,
        bandInside: b ? b.top >= -1 && b.bottom <= innerHeight + 1 : null,
        title: band?.querySelector('.ltp-band__title')?.textContent?.trim() ?? document.querySelector('.ltp-close__q')?.textContent,
      };
    }, id);
    await shot(page, `${name}-${id}.png`);
    // shape control at this chapter: the toolbar copy on desktop (every chapter), the band copy on
    // phones (only at its own chapter, where the band is on). A real change is proved by
    // switching AWAY from the current shape and back.
    const here = await page.evaluate(() => document.querySelector('[data-lt-stage]').dataset.ltFormat);
    const other = here === '9:16' ? '16:9' : '9:16';
    const scope = opts.mobile ? '[data-lt-band="act-shape"]' : '.ltp-toolbar';
    const usable = opts.mobile ? id === 'act-shape' : true;
    if (usable) {
      await page.locator(`${scope} [data-lt-format-set="${other}"]`).click();
      await page.waitForTimeout(150);
      c.shapeBefore = here;
      c.shapeAfterClick = await page.evaluate(() => document.querySelector('[data-lt-stage]').dataset.ltFormat);
      await page.locator(`${scope} [data-lt-format-set="${here}"]`).click();
    } else {
      c.shapeControlVisibleHere = false;
    }
    r.chapters[id] = c;
  }

  // The flows, from the top.
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.locator('[data-lt-golive]').click();
  await page.waitForSelector('[data-lt-state="LIVE"]', { timeout: 10000 });
  await page.waitForTimeout(700);
  r.live = await page.evaluate(() => ({
    state: document.querySelector('[data-lt-surface]').dataset.scVerifyState,
    badge: !document.querySelector('[data-lt-stage-live]').hidden,
    label: document.querySelector('[data-lt-golive-label]').textContent,
  }));
  await shot(page, `${name}-live.png`);
  await atBand(page, 'act-break');
  await page.locator('[data-lt-break-cta]').click();
  await page.waitForSelector('[data-lt-state="RECONNECTING"]', { timeout: 6000 });
  await page.waitForTimeout(300);
  r.broken = await page.evaluate(() => ({
    state: document.querySelector('[data-lt-surface]').dataset.scVerifyState,
    card: document.querySelector('[data-lt-errorslot] .lt-errorcard')?.innerText.replace(/\s+/g, ' ').slice(0, 160),
  }));
  await shot(page, `${name}-broken.png`);
  await page.waitForSelector('[data-lt-state="RECONNECTING"]', { state: 'detached', timeout: 10000 });
  r.healed = await page.evaluate(() => document.querySelector('[data-lt-surface]').dataset.scVerifyState);
  await atBand(page, 'act-shape');
  await page.locator(opts.mobile ? '[data-lt-band="act-shape"] [data-lt-format-set="9:16"]' : '.ltp-toolbar [data-lt-format-set="9:16"]').click();
  await page.waitForTimeout(400);
  r.vertical = await page.evaluate(() => {
    const c = document.querySelector('[data-lt-canvas]').getBoundingClientRect();
    return { format: document.querySelector('[data-lt-stage]').dataset.ltFormat, canvas: [Math.round(c.width), Math.round(c.height)], zones: Array.from(document.querySelectorAll('.ltp-guides__zone')).filter((z) => getComputedStyle(z).display !== 'none').length };
  });
  await shot(page, `${name}-vertical.png`);
  await atBand(page, 'act-moments');
  await page.locator('[data-lt-moment-mirror="screen-share"]').click();
  await page.waitForTimeout(400);
  r.screenShare = await page.evaluate(() => ({
    moment: document.querySelector('[data-lt-stage]').dataset.ltActiveMoment,
    screenOn: document.querySelector('[data-lt-layer="screen"]').classList.contains('is-on'),
    screenInput: document.querySelector('[data-lt-input="screen"]').getAttribute('aria-pressed'),
  }));
  await shot(page, `${name}-screenshare.png`);
  await page.locator('[data-lt-moment-mirror="guest"]').click();
  await page.waitForTimeout(400);
  await shot(page, `${name}-guest.png`);
  await page.locator('[data-lt-moment-mirror="main-camera"]').click();
  await toAct(page, 'act-outputs', 0.5);
  await page.waitForTimeout(500);
  r.outputs = await page.evaluate(() => ({
    figures: document.querySelectorAll('[data-lt-outputs] figure').length,
    lede: document.querySelector('[data-lt-outputs-lede]')?.textContent,
  }));
  await shot(page, `${name}-outputs.png`);
  await atBand(page, 'act-versus');
  await page.getByRole('button', { name: 'Play the usual setup' }).click();
  await page.waitForTimeout(opts.reduce ? 300 : 2200);
  r.versus = await page.evaluate(() => document.querySelector('[data-lt-versus]').dataset.ltVersusState);
  await shot(page, `${name}-versus.png`);
  await atBand(page, 'act-pro');
  await page.locator(opts.mobile ? '[data-lt-band="act-pro"] [data-lt-mode-set="pro"]' : '.ltp-toolbar [data-lt-mode-set="pro"]').click();
  await page.waitForTimeout(400);
  r.pro = await page.evaluate(() => ({ panels: document.querySelectorAll('[data-lt-prorow]').length, hidden: document.querySelector('[data-lt-prolayers]').hidden }));
  await shot(page, `${name}-pro.png`);
  await toAct(page, 'act-make', 0.6);
  await page.locator('[data-lt-intent="gaming"]').click();
  await page.waitForTimeout(400);
  r.intent = await page.evaluate(() => ({
    format: document.querySelector('[data-lt-stage]').dataset.ltFormat,
    moment: document.querySelector('[data-lt-stage]').dataset.ltActiveMoment,
    answer: document.querySelector('[data-lt-intent-answer]')?.textContent,
    open: document.querySelector('[data-lt-open]')?.getAttribute('href'),
    watch: document.querySelector('[data-lt-watch]')?.getAttribute('href'),
  }));
  await shot(page, `${name}-make.png`);
  if (opts.camera) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.locator('[data-lt-band="act-hero"] [data-lt-camera-cta]').click();
    await page.waitForTimeout(1500);
    r.camera = await page.evaluate(() => ({
      source: document.querySelector('[data-lt-surface]').dataset.ltSource,
      label: document.querySelector('[data-lt-camera-label]').textContent,
      stream: !!document.querySelector('[data-lt-layer="camera"] video')?.srcObject,
      note: document.querySelector('[data-lt-camera-note]').textContent,
    }));
    await shot(page, `${name}-camera.png`);
  }
  r.errors = s.errors.slice(0, 8);
  r.links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')).filter((h) => h && !h.startsWith('#')));
  results[name] = r;
  await s.ctx.close();
  console.log(name, JSON.stringify(r).slice(0, 1200));
}

const ONLY = process.env.ONLY;
const maybe = (name, vp, opts) => (!ONLY || ONLY === name ? review(name, vp, opts) : Promise.resolve());
await maybe('desktop', { width: 1440, height: 900 }, { camera: true });
await maybe('desktop-short', { width: 1280, height: 720 });
await maybe('phone-390', { width: 390, height: 844 }, { mobile: true });
await maybe('phone-375', { width: 375, height: 667 }, { mobile: true });
await maybe('phone-412', { width: 412, height: 915 }, { mobile: true });
await maybe('tablet-768', { width: 768, height: 1024 }, { mobile: true });
await maybe('reduced', { width: 1440, height: 900 }, { reduce: true });
await maybe('dark', { width: 1440, height: 900 }, { dark: true });

// Links and the 404.
const ctx = await browser.newContext();
const page = await ctx.newPage();
const links = {};
const all = new Set(Object.values(results).flatMap((r) => r.links));
for (const l of all) {
  const url = new URL(l, base + '/').toString();
  try {
    const r = await page.goto(url, { waitUntil: 'domcontentloaded' });
    links[l] = r?.status();
  } catch (e) {
    links[l] = String(e).slice(0, 60);
  }
}
links['/nope'] = (await page.goto(base + '/nope'))?.status();
await browser.close();
const file = path.join(out, 'review.json');
let merged = { base, when: new Date().toISOString(), results, links };
if (ONLY && fs.existsSync(file)) {
  const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  merged = { ...prev, when: merged.when, results: { ...prev.results, ...results }, links: { ...prev.links, ...links } };
}
fs.writeFileSync(file, JSON.stringify(merged, null, 2));
console.log('links', JSON.stringify(links));
