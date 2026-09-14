# Desktop Media Engine — Verification Record

Every claim in this file was produced by running the code on the build host. Commands are the exact
ones executed; output is trimmed but not edited. Anything that could not be exercised here is
labelled **EXTERNALLY BLOCKED** or **UNVERIFIED** rather than assumed.

## Host

```
$ ffmpeg -hide_banner -version | head -1
ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers

platform   win32 (Windows Server 2022, 10.0.20348)
cpu        AMD EPYC-Rome Processor, 4 vCPU
memory     12 GB
gpu        none
node       v20.11.1
electron   38.8.6 (Chromium 140.0.7339.249)
```

## Summary

| # | Check | Verdict |
|---|---|---|
| a | A real RTMP server | **CORRECTED 2026-09-14: PASS.** Docker was blocked; MediaMTX itself never was. A native Windows binary is present and has since accepted a real LIVETAP broadcast |
| b1 | Hardware encoder probe (real 1-second encodes) | **PASS** |
| b2 | One encode fanned out to 2 RTMP destinations + recording | **PASS** |
| b3 | Encoder CPU at 1080p30 libx264 veryfast, 30 s | **PASS** (66.6 % of one core) |
| b4 | Killing sender B leaves A and the recording untouched | **PASS** |
| b5 | Remove and re-add destination B while live | **PASS** (encoder PID unchanged) |
| b6 | Recording file plays (ffprobe) | **PASS** (88.9 s, H.264 + AAC) |
| b7 | What destination A actually received | **PASS** (50.2 MB, H.264 High 1920×1080 + AAC LC) |
| c | SRT loopback publish | **PASS** (5.2 MB captured) |
| d | tee muxer escaping, global `fifo_options`, anchor-slave rule | **PASS** (two documented FFmpeg traps) |
| e | Renderer codec capability (Electron 38.8.6) | **PASS** |
| f | CSP enforced by Chromium | **PASS** |
| g | Windows packaging (unsigned) | **PASS** |
| h | Packaged app launches | **PASS** |
| — | Real camera / microphone capture | **UNVERIFIED** — no camera on this host |
| — | GPU encoders (nvenc / qsv / amf) | **UNAVAILABLE** — compiled in, none functional |
| — | Real platform ingest (YouTube/Twitch/…) | **UNVERIFIED** — no credentials on this host |

---

## (a) A real RTMP server

> **Corrected 2026-09-14.** This section used to conclude that MediaMTX was
> EXTERNALLY BLOCKED. That conclusion was wrong, and the mistake is worth
> naming because it cost this project a substitute it did not need: what was
> blocked was **Docker**, and MediaMTX was only ever reached for through
> Docker. MediaMTX ships a **native Windows binary**. It now lives at
> `tools/mediamtx/mediamtx.exe` (v1.21.0), it is what
> `infra/dev-harness/ingest/` drives, and on 2026-09-14 at 12:43 it accepted
> two simultaneous real RTMP publishers from the built LIVETAP desktop app at
> 1920x1080 and 1080x1920 and recorded both to disk. See
> `docs/qa/REAL_WORLD_ALPHA_READINESS.md`.
>
> The original Docker transcript is kept below unedited, because the Docker
> finding itself was correct and is still recorded as BLOCKERS.md B-008 for the
> relay's container packaging. Only the conclusion drawn from it was too broad.
>
> **One thing this correction does not fix, and it is a handoff.**
> `apps/desktop/scripts/verify-engine.ts` still publishes into per-destination
> `ffmpeg -listen 1` servers, with the port-1936 workaround the caveat below
> describes. That file belongs to the desktop workstream. Pointing it at
> MediaMTX would remove the workaround entirely, because one server accepts
> every destination on its own path and accepts a reconnect on the same path.

### The original Docker attempt, unedited

```
$ docker run --rm -d --name livetap-mtx -p 1935:1935 -p 8889:8889 -p 8890:8890/udp -p 9997:9997 bluenviron/mediamtx:latest
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path
is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot
find the file specified.
```

Diagnosis, after starting the backend service and Docker Desktop itself and polling for 400 s:

