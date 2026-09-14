# LIVETAP Media Engine

Status: implemented for the browser and for desktop. `@livetap/media` now contains three engines:
`BrowserEngine` (WHIP / relay), `DesktopEngine` (Electron renderer to main-process FFmpeg) and
`MockEngine`. The desktop path is proven end to end on the build host by
`node apps/desktop/e2e/broadcast.mjs`, which drives the built app through the real UI and then
ffprobes what MediaMTX recorded.

Everything in this document is written to be checkable. Where a claim cannot be verified on the build
host (Windows Server 2022, no camera, no microphone, no GPU, no capture device) it is labelled
**UNVERIFIED** rather than asserted.

---

## 1. Layering

```
UI (apps/web, apps/desktop, apps/mobile)
        |
BroadcastOrchestrator            (packages/core) - production + destination state machines
        |
MediaEngine interface            (packages/core/src/media/engine.ts) - the only contract
        |
   +----+-----------------+-------------------------+
   |                      |                         |
BrowserEngine        DesktopEngine             MockEngine
(@livetap/media)     (@livetap/media,          (@livetap/media)
 web + mobile         Electron renderer)        demos / E2E / CI
 WebView                  |
   |                      +-- window.livetap.engine.pushChunk
   |                             |
   |                        FfmpegEngine (Electron MAIN) -> one RTMP sender per destination
   |                      |
   +----------------------+
   |
LocalSources (getUserMedia / getDisplayMedia)  <-- shared by both real engines
   |
FormatRenderer: one MomentCompositor and one 2D canvas PER ASPECT RATIO
   |
canvas.captureStream() per aspect + one shared WebAudio mix
   |
   +-- WhipClient        (WebRTC / WHIP) -> ingest or relay   (BrowserEngine)
   +-- MediaRecorder per aspect -> IPC -> ffmpeg              (DesktopEngine)
   +-- MediaRecorder             -> local recording
```

The orchestrator never learns which engine it is driving. It consumes exactly five event channels:
`output`, `metrics`, `engineError`, `deviceLost`, `recording`. Every engine failure that concerns one
destination arrives as an `output` event carrying that destination's id — never as a thrown error —
so one destination can fail while the rest of the production stays live.

### Engine matrix

| Engine | Runs in | Capture | Publish | Recording | Verification on build host |
| --- | --- | --- | --- | --- | --- |
| `BrowserEngine` | Web, mobile WebView | getUserMedia, getDisplayMedia | WHIP only (WebRTC) | MediaRecorder | **UNVERIFIED** (no camera/GPU); logic **PASS** under unit tests with injected fakes |
| `FfmpegEngine` | Electron main | OS capture (libobs/ffmpeg devices) | RTMP, RTMPS, SRT, WHIP | ffmpeg mux | Not implemented here |
| `MockEngine` | Anywhere | none | none | none | **SIMULATED** — reports `verification: 'SIMULATED'` and never claims otherwise |

---

## 2. The single-encode-per-format rule

A production may have ten destinations. It must never run ten encoders.

- `EngineStartRequest.formats` is keyed by **aspect ratio**, not by destination
  (`Record<AspectRatio, OutputFormat | undefined>`). `resolveFormats()` in core collapses the
  destination list into the set of distinct aspect ratios.
- `FormatRenderer` builds one `MomentCompositor` and one canvas **per distinct aspect ratio**, all
  sharing one `LocalSources` resolver. The camera opens once; each compositor draws the same
  `<video>` elements into its own geometry, so a 9:16 destination gets the Moment's own `'9:16'`
  placements rather than the landscape arrangement squashed.
- Every destination of the same aspect ratio shares that aspect's `MediaStream`. Adding a
  destination adds an `RTCPeerConnection` (browser) or a `-c copy` sender process (desktop), never
  an encoder.
- `streamFor(aspect)` returns **null** for an aspect that was not composed, and the engine refuses
  that output with `CONFIG_INVALID`. It never substitutes the master picture: a silent
  wrong-aspect broadcast is worse than a refused one, because the creator cannot see it.
