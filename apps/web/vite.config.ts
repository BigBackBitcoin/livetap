import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two documents, not one.
 *
 * `index.html` is the marketing page: plain HTML, the design system's stylesheet, and one 400-byte
 * script that carries a theme the visitor chose inside the app. It contains no framework at all.
 * The reason is arithmetic rather than taste — React 19's DOM renderer is 69.2 KB gzipped, so no
 * React page can meet the landing's 60 KB budget however well the rest of it is split
 * (`docs/qa/FRICTION_BENCHMARK.md` §6). Nothing on that page has state.
 *
 * `app.html` is the application: React, the router, and every screen behind `React.lazy`, so a
 * visitor who opens Studio never downloads the Moments editor and nobody downloads the
 * orchestrator, the adapters or the media engine until they reach `/app`.
 *
 * The host rewrites the application's routes — `/app/*`, `/oauth/*`, `/privacy`, `/terms` — to
 * `/app.html`, and serves `/` as the static document. Nothing else is rewritten, which is what
 * makes the 404 below a real 404.
 */
const APP_ENTRY = 'app.html';
const LANDING_ENTRY = 'index.html';

/** Mock mode is the default, and the default is loud about itself (ADR-007). */
function isDemoBuild(env: Record<string, string>): boolean {
  return (env.VITE_LIVETAP_MOCK_MODE ?? process.env.VITE_LIVETAP_MOCK_MODE) !== 'false';
}

/**
 * The landing's two honesty sentences.
 *
 * The React landing read the mock-mode flag at runtime; a static document cannot, so the
 * sentences are injected at build time into two named comments. They are not optional copy: the
 * hosted deployment broadcasts nowhere, and PRODUCT_REVIEW P0-5 is the finding that the page
 * must say so in its own voice before anyone taps the button.
 */
function demoHonesty(env: Record<string, string>): Plugin {
  const demo = isDemoBuild(env);
  const hero = demo
    ? ' This hosted build is a demo: every destination is simulated and nothing is broadcast anywhere.'
    : '';
  const browser = demo
    ? ' It runs in demo mode, so you can walk the whole product end to end without broadcasting to anyone.'
    : '';
  return {
    name: 'livetap-demo-honesty',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith(LANDING_ENTRY)) return html;
        return html
          .replace('<!--lt:demo-hero-->', hero)
          .replace('<!--lt:demo-browser-->', browser);
      },
    },
  };
}

/**
 * A real 404 (PRODUCT_REVIEW P2-9).
 *
 * Vercel serves `404.html` from the output directory, with a 404 status, for any path that
 * matches neither a file nor a rewrite. So the application document is copied to `404.html`:
 * an address that matches nothing arrives at the routed not-found screen — branded, accurate,
 * with one way back (P1-9) — and the status line agrees with what the page says. Before this,
 * `/nope-not-a-page` returned HTTP 200 because a catch-all rewrite handed every unmatched path
 * to the SPA.
 *
 * It is a copy of `app.html` rather than of the landing: a marketing page is not an answer to
 * "this address does not exist", and the not-found screen already exists in the router.
 */
function real404(): Plugin {
  let outDir = 'dist';
  return {
    name: 'livetap-404',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const from = resolve(outDir, APP_ENTRY);
      const to = resolve(outDir, '404.html');
      await copyFile(from, to);
      this.info(`404.html written from ${APP_ENTRY}`);
    },
  };
}

/**
 * The application's route prefixes — the ones the host rewrites to `app.html`.
 *
 * One list, used twice: by the dev server below, and (copied, deliberately) by
 * `scripts/preview-server.mjs`, which is what the E2E runs against. `vercel.json` carries the
 * same list for production. If the three ever disagree, a route works in one place and 404s in
 * another, which is why the list is short and written down in each of them.
 */
const APP_ROUTES = [/^\/app(\/|$)/, /^\/oauth(\/|$)/, /^\/privacy\/?$/, /^\/terms\/?$/];

/**
 * `vite dev` serves a single fallback document, and since `/` became the static marketing page
 * that fallback is the wrong one: `npm run dev:web` then opened the landing at `/app/studio`.
 * This applies the host's rewrites in development so the dev server and the deployment agree.
 */
function devRewrites(): Plugin {
  return {
    name: 'livetap-dev-rewrites',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const pathname = (req.url ?? '/').split('?')[0]?.split('#')[0] ?? '/';
        if (APP_ROUTES.some((route) => route.test(pathname))) req.url = `/${APP_ENTRY}`;
        next();
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [
    react(),
    demoHonesty(process.env as Record<string, string>),
    devRewrites(),
    real404(),
  ],
  build: {
    target: 'es2022',
    // Report the real transfer cost of each chunk in the build output.
    reportCompressedSize: true,
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, LANDING_ENTRY),
        app: resolve(import.meta.dirname, APP_ENTRY),
      },
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
}));
