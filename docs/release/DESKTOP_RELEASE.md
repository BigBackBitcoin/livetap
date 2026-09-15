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
export PATH="$PWD/tools/node22/node:$PATH"    # THIS HOST ONLY - see the Node note at the bottom

npm run build:renderer -w @livetap/desktop    # React app → apps/desktop/dist/renderer, mock mode OFF
npm run package:win    -w @livetap/desktop    # → apps/desktop/release/LIVETAP-<v>-win-x64.exe
npm run package:mac    -w @livetap/desktop    # → LIVETAP-<v>-mac-arm64.dmg and -x64.dmg

node apps/desktop/scripts/verify-installer.mjs   # assert what the artifact actually contains
node apps/desktop/scripts/smoke-installed.mjs    # launch the packaged app and read it back
```

`package:win` already runs `build:main` and then `prepackage`, so those are not separate steps.
`prepackage` (`scripts/ensure-renderer.mjs`) does two things in order: it runs
`tools/acquire-ffmpeg.mjs` to put FFmpeg in place, and then makes sure a renderer exists. It is the
single hook every packaging path shares, which is why the FFmpeg step lives there rather than in a
second npm script that one of the three `package*` targets could forget.

The renderer step is separate and must come **first**, because `ensure-renderer.mjs` deliberately
never overwrites an existing renderer — if you skip it you package whatever is already in
`dist/renderer`, which on a fresh checkout is the placeholder page.

### Verifying the result

`scripts/verify-installer.mjs` is the desktop counterpart of `apps/mobile/scripts/verify-apk.mjs`.
It asserts on the produced artifact rather than describing it: the installer's size and SHA-256; that
`resources/ffmpeg/win/ffmpeg.exe` and `ffprobe.exe` are present, **start**, carry `libx264` and speak
`rtmp`/`rtmps`; that `app.asar` holds `dist/main/`, `dist/preload/` and a real `dist/renderer/`
bundle rather than the placeholder; and that the renderer is the REAL build, checked two independent
ways that must agree (`dist/renderer/build-mode.json`, written by `build-renderer.mjs` after Vite
exits, and the `return"false"!=="false"` constant Vite folded into the shipped chunk).

`scripts/smoke-installed.mjs` launches `release/win-unpacked/LIVETAP.exe` itself and reads back
`isPackaged`, the window contents, and the `ffmpeg resolved { path, source }` line out of the app's
own log — which must say `source: 'bundled'`. It runs against a throwaway `--user-data-dir`, both so
it cannot touch a real profile and because main takes a single-instance lock keyed on that directory:
any other LIVETAP running on the host would otherwise make the packaged launch quit before it opened
a window.

If `dist/renderer` is missing, the `prepackage` step (`scripts/ensure-renderer.mjs`) copies
`packaging/renderer-placeholder.html` into place, so packaging still succeeds and ships a page that
says the renderer is not built. This is deliberate: the Electron shell and the whole electron-builder
pipeline can be exercised independently of the web team's build. The step **never** overwrites a real
renderer — it only writes when the file is missing.

Packaging inputs that must be committed live in `apps/desktop/packaging/`
(`entitlements.mac.plist`, `installer.nsh`, `renderer-placeholder.html`) rather than the
conventional `build/`, because the repo-wide `.gitignore` ignores every directory named `build/` and
these are source files, not artefacts.

### FFmpeg: bundled, but not committed

The binaries are **not** in git (222 MB each for the gyan.dev full build, and GPL). They are put in
place by:

```bash
node tools/acquire-ffmpeg.mjs           # --force to re-copy over what is already there
```

which resolves `ffmpeg`/`ffprobe` on PATH to the real executable behind any shim (on this host the
WinGet entry is a 151-byte reparse point; copying that verbatim would produce an installer
containing a link to a directory the user does not have), copies both into
`apps/desktop/resources/ffmpeg/<platform>/`, then **runs each copy** and asserts it identifies itself
correctly. Nothing is downloaded: if no usable binary is found it prints the exact download URL and
the exact destination path and exits non-zero, which propagates up through `prepackage` and stops the
packaging run.

It also copies the build's `LICENSE` and `README.txt` next to the binaries as `FFMPEG-LICENSE.txt`
and `FFMPEG-BUILD-README.txt`, and writes `resources/ffmpeg/BUILD_INFO.txt` with the version line,
the full configure line and the SHA-256 of each binary. Those three files ARE committed: they are
the record of what shipped, and the licence text has to travel with the binary (GPLv3 §4).
`electron-builder.yml` copies the whole tree to `resources/ffmpeg/` inside the app, filtering out
only this repo's own `README.md` notes.

Use a **GPL** build; never `--enable-nonfree`, which cannot be redistributed at all. An LGPL build is
not a substitute: `src/main/ffmpeg/argv.ts` names `libx264`, which is GPL, and on a machine with no
working hardware encoder it is the only path to a transcode. The written source offer, the exact
build string and the component list are in `THIRD_PARTY_NOTICES.md`.

A build with no binary present still runs: main logs an error and `capabilities()` reports
`verification: 'UNAVAILABLE'` rather than falling through to whatever `ffmpeg` is on the user's PATH.
That is why `prepackage` treats a missing FFmpeg as a hard failure — an installer that opens a window
and cannot broadcast is worse than no installer.

---

## 2. Packaging result on this host — PASS (unsigned, FFmpeg bundled)

**2026-09-15.** The first build that contains FFmpeg, and therefore the first installer that can
broadcast. Full artifact record, hashes and owner instructions: `docs/release/ALPHA_RELEASE.md`.

```
$ export PATH="$PWD/tools/node22/node:$PATH"          # v22.23.2
$ npm run package:win -w @livetap/desktop
  [acquire-ffmpeg] VERIFIED ffmpeg: ffmpeg version 9.0.1-full_build-www.gyan.dev …
  [acquire-ffmpeg] VERIFIED ffprobe: ffprobe version 9.0.1-full_build-www.gyan.dev …
  renderer present: ...apps\desktop\dist\renderer\app.html
