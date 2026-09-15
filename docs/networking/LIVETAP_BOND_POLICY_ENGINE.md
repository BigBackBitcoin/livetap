# LIVETAP Bond — the policy engine

**Status: BUILT AND TESTED.** `packages/bond/src/policy/decide.ts`, driven by 142 tests including
the fifteen scenarios of the brief's section 39.

`decide()` is a pure function. Everything interesting a bonding engine does is a judgement call
made under changing conditions, and judgement calls that live inside an I/O loop can only be tested
by reproducing the conditions — which for *"5G degrades while Wi-Fi saturates and the battery drops
below 30%"* means owning a radio lab. Here it means writing down the numbers.

## 1. In and out

```
INPUT                          OUTPUT
  paths[]                        mode              what was actually chosen
  policy (creator's choice)      active[]          handle + share + standby
  streamBitrateBps               redundancy        none | keyframe | full
  batteryLevel, charging         targetHeadroomBps
  thermalPressure                usableCapacityBps
  now, previous, previousAt      health            one word for the UI
                                 encoderCeilingBps advice to the encoder
                                 reason            one sentence for a person
```

## 2. The four commitments, in order of how much damage breaking them does

### Never hide a failure

If the paths cannot carry the stream, `health` is `insufficient` and `reason` says so. A bonding
layer that reports EXCELLENT while dropping frames has removed the one signal the creator could
have acted on. A stream that fits *exactly*, with no margin, is `degraded` — fitting is not the
same as being fine.

### Never spend the creator's money without permission

A metered path is not given a share unless `allowAggregationOnMetered` is on, and it is **off by
default**. A bonded 6 Mbps stream burns roughly **2.7 GB/hour**; spending that silently is not a
default anyone consented to.

But "do not spend my data" is not "do not protect my stream". A metered path the creator has not
licensed for carrying is still held **warm on standby** — measured, ready, costing a trickle —
because failing over to a cold path costs a handshake at the exact moment the stream cannot afford
one. Getting this wrong was a real bug: the first version dropped metered paths entirely.

Cellular still carries everything when it is the only thing left. A broadcast that ends is worse
than one that cost a few megabytes, and the creator did say cellular could protect the stream.

### Do not thrash

Reallocation is not free: every change risks reordering at the relay and costs a scheduler reset.
So the engine is **asymmetric** — it reacts fast to trouble and slowly to improvement:

| Change | Speed |
|---|---|
| Add a path, move load off a failing path | immediate |
| Drop a path, shrink the mode | waits out `dwellMs` (8 s) |
| Reallocation smaller than `deadBand` (8%) | ignored entirely |

The reason getting leaner waits: *the usual reason a path looks good again is that we stopped using
it a moment ago.*

### Leave headroom

25% of measured capacity is deliberately left unscheduled. Scheduling 100% guarantees a queue, and
a queue is latency and then loss.

## 3. Mode selection

`policy.mode` is a **ceiling on ambition, not an instruction**. Asking for `aggregated` on a
one-path device gets one path, honestly labelled `single`.

```
single      →  one path, always. The creator said so.
protected   →  one carrier + one warm spare, if anything can stand behind it
aggregated  →  divide the load, if more than one path may carry
adaptive    →  (the default)
                 best path cannot carry the stream    → aggregate
                 best path has comfortable margin     → protect (or single)
                 otherwise                            → aggregate
               then: thermal pressure or a nearly flat battery pulls back
               one step, unless the stream would not otherwise fit
```

"Comfortable" is `1.6 ×` the stream bitrate after headroom, and the path must be `HEALTHY`.
Aggregating when one path already has comfortable margin spends battery and data to buy nothing —
the most common way a bonding product makes a device worse without making a stream better.

## 4. Allocation

Shares are proportional to `usable capacity × score`, so a path that is big but flaky gets less
than its size alone suggests. Then:

- **No path is given more than it can carry.** A share exceeding a path's capacity is a queue by
  another name, and the whole stream ends up waiting for the smallest link.
- **The remainder goes to whoever still has room**, and shares are renormalised to sum to 1.

## 5. Scoring

`packages/bond/src/scoring/score.ts`. Seven terms, all tunable, weights normalised:

| Term | Weight | Note |
|---|---|---|
| loss | 0.25 | Weighted hardest: it is the term a viewer actually sees |
| throughput | 0.30 | Scored **against the stream**, capped at 1 |
| stability | 0.15 | Failure history |
| latency | 0.10 | Modest — this is a broadcast, not a phone call |
| jitter | 0.10 | |
| cost | 0.05 | |
| battery | 0.05 | |

Two decisions worth stating:

**Throughput is relative to the stream.** The same 5 Mbps path is excellent for a 3 Mbps broadcast
and half of a 10 Mbps one. A scorer returning the same number for both has thrown away the only
context that makes it actionable.

**No reward for excess.** A path that can carry the stream twice over scores the same as one that
can carry it once. Otherwise every allocation biases toward one fat path even when spreading the
load is what protects the broadcast.

An unusable path scores **exactly zero**, never merely low — the allocator multiplies by score, and
a sliver of a live broadcast down a dead path is worse than nothing.

## 6. Capacity estimation

The subtlest part, and the source of the worst bug found while building this.

> **Capacity you never use is capacity you never discover.**

A 25 Mbps link carrying a 6 Mbps stream delivers exactly 6 Mbps. An estimator pinned to observed
throughput therefore concludes the path cannot carry the stream it is at that moment carrying
perfectly, and declares the broadcast insufficient.

The fix is what every congestion control does: treat clean delivery as permission to try slightly
more. Probes upward by 1.25× per clean sample; **pins hard to the measured value the moment the
path saturates**; and stops being optimistic at a ceiling of `2 × stream bitrate` — the most it is
*useful* to believe rather than the most that might be true, which keeps the estimate from becoming
a claim the UI cannot back.

Two more rules learned the hard way:

- A path delivering 0 bps **because it was asked for 0** is not dead. Every standby path is in
  exactly that state; writing them off meant they could never be given a share, so they could never
  prove otherwise.
- **A write-off must not outlive the failure that caused it.** Once pinned to zero, a recovered
  path stayed at zero forever — Wi-Fi came back and the broadcast stayed on cellular for good.

## 7. Redundancy

Only ever spends bandwidth it has. Duplicating a keyframe onto a path that is already full turns
one protected frame into two late ones.

- `none` — fewer than two carriers, or margin below 1.2×
- `keyframe` — duplicate keyframes and audio, when degraded with ≥1.4× margin, or when margin ≥2.2×
- `full` — never chosen automatically

Keyframes because a lost keyframe is seconds of visible damage — everything after it references it
— while a lost inter-frame is one flawed frame nobody notices. Audio rides along because silence is
more noticeable than a smeared picture.

## 8. The encoder ceiling

Bond advises; the media layer owns the encoder. Movement is in 500 kbps steps, **down quickly and
up reluctantly**: an encoder that chases capacity produces a visibly pumping picture, which is a
worse artefact than simply running a little below the maximum.

## 9. What the creator reads

`reason` is asserted by a test never to contain a protocol name, a path count, a bitrate or a
percentage, to be under 90 characters, and to be a complete sentence.

| health | sentence |
|---|---|
| excellent | Wi-Fi is carrying your stream comfortably. |
| protected | Wi-Fi is carrying your stream, with a backup ready. |
| degraded | Your connection is struggling. LIVETAP is spreading the stream to protect it. |
| insufficient | Your connection cannot carry this quality. LIVETAP is lowering it. |
| offline | No network is reachable. |

Never *"MPTCP subflow 3 degraded."*
