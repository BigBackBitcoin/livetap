#!/usr/bin/env node
/**
 * Verify a DEPLOYED LIVETAP relay, mechanically, without broadcasting anything.
 *
 *   LIVETAP_RELAY_TOKEN=<the publish password> node infra/relay/verify-relay.mjs https://relay.example.com
 *
 * Exit 0 when the relay is ready for the web app to point at, 1 with the reason when it is not.
 *
 * WHY THIS EXISTS. The relay's own unit tests (`relay-session.test.mjs`) prove the session API's
 * logic against a fake MediaMTX. They cannot tell you whether the thing you just deployed is
 * reachable, has a working certificate, or actually talks to a real MediaMTX. That is a different
 * question and it is the one that is open the moment a relay exists: "it passed its tests" and
 * "it answers on the internet" are not the same claim.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. The fan-out itself -- that a session produced N ffmpeg
 * forward targets with N distinct stream keys -- is not observable from outside, because the
 * MediaMTX Control API is private by design and must never be exposed (README, "Never expose the
 * Control API"). Asserting it from here would require opening the hole this architecture exists to
 * keep shut. That behaviour is covered where it can be seen: `relay-session.test.mjs` asserts
 * `buildHookCommand` preserves every destination and does not deduplicate two accounts that share
 * an ingest URL, and the same thing can be confirmed on a host with direct Control API access.
 *
 * NOTHING SECRET IS PRINTED. The token is read from the environment, sent as a Bearer header, and
 * never echoed; `whipAuthorization` is reported as present or absent, never as a value.
 */
import { argv, env, exit } from 'node:process';

const args = argv.slice(2);
/*
 * `--local` NARROWS the claim; it does not switch a check off.
 *
 * The https and public-address rules are the two that matter most for a production relay, so
 * they cannot be waived for one. They also make this script impossible to exercise against a
 * relay on a developer's own machine, which would leave its session checks shipped and never
 * run -- the exact failure this repository keeps finding. With `--local` the address rules are
 * RECORDED as waived rather than passed, and the run can never call a relay production-ready.
 */
const local = args.includes('--local');
const base = (args.find((a) => !a.startsWith('--')) ?? '').trim().replace(/\/+$/, '');
const token = (env.LIVETAP_RELAY_TOKEN ?? '').trim();

const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });

if (!base) {
  process.stdout.write('usage: LIVETAP_RELAY_TOKEN=<token> node infra/relay/verify-relay.mjs https://relay.example.com\n');
  exit(1);
}

/*
 * A browser will refuse to publish WebRTC from a secure page to an insecure relay, and a private
 * address is not reachable from a visitor's machine at all. Both fail at GO LIVE, in front of a
 * creator, rather than here -- so they fail here instead.
 */
let url;
try {
  url = new URL(base);
} catch {
  process.stdout.write(`FAIL  ${base} is not a URL.\n`);
  exit(1);
}
if (local) {
  results.push({ label: 'ADDRESS RULES WAIVED by --local: this run cannot certify a production relay', ok: true, detail: url.host });
} else {
  check('the relay is addressed over https', url.protocol === 'https:', url.protocol);
check(
  'the relay is not a loopback or private address',
  !/^(localhost$|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname),
  url.hostname,
);
}

const headers = token ? { authorization: `Bearer ${token}` } : {};
const timeout = (ms) => AbortSignal.timeout(ms);

/* 1. Reachability and TLS. A fetch over https that resolves at all has validated the chain. */
let health;
try {
  health = await fetch(`${base}/healthz`, { signal: timeout(15_000) });
  check('the relay answers /healthz', health.ok, `HTTP ${health.status}`);
  /* Only meaningful over https. Saying "certificate valid" about an http request is a cheerful
     line about something that was never looked at, which is the failure this file is full of
     warnings about. */
  if (!local) check('its TLS certificate is valid for this name', true, 'the https request completed');
  const body = await health.json().catch(() => ({}));
  check('/healthz reports ok', body.ok === true, JSON.stringify(body).slice(0, 80));
} catch (err) {
  check('the relay answers /healthz', false, err instanceof Error ? err.message : String(err));
  report();
}

