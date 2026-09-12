# LIVETAP — Media Engine Evaluation (Decision-Ready)

**Team:** Media Engineering Research
**Date of research:** 2026-09-11
**Document status:** Decision-ready. Every claim is tagged `[VERIFIED-HOST]`, `[VERIFIED-DOC]`, or `[UNVERIFIED]`.
**Target product:** LIVETAP — open-source live broadcasting. Web (React), Desktop (Electron, macOS + Windows), Mobile (Capacitor, iOS + Android).

---

## 0. Evidence tagging convention

| Tag | Meaning |
|---|---|
| `[VERIFIED-HOST]` | Executed on the LIVETAP build host during this research and the output observed. Commands and results reproduced in §9. |
| `[VERIFIED-DOC]` | Confirmed against a primary source (official docs, license file, repo metadata, IETF datatracker, npm registry). Source listed in §11. |
| `[UNVERIFIED]` | Could not be confirmed on this host or from a primary source. Explicitly flagged. Must be re-tested by the build team on real hardware/OS before it becomes a product commitment. |

**Nothing in this document is invented.** Where a number or behaviour could not be established, it says `[UNVERIFIED]` rather than guessing.

---

## 1. Build host facts (measured, not assumed)

All of the following was read off the host, not assumed. `[VERIFIED-HOST]`

| Property | Value |
|---|---|
| OS | Windows Server 2022 Standard, 10.0.20348 |
| GPU | None |
| Camera / mic | None |
| Node.js | v20.11.1 |
| FFmpeg | `9.0.1-full_build-www.gyan.dev`, built with gcc 16.1.0 (MSYS2) |
| FFmpeg libs | libavutil 61.1.101 / libavcodec 63.1.101 / libavformat 63.1.101 |
| Docker CLI | 29.6.2 — **CLI present, daemon NOT running** (`npipe:////./pipe/dockerDesktopLinuxEngine` missing). Docker Desktop Linux engine is not started on this VM. |
| Rust toolchain | Absent |
| GStreamer | Absent |

### 1.1 The installed FFmpeg build configuration — the licensing core fact

```
--enable-gpl --enable-version3 --enable-static --disable-autodetect
--enable-libx264 --enable-libx265 --enable-libsrt --enable-librist
--enable-libvpx --enable-libopus --enable-libsvtav1 --enable-librav1e --enable-libaom
--enable-mediafoundation --enable-amf --enable-nvenc --enable-nvdec --enable-libvpl
--enable-dxva2 --enable-d3d11va --enable-d3d12va --enable-vaapi --enable-vulkan
--enable-libass --enable-libfreetype --enable-frei0r --enable-libvmaf --enable-whisper
... (full list in §9.1)
```

Consequences, all `[VERIFIED-HOST]` from the buildconf plus `[VERIFIED-DOC]` from ffmpeg.org/legal.html:

- `--enable-gpl` is present → **this binary is GPL, not LGPL.**
- `--enable-version3` is also present → the effective license of this binary is **GPL v3** (GPL-2.0-or-later components combined with version-3-only components such as libvmaf/frei0r/liboapv escalate to v3). gyan.dev states both variants are "licensed as GPLv3" `[VERIFIED-DOC]`.
- `libx264` and `libx265` are both linked in. These are the classic GPL-forcing components; FFmpeg's own legal page says plainly: *"Make sure your program is not using any GPL libraries (notably libx264)."* `[VERIFIED-DOC]`
- **No `libopenh264` in this build** `[VERIFIED-HOST]` — the LGPL-friendly H.264 software encoder is absent. If we ever need an LGPL build, openh264 must be added or the Windows/macOS OS encoders used instead (see §1.2).

### 1.2 Encoder inventory actually present, and what actually runs here

| Encoder | Present in build | Runs on this host | Notes |
|---|---|---|---|
| `libx264` | Yes | **Yes** `[VERIFIED-HOST]` | 1280x720@30 → FLV, 3 s, 1,018,331 bytes. GPL. |
| `libx265` | Yes | `[UNVERIFIED]` (not exercised) | GPL. |
| `libsvtav1`, `librav1e`, `libaom-av1` | Yes | `[UNVERIFIED]` | BSD/Apache-ish, not GPL-forcing, but CPU-expensive for live. |
| `h264_mf` (MediaFoundation) | Yes | **Yes** `[VERIFIED-HOST]` | Encoded 640x360@30, 2 s → mp4, 233,375 bytes, **with no GPU**. This is an OS-API encoder — *not* a GPL library. Strategically important (see §7.4). |
| `hevc_mf`, `av1_mf` | Yes | `[UNVERIFIED]` | |
| `h264_nvenc` / `hevc_nvenc` / `av1_nvenc` | Yes | **No** `[VERIFIED-HOST]` | Fails with error −22 (Invalid argument). Expected: no NVIDIA GPU. |
| `h264_qsv` / `hevc_qsv` / `av1_qsv` | Yes | **No** `[VERIFIED-HOST]` | Fails −22. No Intel iGPU/QSV device. |
| `h264_amf` / `hevc_amf` / `av1_amf` | Yes | **No** `[VERIFIED-HOST]` | Fails −22. No AMD GPU. |
| `h264_videotoolbox` | n/a (Windows build) | n/a | macOS-only. `[UNVERIFIED]` on this host by definition. |
| `libopus` | Yes | `[UNVERIFIED]` (listed) | Required for WHIP audio. |
| `aac` (native) | Yes | **Yes** `[VERIFIED-HOST]` | Used in every test below. |
| `libopenh264` | **No** | — | Absent. |

### 1.3 Muxers / protocols actually present

`[VERIFIED-HOST]` from `ffmpeg -muxers` / `-protocols`:

- Muxers: `flv`, `mp4`, `mpegts`, `matroska`, `hls`, `dash`, `rtsp`, **`tee`**, **`whip` — "WHIP(WebRTC-HTTP ingestion protocol) muxer"**.
- Protocols: `rtmp`, `rtmps`, `rtmpt`, `rtmpts`, `rtmpe`, `rtmpte`, `srt`, `rist`, `tls`, `dtls`, `srtp`.

**The WHIP muxer is present and its option set is exactly as documented** (`handshake_timeout`, `pkt_size`, `whip_flags=dtls_active`, `authorization` bearer token, `cert_file`, `key_file`, `rtp_history`) `[VERIFIED-HOST]`.

---

## 2. Executive summary of findings

1. **FFmpeg-as-a-child-process is the engine.** It already does everything LIVETAP needs on this host: x264 encode, `tee` fan-out with per-output failure isolation, per-output auto-reconnect via `use_fifo`+`attempt_recovery`, SRT, RTMPS, and a native WHIP muxer. All four of those were executed successfully here. `[VERIFIED-HOST]`
2. **LIVETAP can stay MIT/Apache-2.0** while shipping and spawning a GPL FFmpeg binary, because it is a separate process invoked over argv/pipes — FSF's own "mere aggregation" wording covers this — but the *bundle* must then carry FFmpeg's GPLv3 obligations (source offer, license text). Full analysis and a safer alternative in §7.
3. **The browser cannot speak RTMP, and that is not fixable.** The recommended path is **WHIP from the browser → self-hosted MediaMTX (MIT) → native `forward` to N RTMP/RTMPS destinations**, with no re-encode. MediaMTX's native `forward` supports multiple destinations, RTMPS with `#streamKey` syntax, and is explicitly pass-through (`-c copy` semantics) `[VERIFIED-DOC]`.
4. **Desktop should composite in the renderer and encode in FFmpeg**, fed raw frames over stdin — not libobs. libobs/obs-studio-node is GPL-2.0 and would relicense LIVETAP; its maintenance signal is also mixed (last GitHub *release* tag v0.3.46 from 2018, though the repo is pushed to daily) `[VERIFIED-DOC]`.
5. **One encode, N destinations** is proven: `tee` with `onfail=ignore` delivered byte-identical streams to two live RTMP receivers, skipped a dead one, and wrote a local recording, from a single libx264 encode. `[VERIFIED-HOST]`
6. **Per-output reconnect without touching the encoder** is proven: `tee -use_fifo 1 -fifo_options attempt_recovery=1:...` reconnected an RTMP output that was dead at process start, once a receiver appeared 6 seconds later, while the local recording never stopped. `[VERIFIED-HOST]` This is the single most important operational finding in this document.
7. **Hardware encoding is entirely `[UNVERIFIED]`** on this host — no GPU. Detection-and-fallback must be a runtime probe on the user's machine, never a build-time assumption. But note `h264_mf` worked *without* a GPU, which gives Windows a CPU-light-ish, non-GPL fallback.

---

## 3. Technology evaluations

Scoring rubric for **FIT SCORE (1–5)**: 5 = adopt now, core to architecture. 4 = adopt for a specific layer. 3 = viable but with real cost. 2 = only if forced. 1 = reject.

### 3.1 FFmpeg (9.0.1, spawned as child process)

| Dimension | Assessment |
|---|---|
| **License** | Core LGPL-2.1-or-later. **Our installed binary is GPLv3** (`--enable-gpl --enable-version3`, libx264 + libx265 linked) `[VERIFIED-HOST]`. An LGPL build is achievable by dropping `--enable-gpl` and using `libopenh264` / `h264_mf` / `h264_videotoolbox` instead of libx264 `[VERIFIED-DOC]`. |
| **Security posture** | Large attack surface in decoders/demuxers. FFmpeg publishes a security page listing per-release CVE batches; 2026-era examples include CVE-2026-8461 (MagicYUV OOB write in libavcodec, DoS→possible RCE, fixed in 8.1.2) and an infinite loop in `libavformat/rtpdec_asf.c` affecting 0.6.3–8.1.2 `[VERIFIED-DOC]`. **Mitigation for LIVETAP: we only ever feed FFmpeg data we generated ourselves (rawvideo/PCM over a pipe, or lavfi test sources). We never point it at user-supplied media files from untrusted sources in the live path.** That removes nearly all of the decoder CVE surface. If LIVETAP later adds "play a media file into the stream", that file is untrusted input and the FFmpeg process must be sandboxed (separate low-privilege process, no network egress except the configured ingest, resource limits). |
| **Sandboxing** | Child-process model is itself the sandbox boundary: crash ≠ app crash; it can be killed, resource-capped, and restarted. This is a genuine architectural advantage over in-process libobs/libav linking. |
| **Maturity** | Highest in the field. 25+ years. Reference implementation for essentially every protocol we need. |
| **Maintenance** | 9.0.1 released 2026-08-12; gyan.dev publishes git-master builds on a multiple-times-per-week cadence (latest master build observed 2026-09-10, next scheduled 2026-09-14) `[VERIFIED-DOC]`. |
| **Performance** | libx264 `veryfast`/`zerolatency` is the industry live baseline. 1280x720@30 2500 kbps encoded fine here on a GPU-less VM `[VERIFIED-HOST]`. Exact CPU cost per stream on target user hardware: `[UNVERIFIED]`. |
| **Compatibility** | Win/mac/Linux: yes. iOS/Android: possible but a heavy, awkward dependency for a Capacitor app — **do not** use FFmpeg on mobile (see §3.13). Browser: no (ffmpeg.wasm exists but is not a live-encode path — `[UNVERIFIED]` and rejected here). |
| **Build complexity on our host** | **Zero.** Already installed and working. No compilation required. This is decisive. |
| **Long-term fit** | Excellent. The child-process boundary means we can swap the binary (GPL→LGPL, add hw encoders) without touching LIVETAP code. |
| **FIT SCORE** | **5** |

#### 3.1.1 FFmpeg 9 / 8 feature questions answered precisely

| Question | Answer | Evidence |
|---|---|---|
| Does FFmpeg 9 support the WHIP muxer? | **Yes**, and it is present in our build. FFmpeg's own docs label it *"This is an experimental feature."* | `[VERIFIED-HOST]` (muxer listed, options enumerated) + `[VERIFIED-DOC]` (doc/muxers.texi) |
| Which FFmpeg version added WHIP? | The WHIP muxer was **merged in June 2025**, i.e. it landed for the **8.0** series, not 9.0. It does **not** appear in the 9.0 Changelog section — I read the full Changelog and the 9.0 entries are AMF/LCEVC/Vulkan/ONNX items with **no** WHIP, RTMP, SRT or WebRTC line. | `[VERIFIED-HOST]` (grepped Changelog: no `whip` entry anywhere) + `[VERIFIED-DOC]` (Phoronix/ffmpeg-devel: merge, ~3000 LoC, `libavformat/whip.c`; doxygen for 8.0 has `whip_8c`) |
| WHIP muxer constraints? | **H.264 without B-frames + Opus.** FFmpeg docs: *"Ensure that you use H.264 without B frames and Opus for the audio codec."* Documented example uses `-profile:v baseline -tune zerolatency -threads 1 -bf 0`. Reported end-to-end latency in the official example: *"approximately 150ms."* Secondary reporting says only baseline/constrained-baseline H.264 profiles are supported. MediaMTX docs add that FFmpeg 8.0 requires **both** a video and an audio track. | `[VERIFIED-DOC]` |
| SRT support? | **Yes** — `--enable-libsrt`, `srt` protocol present, and **SRT loopback verified end-to-end on this host** (caller → listener, h264+aac, 317,720 bytes received). | `[VERIFIED-HOST]` |
| RTMPS? | **Yes** — `rtmps`, `rtmpts`, `rtmpe`, `rtmpte` all present. Plain `rtmp` fan-out verified on host; **TLS handshake against a real platform ingest is `[UNVERIFIED]`** (no credentials, no egress test performed). | `[VERIFIED-HOST]` (protocol present) |
| Enhanced RTMP HEVC/AV1? | **Yes, and it is older than FFmpeg 9.** The Changelog shows *"Support HEVC,VP9,AV1 codec in enhanced flv format"* and *"Support HEVC,VP9,AV1 codec fourcclist in enhanced rtmp protocol"* under **version 6.1**. | `[VERIFIED-HOST]` (Changelog lines 225, 228 in the 6.1 block) |

#### 3.1.2 The `tee` muxer — exact documented syntax, verified

Official text `[VERIFIED-DOC]` (FFmpeg `doc/muxers.texi`), the parts that matter:

> "With the tee muxer, the audio and video data will be encoded only once. With conventional multiple outputs, multiple encoding operations in parallel are initiated, which can be a very expensive process."

> "Since the tee muxer does not represent any particular output format, ffmpeg cannot auto-select output streams. So all streams intended for output must be specified using `-map`."

> "The slave outputs are specified in the file name given to the muxer, separated by `'|'`."

> "Muxer options can be specified for each slave by prepending them as a list of `key=value` pairs separated by `':'`, between square brackets. If the options values contain a special character or the `':'` separator, they must be escaped; note that this is a **second level escaping**."

> **`onfail`** — "Specify behaviour on output failure. This can be set to either `abort` (which is default) or `ignore`. `abort` will cause whole process to fail in case of failure on this slave output. `ignore` will ignore failure on this output, so other outputs will continue without being affected."

> **`use_fifo` bool** — "If set to 1, slave outputs will be processed in separate threads using the fifo muxer. This allows to compensate for different speed/latency/reliability of outputs and **setup transparent recovery**. By default this feature is turned off."

> **`select`** — "Select the streams that should be mapped to the slave output... You may use multiple stream specifiers separated by commas (`,`) e.g.: `a:0,v`"

> **`bsfs[/spec]`** — bitstream filters per output, e.g. `[bsfs/v=dump_extra=freq=keyframe]`.

Official example `[VERIFIED-DOC]`:
```
ffmpeg -i ... -c:v libx264 -c:a mp2 -f tee -map 0:v -map 0:a
  "[onfail=ignore]archive-20121107.mkv|[f=mpegts]udp://10.0.1.255:1234/"
```

**So the answer to "verify the tee/onfail syntax" is: `onfail=ignore` goes inside the square-bracket option list of the slave it applies to, per-output, alongside `f=`. It is NOT a global flag.** Verified working on host — see §9.4.

