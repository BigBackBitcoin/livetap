# LIVETAP CORE relay

The self-hosted relay that lets the **web** app go live.

A browser cannot open an RTMP socket, so it publishes over **WHIP** (WebRTC-HTTP
Ingestion Protocol, [RFC 9725]) to this relay, which fans the stream out to
every RTMP/RTMPS destination the user selected. The user's platform stream keys
never reach the browser.

This is **LIVETAP CORE**: MIT-licensed, self-hostable, no account required.
See [ADR-009](../../ARCHITECTURE_DECISIONS.md) for the CORE/CLOUD boundary and
[`docs/architecture/RELAY_ARCHITECTURE.md`](../../docs/architecture/RELAY_ARCHITECTURE.md)
for the design.

```
browser ──WHIP(H.264+Opus)──▶ MediaMTX ──runOnAvailable hook──▶ ffmpeg ──┬──▶ YouTube  (RTMPS)
                              :8889                     -c:v copy       ├──▶ Twitch   (RTMP)
                                                        -c:a aac        └──▶ Custom   (RTMP)
```

---

## The one thing to understand before you change anything

**WHIP delivers Opus audio. RTMP platforms require AAC.**

MediaMTX has a first-class `forward:` array that fans a stream out to several
servers with no re-encoding, and it looks like the obvious answer. It is not,
for the web path. `forward` is strictly pass-through: its RTMP writer emits an
Opus track **only** if the destination advertises Enhanced RTMP Opus support in
its `fourCcList` handshake, and it contains no transcode path at all. YouTube,
Twitch and TikTok are legacy-RTMP/AAC ([ADR-012]), so a native forward sends
them audio they cannot decode — and it fails *silently*, because MediaMTX
simply drops the unsupported track and keeps forwarding video.

So every session created by `session-api` uses a **`runOnAvailable` hook**
that runs one FFmpeg with `-c:v copy -c:a aac`: video is passed through
untouched, only the audio is re-encoded. Measured cost on the build host:

| Mode | Relay CPU (1280x720@30, 2 destinations) |
|---|---|
| Native `forward` pass-through | ~3% of one core |
| Hook, video copy + Opus→AAC | ~12–15% of one core |
| Hook, full 9:16 re-encode | ~30% of one core |

Each destination is a `tee` slave with `onfail=ignore` **plus** the `use_fifo`
recovery options, so a destination that dies mid-broadcast is retried and
rejoins on its own without restarting the encoder or disturbing its siblings —
verified by killing and restarting a live destination.

Full evidence, including the MediaMTX source that proves the drop:
[`docs/qa/RELAY_VERIFICATION.md`](../../docs/qa/RELAY_VERIFICATION.md).

`forward:` is still the right tool when the **desktop** app publishes here over
RTMP, because that stream is already H.264 + AAC. `pathDefaults.forward` is
left empty and available for exactly that case.

---

## Run it locally

```bash
cd infra/relay
cp .env.example .env
# Fill in the three passwords:
#   openssl rand -base64 32
docker compose up -d
docker compose logs -f mediamtx
```

Create a session and get a WHIP URL:

```bash
curl -X POST http://127.0.0.1:18080/sessions \
  -H "Authorization: Bearer $MTX_PUBLISH_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
        "destinations": [
          {"protocol":"rtmps","url":"rtmps://a.rtmps.youtube.com/live2","streamKey":"xxxx-xxxx","aspectRatio":"16:9"},
          {"protocol":"rtmp","url":"rtmp://live.twitch.tv/app","streamKey":"live_123","aspectRatio":"16:9"}
        ]
      }'
# -> {"sessionId":"…","whipUrl":"http://127.0.0.1:18889/live/…/whip","whipAuthorization":"livetap:…"}
```

Tear the session down when the broadcast ends:

```bash
curl -X DELETE http://127.0.0.1:18080/sessions/<sessionId> \
  -H "Authorization: Bearer $MTX_PUBLISH_PASSWORD"
```

