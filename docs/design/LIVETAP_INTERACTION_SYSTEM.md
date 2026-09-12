# LIVETAP Interaction System — the public experience

**Version** 1.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Companions** `LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_SCROLL_STORY.md` · `LIVETAP_MOTION_SYSTEM.md` ·
`scrollcraft/builds/livetap-public/PLAN.md`

Every interactive element on the public page is specified here as a state machine over real data. The
data comes from `packages/core` and `packages/adapters`; nothing on this page invents a state, a
capability, a placement or a number.

**The honesty contract for the whole document:** the surface is a demo and says so. The chrome carries
a persistent, non-dismissible `info` line — "Demo surface. Nothing is broadcast anywhere." — which is
the same contract as the app's mock banner (PRODUCT_SPEC §4.4). Every state machine below runs on
seeded sample data, and every capability claim is derived from the adapter profiles rather than
written.

---

## 1. The ten states, and who may enter them

The page uses the app's `DestinationState` union verbatim
(`packages/core/src/types/destination.ts`) and the app's `StatusChip` rendering rules
(PRODUCT_SPEC §4.2). No eleventh state exists.

`DISCONNECTED` · `AUTHENTICATING` · `READY` · `STARTING` · `LIVE` · `DEGRADED` · `RECONNECTING` ·
`FAILED` · `STOPPING` · `ENDED`

On the public page, `FAILED`, `STOPPING` and `ENDED` are reachable only from the hero auto-story's
loop reset, never from a visitor action, because a visitor who taps something should not be punished
with a dead end. Chip labels, dot treatments, status sentences and pulse rules are the app's, unchanged:

| State | Label | Dot | Pulses | Status line on this page |
|---|---|---|---|---|
| `DISCONNECTED` | Not connected | hollow ring | no | The tile's own connection method (§2.2) |
| `AUTHENTICATING` | Signing in | solid | no | `Waiting for {platform}…` |
| `READY` | Ready | solid | no | `Goes live when you tap GO LIVE` |
| `STARTING` | Starting | solid | no | `Telling {platform} you're live…` |
| `LIVE` | Live | solid + halo | **yes** | `{height}p · {format} · {mbps} Mbps` |
| `DEGRADED` | Live, rough | solid | no | `Frames are being dropped` |
| `RECONNECTING` | Reconnecting | solid + halo | **yes** | `Attempt 1 of 10, retrying in 4 s` |
| `FAILED` | Failed | 20px `alert` glyph, no dot | no | First clause of the error's WHAT |
| `STOPPING` | Stopping | solid at 55% | no | `Telling {platform} the stream ended…` |
| `ENDED` | Ended | solid | no | `Streamed {duration}` |

Exactly two states pulse. Under `prefers-reduced-motion: reduce` the halo becomes a permanent
full-opacity ring plus a 1px outline, which is the app's own resolution.

---

## 2. DESTINATION PLAYGROUND (ACT 2 CONNECT)

### 2.1 The six destinations, and the honest state each one starts in

Derived from `PLATFORM_PROFILES` in `packages/adapters/src/profiles/`. The badge is derived from
`profile.capabilities.streamKey` through the same three-way mapping the app's onboarding uses
(PRODUCT_SPEC §5b step 2), never written by hand.

| Platform | `capabilities.streamKey` | Badge | `autoStartsOnIngest` | Supported aspects | Preferred | Chat readable |
|---|---|---|---|---|---|---|
| **YouTube** | `NATIVE_API` | **Connect account** (`success`) | `false` | 16:9, 9:16 | 16:9 | yes (`NATIVE_API`, polling) |
| **Twitch** | `NATIVE_API` | **Connect account** (`success`) | `true` | 16:9, 9:16 | 16:9 | yes (`NATIVE_API`, EventSub) |
| **TikTok** | `USER_ASSISTED` | **Paste stream key** (`info`) | `false` | 9:16 | 9:16 | **no** (`UNAVAILABLE`) |
| **Instagram** | `USER_ASSISTED` | **Paste stream key** (`info`) | `false` | 9:16 | 9:16 | **no** (`UNAVAILABLE`) |
| **X** | `USER_ASSISTED` | **Paste stream key** (`info`) | `false` | 16:9 | 16:9 | **no** (`UNAVAILABLE`) |
| **Facebook** | `OAUTH_API` | **Connect account** (`success`) | `true` | 16:9, 9:16 | 16:9 | yes (`OAUTH_API`, polling) |

Facebook is the connect-with-review case and the tile says so in one `metadata` line, because it is
true and because saying it is the thing PRODUCT_REVIEW §8 named as nobody else in the category doing
it: `Needs Facebook app review and business verification before it works for you.`

No platform logos, no platform colours. The platform's name, set as text, is its identity
(VISUAL_DIRECTION §4.4).

### 2.2 The tile

A destination tile is a `<button>` with `aria-pressed` and four regions, and it is the same shape at
every state so nothing reflows when a state changes:

```
┌──────────────────────────────────────────┐
│ [grip]  YouTube                   [⋯]    │   name, status weight
│         Connect account  ·  16:9         │   badge + format label, metadata
│         ● Ready                          │   StatusChip, status weight
│         Goes live when you tap GO LIVE   │   chip status line, metadata, truncates
└──────────────────────────────────────────┘
```