```
$ Get-Service com.docker.service      → Running          (started for this attempt)
$ docker context ls                   → desktop-linux *  npipe:////./pipe/dockerDesktopLinuxEngine
$ wsl -l -v
Windows Subsystem for Linux has no installed distributions.
```

Docker Desktop is installed and its Windows service runs, but its **Linux engine needs a WSL2
distribution and none is installed**, so no Linux container (MediaMTX is Linux-only) can start on
this host. Installing a WSL distribution is a machine-level change outside this task's remit.

Nothing was stopped at the end because nothing was ever started; `docker rm -f livetap-mtx` is a
no-op here. On a host with a working Linux engine the container command above is correct and the
MediaMTX API check would be `curl http://127.0.0.1:9997/v3/paths/list`.

The Docker Windows service and Docker Desktop were started only for this attempt and have been
returned to the state they were found in (service `Stopped`, Desktop not running).

### Fallback used

Per-destination `ffmpeg -listen 1` RTMP servers, one per port, each capturing what it receives to a
file. This is arguably **stronger** evidence than the MediaMTX API: instead of a server reporting
"a path is receiving", each destination's bytes are captured and then probed with `ffprobe`, so the
codec, resolution and duration each destination actually got are on the record.

```
ffmpeg -hide_banner -loglevel error -listen 1 -f flv -i rtmp://127.0.0.1:1935/live/a \
       -map 0 -c copy -f mpegts -y recv-a.ts        # destination A
ffmpeg -hide_banner -loglevel error -listen 1 -f flv -i rtmp://127.0.0.1:1936/live/b \
       -map 0 -c copy -f mpegts -y recv-b.ts        # destination B
```

One caveat, recorded honestly: `-listen 1` accepts exactly **one** publisher and exits, so the
re-add test (b5) needed a fresh listener on port 1936. MediaMTX would have accepted the reconnect on
the same path. This is a limitation of the substitute, not of the engine — and, as the correction
above records, a substitute that was never necessary.

---

## (b) Engine verification

```
$ npx tsup --config apps/desktop/tsup.verify.config.ts
$ node apps/desktop/dist/verify/verify-engine.cjs
...
9/9 steps passed
```

`scripts/verify-engine.ts` drives the real `FfmpegEngine` with real child processes. The only
substitution is the source: `source: { kind: 'lavfi' }` synthesises `testsrc2 + sine` at
1920×1080@30 instead of the renderer's canvas, paced to wall clock with `-re`. Everything
downstream — the encoder, the fan-out, the senders, the recorder — is the shipping code path.

### b1 — Hardware encoder probe: PASS

Each candidate actually encodes one second of `testsrc2` to `-f null -`; only exit code 0 counts.

```
h264_nvenc = UNAVAILABLE   [h264_nvenc @ …] Cannot load nvcuda.dll
h264_qsv   = UNAVAILABLE   [h264_qsv   @ …] Error creating a MFX session: -9.
h264_amf   = UNAVAILABLE   [AMF        @ …] DLL amfrt64.dll failed to open
libx264    = PASS          (232 ms)
recommended = libx264
```

All three GPU encoders are **compiled into this FFmpeg build** and all three fail to open. This is
exactly the case the probe exists for: `ffmpeg -encoders` would have listed them as available.
`EngineCapabilities.hardwareEncoders` is `[]`.

### b2 — Single encode, two RTMP destinations + recording: PASS

```
after 10 s: recv-a = 2,097,152 B   recv-b = 2,097,152 B   recording = 4,718,620 B
encoder processes = 1        sender processes = 2
encoder pids = [7108]        sender pids = [15868, 2868]
metrics: { encodedKbps: 5090.2, targetKbps: 4660, encoderDroppedPct: 0,
           networkDroppedPct: 0, renderFps: 29.48, targetFps: 30 }
```

**One** encoder process feeding **two** RTMP destinations and a recording, all from a single encode.
Both destinations received byte-identical volumes. Encoder frame drops: 0.

Encoder argv as spawned (note `-progress pipe:2`, because stdout carries the MPEG-TS):

