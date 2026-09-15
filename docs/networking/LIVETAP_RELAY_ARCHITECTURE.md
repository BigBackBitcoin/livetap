# LIVETAP Bond — the relay

**Status: DESIGNED, NOT BUILT.** The reassembly logic it will run exists and is tested
(`packages/bond/src/transport/reassemble.ts`). The server does not.

## 1. Why a relay has to exist

YouTube expects one RTMP connection. So does Twitch, and so does everything else. None of them will
ever accept a multipath stream, and none of them can be asked to.

So multipath can only live between the device and something LIVETAP controls. The relay is that
thing, and it is the smallest possible amount of infrastructure that makes bonding real:

```
device ══ N paths ══▶  RELAY  ──1 RTMP──▶ YouTube
                         │    ──1 RTMP──▶ Twitch
                         │    ──1 RTMP──▶ TikTok
                    reassembles once
```

Reassembling once and fanning out is also strictly better than what the desktop app does today,
where every destination is pushed separately from the creator's own uplink. A creator on a 6 Mbps
connection streaming to three platforms currently needs 18 Mbps. Through the relay they need 6.

## 2. Where it cannot run

**Not Vercel. Not any serverless platform.** This is not a preference:

- It needs a **long-lived process** holding **one publicly addressable UDP port** on a **static IP**.
- It holds **per-session reassembly state in RAM**, across datagrams arriving from **several
  different source addresses**.
- It is **egress-heavy**: one inbound stream becomes N outbound RTMP streams.

Serverless gives none of those. The correct shape is flat-bandwidth bare metal or a VPS with
unmetered transit; hyperscaler egress pricing does not survive contact with video.

LIVETAP's web app stays on Vercel. The relay is a separate thing in a separate place, and the
architecture should keep them separable forever.

## 3. Shape

Four parts, deliberately separate, because the brief's section 28 is right that this must not
become a monolith and section 31 is right that one destination must never be able to hurt another.

```
┌─ INGEST ────────────────────────────────────────────┐
│  one UDP socket, all sessions, all paths            │
│  cheap routing on cleartext sessionId               │
│  replay window + AEAD before any state is allocated │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─ SESSION ───────────────────────────────────────────┐
│  one per broadcast                                  │
│  Reassembler (the tested one)                       │
│  per-path accounting -> ACK                         │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─ ROUTER ────────────────────────────────────────────┐
│  one reconstructed stream in                        │
│  fan-out, no re-encode                              │
└───┬──────────────┬──────────────┬───────────────────┘
    ▼              ▼              ▼
┌ SENDER ┐    ┌ SENDER ┐    ┌ SENDER ┐
│YouTube │    │ Twitch │    │ TikTok │   one process-isolated RTMP sender each
└────────┘    └────────┘    └────────┘
```

### The isolation rule

**A destination failure must not touch the reconstructed stream.** A sender that stalls, a platform
that rejects a key, a TCP connection that dies — each takes down exactly one sender and nothing
else. This is the same invariant the desktop `FfmpegEngine` already enforces with one child process
per destination, and the relay inherits it rather than inventing a new answer.

The corollary: a sender may never apply back-pressure to the session. A slow destination drops
frames on its own output; it does not slow the stream down for everyone else.

## 4. Ingest, and why the order of operations matters

A public UDP port that does work before authenticating is a free amplifier and a free DoS target.
So, in order:

1. Read the 16-byte cleartext header. Reject anything malformed.
2. Look up `sessionId`. **Unknown session + not a handshake → drop, no allocation.**
3. Check the per-path replay window. **Out of window or already seen → drop.**
4. Verify the AEAD tag, with the cleartext header as associated data. **Fail → drop.**
5. Only now may the datagram touch reassembly state.

Handshakes are rate-limited per source address. A session is never created by a datagram that has
not authenticated.

## 5. Reassembly

The relay runs `Reassembler` from `packages/bond` — the same code, not a port. That is the point of
having written it as pure logic: the thing tested against 300 chunks striped over 20 ms and 180 ms
paths is the thing that runs in production.

Per session it holds: the reorder buffer, `nextExpectedSeq`, a per-path replay window, and per-path
counters for the ACK. State is bounded by `maxDepth`; a session that exceeds it releases early
rather than growing.

## 6. Output

The reconstructed chunk stream is already H.264 + AAC — the device encoded it. **The relay does not
re-encode.** Re-encoding would cost CPU per destination, add latency, and lose quality for nothing;
the desktop app already proved the `-c copy` fan-out model works, with three simultaneous
recordings decoded by ffprobe.

Per-format output is likewise the device's job: the compositor already produces one picture per
aspect ratio and the encoder produces one elementary stream per format. The relay routes; it does
not transform.

## 7. Health, and what it reports

Section 32's list, per session:

| | |
|---|---|
| inbound | aggregate bps, per-path bps, per-path loss, reorder depth, `maxHeldMs` |
| reconstruction | chunks emitted, lost, duplicates, too-late, forced releases |
| outbound | per-destination connection state, bytes written, last error |
| process | CPU, memory, session count |

`maxHeldMs` is the number that matters most and the one nobody else reports: **how much latency
bonding actually cost this broadcast**. A product that adds delay should be able to say how much.

The creator sees none of this. They see `Excellent`. Pro mode gets the per-path rows.

## 8. Authentication

See [`LIVETAP_BOND_SECURITY.md`](LIVETAP_BOND_SECURITY.md). In short: a short-lived EdDSA-signed
session token, presented inside the Noise handshake, verified **offline** so a broker outage cannot
end a broadcast already in progress.

Note what this moves: **destination stream keys live on the relay, not on the device.** That is
strictly better than today, where the desktop app holds them in order to push RTMP itself.

## 9. Capacity and cost

One session at 6 Mbps in, three destinations out, is 6 Mbps ingress and 18 Mbps egress. The binding
constraint is egress bandwidth, not CPU — there is no transcoding.

Reassembly is cheap: a map, a counter and a bounded buffer per session. Thousands of sessions per
box is a bandwidth question long before it is a compute question.

## 10. What is not decided

1. Whether to fan out to destinations from the relay at all, or to hand the reconstructed stream
   back to the existing per-destination senders. Fanning out at the relay saves the creator's
   uplink, which is a large user-visible win; it also puts LIVETAP in the path of every broadcast,
   which is an operational commitment worth being deliberate about.
2. Geographic placement. One relay is a single point of failure and a latency tax for anyone far
   from it. Regional relays are the obvious answer and the obvious complexity.
3. Whether a session may migrate between relays mid-broadcast. Probably not for v1.
4. Whether to build on `irl-srt-server` (MIT) or from scratch. Building on it buys a working SRT
   terminator and an HTTP stats API; building fresh avoids carrying SRT at all, which we may not
   need given we own both ends.

## 11. Before any of this is built

The single-path product must keep working perfectly, and it does today: the desktop app captures,
composes two shapes, encodes and publishes two real RTMP streams that a real server accepts and
`ffprobe` decodes. **Bonding is an addition, never a replacement**, and the relay is not on the
critical path for LIVETAP's first real broadcast.
