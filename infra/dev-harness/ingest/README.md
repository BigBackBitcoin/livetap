# LIVETAP dev-harness: local real ingest

A real RTMP server on your own machine that accepts a LIVETAP broadcast,
records it to disk, and then tells you exactly what arrived: codec, profile,
resolution, frame rate, sample rate, channels, duration, bitrate.

It exists to close one specific gap. The desktop app can say `LIVE`, the
progress bar can move, and the destination tile can turn green, and none of
that is evidence that a single encoded byte left the machine. This directory
turns that claim into a file you can open and a probe you can read.

```
LIVETAP desktop app ──RTMP(H.264+AAC)──▶ MediaMTX ──▶ recordings/live/<path>/<timestamp>.mp4
   or ffmpeg             127.0.0.1:1935      │
                                             └──▶ control API 127.0.0.1:9997
                                                     │
                                       verify-ingest.mjs asks "who is publishing?"
                                       then ffprobe asks "and what is it, really?"
```

---

## What this is not

* **It is never deployed.** Nothing in this directory ships, runs in CI as a
  service, or exists on any host but a developer workstation.
* **It is never exposed beyond localhost.** Every listener binds `127.0.0.1`,
  the `any` user is pinned to `127.0.0.1` and `::1`, and the bind address is
  not configurable. There is no authentication, and there does not need to be,
  because there is no route to it from off the machine.
* **It is not the production relay.** That is
  [`infra/relay/`](../../relay/README.md): authenticated, WHIP-first, no
  recording, empty `paths:`, and a hard rule that a stream can only be
  published to a path `session-api` explicitly created. This receiver does the
  opposite on purpose. It accepts whatever the app under test pushes and
  reports on it. **Do not copy `mediamtx.dev.yml` into a deployment.**
* **It handles no credentials.** It never asks for, stores, forwards or logs a
  platform stream key. The only "stream key" here is a local MediaMTX path
  name on an unauthenticated loopback server. Query strings are stripped from
  every URL before it can reach a log line, and MediaMTX API objects are never
  dumped wholesale, because MediaMTX does not redact `forward[].dest` or
  `runOnAvailable` and those fields carry real keys in production.

---

## Requirements

| Thing | Where |
|---|---|
| MediaMTX v1.21.0 | `tools/mediamtx/mediamtx.exe` (or `mediamtx` on Linux/macOS) |
| ffmpeg + ffprobe 7 or newer | on `PATH` |
| node 20.11 or newer | on `PATH` |

`tools/` is gitignored, so the MediaMTX binary is never committed. If it is
missing, `start-ingest.mjs` refuses to start and prints the download URL, the
exact directory to extract into, and the command to confirm the version. No
npm dependencies: every script is node builtins only, and every child process
is spawned with an argv array rather than a shell string, so the scripts behave
identically under Git Bash, PowerShell and plain `node`.

---

## The four scripts

### 1. Start the receiver

```bash
node infra/dev-harness/ingest/start-ingest.mjs
node infra/dev-harness/ingest/start-ingest.mjs --path=live/desktop-test
```

Launches MediaMTX with `mediamtx.dev.yml`, waits until the RTMP port is
genuinely accepting TCP connections (not merely "the process started"), and
prints what to publish to:

```
  RTMP ingest   rtmp://127.0.0.1:1935/
  stream path   live/desktop-test
  full URL      rtmp://127.0.0.1:1935/live/desktop-test
  control API   http://127.0.0.1:9997  (loopback only)
  recordings    recordings
```

Runs in the foreground. Ctrl+C stops it; recordings stay. Any path under
`live/` is accepted, so you do not have to configure the server before pointing
something new at it.

In the LIVETAP desktop app, add a **Custom RTMP** destination with that URL. In
OBS, `Server` is `rtmp://127.0.0.1:1935/live/` and `Key` is the last segment.

### 2. Verify what arrived

