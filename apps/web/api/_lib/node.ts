/**
 * Adapter between Vercel's Node.js function signature `(req, res)` and Web-standard handlers.
 * Handlers stay pure `Request -> Response` (unit-testable); this file only moves bytes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type WebHandler = (req: Request) => Promise<Response> | Response;

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = (req.headers.host as string | undefined) ?? 'localhost';
  const proto = ((req.headers['x-forwarded-proto'] as string | undefined) ?? 'https').split(',')[0]!.trim();
  const url = `${proto}://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const method = (req.method ?? 'GET').toUpperCase();
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await readBody(req, 64 * 1024);
  }
  return new Request(url, { method, headers, body });
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Vercel may have pre-parsed the body onto req.body; prefer the raw stream when available.
    const pre = (req as IncomingMessage & { body?: unknown }).body;
    if (pre !== undefined && !req.readable) {
      resolve(typeof pre === 'string' ? pre : JSON.stringify(pre));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await response.text();
  res.end(text);
}

/** Wrap a Web handler as a Vercel Node function. */
export function nodeHandler(handler: WebHandler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const response = await handler(await toWebRequest(req));
      await sendWebResponse(res, response);
    } catch {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'INTERNAL', message: 'Unexpected error.' }));
    }
  };
}