The grip and the `⋯` control exist only while the tile is `LIVE` and ACT 6 is active (§6). At every
other time their 44px slots are reserved but empty, so the tile's box never changes size.

### 2.3 The state machine

```
                    tap / Enter / Space
  DISCONNECTED ───────────────────────────▶ AUTHENTICATING
       ▲                                          │
       │ tap again (unpick)                        │ 900 ms  (connect-account platforms)
       │                                           │ 1400 ms (paste-key platforms, which
       │                                           │          also show the key field first)
       └───────────────────────────◀────────── READY
                                                   │
                                     GO LIVE at zero (§5)
                                                   ▼
                                               STARTING ──▶ LIVE
```

| Transition | Trigger | Duration | What paints |
|---|---|---|---|
| `DISCONNECTED` → `AUTHENTICATING` | tap, `Enter`, `Space` | immediate | Chip flips in one frame. The tile scales 0.98 → 1.00. The path stub appears at the port at `--ltp-signal-idle`. |
| `AUTHENTICATING` → `READY` | timer | 900ms (connect) / 1400ms (key) | The signal path **draws** from the stage's port to the tile's port, `stroke-dashoffset` full → 0 (MOTION_SYSTEM §3). Chip → `Ready`, colour `--lt-state-ready`. |
| `READY` → `DISCONNECTED` | tap again | immediate | Path opacity → 0 over 120ms, then removed. Chip → `Not connected`. Tile back to 0.98. |
| paste-key platforms | tap | — | Before `AUTHENTICATING`, the tile expands in place by one row to show a real `TextField` labelled "Stream key", with the app's own hint text and a demo value prefilled and visibly marked: `demo.livetap.invalid`. The field is real: it accepts input, validates non-empty, and the error text is `aria-describedby`-linked. This is the app's stream-key flow (PRODUCT_SPEC §5d), one row tall. |

### 2.4 The path that gets drawn

One `<path>` per connected destination, in the SIGNAL layer, generated from two points:

- **The port** — a fixed 8px anchor on the stage's edge, one per destination, allocated in the
  destination's own order (never re-sorted, per app tenet 9). Desktop: three on the right edge, three
  on the left. Mobile: six along the stage's lower edge.
- **The tile's port** — an 8px anchor on the tile's leading edge.

The path is a cubic bezier whose control points sit 40% of the way along the axis, perpendicular
offset 24px, so the line reads as a cable with slack rather than a leader line. Stroke 2px,
`stroke-linecap="round"`, colour by state:

| State | Stroke |
|---|---|
| `DISCONNECTED` | Not drawn |
| `AUTHENTICATING` | `--ltp-signal-idle`, 1px, dashed 2/6 |
| `READY` | `--ltp-signal-ready`, 2px, solid |
| `LIVE` | `--ltp-signal-live`, 2px, solid, with a 1.6s carrier travelling along it at 6% opacity |
| `DEGRADED` | `--ltp-signal-strain`, 2px, solid |
| `RECONNECTING` | Not drawn (this is the point) |

### 2.5 Accessibility

| Concern | Resolution |
|---|---|
| Keyboard | Every tile is a `<button>`. `Tab` order is the destinations' own order. `Enter` / `Space` picks and unpicks. The shelf is a `pan` act, so ACT 2 additionally parks its progress at the value where the focused tile's cue is open (`verify.md` requires this of any pinned act carrying a focusable control; the page owns that handler, not the engine). |
| ARIA | Each tile's accessible name is `{platform}, {state label}, {connection method}, demo destination`. The trailing clause is the app's rule for mock controls. |
| Live region | One `aria-live="polite"` region for the act announces `{platform} is ready` on each `READY`. Going live is `assertive` and belongs to §5. |
| Targets | Tile ≥ 168 × 44px at every breakpoint; the `⋯` control and the grip are 44 × 44px; ≥ 8px between adjacent tiles. |
| Reduced motion | No path **draw**: the path appears at full length with an opacity change. No tile scale change. No carrier travel. Every state change is instant and announced. |
| Colour independence | The badge carries its word, the chip carries its word, the dot treatment differs per state, and the format label is text. |

---

## 3. FORMAT PLAYGROUND (ACT 4 ADAPT)

### 3.1 What the visitor operates

The app's aspect-ratio segmented control, three segments — **16:9**, **9:16**, **1:1** — as a real
roving-tabindex group (`role="radiogroup"`, `←` / `→` / `Home` / `End`), each segment ≥ 44 × 44px. This
page fixes the 46 × 32 target that PRODUCT_REVIEW measured as a failure in the app rather than
reproducing it.

The segment sets the **master canvas** shape. What each destination receives is computed, not chosen.

### 3.2 The re-flow uses the product's own maths

The stage re-flows by running the same functions the app runs. Nothing is hand-placed.

- Layer positions come from each `Moment`'s `placement` map in
  `packages/core/src/moments/defaults.ts`, which is already normalized for 16:9, 9:16 and 1:1.
- Text and camera layers are passed through `insetToSafeArea(rect, aspect)` from
  `packages/core/src/production/intents.ts`.