```bash
node infra/dev-harness/ingest/verify-ingest.mjs
node infra/dev-harness/ingest/verify-ingest.mjs --path=live/desktop-test --source=record
node infra/dev-harness/ingest/verify-ingest.mjs \
    --expect-video=h264 --expect-audio=aac --expect-resolution=1280x720 --min-duration=2
```

This is the script that turns "the UI said LIVE" into evidence. It queries the
control API for active publishers, then runs ffprobe against either the live
RTMP path or the newest recorded segment, and ends with a single `PASS` or
`FAIL` line. **Exit code 0 on PASS, 1 on FAIL**, so it works as a CI gate.

| Flag | Meaning |
|---|---|
| `--path=<name>` | which MediaMTX path to inspect (default `live/dev`) |
| `--source=auto\|live\|record` | `auto` probes the live path when a publisher is connected, otherwise the newest recording |
| `--file=<path>` | probe this exact recording |
| `--wait=<seconds>` | wait for a publisher to appear before giving up |
| `--expect-video`, `--expect-audio`, `--expect-resolution` | turn observations into assertions |
| `--min-duration=<s>`, `--min-bytes=<n>` | reject a stream that technically arrived but carried nothing |
| `--json` | machine readable, for wiring into other tooling |

### 3. Kill a publisher on purpose

```bash
node infra/dev-harness/ingest/kill-publisher.mjs --path=live/desktop-test
```

Asks MediaMTX to kick a live RTMP connection, then confirms it is actually
gone rather than trusting the API's `200`.

This exists so destination failure isolation can be tested against a real
dropped connection. A mocked socket closes politely at a moment the test chose;
this drops a real TCP connection with frames in flight, which is the failure
the encoder will meet in production. Exit 0 if a publisher was killed, 1 if
there was nothing to kill.

### 4. Prove the harness itself is honest

```bash
node infra/dev-harness/ingest/selftest.mjs
node infra/dev-harness/ingest/selftest.mjs --seconds=6 --keep
```

Runs the whole receiver without the product: starts MediaMTX, pushes a
synthetic H.264 + AAC stream (`testsrc2` plus `sine`) with ffmpeg, and asserts
that the codecs, resolution, sample rate, channel count and frame rate all come
back correct, from the live path AND from the recording, then kills a real
publisher and checks that the encoder saw the drop. Exit code 0 or 1.

Every run uses a freshly randomised path name, so a pass can never be explained
by a recording an earlier run left behind. Run this first whenever the product
appears not to arrive: if the self-test passes and your broadcast does not, the
fault is in the product, not the receiver.

---

## How to read the verification output

```
LIVETAP dev ingest verification
  path        live/desktop-test
  control API http://127.0.0.1:9997  reachable
  publisher   127.0.0.1:60833  agent "FMLE/3.0 (compatible; Lavf63.1.101)"  since ...  4359698 bytes
  server saw  H264 (Baseline, 1920x1080), MPEG-4 Audio (44100 Hz, 2 ch)
  probed      live  rtmp://127.0.0.1:1935/live/desktop-test

  ffprobe reports what actually decoded:
  video    codec h264  profile Constrained Baseline  1920x1080  30.30 fps  pixfmt yuv420p
  audio    codec aac  profile LC  44100 Hz  2 ch (stereo)
  container flv
  duration unknown (live stream, see observed below)
  bitrate  unknown (live stream, see observed below)
  observed  5364 kbps measured over 1.2 s (804671 bytes)

  ok    bytes received by server: 4530994
  ok    video codec is h264 as expected

PASS  real encoded media arrived on live/desktop-test: h264 1920x1080 plus aac 44100 Hz 2 ch, ...
```

Read it in four parts.

**`publisher`** is the only line that proves something is connected *now*. If
it says `none connected`, nothing is streaming, whatever the app's UI claims.
The byte count is cumulative for that connection: if it is not climbing between
two runs, the encoder has stalled even though the socket is still open.

