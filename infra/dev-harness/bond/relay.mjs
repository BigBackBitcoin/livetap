#!/usr/bin/env node
/**
 * A runnable LIVETAP Bond relay.
 *
 * This is the relay as a process rather than as a class: it listens on a UDP port, accepts
 * authenticated Bond sessions, reassembles each one into a single MPEG-TS stream, and pushes that
 * stream to an RTMP destination with `ffmpeg -c copy`.
 *
 * `-c copy` and not a re-encode, deliberately. The device already produced H.264 and AAC; decoding
 * and re-encoding them would cost CPU per destination, add latency and lose quality in exchange for
 * nothing at all. The relay's job is to put the stream back together and hand it on, not to touch
 * the media.
 *
 * The destination is per-session and comes from the session token, which is what keeps the relay
 * from becoming a destination monolith (mission section 17): the token says where this broadcast
 * may go, the relay routes it there, and a destination that fails takes down one ffmpeg child and
 * nothing else.
 *
 *   node infra/dev-harness/bond/relay.mjs --port=9500 --rtmp=rtmp://127.0.0.1:1935/live/bond
 *
 * Keys: generated on start and written to --keys, so a client in another process can read the
 * relay's public key and the broker's private key. That arrangement is fine for a dev harness and
 * would be wrong in production, where the broker is a separate service; it is called out here so
 * nobody copies it by accident.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BondRelay } from '../../../packages/bond/src/net/BondRelay.ts';
import { exportPublicKey, generateStaticKeyPair } from '../../../packages/bond/src/wire/secure.ts';
import { resolveFfmpeg } from './ffmpeg.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const port = Number(arg('--port', '9500'));
const rtmp = arg('--rtmp', 'rtmp://127.0.0.1:1935/live/bond');
const keysPath = arg('--keys', path.join(here, 'relay-keys.json'));
const quiet = args.includes('--quiet');

const log = (...parts) => {
  if (!quiet) process.stdout.write(`[bond-relay] ${parts.join(' ')}\n`);
};

const relayStatic = generateStaticKeyPair();
const broker = generateKeyPairSync('ed25519');

writeFileSync(
  keysPath,
  JSON.stringify(
    {
      note: 'DEV HARNESS ONLY. In production the broker is a separate service and its private key never sits beside the relay.',
      relayStaticPublic: exportPublicKey(relayStatic.publicKey).toString('base64'),
      brokerPrivate: broker.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      brokerPublic: broker.publicKey.export({ type: 'spki', format: 'pem' }),
      port,
      rtmp,
    },
    null,
    2,
  ),
);

const ffmpeg = resolveFfmpeg();
const relay = new BondRelay({ port, address: '127.0.0.1', relayStatic, brokerPublicKey: broker.publicKey });

/** One ffmpeg child per session. A destination failure is one child, never the session. */
const senders = new Map();

relay.on('session', ({ sessionId, token, stream }) => {
  const target = token.destinations?.[0] ?? rtmp;
  log(`session ${sessionId} accepted, forwarding to ${target.replace(/\/[^/]*$/, '/***')}`);

  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel', 'warning',
      // The input is a live TS stream arriving on stdin. `-re` would be wrong: it is already real
      // time, and pacing it again would add a second's worth of drift per minute.
      '-f', 'mpegts',
      '-i', 'pipe:0',
      '-c', 'copy',
      '-f', 'flv',
      target,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );

  senders.set(sessionId, child);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    const line = text.trim();
    if (line) log(`ffmpeg[${sessionId}] ${line.split('\n').slice(-1)[0]}`);
  });
  child.on('close', (code) => {
    log(`sender for ${sessionId} exited (${code})`);
    senders.delete(sessionId);
  });

  stream.pipe(child.stdin);
  // A destination that dies must not take the Bond session with it: the session keeps
  // reassembling, and a future version can reconnect the sender underneath it.
  child.stdin.on('error', () => undefined);
});

relay.on('sessionEnded', ({ sessionId, stats }) => {
  log(
    `session ${sessionId} ended: ${stats.chunksOut} chunks out, ` +
      `${stats.reassembly.lost} lost, ${stats.reassembly.duplicates} duplicate, ` +
      `peak depth ${stats.reassembly.peakDepth}, max held ${stats.reassembly.maxHeldMs} ms`,
  );
  const child = senders.get(sessionId);
  if (child) {
    child.stdin.end();
    senders.delete(sessionId);
  }
});

relay.on('pathJoined', ({ sessionId, pathId, from }) => {
  log(`session ${sessionId}: path ${pathId} joined from ${from}`);
});

const refusals = new Map();
relay.on('refused', ({ reason }) => {
  // Counted rather than logged per datagram: a flood of junk at a public port must not become a
  // flood of log lines, which is a denial-of-service amplifier with extra steps.
  refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
});
setInterval(() => {
  if (refusals.size === 0) return;
  log(`refused: ${[...refusals].map(([reason, count]) => `${count}x ${reason}`).join(', ')}`);
  refusals.clear();
}, 5000).unref();

relay.on('error', (error) => log(`ERROR ${error.message}`));

const bound = await relay.listen();
log(`listening on udp://127.0.0.1:${bound}`);
log(`keys written to ${keysPath}`);
process.stdout.write(`BOND_RELAY_READY ${bound}\n`);

const shutdown = async () => {
  log('shutting down');
  for (const child of senders.values()) child.stdin.end();
  await relay.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
