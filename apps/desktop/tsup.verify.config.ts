import { defineConfig } from 'tsup';

/**
 * Separate build for the headless verification harness (scripts/verify-engine.ts).
 * It is not part of the shipped app, so it is not in tsup.config.ts; it is bundled rather than run
 * through a TS loader because this host has no `tsx`.
 */
export default defineConfig({
  entry: { 'verify-engine': 'scripts/verify-engine.ts' },
  outDir: 'dist/verify',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outExtension: () => ({ js: '.cjs' }),
  external: ['electron'],
  // @livetap/core ships TypeScript source, so it must be bundled, not left as a runtime require.
  noExternal: [/^@livetap\//],
  sourcemap: false,
  clean: true,
  splitting: false,
  bundle: true,
});