**`server saw`** is MediaMTX's own reading of the RTMP handshake, taken from
the control API. **`ffprobe reports`** is an independent decode. They are shown
separately on purpose: if they disagree, something between the encoder and the
container is lying, and that is worth knowing. Note that MediaMTX reports
H.264 profile as `Baseline` where ffprobe says `Constrained Baseline`; those
are the same thing described at different levels of detail.

**`duration` and `bitrate` say `unknown` for a live probe, and that is correct,
not a failure.** FLV over RTMP carries no container duration and no overall
bitrate. The `observed` line replaces them with a rate measured from real byte
counts over a real interval, which is the honest number for a live stream. When
you probe a recording instead, both fields are populated from the file.

**The last line is the verdict.** `PASS` means real encoded media arrived and
every assertion you asked for held. `FAIL` names the first reason and lists any
others beneath it. Common ones:

| `FAIL` reason | What it actually means |
|---|---|
| `control API ... failed: connect ECONNREFUSED` | the receiver is not running; start `start-ingest.mjs` |
| `nothing arrived: no publisher ... and no recording` | the product never reached this server at all: wrong URL, wrong port, or it never opened a socket |
| `ffprobe could not decode the live path` | a publisher is connected but is not producing a decodable stream; usually a handshake that completed with no media behind it |
| `no audio stream present` | video is arriving and audio is not, which on a real platform is a silent broadcast |
| `expected video codec h264, got ...` | the encoder negotiated something the destination platforms will not accept |
| `recording is N bytes, expected at least ...` | the connection was made and then nothing was pushed through it |

---

## Where things live

| Path | What |
|---|---|
| `mediamtx.dev.yml` | the receiver config. Commented with why each choice differs from production |
| `start-ingest.mjs` | launch and wait for readiness |
| `verify-ingest.mjs` | the evidence script |
| `kill-publisher.mjs` | deliberate connection drop |
| `selftest.mjs` | end to end proof, no product required |
| `lib/harness.mjs` | config, binary resolution, control API, port waiting, process spawning |
| `lib/probe.mjs` | ffprobe wrapper and summarising |
| `lib/verify.mjs` | the verification logic, shared by the CLI and the self-test |
| `recordings/` | gitignored. Delete it freely; it is rebuilt on the next broadcast |

## Environment overrides

| Variable | Default | Why you would set it |
|---|---|---|
| `LIVETAP_DEV_INGEST_RTMP_PORT` | `1935` | something else already owns 1935 |
| `LIVETAP_DEV_INGEST_API_PORT` | `9997` | something else already owns 9997 |
| `LIVETAP_DEV_INGEST_PATH` | `live/dev` | default path for every script |
| `LIVETAP_DEV_INGEST_MEDIAMTX` | `tools/mediamtx/mediamtx(.exe)` | a MediaMTX binary kept elsewhere |
| `LIVETAP_DEV_INGEST_WHIP` | unset | set to `1` to also accept **WHIP** on `127.0.0.1:8889`. The browser surface cannot open an RTMP socket, so it publishes WHIP to a relay; this makes that leg provable here with the same control API and the same ffprobe evidence, without the relay VPS or Docker. Still loopback only: the WebRTC media port is pinned to `127.0.0.1:8189` and the ICE server list is empty, because a STUN lookup is an egress this harness must never make |

Port overrides are passed to MediaMTX through its own `MTX_RTMPADDRESS` /
`MTX_APIADDRESS` mechanism, so the YAML file and the scripts cannot end up
disagreeing about where the server is listening. Two harnesses can run side by
side on different ports.

## Recordings

Segments land in `recordings/<path>/<timestamp>.mp4`, fragmented MP4, 30 second
segments, no automatic deletion: a recording is evidence, and deleting evidence
on a timer is the wrong default for a tool whose job is to let a human look at
what arrived. A segment is finalised when it rolls over or when the publisher
disconnects, so probe a recording after the broadcast ends, not during it.
