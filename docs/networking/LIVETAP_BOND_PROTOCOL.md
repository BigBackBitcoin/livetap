# LIVETAP Bond — wire protocol

**Status: DESIGNED, NOT BUILT.** No code in this repository speaks this protocol yet. The
scheduler and reassembler that will sit either side of it exist and are tested
(`packages/bond/src/transport/`); the bytes on the wire do not.

## 1. Why we are not using SRTLA's wire

SRTLA solved this problem first and solved it well, and we are not using it. Three reasons, all
disqualifying on their own:

1. **AGPL-3.0.** `github.com/BELABOX/srtla` is AGPL. Shipping the sender is distribution; running a
   modified receiver is caught by §13. LIVETAP is MIT.
2. **The reference receiver is abandoned by its own author.** BELABOX's README: `srtla_rec` is
   *"unsupported, no longer under development and not suitable for production deployment."*
3. **It has no authentication.** The only credential is a 256-byte group ID sent in cleartext. Any
   sender presenting a known ID, from any source address, joins that group and can inject into a
   live broadcast. There is no key, no signature, no access control.

Point 3 is the one that settles it. Even with a compatible licence we would have had to replace the
security model entirely, and at that point wire compatibility buys nothing — we own both ends.

## 2. What the protocol has to do

Only four things. Everything else belongs to SRT, to the reassembler, or to the policy engine.

1. Carry opaque media chunks from device to relay over N independent UDP flows.
2. Let the relay know which session and which path a datagram belongs to, without trusting it.
3. Report per-path delivery back to the sender so the scheduler can measure capacity.
4. Be unforgeable, unreplayable, and confidential.

It does **not** do congestion control, retransmission or reordering. Those live above it.

## 3. Framing

```
┌──────────────────────────────────────────────────────────────┐
│ CLEARTEXT HEADER (16 bytes) — routable, unauthenticated      │
│   u8    version           protocol version, currently 1      │
│   u8    type              DATA | PATH_HELLO | ACK | BYE      │
│   u16   pathId            which path this datagram came down │
│   u64   sessionId         opaque, random, per broadcast      │
│   u32   counter           nonce counter, never repeats       │
├──────────────────────────────────────────────────────────────┤
│ AEAD CIPHERTEXT                                              │
│   u32   seq               media chunk sequence number        │
│   u64   timestampUs       presentation timestamp             │
│   u8    frameType         key | inter | audio                │
│   u8    flags             DUPLICATE, END_OF_STREAM           │
│   u16   payloadLen                                           │
│   ...   payload           opaque media                       │
├──────────────────────────────────────────────────────────────┤
│ AEAD TAG (16 bytes)                                          │
└──────────────────────────────────────────────────────────────┘
```

`sessionId` and `pathId` are cleartext because the relay must route a datagram to the right
reassembly state before it can decrypt it, and it must do that cheaply — a relay that has to try
every session's key against every datagram is a denial-of-service target with a free amplifier.
They are **not trusted**: the AEAD tag covers them as associated data, so a forged header fails
authentication and is dropped without touching session state.

MTU is 1200 bytes of payload by default — deliberately below the 1500 Ethernet MTU, because a
bonded stream crosses cellular networks where the effective MTU is lower and a fragmented datagram
is a datagram lost twice.

## 4. Cryptography — which we are not inventing

**Noise IK over ChaCha20-Poly1305, with X25519 static keys.**

- **Noise IK** because the initiator knows the responder's static key ahead of time (the relay's
  key is handed out with the session), it gives mutual authentication and forward secrecy in one
  round trip, and it is a small, specified, widely reviewed pattern. It is what WireGuard uses,
  for the same reasons.
- **ChaCha20-Poly1305** because the sender is frequently a phone without AES hardware, where
  ChaCha is both faster and constant-time by construction.
- **Not DTLS** because DTLS gives us a stream abstraction we do not want, a handshake we do not
  need, and a much larger attack surface for exactly the four jobs in section 2.
- **Not our own anything.** Section 45 of the brief and plain good sense.

