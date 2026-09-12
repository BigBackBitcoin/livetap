# LIVETAP — Desktop, Mobile & Store Readiness Research

**Document owner:** Desktop + Mobile + Release research team
**Date of research:** 2026-09-11
**Build host assumed:** Windows Server 2022 Standard (10.0.20348), Node 20.11, **no Rust, no Java/Android SDK, no Xcode, no Mac**
**Product shape:** React web app (Vite) + Electron desktop (macOS/Windows) + Capacitor-wrapped iOS/Android with a native streaming plugin

## Status vocabulary used throughout

| Status | Meaning |
| --- | --- |
| `PASS` | Doable and verifiable **from this Windows host** (e.g. writing config/manifest files, reading docs, running Node/Electron tooling) |
| `FAIL` | Not achievable as currently configured, and the blocker is local/fixable (e.g. wrong Node version) |
| `BLOCKED_EXTERNAL_DEPENDENCY` | Requires an Apple/Google account, a Mac, a physical device, a signing certificate, or a paid service |
| `UNVERIFIED` | Not confirmed against primary documentation in this research pass — **must be verified before relying on it** |

> **Discipline note:** every requirement below that is stated as fact was read from the primary source listed in [Sources](#sources). Anything sourced from blogs, forums, or community reports is explicitly labelled. Nothing in this document is invented; gaps are marked `UNVERIFIED` rather than filled in.

---

# Part 1 — DESKTOP (Electron)

## 1.1 Current Electron version and bundled runtimes (September 2026)

From the official Electron release schedule and endoflife.date:

| Electron | Chromium | Node.js | Stable release | End of life |
| --- | --- | --- | --- | --- |
| **44.0.0 (current stable)** | M152 | v24.18.1 | 2026-08-25 | 2027-03-02 |
| 43.0.0 | M150 | v24.17.0 | 2026-06-30 | 2027-01-05 |
| 42.0.0 | M148 | v24.15.0 | 2026-05-05 | 2026-10-20 |
| 45.0.0 (next) | M156 | v24.21.0 | 2026-10-20 | 2027-04-27 |
| 46.0.0 | M160 | v24.21.0 | 2027-01-05 | 2027-06-22 |

Support policy: **the latest three stable majors are supported**; a new major ships roughly every 8 weeks in step with Chromium. EOL majors are deprecated in npm and receive a final release with deprecation warnings.

**Recommendation for LIVETAP:** pin `electron@44.x` (`"electron": "~44.0.0"`). Electron 42 goes EOL 2026-10-20, so do not start on it. Plan a standing 8-week "Electron bump" chore so you are never more than two majors behind — security patches only land on supported lines.

**Consequence of Node 24 in the main process:** main/preload code may use Node 24 APIs. That is *independent* of the host's Node 20.11, which is only used to run `npm`/`electron-builder`. No local Node upgrade is needed for the Electron build — but see §2.1: **Capacitor 8 needs Node ≥ 22 and will fail on this host.**

## 1.2 Electron security checklist (from the official security tutorial)

The official checklist has 20 items. Secure-by-default status in modern Electron: `contextIsolation` on by default since 12.0.0, `nodeIntegration` off by default since 5.0.0, `sandbox` on by default since 20.0.0, `webSecurity` on by default.

| # | Item | LIVETAP action |
| --- | --- | --- |
| 1 | Only load secure content (HTTPS/WSS/FTPS) | Load the Vite bundle from a **custom protocol** (see #14), all remote calls HTTPS/WSS |
| 2 | Do not enable Node integration for remote content | `nodeIntegration: false` (default) — expose capability via `contextBridge` only |
| 3 | Enable `contextIsolation` in all renderers | Keep default `true`; never set `false` (it also disables sandboxing) |
| 4 | Enable process sandboxing | Keep default `sandbox: true` for the app window |
| 5 | Handle permission requests | Implement `session.setPermissionRequestHandler()`; allow only `media` (camera/mic) and `display-capture` for your own origin, deny everything else |
| 6 | Do not disable `webSecurity` | Keep default |
| 7 | Define a restrictive CSP | See §1.2.1 |
| 8 | Never `allowRunningInsecureContent` | Keep default `false` |
| 9 | Disable `experimentalFeatures` / `enableBlinkFeatures` | Keep defaults `false` |
| 10 | WebView hardening (`allowpopups` off, validate `will-attach-webview`) | Do not use `<webview>` at all |
| 11 | Restrict navigation via `will-navigate` | Parse with `new URL()` and compare `origin` — never string `startsWith` |
| 12 | Control window creation via `setWindowOpenHandler()` | Default `{ action: 'deny' }`; route allow-listed https origins to `shell.openExternal()` |
| 13 | Validate the `sender` of all IPC messages | Check `event.senderFrame.url` origin in every `ipcMain.handle`; never re-expose raw `ipcRenderer.on` through `contextBridge` |
| 14 | Avoid `file://`; use a custom protocol | Register e.g. `app://` via `protocol.handle()` and serve the built SPA from it — this also gives you a real origin for CSP and OAuth |
| 15 | Disable dangerous fuses (`runAsNode`, `nodeCliInspect`) | Use `@electron/fuses` in the build pipeline |
| 16 | Stay on a supported major | Electron 44.x, bump every ~8 weeks |

### 1.2.1 Concrete CSP and window policy

The docs' own example is `script-src 'self'`. A workable LIVETAP baseline (set as a **response header** on the custom protocol, not only a `<meta>` tag):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
media-src 'self' blob: mediastream:;
connect-src 'self' https://api.livetap.example wss://ingest.livetap.example https://accounts.google.com https://id.twitch.tv;
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
```

Note `style-src 'unsafe-inline'` is a concession most bundlers force; drop it if you can emit hashed styles.

### 1.2.2 Navigation / new-window allow-list (shape)

```js
const ALLOWED_EXTERNAL = new Set([
  'https://accounts.google.com',
  'https://id.twitch.tv',
  'https://livetap.example',
]);

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== 'app://livetap') event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED_EXTERNAL.has(new URL(url).origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
});
```

## 1.3 OAuth callbacks: custom scheme vs loopback

### Google / YouTube — **loopback is what Google recommends for desktop**

From Google's OAuth 2.0 for Mobile & Desktop Apps page:

- **Loopback IP address** — `http://127.0.0.1:port` or `http://[::1]:port`. Google's recommended usage is explicitly *"macOS, Linux, and Windows desktop (but not Universal Windows Platform) apps."* Your app runs a short-lived local HTTP server to receive the code.
- **Custom URI scheme** — documented as **deprecated**: *"Custom URI schemes are no longer supported due to the risk of app impersonation"* (that statement is scoped to Android and Chrome apps in the doc).
- **Manual copy/paste (OOB, `urn:ietf:wg:oauth:2.0:oob`)** — **no longer supported**.
- **PKCE** — documented as *recommended* (not worded as mandatory): verifier 43–128 chars, challenge `S256` (recommended) or `plain`, sent as `code_challenge` + `code_challenge_method`.

**Decision: for Google/YouTube on Electron, use loopback (`http://127.0.0.1:<ephemeral>`) + PKCE S256, with no client secret shipped in the app.** Bind to `127.0.0.1` (never `0.0.0.0`), pick an ephemeral port at runtime, verify the `state` parameter, and shut the listener down immediately after the single expected request.

### Twitch — **no documented PKCE; plan for a token broker or device code**

Twitch's "Getting OAuth Access Tokens" page documents four flows: implicit, client credentials, authorization code, and **device code grant**. Key findings:

- **PKCE is not mentioned anywhere in Twitch's official OAuth documentation.** Community threads on Twitch's own developer forums ("PKCE extension for OAuth authorization code flow", "Still no support for auth code flow with PKCE") indicate it is still not supported. → **Treat Twitch PKCE support as `UNVERIFIED`/absent. Do not design around it.**
- `http://localhost:<port>` redirect URIs are used in Twitch's own registration example (`http://localhost:3000`). Whether HTTP-localhost is sanctioned for *production* desktop clients is not stated in the docs → `UNVERIFIED`.
- For devices without a server, Twitch explicitly recommends the **Device Code Grant Flow**.

**Decision for Twitch:** two acceptable designs.
1. **Preferred — backend token broker.** Desktop opens the system browser to Twitch with a redirect to `https://api.livetap.example/oauth/twitch/callback`; the LIVETAP backend holds the client secret, exchanges the code, and hands the desktop app a short-lived LIVETAP-scoped credential over a channel bound to a nonce the desktop generated. Keeps the Twitch client secret off the client entirely.
2. **Fallback — Device Code Grant Flow**, which Twitch designed for exactly this situation and which needs no secret and no redirect listener. Slightly worse UX (user types a code) but zero secret exposure.

Do **not** ship the Twitch client secret inside the Electron bundle in either case.

### Custom scheme `livetap://oauth` — where it still earns its place

Register `livetap://` anyway (via `app.setAsDefaultProtocolClient('livetap')`) for **non-OAuth deep links** (open a broadcast, join a room, handle an update notice). Mechanics from the official Electron deep-link tutorial:

- macOS: register an `app.on('open-url')` listener **during initial startup, before awaiting `ready`**.
- Windows/Linux: take `app.requestSingleInstanceLock()` and read the URL off `commandLine` in `app.on('second-instance')`.
- Protocol handlers **only work in packaged apps on macOS and Linux**, not in dev.
- Packaging: macOS needs `CFBundleURLTypes` in `Info.plist`; Linux needs the `x-scheme-handler/livetap` MIME type. electron-builder exposes a `protocols` config array (the tutorial shows the Electron Forge equivalent; the electron-builder key name is `protocols` — `UNVERIFIED` exact schema in this pass).

## 1.4 Credential storage — `safeStorage`

| Platform | Backend | Threat model per Electron docs |
| --- | --- | --- |
| macOS | Keychain Access | Protects from other users **and other apps** in the same userspace |
| Windows | DPAPI | Protects from **other users only** — another app running as the same user can decrypt |
| Linux | kwallet / GNOME Keyring / Portal Secret / **plaintext fallback** | Varies by desktop environment |

API: `encryptString` / `decryptString`, plus the newer and **recommended** `encryptStringAsync` / `decryptStringAsync` (the async decrypt supports key rotation), `isEncryptionAvailable()`, `isAsyncEncryptionAvailable()`, `getSelectedStorageBackend()` (Linux), `setUsePlainTextEncryption()`.

Hard caveats straight from the docs:

1. **Must wait for `app` `ready`** before encryption is available on Linux and Windows.
2. **Linux with no secret store silently falls back to hardcoded plaintext encryption — i.e. no protection at all.** LIVETAP must call `getSelectedStorageBackend()` and refuse to persist stream keys (or warn loudly) when the backend is the plaintext fallback.
3. **macOS requires a stable code signature.** If the signature changes between versions, macOS may not recognise the update as the same app and will re-prompt for Keychain access repeatedly. This is another argument for a single, long-lived Developer ID identity.
4. On Windows, DPAPI does **not** protect against malware running as the same user. Stream keys and OAuth refresh tokens are high-value; prefer short-lived tokens minted by the LIVETAP backend over long-lived platform secrets on disk.

**Recommendation:** store only refresh tokens / LIVETAP session tokens in `safeStorage`, never raw RTMP stream keys if the backend can mint them per-session. Use `encryptStringAsync`. Gate all writes behind `isEncryptionAvailable()` and a Linux backend check.

## 1.5 Screen / window capture with system audio

### The APIs

`navigator.mediaDevices.getDisplayMedia()` in the renderer is intercepted in the main process by `session.setDisplayMediaRequestHandler(handler, opts)`. The handler receives `{ frame, securityOrigin, videoRequested, audioRequested, userGesture }` and you reply with `{ video, audio, enableLocalEcho }` where:

- `video`: a `{ id, name }` from `desktopCapturer.getSources({ types: ['screen', 'window'] })`, or a `WebFrameMain`.
- `audio`: the string `'loopback'` (system audio) or `'loopbackWithMute'` (system audio with local playback muted), or a `WebFrameMain`.
- `opts.useSystemPicker: true` uses the OS picker and **bypasses your handler entirely** — but it is still **experimental and macOS 15+ only**.

### Platform reality for **system audio** (this is the sharp edge)

