# LIVETAP Desktop Architecture

Status: **implemented and verified on the build host** (Windows Server 2022, AMD EPYC-Rome 4 vCPU,
12 GB RAM, no GPU, Node 20.11.1, Electron 38.8.6 / Chromium 140.0.7339.249, FFmpeg 9.0.1-full).
Every number below was measured here. Raw evidence: `docs/qa/DESKTOP_ENGINE_VERIFICATION.md`.

Related: ADR-003 (Electron, not Tauri), ADR-005 (layered media engine), ADR-012 (H.264 + AAC over
RTMP/RTMPS is the universal transport).

---

## 1. The question: where does the video get encoded?

The desktop app has to turn a composited canvas into H.264 and push it to several platforms at once.
The renderer already owns the pixels (React + canvas, shared with web and mobile). FFmpeg lives in
the main process. Something has to cross the process boundary. Three candidates were on the table:

| | Option A | Option B | Option C |
|---|---|---|---|
| Renderer produces | MediaRecorder (H.264/WebM) | raw RGBA frames | WebCodecs `VideoEncoder` (H.264 Annex-B) |
| Crosses IPC | ~0.58 MB/s | ~237 MB/s | ~0.58 MB/s |
| Main process does | remux + Opus→AAC | encode everything | mux elementary streams |
| Video encodes in the pipeline | 1 (Chromium) | 1 (FFmpeg) | 1 (Chromium) |
| Control over bitrate/GOP | coarse | total | precise |

### Measured: IPC throughput (Electron 38.8.6, `ipcRenderer.send` with an ArrayBuffer)

| Payload | Sends | ms per send | Throughput |
|---|---|---|---|
| 16 KB | 200 | 0.13 | 122.5 MB/s |
| 64 KB | 200 | 0.39 | 162.3 MB/s |
| 256 KB | 200 | 1.36 | 184.4 MB/s |
| 1 MB | 200 | 6.15 | 162.6 MB/s |
| 8.29 MB (one 1080p RGBA frame) | 30 | **46.84** | 168.9 MB/s |

### Measured: canvas readback

`ctx.getImageData(0, 0, 1920, 1080)` costs **6.18 ms per frame** and yields 8,294,400 bytes.
At 30 fps that is **237.3 MB/s** of IPC traffic.

### Verdict on Option B — **REJECTED, with numbers**

A 1080p30 raw pipeline needs 237.3 MB/s. The measured IPC ceiling on this host is 184.4 MB/s, so it
is **1.29× over budget before a single frame is encoded**. Worse, per-frame latency alone rules it
out: 6.18 ms readback + 46.84 ms transfer = **53.0 ms per frame against a 33.3 ms budget at 30 fps**.
Option B cannot reach 1080p30 on this machine, and the shortfall is structural rather than a tuning
problem. It was not implemented.

> **Reconciliation with `docs/research/MEDIA_ENGINE_EVALUATION.md` §5.3.** That evaluation chose
> "renderer composites → raw frames over stdin" as the desktop path, estimating ~249 MB/s and
> calling it "fine locally". The estimate is of **in-process memory bandwidth**, and that part is
> right — a memcpy at that rate is unremarkable. What it did not measure is the hop that actually
> exists in Electron: a sandboxed renderer **cannot write to a child process's stdin**, so every
> frame must cross `ipcRenderer` to the main process first. Measured here, that hop costs 46.84 ms
> for one 1080p RGBA frame against a 33.3 ms budget. The evaluation's Option B (an encoded
> bitstream over IPC, which it files as a "Phase 2 optimisation") is therefore the only viable
> shape, and A′ below is its simplest form — MediaRecorder instead of WebCodecs. Same conclusion
> about where the encode belongs; different conclusion about what crosses the boundary, on the
> strength of a number neither of us had before.

### Measured: what Chromium can actually produce

```
MediaRecorder.isTypeSupported('video/webm;codecs=h264')       → true
MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus')  → true
MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') → true
VideoEncoder.isConfigSupported('avc1.42E01E' @1920x1080)      → false
VideoEncoder.isConfigSupported('avc1.640028' @1920x1080)      → true
```

Then an actual 8-second 1080p30 recording of a `canvas.captureStream(30)` plus a 48 kHz audio track:

