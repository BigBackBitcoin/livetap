# LIVETAP Design System

**Version** 1.0 · **Status** Normative for `packages/ui` and `apps/web` · **Owner** UX / Product Design

> Connect your accounts. Pick where you want to go live. Tap GO LIVE.

This document is the single source of truth for LIVETAP's visual language. Every value here is
implemented in `packages/ui/src/tokens.css` (CSS custom properties, both themes) and
`packages/ui/src/tokens.ts` (typed mirror). If a value is in one and not the other, that is a bug.

Companion documents:

- `docs/design/PRODUCT_SPEC.md` — information architecture and screen specs.
- `packages/ui/src/index.ts` — the component surface that implements this system.

---

## 0. The four rules that outrank everything else

1. **Outcome before configuration.** No screen may ask a question whose answer LIVETAP can infer.
   Encoder, bitrate, keyframe interval, rate control and resolution are *derived* and never appear
   in Simple mode. (Derived from the documented first-run failure of settings-first broadcasting
   tools — see `docs/research/COMPETITOR_FAILURE_DATABASE_A.md` §1 and §5.1.)
2. **Colour is never the only carrier of state.** Every coloured state also carries a word.
   `StatusChip` always renders its label; `HealthPill` always renders one headline word. A user with
   full colour blindness must lose zero information.
3. **One dominant action per screen.** Exactly one element on screen may use a solid accent fill.
   In Studio that element is GO LIVE. Everything else is secondary, ghost, or a chip.
4. **Restraint is the aesthetic.** Two accent hues total: one red for LIVE, one blue for focus and
   links. No gradients on interactive surfaces, no decorative shadows in dark mode, no motion that
   does not communicate a state change.

---

## 1. Brand

### 1.1 Name and wordmark

The product name is **LIVETAP** — one word, no space, no hyphen, no camel case. It is always set in
capitals when used as the wordmark, and in prose it is still written `LIVETAP`.

| Rule | Value |
|---|---|
| Typeface | Inter (system fallback stack, §3.1) |
| Weight | 800 (ExtraBold) |
| Case | ALL CAPS, always |
| Tracking | `-0.02em` at ≥28px, `-0.01em` at 18–22px, `0` below 18px |
| Colour | `--lt-text-primary`. One colour. The wordmark is never split into two colours. |
| Minimum size | 14px cap height (below that, use the mark alone) |
| Clear space | ≥ 0.5× the wordmark's cap height on all four sides |

Forbidden: outlining, drop shadows, gradients, rotation, stretching, italics, a tagline inside the
lockup, translating the name, or setting `LIVE` and `TAP` in different colours or weights.

**Lockup.** Horizontal only: mark, then `space-3` (12px), then wordmark, optically centred on the
wordmark's cap height (not its bounding box). There is no stacked/vertical lockup in v1.

### 1.2 Logo mark

A rounded square (the screen you tap), a live dot slightly left of centre, and two ripple arcs
radiating right from it — the tap propagating outward to every destination. The frame and ripples are
`currentColor`; only the dot is red, so the mark works on any surface and the red always means LIVE.

```svg
<svg viewBox="0 0 32 32" width="32" height="32" fill="none" role="img" aria-label="LIVETAP">
  <rect x="2.5" y="2.5" width="27" height="27" rx="8.5"
        stroke="currentColor" stroke-width="2" />
  <circle cx="12.5" cy="16" r="3" fill="var(--lt-accent-live-solid, #FF4D3F)" />
  <path d="M15.94 20.91A6 6 0 0 0 15.94 11.09"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <path d="M17.95 23.78A9.5 9.5 0 0 0 17.95 8.22"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.55" />
</svg>
```

Geometry: 32×32 grid. Frame inset 2.5 with `rx` 8.5 (a soft corner, not a pill). Dot centre
`(12.5, 16)`, r 3. Ripples are 110° arcs centred on the dot at r 6 and r 9.5, the outer one at 55%
opacity so the ripple reads as decaying. Stroke weight 2 at 32px; scale strokes linearly (1.5 at
24px, 1.25 at 20px, 1 at 16px) so the mark never looks heavy when small.

**Monochrome variant** (favicon masks, print, single-colour embroidery): replace the dot's fill with
`currentColor` and drop the outer ripple to `opacity="0.4"`.

**App icon**: the mark on `--lt-bg-1`, frame and ripples in `--lt-text-primary`, dot in
`--lt-accent-live-solid`, 22% corner radius on the icon plate itself.

Forbidden: animating the ripples in product chrome (the ripple animates exactly once, on the
onboarding "You're ready" step, and nowhere else); using the mark as a loading spinner; recolouring
the dot; placing the mark on a photograph without a solid plate.

### 1.3 Voice in UI

Second person, present tense, no exclamation marks, no "Oops". State the fact, then the action.
Never surface a protocol string to a Simple-mode user. Full copy rules live in `PRODUCT_SPEC.md` §6.

---

## 2. Colour

### 2.1 Model

Dark is the default for Studio because the preview is the brightest thing on screen and everything
else must recede from it. Light is a first-class theme, not an afterthought, and is the default for
Landing and Settings when the OS prefers light.

Themes are selected by `data-theme="dark" | "light"` on `:root`. With no attribute,
`prefers-color-scheme` decides. Tokens are named by **role**, never by value: there is no
`--lt-red`, only `--lt-accent-live`.

Four background layers, in order of elevation:

| Layer | Meaning | Dark | Light |
|---|---|---|---|
| `bg-0` | App ground — the furthest-back surface | `#0A0B0D` | `#F4F6F8` |
| `bg-1` | Panels, docks, nav, sheets | `#121417` | `#FAFBFC` |
| `bg-2` | Cards, chips, raised content | `#1A1D21` | `#FFFFFF` |
| `bg-3` | Inputs, wells, hover/pressed fills | `#23272C` | `#E9EDF1` |

In dark mode elevation goes *lighter*; in light mode elevation goes *whiter and gains a shadow*. A
card never sits on a layer of the same value as itself.

### 2.2 Dark theme — verified contrast

All ratios computed with the WCAG 2.1 relative-luminance formula. **AA normal text = 4.50**;
**AA large text (≥18.66px bold or ≥24px) and non-text UI = 3.00**.

| Token | Hex | on `bg-0` | on `bg-1` | on `bg-2` | on `bg-3` | Verdict |
|---|---|---|---|---|---|---|
| `--lt-text-primary` | `#F2F4F7` | 17.87 | 16.75 | 15.35 | 13.63 | AA on all layers |
| `--lt-text-secondary` | `#A7B0BB` | 8.97 | 8.41 | 7.71 | 6.85 | AA on all layers |
| `--lt-text-tertiary` | `#8A929C` | 6.26 | 5.86 | 5.37 | 4.77 | AA on all layers |
| `--lt-accent-live` | `#FF5F52` | 6.57 | 6.16 | 5.65 | 5.01 | AA on all layers |
| `--lt-accent-focus` | `#6BA8FF` | 8.13 | 7.62 | 6.98 | 6.20 | AA on all layers |
| `--lt-success` | `#3FD98C` | 10.80 | 10.12 | 9.27 | 8.24 | AA on all layers |
| `--lt-warning` | `#F5B544` | 10.85 | 10.17 | 9.32 | 8.28 | AA on all layers |
| `--lt-danger` | `#FF6B6B` | 7.09 | 6.65 | 6.09 | 5.41 | AA on all layers |
| `--lt-info` | `#6BA8FF` | 8.13 | 7.62 | 6.98 | 6.20 | AA on all layers |

Text on solid fills:

| Pair | Values | Ratio | Verdict |
|---|---|---|---|
| `--lt-on-live` on `--lt-accent-live-solid` | `#0A0B0D` on `#FF4D3F` | 5.99 | AA |
| `--lt-on-focus` on `--lt-accent-focus-solid` | `#FFFFFF` on `#2F6FE0` | 4.70 | AA |
| `--lt-on-danger` on `--lt-danger-solid` | `#FFFFFF` on `#C7332B` | 5.33 | AA |

> **Why near-black text on the dark-mode LIVE button.** A red dark enough to carry white text at
> 4.5:1 in dark mode stops reading as *electric*. So dark mode keeps the vivid coral `#FF4D3F` and
> flips the label to near-black (5.99:1) — higher contrast *and* a more confident button. Light mode
> uses the darker `#D63A2D` with white (4.66:1), because on a light ground the vivid coral would be
> the loudest thing on the page. The `--lt-on-live` token absorbs the difference; components never
> hard-code a label colour.

Non-text boundaries (WCAG 1.4.11 — 3:1 required):

| Token | Hex | vs `bg-0` / `bg-1` / `bg-2` / `bg-3` | Use |
|---|---|---|---|
| `--lt-border-control` | `#6B7480` | 4.16 / 3.90 / 3.57 / 3.17 | The boundary of any input, select, toggle or unfilled button. **Required** wherever the border is what identifies the control. |
| `--lt-accent-focus` | `#6BA8FF` | 8.13 / 7.62 / 6.98 / 6.20 | Focus ring |
| `--lt-accent-live-solid` | `#FF4D3F` | 5.99 / 5.61 / 5.14 / 4.57 | GO LIVE fill against its surroundings |
| `--lt-border` | `#2D3238` | 1.43 on `bg-1` | **Decorative hairline only.** Never the sole indicator of a control. |
| `--lt-border-strong` | `#3C434B` | 1.84 on `bg-1` | Decorative section divider |

### 2.3 Light theme — verified contrast

| Token | Hex | on `bg-0` | on `bg-1` | on `bg-2` | on `bg-3` | Verdict |
|---|---|---|---|---|---|---|
| `--lt-text-primary` | `#0E1116` | 17.46 | 18.25 | 18.91 | 16.07 | AA on all layers |
| `--lt-text-secondary` | `#4A545F` | 7.11 | 7.44 | 7.71 | 6.55 | AA on all layers |
| `--lt-text-tertiary` | `#5F6975` | 5.15 | 5.38 | 5.58 | 4.74 | AA on all layers |
| `--lt-accent-live` | `#C6362C` | 4.89 | 5.11 | 5.30 | 4.50 | AA on all layers |
| `--lt-accent-focus` | `#1A66D6` | 4.95 | 5.18 | 5.36 | 4.56 | AA on all layers |
| `--lt-success` | `#0C7449` | 5.37 | 5.61 | 5.82 | 4.94 | AA on all layers |
| `--lt-warning` | `#8A5A00` | 5.47 | 5.72 | 5.93 | 5.04 | AA on all layers |
| `--lt-danger` | `#C0332B` | 5.17 | 5.41 | 5.60 | 4.76 | AA on all layers |
| `--lt-info` | `#1A66D6` | 4.95 | 5.18 | 5.36 | 4.56 | AA on all layers |