Stop everything:

```bash
docker compose down
```

### Ports

| Host | Container | What |
|---|---|---|
| 19350 | 1935 | RTMP ingest (desktop app, diagnostics) |
| 18889 | 8889 | WHIP signalling (TCP/HTTP) |
| 18189/udp | 8189/udp | WebRTC ICE — **must** be open or WHIP times out |
| 18888 | 8888 | HLS operator preview (requires credentials) |
| 18080 | 8080 | session-api |
| *(none)* | 9997 | Control API — **never published**, see Security |

These are offset from MediaMTX's defaults so this stack can run alongside
another MediaMTX on 1935/8889/8890/9997.

### Testing without a browser

FFmpeg 9 ships a WHIP muxer, so you can drive the whole path from a shell.
Two flags are not optional:

```bash
ffmpeg -re \
  -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
  -c:v libx264 -profile:v baseline -bf 0 -tune zerolatency \
     -pix_fmt yuv420p -preset ultrafast -b:v 2500k -g 60 \
  -c:a libopus -ar 48000 -ac 2 -b:a 128k \
  -whip_flags dtls_active \
  -f whip -authorization "livetap:$MTX_PUBLISH_PASSWORD" \
  "http://127.0.0.1:18889/live/<sessionId>/whip"
```

* `-whip_flags dtls_active` — MediaMTX is the DTLS **server**. Without this
  FFmpeg also waits passively and the session dies with
  `deadline exceeded while waiting connection`.
* `-authorization "livetap:<password>"` — the value is `user:pass`, not a bare
  password. MediaMTX splits the Bearer token on the first colon; a bare
  password is parsed as a JWT and rejected with 401.
* `-profile:v baseline -bf 0` and `libopus` are required by the WHIP muxer, and
  both a video and an audio track must be present.

---

## Pointing the LIVETAP web app at it

```bash
# apps/web/.env.local
VITE_LIVETAP_RELAY_URL=http://127.0.0.1:18080
VITE_LIVETAP_RELAY_TOKEN=<the same value as MTX_PUBLISH_PASSWORD>
```

The web app then:

1. `POST {VITE_LIVETAP_RELAY_URL}/sessions` with `Authorization: Bearer
   {VITE_LIVETAP_RELAY_TOKEN}` and the destination list, receiving
   `{ sessionId, whipUrl, whipAuthorization }`.
2. Publishes to `whipUrl` with
   `Authorization: Bearer {whipAuthorization}` on the WHIP `POST`.
3. `DELETE {VITE_LIVETAP_RELAY_URL}/sessions/{sessionId}` when the user stops.

**Force H.264 in the browser's SDP.** Pass-through only works if the browser
offers H.264; if it can only offer VP8 the relay would have to re-encode video
too. Reorder `RTCRtpSender.getCapabilities('video').codecs` to put H.264 first
before `setLocalDescription`, and if H.264 is unavailable, say so plainly
rather than going live with a stream the relay must transcode.

> `VITE_` variables are compiled into the JavaScript bundle and are visible to
> anyone who opens the page. `VITE_LIVETAP_RELAY_TOKEN` is therefore **not** a
> user secret — it is a shared relay credential, fine for a single-tenant
> self-hosted relay on a trusted network. For a multi-user deployment, replace
> it with short-lived per-user JWTs (`authMethod: jwt`); see
> [`RELAY_ARCHITECTURE.md`](../../docs/architecture/RELAY_ARCHITECTURE.md).

---

## Security

### Never expose the Control API

MediaMTX redacts `pass` fields in API responses. It does **not** redact
`forward[].dest` or `runOnAvailable`, both of which contain platform stream keys
in plaintext. A reachable `:9997` is a full credential breach for every
connected user. `docker-compose.yml` does not publish it, and the config binds
it inside the private compose network only. Do not "just add the port for
debugging" — use `docker compose exec mediamtx wget -qO- ...` instead.