| Property | Measured |
|---|---|
| `recorder.mimeType` (requested `video/webm;codecs=h264,opus`) | **`video/x-matroska;codecs=avc1,opus`** |
| Video codec / profile | H.264 **Constrained Baseline**, 1920×1080 |
| Frames encoded / drawn | 237 / 243 in 7.9 s → **30.0 fps, 2.5 % render drop** |
| Keyframe interval | 0.872, 1.731, 2.556, 3.412, 4.270, 5.129 s → **~0.86 s** |
| Requested vs actual bitrate | 4500 kbps requested, **2.68 Mbps actual** |
| Chunk size at a 1 s timeslice | 294–346 KB (mean ~331 KB) |

Three things follow, and two of them are traps:

1. **Chromium lies about the container.** It reports `video/webm;codecs=h264` as supported and then
   emits **Matroska**. FFmpeg must therefore be told `-f matroska`, not `-f webm`, or it mis-probes
   the pipe. This is encoded in `containerForMime()` and unit-tested.
2. **The keyframe interval is already fine.** ~0.86 s is well inside what every platform wants
   (≤ 4 s, typically 2 s), so the lack of GOP control in MediaRecorder is not a blocker. This was the
   main risk to Option A and it did not materialise.
3. **The profile is Constrained Baseline**, not High. Baseline is accepted by YouTube, Twitch and
   every RTMP ingest, but it is roughly 10–20 % less efficient than High at the same quality. This is
   the real, honest cost of Option A, and the reason Option C stays on the roadmap.

### Decision: **Option A′** — MediaRecorder H.264 → IPC → FFmpeg remux

```
renderer: canvas → MediaRecorder('video/webm;codecs=h264,opus')   ← the ONLY video encode
              │ ~331 KB every 1 s = 0.58 MB/s = 0.35 % of measured IPC capacity (1.36 ms per send)
              ▼
main:     ffmpeg -f matroska -i pipe:0 -c:v copy -c:a aac -f mpegts pipe:1
                             └─ video is COPIED, never re-encoded; only Opus→AAC is transcoded
```

The prime `′` is the part worth naming: video is **copied**, not re-encoded. The pipeline contains
exactly one video encode, and it happens in Chromium where the frames already live. FFmpeg's only
video work is parsing. The Opus → AAC transcode is required (FLV cannot carry Opus) and is cheap —
audio is under 4 % of the bitrate.

Verified end to end: remuxing the measured 8-second Matroska file to MPEG-TS with `-c:v copy -c:a aac`
produced a valid 7.95 s H.264/AAC stream at 2.82 Mbps, exit code 0.

**Fallback, implemented:** if `probeRecorderSupport()` finds no H.264 (a Chromium build with codecs
stripped, an enterprise policy), the engine transcodes VP8/VP9 → H.264 with libx264 in the same
encoder process. Still one encode per aspect ratio, but now it costs ~67 % of a core instead of
being free. The renderer diagnostic says which path is in use, in plain language.

**Option C is the upgrade path, not the MVP.** WebCodecs accepts `avc1.640028` (High 4.0) at 1080p
here, which would buy High profile, exact CBR and explicit keyframe placement. It costs a hand-built
muxer for two elementary streams (H.264 Annex-B + Opus) or a JS MPEG-TS muxer, and it cannot be
tested against a real camera on this host. Not worth the complexity for v1 when A′ measurably works.

---

## 2. Topology: one encoder, N senders (not the `tee` muxer)

The textbook answer to fan-out is FFmpeg's `tee` muxer:

```
-f tee "[f=flv:onfail=ignore]rtmp://a/x|[f=flv:onfail=ignore]rtmps://b/y|[f=mp4]rec.mp4"
```

**We do not use it as the primary topology, because a tee output list is fixed at process start.**
Adding a destination mid-broadcast, or reconnecting one that dropped, means restarting the encoder —
which interrupts *every other destination and the recording*. For an app whose entire promise is
"one destination failing never affects the others", that is the wrong shape.

### What ships instead

```
                                          ┌── sender A  ffmpeg -f mpegts -i pipe:0 -c copy -f flv   → rtmp://…
  renderer ──IPC──►  encoder ffmpeg       │
   (1 encode)         -c:v copy           ├── sender B  ffmpeg -f mpegts -i pipe:0 -c copy -f flv   → rtmps://…
                      -c:a aac            │
                      -f mpegts pipe:1 ───┤── sender C  ffmpeg -f mpegts -i pipe:0 -c copy -f mpegts → srt://…
                            │             │
                      TsFanout (in-process)└── recorder ffmpeg -f mpegts -i pipe:0 -c copy -f mp4   → file
```