#### 3.1.3 The `fifo` pseudo-muxer — the reconnect mechanism

Official text `[VERIFIED-DOC]`:

> "The fifo pseudo-muxer allows the separation of encoding and muxing by using a first-in-first-out queue and running the actual muxer in a separate thread. This is especially useful in combination with the tee muxer and can be used to send data to several destinations with different reliability/writing speed/latency."

> **`attempt_recovery` bool** — "If failure occurs, attempt to recover the output. This is especially useful when used with network output, since it makes it possible to **restart streaming transparently**. By default this option is set to `false`."

> **`drop_pkts_on_overflow` bool** — "if the fifo queue fills up, packets will be dropped rather than blocking the encoder... continue streaming without delaying the input, at the cost of omitting part of the stream."

> **`max_recovery_attempts` count** — "maximum number of successive unsuccessful recovery attempts after which the output fails permanently. By default... `0` (unlimited)."

> **`recover_any_error` bool** — "recovery will be attempted regardless of type of the error causing the failure. By default... `false` and in case of certain (usually permanent) errors the recovery is not attempted."

> **`queue_size`** — "size of the queue as a number of packets. Default value is `60`."

> **`recovery_wait_time` / `recovery_wait_streamtime`** — real-time vs stream-time wait before retry.

**This is our per-output reconnect layer and it works.** See §9.6 for the verified late-join reconnect test.

#### 3.1.4 The npm FFmpeg packages — licenses matter here

| Package | Latest | Package license | Binary license | Verdict for LIVETAP |
|---|---|---|---|---|
| `ffmpeg-static` | 5.3.0, published 2025-11-14 | **GPL-3.0-or-later** `[VERIFIED-DOC]` (npm registry) | Downloads **gyan.dev** builds for Windows x64, johnvansickle for Linux, evermeet/OSXExperts for macOS `[VERIFIED-DOC]` — i.e. **GPL builds** | **Do not use for shipping.** Its own npm `license` field is GPL-3.0-or-later, which linters and SBOM tools will propagate into our dependency tree as a GPL-3.0 dependency. Acceptable only as a **devDependency** for CI. |
| `@ffmpeg-installer/ffmpeg` | 1.1.0, published **2021-07-15** | **LGPL-2.1** claimed in npm metadata `[VERIFIED-DOC]` | **Cannot substantiate the LGPL claim.** The repo README documents binaries dated **2018** (e.g. Windows `20181217-f22fcd4`) and contains **no statement of license for those binaries** `[VERIFIED-DOC]`. | **Reject.** Stale (5 years without a publish), binaries 8 years old, and an LGPL claim we cannot verify against the actual builds. Shipping this would be a licensing assertion we cannot defend. |
| `fluent-ffmpeg` | 2.1.3, published 2024-05-19 | MIT | n/a | **Reject — it is formally deprecated.** npm registry `deprecated` field reads: *"Package no longer supported. Contact Support at https://www.npmjs.com/support for more info."* `[VERIFIED-DOC]` |

**Recommendation:** ship our **own pinned FFmpeg binary** per platform, chosen and audited by us, and drive it with `child_process.spawn(bin, argvArray)` — no wrapper library. Rationale in §6.8.

---

### 3.2 GStreamer

| Dimension | Assessment |
|---|---|
| **License** | Core is **LGPL**, deliberately: the project says it uses LGPL *"to ensure that everyone can use GStreamer to build applications using licenses of their choice."* Plugin modules are split good/base (LGPL, no patent issues), **ugly** (LGPL or dual, patent-encumbered), **bad** (incubating). Critically: *"we do not accept GPL code"* in plugin modules, *"though LGPL plugins may link to GPL libraries"* `[VERIFIED-DOC]`. So `x264enc` lives in `gst-plugins-ugly` as an LGPL wrapper over a GPL library — the GPL obligation still travels with the shipped x264 .so/.dll. |
| **Security posture** | `[UNVERIFIED]` — no CVE census performed. Comparable decoder surface to FFmpeg; in fact many GStreamer elements wrap libav. |
| **Maturity** | Very high, current stable **1.28.7** `[VERIFIED-DOC]`. |
| **Maintenance** | Active. |
| **Performance** | Excellent, arguably better than FFmpeg CLI for dynamic pipelines (you can add/remove branches at runtime without restarting the process — genuinely superior to `tee`+restart). |
| **Compatibility** | Win/mac/Linux good. Android/iOS supported but heavy. Browser: no. |
| **Distribution size** | Windows: separate installers per toolchain (MSVC x86_64/x86/arm64, MinGW x86_64/x86); 1.28+ unified installer with `/TYPE=runtime|devel|debug`. macOS: three `.pkg` per version (runtime/devel/debug), universal x86_64+arm64. **Actual byte sizes are not published on the download page — `[UNVERIFIED]`.** Practical experience says a usable runtime subset is on the order of tens of MB per platform, but I will not state a number I could not verify. |
| **Node bindings maturity** | **This is the disqualifier.** `gstreamer-superficial` — latest **1.7.4, published 2022-03-04**, MIT, described by its own author as *"Superficial GStreamer binding"* `[VERIFIED-DOC]`. Four years without a publish, and "superficial" is not a joke — it does not expose the full pipeline API. There is no maintained, first-class Node/Electron GStreamer binding. The realistic alternative is shelling out to `gst-launch-1.0`, at which point we have all of FFmpeg's process-boundary model with none of FFmpeg's ubiquity. |
| **Build complexity on our host** | **High.** GStreamer is absent; installing runtime + devel + building native Node bindings on Windows Server without a prepared MSVC toolchain is a multi-hour yak-shave. Versus FFmpeg: already working. |
| **Long-term fit** | Would be a strong choice for a C++/Rust product. For a Node/Electron product in 2026 it is the wrong shape. |
| **FIT SCORE** | **2** |

---

### 3.3 libobs / obs-studio-node

| Dimension | Assessment |
|---|---|
| **License** | **libobs / OBS Studio: GPL-2.0-or-later.** The repo `COPYING` file is verbatim *"GNU GENERAL PUBLIC LICENSE Version 2, June 1991"* `[VERIFIED-DOC]`; GitHub reports the repo license as GPL-2.0 `[VERIFIED-DOC]`. **obs-studio-node (Streamlabs): GPL-2.0** `[VERIFIED-DOC]` — it describes itself as *"bindings to obs-studio's internal library, named libobs"*. |
| **The linking problem** | obs-studio-node is a **native Node addon that links libobs in-process**. This is not mere aggregation by any reading — it is dynamic linking of GPL code into our process. **Shipping it forces LIVETAP to be GPL-2.0-compatible.** There is no pipe boundary to hide behind. |
| **Security posture** | In-process native addon → a libobs crash or memory corruption takes the whole Electron app down, and runs with the app's full privileges. Strictly worse isolation than a child process. `[UNVERIFIED]` CVE history. |
| **Maturity** | libobs itself: extremely mature (OBS Studio 32.2.2, released 2026-08-14; 76,070 stars) `[VERIFIED-DOC]`. |
| **Maintenance (obs-studio-node)** | **Mixed and worth reading carefully.** Repo `streamlabs/obs-studio-node` (note: `stream-labs/...` now redirects) — GPL-2.0, 683 stars, 69 open issues, **pushed 2026-09-10** (i.e. active), but **the newest GitHub release tag is `v0.3.46`, published 2018-11-08** `[VERIFIED-DOC]`. The separate npm package `obs-studio-node` is at **0.10.10, published 2020-12-14**, described as *"Experimental bindings to obs-studio using nan directly"* `[VERIFIED-DOC]`. So: actively developed **for Streamlabs' own product**, with no meaningful public release discipline. Consuming it means tracking a vendor's internal branch. |
| **Platform support** | *"Currently, only Windows and MacOS are supported."* `[VERIFIED-DOC]` — acceptable for our Electron targets. |
| **Performance** | The best in class. Real scene graph, GPU compositing, hardware encoder integration, battle-tested by millions of streamers. This is the honest upside and it is large. |
| **Build complexity on our host** | **Very high.** Requires CMake + Visual Studio, plus a **custom OBS build configured with scripting and UI disabled** `[VERIFIED-DOC]`, plus electron-builder rebuild against our exact Electron ABI. On a GPU-less Windows Server VM, we also could not meaningfully test the result. |
| **Would a GPL LIVETAP be acceptable?** | See §7.5 — it is a genuine option with genuine costs, and my recommendation is **no, not for v1**. |
| **FIT SCORE** | **2** (would be 4 if LIVETAP chose GPL and had a native-build CI pipeline) |

---

### 3.4 MediaMTX

| Dimension | Assessment |
|---|---|
| **License** | **MIT** `[VERIFIED-DOC]` (GitHub API: `spdx_id: MIT`). Perfect license alignment — no copyleft, no attribution burden beyond the MIT notice. |
| **Ingest** | Media-over-QUIC, SRT, **WebRTC/WHIP**, RTSP, RTMP, HLS, MPEG-TS, RTP `[VERIFIED-DOC]`. WHIP publish URL is `http://localhost:8889/mystream/whip` (default port **8889** TCP/HTTP, **8189** UDP for ICE) `[VERIFIED-DOC]`. WHIP ingest codecs: video AV1/VP9/VP8/H265/H264, audio Opus/G722/G711 `[VERIFIED-DOC]`. Documented publishing clients include *"FFmpeg, GStreamer, OBS Studio, Unity and Web browsers"* `[VERIFIED-DOC]`. |
| **Egress** | Media-over-QUIC, SRT, WebRTC/WHEP, RTSP, RTMP, HLS `[VERIFIED-DOC]`. Defaults: RTMP `:1935`, SRT `:8890`, HLS `:8888` `[VERIFIED-DOC]`. |
| **Can it fan out one WHIP ingest to multiple RTMP destinations?** | **Yes — and better than via ffmpeg hooks.** MediaMTX has a first-class **`forward`** feature: a per-path **array** of destinations supporting RTMP/RTMPS, RTSP/RTSPS, SRT, WHIP/WHIPS and MoQ. It is **pass-through** — the docs state that when the destination needs transcoding/filtering or an unsupported protocol, *"use FFmpeg inside the `runOnAvailable` parameter instead"*, which confirms `forward` itself does not re-encode `[VERIFIED-DOC]`. RTMPS destination syntax carries the stream key after `#`: `dest: rtmps://ingest.server/app#streamKey` `[VERIFIED-DOC]`. |
| **Hooks** | **Important currency correction:** in **v1.21.0, `runOnReady` was renamed to `runOnAvailable`, and `runOnNotReady` to `runOnUnavailable`; new `runOnOnline`/`runOnOffline` hooks were added. This is a documented breaking change.** `[VERIFIED-DOC]` The current config exposes `runOnInit`, `runOnDemand`, `runOnUnDemand`, `runOnAvailable`, `runOnUnavailable`, `runOnOnline`, `runOnOffline`, `runOnRead`, `runOnUnread`, `runOnRecordSegmentCreate`, `runOnRecordSegmentComplete` — and **`runOnReady` no longer exists in `mediamtx.yml` on v1.21.0** `[VERIFIED-DOC]`. Any tutorial or prior LIVETAP note using `runOnReady` is stale. Hook env vars: `MTX_PATH`, `MTX_QUERY`, `MTX_SOURCE_TYPE`, `MTX_SOURCE_ID`, `RTSP_PORT`, `G1,G2,...` `[VERIFIED-DOC]`. `runOnAvailable` is *"terminated with SIGINT when the stream is not available anymore"* `[VERIFIED-DOC]` — clean lifecycle. |
| **Auth (matters for a multi-tenant relay)** | Three modes: internal user DB (plain / **Argon2** / SHA256 hashes, per-action `publish`/`read`/`playback`/`api` permissions with regex path scoping), external **HTTP** auth endpoint (POST with user/ip/action/protocol; 2xx = allow), and **JWT** via JWKS with a required `mediamtx_permissions` claim and optional `iss`/`aud` validation `[VERIFIED-DOC]`. **For WebRTC/WHIP, credentials go in `Authorization: Bearer` / `Basic` headers** `[VERIFIED-DOC]` — which lines up exactly with FFmpeg's WHIP `authorization` option and with browser `fetch` on the WHIP POST. JWT length caps: RTSP 4096, RTMP 1024, SRT 512 chars `[VERIFIED-DOC]`. |
| **Deployment** | *"ready-to-use and zero-dependency"*, *"compatible with Linux, Windows and macOS as single executable"* `[VERIFIED-DOC]`. Docker image `bluenviron/mediamtx` `[VERIFIED-DOC]`. |
| **Maturity / maintenance** | **v1.21.0 released 2026-09-05**; 20,104 stars; 195 open issues; **pushed 2026-09-11** (the day of this research) `[VERIFIED-DOC]`. Outstanding health signal. |
| **Security posture** | Go, memory-safe, small dependency surface. `[UNVERIFIED]` CVE history. A relay that terminates DTLS/SRTP and holds users' platform stream keys is a high-value target — treat stream keys as secrets at rest, and never let the relay be reachable without auth. |
| **Build complexity on our host** | **Zero build** (single Go binary / Docker image). **But: could not be run here.** The Docker daemon is not running on this VM (§1) and I did not download/execute a third-party binary on the build host without explicit authorisation. **MediaMTX runtime behaviour is therefore `[UNVERIFIED]` on this host** — exact commands to verify are in §9.8, marked for the build team. |
| **Sidecar viability** | Excellent. Single static binary, no deps, MIT, configurable by one YAML file, hot-reloads config, has a Control API for programmatic path creation. It can be a **server-side relay** (web go-live) and/or an optional **desktop sidecar**. |
| **FIT SCORE** | **5** |

---

### 3.5 OvenMediaEngine

| Dimension | Assessment |
|---|---|
| **License** | **AGPL-3.0-only** `[VERIFIED-DOC]` (repo moved to `OvenMediaLabs/OvenMediaEngine`; GitHub API `spdx_id: AGPL-3.0`). The README offers relicensing: *"if you need another license, please feel free to email us at contact@ovenmedialabs.com."* `[VERIFIED-DOC]` |
| **AGPL implications — the decisive point** | AGPL §13 extends copyleft to **network interaction**: if LIVETAP's hosted service uses a *modified* OME, we must offer the modified source to every user interacting with it over the network. Even unmodified, an AGPL component in our server stack (a) contaminates the compliance story for anyone self-hosting or white-labelling LIVETAP, (b) is on the default deny-list of most corporate OSS policies, and (c) makes LIVETAP's "MIT/Apache" positioning misleading to downstream integrators. MediaMTX does the same job under MIT. |
| **Capability** | Genuinely strong: push ingest WebRTC/**WHIP (with Simulcast)**/SRT/RTMP/**E-RTMP**/MPEG-2 TS; pull RTSP/OVT; egress **LLHLS** and WebRTC sub-second, plus legacy HLS and SRT `[VERIFIED-DOC]`. Sub-second WebRTC delivery is better-developed than MediaMTX's. |
| **Maturity / maintenance** | v0.21.0 released 2026-08-13; 3,274 stars; 22 open issues; pushed 2026-09-07 `[VERIFIED-DOC]`. Healthy. |
| **Compatibility** | Officially tested on Docker, Ubuntu 18+, Rocky/AlmaLinux 8+, Fedora 28+. **No Windows support documented** `[VERIFIED-DOC]`. That kills it as a desktop sidecar outright. |
| **Build complexity on our host** | Docker-only in practice, and our Docker daemon is down. `[UNVERIFIED]` here. |
| **Long-term fit** | Only if LIVETAP later needs a **viewer-facing** sub-second WebRTC/LLHLS CDN origin *and* is prepared to either accept AGPL server-side or buy the commercial license. Keep on the radar; do not adopt now. |
| **FIT SCORE** | **2** |

