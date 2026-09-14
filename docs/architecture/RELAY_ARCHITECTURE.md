# LIVETAP relay architecture

**Status:** implemented as `infra/relay/`, verified against MediaMTX v1.21.0
(`docs/qa/RELAY_VERIFICATION.md`)
**Decisions:** ADR-005 (layered media engine), ADR-008 (destination lifecycle),
ADR-009 (CORE/CLOUD boundary), ADR-012 (H.264 + AAC over RTMP/RTMPS)

---

## 1. Why a relay exists at all

A browser cannot open an RTMP socket. That is the whole reason.

Everything else about the design follows from making that limitation safe and
honest rather than merely working around it:

* **The keys stay server-side.** If the browser pushed to platforms directly it
  would need the user's YouTube and Twitch stream keys in JavaScript. With a
  relay the browser only ever holds a WHIP URL. This is a security win we get
  for free from a constraint we did not choose.
* **The fan-out happens once.** The browser uploads one stream; the relay
  multiplies it. A user on domestic broadband can go live to five platforms
  without five times the upstream.

The desktop app does **not** need this relay — it spawns FFmpeg and pushes to
platforms directly (ADR-005). The relay is the web and mobile path.

---

## 2. Shape

```
                                    ┌──────────────────────────────────────────┐
  browser                           │           livetap-relay (compose)        │
  ┌──────────────┐                  │                                          │
  │ getUserMedia │                  │  ┌────────────────────────────────────┐  │
  │   + canvas   │                  │  │            MediaMTX                │  │
  │   compositor │                  │  │                                    │  │
  └──────┬───────┘                  │  │  :8889 WHIP  ──┐                   │  │
         │                          │  │  :8189 ICE/UDP ┘                   │  │
         │ 1. POST /sessions        │  │  :1935 RTMP (desktop ingest)       │  │
         │    {destinations[]}      │  │  :8554 RTSP  (loopback only)       │  │
         │    Bearer <relay token>  │  │  :9997 API   (private network)     │  │
         ├─────────────────────────▶│  └──────┬─────────────────────┬───────┘  │
         │                          │         │ writes path         │ reads    │
         │    {sessionId, whipUrl}  │  ┌──────┴───────┐             │ back     │
         │◀─────────────────────────┤  │ session-api  │             ▼          │
         │                          │  │  :8080       │      ┌──────────────┐  │
         │ 2. WHIP publish          │  │ node:http    │      │   ffmpeg     │  │
         │    H.264 + Opus          │  │ zero deps    │      │ -c:v copy    │  │
         ├─────────────────────────▶│  └──────────────┘      │ -c:a aac     │  │
         │    (DTLS-SRTP over UDP)  │                        │ -f tee       │  │
         │                          │                        └──┬────┬───┬──┘  │
         │ 3. DELETE /sessions/:id  │                           │    │   │     │
         ├─────────────────────────▶│                           │    │   │     │
         └──────────────────────────┴───────────────────────────┼────┼───┼─────┘
                                                                │    │   │
                                              RTMPS ◀───────────┘    │   └──────▶ RTMP
                                             YouTube            Twitch          Custom
```

Two containers, one private network. The only ports reachable from outside are
WHIP signalling, ICE/UDP, RTMP ingest, the HLS preview and session-api.

---

## 3. The decision that shaped everything: `forward` vs hook

MediaMTX offers a native `forward:` array that fans a stream out to N servers
with **no re-encoding**. It is the obvious choice, and for the web path it is
the wrong one.

**WHIP delivers Opus audio. RTMP platforms require AAC.**

`forward` is strictly pass-through. Its RTMP writer
(`internal/protocols/rtmp/from_stream.go`) emits an Opus track only when the
destination advertises Enhanced RTMP Opus support in its `fourCcList`
handshake, and the file contains no transcode branch at all. Against a legacy
RTMP server the Opus track is **silently dropped** — video keeps flowing, and
the user is live with no sound. Against an Enhanced-RTMP peer it forwards Opus,
which YouTube and Twitch still will not decode (ADR-012).

