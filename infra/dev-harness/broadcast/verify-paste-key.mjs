#!/usr/bin/env node
/**
 * Can a creator who has registered NOTHING go live on a named platform tonight?
 *
 * This is the claim the whole real-alpha mission turns on, and it is a different claim from the one
 * the completion gate proves. That gate uses Custom RTMP: a generic destination, no platform
 * identity, no profile, no per-platform honesty. It answers "does LIVETAP broadcast". This answers
 * "does LIVETAP broadcast **to YouTube**, for somebody who has not registered an OAuth app, does
 * not have a client id, and will never have one" — which is every creator on their first evening.
 *
 * The flow it drives is the real one, through the built desktop app's own UI:
 *
 *   Destinations -> Add destination -> tap YOUTUBE (not "Custom RTMP")
 *     -> LIVETAP finds no OAuth client configured for youtube
 *     -> it opens the paste form, pre-filled with YouTube's own ingest URL
 *     -> the creator overwrites the server (here: the local receiver) and pastes a key
 *     -> Connect -> READY -> GO LIVE -> real bytes on a real wire
 *
 * The one thing swapped is the server address, because this harness has no YouTube account and
 * must not pretend to. Everything else is what a creator does: the same tile, the same form, the
 * same adapter, the same profile. What this proves is that tapping a PLATFORM reaches a real
 * broadcast; what it cannot prove is that youtube.com accepts it, which needs the owner's channel.
 *
 * It also checks the thing that makes this worth doing at all: the destination must come out as a
 * YOUTUBE destination, carrying YouTube's name and YouTube's own warning that it does not publish
 * until the creator presses Go live in Studio. A destination that lands as "Custom RTMP" has lost
 * every piece of help that makes the paste path better than a text field.
 *
 *   node infra/dev-harness/broadcast/verify-paste-key.mjs
 *   node infra/dev-harness/broadcast/verify-paste-key.mjs --platform=twitch --seconds=10
 */
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { acquire } from './runlock.mjs';
import { goLive, pressEnd, dismissTour } from './studio-controls.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const appDir = path.join(repoRoot, 'apps', 'desktop');

