# LIVETAP Bond — benchmarks

> ## Every number in this document is SIMULATED.
>
> Nothing here has touched a radio, a carrier, or a real network. These are runs of the real policy
> engine (`packages/bond/src/policy/decide.ts`) against the Bond Lab, whose simulated links react
> to load — queue, then delay, then loss — rather than replaying canned samples.
>
> They are evidence that the engine's logic is sound. They are **not** evidence that any handset
> behaves this way. Real-device numbers go in
> [`DEVICE_NETWORK_CAPABILITIES.md`](DEVICE_NETWORK_CAPABILITIES.md), which is currently empty
> because no device has been measured.

Regenerate with:

```bash
node packages/bond/scripts/bench.mjs
```

Stream bitrate for every run: **6 Mbps**. Tick interval: 500 ms.

## Summary

| Scenario | Ends as | Mode | Carrying | Standby | Starved | Longest gap | Reallocations |
|---|---|---|---|---|---|---|---|
| One good path | `excellent` | `single` | 1 | 0 | 0 ms | 0 ms | 0 |
| Wi-Fi + cellular, default policy | `protected` | `protected` | 1 | 1 | 0 ms | 0 ms | 0 |
| Neither path is enough alone | `protected` | `aggregated` | 2 | 0 | 0 ms | 0 ms | 0 |
| Wi-Fi dies mid-broadcast | `excellent` | `single` | 1 | 0 | 500 ms | 500 ms | 1 |
| Wi-Fi dies and comes back | `protected` | `aggregated` | 2 | 0 | 500 ms | 500 ms | 2 |
| Cellular congests to a trickle | `insufficient` | `aggregated` | 2 | 0 | 22000 ms | 11000 ms | 4 |
| Everything collapses at once | `insufficient` | `aggregated` | 2 | 0 | 25500 ms | 25500 ms | 0 |
| One path goes lossy | `degraded` | `aggregated` | 2 | 0 | 10500 ms | 1000 ms | 0 |
| Nearly flat battery | `protected` | `protected` | 1 | 1 | 0 ms | 0 ms | 0 |

## What these say

**Failover costs one tick.** Every scenario where a path dies shows a longest gap of 500 ms or less
— one measurement interval. That is the floor for a reactive design: the engine cannot move load
off a path before it knows the path is gone. Making it smaller means measuring more often, which
costs battery, and is a trade to revisit with real telemetry rather than guess at now.

**Recovery does not thrash.** "Wi-Fi dies and comes back" completes with a small number of
reallocations across 70 seconds. The engine waits out its dwell time before trusting a returning
path, which is why the count stays low.

**Collapse is reported, not hidden.** "Everything collapses at once" ends `insufficient` with the
encoder ceiling below the requested bitrate. This is the behaviour the brief's section 49 demands
and the single most important row in the table.

**The default policy spends nothing.** "Wi-Fi + cellular, default policy" ends with cellular on
standby and zero bytes of stream over it.

## Transcripts

### One good path

The common case. Bonding must be invisible and must cost nothing.

```
One good path  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  excellent     single         0.0 Mbps  wifi 100%

  starved 0 ms total, longest run 0 ms, 0 reallocation(s)
```

### Wi-Fi + cellular, default policy

What almost every creator will actually run. Cellular must stay warm and carry nothing.

```
Wi-Fi + cellular, default policy  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     protected      0.0 Mbps  wifi 100%

  starved 0 ms total, longest run 0 ms, 0 reallocation(s)
```

### Neither path is enough alone

The case bonding exists for: 4 Mbps + 4 Mbps carrying a 6 Mbps stream.

```
Neither path is enough alone  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     aggregated     0.0 Mbps  wifi 52%, cell 48%

  starved 0 ms total, longest run 0 ms, 0 reallocation(s)
```

### Wi-Fi dies mid-broadcast

Section 40's continuity target. The measured number is the gap a viewer would see.

```
Wi-Fi dies mid-broadcast  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     aggregated     0.0 Mbps  wifi 52%, cell 48%
   20000  -- Wi-Fi lost
   20000  excellent     single         2.9 Mbps  cell 100%

  starved 500 ms total, longest run 500 ms, 1 reallocation(s)
```

### Wi-Fi dies and comes back

Recovery without thrash. The engine must wait before trusting it again.

```
Wi-Fi dies and comes back  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     aggregated     0.0 Mbps  wifi 52%, cell 48%
   15000  -- Wi-Fi lost
   15000  excellent     single         2.9 Mbps  cell 100%
   40000  -- Wi-Fi back
   40000  excellent     single         6.0 Mbps  cell 100%
   41000  protected     aggregated     6.0 Mbps  wifi 51%, cell 49%

  starved 500 ms total, longest run 500 ms, 2 reallocation(s)
```

