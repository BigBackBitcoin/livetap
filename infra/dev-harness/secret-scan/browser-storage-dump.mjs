#!/usr/bin/env node
/**
 * TEAM F (SECURITY), 2026-09-15. The runtime half of §23's "browser storage" question.
 *
 * A grep proves that the source contains no `localStorage.setItem('token', ...)`. It does
 * not prove what a REAL browser holds after a real creator has pasted a real stream key
 * into the real production build. This drives that, and then dumps every store a page
 * script on the origin could read:
 *
 *   localStorage, sessionStorage, document.cookie, IndexedDB (every database, every object
 *   store, every record), Cache Storage (every cache, every response body).
 *
 * It fails loudly if the pasted key -- or anything else credential-shaped -- is found in
 * any of them, and it fails just as loudly if it never managed to paste a key, because a
 * clean dump of a store nothing was ever put into proves nothing at all.
 *
 * Run:  node infra/dev-harness/secret-scan/browser-storage-dump.mjs
 * Needs: `npm run build -w @livetap/web` to have produced apps/web/dist (it will say so).
 *
 * Nothing here is a real credential. `CANARY` is shaped like a Twitch key and is not one.
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const DIST = join(REPO, 'apps', 'web', 'dist');
const PREVIEW = join(REPO, 'apps', 'web', 'scripts', 'preview-server.mjs');
const PORT = Number(process.env.PORT ?? 4183);
const ORIGIN = `http://localhost:${PORT}`;

/** Shaped like a Twitch stream key. Not one. Never was. */
const CANARY = 'live_000000000_LIVETAPsecretSCANcanaryNOTaRealKey';
const SERVER = 'rtmp://ingest.example.invalid/app';

function fail(message) {
  console.error(`\nFAIL  ${message}`);
  process.exitCode = 1;
}

async function startPreview() {
  if (!existsSync(DIST)) {
    console.error(`apps/web/dist does not exist. Run: npm run build -w @livetap/web`);
    process.exit(2);
  }
  const child = spawn(process.execPath, [PREVIEW, DIST, String(PORT)], {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(`${ORIGIN}/app`);
      if (response.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('the preview server did not come up');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return child;
}

/** Everything a page script on this origin can read, as one list of {where, key, value}. */
const DUMP = `async () => {
  const out = [];
  for (const [name, store] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      out.push({ where: name, key, value: store.getItem(key) ?? '' });
    }
  }
  if (document.cookie) out.push({ where: 'cookie', key: '(all)', value: document.cookie });

  if (indexedDB.databases) {
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open(info.name);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      for (const storeName of Array.from(db.objectStoreNames)) {
        const records = await new Promise((res) => {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => res([]);
        });
        out.push({ where: 'indexedDB:' + info.name + '/' + storeName, key: '(all)', value: JSON.stringify(records) });
      }
      db.close();
    }
  }

  if (globalThis.caches) {
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const body = response ? await response.clone().text().catch(() => '') : '';
        out.push({ where: 'cacheStorage:' + cacheName, key: request.url, value: body });
      }
    }
  }
  return out;
}`;

async function main() {
  const preview = await startPreview();
  const browser = await chromium.launch();
  let pastedKey = false;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Fresh first run, then the golden path to Studio, exactly as the E2E helpers do it.
    await page.goto(`${ORIGIN}/app`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${ORIGIN}/app`, { waitUntil: 'domcontentloaded' });

    await page.getByRole('heading', { name: 'What are you making?' }).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Talking' }).first().click();
    await page.getByRole('heading', { name: 'Where are you going live?' }).waitFor();
    await page.getByRole('button', { name: /^YouTube/ }).first().click();
    await page.getByRole('button', { name: 'Continue' }).first().click();
    await page.getByRole('heading', { name: 'Here is your setup' }).waitFor();
    await page.getByRole('button', { name: 'Open Studio' }).first().click();
    await page.getByRole('button', { name: 'Go live' }).waitFor({ timeout: 30_000 });

    // Paste a stream key into a Custom RTMP destination. This is the ONLY place in the
    // product where a creator types a credential, so it is the only place worth dumping.
    await page.getByRole('link', { name: 'Destinations' }).first().click();
    await page.getByRole('button', { name: /Add destination/ }).first().click();
    await page.getByRole('button', { name: /^Custom RTMP/ }).first().click();
    await page.getByLabel(/^Server address/).first().fill(SERVER);
    await page.getByLabel('Stream key').first().fill(CANARY);
    await page.getByLabel('Name for this destination').first().fill('Secret scan target');
    // The submit control has been renamed once already ("Save this destination" ->
    // "Connect"), so this targets the form's submit button rather than its wording.
    await page.locator('form.lt-keyform button[type=submit], form button[type=submit]').first().click();
    await page
      .locator('.lt-destcard', { hasText: 'Secret scan target' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    pastedKey = true;

    // Let every deferred write land: persistence is debounced in places.
    await page.waitForTimeout(2_000);

    // `evaluate` with a string evaluates an EXPRESSION, so the arrow has to be called.
    const entries = await page.evaluate(`(${DUMP})()`);

    console.log(`\nEvery web-reachable store on ${ORIGIN}, after a real paste:\n`);
    for (const entry of entries) {
      const preview = entry.value.length > 160 ? `${entry.value.slice(0, 160)}…` : entry.value;
      console.log(`  ${entry.where}  ${entry.key}\n      ${preview.replace(/\n/g, ' ')}`);
    }
    if (entries.length === 0) console.log('  (nothing at all)');

    const blob = entries.map((e) => `${e.where} ${e.key} ${e.value}`).join('\n');
    const hits = [];
    if (blob.includes(CANARY)) hits.push('the pasted stream key');
    // The whole key, and also the distinctive middle of it, in case something stored a slice.
    if (blob.includes(CANARY.slice(5, 30))) hits.push('a substring of the pasted stream key');
    for (const name of ['accessToken', 'refreshToken', 'access_token', 'refresh_token', 'client_secret']) {
      if (blob.includes(name)) hits.push(`the field name ${name}`);
    }
    // A persisted destination may legitimately carry an `ingest` object. It must never carry
    // a NON-EMPTY streamKey, passphrase or streamId inside it.
    for (const field of ['streamKey', 'passphrase', 'streamId', 'stream_key']) {
      const populated = new RegExp(`"${field}"\s*:\s*"[^"]+"`).exec(blob);
      if (populated) hits.push(`a populated ${field} (${populated[0].slice(0, 40)}…)`);
    }
    // And print the persisted destination list in full: it is the one entry that COULD hold a
    // credential, so truncating it would hide the thing this script exists to look at.
    for (const entry of entries) {
      if (entry.key === 'livetap.destinations') {
        console.log(`
  livetap.destinations, in full:
      ${entry.value}`);
      }
    }

    // The tail IS allowed: "Saved · ends in 1234" is a deliberate four-character display.
    const tail = CANARY.slice(-4);
    console.log(`\n  (the four-character tail "${tail}" is permitted by design; the whole key is not)`);

    if (!pastedKey) fail('never reached the paste step, so a clean dump proves nothing');
    if (hits.length > 0) fail(`a credential reached browser storage: ${hits.join(', ')}`);
    else console.log('\nPASS  no stream key, no token and no secret field name in any web store.');

    await context.close();
  } catch (error) {
    fail(`the driver could not complete: ${String(error && error.message ? error.message : error)}`);
    if (!pastedKey) console.error('      (it never reached the paste step, so nothing was proven)');
  } finally {
    await browser.close();
    preview.kill();
  }
}

await main();