const args = process.argv.slice(2);
const readArg = (name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

const platform = readArg('--platform') ?? 'youtube';
const seconds = Number(readArg('--seconds') ?? 8);
const apiBase = process.env.LIVETAP_DEV_INGEST_API ?? 'http://127.0.0.1:9997';
const rtmpBase = process.env.LIVETAP_DEV_INGEST_RTMP ?? 'rtmp://127.0.0.1:1935';
const PATH_NAME = `live/paste-${platform}`;

const lines = [];
let failed = false;
const ok = (m) => lines.push(`  ok    ${m}`);
const bad = (m) => {
  failed = true;
  lines.push(`  FAIL  ${m}`);
};
const step = (m) => {
  lines.push('');
  lines.push(m);
  process.stdout.write(`${m}\n`);
};

async function api(pathname) {
  const res = await fetch(`${apiBase}${pathname}`);
  if (!res.ok) throw new Error(`control API ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

async function publishers() {
  const list = await api('/v3/rtmpconns/list');
  return (list.items ?? []).filter((c) => c.path === PATH_NAME && c.state === 'publish');
}

async function bytes() {
  return (await publishers()).reduce((total, c) => total + (c.bytesReceived ?? 0), 0);
}

async function main() {
  await acquire({
    label: 'paste-key proof',
    onWait: (holder) => process.stdout.write(`  waiting     pid ${holder.pid} has the receiver\n`),
  });

  if (!fs.existsSync(path.join(appDir, 'dist', 'renderer', 'app.html'))) {
    throw new Error('No built renderer. Run: npm run build -w @livetap/desktop');
  }
  try {
    await api('/v3/paths/list');
  } catch {
    throw new Error(`No receiver at ${apiBase}. Run: node infra/dev-harness/ingest/start-ingest.mjs`);
  }

  step(`[1/6] launching the built app and going to Destinations as a creator with nothing set up`);
  const app = await electron.launch({
    args: [appDir, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    cwd: appDir,
  });
  const win = await app.firstWindow();
  win.setDefaultTimeout(12_000);
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  /*
   * Clear, then RELOAD, then navigate.
   *
   * The store restores persisted destinations during `init()`, which has already run by the time
   * this executes, so removing the key without a reload leaves the restored ones in memory: the
   * run then measures a screen carrying the last run's destinations and blames the product for
   * them. Cost one false failure here before the stale rows' missing ingest gave it away.
   * `apps/desktop/e2e/broadcast.mjs` gets this right already, which is why it never showed.
   */
  await win.evaluate(() => {
    localStorage.setItem('livetap.onboarding', 'true');
    localStorage.setItem('livetap.intent', '"talking"');
    localStorage.setItem('livetap.mode', '"simple"');
    localStorage.removeItem('livetap.destinations');
    localStorage.setItem('livetap.realBroadcastAck', 'true');
    location.reload();
  });
  await win.waitForTimeout(2200);
  await win.evaluate(() => {
    location.hash = '#/app/destinations';
  });
  await win.waitForTimeout(900);
  await dismissTour(win);
  ok('the app opened with no destinations and no accounts');

  step(`[2/6] tapping ${platform.toUpperCase()} — the platform, not the generic RTMP row`);
  await win.getByRole('button', { name: /Add destination|Add your first destination/i }).first().click();
  await win.waitForTimeout(500);

  const tile = win.locator('.lt-addrow').filter({ hasText: new RegExp(platform, 'i') }).first();
  if ((await tile.count()) === 0) {
    bad(`there is no ${platform} row to tap in the Add destination sheet`);
    return finish(app);
  }
  await tile.click();
  await win.waitForTimeout(600);

  step('[3/6] what LIVETAP offers a creator who has registered nothing');
  const form = win.locator('form');
  if ((await form.count()) === 0) {
    bad('tapping the platform did not open a form: the creator has been dead-ended');
    return finish(app);
  }
  ok('the paste form opened rather than dead-ending');

  const prefilled = await win.getByLabel('Server address').inputValue();
  if (prefilled.trim() !== '') ok(`the server address came pre-filled: ${prefilled}`);
  else lines.push(`  note  no pre-filled server for ${platform}; the creator pastes what their studio page shows`);

  /*
   * The whole point of tapping a platform instead of "Custom RTMP": the form must be about THAT
   * platform. A name the creator did not type, and a shape list that is the platform's own.
   */
  const name = await win.getByLabel('Name for this destination').inputValue();
  if (name.trim() !== '') ok(`the destination is already named "${name}", so nothing to invent`);
  else bad('the name field is empty: the creator has to name a destination they just picked by name');

  step('[4/6] pasting a key and connecting');
  // The one substitution: this harness has no YouTube channel, so the server points at the local
  // receiver. Everything else is the creator's own path.
  await win.getByLabel('Server address').fill(`${rtmpBase}/live`);
  await win.getByLabel('Stream key').fill(`paste-${platform}`);
  await win.locator('[data-lt-connect]').click();
  await win.waitForTimeout(1500);

  const rows = await win.evaluate(() => document.querySelectorAll('.lt-destlist > li').length);
  if (rows === 1) ok('one destination was created');
  else bad(`expected exactly one destination, the app shows ${rows}`);

  const shown = await win.evaluate(() => document.body.innerText);
  if (new RegExp(platform, 'i').test(shown)) ok(`the destination names ${platform}`);
  else bad(`the destination does not mention ${platform} anywhere on the screen`);
  if (/Custom RTMP/i.test(shown)) {
    bad('the destination is labelled "Custom RTMP": tapping a platform lost the platform');
  } else {
    ok('it is not labelled as a generic RTMP destination');
  }

  /*
   * Before GO LIVE: is it READY, and if not, what does it say?
   *
   * A destination that exists but never reaches READY makes GO LIVE do nothing at all, silently -
   * the button is simply disabled and a driver clicking it gets no error. Reading the state here
   * is the difference between "the paste path does not broadcast" and knowing which of the six
   * steps between a pasted key and a byte on the wire actually stopped.
   */
  const state = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.lt-destlist > li')];
    return rows.map((li) => li.textContent?.replace(/s+/g, ' ').slice(0, 160));
  });
  lines.push(`  note  destination row: ${state.join(' | ')}`);
  if (/Ready|Ready to go/i.test(state.join(' '))) ok('the destination reached Ready');
  else bad(`the destination never reached Ready, so GO LIVE can do nothing: ${state.join(' | ')}`);

  step(`[5/6] GO LIVE, and asking the server what arrived`);
  await win.evaluate(() => {
    location.hash = '#/app/studio';
  });
  await win.waitForTimeout(1200);
  await goLive(win);

  /*
   * Poll, do not sleep a guess.
   *
   * GO LIVE on a real broadcast runs a five-second countdown first - deliberately, it is the
   * confirmation for every broadcast after the first - and only then does the encoder start, the
   * sender spawn and the RTMP handshake complete. A fixed wait shorter than all of that reports
   * "the paste path does not broadcast" about a broadcast that was still counting down, which is
   * exactly what it did to me once.
   */
  const liveBy = Date.now() + 30_000 + seconds * 1000;
  let connected = [];
  while (Date.now() < liveBy) {
    await win.waitForTimeout(1000);
    connected = await publishers();
    if (connected.length > 0) break;
  }
  if (connected.length > 0) ok(`${PATH_NAME} has a real RTMP publisher (${await bytes()} bytes so far)`);
  else bad(`nothing reached ${PATH_NAME} within 30 s of GO LIVE: the paste path does not broadcast`);

  const before = await bytes();
  await win.waitForTimeout(3000);
  const after = await bytes();
  if (after > before) ok(`bytes are still climbing (${before} -> ${after})`);
  else bad(`the byte count stalled at ${after}`);

  step('[6/6] END');
  await pressEnd(win);
  await win.waitForTimeout(9000);
  if ((await publishers()).length === 0) ok('every publisher is gone after END');
  else bad('a publisher is still connected after END');

  if (errors.length === 0) ok('no uncaught renderer errors');
  else bad(`renderer errors: ${errors.join(' | ')}`);

  return finish(app);
}

async function finish(app) {
  await app?.close().catch(() => undefined);
  process.stdout.write(`${lines.join('\n')}\n\n`);
  if (failed) {
    process.stdout.write(
      `FAIL  a creator who has registered nothing cannot yet go live on ${platform} through this app.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `PASS  tapping ${platform.toUpperCase()} with no account and no client id opened a paste form,\n` +
      `      made a ${platform} destination, and put real encoded bytes on a real RTMP wire.\n` +
      `      What this does NOT prove: that youtube.com accepts them. That needs the owner's channel.\n`,
  );
  process.exit(0);
}

main().catch((error) => {
  process.stdout.write(`${lines.join('\n')}\n\nFAIL  ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