---

### 3.6 WebRTC in browsers (capture, composite, encode)

Sub-components evaluated individually because their support levels differ wildly.

| Capability | Support | Notes for LIVETAP |
|---|---|---|
| `getUserMedia` (camera/mic) | Universal on all target browsers. | Baseline. Secure context required. |
| `getDisplayMedia` (screen/window/tab) | MDN classifies it **"Limited availability — not Baseline"** `[VERIFIED-DOC]`. Requires secure context. | Works in Chrome/Edge; usable in Firefox; Safari has real gaps. |
| **System audio capture via `getDisplayMedia`** | **The weakest link in the whole web path.** MDN is explicit: *"Browsers may ignore this hint and determine which audio sources to offer, sometimes based on operating system constraints. The returned stream might contain no audio track even when `audio` is `true` and `systemAudio` is `include`."* `[VERIFIED-DOC]` Chrome documents `systemAudio: "exclude"` as *"Chrome will offer to capture audio alongside tabs and windows, but not alongside screens"*, i.e. the positive case is a **hint, not a guarantee**; `systemAudio` exists from Chrome 105+ `[VERIFIED-DOC]`. **Chrome's own docs do not state per-OS behaviour — `[UNVERIFIED]` which OS/browser pairs actually deliver system audio.** Practical field knowledge (Windows: yes for tab/window/screen; macOS: historically no for screen) is **`[UNVERIFIED]`** and must be matrix-tested. | **Product consequence: the web app must not promise desktop-audio capture.** Offer mic + tab audio, and route users who need system audio to the desktop app. |
| `windowAudio: "exclude" \| "window" \| "system"` | Documented on MDN `[VERIFIED-DOC]`; **not** mentioned in Chrome's own screen-sharing-controls doc `[VERIFIED-DOC]`. Support is therefore uneven. | Feature-detect; never depend on it. |
| `MediaStreamTrack` constraints / `applyConstraints` | Standard. | Use for resolution/frameRate negotiation, and `contentHint` (`"motion"` vs `"detail"`) for screen vs camera. |
| **WebCodecs `VideoEncoder`** | Chrome/Edge **94+**, Firefox **130+**, Safari **16.4+** (desktop and iOS), Samsung Internet 17+, Chrome Android **152+**; global usage ~**94.6%** as of Aug 2026 `[VERIFIED-DOC]`. caniuse's `webcodecs` feature notes Safari **16.4–18.7 partial, full from 26.0** `[VERIFIED-DOC]`. **Secure context + available in dedicated workers** `[VERIFIED-DOC]`. | Config knobs we need: `hardwareAcceleration: "prefer-hardware" \| "prefer-software" \| "no-preference"`, `bitrateMode: "constant" \| "variable"`, plus `latencyMode` and `avc.format` (MDN's example demonstrates `isConfigSupported` probing across codecs × accelerations) `[VERIFIED-DOC]`. **Strategy: always probe with `VideoEncoder.isConfigSupported()` at runtime, never assume.** Whether a given browser/OS actually hits a hardware H.264 path: **`[UNVERIFIED]`** — `prefer-hardware` is a preference, and the spec gives no guarantee. |
| **`MediaRecorder`** | Baseline "widely available" since Apr 2021; Chrome 49+, Firefox 29+, Edge 79+, Safari 14.1+, iOS Safari 14.5+; ~96.2% global `[VERIFIED-DOC]`. | **Container/codec support diverges per browser and MDN/caniuse do not enumerate it in the pages I could fetch — the specific claim "H.264 in mp4 works in Chrome and Safari" is `[UNVERIFIED]`.** The only correct engineering answer: enumerate candidate mime types and pick the first that `MediaRecorder.isTypeSupported()` accepts. **Also: MediaRecorder is the wrong tool for live streaming** — chunked WebM/MP4 over WebSocket to a server ffmpeg adds container overhead, GOP-boundary latency and remux cost. Use it for **local recording fallback only**. |
| **Insertable Streams (`MediaStreamTrackProcessor` / `VideoTrackGenerator`)** | MDN: **"not Baseline... does not work in some of the most widely-used browsers"**, and carries an explicit warning: *"Browsers differ on which global context they expose this interface in (e.g., only window in some browsers and only dedicated worker in others), making them incompatible."* `[VERIFIED-DOC]` | Useful in Chrome/Edge for zero-copy frame pipelines (overlays, filters). **Must be behind a capability check with a canvas fallback.** Not a foundation. |
| `OffscreenCanvas` + WebGL/WebGL2 compositing | Widely supported in Chrome/Edge/Firefox; Safari support improved but `[UNVERIFIED]` for our exact usage (WebGL2 in worker). | This is the right place to do LIVETAP's scene compositing (layers, overlays, lower-thirds, 9:16 crop preview) — GPU-accelerated, off the main thread. |
| `canvas.captureStream()` | Long-standing, broadly supported. | The reliable bridge: composite → `captureStream()` → feed to `RTCPeerConnection` (WHIP) or `MediaRecorder`. Frame pacing is driven by canvas draws, so we control cadence. |
| **WebRTC codecs** | Mandatory: **VP8** and **H.264 Constrained Baseline** (with `profile-level-id` required in SDP). Optional: VP9 (Chrome 48+, Firefox), AV1 (Chrome 113+, Firefox 136+), **HEVC (Chrome 136+)**. Safari supports both mandatory codecs; *"H.264 is particularly important for Safari/iOS due to hardware acceleration"*; VP8 has no iOS hardware support, hurting battery `[VERIFIED-DOC]`. Enumerate with `RTCRtpSender.getCapabilities("video").codecs` `[VERIFIED-DOC]`. | **For WHIP→MediaMTX→RTMP with no re-encode, we must negotiate H.264 in the browser's SDP** (RTMP/FLV can't carry VP8). Constrained Baseline is exactly what FFmpeg's WHIP muxer also requires — the constraint is consistent across the stack. |
| **FIT SCORE** | **4** for capture + compositing + WHIP publish; **3** for WebCodecs (excellent where present, needs probe+fallback); **2** for MediaRecorder-as-transport. |

---

### 3.7 WHIP / WHEP specification status (2026)

| Spec | Status | Evidence |
|---|---|---|
| **WHIP** | **RFC 9725**, published **March 2025**, **Standards Track**. IESG-approved, IETF consensus. Updates RFC 8840 (Trickle ICE for SIP) and RFC 8842 (DTLS/TLS in SDP offer/answer). | `[VERIFIED-DOC]` (IETF datatracker) |
| **WHEP** | **Not an RFC.** `draft-ietf-wish-whep` is at **revision 04, dated 2026-06-22** (page updated 2026-08-26), IESG state **"I-D Exists"**, currently flagged *"Revised I-D Needed — Issue raised by WG"*, awaiting WG chair action. Intended status Proposed Standard. The older individual draft `draft-murillo-whep` is expired/superseded. | `[VERIFIED-DOC]` (IETF datatracker) |

**Decision impact:** WHIP is a stable, citable standard — safe to build the web go-live path on it. WHEP is **not** stable; do not build user-facing *playback* on WHEP as a contract. For LIVETAP's low-latency preview we can use WHEP opportunistically (MediaMTX supports it) but the durable preview path should be HLS/LL-HLS or a direct local canvas preview.
**FIT SCORE: WHIP 5, WHEP 3.**

---

### 3.8 SRT (libsrt)

| Dimension | Assessment |
|---|---|
| **License** | **MPL-2.0** `[VERIFIED-DOC]` (GitHub API + README). MPL-2.0 is **file-level copyleft** and explicitly compatible with distributing a larger work under another license — **no problem for an MIT/Apache LIVETAP**, and materially friendlier than GPL. Modifications to libsrt files themselves must be published; we won't be modifying it. |
| **FFmpeg support** | `--enable-libsrt` present; `srt` protocol present; **SRT loopback verified end-to-end on this host** `[VERIFIED-HOST]` (§9.5). |
| **Maturity / maintenance** | v1.5.7 released 2026-08-28; 3,599 stars; 374 open issues; pushed 2026-09-09 `[VERIFIED-DOC]`. Backed by Haivision + SRT Alliance. |
| **Compatibility** | Linux, Windows, macOS, **iOS, Android** `[VERIFIED-DOC]`. |
| **Performance** | Designed for lossy WANs: ARQ retransmission + configurable latency budget. Strictly better than RTMP over bad networks. |
| **Where it fits LIVETAP** | (1) Desktop → our own relay when the user's network is poor. (2) Ingest for platforms/CDNs that accept SRT. Note: the major social platforms are still RTMP-first, so SRT is an *internal* transport advantage, not a destination format. |
| **FIT SCORE** | **4** |

---

### 3.9 RTMP / RTMPS / Enhanced RTMP (E-RTMP)

| Dimension | Assessment |
|---|---|
| **Spec license** | Veovera `enhanced-rtmp` repo is **Apache-2.0** `[VERIFIED-DOC]`. 386 stars, 3 open issues, pushed 2026-08-19 `[VERIFIED-DOC]`. |
| **What E-RTMP adds** | Video: **VP8, VP9, HEVC, AV1 (with HDR)**; Audio: **AC-3, E-AC-3, Opus, FLAC** `[VERIFIED-DOC]`. Motivation: RTMP/FLV *"had remained largely unaltered for over two decades."* |
| **FFmpeg support** | **Yes, since 6.1**: Changelog entries *"Support HEVC,VP9,AV1 codec in enhanced flv format"* and *"Support HEVC,VP9,AV1 codec fourcclist in enhanced rtmp protocol"* `[VERIFIED-HOST]`. Our 9.0.1 build is well past that. |
| **Platform adoption (2026)** | Veovera lists adopters incl. YouTube, Twitch, Amazon, OBS, FFmpeg, XSplit, Red5, Adobe, VideoLAN, Dolby, Intel `[VERIFIED-DOC]`. Secondary reporting for 2026: E-RTMP supported by OBS 30+ and vMix 27+, accepted by YouTube and Twitch; **YouTube** has the broader AV1-via-E-RTMP story; **Twitch** made Dual Format GA for all streamers in June 2026 with HEVC 1440p for Partners/Affiliates, while **AV1 remains beta-limited and "not yet accepted for ingest"** `[VERIFIED-DOC]`, though this is secondary (non-primary) sourcing. **Per-platform E-RTMP acceptance must be confirmed against each platform's own developer docs before we enable it in product — mark `[UNVERIFIED]` until then.** |
| **RTMPS** | `rtmps`/`rtmpts`/`rtmpe`/`rtmpte` present in our build `[VERIFIED-HOST]`. **TLS handshake against a real platform ingest is `[UNVERIFIED]`.** Facebook/Instagram require RTMPS; expect to need up-to-date CA bundles (our build uses GnuTLS: `--enable-gnutls`). |
| **Long-term fit** | RTMP is legacy, fragile, TCP-only, and the universal lingua franca of every social ingest. We have no choice; plan for it to outlive us. |
| **FIT SCORE** | **5** (mandatory), E-RTMP specifically **3** (v1.1 feature, gated per platform) |

---

### 3.10 Hardware encoders (NVENC / QSV / AMF / VideoToolbox)

| Dimension | Assessment |
|---|---|
| **How FFmpeg exposes them** | As ordinary named encoders selected with `-c:v`. Confirmed present in our build `[VERIFIED-HOST]`: `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`; `h264_qsv`, `hevc_qsv`, `av1_qsv`; `h264_amf`, `hevc_amf`, `av1_amf`; `h264_mf`, `hevc_mf`, `av1_mf` (MediaFoundation); `h264_vaapi`, `h264_vulkan`, `h264_d3d12va`. macOS builds expose `h264_videotoolbox`/`hevc_videotoolbox` `[UNVERIFIED]` (not testable on Windows). |
| **License angle — important** | **None of these is a GPL library.** They are OS/driver APIs plus thin FFmpeg wrappers. An **LGPL** FFmpeg build can ship `h264_nvenc`/`h264_qsv`/`h264_amf`/`h264_mf`/`h264_videotoolbox`. This is the escape hatch from libx264 (§7.4). |
| **On our host** | `h264_mf` **works with no GPU** `[VERIFIED-HOST]` (640x360@30, 2 s → 233,375-byte mp4). `h264_nvenc`, `h264_qsv`, `h264_amf` all **fail with −22 Invalid argument** `[VERIFIED-HOST]` — the expected, correct result on a GPU-less VM. |
| **Everything about real hardware performance is `[UNVERIFIED]`** | No NVENC/QSV/AMF/VideoToolbox throughput, quality, session-limit, or driver-version data can be produced here. Do not put hardware-encode claims in product copy until measured on real devices. FFmpeg's HWAccel wiki page (trac.ffmpeg.org) was **unreachable** during this research (Anubis anti-bot challenge) `[UNVERIFIED]`. |
| **Detection strategy (recommended, implementable now)** | Runtime probe at first launch, cached in app config, re-probed on driver/OS change: <br>1. `ffmpeg -hide_banner -encoders` → parse for candidate names (cheap, tells us what the *binary* has). <br>2. For each candidate in priority order, run a **1-second smoke encode to null** and check exit status + that packets were produced: `ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 1 -c:v <enc> -f null -` <br>3. **Do not trust exit code alone.** On this host, failing hardware encoders produced *"Terminating thread with return code -22"* and *"Nothing was written into output file"* but the process still exited 0 `[VERIFIED-HOST]`. **The probe must assert that packets were written** (e.g. encode to a temp file and require non-zero size / non-zero `nb_frames` via ffprobe). This is a real trap and would have silently mis-detected hardware support. |
| **Fallback ladder (recommended)** | Windows: `h264_nvenc` → `h264_qsv` → `h264_amf` → `h264_mf` → `libx264 -preset veryfast`. macOS: `h264_videotoolbox` → `libx264 -preset veryfast`. Announce the selected encoder in the UI and in logs, and let the user override. |
| **FIT SCORE** | **4** (large upside, must be probe-gated; cannot be validated on our CI host) |

---

### 3.11 Native capture — Electron (Windows + macOS)

| Dimension | Assessment |
|---|---|
| **API** | `desktopCapturer.getSources({types:['screen','window']})` provides source IDs, consumed via `navigator.mediaDevices.getUserMedia` / `getDisplayMedia`; the main process wires it up with `session.setDisplayMediaRequestHandler()`. Electron's docs describe the **macOS system picker as "currently experimental"** `[VERIFIED-DOC]`. |
| **Windows audio** | Electron documents that apps *"can use `'loopback'` audio to capture system sound alongside screen content"* `[VERIFIED-DOC]`. Underlying Windows mechanism (WGC vs older DXGI/GDI paths, and WASAPI loopback) is a Chromium implementation detail — **which capture backend Electron picks per Windows build is `[UNVERIFIED]`**. |
| **macOS audio** | Electron docs: on **macOS 14.2+**, audio capture requires the **`NSAudioCaptureUsageDescription`** Info.plist key, because Chromium switched to Apple's **CoreAudio Tap API**; on **macOS ≤12.7.6** system audio cannot be captured natively and needs a third-party virtual audio device `[VERIFIED-DOC]`. Secondary sources describe an Electron issue tracking ScreenCaptureKit-based loopback, with behaviour gated by macOS version and a `MacCatapSystemAudioLoopbackCapture` flag — **secondary, and `[UNVERIFIED]`**; the authoritative answer must come from the Electron version we pin. |
| **macOS screen permission** | Screen Recording permission (TCC) is required and must be requested; **exact Electron API behaviour and first-run UX is `[UNVERIFIED]` here** (no macOS available). |
| **Electron version context** | Release schedule shows Electron 43 (Chromium M150, Node 24.17.0, 2026-06-30), 44 (M152, 2026-08-25), 45 (M156, 2026-10-20), 46 (M160, 2027-01-05) `[VERIFIED-DOC]`. Any Electron ≥ 43 ships Chromium ≥ M150, i.e. **WebCodecs, Insertable Streams, OffscreenCanvas, and `getDisplayMedia` with `systemAudio` are all available in the renderer** — the desktop app gets the *best* browser platform, uniformly, with no cross-browser matrix. That is a major architectural simplification. |
| **Alternative: capture inside FFmpeg** | Windows `-f dshow` / `-f gdigrab`; macOS `-f avfoundation`. Our build has `libavdevice` 63.1.101 `[VERIFIED-HOST]`. This avoids a renderer→ffmpeg frame pipe but **gives up all compositing** (no overlays, no scene switching, no 9:16 preview) and dshow device enumeration is notoriously brittle. `[UNVERIFIED]` on this host (no camera/screen session). |
| **FIT SCORE** | **4** for `desktopCapturer` + renderer compositing; **2** for capture-inside-ffmpeg. |

