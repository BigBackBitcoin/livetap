/**
 * IPC handlers.
 *
 * Every handler in this file assumes its payload is hostile and runs a hand-written guard from
 * ../shared/guards.ts before touching it. A payload that fails the guard is rejected with a generic
 * message — never an echo of the input, which would turn a log or an error toast into an
 * exfiltration channel.
 *
 * There is one handler per channel and no generic passthrough, so the renderer's reachable surface
 * is exactly this file.
 */

import path from 'node:path';

import { dialog, ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';

import type { AspectRatio } from '@livetap/core';

import type { DesktopEngineEvent, LoopbackInfo, SystemInfo, VaultResult } from '../shared/ipc.js';
import { CH } from '../shared/ipc.js';
import {
  isAspectRatio,
  isChunkPayload,
  isDestinationId,
  isEngineOutput,
  isHttpsUrl,
  isRecordingSettings,
  isRecoverySnapshot,
  isSafeRelativePath,
  isStartRequest,
  isVaultId,
  isVaultSetRequest,
} from '../shared/guards.js';
import type { FfmpegEngine } from './ffmpeg/FfmpegEngine.js';
import type { LoopbackOAuthServer } from './oauth.js';
import { isExternallyOpenable } from './security/policy.js';
import type { RecoveryStore } from './recovery.js';
import type { SecretVault } from './vault.js';

export interface IpcContext {
  engine: FfmpegEngine;
  vault: SecretVault;
  oauth: LoopbackOAuthServer;
  recovery: RecoveryStore;
  recordingsDir: string;
  appVersion: string;
  getWindow(): BrowserWindow | null;
  logger: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

const REJECTED = 'Request rejected: the message did not match the expected shape.';

/**
 * Only accept IPC from our own renderer. A `webContents` that is not the app window (a devtools
 * page, a future webview) gets nothing, which closes the classic "any frame can call your IPC" hole.
 */
function isTrustedSender(context: IpcContext, event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const window = context.getWindow();
  if (!window || window.isDestroyed()) return false;
  return event.sender.id === window.webContents.id;
}

export function registerIpcHandlers(context: IpcContext): () => void {
  const channels: string[] = [];

  const handle = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown,
  ): void => {
    channels.push(channel);
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!isTrustedSender(context, event)) throw new Error(REJECTED);
      return handler(event, payload);
    });
  };

  const on = (channel: string, handler: (event: IpcMainEvent, payload: unknown) => void): void => {
    channels.push(channel);
    ipcMain.on(channel, (event, payload: unknown) => {
      if (!isTrustedSender(context, event)) return;
      handler(event, payload);
    });
  };

  /* -------------------------------------------------------------- engine */

  handle(CH.engineCapabilities, () => context.engine.capabilities());

  handle(CH.engineStart, async (_event, payload) => {
    if (!isStartRequest(payload)) throw new Error(REJECTED);
    return context.engine.start(payload);
  });

  handle(CH.engineAddOutput, async (_event, payload) => {
    if (!isEngineOutput(payload)) throw new Error(REJECTED);
    return context.engine.addOutput(payload);
  });

  handle(CH.engineRemoveOutput, async (_event, payload) => {
    if (!isDestinationId(payload)) throw new Error(REJECTED);
    return context.engine.removeOutput(payload);
  });

  handle(CH.engineStop, async () => {
    const result = await context.engine.stop();
    context.recovery.clear();
    return result;
  });

  handle(CH.engineStartRecording, async (_event, payload) => {
    if (!isRecordingSettings(payload)) throw new Error(REJECTED);
    // A renderer-supplied directory is NOT honoured here: recordings go to the app's own folder or
    // to a directory the user picked through the native dialog (which main resolved itself).
    const settings = { ...payload, directory: context.recordingsDir };
    return context.engine.startRecording(settings);
  });

  handle(CH.engineStopRecording, () => context.engine.stopRecording());

  // High-frequency, fire-and-forget: one MediaRecorder chunk. `send`, not `invoke`, so the renderer
  // is never blocked waiting for the main process.
  on(CH.engineChunk, (_event, payload) => {
    if (!isChunkPayload(payload)) {
      context.logger.warn('rejected malformed engine chunk');
      return;
    }
    const bytes = payload.data instanceof ArrayBuffer ? new Uint8Array(payload.data) : new Uint8Array(payload.data);
    context.engine.pushChunk(payload.aspectRatio, bytes);
  });

  on(CH.engineEndOfStream, (_event, payload) => {
    if (!isAspectRatio(payload)) return;
    context.engine.endOfStream(payload);
  });

  /* --------------------------------------------------------------- vault */

  handle(CH.vaultSet, (_event, payload): VaultResult => {
    if (!isVaultSetRequest(payload)) throw new Error(REJECTED);
    return context.vault.set(payload.id, payload.secret);
  });

  handle(CH.vaultGet, (_event, payload): VaultResult => {
    if (!isVaultId(payload)) throw new Error(REJECTED);
    return context.vault.get(payload);
  });

  handle(CH.vaultDelete, (_event, payload): VaultResult => {
    if (!isVaultId(payload)) throw new Error(REJECTED);
    return context.vault.delete(payload);
  });

  handle(CH.vaultList, (): string[] => context.vault.list());

  /* --------------------------------------------------------------- oauth */

  handle(CH.oauthStartLoopback, (_event, payload): Promise<LoopbackInfo> => {
    /* Main re-validates: the renderer may ask for a spelling, never for an arbitrary host. */
    const asked = (payload as { host?: unknown } | undefined)?.host;
    const host = asked === 'localhost' ? ('localhost' as const) : ('127.0.0.1' as const);
    return context.oauth.start({ host });
  });

  handle(CH.oauthWaitForCallback, (): Promise<string> => context.oauth.waitForCallback());

  handle(CH.oauthOpenExternal, async (_event, payload) => {
    // Two independent checks: the guard (shape + https) and the policy (scheme + control chars).
    if (!isHttpsUrl(payload) || !isExternallyOpenable(payload)) throw new Error(REJECTED);
    await shell.openExternal(payload);
    return { ok: true };
  });

  /* -------------------------------------------------------------- system */

  handle(CH.systemInfo, (): SystemInfo => ({
    platform: process.platform,
    appVersion: context.appVersion,
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    recordingsDir: context.recordingsDir,
  }));

  handle(CH.systemChooseDirectory, async () => {
    const window = context.getWindow();
    if (!window) return {};
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose where LIVETAP saves recordings',
    });
    if (result.canceled || result.filePaths.length === 0) return {};
    return { path: result.filePaths[0] };
  });

  handle(CH.systemOpenPath, async (_event, payload) => {
    if (!isSafeRelativePath(payload)) throw new Error(REJECTED);
    // Resolve, then prove the result is still inside the recordings directory. The guard already
    // refuses `..`, but re-checking after resolution is what actually closes traversal (symlinks,
    // odd separators, Unicode normalisation).
    const base = path.resolve(context.recordingsDir);
    const resolved = path.resolve(base, payload);
    const relative = path.relative(base, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(REJECTED);
    const error = await shell.openPath(resolved);
    return { ok: error === '' };
  });

  /* ------------------------------------------------------------ recovery */

  handle(CH.recoveryGet, () => context.recovery.read());

  handle(CH.recoveryClear, () => {
    context.recovery.clear();
    return { ok: true };
  });

  on(CH.recoveryUpdate, (_event, payload) => {
    if (!isRecoverySnapshot(payload)) {
      context.logger.warn('rejected malformed recovery snapshot');
      return;
    }
    context.recovery.update(payload);
    context.recovery.start();
  });

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel);
      ipcMain.removeAllListeners(channel);
    }
  };
}

/** Forward engine events to the renderer, dropping them silently if the window has gone. */
export function forwardEngineEvents(context: IpcContext): () => void {
  return context.engine.on((event: DesktopEngineEvent) => {
    const window = context.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(CH.engineEvent, event);
  });
}

/** Send a validated `livetap://` deep link to the renderer. */
export function sendDeepLink(window: BrowserWindow | null, url: string): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(CH.oauthDeepLink, url);
}

/** Aspect ratios in a stable order, used when the renderer omits one. */
export const DEFAULT_ASPECT: AspectRatio = '16:9';