- `capabilities().maxFormats` is `3` for both real engines, the number of aspect ratios that exist.
  What it costs is a separate, measured question. On the GPU-less build host, composing a single
  1920x1080 canvas sustained 22.84 fps into the recording; composing 1920x1080 plus 1080x1920
  together landed between 9.1 and 13.2 fps across four runs, against a 30 fps target. Measured by
  ffprobe on what MediaMTX recorded from `apps/desktop/e2e/broadcast.mjs`. Canvas 2D is software
  rasterised on this host and `backgroundThrottling: false` does not change the number, so the
  cost is the rasterising itself. A machine with a GPU is not this machine, and this document
  does not guess for it. **This is the one number an owner with real hardware should re-measure
  first.**
- Recording uses `source: 'program'` — the already-composited stream. No second render, no second
  encode. The cost of recording is the MediaRecorder encode only.

---

## 3. Output isolation

Each output owns an independent session record (`OutputSession`), and each WHIP session owns its own
`RTCPeerConnection`:

- `start()` opens every output in sequence and **never throws** for a per-output problem. A refused
  ingest, a bad token, a missing WebRTC stack: all become
  `output: { type: 'outputLost', destinationId, code, technical }`.
- `addOutput()` / `removeOutput()` touch exactly one session. Removing one closes its peer connection
  and `DELETE`s its WHIP resource; the others keep sending.
- `stop()` closes every session, stops the recorder, and **leaves the preview running** so the
  creator still sees themselves after ending a broadcast.
- A session that was deliberately stopped no longer emits `outputLost` when its ICE state later
  collapses — otherwise stopping a stream would look like a failure to the orchestrator.

### Health signals

A stats poll runs every 2s per WHIP sender (`getStats()` → `outbound-rtp` + `remote-inbound-rtp`):

| Condition | Event |
| --- | --- |
| packet loss > 3% over the window | `outputDegraded` (technical names the loss and the bitrate) |
| bitrate < 50% of `videoKbps + audioKbps` | `outputDegraded` |
| both conditions clear again | `outputRecovered` |
| `iceConnectionState` → `failed` / `disconnected` / `closed` | `outputLost` with `INGEST_DISCONNECTED` |
| HTTP 401/403 from the WHIP endpoint | `outputLost` with `INGEST_INVALID_KEY` |
| RTMP/RTMPS/SRT requested with no relay configured | `outputLost` with `CONFIG_INVALID` |

`metrics` is emitted every 1s regardless:

| Field | Source |
| --- | --- |
| `encodedKbps` | `bytesSent` delta across WHIP senders; falls back to MediaRecorder chunk sizes when there is no sender |
| `targetKbps` | `format.videoKbps + format.audioKbps` |
| `renderFps` | frames the compositor actually drew in the last second |
| `targetFps` | `format.fps` |
| `networkDroppedPct` | worst `packetsLost` delta ratio across outputs |
| `encoderDroppedPct` | `framesDropped / (framesSent + framesDropped)`; `qualityLimitationReason` is surfaced in the degradation text |

CPU/GPU/memory are **not** reported by `BrowserEngine`: a browser tab cannot measure them honestly.
They stay `undefined` rather than being invented.

---

## 4. WHIP and the relay model (web app)

**A browser cannot speak RTMP, RTMPS or SRT.** There is no socket API for it, and no amount of
JavaScript changes that. `capabilities()` returns `rtmp: false, srt: false` from `BrowserEngine`, and
that is not a placeholder to be filled in later.

Consequences, stated plainly to the user rather than hidden:

1. **Destination speaks WHIP** (some custom ingests, MediaMTX, Cloudflare, Dolby, Millicast):
   `BrowserEngine` publishes directly. One `RTCPeerConnection` per destination.
2. **Destination speaks RTMP/RTMPS/SRT** (YouTube, Twitch, Kick, Facebook, X, LinkedIn — i.e. almost
   everything) and **no relay is configured**: the output is refused immediately with
   `CONFIG_INVALID` and the technical string
   `"Browser cannot publish RTMP; use the desktop app or a WHIP relay"`. Nothing is attempted over
   the network; nothing silently half-works.
3. **Destination speaks RTMP/RTMPS/SRT and a relay is configured** (`new BrowserEngine({ relay: { whipBaseUrl, token } })`):
   the engine opens **one WHIP session per aspect ratio** to `${whipBaseUrl}/${aspect}` with `:`
   replaced by `x` (`16:9` → `/16x9`, `9:16` → `/9x16`, `1:1` → `/1x1`). The relay re-publishes that
   one stream to every RTMP/SRT destination. Every destination sharing an aspect ratio comes up (and
   goes down) with that single session.