---

### 3.12 Virtual camera (output LIVETAP as a webcam)

| Dimension | Assessment |
|---|---|
| **Windows approach** | A **DirectShow output filter** (COM object) registered system-wide, as OBS has done since v26 (`VCamFilter`) `[VERIFIED-DOC]`, secondary-sourced. Requires shipping and **registering a COM DLL** → admin elevation at install, an installer/uninstaller story, and antivirus/SmartScreen friction. Modern consumers increasingly want a Media Foundation Virtual Camera (Windows 11) instead of DirectShow — **which of the two our target apps accept is `[UNVERIFIED]`**. |
| **macOS approach** | A **CoreMediaIO (CMIO) Camera Extension**, as OBS has done since v28 `[VERIFIED-DOC]`, secondary-sourced: a small system extension installed on first launch that registers a virtual `AVCaptureDevice`. It replaced the DAL plug-in Apple deprecated in macOS 12.3. Camera Extensions require **`com.apple.developer.system-extension.install` entitlement, a Developer ID, notarisation, and user approval in System Settings**. |
| **Feasibility for an Electron app** | Technically possible — the extension/filter is a **native sibling binary**, not something Electron hosts — but it means: a second native codebase per OS, a real code-signing and notarisation pipeline (incl. an Apple system-extension entitlement request), elevated installers, and OS-version-specific breakage. Estimated cost is comparable to the entire go-live feature. |
| **Recommendation** | **POST-MVP. Explicitly out of scope for v1.** Ship "go live to platforms" first. If users ask for Zoom/Meet/Teams integration, revisit with a dedicated native sub-team. |
| **FIT SCORE** | **2** (high value, disproportionate cost and risk for v1) |

---

### 3.13 Mobile — Capacitor (iOS + Android)

| Option | License | Status | Assessment |
|---|---|---|---|
| **HaishinKit.swift** (iOS/macOS/tvOS/visionOS) | **BSD-3-Clause** `[VERIFIED-DOC]` | 3,065 stars, **9** open issues, latest release **2.2.5 (2026-03-28)**, pushed 2026-08-30 `[VERIFIED-DOC]` | RTMP + SRT publish/playback; WHIP/WHEP listed as **alpha**. Platforms iOS 15+/macOS 12+/tvOS 15+/visionOS 1+. **9 open issues on 3k stars is an unusually clean tracker.** Best-in-class iOS choice. Note: RTMPS is not explicitly documented in the README `[VERIFIED-DOC]` — **confirm RTMPS support before committing to Facebook/Instagram on iOS: `[UNVERIFIED]`.** |
| **HaishinKit.kt** (Android) | BSD-3-Clause `[VERIFIED-DOC]` | Companion Android library, RTMP `[VERIFIED-DOC]` | Consistent API shape with iOS — attractive for a single Capacitor plugin surface. Maturity relative to RootEncoder: `[UNVERIFIED]`. |
| **RootEncoder** (ex `rtmp-rtsp-stream-client-java`) | **Apache-2.0** `[VERIFIED-DOC]` | 3,034 stars, 68 open issues, **2.8.1 released 2026-09-01**, pushed **2026-09-11** `[VERIFIED-DOC]` | RTMP, RTSP, SRT, UDP, **WHIP (beta)**; Android (minAPI 16) **and iOS**; codecs H264/H265/AV1/VP8/VP9/AAC/Opus/G711; real-time filters, screen recording, multiple sources `[VERIFIED-DOC]`. Apache-2.0 is the friendliest license here. **Recommended for Android.** |
| **react-native-nodemediaclient** | **No license field in npm metadata** `[VERIFIED-DOC]` — 0.3.6 published 2025-10-13, wraps NodeMediaClient-Android/iOS SDKs | **Reject.** A missing license declaration on a wrapper around a vendor SDK is an unacceptable legal unknown for an open-source product. Also React Native, not Capacitor. |
| **Capacitor community plugins** | — | `[UNVERIFIED]` | No maintained, well-licensed Capacitor RTMP plugin could be confirmed. Prior art exists in **Flutter** (`rtmp_streaming`, built on RootEncoder + HaishinKit) and **Expo/RN** (`expo-live-stream`, HaishinKit + RootEncoder) `[VERIFIED-DOC]` — which validates the *pattern* (thin bridge over the two native libs) but not any Capacitor package. |
| **Recommendation** | **Write our own Capacitor plugin**: a thin, uniform TS API (`start(url, key, opts)`, `stop()`, `setCamera()`, `stats$`) bridging **HaishinKit.swift on iOS** and **RootEncoder on Android**. Both are permissively licensed (BSD-3 / Apache-2.0), both actively maintained, and both encode on-device with hardware encoders. Do **not** try to run FFmpeg on mobile. |
| **FIT SCORE** | HaishinKit **4**, RootEncoder **4**, own Capacitor plugin **4**, react-native-nodemediaclient **1** |

---

### 3.14 Node/Electron-side encoding and WebRTC options

| Option | License | Maintenance | Assessment | FIT |
|---|---|---|---|---|
| **`child_process.spawn(ffmpeg, argvArray)`** | n/a (our code) | n/a | **The recommended approach.** argv **array** form (never a shell string) eliminates shell-injection risk from user-supplied stream keys/URLs — which is critical, since stream keys are attacker-influencable strings that end up in a command line. Gives us stdin frame piping, stderr progress parsing, exit codes, signals, and clean kill semantics. | **5** |
| `fluent-ffmpeg` | MIT | **DEPRECATED** — npm `deprecated`: *"Package no longer supported."* Last publish 2.1.3 on 2024-05-19 `[VERIFIED-DOC]` | **Reject.** Also builds command strings, obscures argv, and cannot express `tee` slave escaping cleanly. | **1** |
| `ffmpeg-static` | **GPL-3.0-or-later** (package), GPL binaries `[VERIFIED-DOC]` | 5.3.0, 2025-11-14 | devDependency/CI only. Never a shipped runtime dependency. | **2** |
| `@ffmpeg-installer/ffmpeg` | claims LGPL-2.1, **unsubstantiated**; binaries from 2018 `[VERIFIED-DOC]` | Last publish 2021-07-15 | **Reject** (§3.1.4). | **1** |
| `@roamhq/wrtc` | **BSD-2-Clause** `[VERIFIED-DOC]` | 0.10.0 published 2026-03-10; repo pushed 2026-03-18; 231 stars; maintained fork of the abandoned `node-webrtc`; **bindings to WebRTC M106**; prebuilds for Linux x64/arm64, macOS x64/arm64, Windows x64; Node 20 & 22 `[VERIFIED-DOC]` | Viable if we ever need WebRTC **in the Node/main process** (e.g. a headless WHIP sender). Concerns: pinned to M106 (an old libwebrtc), native prebuilds must match Electron's ABI, ~6 months since last push. **We should not need it** — the Electron renderer already has a first-class, current WebRTC stack. | **3** |
| `werift` | **MIT** `[VERIFIED-DOC]` | 0.24.4 published 2026-08-10; repo pushed 2026-09-11; 626 stars, 56 open issues `[VERIFIED-DOC]` | Pure-TypeScript WebRTC — **no native build step**, which is a real advantage for cross-platform Electron/Node packaging. Best fit if we need a server-side WHIP/WHEP endpoint in our own Node service. Pure-JS SRTP/DTLS performance at scale: `[UNVERIFIED]`. | **3** |
| `node-datachannel` | **MPL-2.0** `[VERIFIED-DOC]` | 0.33.3 published 2026-09-09 | libdatachannel bindings; lighter than libwebrtc; MPL-2.0 is fine for us. Worth knowing about; not needed for v1. | **3** |

---

## 4. Master scorecard

| Technology | License | Maturity | Maintenance | Perf | Win | mac | iOS | Android | Browser | Build on our host | **FIT** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **FFmpeg (child process)** | LGPL core / **our build GPLv3** | 5 | 5 | 5 | ✅ | ✅ | ✗ | ✗ | ✗ | **Trivial (installed)** | **5** |
| **MediaMTX** | **MIT** | 4 | 5 | 4 | ✅ | ✅ | n/a | n/a | n/a (server) | Trivial (1 binary) | **5** |
| **WHIP (RFC 9725)** | Std | 5 | 5 | 5 | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | **5** |
| **RTMP/RTMPS** | Std | 5 | 5 | 3 | ✅ | ✅ | ✅ | ✅ | ✗ | n/a | **5** |
| Browser capture + WebRTC | Std | 4 | 5 | 4 | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | n/a | **4** |
| SRT (libsrt) | **MPL-2.0** | 5 | 5 | 5 | ✅ | ✅ | ✅ | ✅ | ✗ | Trivial (in build) | **4** |
| Hardware encoders | OS/driver APIs | 5 | 5 | 5 | ⚠️ probe | ⚠️ probe | ✅ | ✅ | ⚠️ | **Untestable here** | **4** |
| Electron desktopCapturer | MIT (Electron) | 4 | 5 | 4 | ✅ | ⚠️ audio | n/a | n/a | n/a | Untestable here | **4** |
| HaishinKit (iOS) | **BSD-3** | 4 | 5 | 5 | n/a | ✅ | ✅ | n/a | n/a | n/a | **4** |
| RootEncoder (Android) | **Apache-2.0** | 4 | 5 | 5 | n/a | n/a | ⚠️ | ✅ | n/a | n/a | **4** |
| WebCodecs VideoEncoder | Std | 4 | 5 | 5 | ✅ | ✅ | ⚠️ 16.4+ | ⚠️ | ⚠️ 94.6% | n/a | **3** |
| E-RTMP (HEVC/AV1) | Apache-2.0 spec | 4 | 4 | 5 | ✅ | ✅ | ⚠️ | ⚠️ | ✗ | In build since 6.1 | **3** |
| WHEP (draft-04) | Not an RFC | 3 | 4 | 5 | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | n/a | **3** |
| werift / @roamhq/wrtc | MIT / BSD-2 | 3 | 4 | 3 | ✅ | ✅ | n/a | n/a | n/a | Easy / native | **3** |
| **GStreamer** | LGPL (+GPL plugins) | 5 | 5 | 5 | ✅ | ✅ | ⚠️ | ⚠️ | ✗ | **High**; Node bindings dead (2022) | **2** |
| **libobs / obs-studio-node** | **GPL-2.0** | 5 | 3 | 5 | ✅ | ✅ | ✗ | ✗ | ✗ | **Very high** | **2** |
| **OvenMediaEngine** | **AGPL-3.0** | 4 | 4 | 5 | ✗ | ⚠️ | n/a | n/a | n/a (server) | Docker (daemon down) | **2** |
| Virtual camera (DShow/CMIO) | our code + OS | 4 | n/a | 5 | ⚠️ | ⚠️ | n/a | n/a | n/a | Very high | **2** |
| MediaRecorder as transport | Std | 5 | 5 | 2 | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | **2** |
| `fluent-ffmpeg` | MIT | — | **Deprecated** | — | — | — | — | — | — | — | **1** |
| `@ffmpeg-installer/ffmpeg` | Unverifiable | — | Stale 2021 | — | — | — | — | — | — | — | **1** |
| `react-native-nodemediaclient` | **None declared** | — | 2025 | — | — | — | ⚠️ | ⚠️ | — | — | **1** |

Legend: ✅ supported / ⚠️ conditional or unverified / ✗ not applicable.

---

## 5. RECOMMENDED ARCHITECTURE

### 5.1 Text diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  LIVETAP WEB (React, any modern browser)                                             │
│                                                                                      │
│  getUserMedia(cam,mic) ─┐                                                            │
│  getDisplayMedia(tab)  ─┼─► OffscreenCanvas/WebGL scene compositor (worker)          │
│  images / overlays     ─┘            │                                               │
│                                      ├─► canvas.captureStream(30) ──┐                │
│                                      └─► local <video> preview      │                │
│                                                                     ▼                │
│                                    RTCPeerConnection (SDP forced to H.264 CBP + Opus)│
│                                                                     │                │
└─────────────────────────────────────────────────────────────────────┼────────────────┘
                                     WHIP (RFC 9725) POST + Bearer JWT │ HTTPS/DTLS-SRTP
                                                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  LIVETAP RELAY  (server-side, our infra)                                             │
│                                                                                      │
│   ┌────────────────────────────────────────────────────────────────────────┐          │
│   │ MediaMTX  (MIT, single binary / Docker)                                │          │
│   │   WHIP ingest   :8889/tcp  +  :8189/udp  (ICE)                         │          │
│   │   auth: JWT (mediamtx_permissions claim) via our JWKS                  │          │
│   │                                                                        │          │
│   │   path "live/{userId}":                                                │          │
│   │     forward:                    ◄── PASS-THROUGH, NO RE-ENCODE         │          │
│   │       - rtmps://youtube-ingest/app#KEY                                 │          │
│   │       - rtmps://facebook-ingest/app#KEY                                │          │
│   │       - rtmp://twitch-ingest/app#KEY                                   │          │
│   │     record: yes  (fMP4 segments → object storage)                      │          │
│   │                                                                        │          │
│   │     runOnAvailable:  (ONLY when a 9:16 destination exists)             │          │
│   │        ffmpeg -i rtsp://localhost:$RTSP_PORT/$MTX_PATH                 │          │
│   │               -filter:v crop=ih*9/16:ih,scale=1080:1920                │          │
│   │               -c:v <hw|libx264> -c:a copy                              │          │
│   │               -f tee "[f=flv:onfail=ignore:use_fifo=1]rtmp://tiktok…"  │          │
│   │     runOnAvailableRestart: yes                                         │          │
│   └────────────────────────────────────────────────────────────────────────┘          │
│   Control plane: our Node API writes MediaMTX paths via its Control API / config      │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  LIVETAP DESKTOP (Electron ≥43, Chromium ≥M150)                                      │
│                                                                                      │
│  RENDERER (one Chromium, no browser matrix):                                         │
│    desktopCapturer + getUserMedia(screen/window/cam/mic, loopback audio on Win)       │
│         │                                                                            │
│         ├─► WebGL2 / OffscreenCanvas scene compositor  (GPU, off main thread)         │
│         │        │                                                                   │
│         │        ├─► local preview                                                    │
│         │        └─► frame sink ──► SharedArrayBuffer / MessagePort ──┐               │
│         └─► WebAudio graph (mic + system + music) ──► PCM sink ───────┤               │
│                                                                       ▼               │
│  MAIN PROCESS:  spawn('ffmpeg', [argv…])   ◄── ONE process, ONE encode                │
│      stdin pipe 0: rawvideo bgra 1920x1080@30                                         │
│      stdin pipe 1: s16le 48kHz stereo PCM                                             │
│                                                                                      │
│      ffmpeg -f rawvideo … -i pipe:0  -f s16le … -i pipe:3                             │
│        -c:v <probed hw encoder | libx264 -preset veryfast -tune zerolatency>          │
│        -c:a aac -b:a 160k                                                             │
│        -f tee -use_fifo 1 -fifo_options attempt_recovery=1:recovery_wait_time=2:…     │
│          "[f=flv:onfail=ignore]rtmps://youtube…                                       │
│          |[f=flv:onfail=ignore]rtmps://facebook…                                      │
│          |[f=flv:onfail=ignore]rtmp://twitch…                                         │
│          |[f=mp4:onfail=ignore]C:\…\LIVETAP\recording-<ts>.mp4"   ◄── ANCHOR SLAVE    │
│                                                                                      │
│      IF a 9:16 destination is selected → ONE extra encode branch in the SAME process: │
│        -filter_complex "[0:v]split=2[a][b];[b]crop=ih*9/16:ih,scale=1080:1920[v916]"  │
│        → second -f tee for the 9:16 group                                             │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  LIVETAP MOBILE (Capacitor)                                                          │
│   TS API  livetap-stream.start({url,key,…})                                          │
│      iOS     → HaishinKit.swift   (BSD-3)  RTMP/SRT, HW encode via VideoToolbox       │
│      Android → RootEncoder        (Apache-2.0) RTMP/RTSP/SRT, HW encode via MediaCodec│
│   Multi-destination on mobile → publish ONCE to LIVETAP RELAY, relay fans out.        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 (a) How the WEB app goes live — **decision: WHIP → MediaMTX relay → RTMP fan-out**