endererpp.html
  • electron-builder  version=26.15.3 os=10.0.20348
  • packaging       platform=win32 arch=x64 electron=44.3.0 appOutDir=release\win-unpacked
  • default Electron icon is used  reason=application icon is not set
  • building        target=nsis file=release\LIVETAP-0.1.0-win-x64.exe oneClick=false perMachine=false
  • building block map  blockMapFile=release\LIVETAP-0.1.0-win-x64.exe.blockmap
EXIT=0
```

| Artifact | Size |
|---|---|
| `LIVETAP-0.1.0-win-x64.exe` (NSIS installer) | 230,661,718 B |
| `LIVETAP-0.1.0-win-x64.exe.blockmap` | 240,302 B |
| `latest.yml` (electron-updater feed) | 347 B |
| `release/win-unpacked/` on disk | ~794 MB |

SHA-256 of the installer: `9f148bce093afac1340e4f1b2517798ab65b61b52dd40b8049addf83add07001`.

Verified afterwards, both exit 0:

```
$ node apps/desktop/scripts/verify-installer.mjs      → 30/30 checks PASS
$ node apps/desktop/scripts/smoke-installed.mjs       → window opened, shell rendered,
                                                        ffmpeg source: "bundled"
```

`Get-AuthenticodeSignature` on the installer, `LIVETAP.exe` and the bundled `ffmpeg.exe` reports
`NotSigned` for all three — expected, see §3.

macOS packaging is **UNVERIFIED** — no macOS machine. `npm run package:mac` on a Mac is expected to
work from the same config, but has not been executed, and `resources/ffmpeg/mac/` is empty:
`tools/acquire-ffmpeg.mjs` must be run on the Mac to populate it (it refuses to claim a binary works
when it cannot execute it).

### Earlier result, for comparison

The 2026-09-12 build was 95,901,044 B on Electron 38.8.6 with an empty `resources/ffmpeg/`. It
opened a window and could not broadcast. The size difference is FFmpeg.

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
3. **`electronVersion` must be explicit.** electron-builder refuses a semver range because it
   downloads binaries for one exact release, and in an npm workspace `electron` is hoisted to the
   repo root where electron-builder does not look. **Fix: `electronVersion` in
   `electron-builder.yml` — keep it in step with the `electron` devDependency when bumping.**
   It said `38.8.6` for three days after the devDependency moved to `^44.3.0`, so every build in
   that window packaged an Electron that nobody had run the app against, and that still carried the
   advisories the bump was made to escape. Corrected to `44.3.0` on 2026-09-15. Nothing warns about
   this: the two numbers live in different files and electron-builder happily downloads whichever it
   is told.

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
3. `node tools/acquire-ffmpeg.mjs --force` on each target platform, then refresh the build
   string and hashes in `THIRD_PARTY_NOTICES.md` from the regenerated
   `apps/desktop/resources/ffmpeg/BUILD_INFO.txt`.
4. `npx vitest run --project desktop` — 275 tests, must be green.
5. `node apps/desktop/dist/verify/verify-engine.cjs` — 9/9 steps, must exit 0.
6. `npm run package:win` and `npm run package:mac` with the signing variables exported.
7. `node apps/desktop/scripts/verify-installer.mjs` (must be all-PASS) and
   `node apps/desktop/scripts/smoke-installed.mjs` (must report `source: 'bundled'`).
8. `codesign -dv --verbose=4` the mac app **and** the nested ffmpeg; `signtool verify /pa` the exe.
9. Install from the artifact on a clean machine; confirm `livetap://` opens the app and
   `%APPDATA%\LIVETAP` / `~/Library/Application Support/LIVETAP` is created.