The reference relay is **MediaMTX** (MIT, WHIP in, RTMP/RTMPS/SRT out). It is infrastructure the web
app needs and the desktop app does not: `FfmpegEngine` pushes RTMP itself, so the desktop app has no
relay, no relay cost and no extra hop of latency. This is the single biggest architectural difference
between the two products, and the UI must say which one the user is on.

### WHIP implementation notes

`WhipClient` follows draft-ietf-wish-whip / RFC 9725:

- sendonly transceivers for video + audio (placeholder m-lines when no track is ready yet);
- H.264 preferred via `setCodecPreferences` when `RTCRtpSender.getCapabilities('video')` offers it —
  H.264 is what every RTMP relay and every platform ingest wants, and avoids a transcode;
- `maxBitrate` / `maxFramerate` applied to the video sender from the `OutputFormat`;
- ICE gathering waits for `complete` but gives up after **2s** and posts the candidates gathered so
  far (trickle-less WHIP tolerates a partial candidate list);
- `POST` with `Content-Type: application/sdp`, optional `Authorization: Bearer <token>`; expects
  2xx (201 in practice) with a `Location` header and the answer SDP in the body;
- `DELETE` on the resource URL ends the session;
- ICE restart via `PATCH application/trickle-ice-sdpfrag` **only** when the server advertised
  `Accept-Patch`. Otherwise `restartIce()` returns `false` and the caller reconnects from scratch —
  no speculative PATCHes against servers that do not implement them;
- `Link: <turn:...>; rel="ice-server"` headers are parsed and exposed.

Stream keys and bearer tokens are passed through and never logged.

---

## 5. The Moment compositor

`MomentCompositor` renders a `Moment` onto an `HTMLCanvasElement` or an `OffscreenCanvas` with the
**2D context only** — no WebGL, no shaders, no dependencies. That keeps it working in old WebViews,
in mobile browsers, and inside a worker.

- Placement is resolved per aspect ratio: `placement[aspect] ?? placement.default`, so one Moment
  composes correctly in 16:9, 9:16 and 1:1 without being re-authored.
- Layers are drawn bottom-up by `z` (ties keep authoring order), honouring `visible`, `opacity`,
  `radius` (rounded clip, scaled from the 1080p reference height), `fit` (`cover` / `contain` /
  `fill`) and `mirror`.
- Camera / screen / window / video layers are drawn from an injected `MediaSourceResolver`
  (`layerId → HTMLVideoElement | ImageBitmap | HTMLImageElement | canvas | null`). The compositor
  never acquires media; when a source is missing it fills the layer's rectangle with a plain
  plate, so the composition keeps its geometry and the program output is never an unexplained
  black rectangle. The labelled "Waiting for source" version is operator-overlay only (section 11).
- Text layers wrap (`wrapText`), scale their font by `outputHeight / 1080`, honour alignment, weight,
  colour and optional background, and truncate with an ellipsis rather than overflowing.
- **Browser and overlay layers are placeholders everywhere.** A browser source needs an Electron
  `BrowserView` (or a `<webview>`), which no engine builds yet. The program draws a plain plate;
  the "Requires the desktop app" label appears only on an operator-overlay compositor. Marked
  **UNVERIFIED**: it is not a rendering bug, it is an honest gap.
- Transitions (`cut`, `fade`, `slide`, `zoom`) are pure functions of time. The engine calls
  `tick(nowMs)`; the loop uses `requestAnimationFrame` when available and `setTimeout` otherwise.
  Because time is a parameter, transitions are unit-tested with a fake clock instead of by eyeballing
  a preview.
- `setNotice(text)` **records** a reason; it does not draw one. The engines set it for "Camera
  disconnected" / "Screen sharing stopped" / "Microphone disconnected", and the UI reads
  `getNotice()`. It reaches pixels only on an operator-overlay compositor (section 11).

---

## 6. Devices, audio and failure behaviour

- **Camera**: `getUserMedia({ video: { deviceId: exact?, width: {ideal:1280}, height: {ideal:720}, frameRate: {ideal:30} } })`.
  `'default'` is never sent as an `exact` constraint.
