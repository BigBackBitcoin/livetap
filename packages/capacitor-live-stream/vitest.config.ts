import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'capacitor-live-stream', environment: 'node', include: ['src/**/*.test.ts'] },
});