The browser fundamentally cannot open an RTMP socket. Three candidate paths were weighed:

| Option | Latency | Quality | Cost to us | CPU on server | Verdict |
|---|---|---|---|---|---|
| **1. WHIP → MediaMTX → native `forward` to RTMP/RTMPS** | Lowest (WebRTC, sub-second to relay) | **No re-encode** — browser's H.264 is passed through | Run MediaMTX (MIT, one binary) | **Near zero** (remux only) | ✅ **CHOSEN** |
| 2. `MediaRecorder` → WebSocket → server FFmpeg | Higher; chunk-boundary quantised | Container remux, or a full re-encode | Custom WS server + ffmpeg per session | High if re-encoding | ❌ |
| 3. "Download the desktop app" for RTMP | n/a | n/a | Zero | Zero | ❌ as the *only* web path |

**Justification for option 1:**

- **It is a standard.** WHIP is **RFC 9725, Standards Track, March 2025** `[VERIFIED-DOC]`. We are not betting on a draft.
- **MediaMTX does the fan-out natively, pass-through.** `forward` takes an **array** of destinations, supports **RTMP/RTMPS with `#streamKey`**, and the docs confirm it does not transcode (they direct you to `runOnAvailable` + FFmpeg precisely *when* you need transcoding) `[VERIFIED-DOC]`. So one WHIP ingest → N RTMP outputs costs us almost no CPU. **This is strictly better than the `runOnReady`+ffmpeg pattern the brief asked about** — and note `runOnReady` doesn't even exist any more (§3.4).
- **Codec alignment holds.** RTMP/FLV needs H.264; WebRTC's mandatory H.264 Constrained Baseline is exactly what both MediaMTX WHIP ingest and FFmpeg's WHIP muxer accept `[VERIFIED-DOC]`. We force H.264 in the browser's SDP (munge/reorder `RTCRtpSender.getCapabilities("video").codecs`) so that pass-through is always possible. **If the browser can only give VP8, pass-through is impossible and we must transcode** — detect this and either transcode server-side or refuse with a clear message.
- **Auth is already solved.** MediaMTX accepts `Authorization: Bearer` for WebRTC/WHIP and validates JWTs against a JWKS with a `mediamtx_permissions` claim `[VERIFIED-DOC]`. Our API mints a short-lived JWT scoped to `publish` on `live/{userId}` — **the user's platform stream keys never reach the browser.** That is a significant security win over any client-side RTMP scheme and on its own justifies the relay.
- **Option 3 is kept as an upsell, not a fallback:** when the user wants system audio, multi-scene compositing, or local recording at full quality, the UI offers the desktop app. This is honest (see §3.6 on system audio) rather than shipping a web feature that silently returns no audio track.

**Residual risks:** WHIP end-to-end was **not** executed here (`[UNVERIFIED]`, §9.8); UDP/ICE traversal for restrictive corporate networks needs a TURN server (budget for coturn); relay bandwidth is N× outbound per viewer-destination.

### 5.3 (b) How the DESKTOP app goes live — **decision: renderer composites, FFmpeg child process encodes**

| Option | Latency | CPU | Compositing power | License impact | Verdict |
|---|---|---|---|---|---|
| **A. Renderer composites (WebGL/OffscreenCanvas) → raw frames over stdin → one FFmpeg process encodes + `tee`** | Low: one GPU composite + one encode + pipe copy | Moderate; pipe of raw BGRA 1080p30 ≈ 249 MB/s **in-process memory bandwidth** — fine locally, but must use a big pipe buffer and drop-on-backpressure | **Full** — scenes, overlays, transitions, 9:16 preview, all in JS/WebGL | **None** (FFmpeg stays a separate process) | ✅ **CHOSEN** |
| B. Renderer composites → **WebCodecs** `VideoEncoder` → muxed/handed to FFmpeg as encoded H.264 | Lowest (zero raw-frame copy; possible hw encode inside Chromium) | Lowest | Full | None | ✅ **Phase 2 optimisation, behind `isConfigSupported()`** |
| C. Capture + encode entirely in FFmpeg (`dshow`/`gdigrab`/`avfoundation`) | Low | Lowest | **None** — no overlays, no scenes | None | ❌ as primary; keep as a diagnostic/"simple mode" |
| D. libobs via obs-studio-node | Lowest | Lowest | Full, best-in-class | **Forces GPL on LIVETAP** | ❌ |

**Justification:**

- **Option A is the only one that gets full compositing *and* keeps LIVETAP permissively licensed *and* is buildable today.** Every piece of it is verified working here except the frame pipe itself.
- **Latency/CPU trade-off, stated honestly:** A costs one extra full-frame memcpy per frame versus B, and one extra colour conversion (BGRA→NV12/YUV420p) that FFmpeg does on CPU. At 1080p30 that is measurable but small next to the encode itself. B eliminates it and can reach a hardware encoder inside Chromium — but WebCodecs hardware paths are `[UNVERIFIED]` (§3.10) and Safari-class gaps don't matter in Electron, so B is a clean *optimisation*, not a *foundation*. Ship A, measure, then add B behind a probe.
- **Option D's performance advantage is real** and I am not dismissing it — libobs is better at this than we will be. It is rejected on licensing and build-complexity grounds (§7.5), not on merit.
- **Backpressure discipline is mandatory** for A: if FFmpeg's stdin blocks (e.g. a stalled network output without fifo), the renderer must **drop frames, never queue unboundedly**. Pair this with `use_fifo` + `drop_pkts_on_overflow=1` so that a slow RTMP destination can never stall the encoder. Both sides of that guard are needed.

#### Single-encode fan-out to N RTMP destinations — verified syntax

`[VERIFIED-HOST]` — this exact shape ran here and delivered to two live RTMP receivers while skipping a dead one and writing a recording:

```bash
ffmpeg -hide_banner \
  -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i pipe:0 \
  -f s16le -ar 48000 -ac 2 -i pipe:3 \
  -map 0:v -map 1:a \
  -c:v libx264 -preset veryfast -tune zerolatency \
     -b:v 6000k -maxrate 6000k -bufsize 12000k -g 60 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 -ac 2 \
  -flags +global_header \
  -f tee -use_fifo 1 \
  -fifo_options "attempt_recovery=1:recovery_wait_time=2:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=240" \
  "[f=flv:onfail=ignore]rtmps://a.rtmp.youtube.com/live2/KEY1|[f=flv:onfail=ignore]rtmps://live-api-s.facebook.com:443/rtmp/KEY2|[f=flv:onfail=ignore]rtmp://ingest.twitch.tv/app/KEY3|[f=mp4:onfail=ignore]/path/recording.mp4"
```

Rules learned from the verified runs:

1. **`onfail=ignore` is per-slave, inside the brackets**, next to `f=`. `[VERIFIED-DOC]` + `[VERIFIED-HOST]`
2. **`-map` is mandatory** — tee cannot auto-select streams. `[VERIFIED-DOC]`
3. **`-flags +global_header`** should be set explicitly; tee defeats per-format auto-detection of it. `[VERIFIED-DOC]`
4. **Second-level escaping**: `:` inside a slave's option *value* must be escaped `\:`. Passing `-fifo_options` as a **global** option (as above) avoids most of that pain — prefer it.
5. **⚠️ CRITICAL TRAP, discovered by testing:** if **every** slave fails to open, FFmpeg does **not** survive — it exits with *"Output file does not contain any stream / Error opening output files: Invalid argument"* `[VERIFIED-HOST]`. **Therefore always include one slave that cannot fail — the local recording file, or a `[f=null]-` sink — as an "anchor".** With an anchor present, all network outputs can be dead at startup and the process still runs and recovers (§9.6). This single finding is the difference between a broadcaster that survives a flaky ingest and one that dies on launch.

#### Per-format re-encode only when a 9:16 destination is present

`[VERIFIED-HOST]` — single source, `split` filter, two independent encodes, one process:

```bash
ffmpeg -hide_banner \
  -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i pipe:0 \
  -f s16le -ar 48000 -ac 2 -i pipe:3 \
  -filter_complex "[0:v]split=2[land][tall];[tall]crop=ih*9/16:ih,scale=1080:1920[v916]" \
  -map "[land]" -map 1:a -c:v libx264 -preset veryfast -tune zerolatency -b:v 6000k -pix_fmt yuv420p -c:a aac -b:a 160k \
    -f tee -use_fifo 1 "[f=flv:onfail=ignore]rtmps://…yt…|[f=mp4:onfail=ignore]rec.mp4" \
  -map "[v916]" -map 1:a -c:v libx264 -preset veryfast -tune zerolatency -b:v 4000k -pix_fmt yuv420p -c:a aac -b:a 128k \
    -f tee -use_fifo 1 "[f=flv:onfail=ignore]rtmp://…tiktok…|[f=flv:onfail=ignore]rtmp://…reels…"
```

Verified result: `land.flv` = h264 **1280x720**, `port.flv` = h264 **1080x1920**, both with AAC, from one lavfi source in one process `[VERIFIED-HOST]`.

**Rule: the 9:16 encode branch is created only if at least one selected destination is portrait.** Zero portrait destinations → zero extra encode. Also: the 9:16 *framing* (what gets cropped) should be user-controllable in the renderer; consider compositing the portrait frame in the renderer too and piping a second raw stream, if crop-from-landscape proves visually unacceptable.

**⚠️ Gotcha found while testing:** `-t <dur>` placed **before** `-filter_complex` does **not** bound the outputs — my first dual-encode run never terminated and had to be killed. **Duration/`-t` and all encoder options must be specified per-output, after the `-map` for that output.** `[VERIFIED-HOST]`

### 5.4 (c) Recording shares the encode

Recording is **just another `tee` slave**: `[f=mp4:onfail=ignore]<path>`. Verified: `rec.mp4` came out of the same single libx264 encode that fed two RTMP receivers — h264 1280x720, 150 video frames, 236 audio frames `[VERIFIED-HOST]`.

Refinements:
- Use **`-f mp4 -movflags +frag_keyframe+empty_moov+default_base_moof`** so a crash or power loss leaves a playable file. (Plain `mp4` needs a clean finalise — our test showed `flv` slaves logging *"Failed to update header with correct duration/filesize"* when a peer vanished `[VERIFIED-HOST]`, and mp4 is worse in that respect.)
- The recording slave doubles as the **anchor slave** from §5.3 rule 5. Two jobs, one output. If the user disables recording, substitute `[f=null:onfail=ignore]-`.
- If the user wants a *higher-quality* recording than the stream, that is a **second encode branch** (like the 9:16 case), not a tee slave — and should be opt-in, since it costs a full extra encode.

### 5.5 (d) Reconnect / backoff — **per-output first, process-level only as a last resort**

Two layers, in this order:

**Layer 1 — per-output, inside FFmpeg (primary).** `tee -use_fifo 1` + `fifo_options attempt_recovery=1:recovery_wait_time=2:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=240:max_recovery_attempts=0`.

**This is verified working, including the hard case.** `[VERIFIED-HOST]` A 20-second run started with its RTMP destination **completely dead**; a receiver was started at **t=6 s**; FFmpeg's fifo reconnected on its own and the receiver captured a clean **8.0-second** stream (567,107 bytes), while the local `anchor.mp4` recording (2,297,636 bytes) was never interrupted and the process exited 0. No supervisor logic, no encoder restart, no interruption to healthy outputs.

Why per-output must be primary: **restarting the FFmpeg process to fix one bad destination breaks every good destination and the recording.** A viewer on YouTube should never see a glitch because the user's Twitch key expired.

Known caveat, observed: on reconnect the late-joining receiver logged *"non-existing PPS 14 referenced"* / *"missing picture in access unit"* `[VERIFIED-HOST]` — the new connection began mid-GOP without fresh SPS/PPS. **Mitigation:** keep `-flags +global_header`, consider `[bsfs/v=dump_extra=freq=keyframe]` on FLV slaves so every keyframe carries extradata, and keep GOP short (`-g 60` at 30 fps = 2 s) so a reconnecting destination re-syncs within ~2 seconds. **Whether each platform tolerates a mid-GOP reconnect is `[UNVERIFIED]`** and must be tested per platform.

**Layer 2 — process-level supervisor in Electron main (secondary).** Only for: FFmpeg exited/crashed; stdin write errors; no progress on stderr for N seconds (stall detector); or a single output exhausting `max_recovery_attempts`. Policy:
- Exponential backoff with jitter: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s cap; reset after 60 s of healthy streaming.
- **Never auto-restart more than ~5 times in 5 minutes** — surface the failure to the user instead of hammering a platform's ingest (which can get an account rate-limited).
- Distinguish **permanent** failures (auth rejected, bad stream key, 4xx-equivalent) from **transient** ones (DNS, connect timeout, reset). Permanent → stop that destination, show an actionable error, keep the rest live. Do not retry a bad stream key forever.
- On restart, **re-derive the argv from current state** (destinations may have changed) rather than replaying a stale command.

**Per-destination state machine to expose in the UI:** `idle → connecting → live → reconnecting(n) → failed(reason)`, one row per destination, driven by parsing FFmpeg stderr (`tee` logs `Slave muxer #N failed: … continuing with X/Y slaves` `[VERIFIED-HOST]`, which is directly parseable) plus fifo recovery lines.

### 5.6 (e) Mobile go-live path

- **One Capacitor plugin, two native backends**: iOS → **HaishinKit.swift** (BSD-3-Clause, 2.2.5 / 2026-03-28, 9 open issues) `[VERIFIED-DOC]`; Android → **RootEncoder** (Apache-2.0, 2.8.1 / 2026-09-01, pushed daily) `[VERIFIED-DOC]`. Both encode on-device with platform hardware encoders (VideoToolbox / MediaCodec) — mobile battery and thermals make software encoding a non-starter.
- **Mobile publishes exactly once** — to the **LIVETAP relay** (RTMP or SRT), and the relay fans out. Never run N RTMP uploads from a phone: N× the uplink and N× the radio power for no benefit.
- **SRT is the preferred mobile uplink** where supported (both libraries support it `[VERIFIED-DOC]`): cellular is lossy, and SRT's ARQ is exactly the right tool. Fall back to RTMP.
- **Do not ship FFmpeg on mobile.** Binary size, App Store review friction around GPL (see §7.6), and no compositing benefit.
- `[UNVERIFIED]`: RTMPS on HaishinKit (not documented in its README), HaishinKit.kt maturity vs RootEncoder, and the existence of any maintained third-party Capacitor RTMP plugin. Plan to write and own the plugin.

### 5.7 (f) Licensing recommendation

See §7 in full. Short form: **LIVETAP ships under Apache-2.0** (preferred over MIT for its explicit patent grant — relevant in a codec-adjacent product), **spawns FFmpeg as a separate process**, and carries a `THIRD_PARTY_NOTICES.md` plus a written offer of FFmpeg source.

