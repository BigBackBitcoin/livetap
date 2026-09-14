#!/usr/bin/env node
/**
 * LIVETAP dev-harness ingest - start the local receiver.
 *
 * Launches MediaMTX with mediamtx.dev.yml, waits until the RTMP port is
 * genuinely accepting TCP connections (not merely "the process started"), then
 * prints the ingest URL and path to publish to.
 *
 * Runs in the foreground. Ctrl+C stops the server. Recordings stay on disk.
 *
 *   node infra/dev-harness/ingest/start-ingest.mjs
 *   node infra/dev-harness/ingest/start-ingest.mjs --path=live/desktop-test
 *   node infra/dev-harness/ingest/start-ingest.mjs --quiet
 *
 * NOT A DEPLOYABLE SERVER. It has no authentication and binds 127.0.0.1 only.
 */

import path from 'node:path';

import {
  INGEST_DIR,
  MissingBinaryError,
  asString,
  ingestUrl,
  loadConfig,
  parseArgs,
  startMediaMtx,
  trimPath,
} from './lib/harness.mjs';

const USAGE = `
start-ingest.mjs - run the LIVETAP local development ingest

  --path=<name>   path to advertise in the printed URL (default live/dev)
  --quiet         do not forward MediaMTX log lines to stdout
  --help          this text

Environment
  LIVETAP_DEV_INGEST_RTMP_PORT   RTMP listener port (default 1935)
  LIVETAP_DEV_INGEST_API_PORT    control API port  (default 9997)
  LIVETAP_DEV_INGEST_MEDIAMTX    path to the mediamtx binary
`.trim();

async function main() {
  const { opts } = parseArgs(process.argv.slice(2), { booleans: ['quiet', 'help'] });
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const cfg = loadConfig();
  const streamPath = trimPath(asString(opts.path, cfg.defaultPath));
  const quiet = opts.quiet === true;

  const server = startMediaMtx(cfg, {
    onLog: quiet ? null : (line) => process.stdout.write(`  mediamtx | ${line}\n`),
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write('\nStopping dev ingest.\n');
    await server.stop();
    process.stdout.write(`Recordings kept in ${cfg.recordingsDir}\n`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.ready();

  const rel = (p) => path.relative(process.cwd(), p) || p;
  const lines = [
    '',
    'LIVETAP dev ingest is up. This is a LOCAL RECEIVER, never a deployment.',
    '',
    `  binary        ${server.binary}`,
    `  config        ${rel(cfg.configPath)}`,
    `  RTMP ingest   rtmp://${cfg.host}:${cfg.rtmpPort}/`,
    `  stream path   ${streamPath}`,
    `  full URL      ${ingestUrl(cfg, streamPath)}`,
    `  control API   ${cfg.apiBase}  (loopback only)`,
    `  recordings    ${rel(cfg.recordingsDir)}`,
    '',
    'The stream path above is a local MediaMTX path name on a server with no',
    'authentication bound to 127.0.0.1. It is not a credential, and no platform',
    'stream key is ever handled, stored or logged by this harness.',
    '',
    'Point an encoder at it:',
    `  OBS           Server  rtmp://${cfg.host}:${cfg.rtmpPort}/${streamPath.split('/')[0]}/`,
    `                Key     ${streamPath.split('/').slice(1).join('/') || streamPath}`,
    '  LIVETAP app   add a Custom RTMP destination with the full URL above',
    '',
    'Then, in another shell:',
    `  node ${rel(path.join(INGEST_DIR, 'verify-ingest.mjs'))} --path=${streamPath}`,
    '',
    'Ctrl+C to stop.',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);

  // Stay in the foreground for as long as MediaMTX lives.
  await new Promise((resolve) => {
    server.child.on('exit', (code, signal) => {
      if (!stopping) {
        process.stdout.write(
          `\nMediaMTX exited unexpectedly (code ${String(code)}${signal ? `, signal ${signal}` : ''}).\n`,
        );
        process.exitCode = 1;
      }
      resolve();
    });
  });
  return process.exitCode ?? 0;
}

main().then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    if (err instanceof MissingBinaryError) {
      process.stderr.write(`\n${err.message}\n\n`);
    } else {
      process.stderr.write(`\nFailed to start the dev ingest.\n${err.message}\n\n`);
    }
    process.exitCode = 1;
  },
);