### How stream keys stay server-side

* The browser sends its destination list to `session-api` **once**, over TLS.
* `session-api` writes them into MediaMTX's path config and returns only a
  `whipUrl`. Keys are never sent back to any client.
* Every log line goes through `redactIngest()` (`••••` + last 4 chars). There is
  no debug flag that turns this off, and a unit test asserts keys stay out of
  the logs.
* Error responses are deliberately vague (`"Relay error."`) so a failing
  destination cannot echo a key back to the browser.

### Publish authentication

Three separate internal users, each with the narrowest permission that works:

| User | Can | Cannot |
|---|---|---|
| `livetap` | publish to `~^live/.*$` | read, use the API |
| `relayapi` | use the Control API | publish, read media |
| `relayhook` | read `~^live/.*$` from **loopback only** | publish, use the API |

There is no `any` user, so anonymous publish and anonymous read are both
refused — and so is MediaMTX's stock "localhost may use the API without auth"
rule.

`paths:` is empty, and there is no catch-all template. **A stream can only be
published to a path `session-api` has explicitly created.** A leaked publisher
password on its own cannot push media anywhere.

### Shell-injection surface

`runOnAvailable` is executed through `sh -c`, and it contains user-supplied
URLs and stream keys. The character whitelist in `validateIngest()`
(rejecting ``[\s"'`$;|&<>]``) is therefore a **security control, not input
polish**. Do not relax it. `relay-session.test.mjs` pins it with explicit
injection payloads.

### TLS

Browsers require a secure context for `getUserMedia`, so production needs HTTPS
in front of the relay. Terminate TLS in a reverse proxy and keep MediaMTX's own
encryption off:

```caddyfile
# Caddyfile
relay.yourdomain.com {
        # WHIP signalling + HLS preview
        reverse_proxy /live/* 127.0.0.1:18889
        reverse_proxy /hls/*  127.0.0.1:18888

        # session-api
        handle /sessions* {
                reverse_proxy 127.0.0.1:18080
        }

        header {
                Strict-Transport-Security "max-age=31536000; includeSubDomains"
                X-Content-Type-Options nosniff
        }
}
```

Then set, in `.env`:

```
LIVETAP_RELAY_PUBLIC_HOST=relay.yourdomain.com
LIVETAP_RELAY_PUBLIC_WHIP_PORT=443
LIVETAP_RELAY_PUBLIC_WHIP_SCHEME=https
```

**UDP 18189 is not proxied.** WebRTC media bypasses Caddy entirely and must
reach the host directly, so open that port in your firewall. If your users sit
behind restrictive NAT you will also need a TURN server (coturn) wired into
`webrtcICEServers2` — a reverse proxy cannot substitute for it.

Also narrow `webrtcAllowOrigins` in `mediamtx.yml` from `["*"]` to your web
app's origin before going to production.

---

## Tests

```bash
node --test infra/relay/session-api/
```

Zero dependencies, plain Node 20 — no workspace install required. The suite
covers ingest validation (kept in lockstep with
`packages/core/src/validation/ingest.ts`), shell-injection rejection, hook
construction, redaction, and the HTTP surface against a fake MediaMTX.

---

## Verification status

Everything in this directory was verified end-to-end against MediaMTX v1.21.0
**except `docker compose up` itself**, because the build host is a VM without
nested virtualisation and cannot run a Docker daemon at all. The relay
behaviour was proven with the identical binary and the identical
`mediamtx.yml`. See [`docs/qa/RELAY_VERIFICATION.md`](../../docs/qa/RELAY_VERIFICATION.md)
for exact commands, outputs, and what remains unverified.

[RFC 9725]: https://datatracker.ietf.org/doc/rfc9725/
[ADR-012]: ../../ARCHITECTURE_DECISIONS.md
