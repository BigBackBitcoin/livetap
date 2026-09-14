#!/usr/bin/env node
/**
 * LIVETAP dev-harness ingest - drop a publisher on purpose.
 *
 * WHY THIS EXISTS
 * ---------------
 * LIVETAP fans one broadcast out to several destinations, and the promise is
 * that one dead destination does not take the others down with it. Testing
 * that promise against a simulated failure proves nothing: a mock socket
 * closes politely at a moment the test chose. This script asks MediaMTX to
 * kick a real RTMP connection, so the encoder under test meets an actual
 * mid-broadcast TCP reset with frames in flight, which is the failure it will
 * meet in production.
 *
 *   node infra/dev-harness/ingest/kill-publisher.mjs
 *   node infra/dev-harness/ingest/kill-publisher.mjs --path=live/desktop-test
 *   node infra/dev-harness/ingest/kill-publisher.mjs --all
 *
 * Exit 0 if a publisher was killed, 1 if there was nothing to kill or the
 * kick did not take effect.
 */

import {
  asString,
  kickRtmpConn,
  listPublishers,
  loadConfig,
  parseArgs,
  sleep,
  trimPath,
} from './lib/harness.mjs';

const USAGE = `
kill-publisher.mjs - deliberately drop one live publisher

  --path=<name>   only consider publishers on this path (default live/dev)
  --any-path      consider publishers on every path
  --id=<connId>   kill this exact RTMP connection id
  --all           kill every matching publisher, not just the first
  --help          this text
`.trim();

async function main() {
  const { opts } = parseArgs(process.argv.slice(2), { booleans: ['all', 'any-path', 'help'] });
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const cfg = loadConfig();
  const anyPath = opts['any-path'] === true;
  const pathName = anyPath ? null : trimPath(asString(opts.path, cfg.defaultPath));

  let publishers = await listPublishers(cfg, pathName);
  if (opts.id && opts.id !== true) {
    const wanted = String(opts.id);
    publishers = publishers.filter((c) => c.id === wanted);
    if (publishers.length === 0) {
      process.stderr.write(`\nNo publishing RTMP connection with id ${wanted}.\n\n`);
      return 1;
    }
  }

  if (publishers.length === 0) {
    process.stderr.write(
      [
        '',
        `Nothing to kill: no RTMP connection is publishing${pathName ? ` to "${pathName}"` : ''}.`,
        '',
        'Start a broadcast first, then run this while it is live. To see what the',
        'server currently has, run:',
        '  node infra/dev-harness/ingest/verify-ingest.mjs',
        '',
      ].join('\n'),
    );
    return 1;
  }

  const targets = opts.all === true ? publishers : [publishers[0]];
  const killed = [];

  for (const conn of targets) {
    process.stdout.write(
      `\nKilling publisher on "${conn.path}"\n` +
        `  connection  ${conn.id}\n` +
        `  from        ${conn.remoteAddr}\n` +
        `  agent       ${conn.userAgent}\n` +
        `  pushed      ${conn.bytesReceived} bytes since ${conn.created}\n`,
    );
    const status = await kickRtmpConn(cfg, conn.id);
    if (status !== 200) {
      process.stderr.write(`  control API returned HTTP ${status} for the kick, expected 200\n`);
      continue;
    }
    killed.push(conn);
  }

  if (killed.length === 0) {
    process.stderr.write('\nFAIL  no publisher was killed.\n\n');
    return 1;
  }

  // The kick is asynchronous on the server side. Confirm the connection is
  // really gone rather than trusting the 200.
  const killedIds = new Set(killed.map((c) => c.id));
  let remaining = killedIds.size;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const still = await listPublishers(cfg, pathName);
    remaining = still.filter((c) => killedIds.has(c.id)).length;
    if (remaining === 0) break;
    await sleep(150);
  }

  if (remaining !== 0) {
    process.stderr.write(`\nFAIL  ${remaining} connection(s) survived the kick.\n\n`);
    return 1;
  }

  process.stdout.write(
    [
      '',
      `Killed ${killed.length} publisher(s). The connection is closed at the TCP level.`,
      'The encoder should now be seeing a write error mid-broadcast, which is',
      'exactly the condition destination failure isolation has to survive.',
      '',
    ].join('\n'),
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`\nFAIL  could not kill a publisher: ${err.message}\n\n`);
    process.exitCode = 1;
  },
);
