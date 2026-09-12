// Electron smoke test: launches the built desktop app (dist/main + dist/renderer), waits for the
// renderer, screenshots the first window and asserts the LIVETAP shell rendered (not a 404).
// Run: node apps/desktop/e2e/smoke.mjs   (requires `npm run build -w @livetap/desktop` first)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const outDir = path.join(appDir, 'e2e', '__screenshots__');
fs.mkdirSync(outDir, { recursive: true });

const app = await electron.launch({ args: [appDir], cwd: appDir, env: { ...process.env, LIVETAP_SMOKE: '1' } });
const window = await app.firstWindow();
await window.waitForLoadState('domcontentloaded');
await window.waitForTimeout(2500);
const title = await window.title();
const url = window.url();
const text = (await window.locator('body').innerText()).slice(0, 4000);
const notFound = /page not found|that page moved|not part of LIVETAP/i.test(text);
const hasShell = /(What are you making|GO LIVE|Step 1 of 3)/i.test(text);
await window.screenshot({ path: path.join(outDir, 'desktop-first-window.png') });
console.log(JSON.stringify({ title, url, notFound, hasShell, sample: text.replace(/\s+/g, ' ').slice(0, 160) }, null, 2));
await app.close();
if (notFound || !hasShell) {
  console.error('FAIL: desktop shell did not render the LIVETAP app');
  process.exit(1);
}
console.log('PASS');