So every web session uses a **`runOnAvailable` hook**: one FFmpeg process,
`-c:v copy -c:a aac`. Video is passed through untouched; only audio is
re-encoded.

| | native `forward` | `runOnAvailable` hook |
|---|---|---|
| Video | copied | copied |
| Audio | Opus, or silently dropped | **Opus → AAC** |
| Relay CPU (720p30, 2 dests) | ~3% of one core | ~12–15% of one core |
| Correct for YouTube/Twitch/TikTok | ✗ | ✓ |
| Per-destination failure isolation | per-dest client | `tee` + `onfail=ignore` |
| Per-destination auto-reconnect | built in | `use_fifo` + `attempt_recovery` |

Correctness costs about an eighth of a CPU core per session. That is a trivial
price for not shipping a silent-failure mode.

`forward:` is still right when the **desktop** app publishes to the relay over
RTMP — that stream is already H.264 + AAC, so pass-through is both correct and
free. `pathDefaults.forward` is left empty and available for that case.

> Measurements and the source excerpt: `docs/qa/RELAY_VERIFICATION.md` §7, §10.

### One process, two output groups

A session with both 16:9 and 9:16 destinations still runs a **single** FFmpeg:

```
ffmpeg -i rtsp://…loopback…
  -map 0:v:0 -map 0:a:0 -c:v copy  -c:a aac … -f tee "[…]dest1|[…]dest2"   # 16:9 / 1:1
  -map 0:v:0 -map 0:a:0 -filter:v crop=ih*9/16:ih,scale=1080:1920 \
                        -c:v libx264 -c:a aac … -f tee "[…]dest3"          # 9:16
```

One process means MediaMTX's SIGINT on stream-end cleans everything up, with no
orphaned encoders. The 9:16 group only appears when a vertical destination
exists **and** `LIVETAP_ENABLE_VERTICAL_TRANSCODE=1`; otherwise a 9:16
destination is refused with an explanation rather than silently sent a 16:9
frame (ADR-007: never masquerade).

---

## 4. Session lifecycle

```
  web app                session-api              MediaMTX                 platforms
     │                        │                       │                        │
     │ POST /sessions         │                       │                        │
     │ Bearer <relay token>   │                       │                        │
     ├───────────────────────▶│                       │                        │
     │                        │ validateIngest()      │                        │
     │                        │  · protocol regexes   │                        │
     │                        │  · reject shell chars │                        │
     │                        │  · reject 9:16 if off │                        │
     │                        │ buildHookCommand()    │                        │
     │                        │ POST /v3/config/      │                        │
     │                        │   paths/add/live/<id> │                        │
     │                        ├──────────────────────▶│  path created,         │
     │                        │                       │  idle, no process      │
     │ {sessionId, whipUrl,   │                       │                        │
     │  whipAuthorization}    │                       │                        │
     │◀───────────────────────┤                       │                        │
     │                                                │                        │
     │ WHIP POST  Authorization: Bearer user:pass     │                        │
     ├───────────────────────────────────────────────▶│ authenticate (publish  │
     │                                                │  on ~^live/.*$)        │
     │ ICE + DTLS-SRTP, media flows                   │                        │
     │═══════════════════════════════════════════════▶│                        │
     │                                                │ stream available       │
     │                                                │  → runOnAvailable      │
     │                                                │    spawns ffmpeg ──────┼──▶ live
     │                                                │                        │
     │ (user stops)  HTTP DELETE on the WHIP resource │                        │
     ├───────────────────────────────────────────────▶│ stream unavailable     │
     │                                                │  → SIGINT to ffmpeg ───┼──▶ ends
     │ DELETE /sessions/:id   │                       │                        │
     ├───────────────────────▶│ DELETE /v3/config/    │                        │
     │                        │   paths/delete/…      │                        │
     │                        ├──────────────────────▶│  path removed          │
     │ 204                    │                       │                        │
     │◀───────────────────────┤                       │                        │
```

Properties worth naming:

