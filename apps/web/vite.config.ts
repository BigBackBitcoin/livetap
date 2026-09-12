import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The landing page and the app share one HTML shell, but never one JS chunk:
 * every `/app/*` screen is reached through `React.lazy`, so a visitor who only
 * reads the marketing page never downloads the orchestrator, the media engine
 * or the adapter registry.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // Report the real transfer cost of each chunk in the build output.
    reportCompressedSize: true,
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-router')) return 'router';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('/packages/core/') || id.includes('/packages/adapters/') || id.includes('/packages/media/')) {
            return 'livetap-engine';
          }
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
