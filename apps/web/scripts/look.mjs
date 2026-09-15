/** Targeted screenshots for review, at the sizes the product is actually used at. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const outDir = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? 'lab/look';
mkdirSync(outDir, { recursive: true });
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

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const SHOTS = [
  ['landing-hero', 'http://localhost:4183/', 0],
  ['app-studio', 'http://localhost:4183/app', 0],
  ['app-destinations', 'http://localhost:4183/app/destinations', 0],
  ['app-settings', 'http://localhost:4183/app/settings', 0],
];

await page.goto('http://localhost:4183/app');
await page.evaluate(() => {
  localStorage.setItem('livetap.onboarding', 'true');
  localStorage.setItem('livetap.intent', '"talking"');
  localStorage.setItem('livetap.mode', '"simple"');
});

for (const [name, url, y] of SHOTS) {
  await page.goto(url);
  await page.waitForTimeout(2200);
  if (y) await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${outDir}/${name}.png`);
}
await browser.close();
server.kill();