```
-hide_banner -nostdin -loglevel error -stats_period 1 -progress pipe:2
-re -f lavfi -i testsrc2=size=1920x1080:rate=30
-re -f lavfi -i sine=frequency=440:sample_rate=48000
-map 0:v:0 -map 1:a:0
-c:v libx264 -pix_fmt yuv420p -preset veryfast -profile:v high
-b:v 4500k -maxrate 4500k -minrate 4500k -bufsize 9000k -x264-params nal-hrd=cbr:scenecut=0
-g 60 -keyint_min 60 -c:a aac -b:a 160k -ar 48000 -ac 2
-f mpegts -mpegts_flags +resend_headers -pat_period 0.1 -muxdelay 0 -muxpreload 0 -flush_packets 1 pipe:1
```

Sender argv (identical shape per destination, `-c copy`, no re-encode):

```
-hide_banner -nostdin -loglevel error -stats_period 1 -progress pipe:2
-fflags +nobuffer -f mpegts -i pipe:0 -map 0:v:0 -map 0:a:0? -c copy
-f flv -flvflags no_duration_filesize rtmp://127.0.0.1:1935/live/a
```

Stream keys never appear in logs — `redactIngest` renders them as `••••ey-a`.

### b3 — Encoder CPU, 1080p30 libx264 veryfast, 30 s: PASS

Six samples at 5-second intervals of the encoder pid, one core = 100 %:

```
samples:  83.5  84.7  56.3  61.7  54.7  58.6
encoder:  66.6 % of one core   (16.6 % of a 4-vCPU machine)
sender:    5.8 % of one core each
metrics at sample time: encodedKbps 4927.2 / targetKbps 4660, renderFps 29.91 / 30, drops 0
```

The product claim this supports: each **additional destination** costs ~5.8 % of a core, not another
encode. On the shipping Option A′ path the encoder only remuxes, so 66.6 % is the worst case
(the software-transcode fallback), not the normal cost.

### b4 — Isolation: PASS

Destination B's sender was **SIGKILLed** — an abrupt, unclean death, which is the case that matters:

```
killed pid 2868
recv-a grew      3,670,016 B in the following 6 s
recording grew   3,407,872 B in the following 6 s
event: {"type":"outputLost","destinationId":"dest-b","code":"INGEST_DISCONNECTED","technical":"write EPIPE"}
remaining senders: ["dest-a"]        encoders still running: 1
```

Destination A and the recording kept growing throughout. The failure was classified through
`classifyFailure` into `INGEST_DISCONNECTED`, which is what `packages/core` needs in order to apply
its reconnect backoff. The engine reports; it does not retry.

### b5 — Remove and re-add while live: PASS

```
addOutput ok = true
re-added destination received  1,310,720 B in 8 s
destination A kept growing     4,718,592 B over the same 8 s
encoder pid before = 7108      encoder pid after = 7108      (unchanged)
outputUp events: dest-a, dest-b, dest-b
```

**The encoder PID is identical before and after.** This is the entire justification for the
encoder + senders topology over the `tee` muxer: re-adding a destination cost one new `-c copy`
process and nothing else moved. The re-added sender joined the MPEG-TS mid-stream and locked on via
the 100 ms PAT/PMT period.

### b6 — Recording file: PASS

```
$ ffprobe -v error -show_entries stream=codec_name,codec_type,profile,width,height \
          -show_entries format=format_name,duration,size,bit_rate -of json LIVETAP-….mp4

streams: h264 / video / High / 1920x1080
         aac  / audio / 48000 Hz / 2 ch
format:  mov,mp4,m4a,3gp,3g2,mj2   duration 88.900000 s   size 52,271,080 B   bit_rate 4,703,809
```

Recorded by copying the program stream — no second encode.

### b7 — What destination A actually received: PASS

```
$ ffprobe -v error … recv-a.ts
streams: h264 / video / High / 1920x1080
         aac  / audio / LC / 48000 Hz / 2 ch
format:  mpegts   duration 83.844333 s   size 50,280,036 B   bit_rate 4,797,465
```

