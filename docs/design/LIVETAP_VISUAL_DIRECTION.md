# LIVETAP Visual Direction — the public experience

**Version** 1.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Companions** `LIVETAP_SCROLL_STORY.md` (the score) · `LIVETAP_INTERACTION_SYSTEM.md` (the demos) ·
`LIVETAP_MOTION_SYSTEM.md` (durations and the Anime.js contract) ·
`scrollcraft/builds/livetap-public/PLAN.md` (the build)

This document decides what the public experience looks like. It does not decide what it does; that is
the Interaction System. Everything here is derived from three sources and nothing else:

1. `docs/design/DESIGN_SYSTEM.md` and `packages/ui/src/tokens.css` — the app's existing language. The
   public experience adds **no new colour, no new size, no new radius, no new duration**. It adds one
   typeface and one page-local layer scale, both defined in §4 and §3.
2. The owner's directive of 2026-09-12 (`docs/prompt-pack/10_LIVETAP_UX_EXPERIENCE_REDESIGN.md`) and
   the self-authored brief at `scrollcraft/builds/livetap-public/BRIEF.md`.
3. The Scroll Craft **Live surface** grammar, whose bans are treated here as hard rules.

---

## 0. The four rules that outrank everything else on this page

The app's four rules (DESIGN_SYSTEM §0) hold verbatim. These four are additional, and specific to a
page whose job is to be operated rather than read.

1. **The product is the picture.** No photography, no stock imagery, no device mockups, no generated
   scenery, no illustration of a person. The only pictorial elements on the page are the LIVETAP mark
   and one hero plate. Atmosphere is drawn, not photographed.
2. **Nothing on the page pretends.** Every panel is real markup computing its state from data arrays
   in the page, and the page says on its face that the scenario is a demo. A painted surface, a
   screenshot of a dashboard, or a div dressed as another company's product is forbidden outright.
3. **Copy lives in the surface's own idiom.** Labels, status lines, values, empty states, tooltips,
   field hints. There is no headline in display type making a claim. If a sentence could appear on a
   competitor's marketing page, it does not belong here.
4. **Colour is never the only carrier of state, and the page still reads with most colour removed.**
   Every coloured state also carries a word and a dot shape, exactly as `StatusChip` does in the app.

---

## 1. The world

### 1.1 What the world is

A **cinematic live control environment**: one production stage, lit, with its instruments around it,
in a room whose light comes from the stage itself. The reference set, from the brief: a broadcast
truck's program monitor wall at night; a mission-control console where every light means one thing;
the calm of a well-run live show's talkback.

The world is a **signal field**, not a place. It has no floor, no horizon, no architecture and no
sky, because a place implies travel and this page does not travel — it operates. What gives the frame
depth is the falloff of light and contrast away from the stage, and the fact that things in front of
the stage are sharper and larger than things behind it.

### 1.2 Explicitly not

| Not this | Why |
|---|---|
| Gaming PC, RGB, neon, chromatic glow | The brief forbids it by name. Colour here means a state, and a glow means nothing. |
| Purple or violet-to-blue AI gradients | The category default that signals "nobody chose". Banned by the brief and by Scroll Craft's taste floor. |
| Apple-style product flythrough | There is no object to fly around. A camera move would be a film, and a film cannot be operated. |
| A SaaS template: hero claim, three feature cards, logo wall, pricing | The exact verdict the redesign exists to answer. |
| Cream-and-brass premium-artisan palette | Wrong category and a known default. |
| Glass and blur as decoration | Blur here is a depth cue on one layer only (§2, ATMOSPHERE). Anywhere else it is noise. |
| Platform brand colours or platform logos | Platform identity is carried by the platform's **name, set as text**. See §4.4. |
| Emoji as icons | The app's closed 24-glyph set is the icon system (§5). |

### 1.3 Atmosphere: how the signal field is drawn

One `<canvas>`, one layer, restrained to the point of near-invisibility. Its job is to stop a flat
dark ground from banding on real displays and to make the room feel lit by something.