- **One encoder process per aspect ratio.** Three destinations sharing 16:9 cost one encode. A 9:16
  destination adds a second encoder — per *format*, never per *destination*.
- **One sender process per destination**, doing `-c copy`. Measured at **5.8 % of one core each**.
- **The recorder is just another sink** on the same stream, so recording costs no extra encode
  (`RecordingSettings.source` is `'program'`, and the guard refuses anything else).
- Add, remove, restart a destination = start or kill **one** short-lived process. The encoder is
  untouched from GO LIVE to the end. Verified: the encoder PID was identical before and after a
  destination was killed and re-added.

### Why MPEG-TS as the internal transport

MPEG-TS is self-synchronising: fixed 188-byte packets, a sync byte, and PAT/PMT tables repeated
throughout the stream. That is exactly what a sender attached *mid-broadcast* needs in order to lock
on. The encoder emits `-mpegts_flags +resend_headers -pat_period 0.1`, so a late joiner sees program
tables within 100 ms. `TsFanout` re-chunks the stream to whole 188-byte packets and only ever starts
a new sink on a packet boundary; without that, every late destination would be permanently out of
phase with the packet grid.

### Backpressure: the invariant that matters

`TsFanout` **never pauses the source.** If it honoured stream backpressure, one wedged destination
(a full socket buffer, a hung platform) would stall the encoder and therefore stall *every* other
destination and the recording — the exact failure the topology exists to prevent. Instead each sink
has its own bounded queue (4 MB ≈ 7 s at 4.5 Mbps) and drops whole aligned blocks on overflow,
counting them into `EngineMetrics.networkDroppedPct`. Unit-tested with a `Writable` that never calls
its write callback.

### tee, measured anyway

The tee form is still built and tested (`buildTeeOutput`), because it is the right answer for a
future "record two files, no network" case. Two findings from exercising it on FFmpeg 9.0.1:

- Escaping `:` in a slave URL (`rtmp\://host:1935/live/key`) works. So does *not* escaping it —
  tee only treats `:` inside the `[...]` option block as a separator. Both forms were confirmed
  against a live RTMP listener. We escape anyway, for portability with older FFmpeg.
- **`fifo_options` must be passed GLOBALLY, not per-slave.** In the per-slave form its entries are
  separated by `:`, the same separator tee uses for its own option block, and FFmpeg 9.0.1 rejects
  it escaped at every backslash depth tried — `fifo_options=attempt_recovery=1\:recover_any_error=1`
  fails with `Unknown option 'recover_any_error'` and that slave silently writes **zero bytes with
  exit code 0**. As a *global* option before the tee URL the same `:`-separated list parses fine and
  all five options can be set at once. `teeGlobalArgs()` emits the global form;
  `TeeSlave.fifoQueueSize` keeps the one-option per-slave form for completeness and says so.
  (The global form was reported by `docs/research/MEDIA_ENGINE_EVALUATION.md` §5.3 and re-verified
  here — our initial per-slave finding was correct but incomplete.)
- **tee needs an anchor slave.** If *every* slave fails to open, `onfail=ignore` does not save the
  process: FFmpeg exits non-zero having written nothing. Measured here with two dead RTMP slaves →
  exit -1, both outputs 0 bytes. `buildTeeOutput` therefore refuses a slave list containing only
  network URLs, and requires at least one local file or `[f=null]-`.

---

## 3. Measured cost

1080p30, libx264 `veryfast`, CBR 4500 kbps + 160 kbps AAC, 30 seconds, 4 vCPU:

| Process | CPU (one core = 100 %) | Share of machine |
|---|---|---|
| Encoder (lavfi source, full libx264 encode) | **66.6 %** (samples: 83.5, 84.7, 56.3, 61.7, 54.7, 58.6) | 16.6 % |
| Each sender (`-c copy`) | **5.8 %** | 1.5 % |

That 66.6 % is the *worst case* — the verification harness makes FFmpeg do the whole encode from a
synthetic source. On the shipping Option A′ path the encoder only remuxes, so this number is the
cost of the **fallback** path, and the headroom figure to plan against.

