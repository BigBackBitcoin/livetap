import { defineConfig } from 'tsup';

/**
 * Two CommonJS bundles: Electron main and the preload script.
 * Electron's `main` field points at dist/main/index.cjs; electron-builder ships both.
 * `electron` is external (provided by the runtime). Node builtins stay external too.
 */
export default defineConfig([
  {
    entry: { index: 'src/main/index.ts' },
    outDir: 'dist/main',
    format: ['cjs'],
    platform: 'node',
    target: 'node20',
    outExtension: () => ({ js: '.cjs' }),
    external: ['electron', 'electron-log', 'electron-updater'],
    sourcemap: true,
    clean: false,
    splitting: false,
    bundle: true,
  },
  {
    entry: { index: 'src/preload/index.ts' },
    outDir: 'dist/preload',
    format: ['cjs'],
    platform: 'node',
    target: 'node20',
    outExtension: () => ({ js: '.cjs' }),
    external: ['electron'],
    sourcemap: true,
    clean: false,
    splitting: false,
    bundle: true,
  },
]);
