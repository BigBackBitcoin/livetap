/**
 * Every word the product says, per route, measured rather than remembered.
 *
 * A copy audit done by grepping JSX finds the strings that happen to be written as string
 * literals and misses every one that is composed, interpolated or conditional - which is most of
 * the interesting ones. This walks the built app with a real browser and reads what is actually
 * on the screen, which is the only list worth editing.
 *
 *   node apps/web/scripts/copy-audit.mjs            # after `npm run build -w @livetap/web`
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ROUTES = [
  ['/app', 'Studio'],
  ['/app/destinations', 'Destinations'],
  ['/app/moments', 'Moments'],
  ['/app/settings', 'Settings'],
  ['/app/start', 'Setup'],
];

/*
 * Its own port, deliberately.
 *
 * Playwright's `webServer` owns 4173 and is configured with `reuseExistingServer`, so a probe
 * that starts and stops a server on that port while a suite is running pulls the floor out from
 * under it: the suite reuses the probe's server, the probe exits and kills it, and forty tests
 * fail with ERR_CONNECTION_REFUSED that have nothing wrong with them.
 */
const PROBE_PORT = '4183';

const server = spawn(process.execPath, ['scripts/preview-server.mjs', 'dist', PROBE_PORT], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const report = [];
let totalWords = 0;

/*
 * Onboarding state first, once. The app sends a first-time visitor to setup from every route, so
 * a walk that has not been through it measures the setup screen five times.
 */
await page.goto('http://localhost:4183/app');
await page.evaluate(() => {
  localStorage.setItem('livetap.onboarding', 'true');
  localStorage.setItem('livetap.intent', '"talking"');
  localStorage.setItem('livetap.mode', '"simple"');
});

for (const [route, name] of ROUTES) {
  await page.goto(`http://localhost:4183${route}`);
  await page.waitForTimeout(1800);

  /* Only what a person can actually read: visible, non-empty, and not screen-reader-only. */
  const blocks = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? '').trim();
      if (text.length < 2) continue;
      const el = node.parentElement;
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
      if (el.closest('.lt-sr-only')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      out.push({ text, tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 50) ?? '' });
    }
    return out;
  });

  const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  totalWords += words;
  report.push(`\n## ${name} (${route}) — ${words} words, ${blocks.length} text nodes\n`);
  for (const b of blocks.sort((a, c) => c.text.length - a.text.length)) {
    const w = b.text.split(/\s+/).length;
    report.push(`${String(w).padStart(3)}w  [${b.tag}.${b.cls}]  ${b.text}`);
  }
}

report.unshift(`# LIVETAP visible copy, measured\n\nTotal: ${totalWords} words across ${ROUTES.length} routes.`);
writeFileSync('docs/qa/COPY_AUDIT_RAW.md', report.join('\n'));
console.log(`${totalWords} words across ${ROUTES.length} routes -> docs/qa/COPY_AUDIT_RAW.md`);
await browser.close();
server.kill();