The fan-out cost is what matters for the product claim: each additional destination is ~5.8 % of one
core, not another 66 %. Ten destinations on one aspect ratio is one encode plus ~58 % of a core.

---

## 4. Security posture

Electron's default is a browser with Node in it. Every choice here walks that back.

| Control | Setting | Where |
|---|---|---|
| Renderer isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` | `src/main/index.ts` |
| CSP | injected into every response by main via `onHeadersReceived`, not a removable `<meta>` tag | `src/main/security/policy.ts` |
| IPC | one named, typed, allow-listed method per operation; **no generic `invoke(channel)`** | `src/preload/index.ts` |
| IPC payloads | hand-written guards, no `any`, no schema library; non-objects and prototype-polluting keys refused | `src/shared/guards.ts` |
| IPC sender | every handler checks `event.sender.id` against the app window | `src/main/ipc.ts` |
| Permissions | deny by default; allow only `media`, `display-capture`, `fullscreen`, `mediaKeySystem`, and only from the app's own origin | `policy.ts` |
| Devices | `setDevicePermissionHandler(() => false)` — no HID, serial, USB, Bluetooth | `index.ts` |
| Navigation | `will-navigate` pinned to the app's own document; `setWindowOpenHandler` → `shell.openExternal` for **https only** | `index.ts` |
| Child processes | **argv arrays only**, never `shell: true`, never string concatenation; ingest re-validated inside the argv builder | `ffmpeg/argv.ts` |
| Secrets | `safeStorage` (DPAPI / Keychain) + atomic 0600 file; **refuses to store** if encryption is unavailable | `src/main/vault.ts` |
| Crash recovery | destination **ids** and settings only — no URLs, keys or tokens | `src/main/recovery.ts` |

### CSP, verified against Chromium 140 rather than asserted

The shipped policy string was applied through `onHeadersReceived` and probed from a real renderer:

| Probe | Result |
|---|---|
| Inline `<script>` runs | **blocked** (document title unchanged) |
| `eval('1+1')` | **blocked** — `EvalError: Refused to evaluate a string as JavaScript` |
| `new Function('return 1')` | **blocked** |
| `fetch('http://example.com/')` | **blocked** by `connect-src 'self' https: wss:` |
| `blob:` Worker (the compositor needs it) | allowed |
| `data:` image (avatars, thumbnails) | allowed |

Shipped policy:

```
default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: blob: https:;
media-src 'self' blob: mediastream:; script-src 'self'; style-src 'self' 'unsafe-inline';
font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; frame-src 'none';
frame-ancestors 'none'; base-uri 'self'; form-action 'none'
```

`connect-src` cannot be narrowed to a host list: users add arbitrary custom RTMP/WHIP providers and
each platform uses several API and CDN hostnames. `style-src 'unsafe-inline'` is required while the
UI positions layers with inline transforms; it is a far smaller risk than inline script, which is
fully closed.

### OAuth

Two redirect mechanisms, because platforms disagree:

1. **Loopback** `http://127.0.0.1:<ephemeral>/callback` — mandatory for Google/YouTube desktop
   clients (RFC 8252 §7.3). Binds 127.0.0.1 only, never `0.0.0.0`. A CSPRNG `state` is generated per
   flow and the callback is **refused unless it matches** — the documented mitigation for another
   local app racing the loopback redirect. Single-use, closed on success, and timed out after 5
   minutes so an abandoned sign-in leaves no listening port. Responses carry
   `Referrer-Policy: no-referrer` so the authorization code cannot leak into a Referer header.
2. **`livetap://`** private-use scheme for platforms that only allow a fixed redirect. Registered
   with `app.setAsDefaultProtocolClient`, delivered through `second-instance` (Windows/Linux) or
   `open-url` (macOS). Any web page can navigate to a custom scheme, so incoming URLs are parsed and
   scheme-checked before being forwarded, and the URL itself is **never logged** — it contains a code.

Token exchange happens with PKCE and no client secret on the device; confidential-client exchanges
go through the web app's server function (ADR-002).

---

## 5. FFmpeg distribution and licensing

**Decision: ship a GPL FFmpeg binary as a separate executable; LIVETAP stays MIT.**