- `SAFE_AREAS` is used verbatim:

| Aspect | top | bottom | left | right |
|---|---|---|---|---|
| `16:9` | 0.05 | 0.06 | 0.05 | 0.05 |
| `9:16` | 0.12 | **0.28** | 0.05 | **0.16** |
| `1:1` | 0.06 | 0.12 | 0.06 | 0.06 |

The 9:16 insets are the visible payoff of the act: the bottom 28% and the right 16% are where a
vertical platform puts chat and its action buttons, so when the visitor taps 9:16 the title layer
visibly climbs out of the bottom band and the camera inset moves left. `data-sc-reveal="iris"` wipes
the safe-area guides in once, at `data-sc-reveal-at="0.18 0.62"`, and that is the page's only `iris`.

Worked example, `main-camera` at 16:9 → 9:16: the camera layer is `{x:0, y:0, w:1, h:1}` with
`fit: 'cover'`, so the frame re-crops rather than letterboxing; the guides show what would be lost;
the stage's own aspect box animates its `aspect-ratio` while its **scale stays 1.0** and its centre
stays fixed (VISUAL_DIRECTION §2, the stage is the only layer allowed a scale change and this is not
one of the two cases where it uses it).

### 3.3 Per-destination format labels, and the honest 1:1

Each tile's `metadata` line shows what that destination receives, from
`chooseAspectForDestination(intent, dest)`. With the default `talking` intent, whose
`aspectPreference` is `['16:9','9:16','1:1']`:

| Master canvas | YouTube | Twitch | TikTok | Instagram | X | Facebook | Formats the engine produces |
|---|---|---|---|---|---|---|---|
| **16:9** | 16:9 | 16:9 | 9:16 | 9:16 | 16:9 | 16:9 | 16:9 and 9:16 |
| **9:16** | 16:9 | 16:9 | 9:16 | 9:16 | 16:9 | 16:9 | 16:9 and 9:16 |
| **1:1** | 16:9 | 16:9 | 9:16 | 9:16 | 16:9 | 16:9 | 16:9 and 9:16 |

**None of the six platforms lists `1:1` in `supportedAspectRatios`.** That is a real finding from the
profiles, not a gap in the demo, and the page states it rather than faking a square Instagram feed. On
`1:1` the surface's state line reads: `Square is the canvas you compose in. No destination here asks
for it, so LIVETAP sends each one the shape it accepts.` That sentence is the most honest thing on the
page and it demonstrates the product's actual intelligence better than a lie would.

Selecting an intent in ACT 8 re-runs the table: picking **Vertical Live**, whose preference is
`['9:16','1:1','16:9']`, flips YouTube, Twitch and Facebook to 9:16 and leaves X on 16:9, because X
supports nothing else.

### 3.4 State machine

```
  format ∈ {16:9, 9:16, 1:1},  default 16:9
  ─────────────────────────────────────────────
  tap / arrow ─▶ set format
                 ├─ stage aspect-ratio animates (320 ms, --lt-ease-standard)
                 ├─ each visible layer re-placed through insetToSafeArea()
                 ├─ each tile's format label updated (no layout change)
                 ├─ the formats readout in the status bar updated
                 └─ announce: "Composing in {format}. {n} destinations, {m} formats."
```

Nothing else on the page changes. The destination states, the Moment, the chat and the clock are
untouched, because changing the canvas shape does not change what is connected.

### 3.5 Accessibility

`role="radiogroup"` with `aria-label="Canvas shape"`; each segment `role="radio"` with `aria-checked`;
roving tabindex; `Home` / `End` supported. The guides are `aria-hidden`, and the information they
carry is also in text: `9:16 keeps the bottom 28% and the right 16% clear for chat`. Under reduced
motion the aspect change is instant, the guides appear by opacity, and the `iris` wipe does not run.
Targets are 44px at every breakpoint, including desktop, because a segmented control is a place people
mis-tap.

---

## 4. MOMENT PLAYGROUND (ACT 3 PRODUCE)

### 4.1 The six Moments, real

From `defaultMoments()`. Names, icons and layer sets are the product's; the page renders
`<MomentIcon>`, never the emoji key.

| id | Name | Layers |
|---|---|---|
| `starting-soon` | Starting Soon | colour bg, text "Starting soon" at `{x:0.1, y:0.38, w:0.8, h:0.24}`, camera hidden |
| `main-camera` | Main Camera | camera, full frame |
| `screen-share` | Screen Share | colour bg, screen `contain` full frame, camera inset `{x:0.74, y:0.70, w:0.22, h:0.26}` radius 20 |
| `guest` | Guest | colour bg, camera `{x:0.02, y:0.15, w:0.47, h:0.70}`, guest `{x:0.51, y:0.15, w:0.47, h:0.70}`, both radius 20 |
| `break` | Break | colour bg, text "Back in a moment" |
| `ending` | Ending | colour bg, text "Thanks for watching" |

Intent renames are applied, so after ACT 8 the strip can honestly read **Gameplay** (gaming),
**Slides** (presentation) or **Conversation** (podcast), from `renameForIntent()`.

### 4.2 The strip is the app's component

`MomentCard`, unchanged: `<button aria-pressed>`, ≥ 140 × 104px, icon plus name plus one `meta` line.
Desktop 6-up at 168 × 104 with no scroll; mobile a horizontal scroll-snap row with 2.2 cards visible at
140 × 104. The active card's `meta` reads `Live now` once the surface is `LIVE`; before that it reads
the number key, `1` to `6`, which is the app's real shortcut.

### 4.3 State machine

```
  activeMoment ∈ the six ids,  default main-camera
  ────────────────────────────────────────────────
  tap / Enter / Space / keys 1-6 ─▶ set activeMoment
        ├─ outgoing layers: opacity → 0 over the Moment's own transition.durationMs
        │                   (fade 300-600 ms, slide 350 ms) using the Moment's own
        │                   transition.kind from defaultMoments()
        ├─ incoming layers: placed for the current format, opacity → 1
        ├─ audio state adopted: micMuted from the Moment (Starting Soon and Break mute)
        ├─ the mic Meter reflects it: a muted Moment shows the muted state, not a fake level
        └─ announce: "Moment: {name}."