/* 2. The session API, with the shape the web app actually sends. Two of these destinations share
      an ingest URL with different keys, which is the multi-account case and must be accepted. */
const DESTINATIONS = [
  { protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2', streamKey: 'verify-key-a', aspectRatio: '16:9' },
  { protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2', streamKey: 'verify-key-b', aspectRatio: '16:9' },
  { protocol: 'rtmp', url: 'rtmp://live.twitch.tv/app', streamKey: 'verify-key-c', aspectRatio: '16:9' },
];

let session = null;
try {
  const created = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ destinations: DESTINATIONS }),
    signal: timeout(20_000),
  });
  const body = await created.json().catch(() => ({}));
  check(
    'it creates a session for three destinations, two sharing one ingest URL',
    created.status === 201,
    created.status === 201 ? 'HTTP 201' : `HTTP ${created.status} ${JSON.stringify(body).slice(0, 120)}`,
  );
  if (created.status === 201) {
    session = body;
    check('the session carries a WHIP URL', typeof body.whipUrl === 'string' && body.whipUrl.length > 0);
    if (!local) check(
      'the WHIP URL is https, so a secure page can publish to it',
      typeof body.whipUrl === 'string' && body.whipUrl.startsWith('https://'),
      typeof body.whipUrl === 'string' ? new URL(body.whipUrl).protocol : 'absent',
    );
    if (!local) check(
      'the WHIP URL points at this relay, not at a placeholder',
      typeof body.whipUrl === 'string' && new URL(body.whipUrl).hostname === url.hostname,
      typeof body.whipUrl === 'string' ? new URL(body.whipUrl).hostname : 'absent',
    );
    /* Presence only. This is a credential and it is never printed. */
    check('the session carries a publish credential', typeof body.whipAuthorization === 'string' && body.whipAuthorization.length > 0);
    check('the session carries an RTMP ingest, so a phone can publish too', typeof body.rtmpUrl === 'string' && body.rtmpUrl.length > 0);
  }
} catch (err) {
  check('it creates a session', false, err instanceof Error ? err.message : String(err));
}

/* 3. Teardown. A relay that creates sessions and cannot delete them leaks a forwarding path per
      broadcast, each one holding a creator's stream keys. */
if (session?.sessionId) {
  try {
    const removed = await fetch(`${base}/sessions/${encodeURIComponent(session.sessionId)}`, {
      method: 'DELETE',
      headers,
      signal: timeout(15_000),
    });
    check('it deletes the session again', removed.status === 204, `HTTP ${removed.status}`);
  } catch (err) {
    check('it deletes the session again', false, err instanceof Error ? err.message : String(err));
  }
}

/* 4. The endpoint is not open. Anyone who can POST here can make this relay forward to any
      destination they choose, on the owner's bandwidth and address. */
try {
  const open = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ destinations: DESTINATIONS }),
    signal: timeout(15_000),
  });
  check(
    'it refuses an unauthenticated session, so the relay is not an open forwarder',
    open.status === 401 || open.status === 403,
    `HTTP ${open.status}`,
  );
} catch (err) {
  check('it refuses an unauthenticated session', false, err instanceof Error ? err.message : String(err));
}

report();

function report() {
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${r.detail ? `  (${r.detail})` : ''}\n`);
  }
  process.stdout.write('\n');
  if (failed.length > 0) {
    process.stdout.write(`FAIL  ${failed.length} of ${results.length} checks failed. Do not point the web app at this relay yet.\n`);
    exit(1);
  }
  if (local) {
    process.stdout.write(
      `PASS  ${results.length} checks against a LOCAL relay. The address rules were waived, so this says
` +
        `      the session API behaves correctly. It does NOT say a relay is production-ready.
`,
    );
    exit(0);
  }
  process.stdout.write(
    `PASS  ${results.length} checks. This relay is ready; set VITE_LIVETAP_RELAY_URL=${base} and rebuild the web app.\n` +
      `      NOTE: this proves the relay ANSWERS correctly. It does not prove a platform accepted a stream --\n` +
      `      that is the owner's own broadcast test, and nothing here logs into anyone's account.\n`,
  );
  exit(0);
}