- **Microphone**: constraints come from `Moment.audio` — `echoCancellation`, `noiseSuppression`,
  `autoGainControl`. Changing gain or mute does **not** re-acquire the device.
- **Screen**: `getDisplayMedia({ video: true, audio: captureSystemAudio })`, prompted **lazily** —
  only when a Moment actually contains a visible screen/window layer, so tapping "Main Camera" never
  triggers a share dialog.
- **System audio** is Chromium-only in practice (Firefox and Safari ignore the audio constraint).
  `capabilities().systemAudio` starts **`false`** and turns `true` only once a `getDisplayMedia`
  stream has actually delivered an audio track (remembered for the life of the engine). The
  user-agent guess is still available, honestly labelled, as
  `describeEnvironment().systemAudioLikely` — use it to word the UI, never to promise the feature.
- **Audio mixing**: an `AudioContext` with one `GainNode` per source feeding a
  `MediaStreamAudioDestinationNode`, so `micGain`, `systemGain` and mute are instantaneous. Without
  WebAudio the engine degrades to the raw mic track (no gain, no system mix) instead of failing.
- **Device loss**: `track.onended` → `deviceLost` event, the affected layer is hidden, a notice is
  drawn, and **the preview keeps running**. Losing a camera mid-stream must not black out the program
  or drop a single destination.
- **Warm-up window**: when a Moment stops using a capture, it is kept alive for 5s
  (`keepSourceWarmMs`) before release, so tapping between Moments does not flicker the camera light
  or re-prompt for a screen share.

---

## 7. Recording

- Records the **program** stream (`RecordingSettings.source: 'program'`) — the composited canvas plus
  the audio mix. Never a second render.
- Mime preference: `video/mp4;codecs="avc1…"` → `video/mp4` → `video/webm;codecs="vp9,opus"` → … .
  MP4/H.264 wins by default because it imports into editors and social uploaders without a
  re-encode; `RecordingSettings.container: 'webm'` flips the order. Browsers without
  `isTypeSupported` get the browser default.
- `timeslice` is 1000ms. Chunks accumulate in memory unless an `onChunk(chunk, index)` sink is
  provided (the web app streams them to IndexedDB / OPFS for long broadcasts).
- `stopRecording()` returns `{ blob }` for the web (there is no filesystem path) and waits for the
  recorder's final `dataavailable`, with a 500ms safety timeout so it can never hang a stop.
- Failures emit `recording: { state: 'failed', code: 'RECORDING_FAILED' }` — recording never takes
  the broadcast down with it.

---

## 8. Verification status on the build host

The build host has no camera, no microphone, no capture device and no GPU. What that means, per claim:

| Claim | Status | How it was checked |
| --- | --- | --- |
| Placement / fit / transition / text-wrap math | **PASS** | 80 unit tests in Node, no DOM |
| Compositor draw order, clipping, mirroring, placeholders, notices, fps accounting, rAF and setTimeout loops | **PASS** | recorded fake 2D context |
| WHIP request/response flow, auth header, 401 → `INGEST_INVALID_KEY` with `status: 401`, DELETE, PATCH gating, ICE-gathering timeout | **PASS** | fake `RTCPeerConnection` + fake `fetch` |
| Engine event contract: `outputUp` / `outputDegraded` / `outputRecovered` / `outputLost` / `outputStopped`, `metrics`, `deviceLost`, `recording` | **PASS** | 62 BrowserEngine tests in happy-dom |
| RTMP without relay → `CONFIG_INVALID`, no throw | **PASS** | unit test asserts the event and that no fetch happened |
| One relay session per aspect ratio | **PASS** | unit test asserts 2 POSTs for 3 destinations across 2 ratios |
| Camera loss keeps the preview alive | **PASS** | unit test ends the track and asserts the stream, loop and notice |
| Real camera / microphone capture | **UNVERIFIED** | no device on this host |
| Real screen capture | **UNVERIFIED** | no display session on this host |
| Real system-audio capture | **UNVERIFIED**, and now reported as such at runtime | `capabilities().systemAudio` is `false` until a display capture yields an audio track, then `true`; the user-agent guess is quarantined in `describeEnvironment().systemAudioLikely` (unit-tested both ways with a fake `getDisplayMedia`) |
| `canvas.captureStream()` frame pacing at 1080p30/60 | **UNVERIFIED** | needs a real browser |
| WebCodecs hardware encoder (`hardwareAcceleration: 'prefer-hardware'`) | **UNVERIFIED** | probed at runtime via `VideoEncoder.isConfigSupported`; no GPU here, so the probe reports nothing and `hardwareEncoders` stays empty |
| A real WHIP handshake against MediaMTX / a platform ingest | **UNVERIFIED** | no network ingest available |
| MediaRecorder MP4/H.264 support | **UNVERIFIED** | depends on the browser build; detected at runtime with `isTypeSupported` |
| Browser-source layers | **UNVERIFIED / UNAVAILABLE in web** | needs Electron or `<webview>`; the compositor draws a labelled placeholder |
| Sustained multi-hour stability, thermal behaviour, mobile background behaviour | **UNVERIFIED** | requires device soak testing |
| Anything reported by `MockEngine` | **SIMULATED** | `capabilities().verification === 'SIMULATED'` by construction |

