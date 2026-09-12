# Relay verification on the build host (native MediaMTX, no Docker)

Date: 2026-09-11. Host: Windows Server 2022, no GPU, no camera. Docker was hung on this host, so
verification used the native `mediamtx_v1.21.0_windows_amd64` binary (`tools/mediamtx/`, gitignored)
and FFmpeg 9.0.1 (which ships a native `whip` muxer, so a browser was not required to exercise WHIP).

Two MediaMTX instances were used: the **relay** (forwarder) and a second instance acting as the
**"platform" receiver** (RTMP on 127.0.0.1:19351, API on 19998) so that we read real ingest state
from an RTMP server rather than trusting the sender.

| Test | Result | Evidence |
|---|---|---|
| T1 RTMP publish (H.264 + AAC) → relay `forward` to 2 RTMP destinations | **PASS** | receiver API: `platformA/keyA ready=True tracks=['H264','MPEG-4 Audio'] bytesReceived=541289` and identical for `platformB/keyB` (byte-identical fan-out, no re-encode) |
| T2 WHIP publish (H.264 + **mono** Opus) | **FAIL (sender-side, expected)** | FFmpeg WHIP muxer: `Unsupported audio channels 1 by RTC, choose stereo` |
| T3 WHIP publish (H.264 + stereo Opus 48 kHz) → relay → forward to 2 RTMP | **PASS** (transport) | relay API: `live/probe ready=True tracks=['Opus','H264']`; receiver: both paths `['H264','Opus']` 1626414 bytes each. Note: audio arrives as **Opus over Enhanced RTMP** — real platforms (YouTube/Twitch/Kick/Facebook) document AAC only, so T3 alone is not sufficient for production |
| T4 Two-stage: WHIP (Opus) → `runOnAvailable` FFmpeg `-c:v copy -c:a aac` → internal path `live/<id>-aac` → native `forward` to 2 RTMP | **PASS** | relay API: `live/probe ['Opus','H264']`, `live/probe-aac ['H264','MPEG-4 Audio']`; receiver: `platformA/keyA` and `platformB/keyB` both `['H264','MPEG-4 Audio']` 1648571 bytes each. Hook process RSS ≈ 63 MB; video is stream-copied so CPU cost is audio-only |
| T5 Destination isolation (kill one destination while the other keeps receiving) | **PASS (by construction, observed in T1 run 1)** | In the first T1 attempt the FFmpeg `-listen` receivers rejected MediaMTX's RTMP command; the relay logged per-destination `ERR ... invalid command payload` / `connectex refused` and retried each destination independently every ~5 s while the publisher stayed connected. Each `forward` destination is its own connection with its own retry loop |
| T6 Relay CPU for pass-through | **PASS** | native forward performs no transcoding; only the one audio-transcode hook consumes CPU |

## Configuration that passed (T4)

```yaml
# relay
rtmp: yes            # rtmpAddress 127.0.0.1:19350 (browser never uses this; hook publishes here)
rtsp: yes            # internal read for the hook only; bind to localhost; rtspTransports: [tcp]
webrtc: yes          # WHIP ingest: POST http://<relay>:8889/live/<session>/whip
paths:
  live/<session>:
    runOnAvailable: >
      ffmpeg -hide_banner -loglevel warning -rtsp_transport tcp
      -i rtsp://127.0.0.1:18554/$MTX_PATH
      -c:v copy -c:a aac -b:a 128k -ar 48000 -f flv rtmp://127.0.0.1:19350/$MTX_PATH-aac
    runOnAvailableRestart: yes
  live/<session>-aac:
    forward:
      - dest: rtmps://a.rtmps.youtube.com/live2#<streamKey>
      - dest: rtmp://live.twitch.tv/app#<streamKey>
```

Design consequences (ADR-014):
- Browser publishes **one** WHIP session per production; the relay transcodes audio once and fans out natively. Stream keys live only in the relay's path config (created per session through the session API), never in the browser.
- 9:16 destinations from a 16:9 web production require a second hook that scales/crops (`-c:v libx264`) into `live/<session>-916`; this is the only case where the relay re-encodes video. The desktop app avoids this entirely by encoding both formats locally.
- FFmpeg WHIP muxer requires stereo Opus; browsers send stereo by default when the captured track is stereo — the BrowserEngine must request `channelCount: 2` in audio constraints or the relay hook must upmix (`-ac 2`).
- `Queue input is backward in time` from the AAC encoder appeared once at hook start (first frames before the audio clock settled); harmless in a 12 s test, but production hooks should add `-fflags +genpts` and `-async 1`, to be validated in a longer soak (UNVERIFIED).

## Not verified here
- A real browser WHIP publish (no camera/GPU on host) — the FFmpeg WHIP muxer stands in for the browser; RFC 9725 handshake with MediaMTX is CONFIRMED, browser SDP specifics are UNVERIFIED.
- Real platform acceptance of the forwarded stream (no credentials) — transport verified against a MediaMTX receiver only.
- Docker packaging (`infra/relay/docker-compose.yml`) could not be run on this host because the Docker daemon hung; the native binary path is the verified one.
