import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/core',
      'packages/adapters',
      'packages/media',
      'packages/ui',
      'packages/capacitor-live-stream',
      'apps/web',
      'apps/desktop',
      'apps/mobile',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.d.ts', '**/index.ts'],
    },
  },
});