Proof that the bytes leaving over RTMP are the intended H.264 + AAC at the intended resolution.

---

## Two real bugs found by this harness

Both were found by running the engine, not by reading it, and both are now fixed and regression-tested.

### 1. A dying destination could take down the whole app

The mp4 recorder rejected a packet and its stdin closed. `TsFanout` tore the sink down and removed
its `error` listener — and the socket then emitted a **trailing asynchronous `EPIPE` with no
listener attached**, which Node turns into an unhandled `'error'` event:

```
engine WARN recorder sink failed {"technical":"write EPIPE"}
node:events:496
      throw er; // Unhandled 'error' event
Error: write EPIPE
    at TsFanout.writeToSink (…/fanout.ts)
```

One failing output killed the entire main process — the exact failure the fan-out exists to prevent.
Fix: the `error` listener is now attached for the life of the stream and **never** detached;
`removeSink`, `end()` and `killSink` only detach `close`. Regression test:
*"does not crash when a dead sink emits EPIPE after we stopped caring"*.

### 2. Recording died 0.1 s in, silently

```
[vost#0:0/copy @ …] Error submitting a packet to the muxer: Operation not permitted
[out#0/mp4 @ …] Error muxing a packet
```

Two causes, found by bisecting the muxer options against a captured MPEG-TS sample:

- `-map 0` on an MPEG-TS input also maps the data/EPG streams, which MP4 and FLV reject with EPERM.
  Fixed: every sink now maps `-map 0:v:0 -map 0:a:0?` explicitly.
- MPEG-TS carries AAC as **ADTS**; MP4 needs an **AudioSpecificConfig**. FFmpeg inserts
  `aac_adtstoasc` automatically for a plain MP4, but **not** when the moov is written up front for
  `frag_keyframe+empty_moov` — it fails with EPERM instead. Four variants were tested:

| Variant | Result |
|---|---|
| `-movflags +frag_keyframe+empty_moov+default_base_moof` | **FAIL** — 19,173 B, EPERM |
| `-movflags +frag_keyframe+empty_moov` | **FAIL** — 19,189 B, EPERM |
| no movflags (plain mp4) | PASS — 992,795 B |
| `-bsf:a aac_adtstoasc` + `+frag_keyframe+empty_moov+default_base_moof` | **PASS** — 990,468 B |

The last variant ships, because fragmented MP4 survives a crash. Confirmed: truncating that file to
300,000 bytes (simulating a hard kill) still probes as a playable 2.008 s MP4, where a plain MP4
would have lost its moov and been unreadable.

---

## (c) SRT loopback — PASS

```
receiver: ffmpeg -f mpegts -i "srt://127.0.0.1:8890?mode=listener&latency=200000" -map 0 -c copy -f mpegts -y recv-srt.ts
sender:   addOutput({ protocol: 'srt', url: 'srt://127.0.0.1:8890', streamId: 'publish:live/srt' })
          → -f mpegts srt://127.0.0.1:8890?streamid=publish%3Alive%2Fsrt

addOutput ok = true   outputUp = yes   captured = 5,242,880 B
ffprobe: h264 / High / 1920x1080 + aac / LC / 48000 Hz, mpegts, 9.59 s, 4,371,495 bps
```

The `streamid=publish:live/srt` form in the brief is MediaMTX's publish convention; FFmpeg's own SRT
listener accepts and ignores it, so the parameter round-trips correctly but its *authorisation*
effect is **UNVERIFIED**: MediaMTX is available on this host now, and its SRT listener has not been
turned on or driven.

A measurement caveat worth recording: an initial run read **0 bytes** and looked like a failure. The
receiving FFmpeg must probe a stream it joined mid-flight before it writes its first output byte, so
measuring while it is still running proves nothing. The harness now stops the sender, lets the
receiver flush and exit, and then measures.

### SRT URL composition bug found here

The first SRT attempt was refused by our own argv builder:

```
outputLost dest-srt CONFIG_INVALID  'SRT URL contains a character that is not allowed. illegal character "?" at index 20'
```

