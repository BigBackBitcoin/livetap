# Device network capabilities — measured

> ## This file is empty on purpose.
>
> **No device has been measured.** Every number LIVETAP Bond has produced so far is simulated, and
> lives in [`LIVETAP_BOND_BENCHMARKS.md`](LIVETAP_BOND_BENCHMARKS.md) under a banner saying so.
>
> This file is where real-hardware results go, and it stays empty until a real handset has run a
> real broadcast over real networks. Filling it in with anything else — vendor specifications,
> reasonable estimates, numbers from a simulation — would make it worse than empty, because a table
> of plausible-looking measurements is indistinguishable from a table of real ones once it has been
> read twice.

## What goes here

One row per device actually tested, per the brief's section 37.

| Field | Meaning |
|---|---|
| Device | Make, model, chipset |
| OS | Version and build |
| Transports offered | What `ConnectivityManager` / `Network.framework` actually returned |
| Simultaneous paths | How many were genuinely held and sending **at once** |
| Independence | Did the relay see distinct public egress addresses? |
| Metered reporting | Did the OS correctly flag the cellular path? |
| Per-path binding | Did sockets actually leave by the intended interface? |
| Measured uplink | Per path, bits per second, under real load |
| Battery drain | Percent per hour, one path vs two |
| Thermal | Did the device throttle, and after how long |
| Limitations | Anything the device did that the platform documentation did not predict |

## The protocol for filling it in

1. Run the real-device test in [`LIVETAP_BOND_TEST_PLAN.md`](LIVETAP_BOND_TEST_PLAN.md).
2. Capture telemetry from the run. Do not retype numbers from memory.
3. Record what failed as carefully as what worked. A device that refuses to hold two networks is
   the most valuable row this table can contain.
4. If a result contradicts
   [`LIVETAP_NETWORK_CAPABILITIES.md`](LIVETAP_NETWORK_CAPABILITIES.md), the measurement wins and
   that document gets corrected.

## What is expected, so it can be checked against reality

From primary-source research, not measurement. These are **predictions**, recorded here so the
first real test can falsify them:

| Prediction | Basis |
|---|---|
| A stock Android phone will hold **exactly two** paths: Wi-Fi + one cellular | LTE/5G on one SIM is one PDN; dual-SIM has no public binding API; multi-internet Wi-Fi is privileged-only |
| No runtime permission prompt will appear | `CHANGE_NETWORK_STATE` and `ACCESS_NETWORK_STATE` are both protection level `normal` |
| Sockets from `Network.getSocketFactory()` will leave by the intended interface | Android's own documented preference over `bindProcessToNetwork` |
| Keeping the cellular radio hot alongside Wi-Fi will cost meaningfully more battery | Sustained cellular uplink is the expensive case; the exact figure is unknown and is why this row exists |
| A bonded 6 Mbps stream will consume ~2.7 GB/hour | Arithmetic, not measurement. Worth confirming against a real carrier's accounting |

If any of these turns out to be wrong on real hardware, that is a finding worth more than the rest
of this directory.
