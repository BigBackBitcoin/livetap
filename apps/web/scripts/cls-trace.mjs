// Layout-shift and LCP attribution for the public page. node apps/web/scripts/cls-trace.mjs <url> [reduce]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'https://livetap.vercel.app/';
const reduce = process.argv[3] === 'reduce';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__shifts = [];
  window.__lcp = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__shifts.push({
        t: Math.round(e.startTime),
        value: +e.value.toFixed(4),
        sources: (e.sources || []).map((s) => {
          const n = s.node;
          const desc = n ? `${n.nodeName.toLowerCase()}${n.id ? '#' + n.id : ''}${n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 3).join('.') : ''}` : '?';
          return { node: desc, from: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round), to: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round) };
        }),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      const n = e.element;
      window.__lcp.push({ t: Math.round(e.startTime), size: e.size, el: n ? `${n.nodeName.toLowerCase()}${n.id ? '#' + n.id : ''}${typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 3).join('.') : ''}` : '?', url: e.url || '' });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(4000);
const data = await page.evaluate(() => ({ shifts: window.__shifts, lcp: window.__lcp, fonts: Array.from(document.fonts).map((f) => `${f.family} ${f.weight} ${f.status}`) }));
await browser.close();
const total = data.shifts.reduce((a, s) => a + s.value, 0);
console.log(JSON.stringify({ reduce, totalCLS: +total.toFixed(3), shifts: data.shifts.slice(0, 12), lcp: data.lcp, fonts: data.fonts }, null, 1));