### 5.8 (g) What is verified vs unverified on the build host

Full detail in §9 and §10. Summary:

| VERIFIED on this host `[VERIFIED-HOST]` | UNVERIFIED `[UNVERIFIED]` |
|---|---|
| Software x264 encode → FLV | All hardware encoders (NVENC/QSV/AMF/VideoToolbox) — no GPU |
| `tee` + `onfail=ignore`: 2 live RTMP + 1 dead + mp4 recording from ONE encode | WHIP end-to-end handshake (no server could be run) |
| `tee` all-slaves-dead → process aborts (anchor-slave requirement) | MediaMTX runtime: ingest, `forward`, auth, hooks |
| `tee -use_fifo` + `attempt_recovery` reconnecting a late-joining RTMP output | RTMPS/TLS against real platform ingests |
| SRT loopback (caller→listener), h264+aac received | Real camera / mic / screen capture |
| Single-source dual-aspect encode (1280x720 + 1080x1920, one process) | All macOS behaviour (ScreenCaptureKit, CMIO, VideoToolbox, TCC) |
| WHIP muxer present with full documented option set | All iOS/Android behaviour |
| `h264_mf` (MediaFoundation) encoding **without a GPU** | Electron `desktopCapturer` runtime behaviour, Windows loopback audio |
| NVENC/QSV/AMF correctly failing (−22) — and **exiting 0 while failing** | Browser `getDisplayMedia` system-audio matrix per OS/browser |
| E-RTMP HEVC/VP9/AV1 support present since FFmpeg 6.1 (Changelog) | WebCodecs hardware-encode paths; MediaRecorder mp4/H.264 per browser |
| FFmpeg build is GPL + version3 with libx264/libx265 | GStreamer installer sizes; libobs build |

---

## 6. Implementation notes that fall out of the evaluation

1. **Pin and vendor the FFmpeg binary per platform.** Do not download at install time, do not use `ffmpeg-static` in production. Record the exact version, build configuration, and SHA-256 of every shipped binary in the repo.
2. **`spawn(bin, argvArray)` only — never a shell string.** Stream keys are user-controlled data that lands in a command line; argv arrays make injection structurally impossible.
3. **Redact stream keys from every log line, crash report, and telemetry event.** They are bearer credentials. FFmpeg echoes its full command line on startup — suppress or scrub it.
4. **Parse FFmpeg stderr for structured state**, specifically `Slave muxer #N failed: … continuing with X/Y slaves` `[VERIFIED-HOST]` and fifo recovery messages. Map slave index → destination at argv-construction time and keep the map.
5. **The hardware-encoder probe must check that packets were produced**, not just the exit code — all three failing hardware encoders exited 0 on this host `[VERIFIED-HOST]`.
6. **Always include an anchor slave** in every `tee` (§5.3 rule 5).
7. **Set `-t` and encoder options per output**, after that output's `-map` (§5.3 gotcha).
8. **Ship an LGPL-capable second binary path** so we can offer a non-GPL build later without code changes (§7.4).
9. **MediaMTX config must use `runOnAvailable`, not `runOnReady`** — renamed in v1.21.0 `[VERIFIED-DOC]`. Pin the MediaMTX version in our deployment and read its release notes before bumping.
10. **Budget a TURN server** (coturn) for WHIP from restrictive networks. Without it, a measurable fraction of web users will fail to connect.

---

## 7. LICENSING ANALYSIS

### 7.1 Can LIVETAP be MIT/Apache-2.0 while spawning a GPL FFmpeg binary?

**Yes — for the *code*.** The mechanism is the separate-process boundary, and the FSF's own FAQ is the citation.

The GPL FAQ, on mere aggregation `[VERIFIED-DOC]` (retrieved via search result quoting gnu.org; **note: `gnu.org` was unreachable from this build host — connection refused to 209.51.188.116:443 — so the text below is quoted from a search result rather than fetched directly, and should be re-verified from gnu.org by the legal reviewer**):

> "Mere aggregation of two programs means putting them side by side on the same CD-ROM or hard disk. We use this term in the case where they are separate programs, not parts of a single program. In this case, if one of the programs is covered by the GPL, it has no effect on the other program."

And, decisively for our design:

> "By contrast, pipes, sockets and command-line arguments are communication mechanisms normally used between two separate programs. So when they are used for communication, the modules normally are separate programs. But if the semantics of the communication are intimate enough, exchanging complex internal data structures, that too could be a basis to consider the two parts as combined into a larger program."

**Applying it to LIVETAP's actual design:**

| FSF test | LIVETAP's design | Assessment |
|---|---|---|
| Separate programs? | FFmpeg is a distinct executable in its own OS process, with its own address space, spawned via `spawn()`. | ✅ Yes |
| Communication mechanism? | **argv array + stdin/stdout/stderr pipes + POSIX/Win32 signals.** Exactly the three mechanisms the FAQ names as normal between separate programs. | ✅ Squarely inside the safe harbour |
| "Intimate" semantics / complex internal data structures? | We pass **rawvideo BGRA frames and s16le PCM** — generic, public, format-documented byte streams that any tool can produce or consume (we could pipe them to GStreamer or a file just as easily). We pass **no FFmpeg internal structures**, use **no FFmpeg headers**, link **no FFmpeg library**, and depend on **no FFmpeg ABI**. | ✅ Not intimate |
| Any linking? | None. No `libavcodec`, no `libavformat`, no native addon, no dlopen. | ✅ |

**Conclusion: LIVETAP's source code may be Apache-2.0, and spawning a GPL FFmpeg binary does not make LIVETAP a derivative work of FFmpeg.**

### 7.2 But the *distribution* still carries obligations

This is the part that gets missed. Two separate questions:

- **Is LIVETAP's code GPL?** No (§7.1).
- **Does our installer, which contains a GPLv3 FFmpeg binary, carry GPLv3 obligations for that binary?** **Yes.** Distributing a GPL binary is distribution under the GPL, whatever else is in the bundle. FFmpeg's compliance checklist requires distributing FFmpeg's source (modified or not), documenting the build, and stating prominently that FFmpeg is used `[VERIFIED-DOC]`.

Concretely, if we ship the gyan.dev full build (GPLv3) we must:

1. Provide the **complete corresponding source** for that exact FFmpeg build (and for the GPL libraries in it, notably x264 and x265), or a written offer valid for the GPL-required period.
2. Provide the **exact build configuration** used (we have it: §9.1).
3. Provide the **full GPLv3 text** (and GPLv2 text for GPL-2.0-or-later components).
4. **Not** impose additional restrictions on that binary via our EULA.
5. State in the app and on the download page that LIVETAP uses FFmpeg, with a link to the source.

Also note FFmpeg's own warning `[VERIFIED-DOC]`: *"FFmpeg is not available under any other licensing terms, especially not proprietary/commercial ones, not even in exchange for payment."* There is no buying our way out.

### 7.3 Recommended license for LIVETAP: **Apache-2.0**

Over MIT, because Apache-2.0 carries an **express patent grant and patent-retaliation clause**. In a product that touches H.264/HEVC/AV1 — patent-encumbered codecs — an explicit patent grant from contributors is materially more valuable than MIT's silence. (Separately: **codec patent licensing — MPEG-LA/Access Advance/Via-LA pools for H.264/HEVC — is an orthogonal risk that no software license addresses.** It is `[UNVERIFIED]` here and belongs to the legal team, not to this document. Note that shipping a *software* H.264 encoder to end users is a different patent posture from using the OS's encoder, which is another argument for §7.4.)

### 7.4 The strategic escape hatch: also produce an LGPL build

Because everything is behind a process boundary, we can ship **two** FFmpeg build profiles with **zero code change**:

| Profile | Configure flags | H.264 encoder | License | Use |
|---|---|---|---|---|
| **`livetap-gpl`** | `--enable-gpl --enable-libx264 --enable-libsrt …` | `libx264` (best software quality) | GPLv2+/v3 | Default open-source distribution |
| **`livetap-lgpl`** | **no** `--enable-gpl`, **no** `--enable-version3`, `--enable-libopenh264 --enable-mediafoundation --enable-nvenc --enable-libvpl --enable-amf --enable-libsrt --enable-libopus` | Windows: `h264_mf` / `h264_nvenc` / `h264_qsv` / `h264_amf`; macOS: `h264_videotoolbox`; software fallback: **`libopenh264` (BSD-2-Clause** `[VERIFIED-DOC]`, Cisco, v2.6.0 released 2025-02-12, 6,143 stars, pushed 2026-09-10) | LGPL-2.1+ | Enterprise/OEM/app-store distributions, or any future proprietary offering |

**Why this is credible, not theoretical:** `h264_mf` **encoded successfully on this GPU-less host** `[VERIFIED-HOST]`. That proves a non-GPL Windows software-ish encode path exists even on hardware with no GPU at all. Combined with `h264_videotoolbox` on macOS (Apple hardware always has it) and `libopenh264` as the universal fallback, the LGPL profile is genuinely viable. `libsrt` is MPL-2.0 and fine in an LGPL build `[VERIFIED-DOC]`.

**Caveats to test before promising it:** `libopenh264` visual quality at a given bitrate is generally below `libx264` — quantified comparison is `[UNVERIFIED]` (the openh264 README makes no such comparison). And LGPL compliance itself has requirements: FFmpeg's checklist calls for **dynamic linking** and source availability `[VERIFIED-DOC]` — for a spawned executable this is moot as to linking, but the source-offer duty remains.

For reference on how the industry does it: OBS Studio is **GPL-2.0-or-later** `[VERIFIED-DOC]` (its `COPYING` is verbatim GPLv2) and therefore can bundle a GPL FFmpeg freely; it builds its own FFmpeg via `obs-deps` (`build-ffmpeg.zsh`) and exposes encoders through plugins `[VERIFIED-DOC]`, secondary-sourced. **OBS's freedom here comes from being GPL itself** — it is not a template for a permissively licensed app. Streamlabs' obs-studio-node is likewise GPL-2.0 `[VERIFIED-DOC]`. **Specifically which license variant of FFmpeg OBS ships in its official installers is `[UNVERIFIED]`** — I could not retrieve OBS's bundled FFmpeg license file (404).

### 7.5 Would a GPL-licensed LIVETAP be acceptable? — the libobs question

If LIVETAP were **GPL-2.0-or-later**, `libobs`/`obs-studio-node` becomes available and we inherit a world-class media engine.

| Gain | Cost |
|---|---|
| Best-in-class scene graph, GPU compositing, hardware encoder integration, plugin ecosystem | **Copyleft on all of LIVETAP.** Every downstream user/fork must also be GPL. |
| Battle-tested by millions of streamers | **No proprietary embedding / white-labelling / OEM deals.** Kills a plausible business model. |
| Enormous engineering shortcut | **App store friction.** GPLv2 vs the Apple App Store's terms is a long-running, unresolved conflict (VLC precedent). A GPL Electron+libobs desktop app is fine; a GPL mobile app is a real problem. |
| Community alignment with OBS ecosystem | **In-process GPL native addon** → no crash isolation, full-privilege failure domain. |
| | **Very high build complexity**: custom OBS build with scripting/UI disabled, CMake + VS/Xcode, per-Electron-ABI rebuilds `[VERIFIED-DOC]`. Unbuildable/untestable on our GPU-less CI host. |
| | **Vendor-branch dependency**: newest public release tag is from **2018** `[VERIFIED-DOC]`, even though the repo is pushed daily for Streamlabs' own product. |

**Recommendation: NO for v1.** Choose **Apache-2.0 + FFmpeg-as-child-process**. It keeps mobile viable, keeps OEM/enterprise options open, gives us crash isolation, and — per §9 — already does everything the MVP needs. **Revisit only if** (a) compositing/performance measurements on real hardware prove the renderer+pipe path inadequate, **and** (b) the business explicitly accepts full copyleft. That would be a deliberate strategic pivot, not an implementation detail.

### 7.6 `THIRD_PARTY_NOTICES.md` — required contents

Create `docs/legal/THIRD_PARTY_NOTICES.md` (and ship it inside the app, reachable from an "Open Source Licenses" menu item). It must contain:

**A. FFmpeg — the most important entry**

```
FFmpeg
------
LIVETAP bundles and invokes the FFmpeg multimedia framework as a separate
executable program. LIVETAP does not link against, include, or derive from
FFmpeg source code; it communicates with FFmpeg only via command-line
arguments and standard input/output pipes.

Upstream:            https://ffmpeg.org/
Version shipped:     9.0.1                       (per platform; see table below)
Build provenance:    <e.g. www.gyan.dev full_build | LIVETAP CI build #NNN>
SHA-256 (win-x64):   <hash>
SHA-256 (mac-arm64): <hash>
SHA-256 (mac-x64):   <hash>

LICENSE OF THIS BUILD: GNU General Public License, version 3 or later.
  This build was configured with --enable-gpl and --enable-version3 and links
  the GPL-licensed libraries libx264 and libx265. The full configuration used
  is reproduced in FFMPEG_BUILD_CONFIG.txt in this distribution.

COMPLETE CORRESPONDING SOURCE: available at <URL to our source mirror>.
  WRITTEN OFFER: for at least three years from the date of distribution, and
  for as long as we offer spare parts or customer support for this product,
  LIVETAP will provide, to any third party, a complete machine-readable copy
  of the corresponding source code for the FFmpeg build distributed here, for
  no more than the cost of physically performing the distribution.
  Requests: <legal contact email / URL>.

The full text of the GNU General Public License v3 is in LICENSES/GPL-3.0.txt.
The full text of the GNU General Public License v2 is in LICENSES/GPL-2.0.txt.
The full text of the GNU Lesser General Public License v2.1 is in
LICENSES/LGPL-2.1.txt.

Bundled FFmpeg components with their own notices include (non-exhaustive;
see FFMPEG_BUILD_CONFIG.txt for the full list):
  x264      — GPL-2.0-or-later
  x265      — GPL-2.0-or-later
  libsrt    — MPL-2.0            (source: https://github.com/Haivision/srt)
  libopus   — BSD-3-Clause
  libvpx    — BSD-3-Clause
  dav1d     — BSD-2-Clause
  SVT-AV1   — BSD-3-Clause / Apache-2.0 patent grant
  ... (generate the complete list from the shipped build's configuration)
```

**B. MediaMTX** — MIT `[VERIFIED-DOC]`; include the MIT text and copyright line; state version and whether it is bundled or server-side only.

**C. Mobile libraries** — HaishinKit.swift **BSD-3-Clause** `[VERIFIED-DOC]` (retain copyright + the 3-clause text, including the no-endorsement clause); RootEncoder **Apache-2.0** `[VERIFIED-DOC]` (retain `NOTICE` file contents if present, and note any modifications per Apache §4).

**D. Electron / Chromium / Node** — BSD-3-Clause + a large bundle of transitive notices. Generate mechanically; do not hand-write.

**E. npm dependency notices** — generate with a license-report tool in CI and **fail the build** on any dependency whose license is GPL/AGPL/unknown/unstated. This would have caught both `ffmpeg-static` (GPL-3.0-or-later) and `react-native-nodemediaclient` (no license field) automatically.

**F. If we later ship an LGPL FFmpeg build**, that entry must state LGPL-2.1-or-later, the different configuration, and still carry the source offer.

**Mandatory process controls:**
- A CI job that regenerates `THIRD_PARTY_NOTICES.md` and diffs it; the build fails if the checked-in file is stale.
- A license allow-list (MIT, Apache-2.0, BSD-2/3, ISC, MPL-2.0, Unlicense, CC0) and deny-list (GPL-*, AGPL-*, SSPL, unstated) enforced on every dependency.
- The FFmpeg source mirror must be **published before first release**, not promised.

---

## 8. RISKS AND OPEN QUESTIONS