```

The **stage frame never moves** during a Moment change. Only its contents cross over. That is the
difference between a Moment and a page transition, and it is what makes "six Moments, not a scene
tree" legible in one tap.

### 4.4 The three sources, switching on in sequence

ACT 3's other half. Three controls in the production column, each the app's real control:

| Step | Control | `data-sc-in` delay | What paints |
|---|---|---|---|
| 1 | Camera | 0ms | The `camera` glyph fills, the stage's picture area goes from the hero plate to the composed camera layer, the source label reads the device name from the demo data |
| 2 | Microphone | 70ms | The `Meter` starts showing a seeded level, `role="meter"` with real `aria-valuenow`; peak-hold marker appears |
| 3 | Screen | 140ms | The `screen` glyph fills, and the `Screen Share` Moment becomes selectable. Before this step it is present but `disabled`, with the reason in `metadata`, because a Moment that needs a source it does not have should say so |

`data-sc-stagger="70"` on the parent, which is the middle of the 30-to-80ms band. Each row is
`data-sc-in`, so it fires once on entry and never re-hides.

### 4.5 Accessibility

`aria-pressed` on every card; `1`–`6` shortcuts active only when focus is not in a text field, exactly
as the app scopes them; `M` toggles the mic, same scoping. The strip is a horizontal scroll region on
mobile with `scroll-snap-type: x mandatory` and real overflow, so every card is reachable without
motion. The `Meter` is never the only indication that audio exists: the mic row also carries the word
`On` or `Muted`. Under reduced motion the layer crossover is an instant swap, the stagger is skipped,
and every card is present at full opacity from entry.

---

## 5. GO LIVE, and MULTISTREAM (ACT 5)

### 5.1 The button is the app's

`GoLiveButton`, unchanged, including its five states, its in-place countdown, its `Escape` handling and
its `aria-label` sentences. Because every destination here is a demo, the label is
**`GO LIVE (DEMO)`** and the fill is `--lt-info` rather than `--lt-accent-live-solid`, which is the
app's own rule for an all-mock stream (PRODUCT_SPEC §4.3). A demo stream must never be able to look
like a real one at any glance distance.

### 5.2 State machine

```
  idle ──tap/Enter/Space──▶ countdown(3) ──at zero──▶ starting ──▶ live
   ▲                            │
   │                            │ tap again, Escape, or the Cancel region
   └────────────────────────────┘
```

| Phase | Duration | What paints | Announced |
|---|---|---|---|
| `idle` | — | Label `GO LIVE (DEMO)`, subtitle `Going live on {n}` computed from the visitor's own `READY` count. With zero ready: `aria-disabled`, subtitle `No destination is ready`, plus one text link that scrolls to ACT 2. Never a dead button. | — |
| `countdown` | 3 s, 1000ms per numeral | The numeral in `display` type, tabular, 3 → 2 → 1, with `Cancel` right-aligned in a 44px region. Nothing is sent anywhere. | `Going live in 3 seconds. Press Escape to cancel.` (assertive) |
| cancel | 200ms | Back to `idle`. No destination changed state. | `Cancelled. You are not live.` |
| `starting` | 600ms | Every `READY` → `STARTING`. Chips animate in place; the row does not re-sort. | `Going live on {n} destinations.` |
| `live` | — | Every path lights `--ltp-signal-live` **together**, in one frame, not staggered: a coordinated broadcast is the claim, so the paths must not arrive one by one. Every chip becomes the solid `LIVE` fill. The elapsed clock starts at `0:00` when the first destination reports `LIVE`. Chat begins (§7). | `You are live on {names}.` |

### 5.3 The real numbers, and the one counter

`count` is ACT 5's primary device and it is used exactly twice, on two values that are computed:

| Value | Source | Why it is not invented |
|---|---|---|
| Destination count | `destinations.filter(d => d.state === 'READY').length` | The visitor produced it by tapping in ACT 2. |
| Formats produced | `AutomaticProduction.formats.length` | Computed by `buildAutomaticProduction()` from the visitor's own picks. |

The elapsed clock is a real clock of the demo session, in tabular figures, `mm:ss` under an hour. No
bitrate, viewer count, fps or dropped-frame percentage is counted up, because those would be invented
statistics; where they appear at all they appear as a seeded, clearly-demo value in a `metadata` line
and never in a counter.

### 5.4 Accessibility

The button holds initial focus in ACT 5. `Escape` cancels from anywhere on the page. The countdown does
not steal focus. Going live and any failure use `aria-live="assertive"`; everything else is `polite`.
The timer is `aria-live="off"` and focusable with `aria-label="Live for {n} minutes"`, because a clock
that announces every second is unusable. Under reduced motion the countdown is a digit swap with no
scale or cross-fade, and the paths light in one frame with no carrier.

---

## 6. FAILURE AND RECOVERY (the hero story, and the peak)

The same state machine is driven from two places: the hero's automatic story, and the visitor's own
drag. They must not be two implementations.

### 6.1 The machine

```
  LIVE ──break──▶ DEGRADED ──700 ms──▶ RECONNECTING(t=4 s) ──t=0──▶ LIVE
                     │                        │
                     │                        └─ path absent, ring counting, attempt 1 of 10
                     └─ path at --ltp-signal-strain, chip "Live, rough"
