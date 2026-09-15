import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/bond',
      'packages/core',
      'packages/adapters',
      'packages/media',
      'packages/ui',
      'packages/capacitor-live-stream',
      'apps/web',
      'apps/desktop',
      'apps/mobile',
      // The dev harnesses are not packages, but their tests are gates: the fake
      // IdP proves the real OAuth flow against a server that genuinely verifies
      // PKCE, and the proof harness fails if a credential can reach a log line.
      // Both were written and left out of `npm test`, which is the same as not
      // having them.
      'infra/dev-harness/fake-idp',
      'infra/dev-harness/broadcast',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.d.ts', '**/index.ts'],
    },
  },
});