`BrowserEngine.capabilities().verification` follows the same discipline at runtime:
`'UNAVAILABLE'` when there is no `navigator.mediaDevices`, `'UNVERIFIED'` until a capture actually
succeeds, and only then `'PASS'`.

---

## 9. MockEngine

Deterministic and timer-driven, for demos, E2E and any UI work without a camera:

- `outputUp` after `connectDelayMs` (default 800ms);
- `metrics` every 1s on a seeded curve (`mulberry32`) — same seed, same numbers, every run;
- scripted scenarios: `failOutput`, `degradeOutput` (with optional recovery), `dropDevice`,
  `encoderCrashAfterMs`;
- `addOutput` succeeds by default and can be made to fail the first *n* attempts
  (`reconnectFailsTimes`) to exercise the orchestrator's reconnect backoff;
- `previewStream` is `null` — there is no pipeline. `attachPreview(videoEl)` instead draws a moving
  gradient with "MOCK PREVIEW" and the active Moment's name into a canvas, so the UI always has
  something real to show;
- injectable `setTimeout` / `clearTimeout` / `now`, so tests never sleep.

`createEngineForEnvironment({ preferMock })` returns `MockEngine` when asked, or whenever
`navigator.mediaDevices` is absent (SSR, an insecure origin, a test runner); otherwise
`BrowserEngine`. The UI therefore always has a working engine and never needs a "no media" branch.

---

## 10. Open items for the desktop team

- `DesktopEngine` satisfies the `MediaEngine` contract and re-emits the main process's events on
  the same five channels, so the orchestrator and the UI are unchanged. `capabilities()` merges
  main's answer (network, encoders) with the renderer's (capture, MediaRecorder) and degrades a
  main-process PASS to UNAVAILABLE when the renderer cannot record.
- Browser-source layers are still not real anywhere; they need an Electron `BrowserView` or
  offscreen rendering. Until then the compositor draws the layer's rectangle as a plain plate,
  with no words in it. See section 11.
- Recording on desktop returns a filesystem `path`; the web returns a `blob`. Both shapes are already
  in `stopRecording()`'s return type.

---

## 11. The program output contains the production and nothing else

`MomentCompositor` used to paint operator diagnostics straight into the frames that go on the wire:
a "Camera disconnected" banner from `setNotice`, and labelled placeholder panels reading "Waiting
for source", "Requires the desktop app" and "Loading...". An audit found them burned into every
Moment and every format, and in 9:16 the panel covered the subject.

The rule now: **controls and diagnostics belong in the application UI, never in the video frame.**

- `setNotice()` is state, not paint. `getNotice()` is what the UI reads.
- A layer with nothing to draw yet gets a plain plate the size of the layer: the composition keeps
  its geometry and the viewer is told nothing, because none of it was addressed to them.
- `MomentCompositorOptions.operatorOverlay` re-enables the labelled versions, and is only ever true
  for a canvas that is NOT captured. `FormatRenderer` never sets it.

`MomentCompositor.test.ts` and `BrowserEngine.test.ts` assert both halves: the program canvas
receives no `fillText` for any of those strings, and an operator-overlay compositor still does.
