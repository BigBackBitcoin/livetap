# LIVETAP alpha — the Windows installer

**This is the artifact.** Everything below is either a fact about the file on disk, verified by a
command whose output is quoted, or clearly labelled as untested.

---

## 1. The artifact

| | |
|---|---|
| File | `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe` |
| Kind | NSIS installer, per-user (no admin password needed) |
| Size | 230,661,718 bytes (220 MB) |
| SHA-256 | `52952ee8ecbe79c6ece1fe4732bd7021f3df806c3ae950bfab493a402643f65a` |
| Version | 0.1.0 |
| Built from commit | `3ec7f8fbf0b4fd8a86cae847dc5d27295778ce3e` **plus uncommitted working-tree changes** — see §7 |
| Built | 2026-09-15T06:22:53Z |
| Platform | Windows x64 only. macOS is unbuilt: there is no Mac here. |
| Electron | 44.3.0 |
| Signed | **No.** See §4. |
| Disk after install | ~794 MB (`release/win-unpacked` measured with `du -sh`) |

Check the download matches before installing:

```powershell
certutil -hashfile LIVETAP-0.1.0-win-x64.exe SHA256
# 52952ee8ecbe79c6ece1fe4732bd7021f3df806c3ae950bfab493a402643f65a
```

### Why it is 220 MB

FFmpeg is inside it. The bundled `ffmpeg.exe` and `ffprobe.exe` are 222 MB each before compression,
because the gyan.dev "full" build links every codec statically. Without them the installer is 94 MB
and the installed app cannot put a single byte on the wire — `resolveFfmpegPath()` returns
`source: 'unavailable'` in a packaged build with an empty resources directory, by design, so that a
build missing FFmpeg fails loudly instead of quietly falling back to whatever `ffmpeg` happens to be
on the user's PATH. The size is the price of an app that actually broadcasts.

---

## 2. What is inside — verified, not described

`node apps/desktop/scripts/verify-installer.mjs` asserts on the artifact itself. 30/30 checks pass.
It proves, among other things:

- `resources/ffmpeg/win/ffmpeg.exe` and `ffprobe.exe` are present **and start**, reporting
  `ffmpeg version 9.0.1-full_build-www.gyan.dev`;
- the shipped FFmpeg has `libx264` (the transcode fallback names it), `aac`, and speaks `rtmp` and
  `rtmps`;
- `resources/app.asar` contains `dist/main/`, `dist/preload/` and `dist/renderer/` with 42 real JS
  chunks — not the packaging placeholder page;
- the renderer is the **real** build, not the demo, proven two independent ways that must agree:
  `dist/renderer/build-mode.json` says `mockMode: false`, and the constant Vite folded into the
  shipped bundle is `return"false"!=="false"`;
- `FFMPEG-LICENSE.txt` travels with the binary, as GPLv3 §4 requires.

Re-run it any time:

```bash
node apps/desktop/scripts/verify-installer.mjs
```

### The app was launched, not just packaged

`node apps/desktop/scripts/smoke-installed.mjs` launches `release/win-unpacked/LIVETAP.exe` — the
exact binary the installer lays down — under Playwright and reads back:

```json
{
  "title": "LIVETAP",
  "url": "file:///.../win-unpacked/resources/app.asar/dist/renderer/app.html#/app/start",
  "hasShell": true,
  "runtime": { "isPackaged": true, "electron": "44.3.0" },
  "ffmpeg": { "source": "bundled" }
}
```

`ffmpeg.source` is read out of the app's **own** log line (`ffmpeg resolved { path, source }`), so
it is the running application's answer, not this script's opinion. `bundled` is the only acceptable
value for a packaged build: `path` would mean it fell through to the user's machine, `unavailable`
that the packaging step shipped nothing. A screenshot of the first window is at
`apps/desktop/e2e/__screenshots__/installed-first-window.png`.

The shipped build is the REAL build. It did **not** need `LIVETAP_DESKTOP_DEMO=1` to open.

---

## 3. What is inside — FFmpeg and its licence

| | |
|---|---|
| Build | `ffmpeg version 9.0.1-full_build-www.gyan.dev` (gyan.dev "full" static build) |
| Licence | GPLv3 (`--enable-gpl --enable-version3`, links libx264 and libx265) |
| Upstream source | https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a |
| SHA-256 `ffmpeg.exe` | `57c56e369d5b4873b4d93fc1a1d833cb7cd8bc9325c14b05c34ce60b22842d8a` |
| SHA-256 `ffprobe.exe` | `afe05347caaabe479b3c4eae71992b6ec1e11c57266a1d665deb0f9fe9847208` |
| Licence text in the app | `resources/ffmpeg/win/FFMPEG-LICENSE.txt` |
| Build record in the app | `resources/ffmpeg/BUILD_INFO.txt` (full configure line + hashes) |