* **A path is created before anyone can publish to it.** `paths:` is empty with
  no catch-all template, so publishing to an unknown path is refused outright
  even with valid credentials. No session, no stream.
* **Hooks are lifecycle-bound.** `runOnAvailable` starts when media arrives and
  is SIGINT'd when it stops — no reaper needed.
* **`runOnAvailableRestart: true`** means a crashed FFmpeg is restarted while
  the publisher is still connected, so a transient destination failure
  self-heals.
* **Deleting a session while live** removes the path and disconnects the
  publisher. The web app should DELETE only after the WHIP session ends.

### Orphan sessions

A browser that closes without calling DELETE leaves an idle path behind. Idle
paths hold no process and consume almost nothing, but they hold **stream keys
in the relay's config**, so they should not accumulate. CORE deployments should
sweep periodically; CLOUD should tie session lifetime to the billing session.
*This sweeper is not implemented yet — see Open items.*

---

## 5. Authentication and secret handling

Three internal users, each with the narrowest permission that works:

| User | Permission | Used by | Reachable from |
|---|---|---|---|
| `livetap` | `publish` on `~^live/.*$` | browser (WHIP), desktop (RTMP) | anywhere |
| `relayapi` | `api` | session-api | private compose network |
| `relayhook` | `read` on `~^live/.*$` | the transcode hook | loopback inside the container |

There is no `any` user. That denies anonymous publish and anonymous read, and
also removes MediaMTX's stock "localhost may use the API without auth" rule.

**No password lives in `mediamtx.yml`.** All three are injected through
`MTX_AUTHINTERNALUSERS_<n>_PASS` environment variables, which can both replace
and append list entries.

### The Control API is a stream-key oracle

MediaMTX redacts `pass` in API responses but **not** `forward[].dest` or
`runOnAvailable` — both carry platform stream keys in plaintext. Anyone who can
reach `:9997` can read every connected user's keys. Hence:

* the API port is never published to the host;
* `relayapi` is a different credential from the browser-facing token, so a
  leaked page token cannot reach the API.

### Shell injection is the hook's cost

`runOnAvailable` is executed via `sh -c` and contains user-supplied URLs and
stream keys. The character whitelist in `validateIngest()` — rejecting
``[\s"'`$;|&<>]`` — is a **security control, not input polish**. It is the only
thing between a malicious stream key and RCE on the relay. It is pinned by
explicit injection tests, and it is the one rule in this system that must never
be relaxed for convenience.

### Keys in logs

Every destination passes through `redactIngest()` before any log call
(`••••` + last 4). There is no verbosity flag that disables it, error responses
to clients are deliberately vague, and a unit test asserts keys stay out of the
logs.

---

## 6. TLS and network exposure

MediaMTX's own TLS is left **off**; TLS terminates in a reverse proxy (Caddy
example in `infra/relay/README.md`). Browsers require a secure context for
`getUserMedia`, so production needs HTTPS regardless.

**A reverse proxy cannot carry the media.** WebRTC media is DTLS-SRTP over UDP
on :18189 and must reach the host directly. Proxying the signalling while
forgetting the UDP port is the classic failure: WHIP negotiates, then dies with
`deadline exceeded while waiting connection`. `webrtcAdditionalHosts` must also
advertise the publicly reachable name, because inside a container MediaMTX can
only see bridge addresses.

Restrictive corporate NAT needs a TURN server (coturn) in `webrtcICEServers2`.
Budget for it; it is not optional for a general audience.

---

## 7. Scaling

**Bandwidth is the binding constraint, not CPU.** One 1080p session at 6 Mbps
to four destinations is 6 Mbps in and 24 Mbps out. CPU per session measured at
720p30: ~3% of a core pass-through, ~12–15% with the audio transcode, ~30% with
a 9:16 re-encode. A 4-core relay runs out of egress long before it runs out of
CPU.

Scaling steps, in the order they should be taken:

1. **Vertical first.** Cheap, and a single relay comfortably handles a small
   deployment.
2. **Shard by session.** Sessions are wholly independent — no shared state
   between paths. Run N relays and have session-api pick one, returning that
   relay's hostname in `whipUrl`. This is the natural scale-out and needs only
   a session→relay mapping.