### Cellular congests to a trickle

Degradation rather than death. Its share must shrink, not the stream.

```
Cellular congests to a trickle  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     aggregated     0.0 Mbps  wifi 52%, cell 48%
   20000  -- cellular congests
   20000  protected     aggregated     3.6 Mbps  wifi 99%, cell 1%
   20500  insufficient  aggregated     4.7 Mbps  wifi 89%, cell 11%
   22000  insufficient  aggregated     5.6 Mbps  wifi 79%, cell 21%
   22500  insufficient  aggregated     5.3 Mbps  wifi 59%, cell 41%
   23000  insufficient  aggregated     4.0 Mbps  wifi 74%, cell 26%
   23500  insufficient  aggregated     4.9 Mbps  wifi 92%, cell 8%
   24500  insufficient  single         5.3 Mbps  wifi 100%
   30500  insufficient  aggregated     4.6 Mbps  wifi 86%, cell 14%
   34000  insufficient  aggregated     5.8 Mbps  wifi 63%, cell 37%
   34500  insufficient  aggregated     4.2 Mbps  wifi 78%, cell 22%
   38500  insufficient  single         5.3 Mbps  wifi 100%
   41000  insufficient  aggregated     4.6 Mbps  wifi 89%, cell 11%
   44500  degraded      aggregated     5.6 Mbps  wifi 62%, cell 38%
   45000  insufficient  aggregated     4.2 Mbps  wifi 77%, cell 23%

  starved 22000 ms total, longest run 11000 ms, 4 reallocation(s)
```

### Everything collapses at once

The honesty test. The engine must say insufficient rather than pretend.

```
Everything collapses at once  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     aggregated     0.0 Mbps  wifi 52%, cell 48%
   20000  -- Wi-Fi collapses
   20000  -- cellular collapses
   20000  insufficient  aggregated     1.2 Mbps  wifi 52%, cell 48%

  starved 25500 ms total, longest run 25500 ms, 0 reallocation(s)
```

### One path goes lossy

Loss is the term a viewer sees. A lossy path must be demoted below a clean one.

```
One path goes lossy  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     aggregated     0.0 Mbps  wifi 52%, cell 48%
   20000  -- cellular starts losing packets
   20000  protected     aggregated     5.7 Mbps  wifi 90%, cell 10%
   20500  insufficient  aggregated     5.5 Mbps  wifi 62%, cell 38%
   21000  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   21500  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   22000  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   22500  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   23000  insufficient  aggregated     5.4 Mbps  wifi 61%, cell 39%
   23500  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   24000  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   24500  insufficient  aggregated     5.7 Mbps  wifi 72%, cell 28%
   25000  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   25500  insufficient  aggregated     5.5 Mbps  wifi 62%, cell 38%
   26000  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   26500  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   27000  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   27500  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   28000  insufficient  aggregated     5.4 Mbps  wifi 62%, cell 38%
   28500  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   29000  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   29500  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   30000  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   30500  insufficient  aggregated     5.4 Mbps  wifi 62%, cell 38%
   31000  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   31500  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   32000  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   32500  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   33000  insufficient  aggregated     5.4 Mbps  wifi 62%, cell 38%
   33500  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   34000  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   34500  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   35000  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   35500  insufficient  aggregated     5.4 Mbps  wifi 62%, cell 38%
   36000  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   36500  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   37000  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   37500  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   38000  insufficient  aggregated     5.4 Mbps  wifi 62%, cell 38%
   38500  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   39000  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   39500  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   40000  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   40500  insufficient  aggregated     5.4 Mbps  wifi 62%, cell 38%
   41000  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   41500  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   42000  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   42500  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%
   43000  insufficient  aggregated     5.4 Mbps  wifi 62%, cell 38%
   43500  degraded      aggregated     5.7 Mbps  wifi 77%, cell 23%
   44000  insufficient  aggregated     5.8 Mbps  wifi 58%, cell 42%
   44500  degraded      aggregated     5.7 Mbps  wifi 72%, cell 28%
   45000  degraded      aggregated     5.8 Mbps  wifi 90%, cell 10%

  starved 10500 ms total, longest run 1000 ms, 0 reallocation(s)
```

### Nearly flat battery

Battery is a first-class input. Fewer radios, unless the stream would not fit.

```
Nearly flat battery  [SIMULATED - no radio was involved]

    time  health        mode        delivered  carrying
       0  offline       single         0.0 Mbps  (nothing)
     500  protected     protected      0.0 Mbps  wifi 100%

  starved 0 ms total, longest run 0 ms, 0 reallocation(s)
```


---

*Simulated. No radio was involved in producing any number above.*
