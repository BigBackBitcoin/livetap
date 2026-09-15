# LIVETAP Bond — architecture

**Status:** decision layer and transport logic built and tested. Wire protocol and relay designed,
not yet built. No radio has been involved in anything below that is marked simulated.

**Date of research:** 2026-09-15. Ten agents, five independent lenses, each conclusion put to an
adversarial reviewer instructed to refute it. Raw output: [`RESEARCH_RAW.json`](RESEARCH_RAW.json).

---

## 1. The one-sentence version

LIVETAP sends one broadcast over every network path the device genuinely has, to a relay LIVETAP
owns, which puts the stream back together and forwards ordinary RTMP to YouTube, Twitch and the
rest — so no destination has to know that multipath happened, and the creator never has to know
either.

## 2. The shape

```
CAPTURE ─▶ COMPOSITOR ─▶ ENCODER
                            │
                            ▼
                    BOND SCHEDULER            (packages/bond, built)
                     byte-fair split
                     keyframe duplication
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
            Wi-Fi       cellular      ethernet     (one UDP socket per path, native layer)
              └─────────────┼─────────────┘
                            ▼
                    LIVETAP BOND RELAY
                     reorder + reassemble       (packages/bond Reassembler, built)
                     authenticate               (designed)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          YouTube        Twitch        TikTok     (ordinary RTMP, isolated per destination)
```

The relay exists because the platforms cannot be changed. YouTube expects one RTMP connection. The
only place multipath can live is between the device and something LIVETAP controls, so that is
exactly where it lives — and not one inch further.

## 3. The transport decision, and why everything else lost

**Chosen: application-level packet bonding over plain UDP, one socket per path, terminated by a
relay we own, with our own authenticated framing.**

Every alternative was investigated and every one is closed. This is not a preference.

### MPTCP (RFC 8684) — rejected, and it is not close

| Platform | Reality |
|---|---|
| Android | `CONFIG_MPTCP` appears nowhere in Google's GKI defconfigs for `android15-6.6` or `android16-6.12`. No `socket(…, IPPROTO_MPTCP)` will succeed. Root does not help; it needs a different kernel. |
| Windows | No MPTCP implementation in any release, Windows Server 2025 included. This alone kills the Electron app on its largest platform. |
| Linux | The socket is unprivileged, but additional subflows need `ip mptcp endpoint` or a netlink path manager — admin-level. An unprivileged Electron app cannot create a second path. |
| macOS | No raw MPTCP socket. Only `URLSession`/`Network.framework`, i.e. HTTP(S). `net.inet.mptcp.allow_aggregate` defaults to **0**. |
| iOS | `.aggregate` — the only mode that actually stripes — is documented by Apple as *"available only for experimentation"* and requires an iPhone in Developer mode with Multipath Networking switched on. It cannot ship. |

And even in a world where it were available everywhere, **MPTCP is reliable, in-order TCP**. One
stalled path head-of-line-blocks the whole live stream. This is why every bonded-IRL product in
existence uses UDP. It is the wrong shape for live video before it is anything else.

### Multipath QUIC — rejected for v1, revisit later

`draft-ietf-quic-multipath-21` (March 2026) sits in the RFC Editor queue after nine years and 21
drafts. More decisively, none of the libraries anyone would ship implement it:

- **msquic** — maintainer, 4 Mar 2025: *"We do not yet support multipath QUIC, nor do we have a timeline."*
- **cloudflare/quiche** — issue #278 open since 2019.
- **quinn** — issue #224 open since 2019.
- **lsquic** — nothing.

`picoquic` (MIT) implements it and is the draft author's testbed: a conformance reference, not an
engineering-supported library to put on a phone. Revisit when there is an RFC and two production
implementations.

### SRT's own connection bonding — rejected

SRT 1.5 has three bonding modes and none of them does what is needed. `broadcast` duplicates
everything, costing 100% overhead per link. `backup` is failover, not aggregation. `balancing` —
the only mode that would actually add capacity — is marked **UNDER DEVELOPMENT** in Haivision's own
documentation.