`assertCleanToken` refuses `?`, which is correct for a bare token and wrong for a URL — SRT carries
`streamid` and `passphrase` as query parameters. Fixed by adding `assertCleanUrl`, which checks the
base with the strict rules and separately requires the query to be well-formed `key=value` pairs
from a conservative charset. Shell metacharacters are still refused in both halves.

---

## (d) tee muxer — PASS, with a documented FFmpeg limitation

```
$ ffmpeg … -f tee -use_fifo 1 \
    -fifo_options attempt_recovery=1:recover_any_error=1:recovery_wait_time=2:drop_pkts_on_overflow=1:queue_size=240 \
    "[f=mpegts:onfail=ignore]…\tee-a.ts|[f=mpegts:onfail=ignore]…\tee-b.ts"
exit 0    slave A 354,756 B    slave B 354,756 B
```

Escaping variants exercised against FFmpeg 9.0.1:

| Form | Result |
|---|---|
| `[f=mpegts:onfail=ignore]a.ts\|[f=mpegts:onfail=ignore]b.ts` | both slaves 232,180 B |
| `use_fifo=1` with no options | both slaves 232,180 B |
| per-slave `fifo_options=queue_size=120` (one option) | both slaves 232,180 B |
| per-slave `fifo_options=attempt_recovery=1\:recover_any_error=1` | **slave B 0 bytes** — `Unknown option 'recover_any_error'` |
| same with `\\:` (doubled backslash) | **slave B 0 bytes** — same error |
| **global** `-fifo_options attempt_recovery=1:recovery_wait_time=2:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=240` | **exit 0, both slaves 232,180 B** |
| `rtmp\://127.0.0.1:1939/live/x` against a live listener | 449,884 B received |
| `rtmp://127.0.0.1:1939/live/x` unescaped, same listener | 449,884 B received |
| one dead RTMP slave + one local file slave, both `onfail=ignore` | exit -1, **local slave got its full 232,180 B** |
| two dead RTMP slaves, both `onfail=ignore`, no local slave | **exit -1, 0 bytes anywhere** |

Conclusions:

- **`fifo_options` must be passed GLOBALLY, not per-slave.** In the per-slave form its entries are
  separated by `:`, the same separator tee uses for its own option block, and no backslash depth
  escapes it — a two-option value fails and that slave writes **zero bytes with exit code 0**, a
  silent data-loss trap. Passed globally, before the tee URL, the identical `:`-separated list
  parses fine and all five options apply. `teeGlobalArgs()` emits the global form.
  *(The global form was reported by `docs/research/MEDIA_ENGINE_EVALUATION.md` §5.3 rule 4 and
  re-verified here. Our first finding was correct about the per-slave form but wrongly generalised
  from it; the doc and the code are now corrected.)*
- **tee needs an anchor slave.** `onfail=ignore` does not save the process if *every* slave fails to
  open — FFmpeg exits non-zero having written nothing. `buildTeeOutput` now refuses a slave list
  that is all network URLs and requires a local file or `[f=null]-`.
  *(Also first reported by the media-engine evaluation, §5.3 rule 5, and confirmed here.)*
- `onfail=ignore` works as long as an anchor exists: with one dead RTMP slave and one file slave,
  the file slave still received its full 232,180 B.
- Escaping the scheme colon is optional on 9.0.1 but harmless; we escape for portability.

---

## (e) Renderer codec capability — PASS

Measured by running a real `BrowserWindow` in Electron 38.8.6 (see
`docs/architecture/DESKTOP_ARCHITECTURE.md` §1 for the full tables).

```
MediaRecorder.isTypeSupported('video/webm;codecs=h264')      → true
recorder.mimeType (actual)                                   → video/x-matroska;codecs=avc1,opus
encoded                                                      → H.264 Constrained Baseline 1920x1080
237 frames in 7.9 s = 30.0 fps (243 drawn → 2.5 % render drop)
keyframes at 0.000 0.872 1.731 2.556 3.412 4.270 5.129 5.953 6.812 7.670  → ~0.86 s interval
chunks at a 1 s timeslice: 294,102 322,722 341,101 342,697 331,519 344,764 346,422 322,287 bytes
VideoEncoder.isConfigSupported('avc1.640028' @1080p)         → true
VideoEncoder.isConfigSupported('avc1.42E01E' @1080p)         → false
```