```

| Trigger | Path |
|---|---|
| Automatic (hero story, step 14) | `break` fires on a timer, on a destination chosen by the seeded RNG from the connected set |
| Visitor drag (ACT 6, the peak) | `break` fires when the drag crosses the threshold (SCROLL_STORY §7) |
| Visitor keyboard | `Delete` / `Backspace` on a focused `LIVE` tile, or the tile's `⋯` menu item `Drop from stage`, or seven arrow nudges |
| Reduced motion | Same triggers, `DEGRADED` skipped, no positional animation (SCROLL_STORY §7.6) |

### 6.2 Siblings are untouched, as an assertion

Across the whole break-to-heal sequence, for every destination other than the broken one:

- `transform` and `opacity` unchanged;
- chip state, label and status line unchanged;
- path geometry, stroke width and colour unchanged;
- pulse phase uninterrupted — the halo animations are not restarted, so the siblings' pulses stay out
  of phase with each other exactly as they were;
- the elapsed clock keeps counting;
- no re-layout, no re-sort, no reflow of the destination row.

This is the one claim the peak exists to make, so `PLAN.md` §6 carries it as a test that samples every
sibling's computed style before, during and after.

### 6.3 What the visitor is told

An `ErrorCard` opens **in place, beside the broken tile**, not at the top of the page. It renders the
app's four fields with exactly one primary action, and it is the app's component:

| Field | Copy |
|---|---|
| WHAT | `YouTube stopped accepting video.` |
| WHY | `The connection to YouTube dropped. Your other destinations are not affected.` |
| DOING | `LIVETAP is reconnecting on its own. Attempt 1 of 10.` |
| YOU CAN | `Wait for it, or stop this destination and keep the others live.` |
| Action | One button: `Stop this destination`. Pressing it is honest: the tile goes to `ENDED`, and the rest stay `LIVE`. |

The card's placement is deliberate: PRODUCT_REVIEW recorded the app rendering its camera-lost card 288px
below the fold while the health pill said "excellent". On this page the card is a sibling of the tile
and cannot leave the viewport, because a notice nobody sees is worse than no notice.

The error code is never displayed. Technical detail lives behind the Pro layer's `<details>`
disclosure, which is the app's rule.

### 6.4 Accessibility

The break and the heal are `aria-live="assertive"`. The countdown announces once, on its first tick,
`polite`, and then stays silent — a per-second announcement would be unusable. The `ErrorCard`'s WHAT is
`role="alert"`. Focus does not move on the break; it stays where the visitor put it, and the card is the
next tab stop after the tile. Every trigger has a keyboard and a touch equivalent (SCROLL_STORY §7.4,
§7.5). Reduced motion changes no information, only movement.

---

## 7. CHAT (from ACT 5 onward)

### 7.1 The corpus is real sample data, and it is labelled

Messages are drawn from `packages/adapters/src/mock/corpus.ts`: 30 invented display names, about 60
messages, and a badge pool weighted so most authors carry no badge and a few carry `subscriber`,
`member`, `moderator` or `verified`. Nothing references a real person or account, and every message the
mock adapter emits carries `mock: true`, which this page renders as a `Demo` `Badge` on the author row.
Mock chat never renders without it.

### 7.2 The platform badges are honest, and three platforms are absent

Chat is only shown for platforms whose `capabilities.chatRead` is an automated class:

| Platform | `chatRead` | In the chat panel |
|---|---|---|
| YouTube | `NATIVE_API` | yes |
| Twitch | `NATIVE_API` | yes |
| Facebook | `OAUTH_API` | yes |
| TikTok | `UNAVAILABLE` | **no** |
| Instagram | `UNAVAILABLE` | **no** |
| X | `UNAVAILABLE` | **no** |

The panel's footer states it, once, in `metadata`: `TikTok, Instagram and X publish no live chat API,
so nothing from them appears here.` This is the platform honesty PRODUCT_REVIEW §8 identified as the
thing nobody else in the category does, and it costs one line.

Each message row is: author name (`status`), platform name as a text badge, `Demo` badge, then the
message (`body`). No platform logo, no platform colour.

### 7.3 State machine and rate limits

```
  chat = { paused: bool, messages: Message[] }
  ─────────────────────────────────────────────
  surface becomes LIVE ─▶ paused = false, seed 4 messages immediately
  tick (seeded RNG)    ─▶ if !paused and messages.length < 40: push one
                          interval 1400 ms to 3200 ms, jittered per platform
  IntersectionObserver ─▶ paused = true when the panel is off-screen
  document hidden      ─▶ paused = true
  user scrolls the log ─▶ autoScroll = false until they return to the bottom
