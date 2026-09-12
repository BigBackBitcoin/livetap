// Deployed-experience review: screenshots + checks against the live Vercel URL.
// node review-deployed.mjs https://livetap.vercel.app <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'https://livetap.vercel.app';
const out = process.argv[3] ?? 'C:/Users/Administrator/Desktop/LIVETAP/docs/qa/deployed-review';
fs.mkdirSync(out, { recursive: true });
const results = [];
const browser = await chromium.launch();

async function run(name, { width, height, reducedMotion = 'no-preference', scrolls = 6, isMobile = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion, isMobile, hasTouch: isMobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  const resp = await page.goto(base + '/', { waitUntil: 'load' });
  const status = resp?.status();
  await page.waitForTimeout(1500);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const jsBytes = (await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js')).reduce((a, r) => a + (r.encodedBodySize || 0), 0)));
  const cssBytes = (await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.css')).reduce((a, r) => a + (r.encodedBodySize || 0), 0)));
  const lcp = await page.evaluate(() => new Promise((res) => { let v = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {} setTimeout(() => res(Math.round(v)), 500); }));
  const cls = await page.evaluate(() => new Promise((res) => { let v = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {} setTimeout(() => res(Number(v.toFixed(3))), 500); }));
  await page.screenshot({ path: path.join(out, `${name}-top.png`), fullPage: false });
  for (let i = 1; i <= scrolls; i++) {
    const y = Math.round(((docH - height) * i) / scrolls);
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${name}-scroll-${i}.png`), fullPage: false });
  }
  await page.waitForTimeout(1200);
  const text = await page.evaluate(() => document.body.innerText);
  const liveCount = (text.match(/\bLIVE\b/g) || []).length;
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));
  results.push({ name, status, docH, viewportHeights: +(docH / height).toFixed(1), overflow, jsBytes, cssBytes, lcp, cls, liveCount, links: links.filter((l) => l && !l.startsWith('http') && !l.startsWith('#')), errors: errors.slice(0, 5), ms: Date.now() - t0 });
  await ctx.close();
}

await run('desktop', { width: 1440, height: 900 });
await run('mobile', { width: 390, height: 844, isMobile: true, scrolls: 5 });
await run('reduced', { width: 1440, height: 900, reducedMotion: 'reduce', scrolls: 4 });

// Link check (internal)
const ctx = await browser.newContext();
const page = await ctx.newPage();
const linkStatus = {};
for (const l of new Set(results.flatMap((r) => r.links))) {
  const url = new URL(l, base + '/').toString();
  try { const r = await page.goto(url, { waitUntil: 'domcontentloaded' }); linkStatus[l] = r?.status(); } catch (e) { linkStatus[l] = String(e).slice(0, 60); }
}
await browser.close();
console.log(JSON.stringify({ base, results, linkStatus }, null, 2));
fs.writeFileSync(path.join(out, 'review.json'), JSON.stringify({ base, results, linkStatus }, null, 2));