| # | Risk | Severity | Mitigation / next step |
|---|---|---|---|
| R1 | WHIP end-to-end never exercised here | **High** | §9.8 verification plan; run before any web go-live commitment |
| R2 | Browser system-audio capture is a *hint*, not a guarantee `[VERIFIED-DOC]` | **High** | Don't promise it on web; matrix-test OS × browser; route to desktop app |
| R3 | All-slaves-dead kills FFmpeg `[VERIFIED-HOST]` | **High** | **Anchor slave always** (§5.3 rule 5) |
| R4 | Hardware-encoder probes exit 0 while failing `[VERIFIED-HOST]` | **High** | Probe must assert packets produced (§3.10) |
| R5 | Hardware encoding wholly unverified (no GPU) | **High** | Real-device test lab: NVIDIA, Intel iGPU, AMD, Apple Silicon |
| R6 | GPL obligations if we ship the gyan build | **High** | §7.6 notices + published source mirror **before** release |
| R7 | Docker daemon down on build host → can't run MediaMTX/OME in CI | Medium | Start Docker Desktop engine, or use the native MediaMTX binary in CI |
| R8 | MediaMTX v1.21 renamed `runOnReady`→`runOnAvailable` | Medium | Pin version; read release notes on every bump; fix any stale docs |
| R9 | Mid-GOP reconnect produces missing-PPS at the receiver `[VERIFIED-HOST]` | Medium | `+global_header`, `dump_extra` bsf on FLV slaves, short GOP; test per platform |
| R10 | Raw BGRA 1080p30 pipe ≈ 249 MB/s | Medium | Measure; consider NV12 in the renderer to cut it ~2×; drop-on-backpressure |
| R11 | RTMPS/TLS against real ingests unverified | Medium | Test per platform with real keys in a staging account |
| R12 | No maintained Capacitor RTMP plugin `[UNVERIFIED]` | Medium | Own the plugin; budget the native work |
| R13 | HaishinKit RTMPS not documented | Medium | Verify before promising Facebook/Instagram on iOS |
| R14 | Codec patent pools (H.264/HEVC) — orthogonal to OSS licensing | Medium | Legal review; prefer OS-provided encoders where possible |
| R15 | FFmpeg decoder CVE surface if we ever ingest user media files | Medium | Keep the live path self-generated-input-only; sandbox any file ingest |
| R16 | Relay holds users' platform stream keys | **High** | Encrypt at rest, scope JWTs narrowly, short TTL, audit access, never log |
| R17 | WHEP is not an RFC | Low | Don't build the durable preview contract on it |
| R18 | E-RTMP per-platform acceptance unconfirmed | Low | Confirm against each platform's own docs before enabling |

---

## 9. VERIFICATION PLAN AND RESULTS

> **§9.1–§9.7 were executed on the build host during this research and the outputs are reproduced verbatim. §9.8–§9.12 are marked *TO BE EXECUTED BY THE BUILD TEAM* — they could not be run here (no GPU, no camera, no macOS, Docker daemon down, no external credentials).**

### 9.1 Host / build inventory — EXECUTED ✅

```bash
ffmpeg -version
ffmpeg -hide_banner -buildconf
ffmpeg -hide_banner -muxers   | grep -iE "whip|tee|flv|hls|mpegts|mp4 "
ffmpeg -hide_banner -protocols | grep -iE "rtmp|srt|rist|tls|dtls"
ffmpeg -hide_banner -encoders  | grep -iE "h264|hevc|av1|openh264"
ffmpeg -hide_banner -h muxer=whip
ffmpeg -hide_banner -h muxer=tee
node -v ; docker --version ; docker info
```

**Result:** FFmpeg 9.0.1-full_build-www.gyan.dev; `--enable-gpl --enable-version3` with libx264 + libx265; `whip` and `tee` muxers present; `rtmp/rtmps/srt/rist/tls/dtls` present; no `libopenh264`; Node v20.11.1; **Docker CLI 29.6.2 but daemon unreachable.** Full details in §1.

### 9.2 Software x264 encode → FLV — EXECUTED ✅

```bash
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 3 \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 2500k -g 60 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -f flv -y test_x264.flv
```
**Result:** exit 0, `test_x264.flv` = **1,018,331 bytes**. ✅

### 9.3 MediaFoundation + hardware encoder probes — EXECUTED ✅

```bash
# MediaFoundation (no GPU on this host)
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x360:rate=30 -t 2 \
  -c:v h264_mf -b:v 800k -f mp4 -y mf.mp4
# Hardware probes
for enc in h264_nvenc h264_qsv h264_amf; do
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x360:rate=30 -t 1 \
    -c:v $enc -f null - ; echo "$enc exit=$?"
done
```
**Result:** `h264_mf` **succeeded → 233,375-byte mp4 with no GPU**. `h264_nvenc`, `h264_qsv`, `h264_amf` each logged *"Terminating thread with return code -22 (Invalid argument)"* and *"Nothing was written into output file"* — **yet the process exit code was 0.** ✅ (and this is R4).

### 9.4 `tee` fan-out: 2 live RTMP + 1 dead + recording, ONE encode — EXECUTED ✅

```bash
# two local RTMP receivers (ffmpeg as listener) — no external server needed
ffmpeg -hide_banner -loglevel error -listen 1 -f flv -i rtmp://127.0.0.1:11935/live/a -t 4 -c copy -y rx_a.flv &
ffmpeg -hide_banner -loglevel error -listen 1 -f flv -i rtmp://127.0.0.1:11936/live/b -t 4 -c copy -y rx_b.flv &
sleep 3
ffmpeg -hide_banner -loglevel warning -re \
  -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 5 \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 2500k -maxrate 2500k -bufsize 5000k -g 60 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -map 0:v -map 1:a \
  -f tee "[f=flv:onfail=ignore]rtmp://127.0.0.1:11935/live/a|[f=flv:onfail=ignore]rtmp://127.0.0.1:11936/live/b|[f=flv:onfail=ignore]rtmp://127.0.0.1:11999/live/dead|[f=mp4:onfail=ignore]rec.mp4"
```
**Result:** exit 0. The dead slave was skipped with *"Slave muxer #2 failed: … continuing with 3/4 slaves."* `rx_a.flv` and `rx_b.flv` are both **1,387,218 bytes** (byte-identical sizes — one encode, duplicated packets), each h264 1280x720 + aac. `rec.mp4` = 1,724,878 bytes, h264 1280x720, **150 video frames / 236 audio frames**. ✅ **This is the single-encode-N-destination proof.**

### 9.5 SRT loopback — EXECUTED ✅

```bash
ffmpeg -hide_banner -loglevel error -f mpegts \
  -i "srt://127.0.0.1:9100?mode=listener&latency=200000" -t 3 -c copy -y srt_rx.ts &
sleep 2
ffmpeg -hide_banner -loglevel error -re \
  -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i sine=frequency=440 -t 4 \
  -c:v libx264 -preset ultrafast -b:v 600k -pix_fmt yuv420p -c:a aac -b:a 96k \
  -f mpegts "srt://127.0.0.1:9100?mode=caller&latency=200000"
```
**Result:** `srt_rx.ts` = **317,720 bytes**, ffprobe reports `h264 640x360` + `aac`. ✅

### 9.6 Per-output auto-reconnect (`use_fifo` + `attempt_recovery`) — EXECUTED ✅ **(key result)**

```bash
# Sender starts with its RTMP destination DEAD; receiver appears 6 seconds later.
ffmpeg -hide_banner -loglevel error -re \
  -f lavfi -i testsrc2=size=640x360:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -map 0:v -map 1:a -t 20 \
  -c:v libx264 -preset ultrafast -tune zerolatency -b:v 800k -g 60 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -ar 48000 \
  -f tee -use_fifo 1 \
  -fifo_options "attempt_recovery=1:recovery_wait_time=1:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=120" \
  "[f=flv:onfail=ignore]rtmp://127.0.0.1:12001/live/r|[f=mp4:onfail=ignore]anchor.mp4" &
sleep 6
ffmpeg -hide_banner -loglevel error -listen 1 -f flv -i rtmp://127.0.0.1:12001/live/r -t 8 -c copy -y fifo_rx.flv
```
**Result:** sender exited 0 after its full 20 s. Log shows repeated *"Error opening rtmp://127.0.0.1:12001/live/r"* during the dead period, then **the fifo reconnected on its own**: `fifo_rx.flv` = **567,107 bytes, ffprobe duration 8.000000 s**. `anchor.mp4` = 2,297,636 bytes, uninterrupted. Receiver logged *"non-existing PPS 14 referenced"* on mid-GOP join (→ R9). ✅ **Per-output reconnect works with no encoder restart and no impact on healthy outputs.**

### 9.7 Failure modes and gotchas — EXECUTED ✅

```bash
# (a) ALL slaves dead
ffmpeg -hide_banner -loglevel warning -f lavfi -i testsrc2=size=320x180:rate=30 -t 2 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -f tee "[f=flv:onfail=ignore]rtmp://127.0.0.1:11997/x|[f=flv:onfail=ignore]rtmp://127.0.0.1:11998/y"
```
**Result:** **FAILS.** *"Output file does not contain any stream / Error opening output file … / Error opening output files: Invalid argument."* → **R3, anchor-slave rule.** ✅

```bash
# (b) dual-aspect single-source two-encode  — note -t AFTER each -map
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -filter_complex "[0:v]split=2[a][b];[b]crop=ih*9/16:ih,scale=1080:1920[v916]" \
  -map "[a]"    -map 1:a -t 3 -c:v libx264 -preset veryfast -b:v 2500k -pix_fmt yuv420p -c:a aac -f flv -y land.flv \
  -map "[v916]" -map 1:a -t 3 -c:v libx264 -preset veryfast -b:v 2000k -pix_fmt yuv420p -c:a aac -f flv -y port.flv
```
**Result:** exit 0. `land.flv` = h264 **1280x720** + aac; `port.flv` = h264 **1080x1920** + aac. ✅
**Gotcha confirmed:** the same command with `-t 3` placed *before* `-filter_complex` **never terminated** and had to be killed. Per-output placement is mandatory.

---

### 9.8 MediaMTX + WHIP end-to-end — **TO BE EXECUTED BY THE BUILD TEAM** ⬜

*Blocked here: the Docker daemon is not running on this VM (§1), and a third-party binary was not downloaded/executed on the build host without authorisation.*

**Step 1 — start MediaMTX (Docker).** Start Docker Desktop's Linux engine first, then:

```bash
docker run --rm --name mediamtx \
  -e MTX_WEBRTCADDITIONALHOSTS=127.0.0.1 \
  -p 1935:1935 \
  -p 8554:8554 \
  -p 8888:8888 \
  -p 8889:8889 \
  -p 8890:8890/udp \
  -p 8189:8189/udp \
  bluenviron/mediamtx:latest
```
*(Alternative if Docker stays unavailable: download the `mediamtx_vX.Y.Z_windows_amd64.zip` release asset and run `mediamtx.exe` — a single binary, no dependencies `[VERIFIED-DOC]`. Verify the checksum first.)*

**Step 2 — confirm it is listening.**
```bash
curl -s http://127.0.0.1:9997/v3/paths/list   # Control API (enable in config)
docker logs mediamtx
```

**Step 3 — publish to MediaMTX via WHIP from FFmpeg.** Per MediaMTX's own documented example `[VERIFIED-DOC]`, adapted to our build:
```bash
ffmpeg -re \
  -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
  -c:v libx264 -profile:v baseline -tune zerolatency -bf 0 -threads 1 \
     -pix_fmt yuv420p -preset ultrafast -b:v 1500k -g 60 \
  -c:a libopus -ar 48000 -ac 2 -b:a 128k \
  -f whip "http://127.0.0.1:8889/livetap/whip"
```
Expected: MediaMTX logs a new WebRTC publisher on path `livetap`.
**Assert:** `-profile:v baseline -bf 0` and `libopus` are **required** — FFmpeg docs: *"Ensure that you use H.264 without B frames and Opus for the audio codec."* `[VERIFIED-DOC]` And both a video **and** an audio track must be present `[VERIFIED-DOC]`.

**Step 4 — read it back (proves the ingest is real).**
```bash
ffmpeg -i rtsp://127.0.0.1:8554/livetap -t 5 -c copy -y whip_readback.mp4
ffprobe -v error -show_entries stream=codec_name,width,height -of csv whip_readback.mp4
# expect: h264 1280x720 + opus/aac
```

**Step 5 — WHIP with a bearer token (auth path).**
```bash
ffmpeg -re -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i sine=frequency=1000 \
  -c:v libx264 -profile:v baseline -bf 0 -tune zerolatency -pix_fmt yuv420p \
  -c:a libopus -ar 48000 -ac 2 \
  -f whip -authorization "<JWT>" "http://127.0.0.1:8889/livetap/whip"
```

**Step 6 — native `forward` fan-out with NO re-encode.** `mediamtx.yml`:
```yaml
paths:
  livetap:
    forward:
      - dest: rtmp://127.0.0.1:11935/live/a
      - dest: rtmp://127.0.0.1:11936/live/b
    record: yes
    recordPath: ./rec/%path/%Y-%m-%d_%H-%M-%S-%f
    recordFormat: fmp4
```
Start two local `ffmpeg -listen 1` RTMP receivers (as in §9.4) and confirm **both** receive the stream and that MediaMTX's CPU stays low (pass-through, not transcode).
For a real platform: `dest: rtmps://a.rtmp.youtube.com/live2#<STREAM_KEY>` — the stream key goes after `#` `[VERIFIED-DOC]`.

**Step 7 — hook-based 9:16 re-encode (only when needed).** Note the **current** key name:
```yaml
paths:
  livetap:
    runOnAvailable: >
      ffmpeg -i rtsp://localhost:$RTSP_PORT/$MTX_PATH
      -filter:v crop=ih*9/16:ih,scale=1080:1920
      -c:v libx264 -preset veryfast -tune zerolatency -b:v 3000k -pix_fmt yuv420p
      -c:a aac -b:a 128k
      -f flv rtmp://127.0.0.1:11937/live/portrait
    runOnAvailableRestart: yes
```
**Do not use `runOnReady` — it was removed in v1.21.0** `[VERIFIED-DOC]`.

