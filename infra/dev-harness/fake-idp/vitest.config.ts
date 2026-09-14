import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest project for the fake IdP harness, shaped like the package configs
 * (see packages/adapters/vitest.config.ts) but pinned to this directory so it
 * behaves the same whether it is run from here or from the repo root:
 *
 *   npx vitest run --config infra/dev-harness/fake-idp/vitest.config.ts
 *
 * The root vitest.config.ts lists its projects explicitly and does not include
 * infra/, and this harness deliberately owns no file outside its own directory.
 * To fold it into `npm test`, add the one string 'infra/dev-harness/fake-idp'
 * to the `projects` array in the root vitest.config.ts.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { name: 'fake-idp', environment: 'node', include: ['*.test.mjs'] },
});