### SRTLA — the right idea, the wrong licence

SRTLA is the reference design for this problem and it is proven in the field: BELABOX, and on
phones today via Moblin (iOS), Brix and IRL Pro (Android). Its scheduling idea — pick a link per
packet by `window / (in_flight + 1)` — is sound and informed our scheduler.

It cannot be used:

- **`github.com/BELABOX/srtla` is AGPL-3.0.** Linking the sender into the APK or the Electron app
  is distribution of AGPL code. Running a modified `srtla_rec` as the relay triggers §13's
  network-source obligation. LIVETAP is MIT.
- **The reference receiver is abandoned on purpose.** BELABOX's own README: `srtla_rec` is
  *"unsupported, no longer under development and not suitable for production deployment."*
- **SRTLA has no authentication at all.** The only credential is a 256-byte group ID in cleartext.
  Any sender presenting a known ID from any source address is admitted to that group. LIVETAP
  cannot ship an unauthenticated ingest, so this would have had to be fixed regardless.

So: **SRTLA-shaped in its ideas, not in its code and not on its wire.** We own both ends, so we
need no interop, and the authentication gap gets closed rather than inherited. See
[`LIVETAP_BOND_PROTOCOL.md`](LIVETAP_BOND_PROTOCOL.md).

## 4. The constraint that reshapes the product

> **One phone is one cellular path. Wi-Fi + 5G + LTE from a single handset is not a product that
> can be shipped.**

This is the most important sentence in this document, because it is the claim every competitor
makes and it is not true:

- **LTE and 5G on one SIM are one path.** In 5G NSA/EN-DC the split is at PDCP inside the radio
  network; the core sees one bearer and the device holds one IP on one PDN. Android has no second
  `Network`, no second interface, and nothing to bind to.
- **Dual-SIM is not two paths for a normal app.** DSDS hardware transmits on one subscription at a
  time. DSDA hardware can do better, but there is no public API to bind a socket to the non-default
  data subscription. iOS has no DSDA at all.
- **Two Internet-bearing Wi-Fi networks is privileged-only.** Android 13+ has STA/STA multi-internet,
  but it is enabled by `WifiManager#setStaConcurrencyForMultiInternetMode`, which a Play-store app
  cannot call.

**The honest ceiling on a stock phone is TWO paths: Wi-Fi plus one cellular.** Three with a
USB-Ethernet adapter. Desktop does better: Ethernet, Wi-Fi and a USB tether are genuinely separate.

The product copy says two. The capability report says two. Anything else would be the exact claim
this codebase spent its whole life refusing to make.

## 5. What is built today

All of it is transport-agnostic on purpose, so the wire decision above can change without any of it
changing. `packages/bond`, 142 tests.

| Module | What it does | The idea that matters |
|---|---|---|
| `path/types.ts` | The path model | A **path** is a route the OS gave us a bindable handle for and that we have confirmed reaches the relay. A **radio** is hardware, and is never by itself a path. Radio detail is kept out of the types the policy engine can read, so a Wi-Fi band cannot quietly become a bond path. |
| `path/stateMachine.ts` | Nine states, pure function | `DEGRADED` is not `SATURATED`. A degraded path is unwell and should be given less; a saturated path is healthy and simply full because *we* filled it, and taking traffic off it is how an engine spirals. |
| `path/capacity.ts` | Capacity estimation | Capacity you never use is capacity you never discover. A 25 Mbps link carrying 6 Mbps delivers exactly 6, so a naive estimator concludes it cannot carry the stream it is at that moment carrying. Probes upward on clean delivery, pins hard on saturation, stops being optimistic at what is *useful* to believe. |
| `path/discovery.ts` | Platform contract | Built to understate. Returns candidates, not paths; groups Wi-Fi bands and LTE/5G into one uplink; refuses to promise bonding until the platform has been measured. |
| `scoring/score.ts` | Path scoring | Throughput is scored against what the **stream** needs, never in the abstract, and no path is rewarded for being able to carry it twice over. |
| `policy/decide.ts` | The brain | Four modes, hysteresis, headroom, battery, thermal, metered policy, encoder ceiling. Reacts **fast to trouble and slowly to improvement** — the asymmetry that makes a live system feel stable rather than nervous. |
| `transport/schedule.ts` | Byte-fair split | Chunks are not uniform; a keyframe can be 20× an inter-frame, so splitting by **count** produces wildly wrong proportions by **bytes**. Credit accumulation converges exactly. |
| `transport/reassemble.ts` | Ordered reconstruction | Waiting is bounded. A reorder buffer that can stall indefinitely converts one lost packet into a stream freeze. |
| `lab/` | The Bond Lab | Simulated paths **react to load** — queue, then delay, then loss — so the engine is tested against a bottleneck rather than against canned samples. |

