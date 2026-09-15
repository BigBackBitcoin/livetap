# LIVETAP Bond — integration status

Written before the integration work, from reading the code rather than the previous documents.
Updated as the work lands.

## 1. The finding that decides the design

The desktop broadcast path already has exactly the seam Bond needs, and it is not where the
previous session's architecture diagram assumed.

```
Renderer                         Main process
─────────────────────────────────────────────────────────────────────────
DesktopEngine
  FormatRenderer  (one canvas per aspect)
  MediaRecorder   (real Chromium H.264 + AAC)
        │
        │ window.livetap.engine.pushChunk(aspect, ArrayBuffer)   ← contextBridge IPC
        ▼
                                 FfmpegEngine
                                   encoder child per aspect   (stdin ← chunks)
                                        │ stdout = MPEG-TS
                                        ▼
                                   fanout.ts
                                   ├──▶ sink: ffmpeg -c copy ──▶ rtmp://youtube
                                   ├──▶ sink: ffmpeg -c copy ──▶ rtmp://twitch
                                   └──▶ sink: recording file
```

`fanout.ts` already guarantees, with unit tests:

1. **The source is never paused.** A wedged sink cannot apply back-pressure to the encoder.
2. **Every live sink receives every byte, in order.**
3. **A sink that errors is removed and reported; the others keep going.**
4. **Writes are aligned to whole 188-byte TS packets.**

Those are precisely the four properties a bonding sender needs from its input. So:

> **Bond is a new sink type in the existing fan-out, not a new pipeline.**

This matters more than it looks. It means Bond can be added without touching the encoder, the
compositor, the IPC bridge, or any existing sender — which is what makes §34's "no degradation in
the existing broadcast" achievable rather than hoped for. A Bond destination and a direct RTMP
destination can run side by side in the same broadcast, which also makes them directly comparable.

### The chunk size falls out of it

188-byte TS packets, 7 to a datagram, is 1316 bytes — the classic MPEG-TS-over-UDP payload, chosen
because it fits under every MTU including cellular. So `BondChunk` is 7 TS packets, and the
sequence number is the datagram index. No re-framing, no codec parsing.

### Keyframe awareness without inventing codec assumptions

§20 warns against unsafe codec assumptions, and it is not needed here: the MPEG-TS adaptation field
carries a **random access indicator** bit. Reading a standard container field is not parsing H.264.

## 2. What exists, judged by reading it

| Component | Verdict | Why |
|---|---|---|
| `path/types.ts` | **Keep as-is** | The path-vs-radio distinction is right and is enforced by the types |
| `path/stateMachine.ts` | **Keep as-is** | Pure, 21 tests, drives from events — real monitor can feed it unchanged |
| `path/capacity.ts` | **Keep as-is** | Three real bugs already burned out of it |
| `path/discovery.ts` | **Keep the contract, implement adapters** | `PathDiscovery` is an interface with no implementations |
| `scoring/score.ts` | **Keep as-is** | Consumes `PathSample`, which a real monitor can produce |
| `policy/decide.ts` | **Keep as-is** | Pure function; needs real inputs, not changes |
| `transport/reassemble.ts` | **Keep, wire to the wire** | `Reassembler` is exactly what the relay needs |
| `transport/schedule.ts` | **Keep, wire to the wire** | Byte-fair, already handles duplication |
| `lab/` | **Keep, extend** | Drives the real policy engine already |
| `telemetry/` | **Empty directory** | Nothing to keep |

**Nothing needs redesigning.** Every module above takes or returns plain data, which is what makes
them wirable. The gap is entirely "there is no code that opens a socket".

## 3. What does not exist

| Required | State before this mission |
|---|---|
| Bond client (session, lifecycle, sockets) | Does not exist |
| Wire protocol | Documented only |
| Relay | Documented only |
| Crypto | Documented only |
| Desktop path discovery | Does not exist |
| Android path discovery | Documented only |
| Telemetry | Empty directory |
| Network UX | Does not exist |
| Encoder coupling | `encoderCeilingBps` computed and sent nowhere |
| **Production consumers** | **Zero** |

