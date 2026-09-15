# The real broadcast pipeline

Written 2026-09-14. The path a photon takes from a lens to a platform, on each
surface, with the name of every real component along the way and what has
actually been observed running.

This is a companion to `MEDIA_ENGINE.md` (the abstraction),
`DESKTOP_ARCHITECTURE.md` (the Electron shell) and
`MULTISTREAM_ARCHITECTURE.md` (the fan-out). It exists because those three
describe pieces, and what the owner asked to see is the whole cable.

---

## The one rule that shapes everything below

**One encode per distinct aspect ratio, and it is the right encode.**

Not one encode per destination: that would mean four encoders for four
destinations at 1080p on a four-core machine, which does not work. Not one
encode for everything either: a 9:16 destination given the 16:9 canvas at a
smaller bitrate is a squashed picture with a correct-looking bitrate number
beside it, which is worse than failing, because nothing in the app says
anything is wrong.

So: `FormatRenderer` holds one `MomentCompositor` per distinct aspect that any
enabled destination asked for, all sharing one source resolver. Two
destinations at 16:9 share one encode. A third at 9:16 gets its own, composed
with that Moment's own 9:16 placements. `FormatRenderer.streamFor(aspect)`
returns null rather than substituting, and an output whose aspect was never
composed fails loudly with `CONFIG_INVALID`.

---

## Desktop (Windows and macOS, Electron)

This is the only surface with measured end-to-end results. Everything in the
diagram has been observed carrying real bytes on this host.

```
  a lens                                           RENDERER (sandboxed, no node)
    │
    ▼
  navigator.mediaDevices.getUserMedia
    │   real permission path, real track lifecycle, real `ended` events
    ▼
  <video>  ──▶  LocalSources          camera, screen, demo clip; four honest
    │                                 outcomes: granted / denied / unavailable / insecure
    ▼
  FormatRenderer
    │   one MomentCompositor per distinct aspect, sharing one source resolver
    │   each drawing into a real <canvas> at the format's true dimensions
    ▼
  canvas.captureStream()
    │
    ▼
  MediaRecorder, one per aspect, 1000 ms timeslice
    │   mimeType chosen at run time by probeRecorderSupport(), not assumed.
    │   On this host Chromium offers video/x-matroska;codecs=avc1,opus
    ▼
  blob.arrayBuffer()  ──▶  per-aspect serialised send queue
    │   Blob.arrayBuffer is async. Two timeslices resolving out of order would
    │   interleave Matroska clusters and corrupt the stream for the rest of the
    │   broadcast, so each aspect has its own queue and stop() drains it.
    ▼
  window.livetap.engine.pushChunk(aspect, bytes)
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  contextBridge IPC, allow-listed
    ▼                                                MAIN PROCESS (node)
  FfmpegEngine
    │
    ├─ encoder:  ffmpeg -fflags +genpts+discardcorrupt -f matroska -i pipe:0
    │              -c:v copy -c:a aac -b:a <n>k -ar 48000 -ac 2 -f mpegts pipe:1
    │            `-c:v copy` because Chromium already produced H.264. PTS are
    │            generated because MediaRecorder timestamps restart at zero.
    ▼
  fanout.ts    in-process MPEG-TS fan-out, one encoder stdout to N sender stdins
    │            aligned to whole 188-byte packets, per-sink bounded queue,
    │            the source is NEVER paused
    │
    ├──▶ sender: ffmpeg -i pipe:0 -c copy -f flv  rtmp[s]://host/app/<key>
    ├──▶ sender: ffmpeg -i pipe:0 -c copy -f flv  rtmp[s]://host/app/<key>
    └──▶ recorder (optional)
```

