# LIVETAP Bond — test plan

What is tested today, what is tested but simulated, and what is not tested at all. The three are
kept visibly separate because conflating them is how a networking layer acquires a reputation it
has not earned.

Run everything: `npm test`. The Bond package alone: `npx vitest run --root packages/bond`.

---

## Tier 1 — built and passing (186 tests)

Pure logic, no network, deterministic.

| Area | File | Tests |
|---|---|---|
| Path state machine | `path/stateMachine.test.ts` | 21 |
| Capacity estimation | `path/capacity.test.ts` | 14 |
| Platform discovery | `path/discovery.test.ts` | 17 |
| Path scoring | `scoring/score.test.ts` | 13 |
| Policy engine | `policy/decide.test.ts` | 29 |
| Ordered reconstruction | `transport/reassemble.test.ts` | 21 |
| Byte-fair scheduling | `transport/schedule.test.ts` | 14 |
| Scenarios 1–15 + invariant | `lab/scenarios.test.ts` | 20 |
| Handshake, AEAD, nonces, replay | `wire/secure.test.ts` | 25 |
| Real sockets, client to relay | `net/loopback.test.ts` | 12 |

### The tests that matter most

These exist because each one is a defect that actually occurred during construction, not a
hypothetical:

1. **`does not write off a standby path for delivering nothing`** — a path carrying no traffic
   delivers 0 bps. Treating that as death meant it could never be given a share, so it could never
   prove otherwise. Every protected-mode spare is in exactly that state.
2. **`gives a recovered path a fresh hypothesis instead of its write-off`** — a write-off outlived
   the failure that caused it, so Wi-Fi came back and the broadcast stayed on cellular for good.
3. **`refuses to probe upward on a path that is losing packets`** — a lossy path kept earning
   optimistic capacity, the engine added imaginary capacity to real capacity, and it reported
   `protected` while the stream starved for 25 seconds.
4. **`treats a cheap wired path as costing nothing in battery`** — the battery term scaled the base
   rather than the penalty, so an Ethernet cable was penalised for the laptop being unplugged.
5. **`splits by bytes, not by chunk count`** — a keyframe can be 20× an inter-frame, so a
   count-based scheduler drowns a small path while believing it is being fair.
6. **`never reports excellent while starving`** — the honesty invariant, asserted across four
   scenarios rather than case by case. Section 49 turned into something a machine checks.

## Tier 2 — simulated, and labelled as such

The fifteen scenarios of the brief's section 39 run against the real policy engine in the Bond Lab.
Simulated links **react to load** — queue, then delay, then loss — so the engine is tested against
a bottleneck rather than against canned samples.

| # | Scenario | Asserts |
|---|---|---|
| 1 | Wi-Fi only | single mode, no starvation, no reallocation |
| 2 | Cellular only | carries it; the alternative is no broadcast |
| 3 | Wi-Fi + 5G | cellular stays on standby under default policy |
| 4 | Wi-Fi + LTE, both small | aggregates, and settles |
| 5 | Three paths | shares sum to 1 |
| 6 | Wi-Fi dies | survives on cellular, gap ≤ 2 s |
| 7 | Cellular dies | Wi-Fi absorbs it, gap ≤ 2 s |
| 8 | Smallest path dies | gap ≤ 1.5 s |
| 9 | Wi-Fi becomes slow | stops calling it excellent |
| 10 | Cellular congests | its share shrinks, the stream does not die |
| 11 | One path goes lossy | demoted below a clean path |
| 12 | Everything degrades | reports it, lowers the encoder ceiling |
| 13 | Primary recovers | rejoins, ≤ 6 reallocations, stable tail |
| 14 | Battery low | fewer radios |
| 15 | Metered, default policy | **zero** bytes of stream over cellular, every tick |

**Every artefact is stamped `[SIMULATED - no radio was involved]` in the text a person reads**, and
`LabResult.simulated` carries it in the data. A lab report that could be mistaken for a device test
is the one artefact this layer must never produce.