| Property | Value |
|---|---|
| Element | A single `<canvas>` at layer ATMOSPHERE, `aria-hidden="true"` |
| Content | Two things only: (a) a slow horizontal **scan drift** — 9 bands of `--lt-text-primary` at 2.5% opacity, 1px tall, drifting upward at 4px/s with per-band phase; (b) a **carrier trail** — 24 points of `--lt-accent-focus` at 3% opacity travelling along the stage-to-destination axes at 12px/s, sparse enough that no two are ever within 80px |
| Colour budget | Nothing above 5% opacity. No hue that is not already a token. |
| Frame rate | Capped at 30 fps, and paused entirely when the stage is off-screen or the document is hidden |
| Mobile | The canvas is **not created** below 640px. A static CSS radial falloff replaces it. |
| Reduced motion | The canvas is not created. The same static falloff replaces it. |
| Fallback | If `canvas` context creation fails, the static falloff is used. The page never shows an empty box. |

The canvas never carries information. Removing it entirely must cost the page nothing but texture,
and that is the test of whether it has been kept restrained.

### 1.4 Grain

`.sc-grain` at 4% (Scroll Craft's engine ships it) over the whole page, above BACKGROUND and below
ATMOSPHERE. It is the difference between a dark page and a lit room, and it costs one fixed element.

---

## 2. The layered composition

Eight layers. Each one has a fixed z-band, a fixed scale rule, and a fixed motion rule, and the rules
are what stop the page becoming eight stacks of cards.

The page-local z scale sits inside Scroll Craft's (`--sc-z-stage: 1`, `--sc-z-copy: 20`,
`--sc-z-chrome: 60`) and is declared once, in the public page's own scope, as `--ltp-z-*`.

