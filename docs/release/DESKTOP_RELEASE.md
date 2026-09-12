# LIVETAP Desktop — Release & Signing

Covers building, signing, notarizing and publishing `apps/desktop`. Config lives in
`apps/desktop/electron-builder.yml`.

**Signing status: BLOCKED_EXTERNAL_DEPENDENCY.** Neither a Windows code-signing certificate nor an
Apple Developer Program membership exists on the build host, and neither can be obtained from here —
both require a paid identity-verified account. Unsigned builds are produced and are usable for
internal testing. Every environment variable needed to turn signing on is listed below, so the step
is a credential away, not a code change away.

---

## 1. Build

```bash
npm install                                   # once, from the repo root

npm run build:renderer -w @livetap/desktop    # React app → apps/desktop/dist/renderer
npm run build:main     -w @livetap/desktop    # main + preload → dist/main, dist/preload
npm run package:win    -w @livetap/desktop    # → apps/desktop/release/LIVETAP-<v>-win-x64.exe
npm run package:mac    -w @livetap/desktop    # → LIVETAP-<v>-mac-arm64.dmg and -x64.dmg
```

If `dist/renderer` is missing, the `prepackage` step (`scripts/ensure-renderer.mjs`) copies
`packaging/renderer-placeholder.html` into place, so packaging still succeeds and ships a page that
says the renderer is not built. This is deliberate: the Electron shell and the whole electron-builder
pipeline can be exercised independently of the web team's build. The step **never** overwrites a real
renderer — it only writes when the file is missing.

Packaging inputs that must be committed live in `apps/desktop/packaging/`
(`entitlements.mac.plist`, `installer.nsh`, `renderer-placeholder.html`) rather than the
conventional `build/`, because the repo-wide `.gitignore` ignores every directory named `build/` and
these are source files, not artefacts.

### Drop the FFmpeg binaries first

They are **not** committed (~80 MB each, GPL). Before packaging:

```
apps/desktop/resources/ffmpeg/win/ffmpeg.exe      (+ ffprobe.exe, optional)
apps/desktop/resources/ffmpeg/mac/ffmpeg          (+ ffprobe, optional)
```

`electron-builder.yml` copies that tree to `resources/ffmpeg/` inside the app, which is where
`src/main/ffmpeg/ffmpegPath.ts` looks. Each directory has a README repeating this.

Use a **GPL** build; never `--enable-nonfree`, which cannot be redistributed at all. Ship FFmpeg's
licence and the written source offer — the exact `THIRD_PARTY_NOTICES.md` text is in
`docs/architecture/DESKTOP_ARCHITECTURE.md` §5.

A build with no binary present still runs: main logs an error and `capabilities()` reports
`verification: 'UNAVAILABLE'` rather than falling through to whatever `ffmpeg` is on the user's PATH.

---

## 2. Packaging result on this host — PASS (unsigned)

```
$ npm run package:win -w @livetap/desktop
  • electron-builder  version=26.12.1 os=10.0.20348
  • packaging       platform=win32 arch=x64 electron=38.8.6 appOutDir=release\win-unpacked
  • default Electron icon is used  reason=application icon is not set
  • building        target=nsis file=release\LIVETAP-0.1.0-win-x64.exe oneClick=false perMachine=false
  • building block map  blockMapFile=release\LIVETAP-0.1.0-win-x64.exe.blockmap
EXIT=0
```

| Artifact | Size |
|---|---|
| `LIVETAP-0.1.0-win-x64.exe` (NSIS installer) | 95,901,044 B |
| `LIVETAP-0.1.0-win-x64.exe.blockmap` | 102,054 B |
| `latest.yml` (electron-updater feed) | 346 B |

The packaged app was launched and stayed running; see `docs/qa/DESKTOP_ENGINE_VERIFICATION.md` (h).

macOS packaging is **UNVERIFIED** — no macOS machine. `npm run package:mac` on a Mac is expected to
work from the same config, but has not been executed.

### Three blockers hit on the way, and their fixes

Recorded so the next person does not rediscover them.

1. **`electron-builder` 26.15.3 crashes on Node 20.11** with
   `ERR_REQUIRE_ESM: require() of ES Module @noble/hashes/blake2.js`. `app-builder-lib` ≥ 26.13
   depends on `@noble/hashes` ^2, which is ESM-only, and `require(esm)` needs Node ≥ 20.19.
   The blockmap module is loaded by the NSIS target unconditionally, so it cannot be avoided by
   config. **Fix: pinned `electron-builder` to `~26.12.0`**, the last line that does not depend on
   `@noble/hashes`. Revisit when the build host moves to Node ≥ 22.12.