Benchmarks regenerate from these runs:

```bash
node packages/bond/scripts/bench.mjs
```

## Tier 2b — proven over real sockets, end to end

`infra/dev-harness/bond/verify-bond-chain.mjs`. Every link is the production one: a real ffmpeg
encode, a real `BondSink`, a real UDP socket, a real X25519 handshake and ChaCha20-Poly1305
records, the real relay running the same tested `Reassembler`, a real `ffmpeg -c copy` to RTMP, a
real MediaMTX, and `ffprobe` decoding what landed on disk.

```bash
node infra/dev-harness/bond/verify-bond-chain.mjs --seconds=14
node infra/dev-harness/bond/verify-bond-chain.mjs --seconds=14 --paths=2 --kill-path-at=6
```

**Single path — PASS, and it is exact.** 4566 chunks scheduled, 4566 reconstructed, zero lost,
14.63 s of a 14 s broadcast recorded, 4,962,464 bytes, H.264 1280x720 + AAC 48 kHz stereo decoded
off disk.

**Two paths, one killed mid-broadcast — the broadcast survives, and the media cost is NOT yet
acceptable.** The failure is detected, traffic moves to the survivor, the stream continues to the
destination. But roughly 230 chunks of 4557 are lost with the dying socket, and a hole in MPEG-TS
costs a downstream `-c copy` consumer far more than the hole itself: 6.26 s of 14 s reached the
recording.

This is stated as a measured number rather than hidden behind a relaxed threshold. **Closing it
needs FEC or acknowledgement-driven selective retransmission, and neither is built.** What exists
today is retransmission triggered by path death, bounded to the freshest 48 chunks - a deliberate
limit, because re-sending the whole backlog was measured and made things WORSE: recovery rose to
134 chunks while reconstruction fell from 4447 to 4315, since the burst delayed live media on the
one path still working.

## Tier 3 — not tested, because it does not exist yet

Stated plainly so nothing above reads as broader than it is.

- **Android native path binding.** Mechanism confirmed against primary sources; not written.
- **iOS anything.** LIVETAP has no iOS build.
- **FEC, and acknowledgement-driven selective retransmission.** The gap measured in Tier 2b.
- **Encoder coupling.** `encoderCeilingBps` is computed and still goes nowhere.
- **Network UX.** No Simple-mode or Pro-mode surface exists.
- **Any real network.** No measurement anywhere in this package has involved a radio, a carrier, or
  a second physical interface. Loopback exercises every line of the code; it proves nothing about a
  phone holding Wi-Fi and cellular at once.

## Tests owed when the transport is built

Written with the implementation, not after.

**Crypto — DONE** (`wire/secure.test.ts`): nonce uniqueness across path churn including recovery and
counter exhaustion; replay on the same path and across paths; a forged reply refused; a tampered
cleartext header failing the tag; expired, wrong-broker and edited tokens refused; a junk HELLO
allocating nothing.

**Still owed:**
1. Secret-log test extended to the session token, handshake payload and session key.
2. A relay under an unauthenticated flood while still serving an authenticated session.
3. MTU behaviour: a datagram that would fragment is rejected at the sender.
4. A relay restart mid-broadcast: what the creator sees, and how fast.
5. The existing desktop broadcast gate, unchanged, with Bond present but `single` — proving the
   brief's §58 rule that one path behaves exactly as it does today.

## The real-device test, when hardware allows

The one that actually proves anything. Not yet run — no device has been measured.

**Setup:** an Android handset, Wi-Fi + one cellular SIM (the honest ceiling; see
`LIVETAP_NETWORK_CAPABILITIES.md`), a relay on a static IP, one real destination.

**Record:** upload per path, latency, loss, battery drain, device temperature, cellular bytes,
stream continuity through a deliberate Wi-Fi kill, and recovery time when it returns.

**Do not fabricate these numbers.** The results go in
[`DEVICE_NETWORK_CAPABILITIES.md`](DEVICE_NETWORK_CAPABILITIES.md), which is currently empty and
says so.