## 4. Dependency graph

**Before this mission:**

```
@livetap/bond ──▶ (nothing)
(nothing) ──▶ @livetap/bond
```

An island. 149 tests, zero consumers. The condition §36 forbids.

**Now:**

```
@livetap/bond ──▶ node:dgram, node:crypto, node:stream        (nothing else)

apps/desktop  FfmpegEngine ──▶ BondClient, BondSink, importPublicKey
infra/dev-harness/bond      ──▶ BondClient, BondSink, BondRelay, secure
```

`apps/desktop/package.json` depends on `@livetap/bond`; `FfmpegEngine` imports it at the top of the
file and constructs a real session. That is a production consumer, not a seam.

The direction of the edge matters: Bond depends on nothing in this repo - not even
`@livetap/core` - because the relay is a server with no notion of Moments, destinations or
production state, and an edge to the broadcast domain would make it unrunnable there.

## 5. What was done

| # | Item | State |
|---|---|---|
| 1 | Desktop path discovery | **done** — `discoverDesktopPaths()`, real interfaces, loopback and link-local excluded |
| 2 | Bond client | **done** — sockets, path registry, pacing, retransmit, policy loop, telemetry |
| 3 | Wire protocol with real crypto | **done** — X25519 + HKDF + ChaCha20-Poly1305 + Ed25519, all from Node's own `crypto` |
| 4 | Relay | **done** — authenticates, replay-checks, reassembles, forwards RTMP with `-c copy` |
| 5 | Integration at the fan-out | **done** — `BondSink` is a `Writable`; `FfmpegEngine` attaches it |
| 6 | End-to-end proof | **done** — single path exact: 4566/4566 chunks, zero loss, 14.63 s recorded |
| 7 | Telemetry | **partial** — real per-path numbers from the client; no UI |
| 8 | Multi-path over loopback | **partial** — two real sockets prove the mechanism; failover loses media (below) |

### The integration, in full

`DesktopEngineOutput` gained one optional field, `viaBond`. When it is set and a relay is
configured, `startSender` attaches a `BondSink` instead of spawning an `ffmpeg -c copy` child.
Everything else about that destination is unchanged.

When it is absent - which is the default and what ships - the Bond branch is never reached and the
broadcast path is byte-for-byte what it was before. That is the brief's §58 expressed as a type
rather than as a promise.

A relay that cannot be reached is logged and degrades: the session simply does not open, and the
destinations that asked for Bond refuse individually with a reason a creator can read. Experimental
networking is not permitted to take down the basic broadcast.

## 6. What is still not done

- **FEC, and acknowledgement-driven selective retransmission.** A hard path death loses what was in
  flight, and a hole in MPEG-TS costs a downstream `-c copy` consumer far more than the hole itself:
  measured at 6.3 s of a 14 s broadcast reaching the recording. The test reports that number rather
  than passing a threshold it has not earned.
- **Android native discovery.** The mechanism is confirmed against primary sources
  (`Network.getSocketFactory()`, `CHANGE_NETWORK_STATE`); no Kotlin is written.
- **iOS.** There is no iOS build to put it in.
- **Network UX.** Neither the Simple-mode word nor the Pro-mode path list exists.
- **Encoder coupling.** `encoderCeilingBps` is computed every tick and still goes nowhere.
- **Any real radio.** Loopback exercises every line of the code and proves nothing about a handset
  holding Wi-Fi and cellular at once.

## 6. What will still not be provable here

Stated now so it is not a surprise later. This machine has **one** usable network path. Multi-path
can be proven over loopback with genuinely separate sockets, addresses and scheduling — which
exercises every line of the client, the transport and the relay — but it cannot prove that a phone
holds Wi-Fi and cellular at once. That needs a handset, and it goes in
[`DEVICE_NETWORK_CAPABILITIES.md`](DEVICE_NETWORK_CAPABILITIES.md), which stays empty until then.