```

| Limit | Value | Why |
|---|---|---|
| Arrival interval | 1400–3200ms, seeded, deterministic per page load | A chat that arrives faster than it can be read is noise, and a deterministic sequence is testable |
| Maximum rows in the DOM | 40, oldest removed | Unbounded growth is a memory leak on a page a visitor may leave open |
| Paused off-screen | Yes, via `IntersectionObserver` and `visibilitychange` | Nothing animates or allocates while nobody is looking |
| Auto-scroll | Never while the visitor has scrolled up | The app's own rule, and one of DESIGN_SYSTEM §5's explicit prohibitions |
| Reduced motion | Rows appear with no slide and no fade stagger; arrival interval raised to a flat 2600ms | Fewer and gentler, not zero |

### 7.4 Accessibility

The log is `role="log"` with `aria-live="polite"` and `aria-relevant="additions"`, so a screen reader
hears new messages without being flooded by the whole list. It is keyboard-scrollable and has a real
focusable container. The `Demo` badge is part of each row's accessible text, not a colour. Message rows
are not interactive, so they are not tab stops.

---

## 8. PRO MODE REVEAL (ACT 7 POWER)

### 8.1 What appears, and where

One `Toggle` — the app's component, a `<button aria-pressed>`, not a checkbox — labelled `Pro`. Turning
it on adds a layer **behind** the surface, in the PARALLAX plane, arriving at `data-sc-in` with a 60ms
stagger:

| Panel | Content | Source of truth |
|---|---|---|
| Encoder | The derived encoder and rate control, read-only on this page | `ProductionSettings`, and it is derived, never asked |
| Per-format bitrate | One row per format the production actually produces, with each destination's `recommended.maxVideoKbps` ceiling | `PLATFORM_PROFILES[...].recommended` |
| Audio routing | Mic, system audio and their gains from the active Moment's `AudioState` | `DEFAULT_AUDIO` merged with the Moment and the intent |
| Diagnostics | The last six state transitions of this demo session, timestamped, in mono | The page's own event log, which is real |

### 8.2 The rule that makes it respect, not clutter

**Nothing the visitor has already learned moves.** Pro is additive and positional: the stage stays at
the same size in the same place, the destination row keeps its positions, the Moment strip keeps its
positions, the chrome does not change. The Pro panels appear in space that was empty.

**The public page does not switch `data-density` to `pro`.** In the app, Pro density is a size and
spacing change the user opts into, and it is correct there. On this page it would shrink every control
the visitor spent seven acts learning, at the exact moment the page is claiming that depth costs
nothing. So the reveal adds Pro **content** at Simple **density**, and that is a deliberate divergence,
recorded here so nobody reads it as an oversight.

### 8.3 State machine

```
  pro ∈ {off, on},  default off
  ───────────────────────────────
  toggle ─▶ pro = !pro
      on  ├─ panels mount behind the surface, parallax rate -0.6
          ├─ opacity 0 → 1 over 200 ms, 60 ms stagger, four rows
          ├─ the technical <details> disclosure becomes available on the ErrorCard
          └─ announce: "Pro shown. Four panels added. Nothing moved."
      off ├─ panels unmount after a 200 ms opacity fade
          └─ announce: "Pro hidden."