| # | Layer | z | Scale rule | Motion rule | Blur / contrast |
|---|---|---|---|---|---|
| 0 | **BACKGROUND** | 0 | Fixed 1.0, always | None, ever. `--lt-bg-0`, and the page's only drift target (§4.6, two stops) | No blur. Reference black point. |
| 1 | **ATMOSPHERE** | 1 | Fixed 1.0 | Its own internal drift only (§1.3). May be translated by scroll at most 40px total, via `data-sc-parallax="-0.4"` | 0 blur, ≤5% opacity |
| 2 | **SIGNAL** | 2 | Fixed 1.0 | `stroke-dashoffset`, `stroke-width`, `opacity` and path geometry only. **Never translated, never scaled.** | No blur. Stroke at 60–100% of its state colour. |
| 3 | **PRODUCT STAGE** | 10 | The only layer allowed a scale change: 0.96 → 1.00 during the chaos collapse, and 1.00 held during a format re-flow (the re-flow changes the stage's *shape*, not its scale) | Never parallaxed. Its contents re-compose; the frame itself holds. | No blur. 100% contrast. This is the reference plane: everything else is graded relative to it. |
| 4 | **DESTINATIONS** | 20 | 0.98 when `DISCONNECTED`, 1.00 when `READY` / `LIVE`. Scale is a real state cue, not decoration. | `data-sc-parallax="0.35"` on the **wrapper** (they sit slightly in front of the stage). Anime.js writes transforms on the **inner tile**. Two nodes, never one. | No blur. 100% contrast. |
| 5 | **DATA / STATUS** | 30 | Fixed 1.0 | **No positional animation at all.** Text the reader is reading must not move relative to what it is read against. Values change; boxes do not. | No blur. 100% contrast. |
| 6 | **INTERACTION** | 40 | 1.00, except the drag proxy which may reach 1.04 while held | Exists only during an interaction, and is removed from the DOM when idle. The only layer with pointer-driven transforms. | No blur. |
| 7 | **FOREGROUND** | 60 | Fixed 1.0 | Fixed position, never parallaxed, never scaled. CSS transitions only, at `--lt-dur-1` / `--lt-dur-2`. | No blur. `--lt-bg-1` with a 1px `--lt-border` edge. **No backdrop-filter.** |

### 2.1 How depth is actually carried

Five tools, used together, none of them a shadow on a card:

1. **Contrast falloff with distance.** ATMOSPHERE at 5% of ink, SIGNAL strokes at 60–100% of their
   state colour, STAGE at 100%. Nothing behind the stage is ever as contrasty as the stage.
2. **Scale as state.** A `DISCONNECTED` destination is 2% smaller than a `READY` one. The visitor
   reads "further away" and "not yet mine" as the same thing, which is true.
3. **Overlap.** The destination tiles cross the stage's boundary by 12px on desktop and 12px on
   mobile. One element crossing another's edge establishes more depth than any shadow, and it is free.
4. **Edge light.** A 1px top highlight on the stage, on each destination tile and on the Pro panel:
   `--ltp-edge: inset 0 1px 0 color-mix(in oklab, var(--lt-text-primary) 9%, transparent)`. Real
   raised things catch light on their lip.
5. **Elevation, three steps only**, taken from the app: `--lt-shadow-1` (tiles), `--lt-shadow-2` (the
   Pro panel, the format popover), `--lt-shadow-3` (the stage). `--lt-shadow-live` is reserved for the
   armed GO LIVE button and nothing else, exactly as in the app.

No zero-offset coloured halo anywhere. No fourth elevation step. No blur-as-glass.

### 2.2 The one rule that keeps it from being eight card stacks

**A layer may not contain a rectangle whose only job is to hold content.** Every box on the page is
either the stage, a destination tile, a real control, a real status readout, or the Pro panel. There
is no "section card", no "feature card", and no container introduced to group things that spacing
could have grouped.

---

## 3. Type

### 3.1 Two faces, one file

| Slot | Face | Files loaded |
|---|---|---|
| **Display** | **Archivo** (variable, wght 400–800) | 1 · self-hosted woff2, subset, `font-display: swap` |
| **Text** | The app's existing `--lt-font-sans` stack (Inter preferred, system fallback) | 0 · no download |
| **Mono** | The app's existing `--lt-font-mono` stack | 0 · no download |

**One file total, and the budget allows two.** The second slot stays unspent: the app deliberately
ships no webfont, and adding Inter as a download to the public page would make the site's text render
differently from the app's on the same machine, which breaks the one-product rule for no gain.

Archivo is chosen because it is a technical grotesque with a wide weight range and true caps
presence, it is not Inter, it is not one of the AI-page defaults, and it holds up at a console's
scale without becoming a poster face. It is **not** a serif, because "editorial" is not what a control
room is.

**Hard constraints on the font, all of them enforceable:**

- **Self-hosted, mandatory.** `apps/web/vercel.json` sets
  `Content-Security-Policy: ... style-src 'self' 'unsafe-inline'; font-src 'self' data:`. Google Fonts
  would be blocked by that policy with no visible error. The file lives under
  `apps/web/public/fonts/` and is served from the same origin.
- **Subset**, to Latin basic plus the digits, the colon, the middle dot and the arrow used in labels.
  `unicode-range` declared. Target ≤ 28 KB for the variable woff2; if the subset exceeds 34 KB, ship
  two static weights (600 and 800) instead of the variable file and keep the count at one request per
  weight, two files maximum.
- **`font-display: swap`**, with `<link rel="preload" as="font" crossorigin>`. First paint never waits
  on it; the system stack renders the same text one frame earlier and the swap is a weight change on
  at most four elements.
- **Fallback stack declared explicitly**, so the swap does not reflow:
  `--ltp-font-display: Archivo, "Segoe UI Variable Display", "Helvetica Neue", Arial, sans-serif`.
- **The wordmark never uses it.** DESIGN_SYSTEM §1.1 fixes the wordmark as the `--lt-font-sans` stack
  at weight 800, ALL CAPS. That rule is normative and this page obeys it.
- **Numerals gate.** If the Archivo subset does not carry `tnum`, every numeral on the page stays in
  `--lt-font-sans` with `font-variant-numeric: tabular-nums`, as the app already does (DESIGN_SYSTEM
  §3.3). Verify before shipping; do not assume. A countdown whose digits change width is a defect.

### 3.2 The eight roles

Sizes are the app's nine-step scale, unchanged. No tenth size is introduced.

| Role | Face | Size | Line height | Weight | Tracking | Where it appears |
|---|---|---|---|---|---|---|
| **display** | Archivo | `--lt-text-48` (mobile `--lt-text-36`) | `--lt-leading-48` | 800 | `--lt-tracking-48` | The 3-2-1 countdown numeral. The elapsed timer at stage scale. Nothing else. |
| **hero** | Archivo | `--lt-text-36` (mobile `--lt-text-28`) | `--lt-leading-36` | 700 | `--lt-tracking-36` | The stage's own state line, one line, at most nine words, and it is a **status**, not a claim: "Live on YouTube, Twitch and TikTok". |
| **headline** | Inter stack | `--lt-text-22` | `--lt-leading-22` | 600 | `--lt-tracking-22` | Panel titles. The rail's act labels. The close's question. |
| **body** | Inter stack | `--lt-text-16` | `--lt-leading-16` | 400 | 0 | The few sentences that exist. Max 68 characters per line (`max-width: 34rem`). |
| **metadata** | Inter stack | `--lt-text-13` | `--lt-leading-13` | 500 | `--lt-tracking-13` | Bitrate, fps, attempt counts, per-destination format labels, field hints. |
| **status** | Inter stack | `--lt-text-12` | `--lt-leading-12` | 600 | `--lt-tracking-12` | Chip labels, the health word, "LIVE", "READY", "Demo". |
| **navigation** | Inter stack | `--lt-text-12` | `--lt-leading-12` | 500 | `--lt-tracking-12` | Rail item labels, 12px under a 24px icon. Never icon-only (DESIGN_SYSTEM §9.1). |
| **CTA** | Inter stack | `--lt-text-18` | `--lt-leading-18` | 700 | `--lt-tracking-18` | GO LIVE, Open LIVETAP, Download, GitHub. |

Rules carried over from the app and not relaxed here: sentence case everywhere except the wordmark and
`GO LIVE` / `END`; upper case is part of the string, never a `text-transform`; text never justified;
never more than two consecutive centred lines; `font-synthesis: none`.

One rule added by the grammar: **display and hero never carry an argument.** They carry state. The
largest type on the page at any moment is either a number the surface is counting or a sentence the
surface is reporting about itself.

### 3.3 Tracking and the display face at scale

At `--lt-text-48` with weight 800, Archivo needs `--lt-tracking-48` (`-0.022em`) and it is already in
the token set. Do not add optical tracking beyond the scale's own value; the scale was built with the
ramp in it. Light-on-dark compensation from the taste floor applies: the countdown numeral takes one
step more weight than its light-mode equivalent would, which is why it is 800 and not 700.

---

## 4. Colour

### 4.1 No new colour

Every colour on this page is a token from `packages/ui/src/tokens.css`. Page-local values exist only
as `color-mix()` derivations of those tokens, under the `--ltp-` prefix, and there is **no raw hex
anywhere in the public page's CSS**.

```css
/* the complete page-local colour surface. Nothing else is added. */
--ltp-edge:      inset 0 1px 0 color-mix(in oklab, var(--lt-text-primary)  9%, transparent);
--ltp-hair:                     color-mix(in oklab, var(--lt-text-primary) 12%, transparent);
--ltp-field:                    color-mix(in oklab, var(--lt-text-primary)  4%, transparent);
--ltp-signal-idle:              color-mix(in oklab, var(--lt-text-primary) 22%, transparent);
--ltp-signal-ready:             color-mix(in oklab, var(--lt-success)      70%, transparent);
--ltp-signal-live:              var(--lt-accent-live);
--ltp-signal-strain:            var(--lt-warning);
--ltp-atmos:                    color-mix(in oklab, var(--lt-text-primary)  3%, transparent);
--ltp-carrier:                  color-mix(in oklab, var(--lt-accent-focus)  3%, transparent);
```

### 4.2 What each colour means, and nothing else

| Meaning | Token | Never used for |
|---|---|---|
| **LIVE** | `--lt-accent-live`, `--lt-accent-live-solid`, `--lt-on-live` | Errors. Destructive actions. Links. Decoration. |
| **ACTION** | `--lt-accent-focus`, `--lt-accent-focus-solid`, `--lt-on-focus` | Anything to do with being on air. |
| **PLATFORM** | **No colour.** A platform is named in text. | Brand hues, tinted tiles, logo colours. See §4.4. |
| **WARNING** | `--lt-warning` | Failure. Warning means "live, and rough", and you can still be live. |
| **SUCCESS** | `--lt-success` | "Live". Success means ready, connected, completed. |
| **STATE** | The ten `--lt-state-*` foreground/tint pairs, verbatim from DESIGN_SYSTEM §2.4 | Any state not in that list. There are exactly ten. |
| **FAILURE** | `--lt-danger`, `--lt-danger-solid`, `--lt-on-danger` | Live. |

`LIVE` is the only solid fill in the system, and on this page there is exactly one solid-filled
element on screen at a time: the GO LIVE button before the countdown, then the LIVE chips. A visitor
glancing at any frame can answer "is this thing live?" without reading.

### 4.3 The remove-most-colour test

Set every state colour to `--lt-text-secondary` and every accent to `--lt-text-primary`, leaving only
the four background layers and the three text levels. The page must still be:

- **readable** — every state still names itself in words (`Ready`, `Live`, `Live, rough`,
  `Reconnecting`, `Failed`, `Not connected`);
- **hierarchical** — the stage is still the brightest and largest thing, the chrome is still the
  quietest, and the squint test still resolves stage → destinations → chrome;
- **operable** — every control still has a 1px `--lt-border-control` boundary, because the border, not
  the fill, is what identifies a control.

If any of those three fails, the page was leaning on colour. This test is a line item on the
acceptance checklist in `PLAN.md`, run as a screenshot with a one-line CSS override.

### 4.4 Platform identity without platform colour

Six destinations appear on the page: YouTube, Twitch, TikTok, Instagram, X, Facebook. Each is
identified by:

- its **name**, set in the text stack at `status` weight;
- its **connection method**, stated honestly in `metadata` under the name, derived from
  `packages/adapters` capability data (§5 of the Interaction System);
- its **state**, via the app's `StatusChip` vocabulary.

No platform logo, no platform brand colour, no tinted tile. Three reasons, all of them already
settled in this repo: DESIGN_SYSTEM §7 says platform logos are third-party trademarks that live
outside the icon system and are never restyled; DESIGN_SYSTEM §12.5 has already excluded
per-platform accent tinting for trademark risk and visual noise; and the asset list for this build is
the mark and the hero plate, nothing more.

### 4.5 Both themes

Dark is the default and the one the direction is composed for. Light is not an afterthought: it is a
first-class theme in the app and the page inherits it through the same tokens, with two page-specific
adjustments.

- `--ltp-atmos` and `--ltp-carrier` are derived from `--lt-text-primary` and `--lt-accent-focus`, so
  they invert with the theme automatically and stay under 5%.
- On a light ground the stage's own elevation does the work the dark theme's background layering does:
  the stage takes `--lt-shadow-3` and the tiles take `--lt-shadow-1`, per DESIGN_SYSTEM §4.3.

When a subtree redefines `--lt-text-primary`, it must restate `color` on the same subtree, or the text
under it keeps the body's ink. This has bitten before; it is written down in Scroll Craft's taste
floor and it is repeated here because the public page has two grounds.

### 4.6 Drift, and why there are only two stops

The Live surface grammar bans `drift` past two stops. The page therefore carries exactly two
`data-sc-drift` attributes:

| Act | Value | Reason |
|---|---|---|
| ACT 1 CHAOS | `var(--lt-bg-0)` resolved at build time | The page's reference ground. |
| ACT 6 RESILIENCE | One step deeper than `bg-0`, inside the same hue family | The room dims very slightly for the peak. Invisible frame to frame, obvious top to bottom. |

No other act sets a drift. The ground is otherwise constant, because a page that is one surface
should not keep changing the colour of the room it is in.

---

## 5. Iconography

The public page uses **the app's icon set, unchanged**: the closed 24-glyph set exported from
`packages/ui/src/components/Icons.tsx`, inline SVG, `viewBox="0 0 24 24"`, 1.75px stroke,
`currentColor`, round caps and joins, at 20px or 24px.

| Rule | Value |
|---|---|
| Source | The same path data as the app. The public page's build imports the SVG bodies, so a change to a glyph changes both surfaces. |
| Glyphs used | `camera`, `mic`, `mic-off`, `screen`, `chat`, `chart`, `alert`, `check`, `x`, `refresh`, `play`, `stop`, `record`, `users`, `tv`, `globe`, `sliders`, `chevron`, `external-link`, `spinner` |
| New glyphs | None. If the page needs a 25th, it names the one it replaces, and that is a change to `packages/ui`, not a page-local addition. |
| **Emoji** | **Forbidden as an icon, anywhere on the page.** `MomentCard` accepts an emoji fallback and `INTENT_PROFILES` carries emoji keys; the public page passes `<MomentIcon>` / `<IntentIcon>` instead, which is the path PRODUCT_REVIEW P2-5 already established. |
| Colour | Always `currentColor`. The single exception in the whole system is the live dot inside the mark. |
| Accessibility | `aria-hidden="true"` beside a text label; an icon-only control carries `aria-label`. |

The mark itself is the SVG in DESIGN_SYSTEM §1.2, verbatim, with its stroke weight scaled linearly
(2 at 32px, 1.5 at 24px, 1.25 at 20px). Its ripples **do not animate** on this page: the ripple
animates exactly once in the product, on the onboarding "You're ready" step, and borrowing it here
would spend a moment that belongs to the app.

---

## 6. Mobile: a different composition

Mobile is not the desktop composition with smaller type. It is a second composition of the same eight
layers, and the differences are decided here rather than left to `flex-wrap`.

### 6.1 What changes

| Aspect | Desktop (> 1024) | Mobile (< 640) |
|---|---|---|
| **Chrome** | Left rail, 88px, `--lt-bg-1`, mark at top, four labelled items, mirroring the app's rail | Bottom status bar, 64px + `env(safe-area-inset-bottom)`, carrying the session state and one action. A 44px top row holds the mark alone. No rail. |
| **Stage** | Centre column, flexible, `min-width: 640px`, 16:9 at rest | Full-width, top of the viewport, 16:9 at rest, shape changing in place during ADAPT |
| **Destinations** | Six tiles arranged around the stage, overlapping its edge by 12px | Below the stage: a horizontal scroll-snap row, 2.2 tiles visible, each ≥ 168px wide and ≥ 44px tall, overlapping the stage's lower edge by 12px |
| **ATMOSPHERE canvas** | Present, 30 fps cap, paused off-screen | **Not created.** A static CSS radial falloff replaces it. |
| **SIGNAL paths** | Curved beziers from stage ports to tiles around the frame | Kept, and they matter more: short vertical stubs from the stage's lower edge down into the tile row. Depth without paths would be decoration; paths are the meaning. |
| **Parallax** | ATMOSPHERE −0.4, DESTINATIONS +0.35 | **Off.** Depth is carried by overlap, scale-as-state and edge light only. |
| **Pointer devices** | `data-sc-tilt="5"` on the close's intent cards | None. `(hover: hover) and (pointer: fine)` gates them out, and the engine already does this. |
| **Moment strip** | 6-up, 168×104, no scroll | Horizontal scroll-snap, 2.2 cards visible, 140×104, exactly as the app does at this width |
| **Type** | `display` 48, `hero` 36 | `display` 36, `hero` 28. One rung down, per the taste floor's portrait-crop-of-the-type rule. |
| **Act spans** | As scored | Every span multiplied by 0.85 by a page-local function that rewrites `data-sc-span` **before** `ScrollCraft.mount()`. The peak stays the largest span by the same margin. |
| **Hero auto-story** | 17 steps, ~24 s | 9 steps, ~11.5 s (§7 of the Interaction System) |
| **ADAPT formats** | 16:9, 9:16, 1:1 all three presented | 16:9 and 9:16 presented; 1:1 reachable by tap and labelled, not skipped |
| **POWER (Pro)** | Four Pro panels slide in behind | One Pro panel, the diagnostics row, with the other three named in a list |

### 6.2 What does not change

Depth is preserved, not flattened: the stage is still the brightest and sharpest plane, the tiles
still sit in front of it and overlap it, ATMOSPHERE is still behind everything, and the chrome is
still above everything. The eight layers all still exist and keep their z-bands. What is removed is
motion that costs a phone more than it gives it, not structure.

### 6.3 Touch-first

- **44 × 44px minimum** on every interactive element, per DESIGN_SYSTEM §6.2, including the drag grip
  on a LIVE tile and the format segments (which currently fail this in the app at 46×32 and are fixed
  here rather than reproduced).
- ≥ 8px of clear space between adjacent targets.
- `touch-action: none` is scoped to the **drag grip only**, never to a tile, never to a section, never
  to the page. Everything else scrolls.
- A drag needs 6px of slop before it captures, and if no drag has started within 400ms of
  `touchstart` the gesture is released back to the page scroller.
- Nothing depends on hover. Every tooltip's content is also a `metadata` line or an `aria-label`.
- Safe-area insets honoured on the status bar and on any pinned action.

---

## 7. The anti-patterns, as a checklist

These are the cheap-website tests referenced by the owner's directive. The directive names them
without enumerating them, so they are derived here **directly from the directive's own verdict on the
current site**, one test per symptom it lists. They are pass/fail, and they are repeated as line items
in `PLAN.md`.

| # | Test | Passes when | Fails when |
|---|---|---|---|
| **1** | **The text test** — "too much text" | No run of prose longer than two lines anywhere on the page. Every string is a label, a status, a value, a control, a hint or an empty state. | Any section reads as a paragraph of marketing prose. Any sentence would be equally at home on a competitor's page. |
| **2** | **The static test** — "static sections" | At every scroll position, something on screen is in a state that changed because of scroll or because of a tap. | Any full screen would survive unchanged as a JPEG. |
| **3** | **The feature-list test** — "feature lists, cards on backgrounds" | Zero bulleted feature lists. Zero three-up feature-card grids. Zero icon-plus-heading-plus-text cards used as page structure. Zero rectangles whose only job is to hold content. | A grid of identical cards appears anywhere, at any breakpoint. |
| **4** | **The depth test** — "no depth" | At least three independent planes are visible at every scroll position, with contrast and scale falling off away from the stage, and no plane that is a card floating on a background. | Depth is asserted by a shadow rather than produced by falloff, overlap and scale. |
| **5** | **The demonstration test** — "weak product demonstration, no product-state storytelling" | Every claim the page makes is demonstrated by an operable element within one screen of the claim. | A claim is asserted in words only. |
| **C** | **The category-defining test** | After the visit, the visitor can name an action **they performed** that no other site let them perform. | The most memorable thing about the page is an effect they watched. |

### 7.1 The standing bans

Shipping blockers, not preferences. The first group is the Scroll Craft taste floor; the second is
specific to this page.

- No em dash anywhere visible. Period, comma, colon or parentheses.
- No `01 / 06` counters, no section numbers, no progress readout.
- No scroll cue: no "scroll", no arrow, no animated mouse.
- No eyebrow above every heading.
- No gradient text, no neon, no outer glow, no zero-offset coloured halo.
- No custom cursor.
- No `transition: all`. No animation of `width`, `height`, `top`, `left`, `margin` or `padding`.
- No `scale(0)` entrances. Enter from `scale(0.95)` and `opacity: 0`.
- No full-frame dark overlay to fix contrast. Density only where the text sits, and it must be a
  **sibling** of the copy, never a `::before` on it, or the verification pass cannot measure it.
- No invented statistics. No counter without a real number behind it.
- No autoplaying audio, and no audio at all.
- No text baked into an image.
- No monospace as a costume. Mono is for stream keys, error codes and log lines, which is what the
  app already uses it for.
- No pills or tags overlaid on media. No version stamps. No locale or weather strip.
- No cookie banner: the site sets no non-essential cookies, and the footer says so.

---

## 8. Assets

| Asset | Status | Note |
|---|---|---|
| The LIVETAP mark | Exists · DESIGN_SYSTEM §1.2, inline SVG | Used in the chrome and in the close. Ripples never animate here. |
| The hero plate | Exists · `apps/web/public/brand/hero-a.webp` | Used once, as the stage's held frame before the first camera source resolves, and as the poster for the stage's picture area. Nothing else. |
| The icon set | Exists · `packages/ui/src/components/Icons.tsx` | Shared verbatim. |
| Archivo variable woff2, subset | **To produce** | One file, self-hosted under `apps/web/public/fonts/`. The only new asset. |
| Photography, footage, illustration, 3D, platform logos | **None, and none needed** | The grammar forbids the first four and §4.4 forbids the fifth. |

Nothing on this page is generated by an image model. The product is the picture.

---

## 9. What this direction is accountable for

Three claims, each checkable against a screenshot rather than an opinion:

1. **It is one product.** Every colour, size, radius, duration, easing, icon and component class on
   the public page is the same token or the same class the app uses. A visitor who lands on `/` and
   then opens `/app/start` should not be able to tell where the marketing stopped.
2. **It reads with most colour removed.** §4.3, as a one-line CSS override and a screenshot.
3. **It is not a template.** §7, six pass/fail tests, and the Scroll Craft fingerprint row in
   `LIVETAP_SCROLL_STORY.md` §8.

---

## 10. Research basis, and what was rejected

The owner's directive requires the UI/UX Pro Max skill
(`.agents/skills/ui-ux-pro-max/scripts/search.py`). It was run. What it returned is recorded here,
including the part that was not used, because a direction that cites a tool without saying which of its
answers it took is not auditable.

### 10.1 What was used

| Query | Result taken |
|---|---|
| `--domain typography` "display typeface paired with Inter text face technical grotesque" | **"Modern Dark Cinema (Inter System)"**: keywords `dark, cinematic, technical, precision, clean, premium`, "Best For: Developer tools, fintech, AI dashboards, **streaming platforms**". Its tracking scheme is the one this page follows: tight negative tracking on display, uppercase labels with positive tracking. Its Inter-only conclusion is **not** taken, because the directive requires a real display face; the display slot goes to Archivo (§3.1) and Inter keeps the text, metadata, status, navigation and CTA roles. |
| `--domain style` "dark dimensional product interface depth layers" | **`dimensional-layering`**: dark mode supported, `performance: cost:low, drivers:none`, and a four-level elevation token set. This page uses the app's **three** elevation steps rather than four, because DESIGN_SYSTEM §4.3 fixes three and "if everything is elevated, nothing is". The style's accessibility note (`risk:high, requires: contrast-text-4.5, keyboard, visible-focus, reduced-motion`) is answered by §4.3, §7 and the Interaction System. |
| `--domain ux` "reduced motion scroll performance touch target size accessibility" | All three results are adopted: platform-specific touch targets with the WCAG web rule handled separately (this page holds 44px everywhere, which is stricter than the 24 CSS px web floor); `prefers-reduced-motion` honoured; and the explicit finding that **parallax and scroll-jacking cause nausea**, answered by presenting the final readable state with no parallax under reduced motion. |
| `--design-system` pattern block | **"Scroll-Triggered Storytelling"**'s conversion guidance is adopted almost verbatim as engineering rules: keep the narrative understandable without scroll-driven effects, keep the DOM reading order complete, disable parallax and scroll-scrub under reduced motion, pause scroll animation when off-screen or hidden, render each chapter in its final readable state under reduced motion, and simplify animation on mobile. Its **progress indicator** recommendation is **rejected**: a progress readout is banned by the owner's rules and by the taste floor. |
| Priority table | The skill's ten-priority ordering is carried into `PLAN.md` §8.4 as an acceptance list. Note the table is **1 to 10**, not 1 to 7. |

### 10.2 What was rejected, and why

The `--design-system` run for `"live broadcasting creator tool premium dark interactive product demo"`
with `--variance 6 --motion 8 --density 5` matched the product category **"Luxury/Premium Brand"** on
the words *premium* and *dark*, and returned:

- a **light** palette (`--color-background: #FAFAF9`, `--color-foreground: #0C0A09`) with a gold accent;
- a luxury-fashion serif pairing, **Cormorant / Montserrat**, whose own "Best For" is
  "Fashion brands, luxury e-commerce, jewelry";
- a checklist item reading "Light mode: text contrast 4.5:1 minimum";
- a GSAP `Flip` page-transition snippet;
- `source_identities.style: null`, meaning the returned "Minimalism" style was a variance-dial fallback
  rather than a database match.

**None of it is used.** It is the opposite of a dark broadcasting tool, it proposes a library this
project is not using, and the skill's own query contract says to retry once and, failing that, to label
anything general as a fallback and not persist unverified output. Two narrower retries on
`--domain landing` returned zero results, and `landing.csv` has no anti-pattern field at all, so there
is **no verified database answer** for landing cliches. The anti-patterns in §7 are therefore derived
from the owner's directive's own verdict rather than from the skill, and they say so.

The colour system in §4 is the app's existing verified-contrast palette, which is stronger evidence
than any search result: every ratio in DESIGN_SYSTEM §2.2 and §2.3 was computed rather than guessed.
