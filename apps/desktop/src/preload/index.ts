/**
 * Preload bridge — the entire attack surface the renderer can reach.
 *
 * Deliberate design choices:
 *
 *  - NO generic `invoke(channel, payload)`. That single function would hand the renderer every IPC
 *    channel Electron and any dependency ever registers, which defeats the point of an allow-list.
 *    Instead there is one named, typed method per operation, and the channel names are baked in
 *    here where the renderer cannot influence them.
 *  - NO node, fs, child_process or path leaked through the bridge. `contextIsolation: true` plus
 *    `sandbox: true` means this file runs in an isolated world with only `contextBridge` and
 *    `ipcRenderer`, and we expose neither.
 *  - Arguments are shape-checked here too. Main re-validates everything (main is the real boundary;
 *    this is convenience so a renderer bug surfaces as a clear error instead of a rejected IPC).
 *  - Event subscriptions return an unsubscribe function and never hand the raw IpcRendererEvent to
 *    the callback — that object exposes `sender`, which would leak a way to send on any channel.
 *  - Nothing here reads or caches a secret. `vault.get` passes the value straight through to the
 *    caller; the plaintext never touches module scope.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type { AspectRatio } from '@livetap/core';
import type { RecordingSettings } from '@livetap/core';

import type {
  DesktopEngineEvent,
  DesktopEngineOutput,
  DesktopStartRequest,
  LivetapApi,
  LoopbackInfo,
  RecoverySnapshot,
  SystemInfo,
  VaultResult,
} from '../shared/ipc.js';
import { CH } from '../shared/ipc.js';

const ASPECTS: readonly string[] = ['16:9', '9:16', '1:1'];

function requireAspect(value: unknown): AspectRatio {
  if (typeof value !== 'string' || !ASPECTS.includes(value)) throw new TypeError('Invalid aspect ratio.');
  return value as AspectRatio;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string.`);
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Subscribe to a main→renderer channel without exposing the event object. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  if (typeof callback !== 'function') throw new TypeError('A callback function is required.');
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

const api: LivetapApi = {
  engine: {
    capabilities: () => ipcRenderer.invoke(CH.engineCapabilities),

    start: (req: DesktopStartRequest) => {
      requireObject(req, 'start request');
      return ipcRenderer.invoke(CH.engineStart, req);
    },

    addOutput: (output: DesktopEngineOutput) => {
      requireObject(output, 'output');
      return ipcRenderer.invoke(CH.engineAddOutput, output);
    },

    removeOutput: (destinationId: string) =>
      ipcRenderer.invoke(CH.engineRemoveOutput, requireString(destinationId, 'destinationId')),

    stop: () => ipcRenderer.invoke(CH.engineStop),

    startRecording: (settings: RecordingSettings) => {
      requireObject(settings, 'recording settings');
      return ipcRenderer.invoke(CH.engineStartRecording, settings);
    },

    stopRecording: () => ipcRenderer.invoke(CH.engineStopRecording),

    /**
     * Hot path: one MediaRecorder chunk per timeslice (~330 KB at 1 s / 1080p30, measured).
     * `send` rather than `invoke` so the renderer's recorder callback never awaits the main process,
     * and the ArrayBuffer is passed directly so Electron's structured clone moves the bytes without
     * a base64 round-trip.
     */
    pushChunk: (aspectRatio: AspectRatio, data: ArrayBuffer) => {
      const aspect = requireAspect(aspectRatio);
      if (!(data instanceof ArrayBuffer)) throw new TypeError('Chunk data must be an ArrayBuffer.');
      if (data.byteLength === 0) return;
      ipcRenderer.send(CH.engineChunk, { aspectRatio: aspect, data });
    },

    endOfStream: (aspectRatio: AspectRatio) => {
      ipcRenderer.send(CH.engineEndOfStream, requireAspect(aspectRatio));
    },

    onEvent: (cb: (event: DesktopEngineEvent) => void) => subscribe<DesktopEngineEvent>(CH.engineEvent, cb),
  },

  vault: {
    set: (id: string, secret: string): Promise<VaultResult> =>
      ipcRenderer.invoke(CH.vaultSet, {
        id: requireString(id, 'id'),
        secret: requireString(secret, 'secret'),
      }),
    get: (id: string): Promise<VaultResult> => ipcRenderer.invoke(CH.vaultGet, requireString(id, 'id')),
    delete: (id: string): Promise<VaultResult> => ipcRenderer.invoke(CH.vaultDelete, requireString(id, 'id')),
    list: (): Promise<string[]> => ipcRenderer.invoke(CH.vaultList),
  },

  oauth: {
    startLoopback: (): Promise<LoopbackInfo> => ipcRenderer.invoke(CH.oauthStartLoopback),
    waitForCallback: (): Promise<string> => ipcRenderer.invoke(CH.oauthWaitForCallback),
    openExternal: (url: string) => ipcRenderer.invoke(CH.oauthOpenExternal, requireString(url, 'url')),
    onDeepLink: (cb: (url: string) => void) => subscribe<string>(CH.oauthDeepLink, cb),
  },

  system: {
    info: (): Promise<SystemInfo> => ipcRenderer.invoke(CH.systemInfo),
    chooseDirectory: () => ipcRenderer.invoke(CH.systemChooseDirectory),
    openPath: (relativePath: string) =>
      ipcRenderer.invoke(CH.systemOpenPath, requireString(relativePath, 'path')),
  },

  recovery: {
    get: (): Promise<RecoverySnapshot | null> => ipcRenderer.invoke(CH.recoveryGet),
    clear: () => ipcRenderer.invoke(CH.recoveryClear),
    update: (snapshot: RecoverySnapshot) => {
      requireObject(snapshot, 'snapshot');
      ipcRenderer.send(CH.recoveryUpdate, snapshot);
    },
  },
};

contextBridge.exposeInMainWorld('livetap', api);

/**
 * A tiny, read-only marker the renderer uses to branch on "am I in the desktop app?" without
 * feature-sniffing the API surface. Intentionally not a version of anything privileged.
 */
contextBridge.exposeInMainWorld('livetapHost', Object.freeze({ kind: 'desktop' as const }));
