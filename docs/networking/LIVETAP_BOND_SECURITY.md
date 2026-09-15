# LIVETAP Bond — security

**Status: DESIGNED, NOT BUILT.** Nothing in this repository speaks the Bond protocol yet. This
records the threat model and the decisions, so the first line of transport code is written against
them rather than retrofitted to them.

## 1. The finding that shaped this document

> **SRTLA — the reference implementation for bonded live streaming, the thing BELABOX and every IRL
> rig runs on — has no authentication whatsoever.**

Its only credential is a 256-byte group ID sent in cleartext. A sender presenting a known ID, from
any source address, is admitted to that group. There is no key, no signature, no access control, and
the media itself is unencrypted on the wire.

That is defensible for a hobbyist rig on a known LAN. It is not something LIVETAP can ship, and it
is a large part of why we are not using SRTLA's wire even setting its AGPL licence aside.

## 2. What a multipath relay invites that one TCP connection does not

A single TCP connection has one 4-tuple, and the kernel enforces that packets claiming to be part
of it arrive on it. Bonding throws that away deliberately: N flows, from N different addresses, all
claiming to be one session. Every guarantee has to be rebuilt in the protocol.

| Attack | Why multipath makes it worse | Mitigation |
|---|---|---|
| **Session hijack** | Any source address may legitimately be a new path, so "unknown address" is not suspicious | Noise IK handshake; new paths prove possession of the session key via authenticated `PATH_HELLO` |
| **Injection** | A forged datagram claiming an existing `sessionId` would be reassembled into the broadcast | AEAD over the whole record, with the cleartext header as associated data |
| **Replay** | Duplicates are *expected* — keyframe redundancy sends the same chunk twice — so a naive receiver cannot treat a repeat as an attack | Per-path counter in the nonce plus a sliding replay window, checked before decryption |
| **Path spoofing / traffic steering** | An attacker could register a path to attract a share of the stream | `pathId` is inside the authenticated record; an unauthenticated `PATH_HELLO` is dropped |
| **Amplification / DoS** | A public UDP port that does work before authenticating is a free amplifier | Replay window and AEAD check run before any session state is allocated; handshake is 1-RTT and rate-limited per source |
| **Stream theft** | Media in flight is media a passive observer can record | Everything after the header is encrypted. SRTLA sends media in the clear |

## 3. Cryptography

**Noise IK, X25519, ChaCha20-Poly1305.** Established, specified, widely reviewed. We are not
inventing any of it — the brief's section 45 and plain sense.

- **Noise IK** — the device knows the relay's static key in advance, so mutual authentication and
  forward secrecy land in one round trip. WireGuard uses it for the same reasons.
- **ChaCha20-Poly1305** — the sender is frequently a phone without AES hardware, where ChaCha is
  both faster and constant-time by construction.
- **Not DTLS** — a stream abstraction we do not want and a much larger attack surface for four jobs.

### The invariant that matters most

The AEAD nonce is `pathId ‖ counter`. **Each path owns a disjoint counter space and a counter is
never reused within a session.** Nonce reuse under ChaCha20-Poly1305 is catastrophic, not merely
weak: it leaks the XOR of two plaintexts and breaks the authenticator. A path approaching counter
exhaustion forces a rekey.

This is the single most important line of the eventual implementation and it gets a test that
enumerates counters across simulated path churn.

## 4. Session authorisation

The relay has to know this device may publish to these destinations.

1. LIVETAP's broker issues a short-lived **session token** — EdDSA-signed, minutes not hours —
   naming the session id, permitted destinations and a bitrate ceiling.
2. The device presents it **inside** the Noise handshake payload, so it is encrypted in transit and
   cryptographically bound to the handshake.
3. The relay verifies the signature **offline**. No callback to the broker, so a broker outage
   cannot end a broadcast that is already running.

A stolen token is bounded by expiry and cannot be replayed onto a different session id.

## 5. How this fits LIVETAP's existing credential rules

The rules in `docs/security/REAL_CREDENTIAL_SECURITY.md` apply unchanged, and Bond adds no new
secret to the browser:

- **No client secrets in frontend code.** The relay's static public key is public by definition.
  The session token is short-lived, scoped, and issued by the broker.
- **No tokens in `localStorage`.** The session token lives for the duration of one broadcast in
  memory, in the native layer.
- **Never log a secret.** The existing secret-log tests extend to cover the session token, the
  handshake payload and the session key. `pathId` and `sessionId` are safe to log; nothing else in
  the protocol is.
- **Stream keys stay where they are.** Destination stream keys are held by the **relay**, not the
  device — which is strictly better than today, where the desktop app holds them to push RTMP
  itself.

## 6. Cost as a safety property

Data is the creator's money, and spending it without consent is a security failure in the way that
matters to a person.

- `allowAggregationOnMetered` is **off by default**.
- A bonded 6 Mbps stream burns roughly **2.7 GB/hour**. Any UI that enables metered aggregation
  must state a number of that shape before the switch flips, not after.
- `meteredBudgetBytes` exists in `BondPolicy` as a hard ceiling per broadcast.
- Cellular is used without permission in exactly one case: it is the only path left, and the
  creator already allowed cellular for protection. A broadcast that ends is worse than one that
  cost a few megabytes.

## 7. Licence hygiene

Checked, because a licence problem discovered after shipping is not fixable by a patch.

| Component | Licence | Verdict |
|---|---|---|
| `BELABOX/srtla` | **AGPL-3.0** | **Excluded.** Linking the sender is distribution; running a modified receiver is caught by §13 |
| Moblin | MIT | Safe to read and learn from. Used as a reference for the Apple mechanism only |
| `irl-srt-server` | MIT | Safe, and a candidate relay base if we ever want SRT inside |
| libsrt | MPL-2.0 | Safe. File-level copyleft: modified libsrt files stay MPL, new files do not |
| picoquic / quiche / msquic / quinn | MIT / BSD / MIT / MIT-Apache | Safe, none implements multipath |
| WireGuard kernel/NT code | GPL | **Excluded.** The Noise *pattern* is a specification, not their code |

LIVETAP is MIT. Nothing AGPL enters the client, the relay, or a clean-room reimplementation written
by anyone who has read AGPL source.

## 8. Tests this design owes

To be written with the implementation, not after it.

1. Nonce uniqueness across simulated path churn, including recovery and rekey.
2. Replay window: a captured datagram replayed on the same path and on a different path.
3. Forged `PATH_HELLO` from an unknown key is dropped without allocating session state.
4. A tampered cleartext header fails AEAD (header is associated data).
5. Expired and wrong-session tokens are refused.
6. Secret-log test extended: session token, handshake payload and session key never reach a log
   line, in development or production.
7. A relay under a flood of unauthenticated datagrams keeps serving an authenticated session.