2. **Schema changes in electron-builder 26.** `win.publisherName` moved to
   `win.signtoolOptions.publisherName`, and top-level `notarize` moved under `mac`. Both now sit in
   the right place (the Windows one commented out until a certificate exists).
3. **`electronVersion` must be explicit.** electron-builder refuses the `^38.2.0` range because it
   downloads binaries for one exact release, and in an npm workspace `electron` is hoisted to the
   repo root where electron-builder does not look. **Fix: `electronVersion: 38.8.6` in
   `electron-builder.yml` — keep it in step with the `electron` devDependency when bumping.**

---

## 3. Windows code signing — BLOCKED_EXTERNAL_DEPENDENCY

Without a certificate electron-builder logs `signing with signtool.exe` and produces an **unsigned**
binary; it does not fail the build. Users then see SmartScreen's "Windows protected your PC" prompt.

### Option A — traditional certificate file (`.pfx`)

| Variable | Value |
|---|---|
| `CSC_LINK` | path to the `.pfx`, or a `https://` URL, or a base64 data URI of the file |
| `CSC_KEY_PASSWORD` | the `.pfx` password |

```bash
export CSC_LINK="/secure/livetap-codesign.pfx"
export CSC_KEY_PASSWORD="…"
npm run package:win -w @livetap/desktop
```

Since June 2023 the CA/Browser Forum requires OV/EV code-signing keys to live on an **FIPS 140-2
Level 2 hardware token or an approved HSM**, so a plain exportable `.pfx` is no longer issuable for
new certificates. In practice this option now only applies to a cloud-HSM-backed PKCS#11 setup
driven through a custom `signtoolOptions.sign` hook, or to an existing pre-2023 certificate.

### Option B — Azure Trusted Signing (recommended for a new setup)

No hardware token, no up-front certificate purchase; pay-as-you-go and supported natively by
electron-builder 26 via `win.azureSignOptions`.

```yaml
win:
  azureSignOptions:
    publisherName: "REPLACE_WITH_VERIFIED_ORG_NAME"
    endpoint: "https://eus.codesigning.azure.net"
    certificateProfileName: "REPLACE_WITH_PROFILE"
    codeSigningAccountName: "REPLACE_WITH_ACCOUNT"
```

| Variable | Purpose |
|---|---|
| `AZURE_TENANT_ID` | Entra tenant |
| `AZURE_CLIENT_ID` | service principal |
| `AZURE_CLIENT_SECRET` | service principal secret |

Prerequisite: an Azure subscription plus **organisation identity validation** (3 days–several weeks),
or individual validation, which carries a 3-year SmartScreen-reputation penalty for new publishers.

### Reputation, either way

A newly signed binary still trips SmartScreen until it accumulates download reputation. An EV
certificate grants immediate reputation; OV and Trusted Signing do not. Plan for first users to see
the prompt.

---

## 4. macOS signing and notarization — BLOCKED_EXTERNAL_DEPENDENCY

Requires an **Apple Developer Program** membership (99 USD/year). Without it the dmg builds but
Gatekeeper refuses to open it on any machine other than the one that built it.

| Variable | Purpose |
|---|---|
| `APPLE_ID` | Apple ID email of the Developer Program account |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com (**not** the account password) |
| `APPLE_TEAM_ID` | 10-character Team ID from developer.apple.com |
| `CSC_LINK` | Developer ID Application `.p12` (or leave unset to use the login keychain) |
| `CSC_KEY_PASSWORD` | `.p12` password |

```bash
export APPLE_ID="release@livetap.app"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"
npm run package:mac -w @livetap/desktop
```

Then flip notarization on in `electron-builder.yml`:

```yaml
mac:
  notarize: true
  # or, to be explicit:
  # notarize:
  #   teamId: ABCDE12345
```

The alternative auth form, `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` (App Store
Connect API key), is preferred for CI: it avoids storing an Apple ID password and does not break
when 2FA prompts.

### What is already configured

