/**
 * Minimal structural WebSocket contract.
 *
 * Declared here (instead of using the DOM/undici type) so a fake socket can be injected in
 * tests and so the adapter works with whatever WebSocket the host provides — Node 22's
 * global, Node 20 plus a polyfill, or the browser's.
 */
export interface MinimalWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null;
}

export type WebSocketCtor = new (url: string) => MinimalWebSocket;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Reads the text payload out of a message event regardless of how the socket delivers it. */
export function messageText(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return undefined;
}
