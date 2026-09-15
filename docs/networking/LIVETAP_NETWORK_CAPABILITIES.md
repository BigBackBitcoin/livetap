# LIVETAP Bond — what each platform actually permits

Every row is quoted from or traceable to a primary source: platform documentation, kernel
configuration, or a shipping open-source implementation. Where a row says **no**, that is a
platform restriction and not a thing we have yet to build; the two are marked differently on
purpose, because only one of them can be fixed by working harder.

Researched 2026-09-15. Raw findings: [`RESEARCH_RAW.json`](RESEARCH_RAW.json).

---

## 1. The summary table

| | Android | iOS | Windows | macOS | Linux | Browser |
|---|---|---|---|---|---|---|
| Hold 2+ networks at once | **yes** | **yes** | yes | yes | yes | **no** |
| Bind a socket per path | **yes** | **yes** | yes | yes | yes | **no** |
| Needs a special entitlement | no | **no** | no | no | no | — |
| Needs a runtime permission prompt | **no** | no | no | no | no | — |
| Reports metered | yes | yes | partial | partial | partial | no |
| Reports validated-internet | yes | yes | partial | partial | partial | no |
| MPTCP usable by an app | **no** | no (entitled + experimental) | **no** | **no** | root only | no |
| **Realistic path count** | **2** | **2** | 3+ | 3+ | 3+ | **1** |

## 2. Android

**Verdict: works, unprivileged, two paths.**

### The mechanism

```
ConnectivityManager.requestNetwork(
    NetworkRequest.Builder()
        .addTransportType(TRANSPORT_WIFI)        // and a second request for TRANSPORT_CELLULAR
        .addCapability(NET_CAPABILITY_INTERNET)
        .build(),
    callback)                                    // held open for the whole broadcast

// then, per path:
network.getSocketFactory().createSocket()        // bound to that Network at creation
```

### Permissions

`CHANGE_NETWORK_STATE` and `ACCESS_NETWORK_STATE`. Both are protection level **normal** — granted
at install, no runtime prompt, no user-visible dialog. This is the whole permission story.

### Binding: use `getSocketFactory()`, not `bindSocket()`

This was nearly a costly mistake. `Network.bindSocket()`'s javadoc says *"The socket must not be
connected"*, which reads like a serious constraint on retrofitting an existing RTMP client.

It is the wrong API to reach for. `Network.getSocketFactory()` returns a socket factory whose
sockets are **bound to the Network at creation**, so the connected-socket rule is never reached.
Android's own guidance prefers it:

> *"Using individually bound Sockets created by `Network.getSocketFactory().createSocket()` and
> performing network-specific host name resolutions via `Network.getAllByName` is preferred to
> calling `bindProcessToNetwork`."*
> — <https://developer.android.com/reference/android/net/Network>

RootEncoder already routes socket creation through `StreamSocket.createTcpSocket` /
`createUdpSocket`, so per-path binding is a small patch there rather than a rewrite.

### Hard limits

- **`NET_CAPABILITY_VALIDATED` cannot be requested.** Javadoc: *"It is presently unsupported to
  request a network with either `NET_CAPABILITY_VALIDATED` or `NET_CAPABILITY_CAPTIVE_PORTAL`."*
  You can read it from the callback; you cannot ask for it. Which is why this codebase probes to
  the relay instead of trusting a capability bit.
- **100 outstanding network requests per UID**, shared with `registerNetworkCallback`. Nowhere near
  a concern at two paths, but it forbids a design that requests per-destination.
- **LTE + 5G on one SIM is ONE path.** In 5G NSA/EN-DC the split is at PDCP inside the RAN; the
  core sees one bearer and the device holds one IP on one PDN. There is no second `Network` and
  nothing to bind to. **Ever.**
- **Dual-SIM is not two paths.** DSDS hardware transmits on one subscription at a time. DSDA
  hardware could, but there is no public API to bind a socket to the non-default data subscription.
- **Two Internet-bearing Wi-Fi networks is privileged-only.** STA/STA multi-internet exists from
  Android 13, enabled by `WifiManager#setStaConcurrencyForMultiInternetMode` — *"privileged apps
  can enable the feature"*. A Play-store LIVETAP cannot call it.
- **MPTCP is not available.** No `IPPROTO_MPTCP` in bionic/NDK, disabled in GKI, no NetworkAgent
  integration. The last working port was Android 4.4 on a Nexus 5.