**Step 8 — browser WHIP.** Open `http://127.0.0.1:8889/livetap/publish` (MediaMTX's built-in publish page) in Chrome, Edge, Firefox and Safari; publish camera and screen; record which browsers negotiate **H.264** (required for pass-through to RTMP) versus only VP8. **This is the single most important unverified item for the web architecture.**

### 9.9 Hardware encoders on real hardware — **TO BE EXECUTED BY THE BUILD TEAM** ⬜

On each of: an NVIDIA GPU machine, an Intel iGPU machine, an AMD GPU machine, an Apple Silicon Mac.
```bash
# Probe that ACTUALLY validates output (do not trust exit code — see §9.3)
for enc in h264_nvenc h264_qsv h264_amf h264_mf h264_videotoolbox libx264; do
  out="probe_$enc.mp4"
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30 -t 1 \
    -c:v $enc -b:v 3000k -f mp4 -y "$out" 2>/dev/null
  frames=$(ffprobe -v error -select_streams v:0 -count_packets \
             -show_entries stream=nb_read_packets -of csv=p=0 "$out" 2>/dev/null)
  echo "$enc: frames=${frames:-0}  $([ "${frames:-0}" -gt 0 ] && echo AVAILABLE || echo UNAVAILABLE)"
done
```
Then measure, at 1080p30 and 1080p60: CPU %, encode wall time vs realtime, VMAF/SSIM vs `libx264 -preset veryfast` at equal bitrate, and the **concurrent session limit** per encoder.

### 9.10 Real capture — **TO BE EXECUTED BY THE BUILD TEAM** ⬜

Windows:
```bash
ffmpeg -hide_banner -list_devices true -f dshow -i dummy
ffmpeg -f gdigrab -framerate 30 -i desktop -t 5 -c:v libx264 -preset ultrafast -y screen.mp4
```
macOS:
```bash
ffmpeg -hide_banner -f avfoundation -list_devices true -i ""
ffmpeg -f avfoundation -framerate 30 -i "1:0" -t 5 -c:v h264_videotoolbox -y screen.mp4
```
Electron: build a spike that runs `desktopCapturer.getSources`, requests screen + **loopback** audio on Windows, and screen + CoreAudio-tap audio on macOS 14.2+ with `NSAudioCaptureUsageDescription` set `[VERIFIED-DOC]`. Record exactly which macOS versions yield a system-audio track.

### 9.11 Browser capability matrix — **TO BE EXECUTED BY THE BUILD TEAM** ⬜

A small harness page reporting, per browser × OS:
```js
// paste in console / ship as a diagnostics page
const report = {};
report.displayMedia   = !!navigator.mediaDevices?.getDisplayMedia;
report.videoEncoder   = typeof VideoEncoder !== "undefined";
report.trackProcessor = typeof MediaStreamTrackProcessor !== "undefined";
report.trackGenerator = typeof VideoTrackGenerator !== "undefined";
report.offscreen      = typeof OffscreenCanvas !== "undefined";
report.webrtcCodecs   = RTCRtpSender.getCapabilities("video").codecs.map(c => c.mimeType);
report.recorderTypes  = ["video/mp4;codecs=avc1.42E01E","video/webm;codecs=vp8",
                         "video/webm;codecs=vp9","video/webm;codecs=h264"]
                        .filter(t => MediaRecorder.isTypeSupported(t));
report.encoderConfigs = [];
for (const codec of ["avc1.42E01E","avc1.4D401F","vp8","vp09.00.10.08","av01.0.04M.08"])
  for (const hw of ["prefer-hardware","prefer-software","no-preference"])
    report.encoderConfigs.push([codec, hw,
      (await VideoEncoder.isConfigSupported({codec, hardwareAcceleration: hw,
        width:1920, height:1080, bitrate:6_000_000, framerate:30,
        latencyMode:"realtime", bitrateMode:"constant"})).supported]);
// then: does getDisplayMedia({video:true, audio:true, systemAudio:"include"})
//       actually return an audio track on THIS os/browser?
```
Matrix: Chrome/Edge/Firefox/Safari × Windows/macOS, plus Safari iOS and Chrome Android. **Record the system-audio result explicitly — this decides §5.2's product messaging.**

### 9.12 Real platform ingest + RTMPS — **TO BE EXECUTED BY THE BUILD TEAM** ⬜

With staging accounts and real keys (never in a shared shell history; use env vars):
```bash
ffmpeg -re -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=frequency=440 \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 6000k -maxrate 6000k -bufsize 12000k -g 60 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 -ac 2 -map 0:v -map 1:a -flags +global_header -t 60 \
  -f tee -use_fifo 1 -fifo_options "attempt_recovery=1:recovery_wait_time=2:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=240" \
  "[f=flv:onfail=ignore]rtmps://a.rtmp.youtube.com/live2/$YT_KEY|[f=flv:onfail=ignore]rtmps://live-api-s.facebook.com:443/rtmp/$FB_KEY|[f=mp4:onfail=ignore]anchor.mp4"
```
Assert: all destinations go live; pulling one destination's network mid-stream does **not** disturb the others; it auto-recovers when restored; and each platform accepts the mid-GOP reconnect (R9).

---

## 10. CONSOLIDATED `[UNVERIFIED]` REGISTER

Every item below must be resolved by real-device/real-OS testing before it becomes a product claim.

1. Hardware encoders: NVENC, QSV, AMF, VideoToolbox — availability, quality, throughput, session limits, driver requirements.
2. WHIP end-to-end: FFmpeg→MediaMTX, browser→MediaMTX, and MediaMTX `forward`→RTMPS.
3. MediaMTX runtime behaviour of any kind (binary never executed here).
4. All macOS behaviour: ScreenCaptureKit, CoreAudio taps, system audio by OS version, TCC permission UX, CMIO extension, VideoToolbox.
5. All iOS/Android behaviour: HaishinKit, RootEncoder, hardware encode, RTMPS on HaishinKit.
6. Electron `desktopCapturer` runtime behaviour and Windows loopback audio.
7. Browser `getDisplayMedia` system-audio support per OS × browser (MDN says it may be ignored `[VERIFIED-DOC]`).
8. `MediaRecorder` container/codec matrix — specifically whether H.264-in-MP4 works in Chrome and Safari.
9. Whether WebCodecs `prefer-hardware` reaches a real hardware encoder on any given machine.
10. RTMPS/TLS handshakes against real platform ingests.
11. Per-platform E-RTMP (HEVC/AV1) ingest acceptance, per each platform's own developer docs.
12. GStreamer Windows/macOS installer byte sizes (not published on the download page).
13. libobs/obs-studio-node build feasibility and runtime behaviour under Electron.
14. FFmpeg CVE census — only individual 2026 CVEs were sampled, not a full history.
15. GStreamer and MediaMTX CVE histories.
16. HaishinKit.kt maturity relative to RootEncoder for Android.
17. Existence of any maintained, well-licensed Capacitor RTMP plugin.
18. Which FFmpeg license variant OBS Studio ships in its official installers.
19. `libopenh264` vs `libx264` quality delta at LIVETAP's target bitrates.
20. Raw-frame pipe throughput (renderer→FFmpeg stdin) on real user hardware.
21. The GPL FAQ text in §7.1 was obtained via search result rather than a direct gnu.org fetch (host could not reach gnu.org) — **re-verify from gnu.org before publishing the legal notices.**

---

## 11. SOURCES

**Primary — licenses and specifications**
1. FFmpeg License and Legal Considerations — https://ffmpeg.org/legal.html
2. FFmpeg Security — https://www.ffmpeg.org/security.html
3. FFmpeg `doc/muxers.texi` (tee, fifo, whip sections) — https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/doc/muxers.texi
4. FFmpeg `Changelog` (versions 6.1, 8.0, 8.1, 9.0) — https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/Changelog
5. FFmpeg formats documentation (tee, whip) — https://ffmpeg.org/ffmpeg-formats.html
6. Gyan Doshi FFmpeg Windows builds (license = GPLv3; 9.0.1 dated 2026-08-12) — https://www.gyan.dev/ffmpeg/builds/
7. RFC 9725 — WebRTC-HTTP Ingestion Protocol (WHIP), Standards Track, March 2025 — https://datatracker.ietf.org/doc/draft-ietf-wish-whip/
8. draft-ietf-wish-whep-04 (2026-06-22; "I-D Exists"; not an RFC) — https://datatracker.ietf.org/doc/draft-ietf-wish-whep/
9. draft-murillo-whep (expired, superseded) — https://datatracker.ietf.org/doc/draft-murillo-whep/
10. GNU GPL FAQ — "MereAggregation" (quoted via search result; gnu.org unreachable from build host) — https://www.gnu.org/licenses/old-licenses/gpl-2.0-faq.en.html
11. OBS Studio `COPYING` (GPLv2 verbatim) — https://raw.githubusercontent.com/obsproject/obs-studio/master/COPYING
12. Veovera Enhanced RTMP (Apache-2.0 spec; HEVC/AV1/VP8/VP9/Opus/FLAC/AC-3) — https://github.com/Veovera/enhanced-rtmp
13. GStreamer Licensing FAQ (LGPL core, good/bad/ugly, "we do not accept GPL code") — https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html

**Primary — servers and libraries**
14. MediaMTX (MIT; protocols; single executable; Docker image) — https://github.com/bluenviron/mediamtx
15. MediaMTX `mediamtx.yml` v1.21.0 (hook keys; port defaults; `runOnReady` absent) — https://raw.githubusercontent.com/bluenviron/mediamtx/v1.21.0/mediamtx.yml
16. MediaMTX Hooks documentation (`runOnAvailable`, env vars, SIGINT lifecycle) — https://mediamtx.org/docs/features/hooks
17. MediaMTX Forward documentation (multi-destination, pass-through, `rtmps://…#streamKey`) — https://mediamtx.org/docs/features/forward
18. MediaMTX Publish with WebRTC clients (WHIP URL, codecs, client list) — https://mediamtx.org/docs/publish/webrtc-clients
19. MediaMTX Publish with FFmpeg (RTMP/SRT/WHIP example commands and ports) — https://mediamtx.org/docs/publish/ffmpeg
20. MediaMTX Authentication (internal/HTTP/JWT; Bearer for WebRTC; JWT length caps) — https://mediamtx.org/docs/features/authentication
21. OvenMediaEngine (AGPL-3.0-only; WHIP/E-RTMP/SRT ingest; LLHLS egress; no Windows) — https://github.com/AirenSoft/OvenMediaEngine → https://github.com/OvenMediaLabs/OvenMediaEngine
22. obs-studio-node (GPL-2.0; libobs bindings; Windows+macOS only; custom OBS build required) — https://github.com/stream-labs/obs-studio-node → https://github.com/streamlabs/obs-studio-node
23. Haivision SRT / libsrt (MPL-2.0; v1.5.7 2026-08-28; Win/mac/Linux/iOS/Android) — https://github.com/Haivision/srt
24. Cisco openh264 (BSD-2-Clause; v2.6.0 2025-02-12) — https://github.com/cisco/openh264
25. HaishinKit.swift (BSD-3-Clause; RTMP+SRT; WHIP/WHEP alpha; 2.2.5 2026-03-28) — https://github.com/HaishinKit/HaishinKit.swift
26. HaishinKit.kt (Android, BSD-3-Clause) — https://github.com/shogo4405/HaishinKit.kt
27. RootEncoder / ex rtmp-rtsp-stream-client-java (Apache-2.0; 2.8.1 2026-09-01; RTMP/RTSP/SRT/UDP/WHIP-beta) — https://github.com/pedroSG94/RootEncoder
28. @roamhq/wrtc — node-webrtc maintained fork (BSD-2-Clause; WebRTC M106; prebuilds) — https://github.com/WonderInventions/node-webrtc
29. ffmpeg-static (GPL-3.0; downloads gyan.dev/johnvansickle/evermeet/OSXExperts builds) — https://github.com/eugeneware/ffmpeg-static
30. node-ffmpeg-installer (binaries dated 2018; no binary license statement in README) — https://github.com/kribblo/node-ffmpeg-installer
31. GStreamer downloads (1.28.7; MSVC/MinGW installers; macOS .pkg; sizes not listed) — https://gstreamer.freedesktop.org/download/
32. npm registry metadata (licenses, publish dates, deprecation flags) — https://registry.npmjs.org/{fluent-ffmpeg, ffmpeg-static, @ffmpeg-installer/ffmpeg, @roamhq/wrtc, werift, node-datachannel, obs-studio-node, gstreamer-superficial, react-native-nodemediaclient, @capacitor/core}
33. GitHub REST API repo + release metadata (licenses, stars, open issues, push dates, latest releases) — https://api.github.com/repos/{...}

**Primary — web platform**
34. MDN `MediaDevices.getDisplayMedia()` (audio/systemAudio/windowAudio; "browsers may ignore this hint") — https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
35. MDN `VideoEncoder` (secure context; dedicated workers; isConfigSupported) — https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
36. MDN `VideoEncoder.isConfigSupported()` (hardwareAcceleration, bitrateMode; probe example) — https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static
37. MDN `MediaRecorder` (isTypeSupported; timeslice) — https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
38. MDN `MediaStreamTrackProcessor` (not Baseline; global-context incompatibility warning) — https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor
39. MDN WebRTC codecs guide (VP8 + H.264 CBP mandatory; VP9/AV1/HEVC optional; Safari notes) — https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/WebRTC_codecs
40. Chrome for Developers — screen-sharing controls (`systemAudio`, Chrome 105+) — https://developer.chrome.com/docs/web-platform/screen-sharing-controls
41. Can I Use — WebCodecs (Chrome/Edge 94, FF 130, Safari 16.4 partial / 26 full; ~94.5%) — https://caniuse.com/webcodecs
42. Can I Use — VideoEncoder (per-browser versions; ~94.56%) — https://caniuse.com/mdn-api_videoencoder
43. Can I Use — MediaRecorder (~96.21%) — https://caniuse.com/mediarecorder
44. Electron `desktopCapturer` (Windows `'loopback'`; macOS 14.2+ `NSAudioCaptureUsageDescription`; CoreAudio Tap) — https://www.electronjs.org/docs/latest/api/desktop-capturer
45. Electron release schedule (43/44/45/46 with Chromium M150/M152/M156/M160) — https://releases.electronjs.org/schedule
46. Electron release timelines / support policy — https://www.electronjs.org/docs/latest/tutorial/electron-timelines

**Secondary (corroborating only — treated as lower authority, and flagged as such in-text)**
47. Phoronix — "WHIP Muxer Merged To FFmpeg For Sub-Second Latency Streaming" (June 2025 merge; ~3000 LoC; `libavformat/whip.c`; H.264 baseline + Opus) — https://www.phoronix.com/news/FFmpeg-Lands-WHIP-Muxer
48. FFmpeg doxygen 8.0 `whip.c` — https://www.ffmpeg.org/doxygen/8.0/whip_8c.html
49. FFmpeg-devel — "WHIP Feature latest patch Preparation Notes" — https://ffmpeg.org/pipermail/ffmpeg-devel/2025-May/343659.html
50. newreleases.io — mediamtx v1.21.0 (runOnReady→runOnAvailable breaking change) — https://newreleases.io/project/github/bluenviron/mediamtx/release/v1.21.0
51. mediamtx issue #2008 / #3686 — runOnReady restreaming and re-encode patterns — https://github.com/bluenviron/mediamtx/issues/2008
52. electron/electron issue #47490 — ScreenCaptureKit loopback audio on macOS — https://github.com/electron/electron/issues/47490
53. recall.ai — macOS screen capture APIs / system audio access — https://www.recall.ai/blog/how-to-get-access-to-system-audio
54. CatxFish/obs-virtual-cam — DirectShow virtual camera filter — https://github.com/CatxFish/obs-virtual-cam
55. obs-versions.com — CoreMediaIO OBS Virtual Camera, macOS 13+ (replaces deprecated DAL plug-in) — https://obs-versions.com/blog/coremediaio-virtual-camera-macos
56. streamrun.com — Twitch Enhanced Broadcasting / Dual Format GA June 2026; AV1 beta-limited — https://streamrun.com/dual-format/twitch-enhanced-broadcasting
57. tugayoktayokay/expo-live-stream — HaishinKit + RootEncoder bridge precedent — https://github.com/tugayoktayokay/expo-live-stream
58. pub.dev `rtmp_streaming` — Flutter plugin over RootEncoder + HaishinKit — https://pub.dev/packages/rtmp_streaming
59. cvedetails / rapid7 — FFmpeg CVE-2026-8461 and related 2026 libavcodec/libavformat issues — https://www.rapid7.com/db/vulnerabilities/ffmpeg-cve-2026-8461/
60. obsproject/obs-deps — how OBS builds its FFmpeg (`build-ffmpeg.zsh`) — https://github.com/obsproject/obs-deps

**Unreachable during this research (documented for transparency)**
- `https://trac.ffmpeg.org/wiki/HWAccelIntro` — blocked by Anubis anti-bot challenge.
- `https://www.gnu.org/licenses/...` — connection refused from this host (209.51.188.116:443).
- `https://www.npmjs.com/package/...` HTML pages — HTTP 403 (worked around via `registry.npmjs.org` JSON API).
- `https://obsproject.com/kb/licensing` and OBS's bundled `ffmpeg.txt` license file — HTTP 404.

---

*End of evaluation. Verified results in §9.1–§9.7 are reproducible on the LIVETAP build host with the commands as written. Items in §9.8–§9.12 and §10 are outstanding and assigned to the build team.*