An LGPL build is **not** a sufficient substitute and this repository does not pretend otherwise:
`argv.ts` asks for `libx264` by name, and on this host the three hardware encoders
(`h264_nvenc`, `h264_qsv`, `h264_amf`) all probed UNAVAILABLE, leaving `libx264` the only working
encoder. The full written source offer is in `THIRD_PARTY_NOTICES.md`.

Distributing this installer to anyone else triggers GPLv3 §6. Installing it yourself does not.

---

## 4. It is unsigned, and Windows will say so

**Confirmed** with `Get-AuthenticodeSignature`: the installer, `LIVETAP.exe` and the bundled
`ffmpeg.exe` all report `Status: NotSigned`. There is no Windows code-signing certificate on this
build host and one cannot be obtained from here — it needs a paid, identity-verified account and,
since 2023, a hardware token or HSM. `docs/release/DESKTOP_RELEASE.md` §3 lists exactly which
environment variables turn signing on the day a certificate exists.

### What you will see, and which button to press

**Label: PLAUSIBLE.** SmartScreen's exact wording varies with the Windows build and cannot be
observed from here — this build host does not show the prompt for a locally produced file. The
*unsigned* status is CONFIRMED; the dialog text below is the standard one for an unrecognised
unsigned app.

When you double-click `LIVETAP-0.1.0-win-x64.exe`, Windows SmartScreen shows a blue box:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognised app from starting. Running this app might
> put your PC at risk.
> `[Don't run]`

1. Click the small **More info** link (it is under the message text, easy to miss — the dialog
   deliberately hides the run button behind it).
2. The dialog expands and shows `Publisher: Unknown publisher`. That is correct and expected: there
   is no certificate, so there is no publisher name to show.
3. Click **Run anyway**.

You may also see a Windows Firewall prompt the first time you go live, because FFmpeg opens an
outbound connection. Allow it on **Private networks**; the app does not listen for inbound
connections.

Verify the SHA-256 (§1) before doing any of this. That hash, not a signature, is what tells you the
file is the one described here.

---

## 5. Install it and go live

**Label: PLAUSIBLE, not CONFIRMED.** This section is written from the code and the packaged
artifact, not from having done it. There is no camera, no microphone and no platform account on this
build host, so the install-to-live path has never been walked end to end. What *is* confirmed is
that the packaged app opens, renders this exact first screen (§2), and sees its bundled FFmpeg. The
rest is the first thing to find out.

1. **Install.** Double-click the `.exe`, get past SmartScreen as in §4, choose an install location
   (or accept the default), finish. It installs for your user only — no admin password. A desktop
   shortcut and a Start-menu entry named **LIVETAP** are created.
2. **Open it.** First launch takes a few seconds while Electron warms up. You land on
   *Step 1 of 3 — What are you making?* Pick the one that fits (Talking, Gaming, Podcast,
   Presentation, Event, Vertical Live), or **Skip setup**.
3. **Let it see your camera and microphone.** Windows prompts per device on first use. If you say no,
   the app keeps working with whatever it still has and says so rather than pretending.
4. **Add a destination — tap the platform, not "Custom".** Go to **Destinations** →
   **Add destination** → **YouTube**. LIVETAP looks for an OAuth client for YouTube, finds none in
   this build, and opens a paste form **already pointed at YouTube**: the server address is
   pre-filled with `rtmp://a.rtmp.youtube.com/live2` and the destination is already named YouTube.
   The only thing you type is the stream key.
   - YouTube: Studio → Go live → Stream → **Stream key** (the Stream URL is already filled in)
   - Twitch: Creator Dashboard → Settings → Stream → **Primary Stream key**
   - Anything else with an RTMP ingest: the Custom destination takes both halves.

   This is a real destination of that real platform, not a generic one: it carries YouTube's aspect
   ratios, YouTube's bitrate ceiling, and YouTube's own warning that it will not publish until you
   press **Go live** in Studio. It needs no OAuth app, no review queue and no approval.

   **CONFIRMED**, unlike the rest of this section: `npm run verify:paste` drives exactly this flow
   through the built app and puts real encoded bytes on a real RTMP wire. What it cannot prove is
   that youtube.com accepts them — that is step 5 on your own channel.

   Keys are stored through the OS credential store (DPAPI via Electron `safeStorage`) and are
   redacted in logs.