## 6. What is not built

Stated plainly so nothing here reads as more finished than it is.

- The wire protocol. Designed in [`LIVETAP_BOND_PROTOCOL.md`](LIVETAP_BOND_PROTOCOL.md), not coded.
- The relay. Designed in [`LIVETAP_RELAY_ARCHITECTURE.md`](LIVETAP_RELAY_ARCHITECTURE.md), not coded.
- Android native path binding. Mechanism confirmed; not written.
- iOS anything. LIVETAP has no iOS build yet.
- **Any measurement on real hardware.** Every number this layer has produced is simulated and says
  so in its own output.

## 7. How it will attach to the product

LIVETAP already broadcasts for real: the desktop app captures through `getUserMedia`, composes one
picture per aspect ratio, encodes with FFmpeg and publishes RTMP that a real server accepts and
`ffprobe` decodes. That path must keep working untouched.

So Bond attaches as an **alternative sender, not a replacement pipeline**:

```
FfmpegEngine ──┬──▶ direct RTMP to destination        (today; unchanged; the fallback forever)
               └──▶ Bond sender ──▶ relay ──▶ RTMP    (when >1 path exists AND policy says so)
```

Section 58 of the brief is the rule: with one path, LIVETAP behaves exactly as it does now. No
error, no extra UI, no degraded mode. Bonding is simply `single`, which is the same thing as not
bonding, and the creator never learns the feature existed.

## 8. What the creator sees

Simple mode, which is what almost everyone will run:

```
NETWORK
● Excellent
```

Pro mode, and only Pro mode, gets paths, throughput and loss. The policy engine's `reason` string
is asserted by a test never to contain a protocol name, a path count, or a percentage — the sentence
is *"Wi-Fi is carrying your stream comfortably."*, never *"MPTCP subflow 3 degraded."*

## 9. Decisions recorded

| # | Decision | Because |
|---|---|---|
| B-1 | App-level UDP bonding, not MPTCP | MPTCP is absent on Android and Windows, entitled-and-experimental on Apple, and is in-order TCP, which head-of-line-blocks live video |
| B-2 | Not multipath QUIC for v1 | Not an RFC; no shippable library implements it |
| B-3 | Our own framing, not SRTLA's wire | SRTLA is AGPL-3.0, its receiver is abandoned by its author, and it has no authentication |
| B-4 | A relay we own and run | Destinations speak RTMP and cannot be changed; multipath has to end somewhere we control |
| B-5 | Two paths on a phone, three on desktop | LTE+5G is one PDN; dual-SIM has no public binding API; multi-internet Wi-Fi is privileged-only |
| B-6 | Decision layer built before transport | Every judgement above is transport-agnostic, so B-1..B-3 can be revisited without rewriting the brain |
| B-7 | Default `adaptive`, metered aggregation **off** | A bonded 6 Mbps stream burns ~2.7 GB/hour. Spending that silently is not a default anyone consented to |