- `hardenedRuntime: true` — required for notarization.
- `packaging/entitlements.mac.plist` — `com.apple.security.device.camera`,
  `com.apple.security.device.audio-input`, JIT and unsigned-executable-memory (Chromium needs both),
  `network.client` + `network.server` (the OAuth loopback listener), `files.user-selected.read-write`
  (recording folder), and `com.apple.security.inherit` so the spawned FFmpeg child inherits the
  sandbox. Deliberately **not** granted: `disable-library-validation`,
  `allow-dyld-environment-variables`, USB, personal information, Apple Events.
- Usage strings in `mac.extendInfo`: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`,
  `NSScreenCaptureUsageDescription`. Vague strings are a common App Review rejection; these name the
  benefit to the user.
- Screen Recording is **not** an entitlement or an Info.plist key: macOS grants it per-app through
  System Settings → Privacy & Security → Screen Recording, prompted on the first `getDisplayMedia`.

### FFmpeg must be signed too

Under the hardened runtime every executable in the bundle must carry the same team's signature.
electron-builder signs binaries it finds in `extraResources` as part of the app signing pass; verify
with `codesign -dv --verbose=4 LIVETAP.app/Contents/Resources/ffmpeg/mac/ffmpeg` before submitting,
because an unsigned nested binary fails notarization with a non-obvious error.

---

## 5. Auto-update (electron-updater)

`publish` in `electron-builder.yml` is a GitHub provider with placeholders:

```yaml
publish:
  - provider: github
    owner: REPLACE_WITH_GITHUB_OWNER
    repo: REPLACE_WITH_GITHUB_REPO
    releaseType: release
```

Replace both, then `--publish always` with `GH_TOKEN` set uploads the artifacts and the `latest.yml`
/ `latest-mac.yml` feeds. The placeholders are copied verbatim into the packaged
`resources/app-update.yml`, so **a build made today will not find updates** — that is intentional
rather than pointing at a repository that may not be the release home.

Update checks are **not wired into main yet**: `electron-updater` is a dependency and the feed is
configured, but nothing calls `autoUpdater.checkForUpdatesAndNotify()`. That belongs with the UI
that asks the user, and must never fire mid-broadcast.

**Auto-update requires code signing on both platforms.** macOS refuses to apply an update whose
signature does not match the running app; Windows `NsisUpdater` verifies the publisher name. Until
§3 and §4 are unblocked, auto-update is **BLOCKED_EXTERNAL_DEPENDENCY** too.

---

## 6. Release checklist

1. Bump `version` in `apps/desktop/package.json`.
2. Confirm `electronVersion` in `electron-builder.yml` matches the installed Electron.
3. Drop the FFmpeg binaries (§1) and refresh `THIRD_PARTY_NOTICES.md` with the exact version.
4. `npx vitest run --project desktop` — 275 tests, must be green.
5. `node apps/desktop/dist/verify/verify-engine.cjs` — 9/9 steps, must exit 0.
6. `npm run package:win` and `npm run package:mac` with the signing variables exported.
7. `codesign -dv --verbose=4` the mac app **and** the nested ffmpeg; `signtool verify /pa` the exe.
8. Install from the artifact on a clean machine; confirm `livetap://` opens the app and
   `%APPDATA%\LIVETAP` / `~/Library/Application Support/LIVETAP` is created.
9. Publish, then verify a previous version actually updates to it.

## 7. Outstanding

| Item | Status |
|---|---|
| Windows code signing | BLOCKED_EXTERNAL_DEPENDENCY — no certificate |
| macOS signing + notarization | BLOCKED_EXTERNAL_DEPENDENCY — no Apple Developer account |
| macOS build | UNVERIFIED — no macOS machine |
| Auto-update wiring in main | NOT STARTED — depends on signing and on the UI |
| App icon | NOT STARTED — default Electron icon in use |
| `publish.owner` / `publish.repo` | placeholders |
| `electron-builder` pinned to `~26.12.0` | revisit when the host moves to Node ≥ 22.12 |

## Addendum 2026-09-11 — Electron 44.3.0 / electron-builder 26.15.3

Bumped for security (Electron ≤40.10.2 carried 19 advisories incl. a context-isolation bypass; `builder-util-runtime` <9.7.0 leaked tokens on cross-origin redirects). After the bump: `npm audit` reports 0 high/critical (4 dev-only moderate/low in vitest/esbuild). Desktop suite 275/275, `tsc` clean, `tsup` build OK. `npm run package:win` executed with a portable Node 22.23.2 (electron-builder 26.15 needs Node ≥20.19; host Node is 20.11) → `release/LIVETAP-0.1.0-win-x64.exe` 93.9 MB, unsigned: **PASS**.