| Pair | Values | Ratio | Verdict |
|---|---|---|---|
| `--lt-on-live` on `--lt-accent-live-solid` | `#FFFFFF` on `#D63A2D` | 4.66 | AA |
| `--lt-on-focus` on `--lt-accent-focus-solid` | `#FFFFFF` on `#1F66DE` | 5.23 | AA |
| `--lt-on-danger` on `--lt-danger-solid` | `#FFFFFF` on `#BE2F27` | 5.79 | AA |

| Token | Hex | vs `bg-0` / `bg-1` / `bg-2` / `bg-3` | Use |
|---|---|---|---|
| `--lt-border-control` | `#75808D` | 3.71 / 3.88 / 4.02 / 3.41 | Control boundaries |
| `--lt-accent-focus` | `#1A66D6` | 4.95 / 5.18 / 5.36 / 4.56 | Focus ring |
| `--lt-accent-live-solid` | `#D63A2D` | 4.31 / 4.50 / 4.66 / 3.96 | GO LIVE fill |
| `--lt-border` | `#DCE1E7` | 1.27 on `bg-1` | Decorative hairline only |
| `--lt-border-strong` | `#C2CAD3` | 1.60 on `bg-1` | Decorative divider |

### 2.4 Destination-state colours (all 10 `DestinationState`s)

Each state has a foreground colour and a **tonal** background used by `StatusChip`. Dark tints are
the state colour at 16% over `bg-2`; light tints are 9% over white. Neutral states deliberately use
`bg-3` as their tint — "no colour" is itself information.

| `DestinationState` | Dark fg | Dark tint | fg-on-tint | Light fg | Light tint | fg-on-tint | Dot |
|---|---|---|---|---|---|---|---|
| `DISCONNECTED` | `#8A929C` | `#23272C` | 4.77 | `#5A646F` | `#F0F1F2` | 5.33 | hollow ring |
| `AUTHENTICATING` | `#6BA8FF` | `#273345` | 5.27 | `#1A66D6` | `#EAF1FB` | 4.72 | solid |
| `READY` | `#3FD98C` | `#203B32` | 6.64 | `#0C7449` | `#E9F2EF` | 5.10 | solid |
| `STARTING` | `#45D0E8` | `#213A41` | 6.55 | `#0E6E86` | `#E9F2F4` | 5.14 | solid |
| `LIVE` | `#FF5F52` | *solid fill* `#FF4D3F` | 5.99 | `#C6362C` | *solid fill* `#D63A2D` | 4.66 | **pulsing** |
| `DEGRADED` | `#F5B544` | `#3D3527` | 6.66 | `#8A5A00` | `#F4F0E8` | 5.21 | solid |
| `RECONNECTING` | `#FF9F45` | `#3F3227` | 6.07 | `#9A4D00` | `#F6EFE8` | 5.36 | **pulsing** |
| `FAILED` | `#FF6B6B` | `#3F292D` | 4.83 | `#C0332B` | `#F9EDEC` | 4.89 | alert glyph |
| `STOPPING` | `#A7B0BB` | `#23272C` | 6.85 | `#4A545F` | `#EFF0F1` | 6.76 | solid |
| `ENDED` | `#8A929C` | `#23272C` | 4.77 | `#5F6975` | `#F1F2F3` | 4.98 | solid |

Three deliberate decisions in that table:

- **`LIVE` is the only solid-filled chip in the system.** Nothing else may use a solid accent fill in
  a chip, so a glance anywhere in the app answers "am I live?" without reading.
- **`LIVE` and `FAILED` are both red, and that is safe** because they never look alike: `LIVE` is a
  solid vivid fill with a pulsing dot, `FAILED` is a muted tint with a static alert glyph, and both
  always render their word. Inventing a third red to separate them would have cost more clarity than
  it bought.
- **`DISCONNECTED` vs `ENDED`** share a colour and are separated by shape: `DISCONNECTED` uses a
  hollow ring (nothing has happened yet), `ENDED` a filled dot (something happened and finished).

Only `LIVE` and `RECONNECTING` animate. A pulsing dot means "this is changing right now"; a static
dot means "this is settled". Under `prefers-reduced-motion: reduce` the pulse becomes a permanent
100%-opacity dot plus a 1px ring — still distinguishable, just not animated.

### 2.5 Health-level colours (all 6 `HealthLevel`s)

| `HealthLevel` | Headline word | Dark fg | Dark tint | fg-on-tint | Light fg | Light tint | fg-on-tint |
|---|---|---|---|---|---|---|---|
| `excellent` | Excellent | `#2ED3A3` | `#1D3A36` | 6.41 | `#0A7360` | `#E9F2F1` | 5.07 |
| `good` | Good | `#56D364` | `#243A2C` | 6.35 | `#1F7A33` | `#EBF3ED` | 4.78 |
| `fair` | Fair | `#F5B544` | `#3D3527` | 6.66 | `#8A5A00` | `#F4F0E8` | 5.21 |
| `poor` | Poor | `#FF9F45` | `#3F3227` | 6.07 | `#9A4D00` | `#F6EFE8` | 5.36 |
| `critical` | Critical | `#FF6B6B` | `#3F292D` | 4.83 | `#C0332B` | `#F9EDEC` | 4.89 |
| `unknown` | Checking | `#8A929C` | `#23272C` | 4.77 | `#5A646F` | `#F0F1F2` | 5.33 |

