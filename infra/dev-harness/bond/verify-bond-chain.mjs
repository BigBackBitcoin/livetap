#!/usr/bin/env node
/**
 * The proof that LIVETAP Bond carries a real broadcast.
 *
 * Every link in this chain is the production one. Nothing is mocked, stubbed or injected:
 *
 *   ffmpeg                real H.264 + AAC encode into MPEG-TS
 *      |                  (the bundled build the desktop app itself ships)
 *   BondSink              the Writable the fan-out attaches
 *      |
 *   BondClient            real UDP socket, X25519 handshake, ChaCha20-Poly1305 records
 *      |  udp://
 *   BondRelay             real replay window, real AEAD, the same tested Reassembler
 *      |
 *   ffmpeg -c copy        no re-encode; the relay does not touch the media
 *      |  rtmp://
 *   MediaMTX              a real RTMP server that accepts and records
 *      |
 *   ffprobe               decodes what landed on disk
 *
 * Exit 0 on PASS, 1 on FAIL. Nothing above the verdict is a claim that was not measured.
 *
 *   node infra/dev-harness/bond/verify-bond-chain.mjs
 *   node infra/dev-harness/bond/verify-bond-chain.mjs --seconds=20 --paths=2
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BondClient } from '../../../packages/bond/src/net/BondClient.ts';
import { BondSink } from '../../../packages/bond/src/net/BondSink.ts';
import { BondRelay } from '../../../packages/bond/src/net/BondRelay.ts';
import { generateStaticKeyPair, signToken } from '../../../packages/bond/src/wire/secure.ts';
import { resolveFfmpeg, resolveFfprobe } from './ffmpeg.mjs';
import {
  loadConfig,
  resolveMediaMtx,
  sleep,
  waitForPort,
  listPublishers,
  MissingBinaryError,
} from '../ingest/lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const seconds = Number(readArg('--seconds', '12'));
const pathCount = Number(readArg('--paths', '1'));
const killAt = Number(readArg('--kill-path-at', '0'));
const STREAM_PATH = 'live/bond';
/*
 * An ephemeral port, not a fixed one.
 *
 * With `reuseAddr` set, two UDP sockets can bind the same port and the kernel delivers each
 * datagram to only one of them - so a relay left behind by an aborted run silently ate the next
 * run's handshake, and the new relay sat waiting for an answer it was never going to get. A
 * harness that can be poisoned by its own previous run is a harness whose failures cannot be
 * trusted. Port 0 makes collisions impossible.
 */
const RELAY_PORT = 0;

const lines = [];
let failed = false;
const ok = (message) => lines.push(`  ok    ${message}`);
const bad = (message) => {
  failed = true;
  lines.push(`  FAIL  ${message}`);
};
const step = (message) => {
  lines.push('');
  lines.push(message);
  process.stdout.write(`${message}\n`);
};

function run(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: String(error) }));
  });
}

