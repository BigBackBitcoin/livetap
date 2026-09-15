# The owner's machine cannot broadcast, and nobody had tested it

**Status: FIXED in `fc84167`.** The cause and the measurement that named it are at the
bottom, under "Root cause: found". Everything above it is the investigation as it
stood, kept because the eight suspects it ruled out are why the ninth was
findable.

The owner's build host has no camera. It has no microphone either — it is a
Windows Server VM. Every broadcast this product has ever proven was captured from
Chromium's synthetic device, and `apps/desktop/e2e/broadcast.mjs` said so in a
comment directly above the flag that supplies one:

> The REAL getUserMedia path, with a synthetic source. **This VM has no camera**;
> every line of permission handling, track lifecycle and constraint negotiation
> still runs for real.

That is a good default and the right way to test nine things. It is also the
reason the tenth was never tested: the machine under test always HAD a device.

`--no-fake-camera` withholds it. `--moment=<name>` chooses what is composed.

---

## The measurement

Same build, same receiver started by the run, empty recordings tree, minutes
apart, one variable.

| | capture device present | **no capture device** |
|---|---|---|
| publishers on the server | **3 / 3** | **0 / 3** |
| shapes parsed from the streams' own SPS | 1920x1080, 1080x1920, 1080x1080 | none |
| failure isolation + reconnect | proven | never reached |
| exit code | **0** | **1** |

Reproduced three times without a device and twice with one, including once at a
later HEAD with the Bond integration compiled in, to rule out the build.

**The Moment is not the variable.** It fails on `Main Camera`, whose only layer
IS the camera, and equally on `Starting Soon` — a colour, a title, and a camera
layer explicitly marked `visible: false`, which needs no camera to paint.

---

## What the app says while this happens

```
Your camera disconnected.
  WHY    The device was unplugged, disabled, or taken by another app.
  DOING  LIVETAP switched to your fallback layer so your stream stays up.

Your microphone disconnected.
  WHY    The device was unplugged, disabled, or taken by another app.
  DOING  LIVETAP is streaming silence rather than stopping your broadcast.
```

Two defects, separate from the functional one.

**1. The diagnosis is wrong.** Both are `CAMERA_LOST` / `MIC_LOST` in
`packages/core/src/errors/humanize.ts`, which describe a device that WAS there
and went away. There is no case for a machine that never had one. "Unplugged,
disabled, or taken by another app" is three wrong guesses on a server.

**2. The `doing:` lines are claims, not observations.** "your stream stays up"
and "streaming silence rather than stopping your broadcast" are asserted while
nothing is being broadcast at all. The product's own rule is that it never
describes behaviour it is not performing.

The preflight makes the same promise from the other side, and raises it as a
warning rather than a blocker, because a camera-less broadcast is *supposed* to
work:

> `preflight.ts:240` — "No camera found — viewers will see your title card
> instead of your face."

## What it gets right

**It never claimed to be live.** Destinations sat at `Starting` and the status
read "Telling your 3 destinations you are live…" for the whole run. §9 — UI LIVE
= REAL BROADCAST STATE — held under a condition nobody had ever tested, which is
the single most important invariant in the directive.

---

## Root cause: what has been ruled OUT

Each of these was measured, not reasoned about, by probing the running renderer
of the built app under both conditions.

| Suspect | Verdict | Evidence |
|---|---|---|
| No devices present | **CONFIRMED absent** | `enumerateDevices()` returns three `audiooutput` entries and nothing else. No `videoinput`, no `audioinput`. |
| The compositor cannot paint without a camera | **RULED OUT** | Frames advance identically: 82 frames in 3 s with no device, 80 with one. Both 1920x1080. |
| The composited stream has no audio track | **RULED OUT** | Identical in both: one live, enabled, unmuted track labelled `MediaStreamAudioDestinationNode`. |
| The Moment has nothing to draw | **RULED OUT** | Fails on `Starting Soon`, which is a colour and a title. |
| The renderer never reaches the engine | **RULED OUT** | Six ffmpeg processes spawn — three encoders and three senders, the expected topology — and run for the length of the broadcast. |
| `LocalSources` throws and aborts the start | **RULED OUT** | `acquireCamera` and `acquireMic` both catch, report, and continue. `sync()` resolves. |
| `captureSucceeded` gates going live | **RULED OUT** | It feeds one diagnostics string and nothing else. |
| The recorder MIME probe fails | **RULED OUT** | `probeRecorderSupport` is a static `isTypeSupported` sweep; it touches no device. |