`excellent` is teal-green and `good` is leaf-green so the two best states are distinguishable at a
glance without reading; `unknown` reads "Checking" rather than "Unknown" because the honest state
before the first metrics window is *measuring*, not *ignorance*.

### 2.6 Semantic aliases

| Token | Meaning | Never used for |
|---|---|---|
| `--lt-accent-live` / `-solid` / `--lt-on-live` | LIVE, and the GO LIVE action | Errors, destructive actions, links |
| `--lt-accent-focus` / `-solid` / `--lt-on-focus` | Focus rings, links, the primary non-live button | Anything to do with being on air |
| `--lt-success` | Ready, connected, completed | "Live" |
| `--lt-warning` | Degraded, amber pre-flight — *you can still go live* | Failure |
| `--lt-danger` / `-solid` / `--lt-on-danger` | Failure, destructive actions (Remove, Delete) | Live |
| `--lt-info` | Neutral information, mock-mode banner | Success |

`--lt-overlay` (`rgba(0,0,0,0.60)` dark / `rgba(14,17,22,0.40)` light) backs modals and sheets.
`--lt-scrim-preview` (`rgba(10,11,13,0.72)`, both themes) backs controls floated over the video
preview — the one place text sits on unknown pixels. With `--lt-text-primary` on top it holds
≥ 11:1 over any frame.

---

## 3. Typography

### 3.1 Stack

```css
--lt-font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text",
  "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif,
  "Apple Color Emoji", "Segoe UI Emoji";
--lt-font-mono: ui-monospace, SFMono-Regular, "SF Mono", "Cascadia Mono", Menlo,
  Consolas, "Liberation Mono", monospace;
```

Inter is *preferred*, never *required*: LIVETAP ships no webfont in v1 and the system fallback is
metrically close enough that no layout depends on Inter being present. The desktop build may bundle
Inter as a local font file; the web build must not block first paint on a font download.

### 3.2 Scale

Nine sizes. Adding a tenth requires deleting one.

| Token | Size | Line height | Tracking | Weight(s) | Where it is used |
|---|---|---|---|---|---|
| `--lt-text-12` | 12px | 16px (1.333) | `+0.005em` | 500, 600 | Chip status text, meter captions, table units |
| `--lt-text-13` | 13px | 18px (1.385) | `+0.005em` | 500, 600 | Dense Pro rows, tab labels, `Kbd` |
| `--lt-text-14` | 14px | 20px (1.429) | `0` | 400, 500, 600 | Default body in Pro density; secondary text |
| `--lt-text-16` | 16px | 24px (1.5) | `0` | 400, 500, 600 | **Default body.** All inputs on mobile (prevents iOS zoom) |
| `--lt-text-18` | 18px | 26px (1.444) | `-0.005em` | 500, 600 | Card titles, `HealthPill` headline, `GO LIVE` label (700) |
| `--lt-text-22` | 22px | 28px (1.273) | `-0.01em` | 600, 700 | Section headings, sheet titles, `ErrorCard` WHAT |
| `--lt-text-28` | 28px | 34px (1.214) | `-0.014em` | 700 | Screen titles, onboarding step headings |
| `--lt-text-36` | 36px | 42px (1.167) | `-0.018em` | 700, 800 | Landing section headlines |
| `--lt-text-48` | 48px | 52px (1.083) | `-0.022em` | 800 | Landing hero only. Never inside the app. |

Weights in use: 400 regular, 500 medium, 600 semibold, 700 bold, 800 extrabold (wordmark and hero
only). 300 and 900 do not exist in this system.

Rules:

- Body copy never exceeds **68 characters** per line (`max-width: 34rem` at 16px).
- Never centre more than two consecutive lines of text.
- Sentence case everywhere except the wordmark and the GO LIVE / END labels. No Title Case.
- Text is never justified. Upper case appears only in the wordmark, `GO LIVE`, `END` and `Kbd` —
  and in those it is part of the string, never a `text-transform`, so what the DOM says is what the
  screen shows (see PRODUCT_SPEC.md §6.4).
- `font-synthesis: none` — no faux bold or faux italic from the fallback stack.

### 3.3 Numerals — metrics must not dance

Every number that updates on a timer is set in tabular figures so digits never shift width:

```css
.lt-num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
```

Mandatory on: the live elapsed timer, bitrate, dropped-frame percentages, fps, viewer counts, RTT,
recording size and duration, the 3-2-1 countdown, and every value in the Pro diagnostics log. Stream
keys, error codes and log lines additionally use `--lt-font-mono`. Proportional figures are for
prose only.

Formatting: `mm:ss` under an hour and `h:mm:ss` over it, never `00:mm:ss`. Bitrate in whole `kbps`
below 10,000 and one decimal `Mbps` above. Percentages to one decimal below 10% and whole numbers
above. Sizes in `MB` below 1,024 and one decimal `GB` above.

---

## 4. Spacing, radii, elevation

### 4.1 Spacing — 4-based

