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

## 4. Dependency graph, before

```
@livetap/bond ──▶ (nothing)
(nothing) ──▶ @livetap/bond
```

An island. 149 tests, zero consumers. This is the condition §36 forbids.

## 5. Plan, in the order it will be done

1. **Desktop path discovery** — real interfaces from Node, producing real `PathCandidate`s.
2. **Bond client** — `BondSession`, sockets, path registry, lifecycle.
3. **Wire protocol with real crypto** — X25519 + HKDF + ChaCha20-Poly1305 from Node's own
   `crypto`, no new dependency and no invented primitives.
4. **Relay** — receives, authenticates, reassembles with the tested `Reassembler`, writes TS to an
   ffmpeg `-c copy` child, out to RTMP.
5. **Integration at the fan-out** — Bond as a sink, mode SINGLE.
6. **The single-path gate** — the existing desktop broadcast proof, unchanged, with Bond carrying it.
7. **Telemetry + UX** — real numbers, and one word for the creator.
8. **Multi-path over loopback** — two real sockets, one killed mid-broadcast.

## 6. What will still not be provable here

Stated now so it is not a surprise later. This machine has **one** usable network path. Multi-path
can be proven over loopback with genuinely separate sockets, addresses and scheduling — which
exercises every line of the client, the transport and the relay — but it cannot prove that a phone
holds Wi-Fi and cellular at once. That needs a handset, and it goes in
[`DEVICE_NETWORK_CAPABILITIES.md`](DEVICE_NETWORK_CAPABILITIES.md), which stays empty until then.
