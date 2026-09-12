# LIVETAP Multistream Architecture

How one production reaches many destinations, in many formats, without the creator building
three productions and without one dead destination killing the rest.

## Layers (as built)

```
UI (React; Simple / Pro)                      apps/web, hosted by apps/desktop + apps/mobile
  │  intent + destinations + devices
  ▼
Automatic Production                          packages/core/src/production/intents.ts
  │  ProductionSettings, Moments, per-destination aspect ratio, formats to encode
  ▼
BroadcastOrchestrator                         packages/core/src/orchestrator
  │  one state machine per destination; adapters create broadcasts; engine gets outputs
  ├──────────────► DestinationAdapters        packages/adapters (mock | real | custom)
  │                 validate / createBroadcast / startBroadcast / chat / stop
  ▼
MediaEngine (one of)                          packages/media, apps/desktop, apps/mobile
  ├─ BrowserEngine   capture → compositor → captureStream → WHIP → relay → RTMP fan-out
  ├─ FfmpegEngine    MediaRecorder H.264 → IPC → FFmpeg encoder per format → TS fan-out → N senders
  ├─ MobileEngine    native camera/mic → HaishinKit / RootEncoder → RTMP (1–2 outputs)
  └─ MockEngine      deterministic simulation for demos and tests
  ▼
Ingest servers (YouTube, Twitch, Kick, Facebook, TikTok, Instagram, X, custom RTMP/SRT/WHIP)
```

## Encode-once rule

`resolveFormats()` derives the set of distinct aspect ratios the enabled destinations need (at most
three: 16:9, 9:16, 1:1). The engine encodes **once per format**, never per destination:

| Engine | 16:9 only | 16:9 + 9:16 |
|---|---|---|
| Desktop (FfmpegEngine) | 1 encoder process → N `-c copy` senders | 2 encoder processes (renderer supplies a second composited stream for the vertical canvas) → senders grouped per format |
| Web (BrowserEngine + relay) | 1 WHIP session → relay hook `-c:v copy -c:a aac` → tee to N | 1 WHIP session → relay adds one scaling hook (`crop=ih*9/16:ih,scale=1080:1920`) for the vertical group — the only relay-side video re-encode |
| Mobile | 1 native encode → 1–2 RTMP pushes (phone thermal budget); more destinations go via the relay (LIVETAP CLOUD later) |

The compositor renders each Moment from normalized placements (`placement[aspect] ?? placement.default`),
so a Moment composed once adapts to every format; `SAFE_AREAS` keep text and faces out of the
vertical platforms' chat and action zones.

## Per-destination lifecycle and isolation

Every destination is an independent state machine (`DISCONNECTED → AUTHENTICATING → READY → STARTING
→ LIVE ⇄ DEGRADED → RECONNECTING → FAILED/STOPPING → ENDED`). The orchestrator guarantees:

1. `goLive()` starts every READY destination in parallel; a `createBroadcast` failure marks only
   that destination FAILED (humane error attached) and the rest proceed.
2. The engine reports `outputLost` per output; the orchestrator schedules exponential backoff with
   jitter (`reconnectDelayMs`), re-adds only that output, and gives up after `maxAttempts` — siblings
   are never touched. Invalid stream keys and revoked auth fail fast (no retry).
3. `DEGRADED` (packet loss / bitrate collapse) is a visible state that never drops the output.
4. The production ends only when the **last** active destination is gone.
5. Engines implement isolation physically: desktop senders are separate processes fed by a
   `TsFanout` that tolerates a dead consumer; the relay's tee uses `use_fifo=1` +
   `attempt_recovery=1` per slave and refuses an all-network slave list (anchor rule); WHIP sessions
   are per relay session with per-destination retry loops inside MediaMTX.

Verified on host: desktop kill/re-add keeps the encoder PID and the recording untouched
(docs/qa/DESKTOP_ENGINE_VERIFICATION.md); relay destination kill/restart rejoins while the sibling never
drops (docs/qa/RELAY_VERIFICATION.md); orchestrator behaviour is unit-tested end to end
(packages/core/src/orchestrator/BroadcastOrchestrator.test.ts).

## Destination intelligence

The UI never branches on protocol. `PlatformProfile.capabilities` (19 keys, 7 classes) decides what
each card offers: "Connect account" (OAUTH_API/NATIVE_API), "Paste stream key" (USER_ASSISTED),
"Not available yet" (PARTNER_APPROVAL_REQUIRED/UNAVAILABLE). `autoStartsOnIngest` decides whether
the adapter must call `startBroadcast` after the first `outputUp` (YouTube) or whether data alone
makes the channel live (Twitch, Kick, Facebook LIVE_NOW). Per-destination encoder ceilings come from
`profile.recommended` (e.g. Kick 8000 kbps CBR, LinkedIn 6 Mbps) and cap the shared format.

## Transport truth (2026)

H.264 + AAC over RTMP/RTMPS is the only universal path. HEVC/AV1 (YouTube, Twitch Enhanced
Broadcasting) and SRT (custom, IVS, Vimeo, Dailymotion) are Pro-mode per-destination options.
WHIP is used only browser→relay and for custom WHIP destinations. See
docs/research/PLATFORM_CAPABILITY_MATRIX.md §D.

## Recording

Recording shares the program encode: desktop tees the encoder output into a fragmented MP4
(`-bsf:a aac_adtstoasc`, survives truncation); web uses MediaRecorder on the composited stream
(chunked, 1 s timeslice); the relay can additionally record server-side (MediaMTX `record`).

## CORE / CLOUD boundary

Everything above runs locally or on a self-hosted relay. A future LIVETAP CLOUD would host the same
session API behind auth/billing, add transcoding ladders, cloud recording and remote guests, without
changing the orchestrator, adapters or UI (ADR-009).
