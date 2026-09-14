import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest project for the proof harness.
 *
 * Only one test file here runs under vitest: `secret-log.test.mjs`, the gate
 * that fails if a credential can reach a log line. It belongs in `npm test`
 * rather than in the end-to-end chain, because it costs milliseconds, needs no
 * server and no built app, and a leak must be caught on the commit that
 * introduces it rather than on the next full broadcast run.
 *
 * `verify-desktop-broadcast.mjs` is deliberately NOT a vitest test. It starts
 * a real RTMP server and a real Electron app and takes minutes; that is a
 * command a human runs (`npm run verify:broadcast`), not something that should
 * fire on every `npm test`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { name: 'proof-harness', environment: 'node', include: ['*.test.mjs'] },
});