**Why MPEG-TS in the middle and not ffmpeg's `tee` muxer.** `tee` takes a fixed
output list, so adding or removing a destination means restarting the encoder,
and every other destination blips while every viewer sees a reconnect. Here the
encoder is untouched for the whole broadcast and a destination is one cheap
`-c copy` process that can be started, killed and restarted at will. TS is
chosen because it is self-synchronising: a sink attached mid-broadcast starts
on a packet boundary and its ffmpeg locks on at the next PAT or PMT, which the
encoder emits every 100 ms.

**Why a wedged destination cannot hurt the others.** The fan-out source is
never paused. A destination with a full socket buffer or a hung platform gets
its own bounded queue and drops whole aligned blocks when it overflows, rather
than applying backpressure to the encoder, which would stall every other
destination and the recording too.

**What was measured, 2026-09-14 12:43.** Two Custom RTMP destinations at
different shapes, driven through the real UI with Chromium's fake capture
device. MediaMTX parsed 1920x1080 out of one stream's SPS and 1080x1920 out of
the other's; ffprobe independently decoded both recordings as H.264 plus AAC
48 kHz stereo at those resolutions. `kill-publisher.mjs` then dropped one
connection at the TCP level with frames in flight, and the survivor's byte
count climbed from 1,237,654 to 1,542,861 through the failure. END removed
every publisher.

**What is not proven on this surface.** Picture quality from a real lens; a
device unplugged mid-broadcast; the NVENC, QSV and AMF branches, all three of
which fail to open on this GPU-less host so the libx264 fallback is what ran;
anything at all on macOS; multi-hour thermal and memory behaviour; and whether
real platform ingest accepts this exact FLV over TLS.

---

## Android (Capacitor plus a native plugin)

A different pipeline, on purpose. The web layer is the same React app; the
media never enters it.

```
  a lens
    │
    ▼
  Camera2 / CameraX, inside the LiveStreamPlugin
    │
    ▼
  RootEncoder 2.8.1 GenericStream
    │   hardware H.264 through MediaCodec, AAC audio,
    │   composed and encoded entirely in native code
    ▼
  OpenGlView                     the preview the creator sees, behind a
    │                            transparent WebView
    ▼
  RTMP, from the native RTMP client, one connection per destination
    │
  LiveForegroundService          camera + microphone + mediaProjection
                                 foreground service types, so Android 14+ does
                                 not kill the broadcast the moment the app
                                 leaves the foreground
```

The React app's role is to decide and to display: `MobileEngine` implements the
same `MediaEngine` interface the desktop engine does, and calls the plugin.
Nothing about the media crosses the JavaScript bridge, because pushing encoded
video through a Capacitor bridge at 4 Mbps is not a thing that works.

**Status: structurally complete, never executed.** The built APK contains
`LiveStreamPlugin`, `GenericStream`, `LiveForegroundService` and
`SecureStorePlugin` in its dex; the manifest declares `CAMERA`,
`RECORD_AUDIO`, `POST_NOTIFICATIONS` and the three foreground-service types;
one of the 39 bundled JavaScript assets references the plugin, so the web layer
can reach the native one. No line of it has run: this VM has no nested
virtualisation, so no emulator can start here. See
`docs/qa/REAL_DEVICE_TEST_MATRIX.md`.

---

## Web browser

The browser surface is the hardest one, and the reason is worth stating
plainly: **no platform ingest speaks WebRTC.** YouTube, Twitch, Kick and
Facebook all want RTMPS, and a browser page cannot open an RTMP socket.

```
  a lens
    │
    ▼
  getUserMedia ──▶ FormatRenderer ──▶ captureStream
    │              (identical to desktop; this half is shared code)
    ▼
  WhipClient             WHIP, which is WebRTC with an HTTP handshake
    │                    RFC 9725, March 2025. No platform doc cites it yet.
    ▼
  ══ the network ══
    │
    ▼
  a LIVETAP relay          infra/relay: MediaMTX, authenticated, WHIP in,
    │                      no recording, empty `paths:`, a stream can only be
    │                      published to a path session-api explicitly created
    ▼
  transcode hook           WebRTC gives Opus; every platform wants AAC
    │
    └──▶ RTMPS fan-out to each destination
```

