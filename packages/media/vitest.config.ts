import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { name: 'media', environment: 'node', include: ['src/**/*.test.ts'] } });