Remux of that exact file through the shipping encoder options:

```
$ ffmpeg -f matroska -i mediarecorder-out.webm -map 0:v:0 -map 0:a:0 -c:v copy -c:a aac -b:a 160k \
         -f mpegts -mpegts_flags +resend_headers -pat_period 0.1 -muxdelay 0 remux.ts
exit 0
ffprobe: h264 / Constrained Baseline / 1920x1080 + aac / LC, mpegts, 7.951834 s, 2,822,706 bps
```

Confirms the single-encode claim end to end: **`-c:v copy`, no video re-encode in the main process.**

---

## (f) CSP enforced by Chromium — PASS

The shipped policy string (imported from `src/main/security/policy.ts`, not a copy) was applied
through `onHeadersReceived` and probed from a real sandboxed renderer:

| Probe | Result |
|---|---|
| inline `<script>` mutating `document.title` | **blocked** — title stayed `ORIGINAL` |
| `eval('1+1')` | **blocked** — `EvalError: Refused to evaluate a string as JavaScript` |
| `new Function('return 1')` | **blocked** |
| `fetch('http://example.com/')` | **blocked** — `Refused to connect … connect-src 'self' https: wss:` |
| `blob:` Worker | allowed (the compositor needs it) |
| `data:` image | allowed (avatars, thumbnails) |

Renderer console, verbatim:

```
Refused to execute inline script because it violates the following Content Security Policy
directive: "script-src 'self'".
Refused to connect to 'http://example.com/' because it violates the following Content Security
Policy directive: "connect-src 'self' https: wss:".
```

---

## (g) Windows packaging — PASS (unsigned)

```
$ npm run package:win -w @livetap/desktop
  • electron-builder  version=26.12.1 os=10.0.20348
  • packaging       platform=win32 arch=x64 electron=38.8.6 appOutDir=release\win-unpacked
  • building        target=nsis file=release\LIVETAP-0.1.0-win-x64.exe oneClick=false perMachine=false
  • building block map
EXIT=0

release/LIVETAP-0.1.0-win-x64.exe            95,901,044 B
release/LIVETAP-0.1.0-win-x64.exe.blockmap      102,054 B
release/latest.yml                                  346 B   (electron-updater feed)
```

asar contents (app files only; no source maps, no tests, no `@livetap/core` source):

```
\dist\main\index.cjs
\dist\preload\index.cjs
\dist\renderer\index.html
\package.json
\node_modules\…  (electron-log, electron-updater and their runtime deps only)
```

Three packaging blockers were hit and resolved; all three are recorded in
`docs/release/DESKTOP_RELEASE.md` so the next person does not rediscover them.

Re-run from a clean state (`rm -rf release dist/renderer`) to confirm it is reproducible:
`prepackage` reported `renderer MISSING - wrote placeholder`, and the build completed with EXIT=0
and a 95,901,043 B installer.

`resources/ffmpeg/` is absent from the packaged output because no binary has been dropped in
`apps/desktop/resources/ffmpeg/win/`. That is expected and handled — see (h).

## (h) Packaged app launches — PASS

```
$ Start-Process release\win-unpacked\LIVETAP.exe ; Start-Sleep 18
hasExited=False

%APPDATA%\LIVETAP\logs\main.log:
[error] packaged build has no bundled FFmpeg; streaming will report UNAVAILABLE { expected: 'ffmpeg.exe' }
[info]  ffmpeg resolved { path: 'ffmpeg.exe', source: 'path' }
[info]  ffmpeg hardware probe complete { recommended: 'libx264', working: [ 'libx264' ] }
[info]  encoder probe { recommended: 'libx264', results: [
          'h264_nvenc=UNAVAILABLE ([h264_nvenc @ …] Cannot load nvcuda.dll)',
          'h264_qsv=UNAVAILABLE ([h264_qsv @ …] Error creating a MFX session: -9.)',
          'h264_amf=UNAVAILABLE ([AMF @ …] DLL amfrt64.dll failed to open)',
          'libx264=PASS' ] }
```