**This means the browser surface cannot broadcast without a server.** That is
not a limitation of the code, it is a property of browsers. The desktop app and
the Android app talk to platforms directly and need no relay at all; the web
app needs one or it can only preview.

**Status.** The relay's runtime properties are verified natively against
MediaMTX 1.21.0 with 45 `node:test` cases; container packaging is unverified
because Docker has no WSL distro on this host (BLOCKERS.md B-008). The
browser-to-relay leg has not been driven end to end on this host, and the
receiver config now carries an opt-in loopback WHIP profile so that it can be.

---

## The one thing all three have in common

Every surface ends at the same place: `BroadcastOrchestrator`, which owns the
destination state machine, the reconnect policy with its backoff, and the
guarantee this product is named for.

**One destination failing never touches another.** Not by convention: each
destination is its own state machine with its own sender process or its own
connection, and `stopDestination` acts on exactly one. The failure path was
proven on this host against a real dropped TCP connection with frames in
flight, not a mock socket closing politely at a moment a test chose.

That is also the reason the product never says "LIVE" because one destination
is live. The production state is derived from all of them, and a destination in
RECONNECTING says RECONNECTING, with an attempt number and a countdown, on its
own card.

**And it does not say LIVE because the encoder started, either.** `engine.start()`
resolving means an encoder is running; it does not mean a byte reached anything.
On desktop each sender is a separate process that is spawned and then dies on
its own socket if the far end refuses it, so a start succeeds identically
whether the ingest server is listening or was switched off an hour ago. The
production reaches LIVE on the first `outputUp`, which every engine emits only
on evidence — FfmpegEngine on bytes the sender actually wrote — and the elapsed
clock starts with it, so it counts time on the wire rather than time since a
button was pressed.

---

## Why the keyframe interval is set, and why it is 2 seconds

The renderer asks Chromium for a keyframe every 2 seconds
(`videoKeyFrameIntervalDuration`, see `KEYFRAME_INTERVAL_MS`). Left alone
Chromium emits one about every **7.2 seconds** — measured here with ffprobe on a
real recording: 2.058, 9.383, 16.620, 23.831. Three separate things want it
shorter, and one of them was broken by it:

- **Platforms.** Twitch requires 4 seconds or less; YouTube asks for 2.
- **Viewers.** A viewer sees nothing until the next keyframe, so a 7.2-second GOP
  is up to 7.2 seconds of black for every new arrival.
- **Reconnect.** A destination that drops is restarted as a fresh `-c copy`
  sender attached to a stream already in flight, and it cannot write its output
  header until it has seen a keyframe carrying the H.264 parameter sets. ffmpeg's
  default analyze window is 5 seconds. 7.2 against 5 meant the reconnecting
  sender was *mathematically unable* to lock on, and died every time with "Could
  not write header (incorrect codec parameters ?)".

Senders also get a 20-second analyze window and do not use `+nobuffer`, which
exists to cut latency by not buffering during stream discovery — exactly the
buffering a late joiner depends on. Either fix alone is a coin toss; both are in.

---

## How to see any of this for yourself

```bash
node infra/dev-harness/ingest/selftest.mjs   # is the receiver honest, with no product involved?
npm run ingest                               # start a real RTMP server on 127.0.0.1:1935
npm run verify:broadcast                     # the whole desktop chain, one exit code
npm run verify:paste                         # can somebody with NO account go live on YouTube?
npm run verify:ingest -- --path=live/wide    # ask ffprobe what actually arrived
```

The broadcast proof runs one destination per output shape, so a single run puts
1920x1080, 1080x1920 **and** 1080x1080 on the wire simultaneously from one
production, kills one of them at the TCP level, watches the survivors keep
climbing, and waits for the dropped one to come back at the shape it left.
