/**
 * LIVETAP desktop — Electron main process.
 *
 * This process owns everything the renderer must not be trusted with: the FFmpeg media engine, the
 * secret vault, the OAuth loopback listener, the filesystem, and the window's security policy.
 * The renderer is a sandboxed web app that reaches all of it through the narrow, allow-listed
 * `window.livetap` bridge in ../preload/index.ts.
 *
 * Security posture (details and rationale in ./security/policy.ts):
 *   contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true
 *   strict CSP injected into every response by main (not a removable meta tag)
 *   all permissions denied except media / display-capture / fullscreen
 *   navigation pinned to the app's own document; https links go to the user's real browser
 *   a single instance, so two copies cannot fight over the vault, the port or the recovery file
 */

import path from 'node:path';

import {
  BrowserWindow,
  app,
  desktopCapturer,
  session,
  shell,
} from 'electron';
import log from 'electron-log/main.js';

import { FfmpegEngine } from './ffmpeg/FfmpegEngine.js';
import { resolveFfmpegPath } from './ffmpeg/ffmpegPath.js';
import { forwardEngineEvents, registerIpcHandlers, sendDeepLink } from './ipc.js';
import { DEEP_LINK_SCHEME, LoopbackOAuthServer, findDeepLink, isAcceptableDeepLink } from './oauth.js';
import { RecoveryStore } from './recovery.js';
import {
  SECURITY_HEADERS,
  cspHeaderValue,
  devCspHeaderValue,
  isExternallyOpenable,
  isInternalNavigation,
  isPermissionAllowed,
  isRequestAllowed,
} from './security/policy.js';
import { SecretVault } from './vault.js';

const IS_DEV = process.argv.includes('--dev');
const DEV_SERVER_ORIGIN = 'http://localhost:5173/app.html';
const RENDERER_INDEX = path.join(__dirname, '..', 'renderer', 'app.html');

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = IS_DEV ? 'debug' : 'warn';

const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log.info(message, meta ?? {}),
  warn: (message: string, meta?: Record<string, unknown>) => log.warn(message, meta ?? {}),
  error: (message: string, meta?: Record<string, unknown>) => log.error(message, meta ?? {}),
};

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;
let teardownIpc: (() => void) | null = null;
let teardownEvents: (() => void) | null = null;

/* --------------------------------------------------------- single instance */

// Two LIVETAPs would race over vault.bin, session-recovery.json and the FFmpeg child processes.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  // Register `livetap://` for the OAuth flows that cannot use a loopback redirect. In dev the
  // executable is Electron itself, so the path + argv form is required for the OS to find us.
  if (process.defaultApp && process.argv.length >= 2) {
    const entry = process.argv[1];
    if (entry) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(entry)]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  const initialDeepLink = findDeepLink(process.argv);
  if (initialDeepLink && isAcceptableDeepLink(initialDeepLink)) pendingDeepLink = initialDeepLink;

  app.on('second-instance', (_event, argv) => {
    const window = mainWindow;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
    const url = findDeepLink(argv);
    if (url && isAcceptableDeepLink(url)) deliverDeepLink(url);
  });

  // macOS delivers deep links through this event rather than argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (isAcceptableDeepLink(url)) deliverDeepLink(url);
  });

  app.whenReady().then(main).catch((error: unknown) => {
    logger.error('startup failed', { error: String(error) });
    app.quit();
  });
}

/* ----------------------------------------------------------------- startup */

async function main(): Promise<void> {
  const userDataDir = app.getPath('userData');
  const recordingsDir = path.join(userDataDir, 'recordings');

  const ffmpeg = resolveFfmpegPath({
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    isPackaged: app.isPackaged,
  });
  if (app.isPackaged && !ffmpeg.bundled) {
    // Honest, loud, and non-fatal: the app still opens, but capabilities() will report UNAVAILABLE
    // rather than pretending streaming works.
    logger.error('packaged build has no bundled FFmpeg; streaming will report UNAVAILABLE', {
      expected: ffmpeg.path,
    });
  }
  logger.info('ffmpeg resolved', { path: ffmpeg.path, source: ffmpeg.source });

  // Signed-update check. Only meaningful in a packaged, signed build with a publish config
  // (docs/release/DESKTOP_RELEASE.md). electron-updater verifies the publisher signature before
  // applying anything; on an unsigned build the check fails closed and is logged, never applied.
  if (app.isPackaged) {
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.autoDownload = false;
      autoUpdater.allowDowngrade = false;
      autoUpdater.allowPrerelease = false;
      autoUpdater.on('error', (error: unknown) => logger.warn('update check failed', { error: String(error) }));
      void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
        logger.warn('update check failed', { error: String(error) });
      });
    } catch (error) {
      logger.warn('electron-updater unavailable', { error: String(error) });
    }
  }

  const engine = new FfmpegEngine({ ffmpegPath: ffmpeg.path, recordingsDir, logger });
  const vault = new SecretVault({ userDataDir, safeStorage: await loadSafeStorage(), logger });
  const oauth = new LoopbackOAuthServer();
  const recovery = new RecoveryStore({ userDataDir, logger });

  if (!vault.available()) {
    logger.error('safeStorage encryption is unavailable; the vault will refuse to store secrets');
  }

  applySessionPolicy();

  const context = {
    engine,
    vault,
    oauth,
    recovery,
    recordingsDir,
    appVersion: app.getVersion(),
    getWindow: () => mainWindow,
    logger,
  };
  teardownIpc = registerIpcHandlers(context);
  teardownEvents = forwardEngineEvents(context);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    // A clean quit means there is nothing to recover, and the engine must not leave orphaned
    // ffmpeg processes behind.
    recovery.clear();
    oauth.stop();
    void engine.stop();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Probe the encoders once at launch so GO LIVE never waits on it (and so the log records the
  // honest hardware story for support).
  void engine.ensureHardware().then((report) => {
    logger.info('encoder probe', {
      recommended: report.recommended,
      results: report.all.map((r) => `${r.encoder}=${r.status}${r.detail ? ` (${r.detail})` : ''}`),
    });
  });
}

