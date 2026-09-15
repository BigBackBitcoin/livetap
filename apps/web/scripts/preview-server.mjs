/**
 * The preview server: `dist/`, served the way the host serves it.
 *
 * `vite preview` does not rewrite, and since `/` became a static document and the application
 * moved to `app.html`, "serve the build" is no longer the same thing as "serve the files".
 * Every application route has to arrive at `app.html`, `/` has to arrive at the marketing page,
 * and — the part that matters most for the E2E — an address that matches nothing has to come
 * back as `404.html` with an actual **404** status, because that is exactly the behaviour
 * PRODUCT_REVIEW P2-9 is about and a preview that returns 200 there cannot test it.
 *
 * These rules are the same list as `vercel.json`'s rewrites, deliberately duplicated in ten
 * lines of `node:http` rather than approximated by a dependency. If the two ever disagree, the
 * E2E is testing a deployment that does not exist.
 *
 * Zero dependencies, by design: this runs in CI, in Playwright's `webServer`, and as
 * `npm run preview`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'dist'));
const PORT = Number(process.env.PORT ?? process.argv[3] ?? 4173);

/**
 * The application's route prefixes — the ones that must reach `app.html` so the router can
 * resolve them. Everything outside this list is a static file or a 404. Keep in step with
 * `vercel.json`.
 */
const APP_ROUTES = [/^\/app(\/|$)/, /^\/oauth(\/|$)/, /^\/privacy\/?$/, /^\/terms\/?$/];

const MIME = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
  }),
);

/** Resolve a request path to a file inside ROOT, or null if it escapes or does not exist. */
function fileFor(pathname) {
  const decoded = safeDecode(pathname);
  if (decoded === null) return null;
  const candidate = resolve(ROOT, '.' + normalize(decoded));
  // Path traversal: a request may never reach outside the build output.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  if (!existsSync(candidate)) return null;
  return statSync(candidate).isFile() ? candidate : null;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Send a file, or a 404 — but never throw out of the request handler.
 *
 * `statSync` on a file that has just disappeared throws ENOENT, and a throw inside a
 * `createServer` callback is an uncaught exception that takes the whole process down. Any
 * concurrent `npm run build` empties `dist` for a moment, so a request that lands in that window
 * killed the server and every Playwright run attached to it. Observed repeatedly: a suite that had
 * been green would report a dozen unrelated specs failing on "Cannot navigate", and the cause was
 * a build in another terminal.
 *
 * A test server that dies when the thing it serves is rebuilt makes every result it produced
 * before that moment suspect, which is a worse failure than a 404.
 */
function send(res, status, file) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    res.end('Not found (the file went away — a build is probably running)');
    return;
  }
  const type = MIME.get(extname(file).toLowerCase()) ?? 'application/octet-stream';
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': size,
    // Hashed assets are immutable; documents must never be cached during a test run.
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  const stream = createReadStream(file);
  // The file can also vanish BETWEEN the stat and the read, which is the same race one tick later.
  stream.on('error', () => res.end());
  stream.pipe(res);
}

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0].split('#')[0];

  // 1. `/` is the marketing page, which is a real file.
  if (pathname === '/' || pathname === '/index.html') {
    send(res, 200, join(ROOT, 'index.html'));
    return;
  }

  // 2. A real file wins over any rewrite, exactly as it does on the host.
  const file = fileFor(pathname);
  if (file) {
    send(res, 200, file);
    return;
  }

  // 3. `/api/*` is a serverless function on the host, and there is none here.
  if (pathname === '/api/early-access' && req.method === 'GET') {
    // The host answers this with the real function; here it is honestly "not configured".
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ enabled: false, method: 'none' }));
    return;
  }
  if (pathname.startsWith('/api/')) {
    res.writeHead(501, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('The API runs as a serverless function; this preview serves static files only.\n');
    return;
  }

  // 4. A known application route reaches the application document with a 200.
  if (APP_ROUTES.some((route) => route.test(pathname))) {
    send(res, 200, join(ROOT, 'app.html'));
    return;
  }

  // 5. Anything else is not a page. It says so, with the status to match.
  send(res, 404, join(ROOT, '404.html'));
});

if (!existsSync(join(ROOT, 'index.html')) || !existsSync(join(ROOT, 'app.html'))) {
  console.error(`[livetap] no build in ${ROOT}. Run \`npm run build -w @livetap/web\` first.`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`[livetap] serving ${ROOT} on http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