```

### 8.4 Accessibility

`aria-pressed` on the toggle; the panels are in the DOM only while `pro` is on, so nothing focusable is
ever parked at opacity 0; the panels come **after** the surface in reading order, matching their
visual position behind it; `<details>` disclosures are native. Under reduced motion the panels appear
instantly with no parallax and no stagger.

---

## 9. THE HERO AUTO-STORY

Seventeen steps on their own clock, not on scroll. It runs in the fixed surface from first paint,
underneath the chaos lattice at first, and it is the reason the 15-second test can pass without the
visitor doing anything.

### 9.1 The 17 steps

| # | At | Step | What paints |
|---|---|---|---|
| 1 | 0.0 s | Canvas | The stage exists, 16:9, holding the hero plate, `Main Camera` selected |
| 2 | 0.9 s | Camera on | The picture area becomes the composed camera layer |
| 3 | 1.6 s | Mic on | The `Meter` starts showing a seeded level, peak-hold appears |
| 4 | 2.3 s | Screen available | The `screen` control fills; `Screen Share` stops being disabled |
| 5 | 3.0 s | YouTube `READY` | Path draws to port 1, chip `Ready`, format label `16:9` |
| 6 | 3.7 s | Twitch `READY` | Path draws to port 2, chip `Ready`, `16:9` |
| 7 | 4.4 s | TikTok `READY` | Path draws to port 3, chip `Ready`, **`9:16`** — the first visible hint that formats differ per destination |
| 8 | 5.4 s | Layout adapts | The status bar's formats readout changes from `1 format` to `2 formats`. The stage does not change shape; the *production* gained a second encode, which is the true statement |
| 9 | 6.2 s | GO LIVE arms | The button takes `--lt-shadow-live`, subtitle `Going live on 3` |
| 10 | 7.0 s | Countdown | `3`, `2`, `1` in `display` type, tabular |
| 11 | 10.0 s | `LIVE` | All three paths light in the same frame, all three chips take the solid fill, the clock starts |
| 12 | 10.6 s | Indicators | Health word `Excellent`, per-destination `metadata` values, the live dot in the chrome begins its 1600ms pulse |
| 13 | 11.4 s | Chat | Four seeded messages land, then the normal arrival interval begins |
| 14 | 14.0 s | One degrades | The seeded RNG picks a destination; its path goes `--ltp-signal-strain`, its chip `Live, rough` |
| 15 | 14.7 s | Others hold | Nothing else changes. This beat is 2.3 s long and its content is the **absence** of change on the other two |
| 16 | 17.0 s | Reconnecting | The path disappears, the ring counts 4 → 1, the chip reads `Attempt 1 of 10, retrying in 4 s` |
| 17 | 21.0 s | All healthy | The path redraws, the chip returns to `LIVE`, the health word returns to `Excellent` |

Total 22.4 s including the final settle. **Mobile runs 9 steps in 11.5 s**: 1, 2, 3, 5, 6, 11, 13, 14,
17, with two destinations instead of three.

### 9.2 Loop and idle

| Rule | Behaviour |
|---|---|
| Loop | After step 17 the story holds its resolved state for **6 s**, then resets to step 5 — not to step 1. Re-running the camera and mic switch-on would make the surface look like it keeps rebooting. |
| Reset | The reset is a cross-fade of chips and paths over 320ms, never a flash to empty. |
| Off-screen | Paused by `IntersectionObserver` and by `visibilitychange`. It resumes from where it paused, not from the start. |
| Idle | If the visitor has not scrolled and not interacted for 45 s, the story stops looping and holds its resolved `LIVE` state. A surface that keeps performing to nobody is a screensaver. |
| Reduced motion | The story runs, but as **state changes only**: no path draw, no scale, no pulse, no countdown animation. Step timings are unchanged, because the information is in the sequence. |

### 9.3 What happens when the visitor interrupts

This is the rule that decides whether the page feels like a tool or a video, so it is absolute:

**Any visitor action cancels the story immediately and permanently, and the surface keeps whatever
state the action produced.**

| Interruption | Result |
|---|---|
| A tap on any destination tile, Moment card, format segment, GO LIVE, or the Pro toggle | The story's timeline is paused and **not** resumed. The surface is now the visitor's. The story's own pending steps are discarded, not queued. |
| Scrolling past the end of ACT 1 | The story continues, because scrolling is not yet operating. |
| Scrolling into ACT 2 | The story is paused at its current step and the surface is handed over: whatever is `READY` stays `READY`, whatever is `LIVE` stays `LIVE`. The visitor never has to undo the story's choices. |
| Focusing any control with the keyboard | Same as a tap: paused, not resumed. |
| Reaching ACT 6 without having interacted | The surface is live with three destinations, from the story, and the peak is available immediately. The visitor is never blocked from the peak by not having played along. |

There is no "resume the demo" control, and no re-play button. The story exists to make the first
fifteen seconds true; after that the visitor is operating the thing.

---

## 10. THE INTERACTIVE TOUR

Optional, and the visitor operates it. It is **not** a slideshow and it does not scroll the page for
them.

### 10.1 What it is

One entry point in the chrome, at the bottom of the rail on desktop and in the status bar's overflow on
mobile: `See how LIVETAP works`. Activating it opens a stepper **inside the surface**, a single 320px
panel in the DATA layer with seven steps, and each step asks the visitor to do the thing:

| Step | Prompt | Completes when | Target |
|---|---|---|---|
| 1 | `Pick two destinations.` | Two tiles reach `READY` | ACT 2 |
| 2 | `Switch what viewers see.` | Any Moment other than the current one is selected | ACT 3 |
| 3 | `Change the shape.` | Any format other than the current one is selected | ACT 4 |
| 4 | `Go live.` | The countdown completes | ACT 5 |
| 5 | `Break it. Drag a live destination off the stage.` | A break fires from any of the three input paths | ACT 6 |
| 6 | `Look underneath.` | Pro is toggled on | ACT 7 |
| 7 | `Tell LIVETAP what you are making.` | An intent card is picked | ACT 8 |

### 10.2 Rules

- **It never advances by itself.** No timer, no auto-advance, no "next" that does the step for the
  visitor.
- **It never scrolls the page.** Each step carries one text link, `Take me there`, which is a real
  anchor to the act. The visitor chooses to follow it.
- **It never blocks.** The surface is fully operable with the tour open, and the tour is dismissible at
  any step with a 44px `x` and with `Escape`. Dismissing it is remembered for the session only.
- **It has no progress counter.** Completed steps are struck through with a `check` glyph; there is no
  `3 / 7`.
- **Steps complete out of order.** A visitor who goes live before switching a Moment completes step 4
  and step 2 stays open. The tour describes the product, not a funnel.
- Under reduced motion the panel appears with no slide; step completion is an instant strike-through.

### 10.3 Accessibility

`role="region"` with `aria-label="Guided tour"`, `role="list"` of steps, each step's completion
announced `polite` as `Done: {prompt}`. Focus is **not** trapped, because the tour is not a dialog and
the visitor has to be able to reach the surface. `Escape` closes it and returns focus to the entry
point. Every target is also reachable without the tour.

---

## 11. THE 15-SECOND TEST

Six facts, mostly visual. The directive names the test without enumerating the facts, so they are
derived here from its own north star, `CONNECT → PRODUCE → ADAPT → MULTISTREAM → GO LIVE → RECOVER →
CONTROL`, compressed to six, and each one is mapped to the single on-screen element that carries it.

| # | The fact | The element that communicates it | Visible by |
|---|---|---|---|
| 1 | **One live production goes to several platforms at the same time.** | The stage with three lit signal paths running to three tiles, all three chips showing the solid `LIVE` fill. | 11.0 s of the auto-story, without scrolling |
| 2 | **You operate it with one button.** | `GO LIVE (DEMO)`, the only solid-filled control on screen, in the surface's toolbar, with the subtitle `Going live on 3`. | 6.2 s |
| 3 | **One production, several shapes, worked out for you.** | The per-destination format labels reading `16:9`, `16:9`, `9:16` on the three tiles, plus the status bar's `2 formats`. | 5.4 s |
| 4 | **What viewers see is a Moment you tap, not a scene tree.** | The six-card Moment strip under the stage, with the active card's `meta` reading `Live now`. | First paint, and it is in the landing view |
| 5 | **One platform failing does not stop the others.** | Step 14 to 17 of the auto-story: one path strained, then absent with a counting ring, while the other two never change. | 14.0 s to 21.0 s |
| 6 | **It is free, open source, and runs on your machine.** | The status bar's persistent line, `Free. Open source. Runs on your machine.`, beside the `GitHub` item in the chrome. | First paint |

Facts 1, 2, 3, 4 and 6 are on screen inside the first eleven seconds; fact 5 lands at fourteen. A
visitor who scrolls instead of waiting gets facts 1 to 4 from ACT 2 and ACT 3 faster than the story
delivers them, and fact 5 becomes something they cause rather than watch.

**Only fact 6 is carried by words**, and it is six words. The other five are carried by state on a
surface, which is what "mostly visual" has to mean on a page whose subject is software.

---

## 12. ACCESSIBILITY: THE FLOOR FOR EVERY DEMO

The app's ten-item accessibility floor (DESIGN_SYSTEM §10.1) applies unchanged. These are the additions
that only a page like this needs.

| # | Rule |
|---|---|
| 1 | **Every demo has a keyboard path to every state it can reach.** Not a button that says "simulate failure": the same action, on the same element, from the keyboard. |
| 2 | **One live region per concern, not one per element.** Four regions on the page: destination states (`polite`), broadcast state (`assertive`), chat (`role="log"`, `polite`, `additions`), tour progress (`polite`). A page with ten live regions announces nothing. |
| 3 | **Nothing focusable is ever parked at opacity 0.** Content that has not cued in yet is not in the DOM, or is `inert`. A focusable element inside a faded cue is a trap even though cues set `pointer-events: none`. |
| 4 | **A pinned act carrying a focusable control parks its own progress.** The engine centres a focused element on `focusin` but cannot fix a pinned act, because centring it scrolls backwards to progress 0 where the cue is dark. ACT 2, ACT 3, ACT 5, ACT 6 and ACT 8 each carry a handler that sets scroll to the progress where the focused control's own cue is open, through `dwell()` where the act has one. |
| 5 | **44 × 44px on every interactive element at every breakpoint**, desktop included for the format segments, the drag grip, the `⋯` controls and the tour's dismiss. |
| 6 | **Reduced motion means instant state changes with no positional animation.** No path draw, no tile movement, no scale, no parallax, no stagger, no pulse, no countdown ring animation, no chaos convergence. Every state, every number, every word and every announcement is identical to the full-motion page. Nothing is removed except movement. |
| 7 | **Focus is never moved by the page**, except on `Escape` from the tour, which returns it to the entry point. A demo that grabs focus while the visitor is reading is a demo that fights them. |
| 8 | **Every state change a sighted visitor notices passively is announced**, and the announcement says what changed rather than what it looks like. |
| 9 | **Forced colors survive**: focus uses `outline`, and where a colour is the semantics (the `LIVE` chip, the GO LIVE fill) the component pairs `forced-color-adjust: none` with a border so the shape survives. This is the app's existing resolution. |
| 10 | **The page is fully comprehensible with JavaScript disabled**: the surface renders its first-paint state from server-rendered markup, the acts are real sections with real headings and real reading order, and the six facts of §11 are all present as text in the DOM. It is not operable without JS, and it does not pretend to be. |