- **Foreground service type matters.** Use `camera|microphone`. **Never `dataSync`**: from Android
  15, *"the system permits `dataSync` and `mediaProcessing` foreground services to run for a total
  of 6 hours in a 24-hour period"*, after which `onTimeout` fires and the service is killed. A
  six-hour cap on a broadcasting app is a bug waiting for the wrong streamer.

### Ceiling

**Two paths: Wi-Fi + one cellular.** Three with a USB-Ethernet adapter. This is what shipping
products achieve on Android today, and it is what LIVETAP will claim.

## 3. iOS / macOS

**Verdict: works via Network.framework. No entitlement. Two paths. LIVETAP has no iOS build yet.**

### The mechanism, proven by a shipping MIT-licensed app

Moblin (`github.com/eerimoq/moblin`, App Store) bonds cellular + Wi-Fi + Ethernet with **no
networking entitlements at all**:

```swift
let params = NWParameters(dtls: .none)   // plain UDP
params.prohibitExpensivePaths = false    // MUST be false or cellular is excluded
params.requiredInterface = interface     // a concrete NWInterface, not an interface *type*
NWConnection(host: h, port: p, using: params)
```

Paths come from walking `path.availableInterfaces` filtered to `[.cellular, .wifi, .wiredEthernet]`,
one connection per `NWInterface`, torn down when the interface leaves the path.

Two details that bite: `requiredInterface` must be a **concrete interface**, not
`requiredInterfaceType`, or iOS will quietly route over Wi-Fi anyway; and `prohibitExpensivePaths`
defaults to excluding cellular.

### Why MPTCP is out on Apple, despite being mature there

- `.aggregate`, the only mode that stripes, is documented as *"available only for
  experimentation"* and requires Developer mode with Multipath Networking switched on in Settings.
  It cannot ship.
- On macOS, `net.inet.mptcp.allow_aggregate` defaults to **0**. You cannot `sysctl` a customer's Mac.
- MPTCP *"requires the destination server to have Multipath TCP enabled"* — so the relay would need
  a Linux kernel with an `IPPROTO_MPTCP` listener, and Apple platforms are client-only with
  client-initiated subflows, so a relay could never run on macOS.
- It silently falls back to plain TCP through any middlebox that strips TCP option 30, meaning the
  failure mode is "bonding quietly stopped happening and nothing said so".
- Wi-Fi Assist *"prevents flows from using cellular data when your app is in the background"* and
  caps cellular volume.
- The `com.apple.developer.networking.multipath` entitlement **does not exist on macOS** — iOS,
  iPadOS and visionOS only.

## 4. Windows / Linux desktop

**Verdict: works, and is the best surface of the lot.**

Node's `dgram` can bind a socket to a specific **source address**, which is per-path binding by
another name, and Electron gives us that in the main process where FFmpeg already lives. A desktop
genuinely can have Ethernet + Wi-Fi + a USB tether as three independent uplinks.

**Windows has no MPTCP in any release**, Server 2025 included — which on its own would have killed
an MPTCP-based design, since Windows is LIVETAP's largest desktop platform.

On Linux the MPTCP socket is unprivileged to open, but creating additional subflows requires
`ip mptcp endpoint` or a netlink path manager. Admin-level. Not something an app can do.

## 5. The browser

**Verdict: impossible, and that is a platform fact, not a gap in our work.**

A web page cannot enumerate interfaces, cannot bind a socket to one, and cannot hold two networks
open. `navigator.connection` describes one effective connection and is a hint, not a path list.

**And nothing in a Capacitor/WebView JS context can bind a socket either** — which is why Bond must
live in the native layer on Android, not in the shared web bundle.

The web surface therefore runs single-path. That is complete and correct behaviour there, not a
degraded mode, and `browserCapabilities()` in `packages/bond/src/path/discovery.ts` says so in
those words.

## 6. What this means for the product

1. **Say two, not three.** On a phone the honest number is Wi-Fi + one cellular.
2. **Never imply LTE + 5G.** It is one path. Claiming otherwise is a claim Android cannot honour.
3. **Bonding is native-only.** Web is single-path by platform design.
4. **No permission prompts anywhere.** Nothing in this needs a runtime grant on any platform, which
   removes the most common reason a networking feature never gets switched on.
5. **The capability report must be able to say no.** `PlatformCapabilities.simultaneousPaths` has an
   `'unknown'` value and it is the default. An unmeasured device runs single-path rather than
   guessing.