So the chain reaches ffmpeg, ffmpeg runs, and no RTMP publisher ever appears.

## What is still open

Everything observable in the renderer is byte-for-byte the same under both
conditions, yet the outcome is 100% reproducible in both directions. The
remaining candidates, untested:

1. **The device-error path gates the transition.** `deviceLost` +
   `engineError('CAMERA_LOST')` + `engineError('MIC_LOST')` fire only in the
   failing case. If an outstanding device error suppresses STARTING to LIVE, the
   destinations would sit exactly where they sit.
2. **The per-aspect recorder streams differ from the preview stream.** Everything
   above was measured on the preview element. The broadcast uses
   `renderer.streamFor(aspect)` per aspect — separate captures that were not
   probed.

Neither the renderer console nor the main process emitted a single line in either
run, so stdout is not a diagnostic here, and instrumenting the engine is the next
step.

## How to re-run it

```
node infra/dev-harness/ingest/start-ingest.mjs
npm run build -w @livetap/desktop
node apps/desktop/e2e/broadcast.mjs                     # control: expect exit 0
node apps/desktop/e2e/broadcast.mjs --no-fake-camera    # expect exit 1, 0 of 3
```

## Why this is the owner's blocker

The desktop app is the only surface that puts real bytes on a real wire — the
deployed website is in mock mode with no relay, and Android has never run on
hardware. If the desktop app cannot broadcast on the owner's own machine, then on
that machine the product has no working path to air at all.


---

# Root cause: FOUND, and fixed in `fc84167`

**Silence that was not there.**

`buildAudioMix` in `packages/media/src/sources/LocalSources.ts` connects a gain
node for the microphone and one for system audio. With neither present — a
server, a disabled mic, or a creator who picked "No microphone" — **nothing at
all is connected to the mix destination**, and a WebAudio graph with no input to
its destination has no reason to render.

Its track still reports `readyState: "live"`. That is what made this invisible,
and why the eight suspects above were ruled out first: every observable in the
renderer was byte-for-byte identical under both conditions. But the track
delivers no audio frames, and `MediaRecorder` will not emit a chunk until every
track in its stream has produced data. So the recorder stalled before the first
chunk, the encoder ffmpeg received nothing, and the sender ffmpeg never had
enough input to write a header.

## The observable that named it

Six ffmpeg processes spawned — three encoders, three senders, the expected
topology — and **not one opened a TCP connection to the server.** The receiver's
log carries no `[RTMP] conn opened` line for the whole run.

That is the difference between "the publish failed" and "the publish never
happened", and it points upstream with no ambiguity: a sender that cannot write a
header never dials.

## The fix

A `ConstantSourceNode` at offset 0 is exactly silence, costs one node, and gives
the graph a reason to pull forever. It is also precisely what the product already
told the creator it was doing — *"LIVETAP is streaming silence rather than
stopping your broadcast"* — which until now was a claim rather than a
description.

Guarded three ways: built once however many times the mix is rebuilt, stopped and
disconnected with the graph, and an engine without `createConstantSource` keeps
the old behaviour rather than failing.

## Measured after, on the host with no camera and no microphone

```
node apps/desktop/e2e/broadcast.mjs --no-fake-camera     exit 0
    live/wide    H264 1920x1080 + AAC   128,900 bytes decoded by ffprobe
    live/tall    H264 1080x1920 + AAC   153,541 bytes
    live/square  H264 1080x1080 + AAC   134,726 bytes

node apps/desktop/e2e/broadcast.mjs                      exit 0, unchanged
```

Three regression tests in `LocalSources.test.ts`, confirmed load-bearing: with the
guard reverted to `if (false)` all three fail, the first naming the cause. They
pin that the heartbeat is started and connected, that its offset is **zero** — a
non-zero offset would put a DC tone on every broadcast this product ever makes —
that exactly one exists however often the mix is rebuilt, and that it stops with
the graph it belongs to.

## What remains open from this investigation

`CAMERA_LOST` and `MIC_LOST` still misdiagnose a machine that never had a device
as one whose device was "unplugged, disabled, or taken by another app". The
broadcast now works, so the `doing:` lines are no longer false — but the `why:`
lines are still three wrong guesses on a server, and there is no
`NO_CAPTURE_DEVICE` case to raise instead.