The app started, ran the probe, stayed alive, and was **honest about the missing bundled binary**
rather than silently falling through to whatever `ffmpeg` happens to be on the user's PATH.

### Third bug found here

The first packaged launch wrote its data to `%APPDATA%\@livetap\desktop` — Electron derives
`app.getPath('userData')` from the **package name**, which is scoped. An `@` directory breaks
installer cleanup, backup tooling and support instructions. Fixed by adding `productName: "LIVETAP"`
to `apps/desktop/package.json`; the path is now `%APPDATA%\LIVETAP`, confirmed by relaunching.

---

## Unit tests

```
$ npx vitest run --project desktop
 Test Files  12 passed (12)
      Tests  275 passed (275)
```

| File | Tests | Covers |
|---|---|---|
| `argv.test.ts` | 59 | argv building; refusal of `;` `&&` `\|` backticks `$()` newlines quotes NULs; unvalidated ingest refused; SRT/WHIP/FLV shapes; tee escaping |
| `FfmpegEngine.test.ts` | 43 | one encoder per aspect ratio, fan-out, isolation, add/remove, recording, metrics, redaction — with an injected fake `spawn` |
| `guards.test.ts` | 33 | every IPC guard against non-objects, prototype pollution, traversal, wrong schemes, out-of-range numbers |
| `policy.test.ts` | 25 | CSP contents, permission allow-list, navigation lock, external-open scheme filter |
| `progress.test.ts` | 24 | `-progress` parsing across arbitrary chunk boundaries; stderr → `ErrorCode` |
| `oauth.test.ts` | 18 | loopback binding, state mismatch refusal, single use, timeout, deep-link filtering |
| `vault.test.ts` | 16 | round-trip, no plaintext on disk, refusal when encryption unavailable, corrupt-file recovery |
| `fanout.test.ts` | 13 | every byte to every sink, packet alignment, late join, dead sink isolation, never pauses source |
| `diagnostics.test.ts` | 13 | codec probing and its honest fallbacks |
| `recovery.test.ts` | 12 | snapshot round-trip, no secrets, malformed-file rejection |
| `ffmpegPath.test.ts` | 10 | bundled → PATH resolution and the honest `bundled: false` flag |
| `hardware.test.ts` | 8 | encoder preference resolution and fallback |

```
$ npx tsc -p apps/desktop/tsconfig.json --noEmit     # clean
$ npx eslint apps/desktop                            # clean
```

---

## What is NOT verified

- **Real camera and microphone capture.** No camera on this host. The renderer path was exercised
  with `canvas.captureStream(30)` plus a synthesised audio track.
- **GPU encoders.** nvenc, qsv and amf are compiled in and all three fail to open. The
  hardware-specific argv branches in `rateControlArgs` come from FFmpeg's option documentation and
  are **untested on real hardware**.
- **Real platform ingest.** No YouTube/Twitch/Kick credentials on this host. RTMP, RTMPS and SRT were
  verified against local servers only; RTMPS specifically was verified for argv construction and TLS
  scheme handling, not against a real TLS endpoint.
- **macOS anything.** No macOS machine. The dmg target, entitlements, hardened runtime and
  notarization are configured but **UNVERIFIED**.
- **Code signing.** No certificate — see `docs/release/DESKTOP_RELEASE.md`.
- **`setDisplayMediaRequestHandler` against a real screen.** Wired to `desktopCapturer`, but this
  host is headless-ish and the studio UI that picks a source does not exist yet.

## Reproducing

```bash
npm install
npx tsup --config apps/desktop/tsup.verify.config.ts
node apps/desktop/dist/verify/verify-engine.cjs     # exits 0 when all 9 steps pass
npx vitest run --project desktop
npm run package:win -w @livetap/desktop
```

Requires `ffmpeg` and `ffprobe` on PATH (or `LIVETAP_FFMPEG_PATH` / `LIVETAP_FFPROBE_PATH`), and
ports 1935, 1936 and 8890 free.