- **Windows: supported.** The Electron docs state plainly that the *"loopback device will capture system audio, and is currently only supported on Windows."* `desktopCapturer` docs also confirm Windows supports `'loopback'` audio via virtual audio devices.
- **macOS: not supported through `'loopback'`.** Additional findings:
  - The `desktopCapturer` docs note that on **macOS 14.2+**, audio capture requires the **`NSAudioCaptureUsageDescription`** Info.plist key, because Chromium now defaults to Apple's **CoreAudio Tap API**. The older "Screen & System Audio Recording" permission path can be restored via a `disable-features` command-line switch.
  - Community reporting (Electron issue #45107, and release notes discussion for v39.0.0-beta.4) says Chromium made CoreAudio Tap the default with **no fallback**, and that a missing `NSAudioCaptureUsageDescription` produces a **dead audio stream with no warning or error** — a silent failure mode you must test for explicitly. *(Labelled as issue-tracker reporting, not formal docs.)*
  - **macOS 12.7.6 and earlier: desktop audio capture is fundamentally unsupported** (kernel-extension era), workaround = virtual audio device such as BlackHole.
  - The feature request to use **ScreenCaptureKit for loopback audio on macOS (electron/electron#47490)** is **closed**, and the issue page fetched here carried **no maintainer explanation**. The request itself notes a real implementation would likely mean *bundling and distributing a codesigned Swift/Obj-C helper binary*. → **Electron-native macOS system-audio loopback in 2026: `UNVERIFIED` / treat as NOT AVAILABLE.**

### macOS screen-recording consent (TCC)

- Screen content capture requires **user consent on macOS 10.15+**; detect state with `systemPreferences.getMediaAccessStatus('screen')` and guide the user to System Settings → Privacy & Security → Screen Recording when it is not `granted`.
- There is **no entitlement that grants screen recording** — it is TCC consent, granted per-app by the user, and keyed to the app's code signature (another reason the Developer ID identity must be stable).
- `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, and `NSAudioCaptureUsageDescription` **are** Info.plist requirements you control at build time.

### Recommended LIVETAP capture matrix

| Capability | Windows | macOS |
| --- | --- | --- |
| Screen/window video | `desktopCapturer` + `setDisplayMediaRequestHandler` | same; TCC consent gate + status check |
| Microphone | `getUserMedia` | same + `NSMicrophoneUsageDescription` |
| Camera | `getUserMedia` | same + `NSCameraUsageDescription` |
| **System (desktop) audio** | `audio: 'loopback'` / `'loopbackWithMute'` — **ship this** | **Not available natively.** Ship `NSAudioCaptureUsageDescription`, attempt capture, detect the dead-stream case, and fall back to a documented "install BlackHole / Loopback" flow. A bundled signed ScreenCaptureKit helper is the only first-class fix and is a separate, Mac-requiring project. |

**Ship decision:** treat macOS system audio as a **known, documented limitation for v1** with an in-app explainer, not as a blocker. Build the UI so a missing system-audio track degrades to mic-only rather than failing the broadcast.

## 1.6 Bundling per-platform `ffmpeg` binaries

The `electron-builder` documentation pages for the contents/configuration reference returned HTTP 404 at the URLs tried in this pass, so the mechanism below is stated at the level confirmed by the broader electron-builder docs; specifics flagged.

Confirmed pattern:

- **`extraResources`** copies files into the app's resources directory, reachable at runtime via `process.resourcesPath`. This is the right home for a large external executable.
- **`asar` + `asarUnpack`** — if a binary must live under `app/`, it has to be unpacked (`asarUnpack`) because you cannot `exec` a file inside an asar archive; it then resolves under `app.asar.unpacked/`.
- `files` controls what goes into the app archive; `extraFiles` copies next to the app rather than into resources.
- `${os}` / `${arch}` macros in `extraResources` paths: **`UNVERIFIED`** in this pass (docs URL 404'd). Verify before relying on it; the safe alternative is per-platform config blocks.

Recommended shape (verify macro support before use):

```jsonc
{
  "asar": true,
  "asarUnpack": ["**/node_modules/sharp/**"],
  "win":  { "extraResources": [{ "from": "vendor/ffmpeg/win32-x64/ffmpeg.exe", "to": "bin/ffmpeg.exe" }] },
  "mac":  { "extraResources": [
    { "from": "vendor/ffmpeg/darwin-arm64/ffmpeg", "to": "bin/ffmpeg" },
    { "from": "vendor/ffmpeg/darwin-x64/ffmpeg",   "to": "bin/ffmpeg-x64" }
  ]}
}
```

Runtime resolution:

```js
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : require('ffmpeg-static');
```

Non-obvious obligations:

1. **Execute permission** must survive packaging on macOS/Linux (`chmod +x` in a `beforePack`/`afterPack` hook if needed).
2. **macOS notarization covers every Mach-O binary in the bundle.** A bundled `ffmpeg` must be **signed with your Developer ID**, and the app needs the right entitlements — in practice `com.apple.security.cs.disable-library-validation` if `ffmpeg` links non-Apple dylibs, plus `com.apple.security.cs.allow-jit` which Electron itself needs.
3. **Licensing.** FFmpeg builds are LGPL-2.1+ or GPL-2.0+ depending on configure flags (`--enable-gpl`, `--enable-nonfree`). For an open-source LIVETAP this is manageable, but the *choice of build* is a legal decision, not a technical one: record which build you ship and its license in `docs/legal/`. Bundling a GPL `ffmpeg` alongside proprietary components is the classic trap. → Action item for the legal workstream; **not resolved here**.
4. **Size.** A full `ffmpeg` is ~70–100 MB per arch. Consider a reduced build with only the encoders/muxers LIVETAP needs (h264, aac, flv/rtmp, mpegts).

## 1.7 Code signing, packaging, auto-update

### Windows

- **Certificate hardware requirement:** since **2023-06-01** the CA/Browser Forum requires *every* publicly trusted code-signing key — **OV as well as EV** — to be generated in hardware meeting FIPS 140-2 Level 2 / Common Criteria EAL4+, non-exportable. (Reported by electron-builder's docs and multiple signing vendors; the CA/B baseline requirement itself is the authority — `UNVERIFIED` against the CA/B document directly.)
- **electron-builder `win.sign.type` options:** `signtool` (default — `.pfx`/`.p12` file or Windows cert store), `hsm` (Windows CSP-backed hardware), `pkcs11` (smart card / USB HSM on macOS/Linux), `azure` (Azure Trusted Signing).
- **OV vs EV:** OV is cheaper and exportable to `.pfx` (CI-friendly) but new publishers get a **SmartScreen "unknown publisher" warning that fades as download reputation accrues**. EV gets immediate SmartScreen reputation but its key is bound to a hardware token and **cannot be exported to a file** — so EV means `hsm`/`pkcs11`, or moving to Azure.
- **Azure Trusted Signing** — Microsoft's cloud signing service; no local key, works from any OS. electron-builder config:

```jsonc
{
  "win": {
    "sign": {
      "type": "azure",
      "endpoint": "https://weu.codesigning.azure.net/",
      "codeSigningAccountName": "livetap-signing",
      "certificateProfileName": "livetap-public",
      "publisherName": "CN=LIVETAP, O=..., C=..."
    }
  }
}
```
  with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` in the environment.
- **Azure Trusted Signing eligibility (as of Oct 2025, per vendor/community reporting — `UNVERIFIED` against Microsoft's current page):** US- and Canada-based organizations with **3+ years of verifiable business history**, and individual developers in the US and Canada. If LIVETAP's entity does not qualify, the fallback is an **OV certificate on an HSM/token** and accepting early SmartScreen friction.
- `signtool` file-based signing can be run from macOS/Linux via `osslsigncode` — i.e. **"you don't need Windows to sign a Windows app."** The converse is what hurts us (see macOS below).
- Default behaviour dual-signs each binary with **SHA-1 and SHA-256**; timestamping defaults to DigiCert and is configurable via `rfc3161TimeStampServer` / `timeStampServer`.

**Recommendation (Windows):** Azure Trusted Signing if eligible — cheapest path to a clean SmartScreen and no key custody. Otherwise an OV cert on a token with a self-hosted Windows signing runner. Either way, **signing is `BLOCKED_EXTERNAL_DEPENDENCY`** until a certificate/account exists.

### macOS

- Certificates: **Developer ID Application** for direct distribution (plus **Developer ID Installer** if you ship a `.pkg`); `3rd Party Mac Developer Installer` + `Apple Distribution` only if you also target the Mac App Store. Multiple certs can be exported into one `.p12` for CI, referenced by `CSC_LINK` / `CSC_KEY_PASSWORD`.
- `mac.sign.identity`: unset → search keychain and skip if absent; `null` → signing disabled; `"-"` → ad-hoc; or a certificate name.
- **Hardened runtime is enabled by default.** Electron needs `com.apple.security.cs.allow-jit`. If framework/library validation fails (common with ad-hoc signing or bundled third-party dylibs such as `ffmpeg`), the documented fix is to add **`com.apple.security.cs.disable-library-validation`** rather than disabling hardened runtime.
- **Notarization** runs through `notarytool` with either Apple ID + app-specific password + team ID, or an App Store Connect API key. electron-builder wires this via its `notarize` option.
- Entitlements files: `mac.entitlements` and `mac.entitlementsInherit` (the latter applies to helper processes — Electron's renderer/GPU helpers need the inherited set).

Minimum LIVETAP entitlements + Info.plist for macOS:

```xml
<!-- entitlements.mac.plist -->
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.device.camera</key><true/>
<key>com.apple.security.device.audio-input</key><true/>
<key>com.apple.security.network.client</key><true/>
```
```xml
<!-- Info.plist additions -->
<key>NSCameraUsageDescription</key><string>LIVETAP uses your camera for your live broadcast.</string>
<key>NSMicrophoneUsageDescription</key><string>LIVETAP uses your microphone for your live broadcast.</string>
<key>NSAudioCaptureUsageDescription</key><string>LIVETAP captures system audio so your viewers hear what you hear.</string>
```
(`com.apple.security.device.*` entitlements are the App Sandbox forms; for Developer ID + hardened runtime distribution outside the MAS the usage-description strings are the operative gate. Exact required set for a non-sandboxed hardened-runtime Electron app: **`UNVERIFIED`** — validate with a real notarization run.)

- **There is no Info.plist key or entitlement for macOS Screen Recording.** It is TCC-only, user-granted, and tied to the code signature.
- **Hard constraint:** macOS signing and notarization require Apple's toolchain, i.e. **a Mac (or a macOS CI runner)**. From this Windows host this is `BLOCKED_EXTERNAL_DEPENDENCY`.

### `electron-updater` trust model

- Unlike Electron's built-in `autoUpdater`, `electron-updater` performs **code-signature validation on Windows as well as macOS**.
- **Windows/NSIS:** at build time the resolved **publisher name is embedded into `app-update.yml`**; at update time `electron-updater` inspects the Authenticode certificate of the downloaded installer and compares its subject DN/CN against that publisher name, **refusing to install on mismatch**. This is the mechanism that stops a substituted or tampered update — and it means **your publisher name must stay stable across certificate renewals**, or older clients will refuse new updates. Plan certificate renewal with the same subject, and treat any subject change as a forced-reinstall event.
- **macOS:** the app must be code-signed for updates to work at all.
- Providers: GitHub Releases, S3, generic HTTP. Differential updates and staged rollouts are supported.
- **Residual risk:** the update *feed* is trusted for "what version exists"; the *artifact* is trusted via signature. Serve the feed over HTTPS, and if you use GitHub Releases treat repo-write access as equivalent to code-signing-adjacent power (an attacker with release-publish rights still cannot forge your signature, but can withhold or downgrade). Consider `allowDowngrade: false` and pinning channels.
- `electron-updater` has had real CVEs (e.g. CVE-2024-39698 in the GitLab advisory database). **Keep it pinned and patched; add it to a Dependabot/renovate watch list.**

### Crash reporting

Electron's `crashReporter.start()`:

- Must be called **before any other `crashReporter` API**, and **as early as possible — ideally before `app.on('ready')`**. Renderers created before init are not monitored.
- `submitURL` optional since v13 but **required unless `uploadToServer: false`**.
- Minidumps buffer in a `Crashpad` directory under the app's user-data path; relocate with `app.setPath('crashDumps', ...)` **before** `start()`.
- `start()` is main-process-only; expose any renderer-facing surface via `contextBridge`.
- `rateLimit` (macOS/Windows only) caps uploads at one per hour.

**Recommendation:** use `@sentry/electron`, which wraps `crashReporter` and adds JS-error capture, breadcrumbs, and release/sourcemap association. Set `uploadToServer: false` by default and flip it on only after the user opts in — a broadcasting app's crash dumps can contain stream keys and window titles. Scrub or deny-list before upload.

## 1.8 Why not Tauri v2

**Blocking, on this host:** Tauri v2's Windows prerequisites are (1) **Microsoft C++ Build Tools** with "Desktop development with C++", (2) **WebView2 Runtime**, (3) **Rust via rustup with the MSVC toolchain** as default host triple. The brief states **no Rust on this host** → Tauri is not buildable here without changing the host baseline.

**Even with Rust available, the trade-offs cut against LIVETAP:**

| Dimension | Electron 44 | Tauri v2 |
| --- | --- | --- |
| Renderer | Bundled Chromium M152 — identical on every OS | OS webview via WRY (WebView2 / WKWebView / WebKitGTK) — **rendering and media-stack behaviour differ per platform** |
| Bundle size | ~150–250 MB installed | Very small; "applications are very small because they use the OS's webview", no shipped runtime |
| `getDisplayMedia` + system audio | First-class `setDisplayMediaRequestHandler` with `'loopback'` on Windows | No equivalent documented API; you would implement capture in Rust per platform |
| WebRTC / codec parity | Chromium's full media stack | Whatever the host webview ships; WebKitGTK on Linux is the weak link |
| Auto-update signature validation | `electron-updater` validates Authenticode + macOS signatures | Tauri updater signs artifacts, different trust model — not evaluated here (`UNVERIFIED`) |
| Team skill match | React + Node throughout | Requires Rust for every native capability |

**Decision: Electron.** A live-broadcasting app is *all* media-stack: screen capture, system audio, WebRTC, encoder handoff. Deterministic Chromium behaviour across macOS and Windows is the single most valuable property, and Tauri trades exactly that away. Revisit only if install size becomes a top-three user complaint.

---

# Part 2 — MOBILE (Capacitor vs Expo / React Native)

## 2.1 Capacitor 8 requirements (2026)

From the official "Updating to 8.0" guide:

| Requirement | Value |
| --- | --- |
| **Node.js** | **≥ 22** (latest LTS recommended) |
| Xcode | **26.0+** |
| iOS deployment target | **15.0** |
| Android Studio | Otter \| 2025.2.1+ |
| Android `minSdk` | **24** |
| Android `compileSdk` | **36** |
| Android `targetSdk` | **36** |
| Android Gradle Plugin | 8.13.0 |
| Gradle wrapper | 8.14.3 |
| Kotlin | 2.2.20 |
| iOS package manager | **Swift Package Manager by default** for new projects (`--packagemanager CocoaPods` to opt out) |
| Breaking | `android.adjustMarginsForEdgeToEdge` removed → use the new **System Bars** plugin |
| Breaking | Android manifest must add `density` to the activity's `configChanges` to stop the WebView reloading on resize |

> **`FAIL` on this host:** Node **20.11** < 22. The Capacitor 8 CLI will not run. **Action: install Node 22 LTS (or 24) on the build host.** This is local and fixable, and it also matches Vercel's runtime direction (§4.4).

Note the nice alignment: **Capacitor 8's `targetSdk 36` already satisfies Google Play's August 2026 requirement**, and **Xcode 26 already satisfies Apple's April 2026 minimum SDK requirement**. Being on Capacitor 8 is the cheapest way to be compliant on both stores.

## 2.2 WKWebView media capture and permission strings

- **`getUserMedia` works in WKWebView since iOS 14.3** — Apple made camera and microphone available to WKWebView then, which is what makes a Capacitor-hosted WebRTC/preview UI viable at all.
- Required `Info.plist` keys: **`NSCameraUsageDescription`** and **`NSMicrophoneUsageDescription`**. Per community/Apple-forum reporting, `NSCameraUsageDescription` alone is sufficient for camera access from web content in WKWebView, and `NSMicrophoneUsageDescription` must be present for web content to reach the mic.
- Access is gated by a **user prompt equivalent to Safari's**. On iOS 15+ there is also a `WKUIDelegate` hook (`decideMediaCapturePermissionsFor...`) if you want to pre-authorize your own origin — exact selector and Capacitor's handling of it: **`UNVERIFIED`**.
- Capacitor's own Camera plugin (if used for stills) additionally wants `NSPhotoLibraryUsageDescription` and `NSPhotoLibraryAddUsageDescription`; Android storage permissions only when `saveToGallery: true` (`READ_EXTERNAL_STORAGE` maxSdk 32, `WRITE_EXTERNAL_STORAGE` maxSdk 29).

Android manifest for capture:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

## 2.3 iOS background behaviour for live streaming — the defining constraint

This is the most important mobile finding in the document.

- **iOS does not allow camera use in the background.** When the app backgrounds, `AVCaptureSession` is interrupted with reason `videoDeviceNotAvailableInBackground`; starting a session in the background yields `AVError.Code.deviceIsNotAvailableInBackground`. (Both are Apple API-reference facts.)
- **`UIBackgroundModes: audio`** keeps audio playback/recording alive in the background and is the standard mechanism for media and video-chat apps. Apple reviews its use and it must reflect genuine audio functionality — it is not a "keep my app alive" switch. *(The `UIBackgroundModes` reference page fetched in this pass returned only a title; the value semantics above are stated at the level of common Apple documentation and should be re-verified — **partially `UNVERIFIED`**.)*
- **Multitasking camera access exists but is gated.** Per Apple-forum and SDK reporting: `AVCaptureSession.isMultitaskingCameraAccessSupported` is `true` for apps linked against **iOS 18+** that declare **`voip`** in `UIBackgroundModes`, **or** that hold the **`com.apple.developer.avfoundation.multitasking-camera-access`** entitlement — **which must be requested from Apple**. *(Reported, not read from a primary Apple page in this pass — `UNVERIFIED`.)*
- WKWebView `getUserMedia` microphone has been reported to **mute when backgrounded** (Apple Developer Forums thread 689182). → **Do not build the capture path on top of WebView `getUserMedia` if backgrounding must survive.**

**Design consequence for LIVETAP iOS:**

1. Camera-facing broadcast **will stop when the user leaves the app**, unless you obtain the multitasking-camera-access entitlement. Plan the UX around this: on background, either (a) continue **audio-only** with a "camera paused" slate frame pushed by the native encoder, or (b) pause and offer resume.
2. Declare `UIBackgroundModes: audio`, configure `AVAudioSession` appropriately, and keep the **native** encoder (not the WebView) owning the audio path so the RTMP/SRT connection survives the transition.
3. **Screen broadcasting is the sanctioned way to keep streaming while the user is in other apps** — that is exactly what ReplayKit's Broadcast Upload Extension is for (§2.4).
4. Apply for the multitasking-camera-access entitlement early if camera-while-backgrounded is a product requirement — it is an Apple-gated request with unknown lead time. `BLOCKED_EXTERNAL_DEPENDENCY`.

## 2.4 iOS screen broadcast — ReplayKit Broadcast Upload Extension

From Apple's `RPBroadcastSampleHandler` documentation plus widely-reported implementation constraints:

- The extension subclasses `RPBroadcastSampleHandler` and receives `processSampleBuffer(_:with:)` for three buffer types: **`video`**, **`audioApp`** (app + system audio), **`audioMic`**. It also owns broadcast lifecycle (start/pause/resume/finish) and error signalling.
- The extension communicates with the host app via an **App Group** (shared `UserDefaults`, shared container files, and the finish handler).
- Starting a broadcast: **`RPSystemBroadcastPickerView`** (iOS 12+) — reported as *the only supported trigger on iOS 18 and iOS 26*. *(Community-reported; `UNVERIFIED` against Apple docs.)*
- **Memory limit: ~50 MB, hard.** Apple's docs say "strict memory limits" and "extensions must process samples efficiently to avoid termination" without publishing a figure; the **50 MB** number comes from Apple Developer Forums threads and vendor docs (Tencent, Twilio, Forasoft) and from `replayd` jetsam "highwater" reports. **Treat 50 MB as the working budget, and note it is community-established, not documented.** Reported mitigations: downsample to 720p, use the **H.264 hardware encoder**, throttle to 15–30 fps, avoid VP8. **Test on iPad Pro specifically** — the same pipeline that fits on iPhone has been reported to blow the limit on iPad.

**Architecture recommendation:** run the **RTMP/SRT publisher inside the broadcast extension** (HaishinKit.swift supports ReplayKit capture directly) rather than shuttling frames to the host app over the App Group. Frame IPC through App Group + Darwin notifications + IOSurface is possible but adds copies and memory pressure you cannot afford inside 50 MB. The host app's job becomes: authenticate, resolve the ingest URL + stream key, write them to the shared App Group container, and present the picker.

Required project pieces (all `BLOCKED_EXTERNAL_DEPENDENCY` — need Xcode + an Apple account):

- A second target: Broadcast Upload Extension.
- An **App Group** (`group.example.livetap.broadcast`) enabled on both the app and the extension.
- Provisioning profiles for both, and the extension counted in your App Store submission.

## 2.5 Android screen capture — MediaProjection + foreground service

### Android 14 (API 34) requirements — foreground service types

Declared in the manifest and **also declared in Play Console** (Policy → App content → foreground service types; all apps targeting Android 14+ must do this):

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />

<service
    android:name=".LivetapBroadcastService"
    android:foregroundServiceType="mediaProjection|camera|microphone"
    android:exported="false" />
```

Runtime ordering is strict:

1. Call `MediaProjectionManager.createScreenCaptureIntent()` and get user consent **before** starting the foreground service.
2. `ServiceCompat.startForeground(service, id, notification, FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)` (androidx-core 1.12+).
3. Then `getMediaProjection(resultCode, data)`.

Failure modes from the docs: missing type-specific permission → `SecurityException`; missing manifest `foregroundServiceType` → `MissingForegroundServiceTypeException`; unmet runtime prerequisite → `SecurityException`. `camera` and `microphone` FGS types are subject to **while-in-use restrictions** — you cannot create them from the background.

### Android 14 behaviour changes — consent is now single-use

For apps targeting API 34+:

- **`SecurityException` if you cache the `createScreenCaptureIntent()` Intent and reuse it** across `getMediaProjection()` calls.
- **`SecurityException` if you call `createVirtualDisplay()` more than once on the same `MediaProjection` instance.** Each `MediaProjection` is **one capture session, one virtual display**.
- On configuration change (rotation / resize) **do not create a new `MediaProjection`** — call `VirtualDisplay.resize(...)` and `VirtualDisplay.setSurface(...)`.
- You **must** register a `MediaProjection.Callback` (handle `onStop()` by releasing the VirtualDisplay/Surface) or `createVirtualDisplay()` throws **`IllegalStateException`**.

### Android 15 / 16

- **Android 15:** a `BOOT_COMPLETED` receiver **cannot** launch a `mediaProjection` foreground service (`ForegroundServiceStartNotAllowedException`). Also, using `SYSTEM_ALERT_WINDOW` to start a foreground service now requires both the permission **and a visible `TYPE_APPLICATION_OVERLAY` window** before the start.
- **Android 16 (targetSdk 36):** see orientation, §2.6. The Android 16 "behavior changes for apps targeting 16" page fetched here **did not** cover media-projection or FGS media-processing changes → **`UNVERIFIED`; check `/about/versions/16/behavior-changes-all` and `/about/versions/15/changes/foreground-service-types` before implementation.**

## 2.6 Orientation, battery, thermal

**Orientation — a real Android 16 gotcha.** For apps targeting **API 36**, on displays with **smallest width ≥ 600dp**, Android **ignores** `android:screenOrientation`, `android:resizableActivity`, `android:minAspectRatio`, `android:maxAspectRatio`, `Activity.setRequestedOrientation()` and `getRequestedOrientation()`, including all portrait/landscape/sensor/user values. Apps fill the display window; pillarboxing is gone. Exceptions: games (via `android:appCategory`), user-opted-in device aspect-ratio settings, and screens smaller than `sw600dp`.

Temporary opt-out (activity- or application-level), **which stops working at API 37+**:

```xml
<property android:name="android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY"
          android:value="true" />
```

**Consequence:** a "portrait-locked broadcaster" design will break on tablets/foldables running Android 16 with `targetSdk 36` — which is exactly the configuration Capacitor 8 gives you. **Design the capture UI to be genuinely responsive** (and remember Capacitor 8 also now requires `density` in `configChanges` to avoid WebView reloads on resize). Do not lean on the opt-out property as a strategy.

iOS orientation is handled per-target in Xcode / `Info.plist` (`UISupportedInterfaceOrientations`), optionally via a screen-orientation Capacitor plugin — **plugin name/version `UNVERIFIED`** in this pass.

**Battery and thermal: `UNVERIFIED`.** Not researched against primary docs in this pass. Known API surfaces to investigate next: iOS `ProcessInfo.processInfo.thermalState` + `NSProcessInfoThermalStateDidChange`, and Android `PowerManager.getCurrentThermalStatus()` / `addThermalStatusListener`. Design intent to validate: subscribe to thermal state and **step down resolution/bitrate/fps automatically** rather than letting the OS throttle the encoder mid-broadcast. Treat this as a follow-up research task, not a settled design.

## 2.7 Deep links / universal links for OAuth callbacks on mobile

From Capacitor's deep-links guide:

- **iOS Universal Links:** host `apple-app-site-association` (no extension, JSON, Team ID + Bundle ID) at `https://livetap.example/.well-known/apple-app-site-association`; add the **Associated Domains** capability with `applinks:livetap.example`. Apple provides an [App Search validation tool](https://search.developer.apple.com/appsearch-validation-tool/).
- **Android App Links:** host `.well-known/assetlinks.json` generated with your **SHA-256 signing-certificate fingerprint**, plus an `intent-filter` on the activity. **Critical:** with Play App Signing the fingerprint that matters is the **app signing key** Google holds (available in Play Console → Setup → App integrity), not your upload key — a classic cause of App Links silently falling back to the browser.
- **Handling in JS:** `App.addListener('appUrlOpen', (event) => { ... })`, then route on the parsed URL.
- Both association files must be served over **HTTPS** from `.well-known/` (framework-specific static dirs: `public/` for React).

**OAuth specifically — do not use a plain in-app browser.**

- **`@capacitor/browser` uses `SFSafariViewController` on iOS** (confirmed in its docs). The Android engine is not stated on that page (`UNVERIFIED`; Custom Tabs is the expectation).
- `SFSafariViewController` is **not** `ASWebAuthenticationSession`. For OAuth you want `ASWebAuthenticationSession` on iOS (ephemeral session support, system-managed callback interception, the OS-level "wants to use … to sign in" consent) and **Chrome Custom Tabs** on Android — this is what RFC 8252 (OAuth 2.0 for Native Apps) calls for.
- **Which Capacitor plugin to use for `ASWebAuthenticationSession` is `UNVERIFIED`.** Candidates to evaluate (verify maintenance status, Capacitor 8 support, and license before adopting): `@byteowls/capacitor-oauth2`, Capawesome's social-login / OAuth offerings, and community `capacitor-native-*` wrappers. **Do not adopt one without checking it is Capacitor-8-compatible and actively maintained.**

**Recommended mobile OAuth shape:** ASWebAuthenticationSession / Custom Tabs → authorization code + PKCE → **universal link / App Link callback** (`https://livetap.example/oauth/callback`), not a custom scheme. Universal links cannot be hijacked by another app the way a custom scheme can. Keep the Twitch exchange server-side (§1.3).

## 2.8 Secure storage on mobile

| Plugin | License | iOS backend | Android backend | Notes |
| --- | --- | --- | --- | --- |
| **`aparajita/capacitor-secure-storage`** | **MIT** | encrypted system **Keychain** | **AES-GCM** key generated by **Android KeyStore**, ciphertext in SharedPreferences | Explicitly **requires Capacitor 8**; web impl is unencrypted localStorage (debug only) |
| Capawesome **Secure Preferences** | `UNVERIFIED` (Capawesome products are partly commercial) | iOS **Keychain** | **Android Keystore** | Marketed as the actively maintained successor to Ionic Secure Storage; supports Android/iOS/Web |
| `martinkasa/capacitor-secure-storage-plugin` | `UNVERIFIED` | Keychain | AndroidKeyStore + SharedPreferences / EncryptedSharedPreferences | Long-standing community plugin |
| `@evva/capacitor-secure-storage-plugin`, `@atroo/...` | `UNVERIFIED` | — | — | Forks/variants; verify maintenance |
| Ionic **Secure Storage** (commercial) | Commercial | — | — | **Sunsets 2027-12-31** — do not adopt |

**Recommendation: `aparajita/capacitor-secure-storage`** — MIT (clean for an open-source product), explicit Capacitor 8 support, and the right native primitives on both platforms. Verify its current release against Capacitor 8 at adoption time.

**Storage policy (mirrors §1.4):** store only short-lived LIVETAP session tokens and OAuth refresh tokens. Never persist raw destination stream keys on device if the backend can mint per-session credentials. On iOS, set Keychain accessibility no looser than `WhenUnlockedThisDeviceOnly` for anything stream-key-shaped (exact plugin option name: `UNVERIFIED`).

## 2.9 Native RTMP / SRT libraries and how a Capacitor plugin exposes them

| Library | License | Platform | Protocols | Screen capture | Version / status (2026) |
| --- | --- | --- | --- | --- | --- |
| **HaishinKit.swift** | **BSD-3-Clause** | iOS 15.0+ (also macOS/tvOS) | **RTMP, SRT**, WHEP/WHIP (alpha) | **ReplayKit** (iOS), ScreenCaptureKit (macOS) | **2.2.0+**, needs **Xcode 26+ / Swift 6.0+**; actively maintained, 10th anniversary, 3,061 commits |
| **HaishinKit for Android (Kotlin)** | **BSD-3-Clause** | Android | comparable | — | Same project family |
| **RootEncoder** (was `rtmp-rtsp-stream-client-java`) | **Apache-2.0** | Android (minSdk 16; 21+ for extra video sources) | **RTMP/RTMPS/RTMPT, RTSP/RTSPS (TCP+UDP), SRT (encryption + packet resend), UDP**, WHIP (beta) | **MediaProjection (API 21+)** built in | **2.8.1**, 3,000+ stars, active |
| **RootEncoder-iOS** | Apache-2.0 (assumed same repo family — `UNVERIFIED`) | iOS | — | — | Exists as a separate repo |

RootEncoder extras worth noting: Camera1/Camera2, codecs **H264, H265, AV1, VP8, VP9, AAC, OPUS, G711**, real-time OpenGL filters, noise suppression + echo cancellation, and simultaneous MP4 recording while streaming (API 18+).

**Recommendation:**
- **Android → RootEncoder** (Apache-2.0, broadest codec/protocol matrix, MediaProjection integrated, OpenGL filters for overlays).
- **iOS → HaishinKit.swift** (BSD-3, SRT + RTMP, and — decisively — first-class ReplayKit support for the broadcast extension; already aligned on iOS 15 / Xcode 26 with Capacitor 8).
- Both licenses (BSD-3 and Apache-2.0) are permissive and compatible with an open-source product and with App Store / Play distribution. **Apache-2.0 requires shipping the license text and a NOTICE file if present; BSD-3 requires the copyright notice and the no-endorsement clause.** Record both in `docs/legal/THIRD_PARTY_LICENSES.md`.
- Accepting two different libraries means two encoder behaviours to test; the unifying layer is your plugin's TypeScript contract.

### Capacitor plugin skeleton

Scaffold with `npm init @capacitor/plugin@latest`. Capacitor's guidance: *"plugins should strive to provide a unified experience across platforms that is familiar to JavaScript developers"* — coerce native values to consistent JS types, use identical units, and prefer ISO-8601 datetimes with timezones.

> The `creating-plugins` page fetched here points to platform-specific sub-pages for the actual decorators and event mechanics. The `@objc` / `CAPPluginMethod` / `@CapacitorPlugin` / `@PluginMethod` specifics are therefore **`UNVERIFIED` in exact form** — read `capacitorjs.com/docs/plugins/ios` and `/android` before writing code.

Proposed TS contract (platform-agnostic, thin, event-driven):

```ts
export interface LivetapStreamPlugin {
  // lifecycle
  prepare(o: { width: number; height: number; fps: number;
               videoBitrate: number; audioBitrate: number;
               codec: 'h264' | 'hevc' }): Promise<void>;
  startPreview(o: { position: 'front' | 'back' }): Promise<void>;
  start(o: { url: string; streamKey?: string;
             protocol: 'rtmp' | 'rtmps' | 'srt';
             srtPassphrase?: string }): Promise<void>;
  stop(): Promise<void>;
  // controls
  switchCamera(): Promise<void>;
  setMuted(o: { muted: boolean }): Promise<void>;
  setBitrate(o: { videoBitrate: number }): Promise<void>;   // for thermal/network backoff
  // screen broadcast
  startScreenBroadcast(): Promise<void>; // iOS: presents RPSystemBroadcastPickerView
                                         // Android: createScreenCaptureIntent + FGS
  // introspection
  getCapabilities(): Promise<{ srt: boolean; hevc: boolean;
                               systemAudio: boolean;
                               backgroundCamera: boolean }>;
  addListener(e: 'stateChange' | 'stats' | 'error',
              cb: (d: unknown) => void): Promise<PluginListenerHandle>;
}
```

`getCapabilities()` is the honest way to surface the platform asymmetries in §2.3/§1.5 to the React layer instead of hiding them behind a lying uniform API.

## 2.10 Building iOS without a Mac — Expo/EAS vs Capacitor CI options

| Option | iOS build without a Mac | Cost (2026) | Capacitor support |
| --- | --- | --- | --- |
| **Expo EAS Build** | **Yes** (cloud macOS workers) | **Free: 15 iOS + 15 Android builds/month**; Starter **$19/mo**; Production **$199/mo** (+usage). Large workers are paid-only | **No** — EAS is for React Native/Expo. Listed here only as the comparison the brief asked for |
| **GitHub Actions macOS runners** | **Yes** | **Free for public repositories** — Vercel-independent, quoted from GitHub's billing docs: *"The use of standard GitHub-hosted runners is free: In public repositories."* Private repos: 2,000 min (Free) / 3,000 (Pro, Team) / 50,000 (Enterprise Cloud), with macOS billed ~10× Linux; post-2026-01-01 rates: Linux 2-core **$0.006/min**, Windows 2-core **$0.010/min**, macOS 3–4 core **$0.062/min** | **Yes** — you drive `xcodebuild` yourself |
| **Ionic Appflow** | Yes | From **$499/mo**, **but being shut down**: no new customers, no new features; existing apps work **until 2027-12-31** *(reported by Capawesome/Capgo — `UNVERIFIED` against an Ionic announcement page)* | Official Capacitor support, but **do not adopt** |
| **Capawesome Cloud** | Yes | Live updates from **$9/mo**; full platform with cloud builds from **$19/mo**; unlimited live updates, no per-seat fees *(vendor pricing)* | Positioned as a drop-in Appflow replacement |
| **Codemagic** | Yes | Not captured in this pass — `UNVERIFIED` | Has official Capacitor documentation |
| **Bitrise** | Yes | `UNVERIFIED` | Full CI/CD; needs configuration for Capacitor |
| **VoltBuilder** | Yes | `UNVERIFIED` | Out-of-the-box Capacitor/Cordova native builds |

### Recommendation

**LIVETAP is open source → use GitHub Actions macOS runners.** Standard macOS runners are free on public repositories with no allowance to exhaust, which makes this both the cheapest and the most transparent option, and it keeps the build definition in the repo rather than in a vendor's UI.

What GitHub Actions does **not** solve (all `BLOCKED_EXTERNAL_DEPENDENCY`):

- **Apple Developer Program membership** (~$99/yr) for certificates, provisioning profiles, App Groups, and distribution.
- **Certificates and profiles** must be created (via a Mac or the developer portal) and injected as encrypted secrets (`match`/`fastlane` or manual keychain import in the workflow).
- **App Store Connect API key** for `xcrun altool`/`notarytool` uploads.
- **Physical device testing** — a simulator cannot validate camera capture, ReplayKit broadcast, thermal throttling, or real RTMP/SRT behaviour on cellular. Budget for at least one iPhone and one iPad (the ReplayKit memory limit specifically bites on iPad).

**The same macOS runner solves the Electron macOS problem** (§1.7): use it to sign + notarize the macOS build. One CI investment, two platforms unblocked.

---

# Part 3 — STORE READINESS

## 3.1 Apple App Store (2026)

### 3.1.1 Guideline 1.2 — User-Generated Content

Apps with UGC or social networking **must include all four** of the following (quoted from the guidelines):

1. *"A method for filtering objectionable material from being posted to the app"*
2. *"A mechanism to report offensive content and timely responses to concerns"*
3. *"The ability to block abusive users from the service"*
4. *"Published contact information so users can easily reach you"*

Plus: *"It is your responsibility to remove content that violates this guideline, your terms of service, or your community standards."* And the teeth: *"Egregious or repeated behavior is grounds for immediate removal of your app from the App Store, and from the Apple Developer Program."*

**For LIVETAP this is a first-class product requirement, not a checkbox.** A live-broadcasting app is the highest-risk 1.2 category there is. Minimum build-out: pre-publish filtering on titles/descriptions/thumbnails and on live chat, an in-broadcast report button with a triaged queue and a stated response SLA, a user-level block that survives across sessions, and a support email/URL in both the app and the App Store listing. Live video moderation additionally needs a kill-switch to terminate a stream, which should exist server-side at the ingest layer.

### 3.1.2 Guideline 4.8 — does destination OAuth trigger Sign in with Apple?

**Our analysis: no — but with a bright line you must not cross.**

The guideline text applies to apps that *"use a third-party or social login service (such as Facebook Login, Google Sign-In, Log in with X, Sign In with LinkedIn, Login with Amazon, or WeChat Login) **to set up or authenticate the user's primary account with the app***."

- Connecting a **YouTube or Twitch account as a streaming destination** is not setting up or authenticating the user's primary LIVETAP account. It is an authorization grant for an API scope. On a plain reading, **4.8 is not triggered.**
- 4.8's own exception list reinforces this: *"Your app is a client for a specific third-party service and users are required to sign in to their mail, social media, or other third-party account directly."*
- Also relevant: *"Your app exclusively uses your company's own account setup and sign-in systems."* If LIVETAP accounts are email/password or a LIVETAP-proprietary identity only, that exception covers you outright.

**Where it flips:** the moment LIVETAP offers **"Sign in with Google"** or **"Sign in with Twitch"** as a way to create or log into a LIVETAP account, 4.8 applies and you must also offer an equivalent privacy-focused option — one that (per the guideline) *limits data collection to the user's name and email address*, *allows users to keep their email address private*, and *does not collect interactions with your app for advertising purposes without consent*. In practice that means **Sign in with Apple**.

**Recommendation:** keep the two flows architecturally and visually distinct. Account login = LIVETAP identity (email/passkey) — optionally plus Sign in with Apple for convenience. Destination connection = a separate "Connect a destination" surface, entered from settings, clearly labelled as authorizing publishing to that platform. If a growth decision later adds social login for accounts, **Sign in with Apple becomes mandatory in the same release**.

> This is our reading of the guideline text, not an Apple ruling. App Review applies judgement. If the product does anything ambiguous here, use an App Review pre-submission inquiry rather than guessing.

### 3.1.3 Guideline 5.1.1(v) — account deletion

From the guidelines and Apple's "Offering Account Deletion in Your App" support page (effective **2022-06-30**, applying to new submissions and to updates of apps with account creation):

- *"If your app supports account creation, you must also offer account deletion within the app."*
- Deletion must be **initiatable in the app**. If completion requires the web, **include a direct link to that specific page**. **Not allowed:** requiring a phone call, an email, or a generic support flow (exception: highly regulated industries, 5.1.1(ix)).
- Must be **easy to find** (account settings), must delete **the full account and associated personal data** — **deactivation/disable is insufficient** — and must cover user-generated content (photos, videos, posts, reviews).
- Guest/auto-created accounts must also be deletable.
- Reauthentication and confirmation (email code, phone verification) **are permitted** to prevent accidents.
- Asynchronous deletion is acceptable if you **state the timeline and confirm completion**.
- **If you use Sign in with Apple, you must revoke user tokens via the Sign in with Apple REST API on deletion.**
- Applies to **all users worldwide**, regardless of CCPA/GDPR compliance.

**LIVETAP implication:** account deletion must also revoke stored OAuth grants at YouTube/Twitch and purge stream keys and VOD/recording artifacts. Build deletion as a server-side job with a status the app can poll and display.

### 3.1.4 Privacy nutrition labels (App Privacy Details)

Must declare, per data type, the **categories collected** (Contact Info; Health & Fitness; Financial Info; Location — precise/coarse; Sensitive Info; User Content — incl. **Photos/Videos, Audio Data**; Browsing & Search History; Identifiers — User ID/Device ID; Usage Data; Diagnostics — Crash/Performance; Surroundings), the **purposes** (Third-Party Advertising; Developer's Advertising/Marketing; Analytics; Product Personalization; App Functionality; Other), and the **linkage**: *Data Linked to You*, *Data Not Linked to You*, and *Data Used to Track You*.

- "Tracking" = linking your app's data with **third-party data** for targeted advertising/measurement, or sharing with a **data broker**. On-device-only linking is not tracking; data-broker use solely for fraud/security is not tracking.
- **You are responsible for disclosing data collected by third-party SDKs and partners**, not just your own code.
- A **Privacy Policy URL is required**; a Privacy Choices URL is optional and recommended.
- Narrow exemption: data may not need disclosure if it is not used for tracking or any advertising/marketing, collection is **infrequent and optional**, and the user explicitly provides it each time through a clear interface.

**LIVETAP-specific:** a broadcasting app collects **User Content → Photos/Videos and Audio Data** by definition; if you keep chat, that is **User Content → Emails or Text Messages**. Crash reporting (§1.7) adds **Diagnostics**. Analytics adds **Usage Data**. Declare all of them, and keep the labels in sync with the Sentry/analytics configuration — drift here is a common rejection and a real trust problem.

### 3.1.5 Privacy Manifest (`PrivacyInfo.xcprivacy`) and required-reason APIs

Required-reason API categories and their `NSPrivacyAccessedAPIType` keys:

| Category | Key |
| --- | --- |
| File timestamp | `NSPrivacyAccessedAPITypeFileTimestamp` |
| System boot time | `NSPrivacyAccessedAPITypeSystemBootTime` |
| Disk space | `NSPrivacyAccessedAPITypeDiskSpace` |
| Active keyboard | `NSPrivacyAccessedAPITypeActiveKeyboard` |
| **User defaults** | `NSPrivacyAccessedAPITypeUserDefaults` |

Each usage needs an approved reason code in `NSPrivacyAccessedAPITypeReasons`; Apple validates that declared reasons match actual usage, and mismatches cause rejection.

```xml
<key>NSPrivacyAccessedAPITypes</key>
<array>
  <dict>
    <key>NSPrivacyAccessedAPIType</key>
    <string>NSPrivacyAccessedAPITypeUserDefaults</string>
    <key>NSPrivacyAccessedAPITypeReasons</key>
    <array><string>CA92.1</string></array>
  </dict>
</array>
```
(`CA92.1` = "access info from user defaults only for the app itself / app group" — the reason code string is the commonly used one; **`UNVERIFIED` exact code list** in this pass. Read the reason tables on the required-reason API page before submitting.)

**Third-party SDK requirements — and `Capacitor` is on the list.** Apple's commonly-used SDK list explicitly includes **`Capacitor`** and **`Cordova`** (alongside Firebase*, GoogleSignIn, Alamofire, AppAuth, hermes, Flutter, OneSignal*, OpenSSL, SDWebImage, etc.). For any listed SDK: a **privacy manifest is required** when submitting new apps or updates that include it, and a **code signature is required when it is used as a binary dependency**. Any version of a listed SDK, and anything that repackages one, is in scope.

- **Enforcement dates: not stated on Apple's third-party SDK requirements page** as fetched — it is worded as a condition of submission rather than a dated deadline. → `UNVERIFIED` on dates; treat as **already in force**.
- **Action:** confirm the Capacitor 8 release ships `PrivacyInfo.xcprivacy` and is signed; your own app target also needs its own `PrivacyInfo.xcprivacy` covering the data types in §3.1.4 and any required-reason APIs your plugin uses (Capacitor Preferences → `UserDefaults`).

### 3.1.6 Age rating (2025 overhaul)

- New tiers: **4+, 9+, 13+, 16+, 18+**. The old **12+ and 17+ were removed**.
- A **new questionnaire** with additional sensitive-content questions, plus the ability to set a higher rating to reflect a minimum age requirement.
- **Deadline was 2026-01-31** — completing the new questionnaire is mandatory, and **Apple blocks new submissions and updates** for apps that have not. That date is in the past as of this document, so treat it as a **hard gate on your very first submission**.
- Apple auto-migrated existing apps' ratings, but developers remain responsible for answering accurately.

*(These specifics come from Apple's developer news/upcoming-requirements posts as reported by multiple secondary sources; the underlying Apple news items are `developer.apple.com/news/?id=ks775ehf` and `/news/upcoming-requirements/?id=07242025a`. **Verify the exact current questionnaire in App Store Connect** — that is the authoritative surface.)*

**LIVETAP note:** a live-UGC app with unmoderated chat will land at a high rating. The rating you choose interacts with 1.2 — claiming a low age rating while hosting unfiltered live UGC is an invitation to rejection.

### 3.1.7 Export compliance

`ITSAppUsesNonExemptEncryption` in `Info.plist`. Set to `false` only if the app uses **only standard HTTPS/TLS via OS frameworks**, implements no custom/proprietary crypto, does no encryption of data at rest, and ships no encrypted executables. Otherwise `true`, and you may owe a **CCATS** classification and/or a **year-end self-classification report**.

**LIVETAP decision item:** RTMPS is TLS (exempt-shaped), but **SRT with a passphrase uses AES** inside the library, and HaishinKit/RootEncoder bundle their own crypto rather than calling only Apple frameworks. That plausibly pushes you to `ITSAppUsesNonExemptEncryption = true` with a self-classification report.

> **This is a legal/compliance determination, not an engineering one.** The guidance summarized above is generic; **`UNVERIFIED`** as applied to SRT/AES specifically. Route to counsel or an export-compliance specialist before your first submission, and record the determination in `docs/legal/`.

### 3.1.8 Screenshots

- **1 to 10** screenshots per device type; `.jpg`/`.jpeg`/`.png`; **no alpha channel or transparency**.
- **iPhone: 6.9" is required** (unless you supply 6.5" as the fallback, which Apple then scales).

| Display | Portrait | Landscape |
| --- | --- | --- |
| **6.9"** (iPhone 17/18 Pro Max, 16 Pro Max, 16 Plus, 15 Pro Max…) | **1260 × 2736** | 2736 × 1260 |
| 6.5" (fallback) | 1284 × 2778 | 2778 × 1284 |
| 6.3" | 1179 × 2556 | 2556 × 1179 |
| 6.1" | 1170 × 2532 | 2532 × 1170 |

- **iPad: required if the app runs on iPad.**

| Display | Portrait | Landscape |
| --- | --- | --- |
| **13"** (iPad Pro M5/M4, iPad Air M4/M3/M2) | **2064 × 2752** | 2752 × 2064 |
| 11" | 1488 × 2266 | 2266 × 1488 |

**Minimum viable set: 6.9" iPhone + 13" iPad.** Given §2.6 (Android 16 ignoring orientation on large screens) and iPad multitasking, capture **landscape** variants too.

### 3.1.9 Minimum Xcode / SDK for submission

**Starting 2026-04-28, apps uploaded to App Store Connect must be built with Xcode 26 or later using the iOS 26 / iPadOS 26 (or tvOS 26 / visionOS 26 / watchOS 26) SDK.** This applies to new apps and updates; already-live versions stay available. Building against the iOS 26 SDK does **not** raise your deployment target — keep `IPHONEOS_DEPLOYMENT_TARGET = 15.0` per Capacitor 8.

**Already satisfied by Capacitor 8, which requires Xcode 26.0+.**

### 3.1.10 TestFlight

- **Internal testers: up to 100 team members** (Account Holder, Admin, App Manager, Developer, Marketing roles).
- **External testers: up to 10,000.**
- **Up to 30 devices per tester**; **up to 100 builds** shared/tested concurrently.
- **Your first build must be approved by App Review for TestFlight before you can invite external testers**; subsequent builds go to review automatically when added to a group.
- External testing requires a beta app description and review information.
- Invitations by email or **public link** (with optional device/OS enrollment criteria).

**Plan:** internal TestFlight for the team, then a small external group (the Beta App Review is a real gate with real latency — schedule it, don't discover it).

---

## 3.2 Google Play (2026)

### 3.2.1 Target API level

Starting **2026-08-31**:

- **New apps and app updates** — standard apps must target **Android 16 (API 36)** or higher. (Wear OS / Automotive: API 35+; Android TV / XR: API 34+.)
- **Existing apps** — must target **API 35+** to remain available to **new users on devices running an Android OS higher than the app's target**. *"Apps that target Android 14 (API level 34) or lower will only be available on devices running Android OS that are the same or lower than the app's target API level."*
- **Extension available to 2026-11-01**; extension forms appear in Play Console later in 2026.
- Exempt: permanently private apps distributed only internally within specific organizations.

**Capacitor 8's `targetSdk 36` satisfies this.** The price is inheriting the Android 16 orientation/resizability behaviour in §2.6.

### 3.2.2 Data safety form

- **Mandatory for all apps.** *"You alone are responsible for making complete and accurate declarations."*
- Covers **13 data-type categories** (Location precise/approximate; Personal info; Financial info; Health & fitness; **Messages/Communications**; **Photos, videos, audio (Media)**; App activity; Device/other identifiers; …), each classified by purpose (app functionality, analytics, marketing, fraud prevention, personalization, account management, developer communications).
- **You must report data handling by third-party libraries and SDKs**, both on-device and off-device.
- Security practices to disclose: **encryption in transit** (TLS/HTTPS) and **deletion mechanisms** (user-requestable deletion, or automatic deletion/anonymization within 90 days).
- Misrepresentation violates the **User Data policy**; consequences include *"blocked updates or removal from Google Play."*

### 3.2.3 Account deletion

If the app allows account creation, you must provide **both**:

1. *"an in-app path to delete their app accounts and associated data"*, **and**
2. *"a web link resource where users can request app account deletion and associated data deletion"* — functional, deletion pathway prominent, and referencing your app or developer name as it appears in the store listing.

Declared via the deletion questions in the **Data safety** form (App content page); answers surface on the store listing, including a **data deletion badge**. Original deadline 2023-12-07 with extensions to 2024-05-31; after that, non-compliance risks removal. Exempt: privately-focused and enterprise device-management apps.

**Note the asymmetry with Apple:** Apple requires **in-app initiation** and permits a web link to complete; Google requires **both an in-app path and a public web link**. Build both. One shared server-side deletion endpoint satisfies Apple's link and Google's web resource.

### 3.2.4 Play App Signing, AAB

- **Play App Signing:** all Android apps must be signed; you configure Play App Signing at first release, choosing a **Google-managed** or **self-managed** app signing key, and accepting the Play App Signing Terms of Service. You upload with the **upload key**; Google re-signs distributed APKs with the **app signing key**.
- **AAB required for new apps since August 2021.** New and existing **TV apps** since June 2023. Existing non-TV apps are not forced to migrate.
- **AAB constraints:** no APK expansion (`.obb`) files; compressed download size cap **4 GB** for the initial install plus on-demand downloads; for apps over 200 MB use **Play Feature Delivery** or **Play Asset Delivery**.

**Action for §2.7:** the SHA-256 fingerprint in `assetlinks.json` must be the **app signing key's** fingerprint from Play Console, or App Links will silently fail.

### 3.2.5 Closed testing requirement for new personal accounts — **12, not 20**

From Play Console Help:

- Applies to **personal** developer accounts created **on or after 2023-11-13**. Organization accounts, and personal accounts registered before that date, are **exempt**.
- Requirement: **at least 12 testers opted in**, remaining *"opted in continuously for at least 14 days"* before you can apply for production access.
- *"Testers who opt in, test for fewer than 14 days, and then opt out do not count toward the requirement."* If a tester opts out and rejoins, **the 14 days must be consecutive** — the countdown restarts.
- Production access is then requested via a three-part application in the Play Console Dashboard.

The brief's "20-tester" figure is **out of date**: the requirement was **reduced from 20 to 12 on 2024-12-11** *(reported by multiple secondary sources; the current official page states 12)*. Secondary sources also report that **since 2026 Google additionally checks that testers genuinely used the app** — **`UNVERIFIED`** against the official page, but plan for real testers rather than dormant opt-ins either way.

**Recommendation:** register LIVETAP as an **organization account** if a legal entity exists. That side-steps the 12/14 gate entirely — at the cost of D-U-N-S and document verification (§3.2.8). If it must be a personal account, start recruiting 12 testers **at least three weeks before** your intended production date.

### 3.2.6 Permissions policy

- Request only permissions *"necessary to implement current features or services … promoted in your Google Play listing."*
- **Prominent disclosure** and **incremental requests**, *"explaining each level"* so users understand why.
- *"Use the data only for purposes that the user has consented to"*; ask again for new purposes.
- *"Respect users' decisions if they decline a request"* and *"make a reasonable effort to accommodate users who do not grant access."*
- Prefer **minimum-scope alternatives** (system pickers) over broad permissions.
- Background access faces heightened scrutiny (the policy details this explicitly for location; the framework generalizes).
- **Foreground service types must be declared in Play Console** (Policy → App content) for all apps targeting Android 14+ — see §2.5.

**LIVETAP must declare `camera`, `microphone`, and `mediaProjection` FGS types in Play Console and justify each.** A screen-capture + camera + mic app is a high-scrutiny combination; write the justifications carefully and make the in-app disclosure precede the system prompt.

### 3.2.7 Content rating (IARC)

- **Mandatory.** *"To prevent your apps from being listed as 'Unrated,' sign in to Play Console and fill out the questionnaire for each of your apps as soon as possible."*
- **"Unrated" apps may be removed from Google Play.**
- Completing the questionnaire in Play Console (App content) produces locally relevant ratings from the regional authorities.

### 3.2.8 Account type, D-U-N-S, developer verification

- **Organization accounts require a D-U-N-S number** (the same nine-digit Dun & Bradstreet identifier Apple uses), plus government-issued business registration/incorporation documents, proof of physical address, an identity document for the authorized representative, and **website verification via Google Search Console**.
- Developer verification enforcement is reported as beginning **2026-09-30 in Brazil, Indonesia, Singapore and Thailand, and worldwide in 2027**, with ~99% of existing Play apps auto-registered in March 2026. **`UNVERIFIED`** — this comes from secondary sources; the official page is `support.google.com/googleplay/android-developer/answer/10841920`. **Verify before making an account-type decision, as the dates are close.**
- **Privacy policy URL** is required in the store listing / Data safety.

---

## 3.3 Checklist — Apple App Store

| # | Item | Requirement source | Status from this host | Notes / what unblocks it |
| --- | --- | --- | --- | --- |
| A1 | Apple Developer Program membership | Program terms | `BLOCKED_EXTERNAL_DEPENDENCY` | ~$99/yr; prerequisite for everything below |
| A2 | Build with **Xcode 26 + iOS 26 SDK** (from 2026-04-28) | Apple upcoming requirements | `BLOCKED_EXTERNAL_DEPENDENCY` | Needs macOS; satisfied by GitHub Actions macOS runner + Capacitor 8 |
| A3 | iOS deployment target 15.0, minSdk alignment | Capacitor 8 docs | **PASS** | Set in project config; verifiable as file content |
| A4 | `NSCameraUsageDescription` string present | WKWebView/AVFoundation | **PASS** | Write `Info.plist`; verifiable here |
| A5 | `NSMicrophoneUsageDescription` string present | WKWebView/AVFoundation | **PASS** | Write `Info.plist` |
| A6 | `UIBackgroundModes: audio` declared + AVAudioSession configured | Apple background audio | **PASS** (manifest) / `BLOCKED_EXTERNAL_DEPENDENCY` (behaviour test) | Declaration writable here; behaviour needs a device |
| A7 | Camera-in-background entitlement `com.apple.developer.avfoundation.multitasking-camera-access` (only if required) | Reported, `UNVERIFIED` | `BLOCKED_EXTERNAL_DEPENDENCY` | Must be requested from Apple; unknown lead time |
| A8 | ReplayKit Broadcast Upload Extension target + **App Group** | ReplayKit docs | `BLOCKED_EXTERNAL_DEPENDENCY` | Needs Xcode; App Group provisioning |
| A9 | Broadcast extension stays within the ~50 MB memory budget | Community-established, `UNVERIFIED` figure | `BLOCKED_EXTERNAL_DEPENDENCY` | Must be measured on device, **including iPad** |
| A10 | **1.2 UGC:** content filtering before publish | Guideline 1.2 | **PASS** (design + server code) / `UNVERIFIED` (adequacy) | Reviewer judgement; build it properly |
| A11 | **1.2 UGC:** in-app report mechanism + timely response process | Guideline 1.2 | **PASS** (implementable) | Needs a staffed queue and a stated SLA |
| A12 | **1.2 UGC:** block abusive users | Guideline 1.2 | **PASS** | Server-side, persistent |
| A13 | **1.2 UGC:** published contact information | Guideline 1.2 | **PASS** | In app + App Store listing |
| A14 | **5.1.1(v):** in-app-initiated full account deletion | Guideline 5.1.1(v) + support page | **PASS** (implementable) | Must delete UGC + revoke destination OAuth grants |
| A15 | Sign in with Apple **token revocation** on deletion (if SIWA used) | Apple support page | **PASS** (server code) / `BLOCKED_EXTERNAL_DEPENDENCY` (keys) | Only if SIWA is offered |
| A16 | **4.8:** Sign in with Apple **if** third-party social login is offered for the primary account | Guideline 4.8 | **PASS** — avoidable by design | Our analysis: destination-only OAuth does **not** trigger 4.8. Keep flows separate |
| A17 | App Privacy Details (nutrition labels) completed & accurate | App Privacy Details | `BLOCKED_EXTERNAL_DEPENDENCY` (ASC form) | Content preparable here; must include User Content (video/audio), Diagnostics, Usage Data, and all SDK collection |
| A18 | Privacy Policy URL live | App Privacy Details | **PASS** | Ship at `https://livetap.example/privacy` (Vercel — Part 4) |
| A19 | `PrivacyInfo.xcprivacy` in the app target with required-reason API declarations | Required-reason API docs | **PASS** (file content) / `UNVERIFIED` (exact reason codes) | Verify the reason-code tables before submitting |
| A20 | Capacitor (a listed commonly-used SDK) ships a privacy manifest **and** is code-signed | Third-party SDK requirements | `UNVERIFIED` | Confirm against the Capacitor 8 release artifacts |
| A21 | Age rating questionnaire (new 4+/9+/13+/16+/18+ system) completed | Apple news / upcoming requirements | `BLOCKED_EXTERNAL_DEPENDENCY` | Deadline **2026-01-31 has passed** — submissions are blocked until done |
| A22 | `ITSAppUsesNonExemptEncryption` determination | Export compliance docs | `UNVERIFIED` → legal | SRT/AES likely forces `true` + self-classification report |
| A23 | Screenshots: 6.9" iPhone (1260×2736) + 13" iPad (2064×2752), no alpha | ASC screenshot specs | `BLOCKED_EXTERNAL_DEPENDENCY` | Needs simulator/device captures; specs are known and are **PASS** to plan |
| A24 | Developer ID / distribution certificates + provisioning profiles | Apple | `BLOCKED_EXTERNAL_DEPENDENCY` | — |
| A25 | TestFlight: first external build passes **Beta App Review** | TestFlight docs | `BLOCKED_EXTERNAL_DEPENDENCY` | Schedule the latency in |
| A26 | macOS Electron build: Developer ID signing, hardened runtime, **notarization** | electron-builder mac docs | `BLOCKED_EXTERNAL_DEPENDENCY` | Requires macOS toolchain → macOS CI runner |
| A27 | macOS entitlements (`allow-jit`, `disable-library-validation`) + `NSAudioCaptureUsageDescription` | Electron / electron-builder docs | **PASS** (file content) / `UNVERIFIED` (complete set) | Validate with a real notarization run |
| A28 | Bundled `ffmpeg` signed and notarization-clean on macOS | electron-builder + Apple | `BLOCKED_EXTERNAL_DEPENDENCY` | Every Mach-O in the bundle must be signed |
| A29 | FFmpeg build license recorded (LGPL vs GPL) | FFmpeg licensing | `UNVERIFIED` → legal | Decide and document the exact build shipped |
| A30 | Physical-device validation (camera, ReplayKit, thermal, cellular) | — | `BLOCKED_EXTERNAL_DEPENDENCY` | Need ≥1 iPhone and ≥1 iPad |

## 3.4 Checklist — Google Play

| # | Item | Requirement source | Status from this host | Notes / what unblocks it |
| --- | --- | --- | --- | --- |
| G1 | Play Console developer account | Play Console | `BLOCKED_EXTERNAL_DEPENDENCY` | $25 one-time; choose personal vs organization deliberately |
| G2 | **D-U-N-S** + org documents + Search Console website verification (organization accounts) | Play Console Help | `BLOCKED_EXTERNAL_DEPENDENCY` | Enforcement dates reported for 2026-09-30 / 2027 — `UNVERIFIED`, verify |
| G3 | **targetSdk 36** by 2026-08-31 (new apps and updates) | Play target API policy | **PASS** (config) / `FAIL` (toolchain) | Capacitor 8 sets 36. Building needs JDK + Android SDK, **absent on this host** |
| G4 | `minSdk 24`, `compileSdk 36` | Capacitor 8 | **PASS** (config) | Verifiable as Gradle file content |
| G5 | Android SDK + JDK + Gradle toolchain installed | — | `FAIL` | Not installed on this host; fixable locally (no Mac needed) |
| G6 | **Node ≥ 22** for the Capacitor 8 CLI | Capacitor 8 docs | `FAIL` | Host is Node 20.11 → **install Node 22 LTS** |
| G7 | **AAB** upload format (required for new apps since Aug 2021) | Android App Bundle docs | **PASS** (config) / `FAIL` (build toolchain) | No `.obb`; ≤4 GB compressed download |
| G8 | **Play App Signing** configured at first release | Play App Signing docs | `BLOCKED_EXTERNAL_DEPENDENCY` | Google-managed key recommended |
| G9 | `assetlinks.json` uses the **app signing key** SHA-256 | Capacitor deep links + Play App Signing | `BLOCKED_EXTERNAL_DEPENDENCY` | Fingerprint only exists after G8 |
| G10 | Universal/App Link intent-filter + `.well-known` hosting | Capacitor deep links | **PASS** (manifest + static files, hosted on Vercel) | — |
| G11 | `CAMERA` + `RECORD_AUDIO` runtime permissions with prominent disclosure | Play permissions policy | **PASS** (manifest + UI) | Disclosure must precede the system prompt |
| G12 | FGS permissions `FOREGROUND_SERVICE{,_MEDIA_PROJECTION,_CAMERA,_MICROPHONE}` + `foregroundServiceType` | Android 14 FGS docs | **PASS** (manifest) | Verifiable as file content |
| G13 | **Foreground service types declared in Play Console** (Policy → App content) | Android 14 FGS docs | `BLOCKED_EXTERNAL_DEPENDENCY` | High-scrutiny combination; write justifications carefully |
| G14 | MediaProjection: consent Intent before `startForeground`; one `MediaProjection` per session; one `createVirtualDisplay` | Android 14 behaviour changes | **PASS** (code) / `BLOCKED_EXTERNAL_DEPENDENCY` (device test) | Cached-Intent reuse and double `createVirtualDisplay` both throw |
| G15 | `MediaProjection.Callback` registered (else `IllegalStateException`) | Android 14 behaviour changes | **PASS** (code) | — |
| G16 | Handle rotation via `VirtualDisplay.resize`/`setSurface`, not a new projection | Android 14 behaviour changes | **PASS** (code) | — |
| G17 | No `BOOT_COMPLETED`-launched mediaProjection FGS; SAW-started FGS needs a visible overlay | Android 15 behaviour changes | **PASS** (design) | LIVETAP should not need either |
| G18 | Android 16 orientation/resizability: responsive UI at `sw600dp`+ | Android 16 behaviour changes | **PASS** (design) | Opt-out property dies at API 37 — do not rely on it |
| G19 | Android 16 FGS / media-projection deltas reviewed | — | `UNVERIFIED` | Read `behavior-changes-all` + `changes/foreground-service-types` |
| G20 | **Data safety form** complete and accurate (incl. all SDKs) | Play Data safety | `BLOCKED_EXTERNAL_DEPENDENCY` (form) / **PASS** (content prep) | Must cover Media (photos/video/audio), Messages, identifiers, app activity |
| G21 | Data safety: encryption-in-transit + deletion-request declarations | Play Data safety | **PASS** (true by design) | TLS everywhere |
| G22 | Account deletion: **in-app path AND public web link** | Play account deletion policy | **PASS** (implementable) | Web link must be functional and name the app/developer as listed |
| G23 | **Content rating (IARC) questionnaire** completed | Play content rating | `BLOCKED_EXTERNAL_DEPENDENCY` | "Unrated" apps may be removed |
| G24 | **Privacy policy URL** in listing | Play policy | **PASS** | Hosted on Vercel |
| G25 | **Closed test: 12 testers, 14 continuous days** (personal accounts created ≥ 2023-11-13) | Play testing requirements | `BLOCKED_EXTERNAL_DEPENDENCY` | Avoidable with an organization account; start recruiting early |
| G26 | Genuine tester usage checks (reported for 2026) | Secondary sources | `UNVERIFIED` | Plan for real usage regardless |
| G27 | Upload keystore created and stored as a CI secret | Play App Signing | **PASS** (creatable with JDK once G5 is fixed) | — |
| G28 | RootEncoder Apache-2.0 attribution + NOTICE shipped | Apache-2.0 | **PASS** | Record in `docs/legal/THIRD_PARTY_LICENSES.md` |
| G29 | Physical-device validation (MediaProjection, thermal, cellular, foldable) | — | `BLOCKED_EXTERNAL_DEPENDENCY` | Need ≥1 phone and ≥1 large-screen/foldable device |

---

# Part 4 — Vercel deployment for a Vite SPA in an npm workspace monorepo

## 4.1 Root Directory and project layout

Assume:

```
livetap/
  package.json          # { "workspaces": ["apps/*", "packages/*"] }
  package-lock.json
  apps/
    web/                # Vite SPA  -> Vercel project "livetap-web"
      vercel.json
      api/              # serverless functions
    desktop/            # Electron  -> not deployed
  packages/
    core/               # shared TS
    ui/
```

- **One Vercel project per deployable directory.** Import the repo, then set **Root Directory** (Settings → Build and Deployment → Root Directory) to `apps/web`. Repeat per deployable app. The number of Vercel projects per Git repo is plan-limited.
- CLI equivalent: from the **monorepo root**, `vercel link --repo` links multiple projects at once (Vercel CLI ≥ 20.1.0). Do not invoke the CLI from the subdirectory when linking.

## 4.2 Skipping unaffected builds (npm workspaces)

Vercel **automatically skips builds for unchanged projects** in a monorepo. A project counts as changed if its source changed, an internal dependency changed, or a lockfile change affects only its dependencies. Unlike the Ignored Build Step, this **does not consume concurrent build slots**.

Requirements — all of which LIVETAP should satisfy deliberately:

- **GitHub-connected repository only.**
- Monorepo uses **npm / yarn / pnpm / Bun workspaces** following JS conventions, with packages listed in the `workspaces` key of the root `package.json` (npm/yarn). *Changes outside the workspace definition are treated as global and deploy everything.*
- **Every workspace package has a unique `name`** in its `package.json`.
- **Inter-package dependencies are explicitly declared** in each package's `package.json` — this is how Vercel derives the graph.

Toggle it off, if ever needed, under Settings → Build and Deployment → Root Directory → "Skip deployment".

**Filtered install** to avoid installing the whole monorepo (npm form):

```jsonc
// apps/web/vercel.json
{ "installCommand": "npm install --workspace=web" }
```

## 4.3 `vercel.json` for the SPA — rewrites, headers, functions

Vite SPAs need a fallback rewrite or deep links 404. Vercel's own documented form:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Two practical notes:

1. **If `cleanUrls: true`, omit the extension** — `/index.html` becomes `/`.
2. Vercel's routing checks the filesystem and functions before applying rewrites, so `/api/*` and `/.well-known/*` should still resolve. **To be explicit and safe** (and this matters because `.well-known/apple-app-site-association` and `assetlinks.json` are load-bearing for §2.7), either keep the catch-all and **verify** those paths after the first deploy, or narrow the source:

```json
{ "rewrites": [{ "source": "/((?!api/|\\.well-known/).*)", "destination": "/index.html" }] }
```
   *(The necessity of the narrowing is `UNVERIFIED` — Vercel's docs show the plain catch-all. Verify `curl -I https://…/.well-known/assetlinks.json` returns the JSON, not `index.html`, on the first deploy.)*

Vercel also notes: *"Deploying your app in Multi-Page App mode is recommended for production builds"* — for LIVETAP's app-shaped product, SPA mode plus the fallback rewrite is the right call; just be aware of the recommendation.

### Full recommended `apps/web/vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "installCommand": "npm install --workspace=web",
  "buildCommand": "npm run build --workspace=web",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/((?!api/|\\.well-known/).*)", "destination": "/index.html" }
  ],
  "functions": {
    "api/**/*.ts": { "maxDuration": 30, "supportsCancellation": true }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Permissions-Policy", "value": "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: mediastream:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/index.html",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    },
    {
      "source": "/.well-known/(.*)",
      "headers": [{ "key": "Content-Type", "value": "application/json" }]
    }
  ]
}
```

**Header notes.** The `headers` schema is confirmed: an array of objects with `source`, `headers` (non-empty array of `{key, value}`), and optional `has`/`missing` conditions (`type` ∈ `header|cookie|host|query`, with rich `value` matchers `eq/neq/inc/ninc/pre/suf/re/gt/gte/lt/lte`). `type` applies to **request** headers only, not response headers from your functions. The specific security-header *values* above are our recommendation, not Vercel's — validate the CSP against the built bundle, since Vite's dev-vs-prod inline behaviour differs.

**`Permissions-Policy` matters here specifically:** `camera`, `microphone`, and `display-capture` must be allowed for `self` or the web app's own capture UI will be blocked by the platform.

The `.well-known` content-type override is `UNVERIFIED` as strictly necessary — Apple requires the AASA file be served as JSON without a file extension, which usually needs an explicit type. Verify with `curl -I`.

## 4.4 Serverless functions in `api/` — and **do not pin Node 20**

- For non-framework projects, create an `api/` directory at the project root (i.e. `apps/web/api/` given the Root Directory setting). No extra config needed for officially supported runtimes.
- **Supported Node versions on Vercel: `24.x` (default), `22.x`, `20.x`.** New projects default to the latest LTS available.
- **🔴 `Node.js 20 is being deprecated on October 1, 2026`** (Vercel changelog). **The brief's "Node 20 runtime" target is the wrong choice — do not pin it.** Use `22.x` or `24.x`.

```json
// apps/web/package.json
{ "engines": { "node": "22.x" } }
```
`engines.node` **overrides** the Project Settings selection (Settings → Build and Deployment → Node.js Version). Only major versions are selectable; Vercel rolls minors/patches itself. Verify with `node -v` in the build command or `process.version` at runtime.

Function shapes (choose one and be consistent):

```ts
// api/health.ts — Web Standard fetch export (recommended)
export default {
  fetch(_req: Request) {
    return Response.json({ status: 'ok' });
  },
};
```
```ts
// api/ingest.ts — method exports
export function POST(req: Request) { /* ... */ }
```
```ts
// api/legacy.ts — Node helpers (request.query/cookies/body, response.status/json)
import type { VercelRequest, VercelResponse } from '@vercel/node';
export default (req: VercelRequest, res: VercelResponse) => res.status(200).json({ ok: true });
```

The Node-helper style gives you `request.query`, `request.cookies`, `request.body` (auto-parsed by `Content-Type`: JSON → object, `x-www-form-urlencoded` → object, `text/plain` → string, `application/octet-stream` → Buffer; **no header → `undefined`**; **malformed JSON throws when `request.body` is accessed**, so wrap it in `try/catch` and return a 400). A captured `server.ts` entrypoint gets raw `IncomingMessage`/`ServerResponse` **without** those helpers.

`functions` config keys (glob → options): `runtime` (only needed for community runtimes, e.g. `"vercel-php@0.5.2"`), `maxDuration` (integer seconds, 1..plan max), `supportsCancellation` (Node only), `includeFiles`/`excludeFiles` (globs), `regions`, `functionFailoverRegions` (Enterprise). **`memory` cannot be set in `vercel.json` when Fluid compute is enabled** — set it in the dashboard's Functions section. `functions` cannot be combined with the legacy `builds` key.

**For LIVETAP's OAuth broker** (§1.3, §2.7): `api/oauth/twitch/callback.ts` and `api/oauth/google/callback.ts` hold the client secrets as Vercel environment variables (Production/Preview/Development scoped, never `VITE_`-prefixed), do the code exchange, and return only short-lived LIVETAP tokens. Set `maxDuration` modestly (10–15 s) and pin `regions` near your primary users to cut token-exchange latency.

## 4.5 Environment variables

- Vercel injects **System Environment Variables** (e.g. `VERCEL_GIT_PROVIDER`, `VERCEL_ENV`). To reach them in Vite **at build time you must prefix with `VITE`** — `VITE_VERCEL_ENV` yields `production` / `preview` / `development`.
- Optional indirection through `vite.config.ts`:

```ts
export default defineConfig(() => ({
  define: { __APP_ENV__: JSON.stringify(process.env.VITE_VERCEL_ENV) },
}));
```

- **Security rule, non-negotiable:** anything `VITE_`-prefixed is **inlined into the client bundle**. OAuth client secrets, signing keys, and database URLs must **never** carry a `VITE_` prefix — they belong to the `api/` functions only.
- Reading a local `.env` file inside `vite.config.ts` needs extra setup (see Vite's own docs).
- Env vars can be scoped per environment, searched and filtered in the dashboard, and populated automatically by marketplace integrations.

## 4.6 Monorepo cross-project linking (optional)

If LIVETAP splits frontend and API into separate Vercel projects, **Related Projects** wires preview deployments together without hardcoded URLs:

```json
// apps/web/vercel.json
{ "relatedProjects": ["prj_123"] }
```
This exposes `VERCEL_RELATED_PROJECTS` at deploy time; read it with `@vercel/related-projects` (`withRelatedProject({ projectName, defaultHost })`). Limits: **max 3 linked projects**, same repository only, **CLI deployments not supported**.

For LIVETAP, a single `apps/web` project with co-located `api/` is simpler and avoids the CORS and preview-URL coordination entirely. **Recommendation: one project.**

## 4.7 Vercel checklist

| Item | Status | Note |
| --- | --- | --- |
| Root Directory = `apps/web` | **PASS** | Dashboard setting; verifiable |
| npm workspaces shaped for automatic build skipping (unique names, explicit internal deps, GitHub) | **PASS** | Audit `package.json` files |
| `vercel.json` SPA fallback rewrite | **PASS** | Verify `.well-known` + `/api` are not swallowed after first deploy |
| Security headers in `vercel.json` (incl. `Permissions-Policy` for camera/mic/display-capture) | **PASS** | CSP must be validated against the built bundle |
| `api/` functions on **Node 22.x or 24.x** (never 20.x) | **PASS** | Node 20 deprecated **2026-10-01** |
| Secrets in non-`VITE_` env vars, scoped per environment | **PASS** | — |
| `.well-known/apple-app-site-association` + `assetlinks.json` served as JSON over HTTPS | **PASS** (hosting) / `BLOCKED_EXTERNAL_DEPENDENCY` (content needs Team ID + Play signing fingerprint) | — |
| Privacy policy + account-deletion web pages live (A18, G22, G24) | **PASS** | Same deployment |

---

# Decision recommendations (summary)

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | Desktop framework | **Electron 44.x**, bumped every ~8 weeks | Bundled Chromium M152 gives identical media-stack behaviour on macOS and Windows; Tauri needs Rust (absent) and hands rendering/capture to per-platform webviews — the exact thing a broadcast app cannot tolerate |
| D2 | Google/YouTube desktop OAuth | **Loopback `http://127.0.0.1:<ephemeral>` + PKCE S256**, no secret in the client | Google explicitly recommends loopback for macOS/Linux/Windows desktop; custom schemes deprecated, OOB removed |
| D3 | Twitch desktop OAuth | **Server-side token broker** (primary) or **Device Code Grant** (fallback). Do **not** assume PKCE | PKCE is absent from Twitch's docs and still unsupported per Twitch's own forums; auth-code flow needs a secret that must not ship |
| D4 | Custom scheme `livetap://` | Register it, but for **deep links only**, not OAuth | Universal links / loopback are hijack-resistant; custom schemes are not |
| D5 | Desktop credential storage | **`safeStorage` with `encryptStringAsync`**, gated on `isEncryptionAvailable()` + Linux backend check; prefer backend-minted short-lived tokens over persisted stream keys | Linux silently falls back to plaintext; Windows DPAPI does not defend against same-user malware |
| D6 | macOS system audio | **Ship as a known limitation for v1**: set `NSAudioCaptureUsageDescription`, detect the dead-stream case, document a BlackHole fallback | `'loopback'` is Windows-only; the ScreenCaptureKit request (#47490) is closed with no documented support |
| D7 | Windows signing | **Azure Trusted Signing** if the entity qualifies; otherwise **OV cert on an HSM/token** | No key custody, clean SmartScreen, works from any OS; all publicly trusted keys have been hardware-bound since 2023-06-01 anyway |
| D8 | macOS signing/notarization + iOS builds | **GitHub Actions macOS runners** (free for public repos) | Solves the "no Mac" problem for both Electron macOS and Capacitor iOS with one CI investment; standard macOS runners are free on public repositories |
| D9 | Mobile framework | **Stay on Capacitor 8** (do not migrate to Expo/RN) | `targetSdk 36` + Xcode 26 already satisfy the Aug-2026 Play and Apr-2026 Apple gates; EAS Build's Mac-free advantage is neutralized by D8 |
| D10 | **Build host change (do this first)** | **Upgrade host Node 20.11 → 22 LTS** | Capacitor 8 requires Node ≥ 22; the CLI will not run otherwise. Also install JDK + Android SDK for Android builds |
| D11 | Native streaming libraries | **Android: RootEncoder (Apache-2.0). iOS: HaishinKit.swift (BSD-3).** One Capacitor plugin, one TS contract | Best protocol/codec coverage on Android; first-class ReplayKit + SRT on iOS; both permissive licenses |
| D12 | iOS background streaming | Native encoder owns audio; `UIBackgroundModes: audio`; **camera pauses on background** with an audio-only/slate fallback; **ReplayKit extension** for keep-streaming-while-using-other-apps | iOS forbids background camera (`videoDeviceNotAvailableInBackground`); the multitasking-camera entitlement is Apple-gated |
| D13 | iOS screen broadcast architecture | **Publish RTMP/SRT from inside the Broadcast Upload Extension** (HaishinKit), App Group only for config | The ~50 MB extension budget cannot absorb frame IPC. Test on **iPad** |
| D14 | Android screen capture | MediaProjection + `mediaProjection` FGS, consent-before-`startForeground`, one projection per session, `MediaProjection.Callback` registered, rotation via `VirtualDisplay.resize` | Android 14 turns each of these into a hard exception |
| D15 | Orientation | **Build a genuinely responsive capture UI**; do not rely on `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` | Android 16 + `targetSdk 36` ignores orientation locks at `sw600dp`+, and the opt-out dies at API 37 |
| D16 | Mobile OAuth surface | **ASWebAuthenticationSession / Custom Tabs → universal link / App Link callback**, not `@capacitor/browser` | `@capacitor/browser` is `SFSafariViewController`, which is not the OAuth-appropriate API. Plugin choice still `UNVERIFIED` — evaluate before adopting |
| D17 | Mobile secure storage | **`aparajita/capacitor-secure-storage` (MIT)** | MIT, explicit Capacitor 8 support, Keychain + Keystore-backed AES-GCM. Ionic Secure Storage sunsets 2027-12-31 |
| D18 | Play account type | **Organization account** if a legal entity exists | Side-steps the 12-testers/14-days gate; cost is D-U-N-S + document verification |
| D19 | Apple 4.8 exposure | **Keep destination OAuth strictly separate from account login.** Add Sign in with Apple only if social login is offered for the primary account | Destination-only OAuth does not, on our reading, trigger 4.8 — and 4.8 has an explicit "client for a specific third-party service" exception |
| D20 | UGC moderation (Apple 1.2) | Treat as a **v1 product requirement**: pre-publish filtering, in-broadcast report + triaged queue with SLA, persistent block, published contact info, **server-side stream kill-switch** | 1.2 breaches are grounds for immediate removal from the App Store *and the Developer Program* |
| D21 | Vercel runtime | **Node 22.x or 24.x — never pin 20.x** | Node 20 on Vercel is deprecated **2026-10-01** |
| D22 | Vercel project topology | **One project** at Root Directory `apps/web` with co-located `api/` | Avoids CORS and preview-URL coordination; Related Projects caps at 3 and is unnecessary here |
| D23 | Export compliance + FFmpeg licensing | **Escalate to legal now** (`ITSAppUsesNonExemptEncryption` given SRT/AES; LGPL vs GPL FFmpeg build) | Both are submission-blocking and neither is an engineering call |
| D24 | Hardware | **Buy ≥1 iPhone, ≥1 iPad, ≥1 Android phone, ≥1 large-screen/foldable Android** | ReplayKit memory limits, thermal throttling, MediaProjection, and Android 16 resizability cannot be validated in simulators |

## Immediate next actions (ordered)

1. **Upgrade the build host's Node to 22 LTS** — unblocks the Capacitor 8 CLI (`FAIL` → `PASS`). Install JDK + Android SDK for Android builds.
2. **Stand up the GitHub Actions macOS workflow** (public repo → free) for Electron macOS notarization and iOS archive.
3. **Open the Apple Developer Program and Play Console accounts** — everything in §3.3/§3.4 marked `BLOCKED_EXTERNAL_DEPENDENCY` queues behind these, and the age-rating questionnaire (A21) is already a hard gate.
4. **Resolve the Windows signing route** (Azure Trusted Signing eligibility check) — lead time is real.
5. **Escalate D23 to legal.**
6. **Close the `UNVERIFIED` items** listed below before writing the corresponding code.

## Open `UNVERIFIED` items to close

| Ref | Item |
| --- | --- |
| §1.3 | electron-builder `protocols` config exact schema |
| §1.6 | electron-builder `extraResources` docs URL + `${os}`/`${arch}` macro support (doc pages 404'd) |
| §1.7 | Azure Trusted Signing current eligibility criteria; CA/B hardware requirement read from the CA/B baseline itself; complete macOS entitlement set for a non-sandboxed hardened-runtime Electron app |
| §2.2 | iOS 15+ `WKUIDelegate` media-capture permission hook and Capacitor's handling of it |
| §2.3 | `UIBackgroundModes` value semantics from Apple's primary page; `isMultitaskingCameraAccessSupported` / `multitasking-camera-access` entitlement conditions |
| §2.4 | ReplayKit extension memory limit (50 MB is community-established, not documented); `RPSystemBroadcastPickerView` as the sole iOS 18/26 trigger |
| §2.5/§2.6 | Android 16 `behavior-changes-all` + `changes/foreground-service-types` for FGS/media-projection deltas |
| §2.6 | Battery/thermal APIs (iOS `ProcessInfo.thermalState`, Android `PowerManager` thermal status) — not researched this pass |
| §2.7 | Which Capacitor plugin wraps `ASWebAuthenticationSession`; `@capacitor/browser`'s Android engine |
| §2.8 | Licenses for Capawesome Secure Preferences, martinkasa, `@evva`, `@atroo`; Keychain accessibility option names |
| §2.9 | Capacitor iOS/Android plugin decorator specifics (`@objc`/`CAPPluginMethod`, `@CapacitorPlugin`/`@PluginMethod`); RootEncoder-iOS license |
| §2.10 | Codemagic / Bitrise / VoltBuilder pricing; Ionic's own Appflow shutdown announcement |
| §3.1.5 | Exact required-reason API reason codes; Apple third-party SDK enforcement dates; whether Capacitor 8 ships a signed privacy manifest |
| §3.1.6 | Current age-rating questionnaire content in App Store Connect |
| §3.1.7 | Export-compliance determination for SRT/AES |
| §3.2.5/§3.2.8 | "Genuine tester usage" checks; Play developer-verification enforcement dates and D-U-N-S requirements from the official page |
| §4.3 | Whether the SPA catch-all rewrite needs narrowing for `/api` and `/.well-known`; `.well-known` content-type override necessity |

---

# Sources

## Electron / desktop
- Electron release schedule — https://releases.electronjs.org/schedule
- Electron versions & EOL — https://endoflife.date/electron
- Electron security checklist — https://www.electronjs.org/docs/latest/tutorial/security
- `safeStorage` API — https://www.electronjs.org/docs/latest/api/safe-storage
- `desktopCapturer` API — https://www.electronjs.org/docs/latest/api/desktop-capturer
- `session.setDisplayMediaRequestHandler` — https://www.electronjs.org/docs/latest/api/session
- Deep links / custom protocol tutorial — https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
- `crashReporter` API — https://www.electronjs.org/docs/latest/api/crash-reporter
- ScreenCaptureKit loopback audio request (closed) — https://github.com/electron/electron/issues/47490
- `NSAudioCaptureUsageDescription` / CoreAudio Tap issue — https://github.com/electron/electron/issues/45107
- electron-builder Windows code signing — https://www.electron.build/docs/features/code-signing/code-signing-win/
- electron-builder macOS code signing — https://www.electron.build/docs/features/code-signing/code-signing-mac
- electron-builder auto-update — https://www.electron.build/docs/features/auto-update/
- electron-updater CVE-2024-39698 — https://advisories.gitlab.com/pkg/npm/electron-updater/CVE-2024-39698
- Building a Secure Electron Auto-Updater (Doyensec, 2026) — https://blog.doyensec.com/2026/02/16/electron-safe-updater.html
- Tauri v2 prerequisites — https://v2.tauri.app/start/prerequisites/
- Tauri v2 architecture — https://v2.tauri.app/concept/architecture/

## OAuth
- Google OAuth 2.0 for Mobile & Desktop Apps — https://developers.google.com/identity/protocols/oauth2/native-app
- Twitch: Getting OAuth Access Tokens — https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
- Twitch forums: PKCE not supported — https://discuss.dev.twitch.com/t/still-no-support-for-auth-code-flow-with-pkce/61894

## Capacitor / mobile
- Capacitor: Updating to 8.0 — https://capacitorjs.com/docs/updating/8-0
- Capacitor Camera plugin — https://capacitorjs.com/docs/apis/camera
- Capacitor Browser plugin — https://capacitorjs.com/docs/apis/browser
- Capacitor deep links guide — https://capacitorjs.com/docs/guides/deep-links
- Capacitor: creating plugins — https://capacitorjs.com/docs/plugins/creating-plugins
- `aparajita/capacitor-secure-storage` — https://github.com/aparajita/capacitor-secure-storage
- Capawesome Secure Preferences — https://capawesome.io/docs/sdks/capacitor/secure-preferences/
- Camera/mic in WKWebView (iOS 14.3+) — https://solarana.dev/2021/01/01/camera-and-microphone-in-wkwebview/
- WKWebView `getUserMedia` mic muted in background — https://developer.apple.com/forums/thread/689182

## Streaming libraries
- HaishinKit.swift — https://github.com/shogo4405/HaishinKit.swift
- RootEncoder (Android) — https://github.com/pedroSG94/RootEncoder
- RootEncoder-iOS — https://github.com/pedroSG94/RootEncoder-iOS

## Apple platform / App Store
- App Review Guidelines — https://developer.apple.com/app-store/review/guidelines/
- Offering Account Deletion in Your App — https://developer.apple.com/support/offering-account-deletion-in-your-app/
- App Privacy Details — https://developer.apple.com/app-store/app-privacy-details/
- Describing use of required reason API — https://developer.apple.com/documentation/BundleResources/describing-use-of-required-reason-api
- Third-party SDK requirements (incl. Capacitor) — https://developer.apple.com/support/third-party-SDK-requirements/
- Screenshot specifications — https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
- Complying with Encryption Export Regulations — https://developer.apple.com/documentation/Security/complying-with-encryption-export-regulations
- Upcoming SDK minimum requirements — https://developer.apple.com/news/upcoming-requirements/ and https://developer.apple.com/news/?id=ueeok6yw
- Updated age ratings in App Store Connect — https://developer.apple.com/news/?id=ks775ehf and https://developer.apple.com/news/upcoming-requirements/?id=07242025a
- TestFlight — https://developer.apple.com/testflight/
- ReplayKit `RPBroadcastSampleHandler` — https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler
- `AVCaptureSession.InterruptionReason.videoDeviceNotAvailableInBackground` — https://developer.apple.com/documentation/AVFoundation/AVCaptureSession/InterruptionReason/videoDeviceNotAvailableInBackground
- `AVError.Code.deviceIsNotAvailableInBackground` — https://developer.apple.com/documentation/avfoundation/averror-swift.struct/code/deviceisnotavailableinbackground
- Broadcast extension memory-limit threads — https://developer.apple.com/forums/thread/131210 , https://developer.apple.com/forums/thread/651367 , https://developer.apple.com/forums/thread/706972
- iOS screen sharing with ReplayKit (2026 overview) — https://www.forasoft.com/blog/article/how-to-implement-screen-sharing-in-ios-1193
- macOS system audio access approaches — https://www.recall.ai/blog/how-to-get-access-to-system-audio , https://stronglytyped.uk/articles/recording-system-audio-electron-macos-approaches

## Android / Google Play
- Play target API level requirements — https://developer.android.com/google/play/requirements/target-sdk
- Android 14 foreground service types — https://developer.android.com/about/versions/14/changes/fgs-types-required
- Android 14 behaviour changes (MediaProjection) — https://developer.android.com/about/versions/14/behavior-changes-14
- Android 15 behaviour changes — https://developer.android.com/about/versions/15/behavior-changes-15
- Android 16 behaviour changes (orientation/resizability) — https://developer.android.com/about/versions/16/behavior-changes-16
- Android App Bundle — https://developer.android.com/guide/app-bundle
- Play: Data safety — https://support.google.com/googleplay/android-developer/answer/10787469
- Play: account deletion — https://support.google.com/googleplay/android-developer/answer/13327111
- Play App Signing — https://support.google.com/googleplay/android-developer/answer/9859152
- Play: testing requirements for new personal accounts — https://support.google.com/googleplay/android-developer/answer/14151465
- Play: permissions & sensitive information — https://support.google.com/googleplay/android-developer/answer/9888170
- Play: content rating (IARC) — https://support.google.com/googleplay/android-developer/answer/9859455
- Play: verify developer identity — https://support.google.com/googleplay/android-developer/answer/10841920
- Play: FGS & full-screen intent declaration — https://support.google.com/googleplay/android-developer/answer/13392821

## CI / build services
- GitHub Actions billing (standard runners free for public repos) — https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Expo pricing (EAS Build free tier) — https://expo.dev/pricing
- Appflow shutdown / alternatives — https://cloud.capawesome.io/compare/ionic-appflow/ , https://capawesome.io/blog/alternative-to-appflow/
- GitHub Actions runner pricing analyses (2026) — https://cicdcalculator.com/github-actions , https://bitrise.io/blog/post/best-github-actions-runners-in-2026-and-hidden-pricing-traps-to-avoid

## Vercel
- Vite on Vercel — https://vercel.com/docs/frameworks/frontend/vite
- Project configuration overview — https://vercel.com/docs/project-configuration
- `vercel.json` reference — https://vercel.com/docs/project-configuration/vercel-json
- Using monorepos — https://vercel.com/docs/monorepos
- Node.js runtime — https://vercel.com/docs/functions/runtimes/node-js
- Supported Node.js versions — https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Node.js 20 deprecation (2026-10-01) — https://vercel.com/changelog/node-js-20-is-being-deprecated