3. **Split the control plane.** session-api is stateless; the only state is
   MediaMTX's path config. To run several session-api replicas against several
   relays, move the mapping into a shared store.
4. **Don't re-encode video.** Force H.264 in the browser's SDP so pass-through
   stays possible. A browser that can only offer VP8 turns a ~0.13-core session
   into a multi-core one; detect it and say so rather than absorbing the cost
   silently.

Per-session isolation is already strong: separate paths, separate FFmpeg
processes, separate `tee` slaves with `onfail=ignore` **and** `use_fifo`
recovery. One destination, one session, or one encoder failing cannot touch
another, and a destination that drops rejoins on its own without restarting
the encoder (ADR-008). `drop_pkts_on_overflow=1` supplies the other half of
ADR-005's backpressure rule: a stalled destination drops its own packets rather
than stalling the ingest.

---

## 8. The CORE / CLOUD boundary (ADR-009)

**This compose stack is LIVETAP CORE.** MIT, self-hostable, no account, no
billing, no telemetry. A user who wants the web app to go live runs it on their
own box and points the web app at it. It is a complete product on its own.

**LIVETAP CLOUD**, if it ever exists, is *the same session-api behind auth and
billing*. The relay itself does not change:

| | CORE (this directory) | CLOUD (future, optional) |
|---|---|---|
| Who runs it | the user | LIVETAP |
| session-api auth | one shared relay token | per-user identity, quotas, billing |
| Publish credential | one static password | short-lived per-user JWT, `authMethod: jwt` |
| Relay selection | the one you run | geo-routed pool |
| Recording | none (desktop records locally) | cloud recording sink |
| Cost | your server | metered |

The seam is deliberate and already visible in the code: `session-api` is the
only component that knows *who* a user is and *which* relay to use. Swapping
its auth for JWTs and its single relay for a pool is the entire difference.
MediaMTX's `authMethod: jwt` with a `mediamtx_permissions` claim is the
intended CLOUD publish path, which is why the browser never learns anything
about the relay beyond a URL and an opaque token.

The rule from ADR-009 holds: **the UI never assumes cloud exists.** The web app
talks to `VITE_LIVETAP_RELAY_URL`, and whether that is `127.0.0.1:18080` or a
managed endpoint is a deployment detail, not a code path.

---

## 9. Open items

* **Browser H.264 negotiation is unverified** (`docs/qa/RELAY_VERIFICATION.md`
  B1). The single most important open question for the web architecture: if a
  browser offers only VP8, pass-through is impossible. Test Chrome, Edge,
  Firefox and Safari before committing to the web go-live path publicly.
  **This is now answerable on a developer workstation without the VPS and
  without Docker.** `infra/dev-harness/ingest/mediamtx.dev.yml` carries an
  opt-in WHIP profile: set `LIVETAP_DEV_INGEST_WHIP=1` and the dev receiver
  also accepts WHIP on `127.0.0.1:8889`, with the same control API and the same
  ffprobe evidence the RTMP path already produces, so what a browser actually
  negotiated becomes a probe result rather than an argument. It stays loopback
  only: the WebRTC media port is pinned to `127.0.0.1:8189` and the ICE server
  list is empty, because a STUN lookup is an egress a dev harness must never
  make. **That receiver is not this relay** and must never be deployed; it is
  unauthenticated by design and records everything, which is the opposite of
  what `infra/relay/` does on purpose.
* **`docker compose up` is unverified** — the build host has no nested
  virtualisation. Every relay behaviour was verified with the identical binary
  and config; container packaging was not.
* **No orphan-session sweeper.** Abandoned paths retain stream keys.
* **Long-run A/V drift** — non-monotonic DTS warnings persist at a low rate
  when copying video from a WebRTC source. FFmpeg self-corrects and receivers
  accept the stream, but this needs a multi-hour broadcast against a real
  platform before it is considered settled.
* **No TURN server** is shipped. Required for restrictive NAT.