10. Publish, then verify a previous version actually updates to it.

## 7. Outstanding

| Item | Status |
|---|---|
| Windows code signing | BLOCKED_EXTERNAL_DEPENDENCY — no certificate |
| macOS signing + notarization | BLOCKED_EXTERNAL_DEPENDENCY — no Apple Developer account |
| macOS build | UNVERIFIED — no macOS machine |
| Auto-update wiring in main | NOT STARTED — depends on signing and on the UI |
| App icon | NOT STARTED — default Electron icon in use |
| `publish.owner` / `publish.repo` | placeholders |
| `electron-builder` on `^26.15.3` | needs Node ≥ 20.19; host Node is 20.11, so packaging runs with `tools/node22` first on PATH |
| FFmpeg for macOS | `resources/ffmpeg/mac/` is empty — run `tools/acquire-ffmpeg.mjs` on a Mac |
| `electron-updater` fails to initialise in the packaged build | non-fatal, caught and logged as `electron-updater unavailable { error: "TypeError: Cannot set properties of undefined (setting 'autoDownload')" }`. Nothing depends on it because the update check is not wired into the UI, but it must be fixed before auto-update ships. |

## 8. BLOCKERS.md B-002 (FFmpeg GPLv3 source offer) — what is now done, what is left

Recorded here rather than in `BLOCKERS.md` because this stream does not own that file. **The
integrator should close or downgrade B-002 using this section.**

**Done, as of 2026-09-15 — no longer a blocker for the owner's own alpha:**

- The exact build is pinned and recorded mechanically, not by hand: `ffmpeg 9.0.1-full_build-www.gyan.dev`,
  with the full `./configure` line and the SHA-256 of both binaries written to
  `apps/desktop/resources/ffmpeg/BUILD_INFO.txt` by `tools/acquire-ffmpeg.mjs` on every packaging run.
- The GPLv3 text **ships inside the installer** at `resources/ffmpeg/win/FFMPEG-LICENSE.txt`, and
  `scripts/verify-installer.mjs` fails the build if it is missing (GPLv3 §4).
- A **written offer** with a real, verifiable URL is in `THIRD_PARTY_NOTICES.md`: the corresponding
  source is the upstream commit the build was compiled from,
  https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a, published by the build's distributor in the
  `README.txt` that ships alongside the binary; requests go to
  https://github.com/BigBackBitcoin/livetap/issues.
- The LGPL question is answered rather than dodged: `src/main/ffmpeg/argv.ts` names `libx264`, which
  is GPL, and on this host every hardware encoder probed UNAVAILABLE. An LGPL build would be a
  functional regression, so the GPL build ships and the obligations are met.

**Left, and genuinely an owner decision:**

1. Whether to host a source **mirror** of our own (e.g. a `livetap-ffmpeg-builds` repo with the
   tagged source and build config) rather than relying on the upstream commit and the distributor
   remaining reachable. GPLv3 §6(b)/(d) permits either; a mirror is the durable choice.
2. **Who answers** a source request, and within what time. The offer currently names the public issue
   tracker, which is real but unstaffed by policy.
3. Confirm MIT vs Apache-2.0 for LIVETAP itself (ADR-013 / HANDOFF), which is independent of FFmpeg.

None of these block the owner installing the alpha on their own machine: GPLv3 §6 attaches to
*conveying* the object code, and nothing has been conveyed to a third party.

---

## Addendum 2026-09-11 — Electron 44.3.0 / electron-builder 26.15.3

Bumped for security (Electron ≤40.10.2 carried 19 advisories incl. a context-isolation bypass; `builder-util-runtime` <9.7.0 leaked tokens on cross-origin redirects). After the bump: `npm audit` reports 0 high/critical (4 dev-only moderate/low in vitest/esbuild). Desktop suite 275/275, `tsc` clean, `tsup` build OK. `npm run package:win` executed with a portable Node 22.23.2 (electron-builder 26.15 needs Node ≥20.19; host Node is 20.11) → `release/LIVETAP-0.1.0-win-x64.exe` 93.9 MB, unsigned: **PASS**.

## Note — Electron binary on Node < 20.19 hosts

Electron 44's `install.js` uses `require(esm)`, so on Node 20.11 every `npm install`/`npm ci` leaves
`node_modules/electron/dist` empty ("Electron failed to install correctly"). Fix on such hosts:

```bash
PATH="tools/node22/node:$PATH" node node_modules/electron/install.js
```

CI uses Node 22 and does not need this. The renderer entry is `dist/renderer/app.html` (the React
app); `index.html` in the same folder is the public experience and is not loaded by the desktop shell.