| Token | px | Typical use |
|---|---|---|
| `--lt-space-0` | 0 | Reset |
| `--lt-space-05` | 2 | Optical nudges, icon/label kerning |
| `--lt-space-1` | 4 | Icon-to-label inside a chip |
| `--lt-space-2` | 8 | Inside a chip or badge; gap in a button group |
| `--lt-space-3` | 12 | Control padding; gap between related controls |
| `--lt-space-4` | 16 | **Default gap.** Card padding on mobile |
| `--lt-space-5` | 20 | Card padding; Pro-density section gap |
| `--lt-space-6` | 24 | Card padding on desktop; gap between card groups |
| `--lt-space-8` | 32 | Section gap inside a screen |
| `--lt-space-10` | 40 | Screen gutter on tablet |
| `--lt-space-12` | 48 | Screen gutter on desktop; landing block gap |
| `--lt-space-16` | 64 | Landing section padding (mobile) |
| `--lt-space-20` | 80 | Landing section padding (tablet) |
| `--lt-space-24` | 96 | Landing section padding (desktop) |

No value outside this scale may appear in a stylesheet, with two exceptions: `1px` hairlines and the
`-1px` negative offsets used to overlap borders.

### 4.2 Radii

| Token | px | Applies to |
|---|---|---|
| `--lt-radius-sm` | 8 | Inputs, selects, small buttons, badges, `Kbd`, tooltips |
| `--lt-radius-md` | 12 | Buttons (md/lg), chips, meters, toasts |
| `--lt-radius-lg` | 16 | Cards, Moment cards, destination cards, the GO LIVE button |
| `--lt-radius-xl` | 24 | Preview surface, sheets, modals, the mock-mode banner |
| `--lt-radius-full` | 9999px | Status dots, avatars, `HealthPill`, pill toggles, the aspect-ratio segmented control |

Nesting rule: a child's radius is the parent's radius minus its own padding, floored at `sm`. A 16px
card with 12px padding contains 8px children. Never nest two equal radii.

### 4.3 Elevation

Dark mode gets its depth from the background layers plus a hairline border; shadows are nearly
invisible by design. Light mode gets its depth from shadows.

| Token | Dark | Light | Used by |
|---|---|---|---|
| `--lt-shadow-0` | `none` | `none` | Flat content on `bg-0` |
| `--lt-shadow-1` | `0 1px 2px rgba(0,0,0,0.40)` | `0 1px 2px rgba(14,17,22,0.06), 0 1px 1px rgba(14,17,22,0.04)` | Cards, chips |
| `--lt-shadow-2` | `0 4px 12px rgba(0,0,0,0.45)` | `0 4px 12px rgba(14,17,22,0.08), 0 1px 2px rgba(14,17,22,0.05)` | Popovers, selects, tooltips |
| `--lt-shadow-3` | `0 12px 32px rgba(0,0,0,0.55)` | `0 12px 32px rgba(14,17,22,0.12), 0 2px 6px rgba(14,17,22,0.06)` | Sheets, modals, bottom sheet |
| `--lt-shadow-live` | `0 0 0 1px rgba(255,77,63,0.45), 0 6px 24px rgba(255,77,63,0.28)` | `0 0 0 1px rgba(214,58,45,0.35), 0 6px 24px rgba(214,58,45,0.20)` | The GO LIVE button when armed, and nothing else |

Every raised surface in dark mode carries `border: 1px solid var(--lt-border)` in addition to its
shadow; without it, `bg-2` on `bg-1` is too subtle on low-quality panels.

---

## 5. Motion

Three durations. Nothing in LIVETAP animates for longer than 320ms except the live pulse.

| Token | ms | Use |
|---|---|---|
| `--lt-dur-1` | 120 | Hover, press, focus ring, toggle knob, chip colour change |
| `--lt-dur-2` | 200 | Tab switch, tooltip, popover, Moment card selection, dock tab content |
| `--lt-dur-3` | 320 | Sheet in/out, modal in/out, preview aspect-ratio change, GO LIVE → END morph |

| Easing token | Curve | Use |
|---|---|---|
| `--lt-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default. Enters fast, settles slowly. |
| `--lt-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Anything leaving the screen |
| `--lt-ease-emphasis` | `cubic-bezier(0.2, 0, 0, 1.2)` | The single overshoot in the system, allowed only on the GO LIVE → LIVE transition |
| `--lt-ease-linear` | `linear` | Meters, progress, the countdown ring |

**The live pulse.** `--lt-dur-pulse: 1600ms`, `--lt-ease-pulse: cubic-bezier(0.4, 0, 0.6, 1)`,
infinite alternate, animating `opacity` 1 → 0.35 and `transform: scale()` 1 → 1.35 on a separate
halo element — never on the dot itself, so the dot's position never moves. Only two things in the
product pulse: a `LIVE` / `RECONNECTING` status dot, and the live indicator in the Studio header.
Pulsing anything else is a bug.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` sets `--lt-dur-1/2/3` to `1ms`, kills
every `animation-name`, and makes the pulse a static full-opacity dot with a 1px ring. Transitions
that only change colour or opacity may keep a 1ms duration; transitions that move or scale are
removed outright. No feature is lost when motion is off — sheets still open, they just appear.

Additional rules: never animate `width`, `height`, `top` or `left` — only `transform` and `opacity`.
Never animate the video preview itself. Never auto-scroll chat when the user has scrolled up.

---

## 6. Focus, targets, keyboard

### 6.1 Focus ring

One ring for the whole product:

```css
--lt-focus-width: 2px;
--lt-focus-offset: 2px;
--lt-focus-color: var(--lt-accent-focus);

:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: var(--lt-focus-width) solid var(--lt-focus-color);
  outline-offset: var(--lt-focus-offset);
}
```

- `:focus-visible` only — never a ring from a mouse click, always a ring from a keyboard.
- `outline`, not `box-shadow`, so the ring survives Windows High Contrast and `forced-colors`.
- The 2px offset guarantees the ring is legible against the control's own fill; on solid-filled
  buttons (GO LIVE, primary, danger) an additional `box-shadow: inset 0 0 0 1px var(--lt-bg-0)`
  separates ring from fill.
- The ring is never clipped: any ancestor with `overflow: hidden` must add `padding: 2px`, or the
  focusable child uses `outline-offset: -2px` (inset ring). Inset rings are permitted only inside
  the video preview and inside virtualised lists.
- Ring colour is `accent-focus` in both themes — 6.20:1 minimum in dark, 4.56:1 in light, both
  comfortably over the 3:1 non-text requirement.
- Focus is never removed from a control that is being disabled mid-interaction; move focus to the
  nearest sensible ancestor first and announce the change.

### 6.2 Touch targets

**44 × 44px minimum** for every interactive element on mobile viewports and coarse pointers. The
visual box may be smaller; the hit area may not.

```css
@media (max-width: 639.98px), (pointer: coarse) {
  .lt-touch { min-block-size: 44px; min-inline-size: 44px; }
}
```

Adjacent targets keep ≥ 8px of clear space. Desktop pointer targets may shrink to 32px (Pro density)
or 28px for icon-only controls in the Pro layer list, but never below 24px, and never on touch.

### 6.3 Keyboard

| Key | Behaviour |
|---|---|
| `Tab` / `Shift+Tab` | Standard order: skip link → nav → main → dock. Never a positive `tabindex`. |
| `Escape` | Closes the topmost sheet/modal/popover; cancels a GO LIVE countdown; never ends a live stream |
| `Space` / `Enter` | Activates buttons, toggles and Moment cards. `Space` on a `Toggle` flips `aria-pressed` |
| `←` `→` | Moves between `Tabs` and between aspect-ratio segments (roving tabindex; `Home`/`End` supported) |
| `1`–`6` | Switch to Moment N (Studio only, when focus is not in a text field) |
| `M` | Mute/unmute microphone (Studio only, not in a text field) |
| `?` | Opens the shortcut sheet |

Every focus trap (`Sheet`, modal) restores focus to the element that opened it on close. Nothing in
LIVETAP is reachable by mouse only.

---

## 7. Iconography

| Rule | Value |
|---|---|
| Format | Inline SVG in the React component. No sprite sheets, no icon fonts, no external requests. |
| Grid | `viewBox="0 0 24 24"`, 1.5px safe margin |
| Stroke | **1.75px**, `stroke="currentColor"`, `fill="none"` |
| Caps / joins | `stroke-linecap="round"`, `stroke-linejoin="round"` |
| Sizes | **20px** (inline with 14/16px text, chips, inputs) and **24px** (icon buttons, Moment cards, nav) |
| Optical | Strokes are *not* rescaled between 20 and 24; the same path renders at both sizes |
| Colour | Always `currentColor`. An icon never carries its own colour — the single exception is the live dot in `Logo`. |
| Accessibility | `aria-hidden="true"` when beside a text label; the parent control carries the label. An icon-only control **must** have `aria-label`. |

The v1 set is closed at 24 glyphs: `camera`, `mic`, `mic-off`, `screen`, `settings`, `chat`, `chart`,
`plus`, `x`, `check`, `alert`, `external-link`, `play`, `stop`, `refresh`, `chevron`, `sun`, `moon`,
`sliders`, `record`, `users`, `tv`, `globe`, `spinner`. Adding a 25th requires naming the one it
replaces. `chevron` rotates via `transform` rather than shipping four directional variants.

Platform logos are **not** icons. They are third-party trademarks, live in `apps/web` as separate
assets, are never restyled or recoloured, and are never used to imply endorsement.

---


**Domain glyph families (added 2026-09-12).** Beyond the closed 24-name system set, two id-keyed families share the same shell (24×24 grid, 1.75px stroke, `currentColor`, sizes 20/24/32): `IntentIcon` (talking, gaming, podcast, presentation, event, vertical) and `MomentIcon` (starting-soon, main-camera, screen-share, guest, break, ending, with a neutral fallback for custom Moments). They replace emoji everywhere in product UI so the site and app share one visual language.

## 8. Density: Simple vs Pro

One attribute, `data-density="simple" | "pro"`, on the app root. Simple is the default. Density
changes *size and spacing only* — it never changes which controls exist. Pro mode is a superset:
**anything visible in Simple is visible in Pro, in the same place.**

| Property | Simple | Pro |
|---|---|---|
| Control height (md) | 44px | 36px |
| Control height (sm) | 36px | 28px |
| Control height (lg) | 52px | 44px |
| Body size | 16px | 14px |
| Label size | 14px | 13px |
| Card padding | `space-5` (20) | `space-4` (16) |
| Row gap in lists | `space-3` (12) | `space-2` (8) |
| Section gap | `space-8` (32) | `space-6` (24) |
| Icon size default | 24px | 20px |
| Table row height | 48px | 36px |
| Numbers shown per metric | 1 (the headline word) | 3–5 (word + raw metrics) |
| Disclosure default | collapsed | remembered per section |

On touch viewports, Pro density does **not** shrink below the 44px touch floor: `data-density="pro"`
combined with `(pointer: coarse)` resolves back to Simple sizing. Pro is a density preference, not an
accessibility override.

Content-level differences (which fields appear, not how big they are) are specified per screen in
`PRODUCT_SPEC.md`, not here.

---

## 9. Responsive layout

| Range | Name | Token |
|---|---|---|
| `< 640px` | mobile | `--lt-bp-mobile: 640px` (queried as `max-width: 639.98px`) |
| `640px – 1024px` | tablet | `--lt-bp-tablet: 1024px` |
| `> 1024px` | desktop | `--lt-bp-desktop: 1025px` |

Media queries are written against these two numbers only. No component defines its own breakpoint;
components that must respond to *their own* width use container queries
(`container-type: inline-size`) so a card behaves the same in a dock as on a page.

### 9.1 Layout behaviour per breakpoint

| Aspect | Mobile (<640) | Tablet (640–1024) | Desktop (>1024) |
|---|---|---|---|
| Page gutter | `space-4` (16) | `space-6` (24) | `space-12` (48), content capped at 1440px |
| Grid | 1 column | 2 columns, 16px gutter | 12 columns, 24px gutter |
| Navigation | Bottom bar, 64px + safe-area inset, 5 items, centre Studio item raised (56px circle) | Top bar, 56px, sticky, text tabs | Left rail, 88px, icon above a 12px label — never icon-only |
| Studio dock (Chat / Destinations / Health) | Bottom `Sheet`, 3 tabs, snap points 45% / 92% of viewport | Right-edge `Sheet`, 420px, over the preview | Docked column, 380px default, drag-resizable 320–520px, width persists |
| Studio preview | Full-width, top of screen, controls on a `--lt-scrim-preview` bar beneath | Full-width, dock overlays from the right | Flexible centre column, `min-width: 640px` |
| Moment strip | Horizontal scroll-snap, 2.2 cards visible, 140×104px cards | Horizontal scroll, 3.5 visible, 160×104px | 6-up grid, no scroll, 168×104px |
| Destination chips | Horizontal scroll row under the preview | Wrapping row | Wrapping row + full state list in the dock |
| GO LIVE | Full-width, 64px tall, pinned above the nav bar with safe-area inset, never within 16px of it | Full-width of the centre column, 76px tall | Full-width of the centre column, 88px tall |
| Quick controls | Icon-only; device pickers open as a `Sheet` | Icon + chevron; pickers open as a popover | Icon + device name + chevron, inline |
| `Sheet` | Bottom sheet, full width, drag handle, `border-radius: 24px 24px 0 0` | Right side panel, 380px | Right side panel, 420px |
| Tables | Card-per-row (labels inline) | Scrolling table, 4 columns | Full table |
| Landing hero | 36px headline, stacked, one CTA | 36px, two-column from 768px | 48px, two-column |
| Settings | Single column, sections as accordions | Two columns | Left section list + right detail pane |

Screen-level derivations of this table (the Studio grid `88px | 1fr | 380px`, the tablet
dock-as-Sheet decision, focus orders) live in `PRODUCT_SPEC.md` §5. Where the two disagree on a
dimension, this table wins.

Additional invariants:

- Safe-area insets (`env(safe-area-inset-*)`) are honoured on every fixed element. The mobile GO LIVE
  button and the bottom nav both add `padding-bottom: env(safe-area-inset-bottom)`.
- **Nothing reflows while live.** Changing breakpoint while live is allowed (rotation, window
  resize), but the GO LIVE/END button, the elapsed timer and the health pill keep their relative
  order so muscle memory survives. No layout animation runs while `state === LIVE`.
- Landscape phones (`height < 480px`) collapse the Moment strip into a single "Moments" button that
  opens a sheet; the preview and END keep priority.
- Zoom to 200% must not require horizontal scrolling at any breakpoint (WCAG 1.4.10): layouts use
  `flex-wrap`/`grid` and `rem`-relative maxima, never fixed pixel page widths.

---

## 10. Component contracts

The library in `packages/ui/src` implements this system. Props are documented in the source; this is
what each component *guarantees*.

| Component | Guarantees |
|---|---|
| `Button` | Variants `primary` (focus-blue solid) / `secondary` (bordered) / `ghost` / `danger` (danger-solid) / `live` (live-solid; reserved for GO LIVE and the Landing CTA). Sizes `sm`/`md`/`lg`. `loading` shows a `Spinner`, sets `aria-busy`, and keeps the label so width never jumps. `icon` slot renders before the label at 20px. |
| `IconButton` | Icon-only; `label` is a **required** prop and becomes `aria-label`. Square, `lt-touch` on mobile. |
| `Toggle` | A `<button>` with `aria-pressed`, not a checkbox — it is an immediate action, not a form value. Knob moves in `--lt-dur-1`. |
| `Select` | A native `<select>`, styled. Native pickers beat anything we would build, especially on mobile and with a screen reader. |
| `TextField` | The label is always rendered (never placeholder-as-label). Error text is `aria-describedby`-linked and `role="alert"`. |
| `Card` | `bg-2`, `radius-lg`, `shadow-1`, hairline border. Optional title/actions header. Not clickable — put a `Button` inside. |
| `Sheet` | Bottom sheet on mobile, side panel on desktop. `role="dialog"`, `aria-modal="true"`, focus trap, `Escape` closes, focus restored on close, background scroll locked. |
| `Tabs` | Roving tabindex, `←`/`→`/`Home`/`End`, `role="tablist"`/`tab`/`tabpanel`, `aria-selected`. |
| `Badge` | Small non-interactive label. Tones `neutral`/`info`/`success`/`warning`/`danger`. Used for capability badges. |
| `StatusChip` | `state: DestinationState` + `label`. Always renders the label text. Per-state colour from §2.4. Dot pulses only for `LIVE` and `RECONNECTING`. `LIVE` renders as the solid fill. |
| `HealthPill` | `level: HealthLevel` + `headline`. One word plus colour, expandable to detail. `aria-live="polite"` on the headline. |
| `ErrorCard` | Renders a `HumaneError` as WHAT / WHY / DOING / YOU CAN with exactly one primary action. `technical` is Pro-only, behind a `<details>` disclosure. |
| `MomentCard` | Large tappable card, icon + name, `aria-pressed` for active. ≥104px tall, ≥140px wide. |
| `GoLiveButton` | States `idle` / `countdown` / `starting` / `live` / `stopping`. Countdown shows 3-2-1 with Cancel; `Escape` cancels. Live shows `mm:ss` in tabular numerals plus the word END. |
| `Meter` | Audio level bar. `role="meter"` with `aria-valuenow/min/max`; peak-hold marker; never the only indication that audio is present. |
| `Logo` | The §1.2 SVG plus optional wordmark. `mark` / `full` variants, sizes 20/24/32/40. |
| `Banner` | `info` / `warning`. Used for mock mode. Optionally dismissible; the mock banner is not. |
| `Tooltip` | CSS-only on `:hover`/`:focus-visible`. Never the only source of a label, never interactive, never on touch-only content. |
| `Kbd` | Mono, 13px, `bg-3`, `radius-sm`, 1px `border-control`. |
| `Spinner` | 20/24px SVG arc, 800ms rotation; static arc under reduced motion. |
| `VisuallyHidden` | The standard clip pattern; content stays focusable. |
| `Icons` | The closed 24-glyph set from §7. |
| `useTheme` | Reads/writes `data-theme` and `localStorage["livetap.theme"]`; `"system"` follows `prefers-color-scheme`. |
| `useMediaQuery` | SSR-safe subscription to a media query. |
| `useReducedMotion` | `prefers-reduced-motion: reduce`. |

### 10.1 Accessibility floor (non-negotiable)

1. Every interactive element is keyboard-operable and has a visible `:focus-visible` ring.
2. Every icon-only control has an `aria-label`.
3. Colour is never the only state carrier — `StatusChip` and `HealthPill` always render words.
4. Touch targets are ≥44px on mobile and coarse pointers.
5. Contrast: ≥4.5:1 for text, ≥3:1 for control boundaries and focus rings. §2.2/§2.3 are the proof.
6. State changes a sighted user notices passively (going live, a destination failing, health
   dropping) are announced through a live region. Going live and stream failure use
   `aria-live="assertive"`; everything else is `polite`.
7. `prefers-reduced-motion` removes motion without removing information.
8. Nothing relies on hover: every tooltip's content is available another way.
9. No `title`-attribute-only labels, no `placeholder`-only labels, no `div` with a click handler.
10. Forced-colors / High Contrast: outlines survive because focus uses `outline`. Where a colour *is*
    the semantics (`StatusChip`, the live button) the component pairs `forced-color-adjust: none`
    with a border so the shape survives too.

---

## 11. Conformance checklist

A pull request touching UI must answer yes to all of these:

- [ ] No raw hex, `rgb()` or ad-hoc `px` spacing value in a component — tokens only.
- [ ] No new font size, radius, duration or spacing step.
- [ ] Both themes were looked at, and both at 200% zoom.
- [ ] Every new interactive element: reachable by `Tab`, activated by `Enter`/`Space`, visible ring.
- [ ] Every icon-only control has `aria-label`.
- [ ] Any coloured state also renders a word.
- [ ] Contrast of any new pair was computed, not guessed, and added to §2.
- [ ] `prefers-reduced-motion` was tested; nothing became unusable.
- [ ] Mobile: targets ≥44px, no horizontal page scroll, safe-area insets honoured.
- [ ] Exactly one solid-accent element on screen.
- [ ] Nothing moves while `state === LIVE`.

---

## 12. Open questions

1. **Bundled Inter.** Should the desktop build ship Inter as a local font file (consistent rendering,
   ~300KB) or stay on the system stack (zero bytes, slight platform variance)? Recommendation:
   system stack for web, bundled for desktop; decide before the first release build.
2. **A third accent for scheduling.** If scheduled broadcasts land in v1.1 they need a state that is
   neither ready nor live. Current thinking: reuse `info` blue with a clock glyph rather than
   introduce a fourth hue.
3. **`STARTING` vs `AUTHENTICATING` cyan/blue.** Both are transient and typically ~2s apart. If
   usability testing shows nobody distinguishes them, collapse both to `info` blue and rely on the
   label.
4. **High-contrast theme.** `data-theme` leaves room for a `"contrast"` variant at ≥7:1 everywhere
   (AAA). Not in v1; the token names are already shaped to allow it.
5. **Per-platform accent tinting** on destination cards is deliberately excluded (trademark risk plus
   visual noise). Revisit only if users report difficulty telling destinations apart.