The handshake runs **once per session, on the first path to come up**. Additional paths do not
re-handshake: they send `PATH_HELLO` authenticated under the session key, which is what makes
adding a path cheap enough to do mid-broadcast when Wi-Fi dies.

### Nonce discipline

The AEAD nonce is `pathId ‖ counter`. Each path owns a disjoint counter space, so two paths can
never collide, and a counter is never reused within a session. A path that exhausts its counter
space forces a rekey. This is the single most important invariant in the protocol: nonce reuse
under ChaCha20-Poly1305 is catastrophic, not merely weak.

### Replay

The relay keeps a sliding replay window per path, as in IPsec. A datagram whose counter is below
the window, or already seen within it, is dropped before decryption state is touched.

## 5. Authentication of the session itself

The relay must know that this device is allowed to publish to this destination. SRTLA's answer was
a bearer string; ours is:

1. LIVETAP's broker issues a short-lived **session token** (JWT, EdDSA-signed, minutes not hours)
   naming the session id, the permitted destinations, and a bitrate ceiling.
2. The device presents it inside the Noise handshake payload, so it is encrypted and bound to the
   handshake.
3. The relay verifies the signature offline — no callback, so a broker outage cannot stop a
   broadcast that has already started.

A stolen token is bounded by its expiry and cannot be replayed onto a different session id.

## 6. Feedback: `ACK`

The relay sends an `ACK` back down **each path**, roughly every 50 ms, carrying:

```
u32  highestContiguousSeq     what has been fully reconstructed
u32  receivedOnThisPath       count, for per-path goodput
u32  lostOnThisPath           gaps attributed to this path
u16  reorderDepthMs           how long the buffer is currently holding
```

Sent per path rather than once, because the whole point is measuring paths **independently**. An
ACK that arrives over Wi-Fi tells us nothing about cellular's health, and a bonding engine that
cannot distinguish them cannot allocate.

These four numbers are exactly what `PathSample` needs, which is not a coincidence — the sample
type was designed against this feedback.

## 7. Path lifecycle on the wire

| Event | Wire |
|---|---|
| First path comes up | Noise IK handshake, then `DATA` |
| Second path comes up | `PATH_HELLO` under the session key, relay replies `ACK`, then `DATA` |
| Path degrades | Nothing. The scheduler simply sends less down it |
| Path dies | Nothing is sent. The relay notices via ACK-less silence and reports the path idle |
| Path recovers | `PATH_HELLO` again, with a fresh `pathId` |
| Broadcast ends | `BYE` down every live path; relay flushes and closes |

A dying path sends nothing at all, on purpose. A "goodbye" that has to travel down a broken link is
a message that will not arrive, and building behaviour on it would mean the common case — the path
that vanished without warning — is the untested one.

## 8. What this protocol deliberately does not have

- **No retransmission.** Live video has a deadline; a chunk that missed it is worthless. Loss is
  handled by keyframe duplication ahead of time and by the reassembler's bounded wait.
- **No FEC in v1.** Selective duplication of keyframes and audio is simpler, is already built, and
  spends bandwidth only where it buys something. FEC is worth revisiting once there is real
  telemetry to justify a parity scheme.
- **No congestion control of its own.** Rate is set by the policy engine from measured capacity,
  and the encoder ceiling closes the loop. Per-path senders competing with their own control loops
  is exactly the uncoupled-sender problem section 23 warns about.
- **No relay-initiated paths.** The relay never dials the device. Every flow is client-initiated
  outbound UDP to one public host, which is what makes NAT traversal a non-problem.

## 9. Open questions

Honest list of what is not yet settled.

1. Rekey interval, and whether a long broadcast needs one before counter exhaustion in practice.
2. Whether `pathId` should be random rather than sequential, to avoid leaking path count to a
   passive observer. Leaning yes; it costs nothing.
3. MTU discovery, or a fixed conservative 1200. Leaning fixed, because discovery mid-broadcast is
   another failure mode for very little gain.
4. Whether the relay should accept a session over TCP as a last resort when UDP is entirely
   blocked. This would be a single-path fallback, not bonding, and may belong in the product rather
   than the protocol.
