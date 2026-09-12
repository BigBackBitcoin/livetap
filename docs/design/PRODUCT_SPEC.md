# LIVETAP — PRODUCT SPEC (MVP)

**Status:** design-complete for MVP scope. **Owner:** product design. **Date:** 2026-09-11.
**Companion:** `docs/design/DESIGN_SYSTEM.md` owns every token, component and motion value. This document owns behaviour, layout, states and copy. Where the two disagree, the design system wins on *how it looks*; this spec wins on *what it does and says*.

---

## 1. Purpose, how to read this, and the promise

### The promise

> **Connect your accounts. Pick where you want to go live. Tap GO LIVE.**

Three sentences, three screens, no fourth step. Everything in this document is subordinate to that sentence. If a feature cannot be reached from it, it is not in the MVP.

### Purpose of this document

This is the buildable specification for LIVETAP's MVP interface. A web engineer should be able to implement any screen here without asking a follow-up question. It defines:

- which screens exist and which explicitly do not;
- the five cross-cutting behaviours that most of the product is made of (errors, destination state, going live, mock honesty, pre-flight);
- every screen at three breakpoints with real copy;
- the language rules that keep the product sounding like one product.

### How to read it

| If you are… | Read |
|---|---|
| An engineer building a screen | §4 (cross-cutting) first, then that screen's `##` section in §5. The screen sections assume §4. |
| An engineer building a component | `DESIGN_SYSTEM.md`, then the "Copy" and "Accessibility notes" of every screen that names your component. |
| Writing any user-facing string | §6. It is normative, not advisory. |
| Deciding scope | §3 (information architecture) and §7 (deferred decisions). |
| Reviewing | §2 (tenets). Every review comment should cite a tenet or a documented failure. |

### Conventions

- **Token names** (`bg-1`, `accent-live`, `space-4`, `state-LIVE`, `health-fair`) refer to `DESIGN_SYSTEM.md`. No hex values appear in this document, by design.
- **Component names** (Button, MomentCard, HealthPill…) refer to `@livetap/ui`.
- **Type names** (`DestinationState`, `HumaneError`, `Moment`, `HealthLevel`) refer to `packages/core/src/types/*`. Spellings here are exact and load-bearing.
- Copy in `"double quotes"` is the literal string to ship. Copy with `{braces}` is interpolated.
- **Simple** and **Pro** are the two modes of the same application, never two applications.

### What LIVETAP is designing against

The competitor research (`docs/research/COMPETITOR_FAILURE_DATABASE_A.md`, `…_B.md`) is not a feature checklist; it is a failure catalogue. Three findings shape this entire spec:

1. Nobody has solved first-run. The distance between "installed" and "live" is where the category loses people (Part B §1.1).
2. The category's errors name the symptom and never the cause or the fix (Part A §1.5).
3. Multistreaming — the thing users came for — is the thing every competitor sells back to them (Part A §1.8, Part B §1.2).

LIVETAP's answers are in §4 and §5c.

---

**Precedence.** Where a *dimension, colour, type step, radius, duration or breakpoint* in this document differs from `docs/design/DESIGN_SYSTEM.md`, the design system wins and this document is wrong. Where a *behaviour, state, or string* differs, this document wins. Neither may contradict `packages/core` types, which win over both.

---

## 2. Design tenets for the MVP

Ten tenets. Each is one sentence, and each answers a documented failure.

| # | Tenet | The failure it answers |
|---|---|---|
| 1 | **Outcome before configuration** — a first-time user reaches LIVE without opening a settings screen, and every inferable value (bitrate, resolution, fps, keyframe interval, encoder, rate control) is inferred and never shown by default. | Competitors put rate control, CBR/VBR and keyframe interval in front of a user whose goal is "be live" (A §1.1, A §5.1). |
| 2 | **One dominant action per screen** — exactly one control is the largest, highest-contrast thing on any screen, and on Studio it is GO LIVE. | Beginners meet "a dark canvas, a mixer with no sound, and a dozen panels they don't understand" (B §1.1). |
| 3 | **One noun, not four** — the only user-facing production object is a **Moment**; there is no scene/source/collection/profile hierarchy to lose your work in. | Scene vs Source vs Scene Collection vs Profile is a four-way distinction with no real-world analogue, and users lose scenes by switching the wrong one (A §1.3, A §5.2). |
| 4 | **Every error names the cause and offers exactly one button** — WHAT, WHY, what LIVETAP IS DOING, what YOU CAN do, one primary action. | "Failed to connect to server" can mean four different user actions and one string (A §1.5, A §5.4). |
| 5 | **Diagnose in-product, never by log export** — the app tells the user what is wrong while it is wrong; it never asks them to carry a log file to a second website. | The incumbent's answer to failure is "upload your log and paste the URL into an analyzer" (A §1.4, A §5.5). |
| 6 | **No silent failures** — a black capture, a muted mic, a missing system-audio route and a dead destination each raise a visible, specific, fixable alert rather than a black rectangle or a flat meter. | Dual-GPU black screen is invisible to the UI; audio is the number-one silent killer (A §1.6, A §1.7, A §5.6). |
| 7 | **One destination's failure is that destination's problem** — every destination carries its own state, its own retry and its own error card, and nothing about a failure touches a healthy sibling. | A relay outage, or one platform rejecting ingest, ends the whole show in competing tools (A §5.12, A §4). |
| 8 | **Say what the platform actually does** — capability badges, eligibility gates and hard limits are shown at connect time, in the platform's own terms, including "Not available". | Eligibility gates, not software, are the most common reason a first stream never happens, and no competitor tells the user before the hour is spent (B §1.3, B §6 ranks 3 and 10). |
| 9 | **Nothing moves while you are live** — no layout reflow, no control relocation, no newly appearing panel between the moment GO LIVE is pressed and the moment the stream ends. | Irreversible-while-live settings are presented as ordinary toggles, and streams are lost to mid-show UI surprises (B §1.6, B §6 rank 9). |
| 10 | **Pro is a superset, never a different app** — switching to Pro only ever *adds*; anything visible in Simple is visible in Pro, in the same place, with the same label. | Twitch Studio died because simple users "quickly switch over to other streaming software… to take advantage of more advanced features" — the ceiling, not the floor, killed it (A §5.16). |

---

## 3. Information architecture

### 3.1 What is in the MVP, and what is out

The prompt pack names nine primary spaces. Shipping nine spaces would violate tenet 2. The MVP ships **five routed spaces plus a marketing site**, and folds two named spaces into Studio.

| Space | MVP status | Reasoning |
|---|---|---|
| **HOME** | **OUT** | A dashboard between opening the app and going live is a step that earns nothing. `/app` redirects to `/studio`, or to `/welcome` when no destination has ever been connected. Revisit only if scheduling ships (tenet 1). |
| **STUDIO** | **IN** — the product | Preview, Moments, destinations, devices, health and GO LIVE on one screen. This is the app. |
| **MOMENTS** | **IN** | Routed editor at `/moments`. Simple = pick a template; Pro = edit the layer graph. Needed because the six defaults will not match everyone's camera framing. |
| **DESTINATIONS** | **IN** | Routed manager at `/destinations`. Connecting accounts is half the promise and needs more room than the Studio dock gives it. |
| **CHAT** | **IN, not routed** | A tab in the Studio dock (a bottom sheet on mobile). Chat that lives on its own screen cannot be read while you present, which is the only time it matters. Not every platform supports read or write — see §5d. |
| **MEDIA** | **OUT** | A media library implies a media pipeline (upload, transcode, storage, rights) the MVP does not have. Image and video layers accept a local file picked inside the Moments editor, per Moment. Revisit when recordings and overlays both need shared assets. |
| **RECORDINGS** | **IN** | Routed list at `/recordings`. Recording is on by default, and a recording the user cannot find is a lost recording — the most trust-destroying event in the category (A §5.11). |
| **ANALYTICS** | **OUT** | Kick has no analytics API at all, Instagram has none for live, Twitch has no per-stream concurrents endpoint, and X requires reading its own dashboard. An analytics screen would be four-ninths empty and would violate tenet 8. Live viewer counts appear inline on destination chips where the platform provides them; nothing more is promised. |
| **SETTINGS** | **IN** | Routed at `/settings`. Three groups in Simple; everything the prompt pack lists under Pro Mode behind one disclosure. |
| **HEALTH** | **IN, not routed** | A tab in the Studio dock plus the always-visible HealthPill. Health is only meaningful next to the preview it describes. |

### 3.2 Route table

`Availability` is the mode in which the route is reachable. A Pro-only route does not exist in Simple: it is not disabled, it is absent, and nothing in Simple links to it (tenet 10 works one way only).

| Path | Screen | Simple | Pro | Notes |
|---|---|---|---|---|
| `/` (marketing origin) | Landing | ✓ | ✓ | Static marketing site; separate deployment target from the app shell. |
| `/#download` | Landing anchor | ✓ | ✓ | Anchor, not a route. Listed because outbound links target it. |
| `/app` | — | ✓ | ✓ | Redirect: → `/welcome` if `destinations.length === 0`, else → `/studio`. |
| `/welcome` | Onboarding | ✓ | ✓ | Three steps. Reachable again from Settings → "Run setup again". |
| `/studio` | Studio | ✓ | ✓ | Default app route. |
| `/destinations` | Destinations | ✓ | ✓ | |
| `/destinations/add` | Add destination (Sheet over `/destinations`) | ✓ | ✓ | Route-addressable so the Studio dock can deep-link. |
| `/destinations/:id` | Destination detail (Sheet) | ✓ | ✓ | Metadata, aspect ratio, key replacement, Remove. |
| `/moments` | Moments editor | ✓ | ✓ | Simple shows templates, Pro shows the layer list — same route. |
| `/moments/:momentId` | Moment detail | ✓ | ✓ | |
| `/settings` | Settings | ✓ | ✓ | Simple sees 3 groups; Pro sees 3 + 6. |
| `/recordings` | Recordings | ✓ | ✓ | |
| `/diagnostics` | Diagnostics log | — | ✓ | Pro only. Linked from the ErrorCard technical disclosure and from Settings. |
| `*` | Not found | ✓ | ✓ | Heading "That page moved"; body "The link you followed is not part of LIVETAP any more."; Button "Go to Studio". |

### 3.3 Navigation chrome per breakpoint

Breakpoints are fixed for the whole product: **mobile < 640px**, **tablet 640–1024px**, **desktop > 1024px**.

| Breakpoint | Chrome | Contents | Behaviour |
|---|---|---|---|
| **Desktop** (>1024) | Left rail, fixed 88px, `bg-1`, full height | Logo (top, `space-4` inset), then icon+label items: Studio, Moments, Destinations, Recordings; a spacer; then Settings and the mode switch at the bottom | Labels always visible (a 12px label under a 24px icon — never icon-only; unlabelled icons are a guessing game). Active item: `accent-focus` 2px left edge plus `text-primary`; inactive `text-tertiary`. The rail is the only navigation; there is no top bar. |
| **Tablet** (640–1024) | Top bar, 56px, `bg-1`, sticky | Logo (left), horizontal Tabs (Studio / Moments / Destinations / Recordings), Settings IconButton (right) | Tabs are text-only at this width. The mode switch moves into Settings. Studio's dock becomes a right-edge Sheet at 420px (§5c). |
| **Mobile** (<640) | Bottom bar, 64px + safe-area inset, `bg-1`, fixed | Five items: Moments, Destinations, **Studio** (centre, raised, 56px circular), Recordings, Settings | Studio is centre and raised because it is the destination of every other screen. Icon plus 12px label. While LIVE the bar stays mounted and in place (tenet 9), but non-Studio items need one extra tap: Moments navigates immediately (Moments are meant to be switched live); Settings, Destinations and Recordings show an inline Tooltip "You're live — this can wait" on the first tap and navigate on the second. |

The chrome is identical in Simple and Pro at every breakpoint. Pro adds a `/diagnostics` entry to the Settings *screen*, never to the chrome.

### 3.4 The Simple / Pro mode model

**What the modes are.** Simple answers five questions and nothing else: *Where am I going live? What am I broadcasting? What camera and mic? Am I ready? How do I go live?* Pro answers those five in the same words, in the same places, and then adds encoder, layer, routing, hotkey and diagnostic control.

**The superset rule (normative).** Pro must never hide, move, rename, relabel or shrink a control that Simple shows. A Pro affordance may only *append*: a new section below existing sections, a new disclosure inside an existing row, a new column at the end of an existing table. A reviewer may reject any Pro change that repositions a Simple control. This is how one binary keeps both the Twitch Studio cohort (who want the floor) and the OBS cohort (who want the ceiling).

**How you switch.**

- Desktop: a Toggle at the bottom of the left rail labelled "Pro mode", with the Tooltip "Adds encoder, layer and diagnostic controls. Nothing is hidden."
- Tablet and mobile: Settings → first row, same Toggle, same helper text.
- Keyboard: `Ctrl/Cmd + Shift + P` anywhere in the app.
- The switch announces itself in a live region: "Pro mode on. Encoder, layer and diagnostic controls added." / "Pro mode off. Advanced controls hidden; your settings are kept."

**What persists.** The mode is one boolean in local app settings, per device, not per account. Switching never mutates production settings.

| Set in Pro, then switch to Simple | Result |
|---|---|
| Explicit `formats` per aspect ratio | Kept and used. Settings shows quality as "Custom", helper text "Set in Pro mode. Switch to Pro to change it." |
| `encoder.preference = 'nvenc'` | Kept and used. Invisible in Simple. |
| A hotkey bound to a Moment | Kept and active. Invisible in Simple. |
| A Moment edited layer-by-layer | Kept. Simple's template picker shows "Custom layout" as selected and does not overwrite it unless the user picks a different template, which warns first (§5e). |
| `reconnect.maxAttempts = 3` | Kept and used. |

Nothing set in Pro is silently reverted by entering Simple. Reverting a user's configuration because they changed *how much they want to see* would be the worst kind of silent failure (tenet 6).
---

## 4. Cross-cutting specs

These five behaviours account for most of the product's surface area. The screens in §5 reference them rather than restating them.

### 4.1 The humane error card

Every user-facing failure in LIVETAP is a `HumaneError` rendered by exactly one component: `ErrorCard`. There is no other error presentation — no toast that only says "Error", no red text under a field with a protocol code, no dialog that ends in "OK".

#### Layout

```
┌──────────────────────────────────────────────────────────┐
│ ◈  {what}                                            [x] │  <- icon + WHAT, one line, text-primary, 22px/600
│                                                          │
│    {why}                                                 │  <- WHY, text-secondary, 14px/400
│                                                          │
│    ┌──────────────────────────────────────────────────┐  │
│    │ ⟳  {doing}                                       │  │  <- DOING, inset bg-2, radius-md
│    └──────────────────────────────────────────────────┘  │
│                                                          │
│    You can:  {youCan}                                    │  <- YOU CAN, text-primary
│                                                          │
│    [ {primary action} ]       Show technical details  ⌄  │  <- one Button; Pro-only disclosure
└──────────────────────────────────────────────────────────┘
```

Structural rules:

