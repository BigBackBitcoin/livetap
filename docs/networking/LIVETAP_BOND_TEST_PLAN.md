# LIVETAP Bond — test plan

What is tested today, what is tested but simulated, and what is not tested at all. The three are
kept visibly separate because conflating them is how a networking layer acquires a reputation it
has not earned.

Run everything: `npm test`. The Bond package alone: `npx vitest run --root packages/bond`.

---

## Tier 1 — built and passing (149 tests)

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

## Tier 3 — not tested, because it does not exist yet

Stated plainly so nothing above reads as broader than it is.

- **The wire protocol.** No code speaks it. Designed in `LIVETAP_BOND_PROTOCOL.md`.
- **The relay.** No server exists. Designed in `LIVETAP_RELAY_ARCHITECTURE.md`.
- **Android native path binding.** Mechanism confirmed against primary sources; not written.
- **iOS anything.** LIVETAP has no iOS build.
- **Any real network.** No measurement in this package has involved a radio, a carrier, or a
  physical interface.

## Tests owed when the transport is built

Written with the implementation, not after.

**Crypto** (from `LIVETAP_BOND_SECURITY.md` §8):
1. Nonce uniqueness across simulated path churn, including recovery and rekey.
2. Replay window: a captured datagram replayed on the same path and on a different one.
3. Forged `PATH_HELLO` from an unknown key allocates no session state.
4. A tampered cleartext header fails AEAD.
5. Expired and wrong-session tokens are refused.
6. Secret-log test extended to the session token, handshake payload and session key.
7. A relay under an unauthenticated flood keeps serving an authenticated session.

**Transport:**
8. Reassembly under real packet reordering on a loopback socket.
9. MTU behaviour: a datagram that would fragment is rejected at the sender.
10. Path add and remove mid-broadcast with no gap in the reconstructed stream.
11. A relay restart mid-broadcast: what the creator sees, and how fast.

**Integration:**
12. The existing desktop broadcast gate, unchanged, with Bond present but `single` — proving
    section 58's rule that one path behaves exactly as it does today.
13. The same gate with two loopback paths and one killed mid-broadcast.

## The real-device test, when hardware allows

The one that actually proves anything. Not yet run — no device has been measured.

**Setup:** an Android handset, Wi-Fi + one cellular SIM (the honest ceiling; see
`LIVETAP_NETWORK_CAPABILITIES.md`), a relay on a static IP, one real destination.

**Record:** upload per path, latency, loss, battery drain, device temperature, cellular bytes,
stream continuity through a deliberate Wi-Fi kill, and recovery time when it returns.

**Do not fabricate these numbers.** The results go in
[`DEVICE_NETWORK_CAPABILITIES.md`](DEVICE_NETWORK_CAPABILITIES.md), which is currently empty and
says so.
