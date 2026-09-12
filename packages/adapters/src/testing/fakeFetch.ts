import type { FetchInit, FetchLike, FetchResponse } from '../real/http.js';

/**
 * A recorded fake `fetch` for testing real adapters without a network.
 *
 * Exported because app-level tests need it too. Routes are consumed in order, so a test can
 * assert an exact request sequence, and an unmatched request throws loudly rather than
 * silently returning a default.
 */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  /** Parsed body when it was JSON. */
  json: unknown;
}

export interface FakeRoute {
  /** Substring or pattern the URL must match. */
  match: string | RegExp;
  method?: string;
  status?: number;
  /** Serialized as the JSON response body. */
  body?: unknown;
  /** Raw response text (wins over `body`). Use '' for a 204-style empty body. */
  text?: string;
  /** How many times this route may be used (default: unlimited). */
  times?: number;
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
  /** Convenience: `${method} ${url}` for each call, in order. */
  sequence(): string[];
}

export function createFakeFetch(routes: FakeRoute[]): FakeFetch {
  const remaining = routes.map((route) => ({ route, used: 0 }));
  const calls: RecordedCall[] = [];

  const fetchImpl: FetchLike = async (url: string, init?: FetchInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body;
    let json: unknown;
    if (body !== undefined) {
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
    }
    calls.push({ url, method, headers: { ...init?.headers }, body, json });

    const entry = remaining.find(({ route, used }) => {
      if (route.times !== undefined && used >= route.times) return false;
      if (route.method && route.method.toUpperCase() !== method) return false;
      return typeof route.match === 'string' ? url.includes(route.match) : route.match.test(url);
    });
    if (!entry) throw new Error(`fakeFetch: no route for ${method} ${url}`);
    entry.used++;

    const status = entry.route.status ?? 200;
    const text = entry.route.text ?? (entry.route.body === undefined ? '' : JSON.stringify(entry.route.body));
    return responseOf(status, text);
  };

  return { fetch: fetchImpl, calls, sequence: () => calls.map((c) => `${c.method} ${c.url}`) };
}

function responseOf(status: number, text: string): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : `Status ${status}`,
    async text() {
      return text;
    },
    async json() {
      return JSON.parse(text) as unknown;
    },
  };
}