5. **Go live.** Back in Studio, check the preview, then press **GO LIVE**. The state the app shows
   is the state it actually observed: it will not say LIVE unless FFmpeg reported the connection
   established.
6. **Stop.** Press the same control to end. Recordings, if you enabled them, land under
   `%APPDATA%\LIVETAP\recordings`.

### One thing it does on its own, so you are not surprised by it

On launch the app asks `https://livetap.vercel.app/api/oauth/config` which platforms this
deployment can sign you in to. That is your own Vercel deployment, it is the only call the app makes
that you did not ask for, it carries no identifier of you, and its answer decides one thing: whether
tapping YouTube opens a sign-in or the paste form. With nothing registered it answers "none", which
is why the paste path is what you get. Set `VITE_LIVETAP_BROKER_URL` at build time to point it
somewhere else.

### If something goes wrong

- The app writes a log to `%APPDATA%\LIVETAP\logs\main.log`. It redacts stream keys (`••••` plus the
  last four characters) — it is safe to send.
- "FFmpeg unavailable" should be impossible in this build. If you see it, the installation is
  damaged; reinstall.
- Auto-update does nothing in this build, on purpose — see §6.

---

## 6. What this build deliberately does not do

| | |
|---|---|
| Auto-update | Not wired. `app-update.yml` still carries `REPLACE_WITH_GITHUB_OWNER/REPO` placeholders, so the app can never find an update. Auto-update also requires code signing, which does not exist. To upgrade, install the next build over this one. |
| macOS build | Not produced. No Mac on this host. The config is in place and untested. |
| App icon | Default Electron icon. |
| Code signing / notarization | None. §4. |

There is also a known, non-fatal warning in the packaged app's log at startup:
`electron-updater unavailable { error: "TypeError: Cannot set properties of undefined (setting
'autoDownload')" }`. It is caught and logged; nothing downstream depends on it, because the update
check is not wired into the UI. It is recorded here rather than left for someone to find.

---

## 7. Reproducing this artifact

```bash
npm install                                   # once, from the repo root
node tools/acquire-ffmpeg.mjs                 # puts ffmpeg + ffprobe in place, and PROVES they run
npm run build:renderer -w @livetap/desktop    # the React app, mock mode OFF
npm run package:win    -w @livetap/desktop    # → apps/desktop/release/LIVETAP-0.1.0-win-x64.exe

node apps/desktop/scripts/verify-installer.mjs   # 30/30 assertions on the artifact
node apps/desktop/scripts/smoke-installed.mjs    # launches the packaged app and reads it back
```

`package:win` runs `prepackage`, which runs `tools/acquire-ffmpeg.mjs` itself, so the explicit call
above is only needed if you want to see it fail early. On a checkout with no FFmpeg anywhere, the
packaging run stops and prints the exact download URL and the exact destination path rather than
producing an installer that cannot broadcast.

**On this build host**, electron-builder 26.15.3 needs Node ≥ 20.19 and the host Node is 20.11, so
put the portable Node 22 first on PATH:

```bash
export PATH="$PWD/tools/node22/node:$PATH"     # v22.23.2
```

### Byte-for-byte reproducibility

This installer is **not** bit-reproducible, and the SHA-256 above identifies this exact file rather
than certifying that the same command produces the same bytes. Two reasons: the NSIS archive embeds
timestamps, and the build was made from commit `3ec7f8f` **plus uncommitted working-tree changes**
(the packaging work described here, and parallel work in `apps/web` by other streams). Once that
tree is committed, a rebuild from the commit will produce a functionally identical installer with a
different hash.

---

## 8. Verification log

Every claim in this document that is marked CONFIRMED was produced by one of these commands on
2026-09-15 on Windows Server 2022, Node 22.23.2:

| Command | Result |
|---|---|
| `node tools/acquire-ffmpeg.mjs` | exit 0; VERIFIED ffmpeg 9.0.1, VERIFIED ffprobe 9.0.1 |
| `npm run package:win -w @livetap/desktop` | exit 0; `release/LIVETAP-0.1.0-win-x64.exe` |
| `node apps/desktop/scripts/verify-installer.mjs` | exit 0; 30/30 PASS |
| `node apps/desktop/scripts/smoke-installed.mjs` | exit 0; window opened, shell rendered, `ffmpeg.source: "bundled"` |
| `Get-AuthenticodeSignature` on all three exes | `NotSigned` |

**Not confirmed, and not claimed:** that running the NSIS installer on a clean machine lays the
files down correctly (there is no clean machine here — the unpacked tree it was built from was
tested instead), and that any real platform has accepted a stream from this build. The second is
owner hardware and an owner account; §5 is how to find out.