/* ------------------------------------------------------------------ window */

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    title: 'LIVETAP',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow = window;

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    mainWindow = null;
  });

  // A hostile or mistyped link must never repaint itself as the app. Internal navigation only;
  // https links open in the user's real browser where the URL bar is visible.
  const appUrl = IS_DEV ? DEV_SERVER_ORIGIN : `file://${RENDERER_INDEX.replace(/\\/g, '/')}`;
  window.webContents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url, appUrl)) return;
    event.preventDefault();
    logger.warn('blocked in-app navigation', { url });
    if (isExternallyOpenable(url)) void shell.openExternal(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) {
      void shell.openExternal(url);
    } else {
      logger.warn('blocked window.open', { url });
    }
    return { action: 'deny' };
  });
  // Belt and braces: if anything ever manages to attach a webview or a child webContents, strip
  // its privileges too.
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (IS_DEV) {
    void window.loadURL(DEV_SERVER_ORIGIN);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    // The desktop app opens in the studio, not the marketing landing (hash routing under file://).
    void window.loadFile(RENDERER_INDEX, { hash: '/app' });
  }

  window.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      const url = pendingDeepLink;
      pendingDeepLink = null;
      deliverDeepLink(url);
    }
  });
}

function deliverDeepLink(url: string): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    pendingDeepLink = url;
    return;
  }
  // Never log the URL itself: an OAuth callback contains an authorization code.
  logger.info('deep link received');
  sendDeepLink(window, url);
}

/* ---------------------------------------------------------------- session */

function applySessionPolicy(): void {
  const defaultSession = session.defaultSession;

  // CSP is applied to RESPONSES by main. A meta tag in index.html can be stripped by injected
  // markup; a header set here cannot.
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    // Remove any CSP the document tried to set for itself, then impose ours.
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === 'content-security-policy' || key.toLowerCase() === 'content-security-policy-report-only') {
        delete responseHeaders[key];
      }
    }
    responseHeaders['Content-Security-Policy'] = [IS_DEV ? devCspHeaderValue(DEV_SERVER_ORIGIN) : cspHeaderValue()];
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      responseHeaders[name] = [value];
    }
    callback({ responseHeaders });
  });

  // Refuse request schemes the app has no reason to use (ws:, plain http: in production, and
  // everything exotic). This is the network equivalent of the navigation lock.
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (isRequestAllowed(details.url, IS_DEV)) {
      callback({});
      return;
    }
    logger.warn('blocked request scheme', { url: details.url.slice(0, 120) });
    callback({ cancel: true });
  });

  // Deny every permission except the handful the product actually needs.
  const appOrigin = IS_DEV ? DEV_SERVER_ORIGIN : 'file://';
  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const requesting = webContents?.getURL() ?? '';
    const allowed = isPermissionAllowed(permission, requesting, appOrigin);
    if (!allowed) logger.warn('denied permission request', { permission });
    callback(allowed);
  });
  defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, appOrigin),
  );
  // Devices (HID / serial / USB / Bluetooth) are never granted. Two independent gates:
  // the permission handler above never allows the `hid`/`serial`/`usb`/`bluetooth` permissions, and
  // this handler refuses every individual device even if a permission somehow got through. With
  // device access denied, Electron never reaches the Bluetooth pairing stage at all, so no pairing
  // handler is needed.
  defaultSession.setDevicePermissionHandler(() => false);

  /**
   * getDisplayMedia in the renderer.
   *
   * Chromium's own picker is not available in Electron, so without a handler `getDisplayMedia`
   * simply fails. We wire it to desktopCapturer and hand back the primary screen, with system audio
   * requested via the `loopback` audio constraint on Windows (where Chromium supports loopback
   * capture); macOS has no loopback without a kernel extension, so audio is omitted there rather
   * than promised and silently missing.
   *
   * NOTE: this grants the FIRST screen source. The picker UI belongs in the renderer, which lists
   * sources itself and passes a chosen id — that lands with the studio UI; until then this keeps
   * screen share working end to end instead of failing.
   */
  defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'], fetchWindowIcons: false })
        .then((sources) => {
          const screen = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
          if (!screen) {
            logger.warn('no screen sources available');
            callback({});
            return;
          }
          if (process.platform === 'win32') {
            callback({ video: screen, audio: 'loopback' });
          } else {
            callback({ video: screen });
          }
        })
        .catch((error: unknown) => {
          logger.warn('desktopCapturer failed', { error: String(error) });
          callback({});
        });
    },
    // Let the renderer see source names so the studio can label the share.
    { useSystemPicker: false },
  );
}

/* ------------------------------------------------------------ safeStorage */

/**
 * `safeStorage` is only usable after `app.whenReady()`, and importing it lazily keeps the vault
 * module free of an Electron import so it stays unit-testable.
 */
async function loadSafeStorage(): Promise<{
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}> {
  const { safeStorage } = await import('electron');
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plainText: string) => safeStorage.encryptString(plainText),
    decryptString: (encrypted: Buffer) => safeStorage.decryptString(encrypted),
  };
}

/* ------------------------------------------------------------------ misc */

process.on('uncaughtException', (error) => {
  logger.error('uncaught exception in main', { error: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection in main', { reason: String(reason) });
});

app.on('will-quit', () => {
  teardownEvents?.();
  teardownIpc?.();
});