| Rule | Detail |
|---|---|
| Field order is fixed | WHAT → WHY → DOING → YOU CAN. Never reordered, never partially rendered. An empty `why` is a bug in `humanize()`, not a layout case. |
| **Exactly one primary action** | One `Button`, whose variant follows the severity the card is rendered with: `danger` for a FAILED-class card, `primary` for a warning/informational one. `ErrorCard` picks this from its `tone` prop; callers do not choose it. Secondary affordances are permitted only as a text link in the footer ("Show technical details", "Stop trying") and never look like buttons. A card with two primary buttons is a rejected implementation. |
| DOING is visually inset | `bg-2` at `radius-md`, `space-3` padding. It is the only field describing the *machine's* behaviour, and it is what stops the user acting redundantly. |
| The icon carries severity | `danger` for FAILED-class, `warning` for DEGRADED/RECONNECTING-class, `info` for informational (RATE_LIMITED). Colour is never the only signal — the glyph differs too. |
| Dismissal | `[x]` dismisses *the card*, never the condition. A dismissed card leaves the destination chip in its real state and reappears on the next state change. Cards for `recoverable: false` errors are not dismissible. |
| Where cards appear | Destinations screen (inline in the destination's Card), Studio dock → Destinations tab, and as a `Banner` at the top of Studio when the error affects the whole production (`NETWORK_OFFLINE`, `ENCODER_*`, `DISK_FULL`). Never as a modal — a modal over a live preview is a lost stream. |

#### Mapping from `HumaneError`

```
HumaneError.what        -> heading line
HumaneError.why         -> body paragraph
HumaneError.doing       -> inset DOING block
HumaneError.youCan      -> "You can:" line
HumaneError.code        -> chooses icon + primary action label (table below); never displayed
HumaneError.technical   -> Pro-only disclosure, collapsed by default
HumaneError.recoverable -> false => card is not dismissible and the primary action is a route, not a retry
```

`code` is **never rendered**. Not in a corner, not in small grey text, not "for support". Codes are for `/diagnostics` and bug reports, and Pro users reach them through the technical disclosure.

#### The `technical` field

- Visible **in Pro mode only**, behind a `Show technical details ⌄` disclosure, collapsed by default, in a monospace block on `bg-0` with `overflow-x: auto`.
- The disclosure row is **absent** in Simple — not disabled, absent.
- Below the block: a text link "Copy" (copies the block plus `code` and a timestamp) and "Open diagnostics" → `/diagnostics`.
- `technical` must never contain a stream key, token, or URL containing one. Core enforces this; the UI assumes it and does not sanitise.

#### Worked examples

Shipping strings for the eleven errors a user is most likely to meet. `{target}` is the destination label ("YouTube · Late Night Build"); `{platform}` is the display name.

| ErrorCode | WHAT | WHY | DOING | YOU CAN | Primary action |
|---|---|---|---|---|---|
| `AUTH_EXPIRED` | "{target} needs you to sign in again." | "{platform} sign-ins expire after a while, for your security." | "LIVETAP kept this destination out of the broadcast so nothing else is affected." | "Sign in again — it takes about ten seconds." | **Sign in again** |
| `INGEST_INVALID_KEY` | "{target} did not accept the stream key." | "The key is wrong, expired, or was reset on the platform." | "LIVETAP did not go live here. Your other destinations are unaffected." | "Copy a fresh stream key from {platform} and paste it in." | **Paste a new key** |
| `INGEST_DISCONNECTED` | "{target} stopped receiving your stream." | "The connection to {platform}'s stream server dropped, usually because of your network." | "LIVETAP is reconnecting automatically. Your other destinations keep streaming." | "Nothing yet — reconnects usually succeed within a few seconds." | **Keep trying** (footer link: "Stop trying") |
| `NETWORK_DEGRADED` | "Your connection is struggling." | "Your upload dropped below what 1080p needs, so frames are being skipped." | "LIVETAP lowered quality to 720p to keep you live, and will raise it again when your connection recovers." | "Move closer to your router, or pause any large downloads." | **Keep the lower quality** |
| `ENCODER_OVERLOADED` | "Your device cannot keep up with this quality." | "Encoding one frame is taking longer than a frame lasts, so frames are being dropped." | "LIVETAP is lowering quality to protect your stream." | "Close other apps, or choose a lower quality preset." | **Lower quality now** |
| `CAMERA_LOST` | "Your camera disconnected." | "It was unplugged, disabled, or taken by another app." | "LIVETAP switched to your Starting Soon card so viewers see something intentional." | "Reconnect the camera, or pick a different one." | **Choose a camera** |
| `MIC_LOST` | "Your microphone disconnected." | "It was unplugged, disabled, or taken by another app." | "LIVETAP is sending silence rather than ending your broadcast." | "Reconnect the microphone, or pick a different one." | **Choose a microphone** |
| `SCREEN_DENIED` | "Screen sharing was not allowed." | "Your system blocked screen recording for LIVETAP." | "LIVETAP left the screen area of this Moment empty." | "Allow screen recording for LIVETAP in your system settings, then try again." | **Open system settings** (web build: **Try again**) |
| `DISK_FULL` | "Your disk is almost full." | "Recording needs free space and there is not enough left." | "LIVETAP stopped the recording and kept your stream live." | "Free up space, or save recordings somewhere else." | **Change recording folder** |
| `NOT_ELIGIBLE` | "{target} is not enabled for live streaming yet." | "{platform} requires accounts to meet its own rules first: {requirement}." | "LIVETAP left this destination out of the broadcast." | "Meet {platform}'s requirement, then reconnect here." | **See {platform}'s rules** |
| `RATE_LIMITED` | "{platform} asked LIVETAP to slow down." | "Too many requests were made in a short time." | "LIVETAP is waiting {seconds}s before it tries again." | "Nothing — this clears itself." | **Got it** |

Notes on the examples:

- `NETWORK_DEGRADED` and `ENCODER_OVERLOADED` state *what LIVETAP already did*, with numbers, because "consider turning down video settings" is precisely the string this category is known for (A §1.5).
- `NOT_ELIGIBLE` interpolates `{requirement}` from the platform profile's `eligibilityNotes` — "a public account with more than 1,000 followers" for Instagram, "50 subscribers and possibly a 24-hour wait" for YouTube mobile, "X Premium" for X. The requirement is stated *before* the user is asked to do anything.
- `INGEST_DISCONNECTED`'s primary action is deliberately the thing already happening. When the machine is doing the right thing, the one button confirms it rather than inventing work.

### 4.2 The destination-state chip

One component, `StatusChip`, renders every `DestinationState`. A chip is an 8px dot, the state label, and — wherever there is room — a second line of status text at 12px `text-tertiary`. On the Studio chip row the status text sits under the label; on Destination cards it sits beside it.

"Counts toward ready" means: this destination is included in the count behind GO LIVE's enabled state and its subtitle ("Going live on 3").

| State | Colour | Dot | Chip label | Status text (12px) | Pulses? | Chip actions | Counts toward ready |
|---|---|---|---|---|---|---|---|
| `DISCONNECTED` | `state-DISCONNECTED` | Hollow ring, 1.5px | "Not connected" | "Sign in to use this destination" | No | Tap → Connect | **No** |
| `AUTHENTICATING` | `state-AUTHENTICATING` | Solid | "Signing in" | "Waiting for {platform}…" | No | Tap → Cancel sign-in | **No** |
| `READY` | `state-READY` | Solid | "Ready" | "Goes live when you tap GO LIVE" | No | Tap → detail; ⋯ → Turn off for this stream | **Yes** |
| `STARTING` | `state-STARTING` | Solid, 200ms fade-in | "Starting" | "Telling {platform} you're live…" | No | None for the first 10s, then Cancel | Yes (already committed) |
| `LIVE` | **Solid fill** `state-LIVE-tint` with `state-LIVE-on` text — the only solid-filled chip in the system | Solid, with a pulsing halo | "Live" | "{height}p · {mbps} Mbps · {viewers} watching" — each segment omitted when unknown | **Yes** — 1600ms halo, opacity 1 → 0.35 and scale 1 → 1.35. One of exactly two pulsing states | Tap → Watch (`watchUrl`); ⋯ → Stop this destination | n/a (live) |
| `DEGRADED` | `state-DEGRADED` | Solid | "Live, rough" | "{droppedPct}% of frames are being dropped" | No — amber plus the word carries it; a second pulsing state next to LIVE would dilute the one that matters | Tap → opens the ErrorCard in the dock | n/a (live) |
| `RECONNECTING` | `state-RECONNECTING` | Solid, with a pulsing halo | "Reconnecting" | "Attempt {n} of {max} — retrying in {s}s" | **Yes** — the same 1600ms halo as LIVE. The other of exactly two pulsing states | Tap → ErrorCard; ⋯ → Stop trying | n/a (live) |
| `FAILED` | `state-FAILED` | **No dot** — a 20px alert glyph takes the dot's place, so FAILED can never be mistaken for the warm LIVE coral | "Failed" | First clause of `error.what`, truncated to one line with a `title` | No — a failure that blinks reads as "still trying" | Tap → ErrorCard (primary action Retry) | **No** |
| `STOPPING` | `state-STOPPING` | Solid at 55% opacity | "Stopping" | "Telling {platform} the stream ended…" | No | None | **No** |
| `ENDED` | `state-ENDED` | Solid — something happened and finished, where DISCONNECTED's hollow ring means nothing has happened yet | "Ended" | "Streamed {duration} · {viewers} peak" | No | Tap → Watch replay if `watchUrl`; ⋯ → Go live again | **No while shown.** A destination sits in `ENDED` only while the post-stream summary is on screen; dismissing the summary — or 60s, whichever comes first — re-arms it to `READY`, at which point it counts again. |

Rules for all chips:

- **Colour is never the only signal.** The dot treatment differs per state (hollow ring for DISCONNECTED, solid for the settled states, a pulsing halo for LIVE and RECONNECTING, an alert glyph instead of a dot for FAILED), the label text differs per state, and `aria-label` carries the full sentence.
- **Exactly two states pulse: `LIVE` and `RECONNECTING`.** A pulsing dot means "this is changing right now"; a static dot means "this is settled". Nothing else in the product pulses — see DESIGN_SYSTEM.md §2.4 and §5. Under `prefers-reduced-motion: reduce` the halo becomes a permanent full-opacity ring, so the state is still distinguishable without motion.
- **Chips never reorder.** Destination order is the user's order from `/destinations`; it never re-sorts by state, health or alphabet — least of all while live (tenet 9). A destination that fails stays exactly where muscle memory left it.
- **A mock destination's chip always carries a "Demo" Badge** immediately after the label (§4.4).
- Width: content-sized, 96px minimum, 240px maximum; status text truncates before the label does.

### 4.3 The GO LIVE and END flows

#### GO LIVE

**There is no confirmation dialog.** A dialog asking "are you sure you want to go live?" adds a step to the one moment the product exists for, and it is the wrong control anyway: the user's real need is not confirmation, it is *a few seconds to change their mind*.

**So the button becomes the countdown.** On press, `GoLiveButton` does not navigate, open or spawn anything. In place, at the same size and position:

```
   idle            counting              live
┌────────────┐  ┌────────────────┐  ┌──────────────────┐
│  GO LIVE   │  │  3     Cancel  │  │ ● END    0:00    │
│ Going live │  │ Going live in… │  │ Live on 3        │
│    on 3    │  └────────────────┘  └──────────────────┘
└────────────┘
```

| Aspect | Specification |
|---|---|
| Duration | 3 seconds. Numerals 3 → 2 → 1, 1000ms each, 320ms cross-fade, tabular numerals so nothing shifts. |
| Cancel affordances | (a) the word "Cancel" inside the button, right-aligned, hit area ≥ 44×44px; (b) **Escape** anywhere in the app; (c) clicking the button body itself. All three do the same thing. |
| On cancel | Button returns to idle in 200ms. Live region: "Cancelled. You are not live." No destination has been told anything — `STARTING` is not entered until the countdown completes. |
| At zero | Destinations go `READY → STARTING`; the chip row animates in place; the elapsed timer starts at `0:00` *when the first destination reports `LIVE`*, not at zero. |
| Keyboard | The button holds initial focus on Studio. `Enter`/`Space` starts the countdown; `Escape` cancels. The countdown does not steal focus. |
| Announcements | On start: "Going live in 3 seconds. Press Escape to cancel." At zero: "Going live on {n} destinations." On first `LIVE`: "You are live on {names}." |

**Zero destinations are READY.** GO LIVE is not a dead button — dead buttons teach nothing. It renders `variant="secondary"`, is disabled for activation, is labelled **"GO LIVE"** with the subtitle **"No destination is ready"**, and carries an `aria-describedby` / Tooltip: *"Connect a destination first — that is the one thing LIVETAP cannot do for you."* Beneath it, one text link: **"Add a destination"** → `/destinations/add`. On first run this is replaced by the Onboarding path (§5b).

**Some READY, some FAILED.** Going live proceeds, and the failure is stated *before* the countdown, not after. The subtitle reads **"Going live on 2 · 1 needs attention"** with the second clause in `warning`. The countdown runs normally; the failed destination is simply not in the broadcast. After the countdown a `Banner` (never a dialog) appears above the dock: *"Instagram · @nightbuild is not in this stream."* with one text link "Fix it" → that destination's ErrorCard. Rationale: tenet 7 — a user with three destinations and one broken key is a user who should be live on two.

**Going live would use a mock destination.** The countdown still runs; mock mode exists to be used. The subtitle says **"Going live on 2 · 1 is a demo"**, and the persistent mock banner (§4.4) is already on screen and is not dismissible. If **every** enabled destination is a mock, the button label becomes **"GO LIVE (DEMO)"** and its fill uses `info` rather than `accent-live`. A demo stream must never be able to *look* like a real one at any glance distance.

#### END

**Decision: a single tap plus a 5-second undo grace. Not hold-to-confirm.**

Justification: hold-to-confirm is inaccessible (it defeats switch access, head pointers and most motor impairments, and has no honest keyboard equivalent), it is undiscoverable without an animation that competes with the preview, and it does not even solve the real failure mode — the user who *meant* to end and immediately realises they had one more thing to say. A grace period with a visible Undo handles both the accidental tap and the premature tap, and is operable by keyboard, screen reader and switch alike.

| Phase | Duration | What the user sees | What the machine does |
|---|---|---|---|
| Tap END | — | Button becomes `[ ⟲ UNDO   Ending in 5 ]`, `warning` fill, subtitle "Say your goodbyes." | Nothing is sent to any platform. If the production has an `Ending` Moment and it is not already active, LIVETAP switches to `Ending` now — so the grace period is useful screen time, not dead air. |
| Grace | 5s, counting 5 → 1 | The Undo affordance is the whole left portion of the button; `Escape` also undoes | Timer only. |
| Undo | — | Button returns to `● END {elapsed}` | The Moment reverts to the one active before the tap. Live region: "Still live." |
| Elapse | — | Destinations go `LIVE → STOPPING → ENDED`; the post-stream summary replaces the dock (§5c) | `stopBroadcast()` per destination, recording finalised, summary computed. |

Editorial note: the grace is 5 seconds rather than 3 because the countdown *into* a stream is about nerves and the countdown *out of* it is about content.

#### Elapsed timer

| Elapsed | Format |
|---|---|
| < 1 hour | `0:00` … `59:59` (no leading zero on minutes) |
| ≥ 1 hour | `1:00:00` … (no leading zero on hours) |
| ≥ 10 hours | `10:00:00` |

Tabular numerals, `text-primary`, never abbreviated — "1h 4m" is a summary format, not a running clock. The timer is inside the END button. It is `aria-live="off"` and exposed as a focusable element with `aria-label="Live for {n} minutes"`; a clock that announces every second is unusable. Recordings and the post-stream summary use the *summary* format instead: "1h 04m".

### 4.4 The mock-mode banner

Mock providers exist so the product can be demonstrated, developed and tested without a real broadcast. Nothing about them may be mistakable for production (ADR-007).

**When it shows.** Whenever at least one destination with `config.mock === true` is enabled — at every breakpoint, on every app route (never on the marketing site). It is a `Banner` pinned directly under the navigation chrome, above the Studio preview and above the Destinations list.

**Copy.**

- One mock destination: **"Demo mode — "{label}" is a simulated destination. Nothing is being broadcast to {platform}."**
- More than one: **"Demo mode — {n} of your destinations are simulated. Nothing is being broadcast to them."**
- All destinations mock: **"Demo mode — every destination here is simulated. LIVETAP is not broadcasting anywhere."**
- Trailing text link in all three: **"Manage demo destinations"** → `/destinations`.

**Dismissibility.** Not dismissible while any mock destination is enabled: the banner has no `[x]`. Turning off or removing the last enabled mock destination removes it (200ms collapse). This is deliberate — a dismissible honesty banner is a banner that will be dismissed and then forgotten, and "I thought I was live" is the worst outcome this product can produce.

**Styling.** `info` family, not `warning` — demo mode is a valid state, not a problem. Diagonal 4px hatching at 6% opacity behind the banner so it stays identifiable in a screenshot, a screen recording, a bug report and a support thread even with colour stripped.

**How mocks are marked everywhere else.**

| Surface | Marking |
|---|---|
| Destination chip (Studio) | `Badge` "Demo", `info`, immediately after the state label. |
| Destination card (`/destinations`) | The same Badge beside the platform name, and the card border is `info` at 40% instead of `bg-3`. |
| Add-destination sheet | Mock providers live in their own bottom section headed "Demo destinations", with the note "These simulate a platform so you can try LIVETAP. They never broadcast anywhere." |
| GO LIVE button | Subtitle counts demos separately; all-mock changes the label to "GO LIVE (DEMO)" (§4.3). |
| Chat messages | Every mock message carries a "Demo" Badge on the author row; mock chat never renders without it. |
| Recordings | A recording made during an all-mock stream is titled "{date} (demo)" in the list. |
| Post-stream summary | Heading "Demo stream ended" instead of "Stream ended". |
| `aria-label` | Every mock control's accessible name ends with ", demo destination". |

### 4.5 Pre-flight readiness

Pre-flight runs continuously while Studio is open — not once, not on a button press — and resolves to one of three levels, presented as a single row directly above the GO LIVE button.

| Level | Row copy | GO LIVE | What it checks |
|---|---|---|---|
| **Green** | "Ready to go live" with a `success` dot | Enabled, `accent-live` | ≥1 destination `READY`; camera producing frames (if the active Moment has a camera layer); mic above −50 dBFS in the last 10s (unless intentionally muted); measured upload headroom ≥ 1.3× target bitrate; encoder test frame within budget; > 2 GB free if recording is on. |
| **Amber** | "Ready — with one thing to know" / "…{n} things to know", `warning` dot, expandable | **Enabled. Amber never blocks.** | Any single amber condition, each stated with its consequence: "Your mic has been silent for 30 seconds — viewers will hear nothing."; "Your upload is only just enough for 1080p — LIVETAP will drop to 720p if it dips."; "1 destination needs attention and will be left out."; "Screen sharing is not allowed yet — the screen area of Screen Share will be empty."; "Recording is on and you have 1.4 GB free — about 12 minutes."; "1 destination is a demo and will not broadcast." |
| **Red** | "Not ready to go live", `danger` dot | **Disabled**, with the reason as the button subtitle | Only two conditions are red, because only two make a stream impossible: no destination is `READY`, or the device is offline (`NETWORK_OFFLINE`). Everything else is amber. |

Expanding amber lists each item as a row with its consequence sentence and, where one exists, a single inline text link that fixes it ("Choose a microphone", "Allow screen recording", "Turn off recording"). Amber items are not checkboxes and cannot be "acknowledged"; they clear when the condition clears.

This model is the direct answer to a guided setup that fires once and walks away (A §1.2, A §5.3): pre-flight measures continuously and states consequences rather than issuing verdicts.
---

## 5. Screens

Seven screens. Each section is self-contained apart from §4, which it assumes.

---

## 5a. Landing (marketing site)

### Purpose

The landing page has one job: convince a creator who already owns a streaming problem that LIVETAP removes it, and get them to the download in one scroll. It is not a features page. It explains what LIVETAP is, why it is easier, how multistreaming works, where to get it, and why being open source matters — in that order, because that is the order of the reader's questions. It never uses the word "solution", never shows a dashboard screenshot with fake numbers, and never claims a platform capability the product does not have (tenet 8).

### Primary action

**Download LIVETAP** — one button, repeated at most twice (hero and download section), with OS auto-detected and the other platforms as text links beneath it.

### Layout: desktop (>1024)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ◆ LIVETAP                          How it works   Open source   [ Download ]  │  56px sticky, bg-0/80 blur
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   Go live everywhere.                       ┌───────────────────────────────┐ │
│   In one tap.                               │                               │ │
│                                             │   [ product still: Studio     │ │
│   Connect your accounts. Pick where you     │     at rest, real UI, no      │ │
│   want to go live. Tap GO LIVE. That is     │     invented metrics ]        │ │
│   the whole product.                        │                               │ │
│                                             │  ● YouTube  ● Twitch  ● Kick  │ │
│   [  Download for Windows  ]                └───────────────────────────────┘ │
│   macOS · Linux · Use in browser                                              │
│   Free. Open source. No account needed.                                       │
│                                                                               │
├───────────────────────────────────────────────────────────────────────────────┤
│  WHAT IS LIVETAP  — 3 columns, no icons-as-decoration                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                           │
│  │ One app      │ │ Every        │ │ Yours        │                           │
│  │ …            │ │ destination  │ │ …            │                           │
│  └──────────────┘ └──────────────┘ └──────────────┘                           │
├───────────────────────────────────────────────────────────────────────────────┤
│  WHY IT IS EASIER — 2-col alternating: claim left, honest detail right         │
│   • Nothing to configure          • Errors that tell you what to do            │
│   • Six Moments, not a scene tree • Nothing is paywalled                       │
├───────────────────────────────────────────────────────────────────────────────┤
│  HOW MULTISTREAMING WORKS — one diagram, 3 labelled stages, no marketing arrows│
│        your camera  ─►  LIVETAP encodes once  ─►  pushes to each destination    │
├───────────────────────────────────────────────────────────────────────────────┤
│  WHAT EACH PLATFORM ACTUALLY SUPPORTS — the honest capability table (9 rows)    │
├───────────────────────────────────────────────────────────────────────────────┤
│  DOWNLOAD  — OS cards + checksum link + "Use in browser" secondary            │
├───────────────────────────────────────────────────────────────────────────────┤
│  OPEN SOURCE — licence, repo link, security policy, what we never collect     │
├───────────────────────────────────────────────────────────────────────────────┤
│  ◆ LIVETAP   GitHub · Licence · Privacy · Security            Built in public │
└───────────────────────────────────────────────────────────────────────────────┘
```

Hero is a 7/5 split (copy/still), max content width 1200px, vertical rhythm `space-24` between sections.

### Layout: tablet (640–1024)

```
┌──────────────────────────────────────────────────┐
│ ◆ LIVETAP                    ☰                   │  nav collapses to a Sheet
├──────────────────────────────────────────────────┤
│   Go live everywhere. In one tap.                │  hero stacks: copy first
│   Connect your accounts. Pick where you want     │
│   to go live. Tap GO LIVE.                       │
│   [  Download for macOS  ]                       │
│   Windows · Linux · Use in browser               │
│  ┌────────────────────────────────────────────┐  │
│  │  [ product still, full width, 16:9 ]       │  │  image moves BELOW the copy
│  └────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  WHAT IS LIVETAP — 3 columns become 2 + 1        │
├──────────────────────────────────────────────────┤
│  WHY IT IS EASIER — alternating becomes stacked  │
│  pairs (claim, then detail underneath)           │
├──────────────────────────────────────────────────┤
│  MULTISTREAMING — diagram rotates to vertical    │
│      camera ▼ LIVETAP ▼ destinations             │
├──────────────────────────────────────────────────┤
│  CAPABILITY TABLE — horizontally scrollable      │
│  ◄ ─────────────────────────────────────── ►     │
├──────────────────────────────────────────────────┤
│  DOWNLOAD · OPEN SOURCE · footer (stacked)       │
└──────────────────────────────────────────────────┘
```

### Layout: mobile (<640)

```
┌────────────────────────────────┐
│ ◆ LIVETAP                      │  44px, no nav links at all
├────────────────────────────────┤
│  Go live                       │  headline breaks to 3 lines
│  everywhere.                   │
│  In one tap.                   │
│                                │
│  Connect your accounts.        │
│  Pick where you want to go     │
│  live. Tap GO LIVE.            │
│                                │
│ ┌────────────────────────────┐ │
│ │  [ Download for iPhone ]   │ │  full-width, 52px
│ └────────────────────────────┘ │
│  Android · Desktop · Browser   │
│  Free. Open source.            │
├────────────────────────────────┤
│ ┌────────────────────────────┐ │
│ │ [ 9:16 product still —     │ │  vertical crop, not the 16:9 one
│ │   mobile Studio, portrait ]│ │
│ └────────────────────────────┘ │
├────────────────────────────────┤
│  One app          ⌄            │  the three "what is" columns
│  Every destination⌄            │  become an accordion
│  Yours            ⌄            │
├────────────────────────────────┤
│  WHY IT IS EASIER              │
│  four single-column claims,    │
│  detail always visible (no     │
│  accordion — this is the sell) │
├────────────────────────────────┤
│  MULTISTREAMING                │
│  vertical 3-step diagram       │
├────────────────────────────────┤
│  WHAT EACH PLATFORM SUPPORTS   │
│  table becomes 9 stacked rows: │
│  platform / badge / one line   │
├────────────────────────────────┤
│  DOWNLOAD (sticky CTA appears  │
│  after 60% scroll, 56px bar)   │
├────────────────────────────────┤
│  OPEN SOURCE · footer          │
└────────────────────────────────┘
```

### States

| State | What the user sees |
|---|---|
| **Default** | As above. No carousel, no autoplaying video, no cookie banner (the site sets no non-essential cookies, so there is nothing to consent to — say so in the footer: "No tracking cookies. Nothing to accept."). |
| **Loading** | The hero renders text-first; the product still is `loading="eager"` with a `bg-2` placeholder at the exact aspect ratio so nothing shifts. Below-fold images are `loading="lazy"` with reserved boxes. There is no spinner on a marketing page. |
| **OS not detected** | The primary button label falls back to **"Download LIVETAP"** and the OS list below shows all four options with equal weight. Never guess wrong loudly. |
| **Download unavailable for that OS** | Button becomes secondary, labelled **"Not ready for Linux yet"**, with the text link "Use it in your browser" and a second link "Watch the Linux build". Honest, not hidden. |
| **Error** (assets or release metadata fail) | Version/size text degrades to the text link "See all releases on GitHub". The page never shows a broken state; it shows a smaller truth. |
| **First run / returning** | If the visitor has the app installed (deep-link probe on desktop) the hero's primary button becomes **"Open LIVETAP"** with "Download again" as a text link. |

### Copy

**Headline options** (pick one; A is the shipping default):

- **A. "Go live everywhere. In one tap."** — the promise, compressed. Shipping default.
- B. "One tap. Everywhere." — the north star verbatim; stronger as a wordmark, weaker as a first sentence for someone who has never heard of the product.
- C. "Streaming to five places should not take an afternoon." — leads with the pain; best for paid acquisition, too long for the hero.

**Subhead options:**

- **A.** "Connect your accounts. Pick where you want to go live. Tap GO LIVE. That is the whole product." — shipping default.
- B. "Free, open-source broadcasting that does not make you learn broadcasting."
- C. "Multistream, vertical, recording and chat in one app. No plugins, no subscription, no watermark."

**Section copy:**

| Section | Heading | Body |
|---|---|---|
| What is LIVETAP | "What LIVETAP is" | Col 1 — "One app": "Camera, screen, microphone, overlays and recording in one place. Nothing to install on top of it." · Col 2 — "Every destination": "Go live on YouTube, Twitch, Kick and more at the same time. LIVETAP encodes once and sends to each one." · Col 3 — "Yours": "Free forever, open source, and it runs on your machine. Your stream never passes through our servers." |
| Why it is easier | "Why it is easier" | "Nothing to configure — LIVETAP measures your connection and your computer, picks the settings, and keeps adjusting while you stream. You will never meet a bitrate field unless you go looking for one." · "Six Moments, not a scene tree — Starting Soon, Main Camera, Screen Share, Guest, Break, Ending. Tap one to switch what viewers see." · "Errors that tell you what to do — when something breaks, LIVETAP says what happened, why, what it is already doing about it, and the one thing you can do." · "Nothing is paywalled — multistreaming, 1080p, unlimited destinations and unlimited recording are in the free app. There is no paid tier to find." |
| How multistreaming works | "How going live in several places at once works" | "Your camera and screen go into LIVETAP. LIVETAP composes your Moment and encodes it once. Then it opens a separate connection to each destination you picked and pushes the same stream to all of them. Because each connection is separate, one platform having a bad night does not touch the others — that destination reconnects on its own while the rest keep streaming." Caption under the diagram: "Encoded once on your machine. Sent straight to each platform. No relay in the middle to fail." |
| Capability table | "What each platform actually supports" | Intro line: "Some platforms let an app go live for you. Some only accept a stream key you paste. One does not allow third-party apps at all. Here is the truth before you download anything." (Table rows use the §5d badge vocabulary verbatim.) |
| Download | "Get LIVETAP" | "Free, no account, no telemetry by default." Per-OS card: "{OS} · {version} · {size}" plus text links "Checksum" and "Release notes". Secondary: "Or use it in your browser — no install, most features, recording saves to your Downloads folder." |
| Open source | "Why open source matters here" | "You are about to hand a piece of software your streaming accounts. You should be able to read what it does with them. LIVETAP is {licence}-licensed, developed in public, and its credential handling is documented line by line. If we ever stopped working on it, you would still have it — unlike the simple streaming tools that have been switched off before." Links: "Read the code", "Security policy", "What LIVETAP never collects". |

### Simple vs Pro differences

Not applicable — the marketing site has no modes. It must not show Pro-only vocabulary (§6 banned words) anywhere, including the capability table.

### Accessibility notes

- Focus order: skip link ("Skip to download") → logo → nav links → hero heading → primary CTA → OS links → each section heading in document order → footer.
- The hero still image has a genuine `alt`: "The LIVETAP Studio window: a camera preview, a row of Moments, and one GO LIVE button." Decorative section art is `aria-hidden`.
- The multistream diagram is an inline SVG with `role="img"` and an `aria-label` containing the same three stages as prose, plus a visually hidden ordered list of the stages for screen readers.
- The capability table is a real `<table>` with `<caption>` "Platform support in LIVETAP" and `<th scope="col">`; badges include their word, never colour alone.
- Sticky mobile CTA is `position: sticky` inside the flow (not fixed) so zooming to 400% never traps content, and it is removed from the tab order while off-screen.
- All motion is scroll-triggered opacity/translate under 320ms and is fully suppressed under `prefers-reduced-motion: reduce`; nothing on this page animates on a loop.

---

## 5b. Onboarding — intent-first

> **Revised 2026-09-11 to match the built flow in `apps/web/src/screens/onboarding/Onboarding.tsx`.**
> The earlier draft of this section opened with "Where do you want to go live?". That is the wrong
> first question, and the reason is in the north-star correction (`09_LIVETAP_NORTH_STAR_CORRECTION.md`
> §5–6): knowing **what** someone is making is what lets LIVETAP infer the layout, the shape, the safe
> areas, the framing and the quality. Ask it first and the destination step can *state* "YouTube 16:9 ·
> TikTok 9:16" instead of asking; ask it second and LIVETAP has nothing to infer from and has to fall
> back on a settings screen. The rest of this document is unchanged.

### Purpose

Onboarding turns "I want to go live" into a production. It asks two questions, confirms one thing, and
hands over. Its success metric is the percentage of first-run users who reach Studio with at least one
`READY` destination — and, critically, it must let a user who wants none of this out at any time, because
a setup flow that cannot be escaped is the first-run failure this whole product is designed against
(B §1.1). "Skip setup" is present on every step and goes straight to Studio with no confirmation.

### The budget

**Six taps from `/app` to LIVE**, including GO LIVE. That budget is the product, and it is the reason
the flow is three screens rather than four:

| Tap | What the user does |
|---|---|
| 1 | Picks an intent — the card both selects and advances |
| 2 | Picks the first destination |
| 3 | Picks the second destination |
| 4 | Continue |
| 5 | Open Studio |
| 6 | GO LIVE |

The three-second countdown after tap 6 is a wait, not a tap, and it is cancellable. The count is asserted
by `apps/web/e2e/golden-path.spec.ts` and recorded in `docs/qa/FRICTION_BENCHMARK.md`.

### Primary action

The one primary button on the current step: step 1 has none (the cards are the action), step 2 is
**"Continue"**, step 3 is **"Open Studio"**.

### Step 1 — "What are you making?"

Six `IntentCard`s, one per `ContentType` in `INTENT_PROFILES` (`@livetap/core`), rendered from the profile
rather than from hand-written copy so the screen cannot drift from what the engine will actually do:

| Card | Emoji | Tagline | `whatYouGet` (rendered as bullets) |
|---|---|---|---|
| Talking | 🎥 | "Just you and the camera." | full-frame camera · clean lower-third · auto vertical crop |
| Gaming | 🎮 | "Your game, with you in the corner." | game capture with camera inset · 60 fps where allowed · balanced audio |
| Podcast | 🎙 | "You and a guest, side by side." | split layout · voice-first audio · square and vertical versions |
| Presentation | 💻 | "Your screen, with you alongside." | screen with camera inset · readable at 1080p · sharp slides |
| Event | 🎤 | "A stage, a camera, an audience." | wide framing · starting-soon and break screens · steady 30 fps |
| Vertical Live | 📱 | "Built for phones, first." | 9:16 with safe areas for chat · face-forward framing |

Body copy: "LIVETAP sets up the picture, the shape and the quality from this one answer. You can change
any of it later." Each card is a `<button aria-pressed>`; choosing one stores the intent and advances.

### Step 2 — "Where are you going live?"

Multi-select platform cards, built from `PLATFORM_PROFILES` (`@livetap/adapters`). The list is never
filtered: absence would read as "not supported yet" when for LinkedIn it means "not possible".

**The badge is derived, never written.** `lib/platformStatus.ts` reads `profile.capabilities.streamKey`
and maps it to exactly three answers:

| `CapabilityClass` | Badge | Meaning |
|---|---|---|
| `NATIVE_API`, `OAUTH_API`, `RTMP_DESTINATION` | **Connect account** (`success`) | Sign in once and LIVETAP handles the broadcast |
| `USER_ASSISTED`, `EXPERIMENTAL` | **Paste stream key** (`info`) | The platform gives *you* a key; LIVETAP pushes to it |
| `PARTNER_APPROVAL_REQUIRED`, `UNAVAILABLE` | **Not available yet** (neutral, `aria-disabled`) | The platform does not allow an app like LIVETAP to do this |

The one-line summary under each name is **generated** from the same capability values (method, whether
`start` is `USER_ASSISTED`, whether the platform is vertical-only) rather than taken from the profile's
`connectionSummary` verbatim. The profiles are engineering documentation written in protocol terms, which
Simple mode may never show (§6.2); the profile's own prose stays available as a Pro-only disclosure on the
Destinations screen. One source of truth, two readers.

**Mock mode.** Every selectable platform connects through the mock adapter and carries a visible **"Mock"**
`Badge` in addition to its capability badge. A paste-key platform is given a clearly-fake demo ingest
(`demo.livetap.invalid`) so it can reach `READY` through the real orchestrator path — a mock destination is
never allowed to skip validation. The note under the grid says so: "This build runs in demo mode, so every
destination you pick is simulated and nothing is broadcast anywhere."

Tapping a picked platform unpicks it. Continue is disabled until one is picked, with the reason stated
beneath it rather than only in a tooltip.

### Step 3 — "Camera and mic", and "Here is your setup"

One screen, two sections, one button. Splitting the payoff onto a fourth screen cost a tap and bought
nothing: the setup explanation reads better beside the picture it describes.

**Camera and mic.** `enumerateDevices` where it exists; `getUserMedia` is never called on mount, so the OS
prompt is never a surprise and device labels stay empty until permission is granted (LIVETAP says
"Camera 1" rather than inventing a model name). In a mock or device-free environment the preview shows the
`MockEngine` test pattern and the hint reads **"No camera found — using a test pattern"**, with "Look
again" beside it. A device choice applies to every Moment, because "which camera" is a property of the
person, not of the arrangement they happen to be showing.

**Here is your setup.** `buildAutomaticProduction(intent, destinations)` from `@livetap/core`, rendered:

- its `explanation` bullets verbatim (intent and tagline; "One production, 2 formats: 16:9 and 9:16.
  LIVETAP reframes automatically."; the resolved quality; computer audio when the intent includes it);
- one line of per-destination shape — **"YouTube 16:9 · TikTok 9:16"**;
- one line naming the Moment set the intent produced.

Footnote: "You can run this setup again from Settings." Primary: **"Open Studio"**, which applies the plan
to the orchestrator (settings, Moments, per-destination aspect, active Moment), marks onboarding done and
navigates.

### States

| State | What the user sees |
|---|---|
| **First run** | Step 1, nothing selected. "Skip setup" is available on every step. |
| **Loading** (device enumeration) | "Looking for your camera and microphone…" with a `Spinner`. Meters show a flat baseline, never a fake waveform. |
| **Empty** (no devices found) | The test-pattern preview plus "No camera found — using a test pattern" and "No microphone found — viewers will hear nothing." Continuing is a real path: a screen-only or card-only stream is legitimate. |
| **Blocked platform** | The card is focusable, `aria-disabled`, and carries its reason in `aria-describedby`: "{platform} only allows approved partner tools to go live. LIVETAP is not one, and would rather say so than waste your evening." Never a dead click. |
| **Error** (connect fails) | An `ErrorCard` below the grid, mapped from the orchestrator's notice. The step does not advance and nothing else is disturbed. |
| **Returning** (re-run from Settings) | Already-connected destinations are already picked; Continue is enabled immediately. Onboarding never asks a returning user to redo work. |

### Simple vs Pro differences

**Identical in both modes.** A Pro user's first run is a Simple first run; Pro settings are reachable the
moment Studio opens.

### Accessibility notes

- One `<main>`; a polite live region announces "Step {n} of 3: {heading}" on each transition, and focus
  moves to the step heading (`tabIndex={-1}`) — never to the first control, so the context is heard
  before the task.
- The step dots are `aria-hidden`; the textual "Step 1 of 3" is the accessible progress indicator.
- Intent cards are `<button aria-pressed>`; platform cards are `<button aria-pressed>` unless blocked, in
  which case they are `aria-disabled` and focusable, because a silently unfocusable row teaches nothing.
- Every card's `whatYouGet` bullets are real list items, so the payoff is readable without sight.
- Touch targets are ≥44px; nothing on this flow depends on hover.

### Verified by

`apps/web/src/__tests__/onboarding.test.tsx` (six cases, including "never shows a protocol word on the way
to Studio") and `apps/web/e2e/golden-path.spec.ts` (the six-tap assertion and the DOM vocabulary scan).

---

## 5c. Studio

### Purpose

Studio is the product. It answers the five Simple-mode questions on one screen without scrolling at any breakpoint: what viewers see (preview), what you can switch to (Moment strip), where you are going (destination chips), what you sound and look like (device controls), whether you are ready (pre-flight and HealthPill), and how you go live (one button). Everything else in the application exists to keep Studio uncluttered. Its hardest requirement is not density — it is that the layout is stable enough to be trusted at the moment a person's face is being broadcast to strangers (tenet 9).

### Primary action

**GO LIVE**, which becomes **END** while live. It is the largest control on the screen at every breakpoint, and no other control shares its fill colour.

### Layout: desktop (>1024)

```
┌────┬──────────────────────────────────────────────────────────┬──────────────────┐
│ ◆  │  ┌ Demo mode banner (only when a mock is enabled) ─────┐ │  Chat│Dest.│Health│  <- Tabs
│    │  └─────────────────────────────────────────────────────┘ ├──────────────────┤
│ ▶  │                                                          │ ┌──────────────┐ │
│Stu │   ┌──────────────────────────────────────────────────┐    │ │ @vee         │ │
│dio │   │                                                  │    │ │ good evening │ │
│    │   │                                                  │    │ │ ⌄ YouTube    │ │
│ ▣  │   │            PREVIEW  (16:9 default)               │    │ └──────────────┘ │
│Mom │   │                                                  │    │ ┌──────────────┐ │
│ents│   │                                                  │    │ │ @lmp  Demo   │ │
│    │   │                                                  │    │ │ is this live?│ │
│ ⇅  │   └──────────────────────────────────────────────────┘    │ └──────────────┘ │
│Dest│    16:9 │ 9:16 │ 1:1        ⬤ Good  ⌄     Rec ● 04:12     │        ⋮         │
│    │                                                          │                  │
│ ⬤  │   ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐                   │ ┌──────────────┐ │
│Rec │   │ ⏳ ││ 🎥 ││ 🖥 ││ 👥 ││ ☕ ││ 👋 │                   │ │ Say something│ │
│ords│   │Star││Main││Scre││Gues││Brea││Endi│                   │ │ to everyone  │ │
│    │   │ting││ Cam││ en ││ t  ││ k  ││ ng │                   │ └──────────────┘ │
│    │   └────┘└═══─┘└────┘└────┘└────┘└────┘                   │                  │
│    │                                                          │                  │
│ ⚙  │   ┌───────────────┬───────────────┬───────────────┐      │                  │
│Set │   │ 🎥 FaceTime ⌄ │ 🎙 Blue Yeti⌄ │ 🖥 Share ⌄    │      │                  │
│ting│   │ [mute]        │ ▇▇▇▅▁ [mute]  │ [off]         │      │                  │
│ s  │   └───────────────┴───────────────┴───────────────┘      │                  │
│    │                                                          │                  │
│[Pro│   ● YouTube  Ready      ● Twitch  Ready    ● TikTok      │                  │
│ ]  │     Goes live when…       Goes live when…    Not conn.   │                  │
│    │   ┌────────────────────────────────────────────────┐     │                  │
│    │   │ ⬤ Ready to go live                             │     │                  │
│    │   ├────────────────────────────────────────────────┤     │                  │
│    │   │              G O   L I V E                     │     │  <- 88px tall    │
│    │   │              Going live on 2                    │     │                  │
│    │   └────────────────────────────────────────────────┘     │                  │
└────┴──────────────────────────────────────────────────────────┴──────────────────┘
  88px                     fluid, min 640px                          380px dock
```

Grid: `88px | 1fr | 380px`. The centre column is a single vertical stack whose only flexible row is the preview; every other row is intrinsically sized, so window resizing changes the preview and nothing else. The dock is resizable between 320 and 520px by dragging its edge (desktop only) and the width persists.

### Layout: tablet (640–1024)

```
┌──────────────────────────────────────────────────────────┐
│ ◆  Studio │ Moments │ Destinations │ Recordings      ⚙   │  56px top bar
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │                    PREVIEW                           │ │
│ │                                                      │ │
│ └──────────────────────────────────────────────────────┘ │
│  16:9 │ 9:16 │ 1:1      ⬤ Good ⌄   Rec ● 04:12   [💬 3] │  <- dock becomes a
│                                                          │     button, top-right
│ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐                     │     of this row
│ │ ⏳ ││ 🎥 ││ 🖥 ││ 👥 ││ ☕ ││ 👋 │  ← horizontal scroll │
│ └────┘└════┘└────┘└────┘└────┘└────┘                     │
│                                                          │
│ ┌──────────────┬──────────────┬──────────────┐           │
│ │ 🎥 FaceTime⌄ │ 🎙 Yeti ⌄    │ 🖥 Share ⌄   │           │
│ └──────────────┴──────────────┴──────────────┘           │
│                                                          │
│ ● YouTube Ready   ● Twitch Ready   ● TikTok Not conn.    │  ← horizontal scroll
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ⬤ Ready to go live                                   │ │
│ │                  G O   L I V E                       │ │  76px tall
│ │                  Going live on 2                     │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
   dock opens as a right-edge Sheet, 420px, over the preview,
   dismissible; the preview does NOT resize when it opens
```

The dock is a Sheet rather than a column because a 380px dock inside 1024px leaves the preview too small to judge framing. The chat-unread count rides on the dock button.

### Layout: mobile (<640)

```
┌────────────────────────────────┐
│ Demo mode — "Demo YouTube" is  │  banner, when applicable
│ simulated.      Manage         │
├────────────────────────────────┤
│ ┌────────────────────────────┐ │
│ │                            │ │
│ │                            │ │
│ │       PREVIEW  9:16        │ │  <- 9:16 is the DEFAULT on
│ │       (default ratio)      │ │     mobile, not 16:9
│ │                            │ │
│ │                            │ │
│ │  ⬤ Good        Rec ● 4:12  │ │  <- health + rec overlay
│ │                            │ │     INSIDE the preview's
│ └────────────────────────────┘ │     bottom edge
│  9:16 │ 16:9 │ 1:1            │
├────────────────────────────────┤
│ ┌────┐┌────┐┌────┐┌────┐ →     │  Moment strip, 104px cards
│ │ ⏳ ││ 🎥 ││ 🖥 ││ 👥 │       │  horizontal snap-scroll
│ │Star││Main││Scre││Gues│       │
│ └────┘└════┘└────┘└────┘       │
├────────────────────────────────┤
│ [🎥]  [🎙 ▇▇▅]  [🖥]  [💬 3]   │  device controls collapse to
│  cam    mic     screen  chat   │  4 IconButtons, 56px, tap
│                                │  opens that picker as a Sheet
├────────────────────────────────┤
│ ● YouTube  ● Twitch  ● TikTok  │  chips only, no status text;
│                          →     │  tap opens the dest. sheet
├────────────────────────────────┤
│ ⬤ Ready to go live             │
│ ┌────────────────────────────┐ │
│ │       G O   L I V E        │ │  64px, full width minus
│ │       Going live on 2      │ │  space-4, pinned above nav
│ └────────────────────────────┘ │
├────────────────────────────────┤
│  ▣     ⇅    ( ▶ )   ⬤    ⚙    │  bottom nav, 64px + safe area
└────────────────────────────────┘
```

Mobile differences that matter: 9:16 is the default aspect ratio and the first toggle option (mobile creators are vertical-first — B §5.1); the device controls are icons that open Sheets rather than inline Selects; health and recording ride inside the preview to buy vertical space; the dock is a bottom Sheet at 88% height with the same three Tabs.

### The live state, in detail

This is the part of the product where restraint matters most. When `ProductionState` becomes `LIVE`:

**What changes (and only this):**

| Element | Change |
|---|---|
| GO LIVE button | Becomes `● END  {elapsed}` with the subtitle "Live on {n}". Same position, same size, `accent-live` fill retained. It is the only element that changes size class. |
| Pre-flight row | Replaced *in place* by the HealthPill's expanded one-liner: "{HealthAssessment.headline} — {detail}". Same height, so nothing below moves. |
| Destination chips | Transition `STARTING → LIVE` with status text switching to "{height}p · {mbps} Mbps · {viewers} watching". |
| Preview | Gains a 2px `accent-live` inset border and a small "LIVE" Badge in the top-left corner, inside the preview bounds. |
| Recording indicator | If recording, `Rec ● {elapsed}` turns from `text-tertiary` to `danger`. |
| Moment strip | The active card gains the `accent-live` ring instead of the `accent-focus` ring. Cards stay exactly where they are. |
| Tab title / dock badge | Browser tab title becomes "● LIVE {elapsed} — LIVETAP". |

**What becomes unavailable, and why:**

| Control | While live | Why |
|---|---|---|
| Master aspect-ratio toggle | Disabled, with Tooltip "Locked while you are live — {platform} cannot change format mid-stream." | YouTube documents that vertical format cannot be added after the stream starts (B §1.6). Offering the toggle would break the stream, not the setting. |
| Quality preset (Settings) | Disabled, Tooltip "Locked while you are live. LIVETAP is adjusting quality automatically." | Re-negotiating the encoder mid-broadcast drops every destination. |
| Encoder / resolution / fps / codec / keyframe interval / rate control (Pro) | Disabled with the same lock treatment and an explanatory line in the Settings group header: "These are locked while you are live." | Same reason; and the user needs to know it is locked *before* they hunt for it. |
| Recording on/off | **Stays available.** Starting or stopping a recording mid-stream is safe and sometimes necessary. | Never disable something that works. |
| Adding a destination | Available; it lands as `DISCONNECTED`/`READY` and is *not* joined to the running broadcast. Its chip shows "Ready · joins your next stream". | Honest, and it stops a user waiting for a destination that will never light up. |
| Removing a live destination | Available behind its ⋯ menu as "Stop this destination", never as "Remove". Remove is disabled while that destination is live, Tooltip "Stop it first." | Removing the config under a running connection is how ghost sessions happen (B §5.2). |
| Moment switching | **Available and encouraged.** This is the one thing the live screen is for. | |
| Camera / mic / screen device switching | **Available.** Switching a camera mid-stream is a 200ms cut on the program output, and the picker says so: "Switching now will show a brief cut to viewers." | |
| Mute | **Available**, and while muted the mic control shows a persistent `warning` state plus the preview shows a "Muted" Badge next to "LIVE" — because a forgotten mute is the most common silent failure in the category (A §1.7). |
| Sign out / mode switch | Sign-out disabled, Tooltip "You are live." Pro-mode switch stays available — showing more information is never dangerous. |

**What must never move while live (normative).** The GO LIVE/END button's bounding box; the Moment strip's position and card order; the destination chip row's position and order; the preview's position; the device control row's position; the navigation chrome. No banner, card, toast or sheet may push any of these. Everything that needs to appear while live appears *inside the dock* or as a `Banner` in the one reserved slot directly beneath the navigation chrome, whose height is reserved (collapsed to 0) at all times so its appearance shifts nothing.

**Post-stream.** When the last destination reaches `ENDED`, the dock is replaced by a summary panel (same width, same position): heading "Stream ended", then "You were live for 1h 04m", a per-destination row ("YouTube · 1h 04m · 312 peak viewers · Watch"), a recording row ("Recording saved · 2.1 GB · Show in folder" / "Download"), and one primary Button **"Done"**. Dismissing it returns the dock to its tabs and re-arms the destinations to `READY`.

### States

| State | What the user sees |
|---|---|
| **First run** (no destinations, devices fine) | Everything renders normally. The chip row is replaced by a single inline prompt: "No destinations yet — LIVETAP needs one place to send your stream." with the text link "Add a destination". GO LIVE is secondary/disabled with the subtitle "No destination is ready". The Moment strip, preview and device controls are fully live so the user can play with the product before committing an account. This matters: the first thing a new user should see is their own face working, not a wall of setup. |
| **Empty** (no camera and no mic) | The preview shows the active Moment composed without a camera layer — i.e. the Starting Soon card — not a black rectangle and not a placeholder graphic. A `Banner` in the reserved slot: "No camera or microphone found. Viewers will see your title card and hear nothing." with the link "Look again". |
| **Loading** (app start) | The preview area is `bg-2` at the correct aspect ratio with a centred Spinner and the label "Starting the preview…". The Moment strip renders immediately with the six default cards (they are local data, so they never need a skeleton). Chips render as `DISCONNECTED` and resolve as tokens are validated; they never show a skeleton shimmer, because a fake state is worse than an honest pending one. |
| **Error** (production-level: `NETWORK_OFFLINE`, `ENCODER_FAILED`, `DISK_FULL`) | `ErrorCard` rendered as a `Banner` in the reserved slot, per §4.1. The preview keeps running — LIVETAP keeps composing and encoding through an outage so the return to live is instant. |
| **Error** (destination-level) | Nothing at the top level. The chip turns `FAILED` and the dock's Destinations tab gains a count badge. Tenet 7: one destination's failure gets one destination's worth of screen. |
| **Live** | As specified above. |
| **Degraded while live** | HealthPill turns `health-fair` or `health-poor` with its one-word label; the affected chip goes `DEGRADED`. No banner, no dialog, no sound. LIVETAP is already adapting and says so in the pill's expanded detail. |

### Copy

| Element | String |
|---|---|
| Aspect toggle | "16:9" / "9:16" / "1:1" with the accessible names "Widescreen 16 by 9", "Vertical 9 by 16", "Square 1 by 1". Group label (visually hidden): "Stream shape". |
| Aspect toggle locked | Tooltip "Locked while you are live — platforms cannot change format mid-stream." |
| Moment cards | "Starting Soon", "Main Camera", "Screen Share", "Guest", "Break", "Ending" — exactly these names, exactly this order, always. |
| Moment card helper (on hover/focus only) | "Switch to {name}" / while live "Show {name} to viewers now" |
| Camera control | Label "Camera", value = device name, empty "No camera", muted state "Camera off" |
| Mic control | Label "Microphone", value = device name, empty "No microphone", muted "Muted — viewers hear nothing" |
| Screen control | Label "Screen", off "Not sharing", on "Sharing {window or display name}" |
| Device switch warning (while live) | "Switching now will show a brief cut to viewers." |
| HealthPill (collapsed) | One word, mapped from `HealthLevel` by the table below. |
| HealthPill (expanded) | `HealthAssessment.headline` then `detail`, e.g. "Stream is a little unstable — your upload is dipping now and then. Viewers may see brief stutter." Pro adds the `reasons` list verbatim under a "Details" subhead. |
| Recording indicator | Not recording: "Rec off". Recording: "Rec ● {elapsed}". Tooltip "Recording to {folder}". |
| Pre-flight green | "Ready to go live" |
| Pre-flight amber | "Ready — with {n} thing(s) to know" |
| Pre-flight red | "Not ready to go live" |
| GO LIVE | "GO LIVE" · subtitle "Going live on {n}" / "No destination is ready" / "Going live on {n} · {m} needs attention" / "Going live on {n} · {m} is a demo" |
| Countdown | Numeral plus "Cancel"; caption "Going live in…" |
| END | "END" with the elapsed timer; subtitle "Live on {n}" |
| END grace | "UNDO" with "Ending in {n}"; subtitle "Say your goodbyes." |
| Dock tabs | "Chat" / "Destinations" / "Health" |
| Chat empty | Heading "No messages yet" / body "Messages from every platform that lets us read them will appear here." |
| Chat composer placeholder | "Say something to everyone" · helper when partially supported: "Sends to YouTube and Twitch. TikTok does not allow apps to post chat." |
| Chat unsupported-only | "None of your live destinations let apps read chat. You can still read it on {platform}." with a text link per platform. |
| Destinations tab (dock) | Heading "This stream"; rows per destination with chip + ⋯ menu; footer text link "Manage destinations". |
| Health tab (Simple) | The pill's headline and detail, plus a single sentence of history: "Steady for the last 12 minutes." |
| Health tab (Pro) | Adds `EngineMetrics` as a two-column table: "Bitrate 5,840 / 6,000 kbps", "Dropped (network) 0.2%", "Encoder lag 0.0%", "Render 60 / 60 fps", "CPU 34%", "Latency 1,840 ms", plus a 60-second sparkline of bitrate. |

#### The HealthPill vocabulary

`HealthLevel` has exactly six values and the pill shows exactly one word per value. The word is never pluralised, qualified or combined.

| `HealthLevel` | Pill word | Colour | Dot | Expanded headline (from `HealthAssessment.headline`) |
|---|---|---|---|---|
| `excellent` | "Excellent" | `health-excellent` | Solid | "Stream is excellent" |
| `good` | "Good" | `health-good` | Solid | "Stream is healthy" |
| `fair` | "Fair" | `health-fair` | Solid | "Stream is a little unstable" |
| `poor` | "Poor" | `health-poor` | Solid | "Stream quality is suffering" |
| `critical` | "Critical" | `health-critical` | Solid — no pulse. Only a `LIVE`/`RECONNECTING` destination dot pulses; the word plus the red is the signal here | "Stream is at risk" |
| `unknown` | "Checking" | `health-unknown` | Hollow ring | "Waiting for stream data" |

The pill is the same size for every value, so a health change never reflows the row it sits in (tenet 9). Transitions between words cross-fade over 200ms and only announce on entry to `fair` or worse (§ Accessibility notes).

### Simple vs Pro differences

| Aspect | Simple | Pro (additions only) |
|---|---|---|
| Preview | Identical | Adds a small "Program" label and, in the corner, `{width}×{height} · {fps}fps · {codec}` as 12px `text-tertiary`. |
| Moment strip | Identical | Each card gains a hotkey hint chip (`Kbd`) in its corner when a hotkey is bound. |
| Device controls | Identical | The mic control gains a disclosure with gain slider, "Hear it myself" toggle, and the noise-suppression/echo/auto-gain switches (three switches, and never the words "Monitor and Output" — §6). |
| Destination chips | Identical | Each chip's ⋯ menu adds "Per-destination bitrate" and "Aspect ratio for this destination". |
| HealthPill | One word, expandable to headline + detail | Expansion additionally shows `reasons` and the metrics table. |
| Dock | 3 tabs | Same 3 tabs; the Health tab gains the metrics table and sparkline, and the Destinations tab rows gain the technical disclosure inside their ErrorCards. |
| GO LIVE | Identical in every respect | Identical. Deliberately — the most important control in the product must not acquire complexity in Pro. |

### Accessibility notes

- **Focus order** (desktop): nav rail → banner slot (if occupied) → preview (focusable container, `aria-label="Program preview, {Moment name}"`) → aspect toggle group → HealthPill → Moment strip (single tab stop, arrow keys move between cards, `Enter` activates) → camera control → mic control → screen control → destination chip row (single tab stop, arrows move) → pre-flight row → **GO LIVE** → dock tabs → dock content. GO LIVE holds initial focus on mount.
- **Keyboard shortcuts** (global while Studio is focused, never while a text field has focus): `Space` — toggle mic mute; `1`–`6` — switch to that Moment; `G` — start the GO LIVE countdown; `Escape` — cancel countdown / cancel END grace; `Ctrl/Cmd+E` — END; `Ctrl/Cmd+R` — toggle recording; `Ctrl/Cmd+1/2/3` — dock tab; `?` — shortcut sheet. All are listed in Settings → Hotkeys (Pro) and in the `?` sheet (both modes). No shortcut is destructive without an undo (`Ctrl/Cmd+E` enters the 5s grace, it does not end immediately).
- **Live-region announcements** (one polite region, one assertive region):
  - polite: Moment switches ("Showing Screen Share"), device changes ("Microphone: Blue Yeti"), mute ("Microphone muted. Viewers hear nothing."), recording ("Recording started"), health transitions but only when crossing into `fair` or worse and no more than once per 30s ("Stream quality is suffering — your connection cannot sustain this quality. LIVETAP is adapting.").
  - assertive: going-live countdown start and completion, END grace start, every destination reaching `FAILED` ("YouTube failed: did not accept the stream key."), and `NETWORK_OFFLINE`.
  - The elapsed timer and the chat stream are **not** announced continuously. Chat has an "Announce new messages" toggle, default off, in the dock's ⋯ menu.
- The preview is not a `<video>` alone: it is a labelled region whose accessible description states the composition in words — "Main Camera: your camera, full frame" / "Screen Share: your screen with your camera bottom-right" — generated from the Moment's layers. A blind creator can confirm what viewers see.
- Every meter has a textual twin (§5b pattern). Every state chip's colour has a label. Every disabled control has a Tooltip *and* `aria-describedby` giving the reason, because "why can't I press this" is the question a disabled control always raises.
- Touch targets: 44×44px minimum everywhere; Moment cards are 104px on mobile; GO LIVE is 64px tall on mobile and never within 16px of the bottom nav.
---

## 5d. Destinations

### Purpose

Destinations is where the promise's first sentence is kept. It manages connected accounts, tells the truth about what each platform will and will not let an app do, and makes the stream-key path feel like a first-class citizen rather than a workaround — because for four of the nine platforms it is the only path that exists. It is also the screen that must never lie: an honest "Not available" here prevents an hour of wasted setup, which the research names as the most common reason a first stream never happens (B §1.3).

### Primary action

**Add destination** → `/destinations/add`.

### Layout: desktop (>1024)

```
┌────┬────────────────────────────────────────────────────────────────────────┐
│ ◆  │  Destinations                                    [ + Add destination ] │
│    │  LIVETAP streams to all the destinations you switch on, at once.       │
│ ▶  │                                                                        │
│ ▣  │  ┌──────────────────────────────────────────────────────────────────┐  │
│ ⇅  │  │ (av) YouTube · Late Night Build          ● Ready      [ ⏻ ] [⋯] │  │
│ ⬤  │  │      Goes live when you tap GO LIVE                              │  │
│    │  │      16:9 · up to 1080p60 · youtube.com/@latenightbuild ↗         │  │
│    │  └──────────────────────────────────────────────────────────────────┘  │
│    │  ┌──────────────────────────────────────────────────────────────────┐  │
│    │  │ (av) Twitch · latenightbuild             ● Ready      [ ⏻ ] [⋯] │  │
│    │  │      Goes live when you tap GO LIVE                              │  │
│    │  │      16:9 · up to 1080p60 · twitch.tv/latenightbuild ↗            │  │
│    │  └──────────────────────────────────────────────────────────────────┘  │
│    │  ┌──────────────────────────────────────────────────────────────────┐  │
│    │  │ (av) Instagram · @nightbuild             ● Failed     [ ⏻ ] [⋯] │  │
│    │  │  ┌────────────────────────────────────────────────────────────┐  │  │
│    │  │  │ ◈ Instagram did not accept the stream key.                 │  │  │
│    │  │  │   The key is wrong, expired, or was reset on the platform.  │  │  │
│    │  │  │   ┌──────────────────────────────────────────────────────┐  │  │  │
│    │  │  │   │ ⟳ LIVETAP did not go live here. Your other…         │  │  │  │
│    │  │  │   └──────────────────────────────────────────────────────┘  │  │  │
│    │  │  │   You can: Copy a fresh stream key from Instagram…         │  │  │
│    │  │  │   [ Paste a new key ]                                      │  │  │
│    │  │  └────────────────────────────────────────────────────────────┘  │  │
│    │  └──────────────────────────────────────────────────────────────────┘  │
│    │                                                                        │
│    │  Not connected                                                         │
│ ⚙  │  TikTok · Kick · Facebook · X · LinkedIn · Other          [ + Add ]    │
└────┴────────────────────────────────────────────────────────────────────────┘
```

Single column, max 880px, left-aligned (not centred — a centred list of variable-height cards reads as unstable). Cards are `bg-1`, `radius-lg`, `space-5` padding, `space-4` gap. Drag-handle on hover at the left edge reorders; the order is the chip order in Studio.

### Layout: tablet (640–1024)

```
┌──────────────────────────────────────────────────────────┐
│ ◆  Studio │ Moments │ Destinations │ Recordings      ⚙   │
├──────────────────────────────────────────────────────────┤
│  Destinations                        [ + Add destination]│
│  LIVETAP streams to all of these at once.                │
│                                                          │
│ ┌──────────────────────┐ ┌──────────────────────┐         │  2-up grid of
│ │ (av) YouTube         │ │ (av) Twitch          │         │  compact cards
│ │  Late Night Build    │ │  latenightbuild      │         │  (no watch URL
│ │  ● Ready      [⏻][⋯]│ │  ● Ready      [⏻][⋯]│         │   line — it moves
│ │  16:9 · 1080p60      │ │  16:9 · 1080p60      │         │   into ⋯)
│ └──────────────────────┘ └──────────────────────┘         │
│ ┌─────────────────────────────────────────────────┐       │  a card with an
│ │ (av) Instagram · @nightbuild   ● Failed  [⏻][⋯]│       │  ErrorCard spans
│ │  ◈ Instagram did not accept the stream key.     │       │  BOTH columns —
│ │    … [ Paste a new key ]                        │       │  errors get width
│ └─────────────────────────────────────────────────┘       │
│                                                          │
│  Not connected: TikTok · Kick · Facebook · X · LinkedIn  │
└──────────────────────────────────────────────────────────┘
```

### Layout: mobile (<640)

```
┌────────────────────────────────┐
│  Destinations                  │
│  Streams to all at once.       │
├────────────────────────────────┤
│ ┌────────────────────────────┐ │  full-width rows, 88px,
│ │ (av) YouTube          [⏻]  │ │  the toggle is the only
│ │  Late Night Build          │ │  inline control; the whole
│ │  ● Ready                 › │ │  row opens the detail Sheet
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ (av) Twitch           [⏻]  │ │
│ │  latenightbuild            │ │
│ │  ● Ready                 › │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ (av) Instagram        [⏻]  │ │  a failed row shows only
│ │  @nightbuild               │ │  the WHAT line + one
│ │  ● Failed                  │ │  button; the full card is
│ │  Did not accept the key.   │ │  in the detail Sheet
│ │  [ Paste a new key ]       │ │
│ └────────────────────────────┘ │
├────────────────────────────────┤
│ ┌────────────────────────────┐ │  sticky, above nav
│ │    + Add destination       │ │
│ └────────────────────────────┘ │
├────────────────────────────────┤
│  ▣     ⇅    ( ▶ )   ⬤    ⚙    │
└────────────────────────────────┘
```

### The Add-destination sheet

Opens as a `Sheet`: right-edge 480px on desktop, centred 560px modal on tablet, full-height bottom sheet on mobile. It lists **all nine** `PlatformId`s — never a filtered list — because absence would read as "not supported yet" when for some platforms it means "not possible".

Header: "Add a destination" / "LIVETAP can stream to all of these at once. How you connect depends on what each platform allows."

**Capability badges.** Exactly three badge values, and they mean exactly this:

| Badge | Meaning | Underlying `CapabilityClass` |
|---|---|---|
| **Connect with account** (`success` Badge) | Sign in once and LIVETAP handles the broadcast itself. | `NATIVE_API` / `OAUTH_API` for the go-live path |
| **Paste stream key** (`info` Badge) | The platform gives *you* a key; LIVETAP pushes to it. Some steps stay in the platform's own app. | `RTMP_DESTINATION` / `USER_ASSISTED` |
| **Not available** (neutral Badge, row `aria-disabled`) | The platform does not allow an app like LIVETAP to do this. | `UNAVAILABLE` / `PARTNER_APPROVAL_REQUIRED` |

| Platform | Badge | One-line truth shown under the name |
|---|---|---|
| YouTube | **Connect with account** | "Sign in with Google. LIVETAP creates the broadcast, gets the key and takes it live for you." |
| Twitch | **Connect with account** | "Sign in with Twitch. Your stream goes live the moment LIVETAP starts sending." |
| Kick | **Connect with account** | "Sign in with Kick. Chat needs a public web address, so chat is read-only in this build." |
| Facebook | **Paste stream key** | "Copy a key from Facebook Live Producer. Connecting with your account needs Meta's review — not in this build." |
| Instagram | **Paste stream key** | "Copy a key from Instagram Live Producer. Instagram issues a new key every time, and you press Go live there." |
| TikTok | **Paste stream key** | "Copy a key from TikTok's LIVE dashboard. TikTok has no public app access, and LIVE access is granted per account." |
| X | **Paste stream key** | "Copy a key from X Live Studio. Needs X Premium, and you start the broadcast in X yourself." |
| LinkedIn | **Not available** | "LinkedIn only allows approved partner tools to go live. LIVETAP is not one, and will not pretend to be." |
| Other (RTMP) | **Paste stream key** | "Any service that accepts RTMP, RTMPS or SRT. Paste the server address and key." |

Below, a collapsed section headed **"Demo destinations"** with the note "These simulate a platform so you can try LIVETAP. They never broadcast anywhere.", containing "Demo YouTube", "Demo Twitch" and "Demo vertical (9:16)", each with a `Demo` Badge.

Footer note, always visible: "Some platforms require your account to meet their own rules before you can go live. LIVETAP checks what it can and tells you before you try."

### The stream-key paste flow

Four steps inside the same Sheet, no navigation:

```
1  Get your key            2  Paste it                3  Name it          4  Done
   "Open {platform}'s         Server URL  [_________]    Label            ● Ready
    live dashboard and        Stream key  [•••••••••]    [Late Night…]    Goes live when
    copy the server URL       [ Open {platform} ↗ ]      Shape  16:9 ⌄    you tap GO LIVE
    and stream key."          validate on blur
```

| Rule | Detail |
|---|---|
| Field types | Server URL is a plain `TextField` with `spellcheck=false`. Stream key is `type="password"` with a "Show" IconButton that reveals it **only while it has focus and only before it is saved**. |
| Validation | On blur: protocol is one of `rtmp`/`rtmps`/`srt`, host resolves in form, key is non-empty and has no whitespace. Errors are field-level and specific: "That looks like a web page address, not a stream server. Stream servers start with rtmp:// or rtmps://." |
| **The key is never displayed again** | Once saved, the key goes to the OS keychain (`safeStorage` on desktop; encrypted local store on web) and the field is replaced permanently by the read-only string **"Saved · ends in {last 4}"** with one Button **"Replace key"**. There is no reveal, no copy, no "show key" anywhere in the product — not in Settings, not in Diagnostics, not in an export. `Replace key` clears the stored value and returns to step 2 with empty fields. |
| Per-session keys | Instagram, TikTok and X issue a new key per broadcast. Their cards show the persistent note "{platform} gives you a new key each time you go live." and, when the stored key is older than 6 hours, the destination's status text becomes "Key may have expired — replace it before you go live" (amber pre-flight item, never a blocker). |
| Platforms that need a manual start | X and Instagram cards carry a permanent 3-step checklist inside the card: "1. Create the broadcast in {platform}. 2. Paste today's key here. 3. Press Go live in {platform} once LIVETAP is sending." This is a fact about the platform, not an error, so it is never styled as one. |
| No key in logs | Keys never enter `technical`, diagnostics, clipboard exports, or crash reports. The UI assumes core's guarantee and never renders a key from any object other than the live form state. |

### Per-destination controls

| Control | Location | Behaviour |
|---|---|---|
| Enable toggle `[⏻]` | Card header | Off means "not in the next stream". Label: "In your next stream". Off destinations render at 55% opacity and their chip leaves the Studio row. Never removes anything. |
| Watch link | Card body, `↗` | Opens `watchUrl` in a new tab. Absent (not disabled) when the platform gives none. |
| Stop | `⋯` menu, live only | "Stop this destination" — leaves the others streaming (tenet 7). Confirmed inline in the menu ("Stop it?" / "Stop" / "Keep streaming"), not in a dialog. |
| Retry | ErrorCard primary action, `FAILED` only | Re-runs the last transition for that destination only. |
| Remove | `⋯` menu, bottom, `danger` text | Opens a small confirm inside the menu: "Remove {label}? Its stream key is deleted from this computer. Your account and past streams are untouched." / **Remove** / "Keep". Disabled while that destination is live. |
| Aspect ratio | `⋯` menu → detail Sheet | `Select` of the platform's `supportedAspectRatios` only; unsupported ratios are absent, with the note "{platform} accepts {list}." |
| Title and description | Detail Sheet | Only rendered when the platform's `metadata` capability is automated. Otherwise the Sheet says "{platform} does not let apps set the title. Set it in {platform} before you go live." |

### States

| State | What the user sees |
|---|---|
| **Empty** (first run) | Heading "No destinations yet". Body: "A destination is one place your stream goes — a YouTube channel, a Twitch channel, anything that accepts a stream. Connect one and LIVETAP does the rest." Primary Button **"Add your first destination"**. Below, as a 3-item list, the three platforms with the easiest path: "YouTube — sign in", "Twitch — sign in", "Other — paste a key". |
| **Loading** | Cards render immediately from stored config with their chip in `AUTHENTICATING` while tokens are validated, status text "Checking your connection…". Avatars use initials until the image loads. No skeletons: the user's own destination names are known locally and showing them is better than showing grey bars. |
| **Error** (one destination) | The ErrorCard renders inline inside that card, per §4.1. The card grows; others do not move (the list is top-anchored). |
| **Error** (token check fails for all — offline) | A `Banner` above the list: "You are offline, so LIVETAP cannot check your connections. Your destinations are still here." No card shows an error, because offline is not a destination's fault. |
| **Live** | Live destinations show `LIVE` chips with bitrate/viewers, and their cards gain a 1px `accent-live` left edge. Remove is disabled; Stop appears. Adding a destination is allowed and its chip reads "Ready · joins your next stream". |
| **All destinations off** | The list renders normally, plus a `Banner`: "Every destination is switched off. Switch one on before you go live." with no action button — the fix is a toggle two centimetres away. |

### Copy

| Element | String |
|---|---|
| Page heading / subhead | "Destinations" / "LIVETAP streams to all the destinations you switch on, at once." |
| Add button | "+ Add destination" |
| Sheet heading / subhead | "Add a destination" / "LIVETAP can stream to all of these at once. How you connect depends on what each platform allows." |
| Connect (OAuth) button | "Connect with account" → while running "Waiting for {platform}…" with a "Cancel" text link |
| Paste key button | "Paste stream key" |
| Not available row | Badge "Not available"; tapping it shows an inline note, never a dead click: "{platform} only allows approved partner tools to go live. We would rather say so than pretend." |
| Saved key display | "Saved · ends in {last4}" / Button "Replace key" |
| Key field helper | "This is a password for your channel. LIVETAP stores it in your system keychain and never shows it again." |
| Enable toggle label | "In your next stream" |
| Remove confirm | "Remove {label}? Its stream key is deleted from this computer. Your account and past streams are untouched." |
| Eligibility note (per platform, when known) | "{platform} requires {requirement} before you can go live." — e.g. "Instagram requires a public account with more than 1,000 followers before you can go live." |

### Simple vs Pro differences

| Aspect | Simple | Pro (additions only) |
|---|---|---|
| Card body | Avatar, platform, account, chip, watch link, aspect + quality summary | Adds one 12px line: "{protocol} · {host} · key ends in {last4}" — host and protocol only, never the key. |
| `⋯` menu | Stop / Aspect ratio / Title / Remove | Adds "Per-destination bitrate", "Backup ingest" (when the platform provides one), "Reconnect policy for this destination". |
| Add sheet | Nine platforms + demo section | Identical, plus an "Other (RTMP)" expansion offering SRT passphrase and WHIP bearer fields. |
| Capability truth | One line per platform | Adds a "What LIVETAP can do here" disclosure listing each capability with its class in plain words: "Set the title — yes", "Set a thumbnail — no, {platform} does not allow it", "Read chat — yes", "Post to chat — no". |

### Accessibility notes

- Focus order: heading → Add destination → each card in list order (card is a group; inside it: enable toggle → watch link → `⋯` → any ErrorCard primary action) → the "Not connected" summary links.
- The Sheet is a focus trap with `role="dialog"`, `aria-labelledby` on its heading. `Escape` closes it and returns focus to the Add button. Closing with unsaved key text asks inline: "Discard this key?" / "Discard" / "Keep editing".
- `Not available` rows are `<button aria-disabled="true">` (focusable, so a screen-reader user can hear *why*) with `aria-describedby` pointing at the reason text. They are never `disabled`, because a silently unfocusable row teaches nothing.
- The stream-key field has `autocomplete="off"`, `aria-describedby` on the helper text, and its reveal button announces "Show stream key" / "Hide stream key". After save, the replaced value is announced once: "Stream key saved. It will not be shown again."
- Reordering is keyboard-operable: focus a card, `Ctrl/Cmd+↑/↓` moves it, and the live region says "YouTube moved to position 2 of 3."
- Chip colour is never load-bearing (§4.2); every card's accessible name is "{platform}, {account}, {state label}, {status text}".

---

## 5e. Moments editor

### Purpose

The Moments editor is where the "one noun, not four" tenet is kept honest. A beginner needs to change *where their face sits* and nothing more, and they should reach that in one tap from a picture, not from a tree of sources. A Pro user needs the real layer graph — visibility, z-order, placement — in the same screen, not a different app. Both are served by the same route because a Moment is one object in both modes.

### Primary action

**Save** is not the primary action — edits apply live to the preview and persist immediately. The primary action is **"Use this layout"** in Simple (applying a template) and **"Add layer"** in Pro.

### Layout: desktop (>1024)

```
┌────┬──────────────────────────────────────────────────────────────────────────┐
│ ◆  │  Moments                                                    Reset all ⟲  │
│    │  ┌────┬────┬────┬────┬────┬────┐                                         │
│ ▶  │  │ ⏳ │ 🎥 │ 🖥 │ 👥 │ ☕ │ 👋 │   ← the same six cards as Studio        │
│ ▣  │  └────┴════┴────┴────┴────┴────┘                                         │
│ ⇅  │                                                                          │
│ ⬤  │  Main Camera                                                    [ ⟲ ]    │
│    │  ┌──────────────────────────────┐  ┌────────────────────────────────────┐ │
│    │  │                              │  │  SIMPLE: pick a layout             │ │
│    │  │   live editable preview      │  │  ┌────────┐ ┌────────┐ ┌────────┐  │ │
│    │  │   (drag handles in Pro)      │  │  │ ▣ Full │ │ ▣▫ Cam │ │ ▫▣ Side│  │ │
│    │  │                              │  │  │ frame  │ │ corner │ │ by side│  │ │
│    │  │                              │  │  └────────┘ └────────┘ └────────┘  │ │
│    │  └──────────────────────────────┘  │  ┌────────┐ ┌────────┐ ┌────────┐  │ │
│    │   16:9 │ 9:16 │ 1:1                │  │ ▣ Title│ │ ▣ Scr. │ │ ▫ Just │  │ │
│    │   Placement is saved per shape.    │  │  card  │ │ + cam  │ │ a card │  │ │
│    │                                    │  └────────┘ └────────┘ └────────┘  │ │
│    │                                    │  [ Use this layout ]               │ │
│    │                                    ├────────────────────────────────────┤ │
│ ⚙  │                                    │  Audio: 🎙 Blue Yeti · not muted   │ │
│    │                                    │  System sound  [off]               │ │
└────┴────────────────────────────────────┴────────────────────────────────────┘─┘
```

Pro replaces the template grid with the layer list in the same panel:

```
  ┌────────────────────────────────────┐
  │  Layers                 [+ Layer]  │
  │  ═══════════════════════════════   │
  │  ⠿ 👁 Title           z 50   ⋯     │   drag to reorder = z-order,
  │  ⠿ 👁 Camera          z 10   ⋯     │   top row renders on top
  │  ⠿ 🚫 Screen          z  5   ⋯     │   🚫 = hidden
  │  ⠿ 👁 Background      z  0   ⋯     │
  │  ─────────────────────────────────  │
  │  Camera                             │   selected layer's inspector
  │  Device     FaceTime HD ⌄           │
  │  Placement  x 0.74 y 0.70           │
  │             w 0.22 h 0.26           │
  │  Shape      ● this shape only       │
  │             ○ all shapes            │
  │  Corner radius   20                 │
  │  Mirror     [on]                    │
  │  Fit        cover ⌄                 │
  │  Opacity    ████████░░  100%        │
  │  ─────────────────────────────────  │
  │  Transition   Fade · 300 ms         │
  │  Hotkey       [ 2 ]                 │
  └────────────────────────────────────┘
```

### Layout: tablet (640–1024)

```
┌──────────────────────────────────────────────────────────┐
│ ◆  Studio │ Moments │ Destinations │ Recordings      ⚙   │
├──────────────────────────────────────────────────────────┤
│ ┌────┬────┬────┬────┬────┬────┐              Reset all ⟲ │
│ │ ⏳ │ 🎥 │ 🖥 │ 👥 │ ☕ │ 👋 │                          │
│ └────┴════┴────┴────┴────┴────┘                          │
├──────────────────────────────────────────────────────────┤
│  Main Camera                                      [ ⟲ ]  │
│ ┌──────────────────────────────────────────────────────┐ │  preview goes
│ │            live editable preview                     │ │  FULL WIDTH and
│ └──────────────────────────────────────────────────────┘ │  the panel moves
│  16:9 │ 9:16 │ 1:1     Placement is saved per shape.     │  below it
├──────────────────────────────────────────────────────────┤
│  Layout    ┌──────┐┌──────┐┌──────┐┌──────┐  ← 4-up      │
│            │ Full ││ Cam  ││ Side ││ Title│    scroll    │
│            └══════┘└──────┘└──────┘└──────┘              │
│            [ Use this layout ]                           │
│  Audio     🎙 Blue Yeti · not muted   System sound [off] │
└──────────────────────────────────────────────────────────┘
   Pro: the layer list becomes a collapsible section under Layout,
   and tapping a layer opens its inspector as a right-edge Sheet
```

### Layout: mobile (<640)

```
┌────────────────────────────────┐
│  Moments                       │
├────────────────────────────────┤
│ ┌────┐┌────┐┌────┐┌────┐  →    │  strip scrolls; tap selects
│ │ ⏳ ││ 🎥 ││ 🖥 ││ 👥 │       │
│ └────┘└════┘└────┘└────┘       │
├────────────────────────────────┤
│  Main Camera            ⟲      │
│ ┌────────────────────────────┐ │
│ │                            │ │  preview is 9:16 by default
│ │      editable preview      │ │  on mobile, matching Studio
│ │      (tap a layout below)  │ │
│ │                            │ │
│ └────────────────────────────┘ │
│  9:16 │ 16:9 │ 1:1            │
├────────────────────────────────┤
│  Layout                        │
│ ┌────────┐┌────────┐┌────────┐ │  2.5 cards visible,
│ │  Full  ││  Cam   ││  Side  │ │  snap-scroll, tapping a
│ │ frame  ││ corner ││ by side│ │  card applies it IMMEDIATELY
│ └════════┘└────────┘└────────┘ │  (no separate Use button —
│                                │  the preview is the confirm)
├────────────────────────────────┤
│  Audio                       › │  opens a Sheet
├────────────────────────────────┤
│  ▣     ⇅    ( ▶ )   ⬤    ⚙    │
└────────────────────────────────┘
   Pro adds one row: "Layers (4)  ›" opening a full-height Sheet
   with the layer list and inspector stacked
```

### Simple mode: the layout templates

Six templates, named for what the viewer sees, never for the mechanism:

| Template | What it does | Sensible for |
|---|---|---|
| **Full frame** | Camera fills the canvas. | Main Camera |
| **Camera corner** | Screen or background fills the canvas; camera sits bottom-right at 22% width with a 20px radius. | Screen Share |
| **Side by side** | Two equal panes, camera left, guest or screen right. | Guest |
| **Title card** | Background colour plus one large line of text, camera hidden. | Starting Soon, Break |
| **Screen with camera strip** | Screen fills the top 60%; camera is a full-width strip beneath it. | Screen Share on vertical |
| **Just a card** | Background and text only, no camera, no screen. | Ending, Break |

Applying a template preserves the Moment's device choices, audio state, text content and transition — it only rewrites `placement`, `visible` and `z` on existing layers. It never deletes a layer. If the Moment has Pro-authored layers that no template describes, the picker shows a seventh, selected, non-applyable card labelled **"Custom layout"**, and choosing any other template first asks inline: "Replace your custom layout? Your camera, text and sound settings are kept — only the arrangement changes." / **Replace** / "Keep custom".

### States

| State | What the user sees |
|---|---|
| **First run** | "Main Camera" is selected, its template is Full frame, and the preview shows the user's camera. A single dismissible hint under the strip: "These six Moments are what viewers see. Tap one in Studio to switch to it." |
| **Empty** (a Moment with no visible layers) | The preview shows the canvas background with centred `text-tertiary` text "Nothing is visible in this Moment." plus, in Simple, the text link "Pick a layout" and in Pro "Show a hidden layer". Never an empty black box (tenet 6). |
| **Loading** | The strip and the panel render instantly from local Moment data. Only the preview waits, showing `bg-2` plus "Starting the preview…". |
| **Error** (`CAMERA_LOST` / `SCREEN_DENIED` while editing) | ErrorCard inline above the panel; the affected layer's row in the Pro list gains a `danger` dot and the status "No signal". The preview composes without it rather than going black. |
| **Live** | **The editor is fully usable while live**, and this is deliberate — fixing a badly framed camera mid-stream is a real need. Every change applies to the program output immediately, and the header carries a persistent `accent-live` note: "You are live. Changes here are visible to viewers straight away." The aspect-ratio toggle here is locked with the same Tooltip as Studio, and Reset is disabled while live ("Too destructive while you are live"). |
| **Reset** | Per-Moment `⟲` and page-level "Reset all" both confirm inline: "Reset {name} to how it shipped? Your device choices are kept." / **Reset** / "Cancel". Built-in Moments (`builtIn: true`) can be reset but never deleted; Delete is absent from their menus, not disabled. |

### Copy

| Element | String |
|---|---|
| Page heading | "Moments" |
| Page subhead (first visit only) | "A Moment is one thing viewers see. LIVETAP gives you six; change them however you like." |
| Aspect note | "Placement is saved per shape, so your vertical stream can be framed differently from your widescreen one." |
| Layout section heading | "Layout" |
| Apply button | "Use this layout" |
| Audio row (Simple) | "Audio" → "{mic name} · {muted | not muted}" and one toggle "System sound" with the helper "Include sound from your computer — music, game audio, a video you play." |
| Pro layer list heading | "Layers" with the helper "The top layer is in front." |
| Add layer menu | "Camera", "Screen or window", "Image", "Video", "Text", "Web page", "Overlay", "Background colour" |
| Visibility toggle | Accessible names "Hide {layer name}" / "Show {layer name}" |
| Placement shape scope | "this shape only" / "all shapes" with the helper "Apply this placement to 16:9, 9:16 and 1:1 together." |
| Web-page layer helper | "Only https:// addresses. Each web page layer uses a browser engine, so keep these to a few." |
| Transition row | "Transition" → "Fade · 300 ms" |
| Hotkey row (Pro) | "Hotkey" → `Kbd` with the helper "Pressed anywhere in LIVETAP, including while live." |
| Reset (per Moment) | "Reset {name} to how it shipped? Your device choices are kept." |
| Reset all | "Reset all six Moments? Your cameras, microphones and text are kept; only arrangements change." |
| Live warning | "You are live. Changes here are visible to viewers straight away." |

### Simple vs Pro differences

| Aspect | Simple | Pro (additions only) |
|---|---|---|
| Right panel | Template grid + audio summary | Layer list + selected-layer inspector + transition + hotkey. The audio summary stays, in the same place, with its two controls, and gains a disclosure for gain, "Hear it myself", noise suppression, echo cancellation and auto-gain. |
| Preview | Read-only | Drag and resize handles on the selected layer; `Shift` constrains ratio; arrow keys nudge 1px, `Shift+arrow` 10px; snap guides at edges, centre and thirds. |
| Layer visibility / z-order / placement | Not exposed (templates set them) | Fully exposed as above. |
| Add / delete layers | Not available | Available for non-built-in layers; deleting shows an inline undo for 10s ("Camera removed. Undo"). |
| Templates | Primary interface | **Still present, unchanged, in the same position** — a Pro user can still apply Full frame in one tap (tenet 10). |

### Accessibility notes

- Focus order: heading → Moment strip (single tab stop, arrows move, `Enter` selects) → Moment name → reset → preview → aspect toggle → panel (templates grid, arrows move within it) → apply → audio.
- Template cards are radio-group semantics (`role="radio"` in a `role="radiogroup"` labelled "Layout") with accessible names that describe the result, not the picture: "Camera corner — your screen fills the frame with your camera in the bottom-right corner."
- The Pro layer list is a `role="listbox"` with `aria-activedescendant`; reordering is `Ctrl/Cmd+↑/↓` and announces "Camera moved above Screen. Camera is now in front."
- Drag handles are never the only way to do anything: every drag operation has a numeric field in the inspector and a keyboard equivalent.
- Placement numbers are exposed as spinbuttons in normalised 0–1 units with `aria-valuetext` in plain language: "0.74 — three quarters across".
- Live edits announce politely and sparingly: "Layout changed to Camera corner. Viewers can see this now." Nothing announces per drag frame.
---

## 5f. Settings

### Purpose

Settings holds the three things a Simple user will ever want to change and everything a Pro user needs to stop resenting the product, in one list, with the Pro half behind one switch. It is the only screen in the product where a long list is correct, and its discipline is that Simple's three groups stay at the top, in the same place, at the same size, in both modes (tenet 10). It is also where irreversible-while-live choices are named as such *before* the user is live, rather than silently failing mid-stream (B §1.6).

### Primary action

**Pro mode** (the first row). Everything else on this screen is a setting, not an action; a Settings screen with a Save button is a Settings screen that can be half-applied, so every control here applies on change.

### Layout: desktop (>1024)

```
┌────┬──────────────────────────────────────────────────────────────────────┐
│ ◆  │  Settings                                                            │
│    │  ┌────────────────────────────────────────────────────────────────┐   │
│ ▶  │  │  Pro mode                                            [ off ]  │   │
│ ▣  │  │  Adds encoder, layer and diagnostic controls. Nothing hidden.  │   │
│ ⇅  │  └────────────────────────────────────────────────────────────────┘   │
│ ⬤  │                                                                      │
│    │  QUALITY                                                             │
│    │  ┌────────────────────────────────────────────────────────────────┐   │
│    │  │  Quality            ( Auto )  720p   1080p                     │   │
│    │  │  Auto measures your connection and computer and keeps          │   │
│    │  │  adjusting while you stream. Right now: 1080p at 60 fps.       │   │
│    │  └────────────────────────────────────────────────────────────────┘   │
│    │  RECORDING                                                           │
│    │  ┌────────────────────────────────────────────────────────────────┐   │
│    │  │  Record every stream                                 [ on  ]   │   │
│    │  │  Saves to  ~/Movies/LIVETAP              [ Change… ]           │   │
│    │  │  312 GB free — about 34 hours at your current quality.         │   │
│    │  └────────────────────────────────────────────────────────────────┘   │
│    │  APPEARANCE                                                          │
│    │  ┌────────────────────────────────────────────────────────────────┐   │
│    │  │  Theme              ( System )  Light   Dark                   │   │
│    │  └────────────────────────────────────────────────────────────────┘   │
│    │  ───────────────────────────────────────────────────────────────────  │
│ ⚙  │  ABOUT   Version 0.4.0 · Licence · What LIVETAP never collects       │
│    │  Run setup again                                                     │
└────┴──────────────────────────────────────────────────────────────────────┘
```

With Pro on, six groups are **appended below Appearance** in this order: Encoder, Audio, Reconnecting, Hotkeys, Diagnostics, Advanced. The three Simple groups do not move.

### Layout: tablet (640–1024)

```
┌──────────────────────────────────────────────────────────┐
│ ◆  Studio │ Moments │ Destinations │ Recordings      ⚙   │
├──────────────────────────────────────────────────────────┤
│  Settings                                                │
│  ┌────────────┬───────────────────────────────────────┐  │  two-pane: group
│  │ Pro mode ○ │  QUALITY                              │  │  index left (fixed
│  │            │  Quality  (Auto) 720p 1080p           │  │  200px), content
│  │ Quality  ● │  Auto measures your connection…       │  │  right. Only at
│  │ Recording  │                                       │  │  this width — the
│  │ Appearance │  RECORDING                            │  │  list is short
│  │ ─────────  │  Record every stream        [on]      │  │  enough to scroll
│  │ Encoder    │  Saves to ~/Movies/LIVETAP  [Change]  │  │  on desktop but
│  │ Audio      │                                       │  │  the index pays
│  │ Reconnect  │  APPEARANCE                           │  │  for itself once
│  │ Hotkeys    │  Theme  (System) Light Dark           │  │  Pro adds 6 more
│  │ Diagnostic │                                       │  │  groups
│  └────────────┴───────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Layout: mobile (<640)

```
┌────────────────────────────────┐
│  Settings                      │
├────────────────────────────────┤
│  Pro mode              [ off ] │  single full-width rows,
│  Adds encoder, layer and       │  56px minimum, grouped by
│  diagnostic controls.          │  a 32px section header
├────────────────────────────────┤
│  QUALITY                       │
│  Quality               Auto  › │  tapping opens a Sheet with
├────────────────────────────────┤  the three options as large
│  RECORDING                     │  radio rows — no segmented
│  Record every stream    [ on ] │  controls at this width
│  Saves to              ⋯ /LIVETAP › │
│  312 GB free · ~34 h           │
├────────────────────────────────┤
│  APPEARANCE                    │
│  Theme               System  › │
├────────────────────────────────┤
│  ABOUT                         │
│  Version 0.4.0              ›  │
│  Run setup again            ›  │
├────────────────────────────────┤
│  ▣     ⇅    ( ▶ )   ⬤    ⚙    │
└────────────────────────────────┘
```

### Simple settings (three groups, both modes)

| Setting | Control | Values | Helper text |
|---|---|---|---|
| Quality | Segmented (desktop/tablet), Sheet of radios (mobile) | **Auto** (default), 720p, 1080p | "Auto measures your connection and computer and keeps adjusting while you stream. Right now: {resolved} at {fps} fps." For fixed values: "LIVETAP will hold this quality and warn you if your connection cannot keep up." |
| Record every stream | Toggle | on (default) / off | "A copy is saved on this computer while you stream. It keeps going even if a platform drops." |
| Saves to | Path + "Change…" | folder picker | "{n} GB free — about {n} hours at your current quality." Web build: "Recordings are saved to your browser's downloads when the stream ends." |
| Theme | Segmented | **System** (default), Light, Dark | — |

### Pro settings (appended, six groups)

| Group | Rows | Notes and honest limits |
|---|---|---|
| **Encoder** | Encoder: Auto / Software (x264) / NVIDIA NVENC / Intel Quick Sync / AMD AMF / Apple VideoToolbox / WebCodecs · Software preset: ultrafast…medium · Rate control: CBR / VBR · Bitrate: kbps number + slider · Resolution: 720p / 1080p / 1440p / 2160p · Frame rate: 24 / 30 / 60 · Codec: H.264 / HEVC / AV1 · Keyframe interval: seconds | Unavailable hardware encoders are listed with the suffix "— not available on this computer" and are `aria-disabled`, never hidden (tenet 8). Codec rows show per-destination consequences inline: "Twitch accepts H.264. Choosing AV1 would leave Twitch out." Keyframe interval defaults to 2s and its helper explains why in one sentence: "Platforms expect a keyframe every 2 seconds. Changing this can make your stream unwatchable on some of them." |
| **Audio** | Microphone · Gain · Hear it myself (toggle) · Include computer sound (toggle) · Computer sound level · Noise suppression · Echo cancellation · Automatic level | **Two switches, never three modes.** "Hear it myself" and "Include computer sound" are independent booleans. The string "Monitor and Output" is banned (§6). If LIVETAP detects the loopback/echo condition (mic audible in the system capture), it raises one card: WHAT "Your voice is going out twice." / WHY "Your microphone is being picked up by your computer's sound capture as well." / DOING "Nothing yet — this is your choice to make." / YOU CAN "Turn off 'Hear it myself', or use headphones." / Primary **"Turn off 'Hear it myself'"**. |
| **Reconnecting** | Reconnect automatically (toggle, default on) · Attempts (default 10) · First wait (default 1s) · Longest wait (default 30s) · Backoff multiplier (default 2.0) | Helper on the group: "When a platform stops receiving your stream, LIVETAP retries that platform only. Your other destinations are never interrupted." Turning it off warns: "With this off, a dropped destination stays dropped until you retry it by hand." |
| **Hotkeys** | A table of every shortcut with an editable `Kbd` binding: Go live, End, Mute microphone, Toggle recording, Moment 1–6, Dock tabs, Shortcut sheet | Conflicts are detected on entry and shown inline: "That is already 'Mute microphone'. Press a different key, or reassign." Global (OS-level) hotkeys are desktop-only and the row says so: "Works even when LIVETAP is not the front window (desktop app only)." |
| **Diagnostics** | Session log (last 2,000 lines, filterable by level) · "Copy log" · "Save log to a file" · Live `EngineMetrics` table · "Run a connection test" | The log never contains a stream key or token, and the panel states that: "Stream keys and sign-in tokens are never written to this log." This is the in-product replacement for log export (tenet 5) — the analysis is here, not on another website. |
| **Advanced** | Master shape (16:9 / 9:16 / 1:1) · Per-destination formats table · Recording container (MP4 / MKV / WebM) · Hardware acceleration for composition (toggle) · Reset all settings | "Reset all settings" confirms with an exact list of what it clears: "This clears your quality, encoder, audio and hotkey settings. Your destinations, their stream keys and your Moments are kept." |

### Irreversible-while-live warnings

| Setting | Treatment while live | Copy |
|---|---|---|
| Master shape (aspect ratio) | Disabled, lock icon | "Locked while you are live — platforms cannot change format mid-stream. End the stream to change this." |
| Quality preset, resolution, fps, codec, keyframe interval, rate control, encoder | Disabled, lock icon, one group-level line | "These are locked while you are live. LIVETAP is adjusting quality automatically within the preset you chose." |
| Per-destination format | Disabled for live destinations only; editable for destinations not in this stream | "Locked while {destination} is live." |
| Recording container | Disabled only while a recording is running | "Locked while recording. Stop the recording to change the file type." |
| Recording folder | Editable; takes effect on the next recording | "The current recording keeps saving where it started." |
| Reconnect policy | Editable; applies to the next reconnect attempt | "Takes effect from the next reconnection." |
| Reset all settings | Disabled | "Not while you are live." |

Every lock is announced once when the user focuses it, never as a toast, and the reason is always in `aria-describedby` — a disabled control without a reason is the trap this section exists to remove.

### States

| State | What the user sees |
|---|---|
| **Default** | As laid out. Every control shows its real current value; nothing says "Default". |
| **Loading** | Only two rows can be pending: free disk space ("Checking…") and the resolved Auto quality ("Measuring…", replaced within 3s by "Right now: 1080p at 60 fps"). Everything else is local and instant. |
| **Empty** | Not applicable — Settings is never empty. The Hotkeys table with no custom bindings still shows all defaults. |
| **Error** | Per-row, inline, humane. Folder not writable: WHAT "LIVETAP cannot save recordings there." / WHY "That folder is read-only or on a disconnected drive." / DOING "Recording stays off until this is fixed." / YOU CAN "Pick another folder." / Primary **"Pick a folder"**. Hardware encoder missing after a driver change: WHAT "NVIDIA NVENC is no longer available." / WHY "The graphics driver changed or the GPU is in use by another app." / DOING "LIVETAP switched to Software encoding so you can still stream." / YOU CAN "Keep Software, or check your graphics driver." / Primary **"Keep Software"**. |
| **Live** | As the lock table. The page is fully navigable; nothing is hidden, only locked. |

### Simple vs Pro differences

Summarised above, and the rule is mechanical: Pro **appends six groups below Appearance** and **appends disclosures inside the Audio summary**. It moves, renames and hides nothing. Turning Pro off leaves every appended value in force (§3.4).

### Accessibility notes

- Each group is a `<section>` with an `<h2>`; the mobile group headers are those same headings, so the document outline is identical at every breakpoint.
- Segmented controls are `role="radiogroup"` with real radios; the mobile Sheet uses the same names so a screen-reader user hears the same labels regardless of width.
- Toggling Pro mode moves focus to the first appended group's heading and announces "Pro mode on. Six more groups added below: Encoder, Audio, Reconnecting, Hotkeys, Diagnostics, Advanced." Turning it off keeps focus on the toggle and announces the kept-settings sentence.
- Hotkey capture fields describe themselves: "Press the keys you want to use for Mute microphone. Press Escape to cancel." Capture never swallows `Tab` or `Escape`.
- The diagnostics log is a `<pre>` inside a labelled region with `tabIndex={0}` so it is scrollable by keyboard, and it is not a live region — a log that announces itself is unusable.
- Every value that includes a unit is announced in full words: "5,800 kilobits per second", "2 seconds", "312 gigabytes free".

---

## 5g. Recordings

### Purpose

Recordings makes the thing LIVETAP saved findable, playable and movable in the fewest possible controls. It exists because the single most trust-destroying event in this category is a session the creator cannot recover (A §5.11), and because a file written to disk that the app never mentions again is functionally lost.

### Primary action

**Download** (web) / **Show in folder** (desktop) on the most recent recording. One action per row, chosen by platform — never both.

### Layout: desktop (>1024)

```
┌────┬─────────────────────────────────────────────────────────────────────┐
│ ◆  │  Recordings                                    312 GB free on disk  │
│    │  Every stream is recorded on this computer unless you turn it off.  │
│ ▶  │                                                                     │
│ ▣  │  ┌───────────────────────────────────────────────────────────────┐  │
│ ⇅  │  │ ▣  Tonight's build stream            1h 04m   2.1 GB   ⋯      │  │
│ ⬤  │  │    11 Sept 2026, 20:14 · 1080p60 · YouTube, Twitch            │  │
│    │  │                                    [ Show in folder ]         │  │
│    │  └───────────────────────────────────────────────────────────────┘  │
│    │  ┌───────────────────────────────────────────────────────────────┐  │
│    │  │ ▣  10 Sept 2026, 19:02              22m 10s   712 MB   ⋯      │  │
│    │  │    1080p60 · Twitch                                           │  │
│    │  │                                    [ Show in folder ]         │  │
│    │  └───────────────────────────────────────────────────────────────┘  │
│    │  ┌───────────────────────────────────────────────────────────────┐  │
│    │  │ ⚠  9 Sept 2026, 21:30               8m 02s    240 MB   ⋯      │  │
│    │  │    Recovered after LIVETAP closed unexpectedly. Plays fine.    │  │
│    │  │                                    [ Show in folder ]         │  │
│    │  └───────────────────────────────────────────────────────────────┘  │
│ ⚙  │                                                                     │
└────┴─────────────────────────────────────────────────────────────────────┘
```

Rows are 88px with a 16:9 thumbnail at 120px wide (a real frame from 10% into the file, not a generic icon). Newest first, always; no sorting control, because a list with one sensible order does not need one.

### Layout: tablet (640–1024)

```
┌──────────────────────────────────────────────────────────┐
│ ◆  Studio │ Moments │ Destinations │ Recordings      ⚙   │
├──────────────────────────────────────────────────────────┤
│  Recordings                          312 GB free         │
│ ┌───────────────────────┐ ┌───────────────────────┐       │  2-up cards with
│ │ ┌───────────────────┐ │ │ ┌───────────────────┐ │       │  the thumbnail on
│ │ │   thumbnail 16:9  │ │ │ │   thumbnail 16:9  │ │       │  TOP — at this
│ │ └───────────────────┘ │ │ └───────────────────┘ │       │  width a picture
│ │ Tonight's build       │ │ 10 Sept, 19:02        │       │  is more useful
│ │ 1h 04m · 2.1 GB       │ │ 22m 10s · 712 MB      │       │  than a wide row
│ │ 1080p60 · YT, Twitch  │ │ 1080p60 · Twitch      │       │
│ │ [ Show in folder ] ⋯  │ │ [ Show in folder ] ⋯  │       │
│ └───────────────────────┘ └───────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

### Layout: mobile (<640)

```
┌────────────────────────────────┐
│  Recordings                    │
│  312 GB free                   │
├────────────────────────────────┤
│ ┌────┐ Tonight's build stream  │  64px thumbnail left,
│ │ ▣  │ 1h 04m · 2.1 GB         │  metadata right, the row
│ └────┘ 11 Sept, 20:14        › │  itself opens a Sheet with
├────────────────────────────────┤  Play / Share / Rename /
│ ┌────┐ 10 Sept 2026, 19:02     │  Delete — no ⋯ menus and
│ │ ▣  │ 22m 10s · 712 MB      › │  no inline buttons at this
│ └────┘ 1080p60 · Twitch        │  width
├────────────────────────────────┤
│ ┌────┐ 9 Sept 2026, 21:30      │
│ │ ⚠  │ 8m 02s · 240 MB       › │
│ └────┘ Recovered. Plays fine.  │
├────────────────────────────────┤
│  ▣     ⇅    ( ▶ )   ⬤    ⚙    │
└────────────────────────────────┘
```

### Row contents and actions

| Field | Format |
|---|---|
| Title | User-set name, else "{date}, {HH:mm}". Editable inline (double-click desktop, Rename in the Sheet on mobile). |
| Duration | "1h 04m" / "22m 10s" / "48s" — summary format (§4.3), never a running-clock format. |
| Size | "2.1 GB" / "712 MB" / "84 KB" — one decimal place above 1 GB, none below, binary-free units (§6). |
| Quality | "1080p60" |
| Destinations | "YouTube, Twitch" — where it went, so a recording can be matched to a stream. "Not streamed" for a recording-only session; "Demo" for an all-mock session. |
| Primary action | Desktop/Electron: **"Show in folder"**. Web: **"Download"**. |
| `⋯` menu | "Play" (opens the OS player / an in-app `<video>` on web), "Rename", "Copy file path" (desktop), "Delete…" |
| Delete | Inline confirm: "Delete {name}? The file is moved to your Trash." (desktop) / "Delete {name}? This cannot be undone." (web, where there is no trash). Never a silent delete, never a permanent delete without saying so. |

### States

| State | What the user sees |
|---|---|
| **Empty** | Heading "No recordings yet". Body: "LIVETAP records every stream to this computer, so you always have your own copy. Your first recording will appear here." Then, when recording is off: an amber inline row "Recording is currently off." with the text link "Turn it on". Primary Button **"Go to Studio"**. |
| **Loading** | Rows appear as the folder is read, newest first, with thumbnails filling in behind a `bg-2` box at the correct ratio. A "Reading your recordings folder…" line sits above the list and disappears on completion. |
| **Error** (folder missing or unreadable) | ErrorCard: WHAT "LIVETAP cannot read your recordings folder." / WHY "The folder was moved, renamed, or is on a drive that is not connected." / DOING "Your files are untouched — LIVETAP just cannot see them from here." / YOU CAN "Pick the folder again, or reconnect the drive." / Primary **"Pick the folder"**. |
| **Error** (a single file is unplayable) | That row shows a `warning` icon and the line "This file did not finish writing. LIVETAP can try to repair it." with a `⋯` entry "Repair" that remuxes in place and reports honestly on failure: "This file could not be repaired. What played before the crash is still there." Never silently list a broken file as healthy (tenet 6). |
| **Recovered file** | The `⚠` icon plus "Recovered after LIVETAP closed unexpectedly. Plays fine." — surfaced proactively, never discovered by the user. |
| **Live / recording in progress** | The in-progress recording is the first row, with a `danger` dot, the live elapsed time, and the label "Recording now". Its actions are limited to "Show in folder"; Rename and Delete are absent until it is finalised. Size updates at most once every 5 seconds — a size that ticks every frame is noise. |
| **Disk nearly full** | A `Banner` above the list: "1.4 GB left — about 12 minutes of recording." with the text link "Change folder". At the `DISK_FULL` threshold the ErrorCard from §4.1 replaces it. |

### Copy

| Element | String |
|---|---|
| Page heading / subhead | "Recordings" / "Every stream is recorded on this computer unless you turn it off." |
| Disk line | "{n} GB free on disk" |
| Primary action | "Show in folder" (desktop) / "Download" (web) |
| In-progress row | "Recording now · {elapsed}" |
| Repair | "This file did not finish writing. LIVETAP can try to repair it." / action "Repair" / failure "This file could not be repaired. What played before the crash is still there." |
| Recovered | "Recovered after LIVETAP closed unexpectedly. Plays fine." |
| Delete confirm (desktop) | "Delete {name}? The file is moved to your Trash." |
| Delete confirm (web) | "Delete {name}? This cannot be undone." |
| Web storage note | "Recordings in the browser are saved to your Downloads when the stream ends. For long streams, use the desktop app." |

### Simple vs Pro differences

| Aspect | Simple | Pro (additions only) |
|---|---|---|
| Row metadata | Title, duration, size, quality, destinations | Adds one 12px line: "{container} · {codec} · {audioKbps} kbps audio · {segments} segments". |
| `⋯` menu | Play, Rename, Copy path, Delete | Adds "Remux to MP4", "Open in diagnostics" (jumps to that session's log lines). |
| Everything else | | Identical. |

### Accessibility notes

- The list is a `<ul>` of `<li>`; each row's accessible name is "{title}, {duration}, {size}, recorded {date}, streamed to {destinations}". Thumbnails are `alt=""` (decorative — the row already says everything).
- Focus order: heading → disk line → each row (row is a link/button to the detail Sheet on mobile; on desktop: primary action → `⋯`) → nothing else. No skip links needed on a list this short.
- Inline rename is a real `TextField` with a label ("Recording name"), `Enter` to commit, `Escape` to cancel, and it announces "Renamed to {name}".
- Delete confirmation is inline and keyboard-first; focus moves to the destructive button but the default focus is "Keep"/"Cancel", never the destructive option.
- The in-progress row's elapsed time is `aria-live="off"`, with the duration available on focus — never announced every 5 seconds.
- `⚠` and `danger` dots always sit beside their sentence; icon-only status never appears in this list.
---

## 6. Copy system

### 6.1 Voice

LIVETAP sounds like a competent friend sitting next to you who has done this before and is not impressed by it. Specifically:

| Rule | Do | Don't |
|---|---|---|
| **Second person, active voice** | "Your camera disconnected." | "A camera disconnection has occurred." |
| **LIVETAP is named when LIVETAP acts** | "LIVETAP is reconnecting automatically." | "Reconnecting…" (who is?) |
| **Say the consequence, not the mechanism** | "Viewers may see brief stutter." | "Frame drops exceed 1% threshold." |
| **One idea per sentence; sentences under 16 words** | "Your disk is almost full. LIVETAP stopped the recording and kept your stream live." | A compound sentence with a semicolon and a caveat. |
| **Never apologise, never blame** | "That key did not work." | "Sorry! Something went wrong 😔" / "You entered an invalid key." |
| **No exclamation marks. No emoji in UI copy.** Moment icons are the sole exception, because they are icons, not punctuation. | "You are live on 3 destinations." | "You're live! 🎉" |
| **No hedging** | "Twitch does not let apps set a thumbnail." | "Thumbnails may not be supported on some platforms." |
| **Numbers where a number is the answer** | "About 12 minutes of recording left." | "Low disk space." |
| **Never promise what the platform will not do** | "You press Go live in Instagram once LIVETAP is sending." | "Going live on Instagram…" |
| **Buttons are verbs the user is performing** | "Paste a new key", "Choose a camera" | "OK", "Submit", "Continue" (except in a wizard, where Continue is the honest label) |
| **Titles are sentences without full stops; body copy has full stops** | Heading "No recordings yet" / body "Your first recording will appear here." | Heading "No recordings yet." |
| **British-neutral spelling, no idioms** | "colour" in prose, `color` in code; avoid "out of the box", "up and running" | |

### 6.2 Banned words and strings

**Never shown in Simple mode, anywhere:**

`RTMP` · `RTMPS` · `SRT` · `WHIP` · `ingest` · `CBR` · `VBR` · `rate control` · `keyframe interval` · `GOP` · `bitrate` · `kbps` · `codec` · `H.264` · `HEVC` · `AV1` · `NVENC` · `QSV` · `AMF` · `VideoToolbox` · `x264` · `encoder preset` · `scene` · `source` · `scene collection` · `profile` (as a production concept) · `layer` · `z-order` · `compositor` · `canvas` · `OAuth` · `token` · `refresh token` · `scope` · `API` · `endpoint` · `webhook` · `RTT` · `latency ms` · `dropped frames` · `skipped frames` · `lagged frames` · `buffer` · `mux` / `remux` · `container` · `stderr` / `log level`

Simple-mode replacements, normative:

| Banned | Simple-mode word |
|---|---|
| bitrate / kbps | "quality" |
| resolution + fps | "quality" (or the concrete "1080p at 60 fps" when stating a fact) |
| codec | (omit; if unavoidable: "video format") |
| encoder | (omit; if unavoidable: "how your computer makes the video") |
| ingest / RTMP server | "stream server" |
| stream key | "stream key" — **allowed**, because it is the platform's own word and the user will read it on the platform's page |
| scene / source | "Moment" / "layer" is Pro-only; in Simple use "layout" |
| dropped / skipped / lagged frames | "frames are being skipped" (one concept, never three) |
| token expired | "you need to sign in again" |
| OAuth | "sign in" |
| latency | "delay" |
| remux / container | "file type" |

**Never shown in either mode:**

- `"RTMP error 104"` and every other bare protocol code (tenet 4).
- `"Encoding overloaded! Consider turning down video settings."` — the exact string the category is known for. LIVETAP's replacement is the `ENCODER_OVERLOADED` card in §4.1.
- `"Failed to connect to server"` — ambiguous across four different causes.
- `"Monitor and Output"`, `"Monitor Only"`, `"Monitor Off"` — replaced by two independent switches, "Hear it myself" and "Include computer sound" (A §5.7).
- `"An error occurred"`, `"Something went wrong"`, `"Unexpected error"` without the four humane fields.
- `"Please"` in any instruction. `"Oops"`. `"Whoops"`. `"Uh oh"`.
- `"Simply"`, `"just"`, `"easy"`, `"obviously"` — a word that tells the user a task is easy is a word that insults them when it is not.
- `"Premium"`, `"Pro plan"`, `"Upgrade"`, `"unlock"` — there is nothing to buy, and the vocabulary of paywalls must not appear in a product without one. ("Pro mode" is a *view*, and its copy says so.)
- `"Beta"` on anything shipping in the MVP. If it is not ready, it is not there.

### 6.3 Number and unit formatting

| Quantity | Format | Examples |
|---|---|---|
| Elapsed (running) | `M:SS`, then `H:MM:SS`, tabular numerals | `0:07`, `42:13`, `1:04:22` |
| Duration (summary) | `{h}h {mm}m` above an hour, `{m}m {ss}s` above a minute, `{s}s` below | `1h 04m`, `22m 10s`, `48s` |
| File size | Decimal units, one decimal above 1 GB, none below | `2.1 GB`, `712 MB`, `84 KB`. Never `GiB`. |
| Disk free | Whole units plus a time estimate | `312 GB free — about 34 hours at your current quality` |
| Bitrate (Pro only) | Thousands separator, space before unit | `5,840 kbps`; in a target pair `5,840 / 6,000 kbps` |
| Bitrate (Simple, in a LIVE chip) | Megabits, one decimal | `5.8 Mbps` |
| Resolution + fps | Compact, no space, no `×` in Simple | `1080p60`. Pro may show `1920×1080 · 60 fps`. |
| Percentages | One decimal below 10%, none above; always with the noun | `0.2% of frames`, `34% CPU` |
| Viewer counts | Thousands separator to 9,999; `12.4K` above | `312 watching`, `12.4K watching` |
| Dates | `11 Sept 2026, 20:14` — day, abbreviated month, full year, 24h clock, locale-formatted at runtime | |
| Relative times | Only under 24 hours: `2 minutes ago`, `4 hours ago`; absolute after that | |
| Counts of destinations | Always with the noun in the plural form the number needs | `Going live on 1 destination` / `on 3 destinations`. In the tight GO LIVE subtitle: `Going live on 3`. |
| Retry attempts | `Attempt 2 of 10` — never `2/10` | |
| Seconds in a countdown | Bare numeral in the control, word elsewhere | `3` in the button; "retrying in 4s" in status text |
| Money | Never. LIVETAP has no prices. | |

### 6.4 The 25 most-used strings

Single source of truth for the strings that appear most often. Anything appearing more than twice in the product must be in this table or it is a drift bug.

| Key | String | Where |
|---|---|---|
| `action.goLive` | "GO LIVE" | Studio |
| `action.goLive.demo` | "GO LIVE (DEMO)" | Studio, all-mock |
| `action.end` | "END" | Studio, live |
| `action.undo` | "UNDO" | Studio, END grace |
| `action.cancel` | "Cancel" | Countdown, sign-in, sheets |
| `action.addDestination` | "+ Add destination" | Destinations, Studio empty chip row |
| `action.connectAccount` | "Connect with account" | Add sheet, Onboarding |
| `action.pasteKey` | "Paste stream key" | Add sheet, Onboarding |
| `action.replaceKey` | "Replace key" | Destination detail |
| `action.retry` | "Try again" | ErrorCards (generic) |
| `action.signInAgain` | "Sign in again" | `AUTH_EXPIRED` |
| `action.chooseCamera` | "Choose a camera" | `CAMERA_LOST`, device picker |
| `action.chooseMic` | "Choose a microphone" | `MIC_LOST`, device picker |
| `action.showInFolder` | "Show in folder" | Recordings (desktop) |
| `action.download` | "Download" | Recordings (web) |
| `state.ready.subtitle` | "Goes live when you tap GO LIVE" | READY chip |
| `state.notConnected.subtitle` | "Sign in to use this destination" | DISCONNECTED chip |
| `badge.notAvailable` | "Not available" | Add sheet |
| `badge.demo` | "Demo" | Everywhere a mock appears |
| `preflight.green` | "Ready to go live" | Studio |
| `preflight.red` | "Not ready to go live" | Studio |
| `goLive.none` | "No destination is ready" | GO LIVE subtitle |
| `goLive.count` | "Going live on {n}" | GO LIVE subtitle |
| `live.count` | "Live on {n}" | END subtitle |
| `mock.banner.one` | "Demo mode — "{label}" is a simulated destination. Nothing is being broadcast to {platform}." | Mock banner |

Two rules about this table: a string's **case is part of the string** (GO LIVE is upper-case; "Ready" is not), and no string in it is ever shortened to fit — if it does not fit, the layout is wrong.

---

## 7. Open questions and decisions deferred

Numbered so they can be cited in review. Each names who can close it and what evidence would close it.

1. **Guest joining.** The Guest Moment currently composes a `browser` layer pointed at a URL, which means a guest is whatever the creator can put on a web page. A real join-by-link guest path (WebRTC ingest into the local compositor) is the single most requested capability in the podcaster and business-creator segments. Deferred until the media-engine ADR (ADR-005) is accepted, because the answer changes the whole audio-routing design. *Closes on: media engine benchmark evidence.*
2. **Chat write fan-out.** Posting one message to several platforms at once is technically available on YouTube, Twitch and Kick, and impossible on Instagram, TikTok and X. Whether the composer should post to all capable platforms by default, or ask each time, is unresolved. Current spec sends to all capable destinations and states which in helper text. *Closes on: a usability test with 5 multi-platform creators.*
3. **Moderation.** Read-only chat is specified. Delete/timeout/ban exist on YouTube, Twitch and Kick and nowhere else. A moderation UI that works on three of six live destinations may be worse than none. Not in the MVP. *Closes on: a decision about whether partial moderation is honest enough.*
4. **The seventh Moment.** Six built-ins are fixed. Whether users may *create* a seventh Moment in the MVP is deferred — the strip's layout, the `1`–`6` hotkeys, and the mobile snap-scroll all assume six. Current answer: no new Moments in the MVP, rename and reset only. *Closes on: product call; cheap to add, hard to undo.*
5. **Where per-destination aspect ratio lives.** A destination has an `aspectRatio` and the production has a `masterAspectRatio`. Sending 9:16 to TikTok and 16:9 to YouTube from one composition is specified as possible but the *editing* story ("which shape am I framing right now?") is only handled by the Moments editor's per-shape placement. Whether Studio's aspect toggle should show a "mixed" state is unresolved. *Closes on: a prototype with two destinations at different ratios.*
6. **Facebook's badge.** Facebook has a complete public API but requires App Review plus Business Verification, which an open-source project may or may not obtain. The spec currently badges it **Paste stream key** and says why. If review is granted, the badge changes to **Connect with account** and this document must be updated in the same commit. *Closes on: Meta App Review outcome.*
7. **Kick chat.** Kick's chat is webhook-only and needs a publicly reachable HTTPS endpoint, which a desktop app does not have. The spec says "chat is read-only in this build", which is currently a polite way of saying "not available". Either a user-hostable relay is specified, or the copy must become "Not available". *Closes on: a decision on optional self-hosted relay (see B §6.1).*
8. **Eligibility pre-checks.** LinkedIn offers a real programmatic eligibility check; YouTube, Instagram and TikTok do not. The `NOT_ELIGIBLE` card interpolates a curated requirement string per platform, which means a curated table that will go stale. Ownership and a review cadence for that table are unassigned. *Closes on: naming an owner and a quarterly review.*
9. **Mobile background capture.** The mobile bottom-nav and live-state specs assume the app is foregrounded. iOS broadcast extensions stop within 30 s–5 min when backgrounded, and Android needs explicit foreground-service types. What the *UI* says when the OS is about to kill a stream is unspecified. *Closes on: device testing; needs an honest pre-stream warning, not a mid-stream failure.*
10. **Thermal messaging.** A thermal-adaptive encoder is the differentiator the research identifies, but the copy for it does not exist yet. It needs one line in the health vocabulary that is neither alarming nor dismissible — something in the shape of "Your phone is hot, so LIVETAP lowered quality to keep you live." *Closes on: thermal ladder definition in the media engine.*
11. **`HealthLevel` word for `unknown`.** The spec shows "Checking" to the user. `unknown` also covers "metrics are stale because the engine died", which "Checking" understates. Either a second user-facing word is added, or the health evaluator must distinguish the two cases. *Closes on: a core change or a copy change; core is preferable.*
12. **Theme is device-local.** Simple/Pro mode and theme are both per-device. If account sync ever exists, both become sync candidates and the "per device, not per account" line in §3.4 changes. Deliberately deferred; LIVETAP has no accounts of its own and should keep it that way as long as possible.

---

*End of PRODUCT_SPEC.md. Tokens and components: `docs/design/DESIGN_SYSTEM.md`. Domain types: `packages/core/src/types/`. Evidence: `docs/research/COMPETITOR_FAILURE_DATABASE_A.md`, `…_B.md`, `docs/research/PLATFORM_*.md`.*