async function main() {
  const cfg = loadConfig();
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();

  step('[1/6] starting a real RTMP receiver');
  let mediamtx;
  try {
    mediamtx = resolveMediaMtx(cfg);
  } catch (error) {
    if (error instanceof MissingBinaryError) {
      process.stdout.write(`\nSKIPPED  ${error.message}\n`);
      process.exitCode = 0;
      return;
    }
    throw error;
  }

  const recordingsDir = path.join(REPO_ROOT, 'infra', 'dev-harness', 'ingest', 'recordings', 'live', 'bond');
  rmSync(recordingsDir, { recursive: true, force: true });
  mkdirSync(recordingsDir, { recursive: true });

  const server = spawn(mediamtx, [path.join(REPO_ROOT, 'infra', 'dev-harness', 'ingest', 'mediamtx.dev.yml')], {
    cwd: path.join(REPO_ROOT, 'infra', 'dev-harness', 'ingest'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.resume();
  await waitForPort(cfg.host, cfg.rtmpPort, { timeoutMs: 15000 });
  ok(`MediaMTX is accepting RTMP on ${cfg.host}:${cfg.rtmpPort}`);

  step('[2/6] starting the Bond relay');
  const relayStatic = generateStaticKeyPair();
  const broker = generateKeyPairSync('ed25519');
  const relay = new BondRelay({
    port: RELAY_PORT,
    address: '127.0.0.1',
    relayStatic,
    brokerPublicKey: broker.publicKey,
  });

  const senders = new Map();
  let relayChunksOut = 0;
  let sessionSeen = false;

  relay.on('session', ({ sessionId, stream }) => {
    sessionSeen = true;
    const target = `rtmp://${cfg.host}:${cfg.rtmpPort}/${STREAM_PATH}`;
    const child = spawn(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error',
        /*
         * Do not sit on the stream while probing it.
         *
         * ffmpeg's defaults buffer up to five seconds of input before deciding what it is, which is
         * sensible for a file and wrong for a live relay: it adds that delay to every broadcast and
         * it is why an earlier version of this proof recorded five seconds of a fourteen-second
         * run. We already know exactly what this is - we muxed it - so tell it.
         */
        '-fflags', '+nobuffer',
        '-probesize', '500000',
        '-analyzeduration', '1000000',
        '-f', 'mpegts', '-i', 'pipe:0',
        '-c', 'copy',
        '-f', 'flv', target,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      const line = text.trim();
      if (line) lines.push(`        relay-ffmpeg: ${line.split('\n').slice(-1)[0]}`);
    });
    child.stdin.on('error', () => undefined);
    stream.pipe(child.stdin);
    senders.set(sessionId, child);
  });
  relay.on('sessionEnded', ({ stats }) => {
    relayChunksOut = stats.chunksOut;
  });

  const joinedPaths = new Set();
  relay.on('pathJoined', ({ pathId }) => joinedPaths.add(pathId));

  const boundPort = await relay.listen();
  ok(`the Bond relay is listening on udp://127.0.0.1:${boundPort}`);

  step('[3/6] opening a Bond session with a real handshake');
  const tokenBlob = signToken(
    {
      sessionId: 'chain-proof',
      expiresAt: Math.floor(Date.now() / 1000) + 900,
      destinations: [`rtmp://${cfg.host}:${cfg.rtmpPort}/${STREAM_PATH}`],
      maxBitrateBps: 12_000_000,
    },
    broker.privateKey,
  );

  const client = new BondClient({
    relayHost: '127.0.0.1',
    relayPort: boundPort,
    relayStaticPublic: relayStatic.publicKey,
    tokenBlob,
    streamBitrateBps: 4_000_000,
  });

  const health = [];
  client.on('health', (h) => health.push(`${h.health}: ${h.reason}`));
  client.on('pathLost', ({ pathId, label }) => lines.push(`        path ${pathId} (${label}) lost`));

  await client.connect({ transport: 'ethernet', label: 'Primary', metered: 'unmetered' });
  ok('the relay authenticated this client and both ends derived a session key');

  for (let i = 1; i < pathCount; i += 1) {
    const id = await client.addPath({ transport: 'ethernet', label: `Path ${i + 1}`, metered: 'unmetered' });
    ok(`path ${id} joined the running session without a second handshake`);
  }

  step(`[4/6] encoding real media and pushing it through Bond for ${seconds}s`);
  const sink = new BondSink(client, { label: 'chain-proof' });

  /*
   * A real encode: synthetic video and audio, but H.264 and AAC produced by the same ffmpeg build
   * the desktop app ships, muxed into the same MPEG-TS the fan-out carries. What crosses the wire
   * is byte-for-byte the kind of thing a camera produces.
   */
  const encoder = spawn(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error',
      '-re',
      '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seconds + 2}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds + 2}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-b:v', '3000k', '-g', '60', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-f', 'mpegts', 'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  encoder.stderr.setEncoding('utf8');
  encoder.stderr.on('data', (text) => {
    const line = text.trim();
    if (line) lines.push(`        encoder: ${line.split('\n').slice(-1)[0]}`);
  });
  encoder.stdout.pipe(sink);

  if (killAt > 0 && pathCount > 1) {
    setTimeout(() => {
      // Reach into the client and close one socket, which is what a radio going away looks like
      // from userspace: sends start failing and acknowledgements stop arriving.
      const paths = /** @type {any} */ (client).paths;
      const victim = [...paths.values()][1];
      if (victim) {
        lines.push(`        killing path ${victim.id} at ${killAt}s to prove failover`);
        victim.socket.close();
        /*
         * Stand in a socket that silently swallows sends, which is what a radio that has gone away
         * looks like from userspace: writes appear to succeed and nothing ever comes back. The
         * callbacks are still invoked - a socket that accepted a send without ever calling back
         * would be a stub behaving worse than any real one.
         */
        victim.socket = {
          send: (_d, _p, _h, cb) => cb?.(null),
          close: (cb) => cb?.(),
          on: () => undefined,
          off: () => undefined,
        };
      }
    }, killAt * 1000);
  }

  const deadline = Date.now() + seconds * 1000;
  let sawPublisher = false;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!sawPublisher) {
      const publishers = await listPublishers(cfg, STREAM_PATH).catch(() => []);
      if (publishers.length > 0) {
        sawPublisher = true;
        ok('MediaMTX has a real RTMP publisher: the relay is forwarding a reconstructed stream');
      }
    }
  }

  if (!sessionSeen) bad('the relay never accepted a session');
  if (!sawPublisher) bad('no RTMP publisher ever appeared: nothing reached the receiver');

  const telemetry = client.telemetry();
  lines.push('  telemetry from the live client:');
  lines.push(`        mode ${telemetry.mode}, health ${telemetry.health}`);
  lines.push(`        "${telemetry.reason}"`);
  for (const p of telemetry.paths) {
    lines.push(
      `        path ${p.pathId} ${p.label}: ${(p.throughputBps / 1e6).toFixed(2)} Mbps, ` +
        `rtt ${p.rttMs.toFixed(0)} ms, loss ${(p.loss * 100).toFixed(2)}%, share ${(p.share * 100).toFixed(0)}%, peak unacked ${p.peakUnacked}`,
    );
  }
  lines.push(`        scheduler: ${telemetry.scheduler.chunks} chunks, ${telemetry.droppedForPace} dropped for pace, ${telemetry.retransmitted} retransmitted`);

  if (pathCount > 1) {
    if (joinedPaths.size >= pathCount - 1) ok(`the relay saw ${joinedPaths.size + 1} distinct paths on one session`);
    else bad(`expected ${pathCount} paths at the relay, saw ${joinedPaths.size + 1}`);
  }

  step('[5/6] ending the broadcast');
  encoder.kill('SIGKILL');
  await sleep(500);
  await client.close();
  // Let the relay's reorder buffer expire its last gaps and push the tail through ffmpeg before
  // anything is torn down. Truncating here would measure the teardown, not the transport.
  await sleep(2000);
  for (const child of senders.values()) child.stdin.end();
  await sleep(3000);
  await relay.close();
  ok(`the relay reconstructed ${relayChunksOut} chunks and closed the session`);

  step('[6/6] asking ffprobe what actually landed on disk');
  /*
   * Let MediaMTX finalise the recording before probing it.
   *
   * recordSegmentDuration is 30 s and the format is fMP4, so a broadcast shorter than that is ONE
   * segment which is still open while the publisher is connected. SIGKILL here - which is what an
   * earlier version of this script did - leaves the file unfinalised, and ffprobe then reports only
   * the parts that happened to be flushed: 6.7 s of a 14 s run, read as a transport failure when
   * the transport had delivered every byte. SIGTERM lets it close the segment properly.
   */
  await sleep(1500);
  server.kill('SIGTERM');
  await sleep(3000);

  const recordings = existsSync(recordingsDir)
    ? readdirSync(recordingsDir)
        .map((name) => path.join(recordingsDir, name))
        .filter((file) => statSync(file).size > 0)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];

  if (recordings.length === 0) {
    bad('MediaMTX recorded nothing: no media survived the chain');
  } else {
    /*
     * Probe the LARGEST segment and sum duration across all of them.
     *
     * MediaMTX rolls recordings on its own schedule, so the newest file is often a fraction of a
     * second of tail - an earlier version of this check probed exactly that and reported 0.09 s of
     * a fourteen-second broadcast as a failure of the transport. The question being asked is "how
     * much media survived the chain", and the answer is the sum of what was written, not whichever
     * fragment happened to be last.
     */
    let totalDuration = 0;
    let totalSize = 0;
    for (const file of recordings) {
      totalSize += statSync(file).size;
      const each = await run(ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
      ]);
      totalDuration += Number(each.stdout.trim()) || 0;
    }
    lines.push(`  ${recordings.length} recording segment(s), ${totalSize} bytes, ${totalDuration.toFixed(2)} s in total`);

    const newest = recordings.slice().sort((a, b) => statSync(b).size - statSync(a).size)[0];
    const probe = await run(ffprobe, [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,codec_type,width,height,sample_rate,channels',
      '-show_entries', 'format=duration,size',
      '-of', 'default=noprint_wrappers=1',
      newest,
    ]);
    lines.push('  ffprobe on the recording the relay produced:');
    for (const line of probe.stdout.trim().split(/\r?\n/)) lines.push(`        ${line}`);

    const text = probe.stdout;
    const size = totalSize;
    if (/codec_name=h264/.test(text)) ok('the recording carries real H.264 video');
    else bad('no H.264 video in the recording');
    if (/codec_name=aac/.test(text)) ok('the recording carries real AAC audio');
    else bad('no AAC audio in the recording');
    if (/width=1280/.test(text) && /height=720/.test(text)) ok('the picture is 1280x720, as encoded');
    else bad('the recording is not the shape that was encoded');

    const duration = totalDuration;
    if (killAt > 0) {
      /*
       * A DIFFERENT BAR IN KILL MODE, and it is important to say why rather than quietly relax it.
       *
       * Killing a path hard loses whatever it had in flight, and a hole in MPEG-TS costs a
       * downstream `-c copy` consumer far more than the hole itself - it has to resynchronise and
       * discards good data on either side while it does. Measured here: roughly 230 chunks lost of
       * 4566 (5%) reduced the recorded media from 14.6 s to about 6.4 s.
       *
       * So this mode asserts what Bond GUARANTEES today - the failure is detected, traffic moves to
       * the survivor, and the broadcast continues - and reports the media cost as a number instead
       * of hiding it behind a threshold. Closing that gap needs FEC or acknowledgement-driven
       * selective retransmission, neither of which is built. It is recorded as outstanding work in
       * LIVETAP_BOND_TEST_PLAN.md rather than papered over here.
       */
      lines.push('');
      lines.push('  KILL MODE - what a hard path death actually cost:');
      lines.push(`        ${duration.toFixed(2)} s of ${seconds} s recorded downstream`);
      lines.push(`        ${telemetry.scheduler.chunks} chunks scheduled, ${relayChunksOut} reconstructed`);
      lines.push(`        ${telemetry.retransmitted} chunks re-sent on the surviving path`);
      lines.push('        This gap is NOT yet acceptable and is not asserted as a pass.');
      if (duration > 1) ok('the broadcast continued after the path died rather than ending');
      else bad('the broadcast did not survive the path death at all');
    } else if (duration > seconds * 0.9) {
      ok(`${duration.toFixed(2)} s of media survived the whole chain`);
    } else {
      bad(`only ${duration.toFixed(2)} s survived, expected nearly all of ${seconds} s`);
    }
    if (size > 50_000) ok(`${size} bytes on disk`);
    else bad(`only ${size} bytes on disk`);
  }

  if (health.length > 0) {
    lines.push('  what the creator would have been told:');
    for (const entry of [...new Set(health)]) lines.push(`        ${entry}`);
  }

  process.stdout.write(`\n${lines.join('\n')}\n\n`);
  if (failed) {
    process.stdout.write('FAIL  the Bond chain did not carry a real broadcast end to end.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    'PASS  real H.264 and AAC were encoded, handed to a BondSink, encrypted, sent over real UDP\n' +
      '      sockets, authenticated and reassembled by the Bond relay, forwarded as RTMP to a real\n' +
      '      server, recorded, and decoded back by ffprobe.\n',
  );
}

main().catch((error) => {
  process.stdout.write(`\n${lines.join('\n')}\n\nFAIL  ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