The reasoning is the standard one and it depends entirely on *how* FFmpeg is used:

- LIVETAP **never links** FFmpeg. There is no libavcodec in the app binary, no FFI, no native addon.
- FFmpeg is invoked as a **separate process** through its documented command-line interface, and the
  two communicate over pipes — an arms-length interface, not shared address space.
- That is **mere aggregation** under GPLv3 §5: the FFmpeg binary remains GPL and must be distributed
  with its licence and a source offer; LIVETAP's own source is a separate work and keeps its
  permissive licence.

The build actually installed on this host is GPL **v3**, not v2: `ffmpeg -version` reports
`--enable-gpl --enable-version3`, and `libx264`/`libx265` are both linked in. That distinction
matters for the notices text below. (Established in `docs/research/MEDIA_ENGINE_EVALUATION.md` §1.1
and confirmed against this host's `configuration:` line.) That evaluation also recommends
**Apache-2.0** rather than MIT for LIVETAP itself, for its patent grant; that is a project-level
decision recorded there, and nothing in the desktop app depends on which of the two is chosen.

Obligations we therefore accept and must honour on every release:

1. Ship FFmpeg's licence text with the app.
2. Make the **exact** FFmpeg source (including any patches) available for the version shipped, for
   at least three years, at a URL stated in the notices.
3. Do not build with `--enable-nonfree`. A nonfree build (e.g. FDK-AAC linked into GPL FFmpeg) is
   **not redistributable at all**. The native `aac` encoder is what we use, and it is fine.
4. Keep the binary out of the asar so it is plainly a separate executable (`extraResources`).

### THIRD_PARTY_NOTICES.md — exact text to include

```
## FFmpeg

LIVETAP includes an unmodified binary build of FFmpeg, distributed as a separate executable in
`resources/ffmpeg/`. LIVETAP invokes it as a child process through its public command-line
interface; no FFmpeg code is linked into, compiled into, or otherwise combined with LIVETAP.

FFmpeg is free software. The build shipped with LIVETAP is configured with both `--enable-gpl`
and `--enable-version3`, so its effective licence is the GNU General Public License **version 3**
(GPL-3.0). `--enable-gpl` is required by libx264 and libx265; `--enable-version3` is pulled in by
version-3-only components in this build. The full licence text is included at
`resources/ffmpeg/COPYING.GPLv3` and is available at <https://www.gnu.org/licenses/gpl-3.0.html>.

If a future build drops the version-3-only components, the effective licence becomes
GPL-2.0-or-later and this paragraph must be updated to match `ffmpeg -version`'s `configuration:`
line. Do not state a licence you have not read off the binary you are shipping.

FFmpeg version shipped: 9.0.1 (configured with --enable-gpl --enable-version3 --enable-libx264
--enable-libx265, among others)
Build configuration: see `ffmpeg -version` output in `resources/ffmpeg/BUILD_INFO.txt`
Upstream project: <https://ffmpeg.org>

Written offer of source code: the complete corresponding source for the FFmpeg build shipped with
this version of LIVETAP, including any patches applied, is available for at least three years from
the date of this release at <https://github.com/REPLACE_WITH_GITHUB_OWNER/REPLACE_WITH_GITHUB_REPO/releases>
(asset `ffmpeg-source-<version>.tar.xz`), or on request to <legal@livetap.app>.

This build is NOT configured with --enable-nonfree and contains no non-redistributable components.

LIVETAP itself is licensed under the MIT Licence. See LICENSE.
```

### Resolution at runtime

`ffmpegPath.ts` resolves, in order: `LIVETAP_FFMPEG_PATH` (used by the verification harness) →
`process.resourcesPath/ffmpeg/<win|mac|linux>/ffmpeg(.exe)` → bare `ffmpeg` on PATH.

The PATH fallback is **development only**. In a packaged build main logs an error and
`capabilities()` reports `verification: 'UNAVAILABLE'` rather than claiming streaming works. A PATH
lookup in production would also mean anything earlier on the user's PATH gets executed as the media
engine. Confirmed on the first packaged launch, which correctly logged
`packaged build has no bundled FFmpeg; streaming will report UNAVAILABLE`.

---

## 6. Honest hardware-encoder detection

`ffmpeg -encoders` lists what was **compiled in**, which on a normal build includes nvenc, qsv and
amf whether or not the machine has the GPU or driver. Reporting that list as "hardware acceleration
available" is the most common lie in streaming software, and it fails at GO LIVE rather than at
startup.

So `hardware.ts` runs each candidate for one second against `testsrc2` into `-f null -` and only an
exit code of 0 counts. On this host:

| Encoder | Status | Reason reported by the driver |
|---|---|---|
| `h264_nvenc` | UNAVAILABLE | `Cannot load nvcuda.dll` |
| `h264_qsv` | UNAVAILABLE | `Error creating a MFX session: -9.` |
| `h264_amf` | UNAVAILABLE | `DLL amfrt64.dll failed to open` |
| `h264_videotoolbox` | NOT_COMPILED | not built on Windows |
| `libx264` | **PASS** | — |

`EngineCapabilities.hardwareEncoders` is therefore `[]` and `verification` is `PASS` only because
libx264 genuinely encoded. Asking for `preference: 'nvenc'` on this machine falls back to libx264
instead of failing at 20:00 on a Friday.

---

## 7. File map

| Path | What it is |
|---|---|
| `src/main/index.ts` | Electron main: window, session policy, deep links, single instance, wiring |
| `src/main/security/policy.ts` | CSP, permissions, navigation, request filtering — pure, unit-tested |
| `src/main/ipc.ts` | One guarded handler per channel; sender identity checked |
| `src/main/vault.ts` | `safeStorage`-backed secret store |
| `src/main/oauth.ts` | Loopback listener + `livetap://` deep-link handling |
| `src/main/recovery.ts` | 10-second crash-recovery snapshot, no secrets |
| `src/main/ffmpeg/argv.ts` | Every argv array, with refusal rules. No string concatenation anywhere |
| `src/main/ffmpeg/FfmpegEngine.ts` | The encoder + senders orchestrator |
| `src/main/ffmpeg/fanout.ts` | `TsFanout`: one stdout → N stdins, never pauses the source |
| `src/main/ffmpeg/progress.ts` | `-progress` parser + stderr → `ErrorCode` mapping |
| `src/main/ffmpeg/hardware.ts` | Real encoder probing |
| `src/main/ffmpeg/ffmpegPath.ts` | Bundled, then PATH in dev. A packaged build with an empty `resources/ffmpeg/` reports `unavailable` and never falls back to PATH |
| `src/main/ffmpeg/cpu.ts` | Best-effort per-pid CPU sampling |
| `src/preload/index.ts` | The entire renderer-reachable surface |
| `src/shared/ipc.ts` / `guards.ts` | Channel contract and its runtime guards |
| `packages/media/src/desktop/diagnostics.ts` | Codec probe `DesktopEngine.start()` runs before it builds a recorder. Moved out of `src/renderer/`, which nothing imported and tsup never bundled |
| `packages/media/src/desktop/DesktopEngine.ts` | The renderer half: capture, composite per aspect, MediaRecorder, `pushChunk` |
| `scripts/verify-engine.ts` | Headless encoder + sender harness (the evidence in `docs/qa/`) |
| `e2e/broadcast.mjs` | The whole product end to end: built app, real UI, real getUserMedia, two real RTMP publishers, ffprobe on what was recorded |

---

## 8. Known gaps

- **`setDisplayMediaRequestHandler` grants the first screen source.** The source picker belongs in
  the renderer (it lists sources and passes a chosen id); until the studio UI lands, this keeps
  screen share working end to end instead of failing. System audio is requested via the `loopback`
  constraint on Windows; macOS has no loopback without a kernel extension, so audio is omitted there
  rather than promised and silently missing.
- **No real camera or GPU on this host.** Capture paths are `UNVERIFIED`; the canvas-captureStream
  substitute is what was measured. The hardware-encoder *branches* in `rateControlArgs` are written
  from the FFmpeg option docs and are **untested on real hardware**.
- **Constrained Baseline profile** on the Option A′ path (§1). Acceptable everywhere, ~10–20 % less
  efficient than High. Option C is the fix.
- **MediaRecorder undershoots its bitrate target** (2.68 Mbps measured against 4500 kbps requested).
  Adaptive bitrate in `packages/core` should treat the requested value as a ceiling, not a promise.
- **No app icon** — electron-builder uses the default Electron icon.
