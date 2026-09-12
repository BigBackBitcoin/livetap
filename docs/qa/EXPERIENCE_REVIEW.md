# LIVETAP public experience: the review

**Reviewed** 2026-09-12 · **Surface** `/` (`apps/web/index.html`) · **Build** the real Vite
production build, served by `apps/web/scripts/preview-server.mjs` on `:4173`
**Companions** `docs/design/LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_INTERACTION_SYSTEM.md` ·
`LIVETAP_SCROLL_STORY.md` · `LIVETAP_MOTION_SYSTEM.md` ·
`scrollcraft/builds/livetap-public/REPORT.md`

Every answer below is evidence or a measurement. Where something could not be verified, it says
so instead of claiming a pass. Screenshots are in `docs/qa/experience-screenshots/`, dark theme
at 1440x900 unless the filename says otherwise.

---

## 1. The 15-second test

Six facts, and which single element on screen carries each. The directive names the test without
enumerating the facts, so they are the six derived in `LIVETAP_INTERACTION_SYSTEM.md` §11 from
its own north star. "Visible by" is the automatic story's own clock, with nothing tapped and
nothing scrolled.

| # | The fact | The element that carries it | Visible by | Evidence |
|---|---|---|---|---|
| **F1** | One live production goes to several platforms at the same time | The stage with three lit signal paths running to three tiles, all three chips showing the solid `LIVE` fill | **10.6 s** | `03-story-live-desktop.webp` |
| **F2** | You operate it with one button | `GO LIVE (DEMO)` in the surface's own toolbar, the only solid-filled control before the chips arrive, subtitle `Going live on 3` | **6.2 s** | `02-story-formats-desktop.webp` |
| **F3** | One production, several shapes, worked out for you | The per-destination format labels reading `16:9`, `16:9`, `9:16` on the three tiles, plus `2 formats` in the status bar | **5.4 s** | `02-story-formats-desktop.webp` |
| **F4** | What viewers see is a Moment you tap | The six-card Moment strip under the stage, the active card's meta reading `Live now` once live | **first paint** | `01-landing-desktop.webp` |
| **F5** | One platform failing does not stop the others | One path strained and its chip reading `Live, rough`, then the path absent with a counting ring, while the other two never change | **14.0 s to 21.0 s** | `04-story-degraded-desktop.webp`, `05-story-healed-desktop.webp` |
| **F6** | It is free, open source, and runs on your machine | The status bar's persistent line, `Free. Open source. Runs on your machine.`, beside the `GitHub` item in the rail | **first paint** | `01-landing-desktop.webp` |

**Five of the six are carried by state on a surface, not by words.** Only F6 is a sentence, and
it is six words. The `e2e/experience.spec.ts` test *reaches LIVE on three destinations inside
thirty seconds, with nothing tapped* asserts F1, F3 and the count readouts mechanically; the
test *degrades one destination and brings it back* asserts F5.

A visitor who scrolls instead of waiting gets F1 to F4 from ACT 2 and ACT 3 faster than the
story delivers them, and F5 becomes something they cause rather than watch.

---

## 2. The cheap-website tests

Derived in `LIVETAP_VISUAL_DIRECTION.md` §7 directly from the directive's own verdict on the
previous site, one test per symptom it named.

### 1 · The text test ("too much text")

**Pass.** No run of prose longer than two lines anywhere on the page. Every string is a label, a
status, a value, a control, a hint or an empty state.

The longest strings on the surface are the chat panel's honesty note (`TikTok, Instagram and X
publish no live chat API, so nothing from them appears here.`, two lines at 340px) and the two
footer notes in ACT 8, which are legal and build-honesty small print. The largest type on the
page is never an argument: it is either the elapsed count the surface produced or the sentence
the surface is reporting about itself (`Live on YouTube, Twitch and TikTok`).

*Evidence:* `01-landing-desktop.webp`, `11-act5-multistream-desktop.webp`. Enforced by
`src/__tests__/landing-rules.test.ts` for the bans, and by the act copy's own two-line ceiling.

### 2 · The static test ("static sections")

**Pass.** At every scroll position something on screen is in a state that changed because of
scroll or because of a tap. The harness walked 61 positions across the ten sections and
reported **no dead scroll**; the only holds are declared, and they are declared through
`data-sc-verify-hold` on the surface rather than by exempting the sections.

Declared holds: REST A (0.7vh), REST B (0.6vh), the last 0.5 of ACT 6's span (the peak's own
resolution), and ACT 8 (the close resolves and stands still with content on it).

*Evidence:* `scrollcraft/builds/livetap-public/lab/shots/sheet.png` and `report.json`;
`07-rest-a-desktop.webp`, `12-rest-b-desktop.webp`.

### 3 · The feature-list test ("feature lists, cards on backgrounds")

**Pass, with the page's closest call named.** Zero bulleted feature lists. Zero three-up
feature-card grids used as page structure. Zero icon-plus-heading-plus-text cards standing in
for an argument. Every box on the page is the stage, a destination tile, a real control, a real
status readout, a Moment card, a Pro panel or the close's intent cards.

The closest call is ACT 8's six intent cards, which are a grid of cards with a glyph, a title
and three lines under it. They are the product's **own first-run control**, they appear once, at
the end, and picking one re-composes the fixed stage and changes where `Open LIVETAP` points.
A card you pick is not a card that holds content, which is the distinction the test is drawing.

*Evidence:* `16-act8-close-desktop.webp`, and the E2E test *the close is the real first question,
and it carries the answer into the app*.

### 4 · The depth test ("no depth")

**Pass.** Three independent planes are visible at every scroll position, and none of them is a
card floating on a background:

1. **behind the stage** , the atmosphere canvas (9 drifting bands and 24 carriers, nothing above
   5% of ink) plus the drawn signal field;
2. **the stage** , the reference plane, 100% contrast, the brightest and largest thing;
3. **in front of the stage** , six destination tiles that cross the stage's boundary by 12px,
   at 0.98 scale while `DISCONNECTED` and 1.00 once they are yours;

with the act band in front of all three and the chrome above that. Depth is carried by contrast
falloff, scale-as-state, overlap, a 1px edge light and exactly three elevation steps. There is
no `backdrop-filter` anywhere on the page and no zero-offset coloured halo.

*Evidence:* `08-act2-shelf-desktop.webp` (tiles overlapping the stage, paths behind them),
`13-act6-invite-desktop.webp`.

### 5 · The demonstration test ("weak product demonstration")

**Pass.** Every claim the page makes is demonstrated by an operable element within one screen of
the claim, because the claims are the surface's own status lines rather than marketing copy:

| The claim | The operable element, on the same screen |
|---|---|
| One production reaches several platforms | Six destination tiles you tap, each drawing its own path into the stage |
| LIVETAP works out the shape each one needs | The 16:9 / 9:16 / 1:1 control, which physically re-flows the stage and updates each tile's label |
| What viewers see is a Moment | The six-card strip, which recomposes the stage in place |
| One button operates it | `GO LIVE (DEMO)`, with a 3-2-1 countdown you can cancel with `Escape` |
| A platform failing does not stop the others | Drag a live tile off the stage yourself |
| There is real depth underneath | The `Pro` toggle, which adds four panels and moves nothing |
| Square is a canvas, not a destination | Tap `1:1` and read the surface's own answer |

*Evidence:* every test in `e2e/experience.spec.ts` under *the playgrounds*.

### C · The category-defining test

**Pass.** After the visit the visitor can name an action they performed that no other site let
them perform:

> I dragged YouTube off the stream with my mouse and everything else stayed live, then it pulled
> itself back.

Three input paths reach it, and all three go through the same state machine: the pointer drag
on a 44px grip, `Delete` on the focused tile, and the tile's own drop control (which is also the
touch and reduced-motion path). The claim the act exists to make is a test, not an intention:
`e2e/experience.spec.ts` samples every sibling tile's state, chip class, label, computed
transform, opacity, scale, bounding box, path geometry and stroke width **before, during and
after** the break, and asserts none of them changed.

*Evidence:* `13-act6-invite-desktop.webp`, `14-act6-resolved-desktop.webp`, and the tests
*dragging a live destination off the stage breaks exactly that one*, *the keyboard does the same
thing, on the same element*, and *an arrow nudge under the threshold strains the path and changes
nothing*.

---

## 3. The ten UI/UX priorities

| # | Priority | Result | Evidence |
|---|---|---|---|
| 1 | **Accessibility (critical)** | Real heading order (`h1`, the surface's `h2`, one `h2` per act), `aria-label` on every icon-only control, four live regions and no more (destination states `polite`, broadcast `assertive`, chat `role="log"`, tour `polite`), focus rings never removed, every playground keyboard operable. Contrast is measured on the composited page by the harness, which reports every graded cue clearing 4.5:1 at its worst frame in all three passes. Tab order was walked for 34 stops at 1440: it matches visual order region by region (chrome, then the surface's tiles in the destinations' own order, then the toolbar, the Moment strip and the chat log, then the act's own controls) and nothing reachable is parked at `opacity: 0` or `visibility: hidden`. | `lab/shots/report.json`; the E2E keyboard and reduced-motion tests |
| 2 | **Touch and interaction (critical)** | Every interactive element measured at 375, 834 and 1440: none under 44 x 44px. `touch-action: none` is scoped to the 44px drag grip and nowhere else. No hover-only affordance: every tooltip's content is also a metadata line or an `aria-label`. | E2E *is operable and does not scroll sideways at ...* measures every control at three widths |
| 3 | **Performance (high)** | One WebP plate, eager, with `width`/`height` set, and it is the LCP element. Every box on the first screen has a reserved size, including the 44px grip and drop slots on a tile that is not armed, so nothing reflows when the peak arms it. Landing JS **45.97 KB gzipped** against a 60 KB budget; landing CSS **14.34 KB gzipped** against 20 KB. | build output; `REPORT.md` |
| 4 | **Style selection (high)** | Dark cinematic control environment, consistent for the page's whole length, two `drift` stops inside one hue family. Icons are the app's own SVG paths, referenced from one inline sprite; a unit test re-extracts them from `packages/ui/src/components/Icons.tsx` and fails if the copy drifts. **No emoji anywhere**, asserted. | `src/__tests__/public-data.test.ts`, `landing-rules.test.ts` |
| 5 | **Layout and responsive (high)** | Breakpoints at 640 and 1025. Mobile is a different composition, not a compressed desktop: no rail, the status line reads above the picture so a signal path never crosses text, the tile row is a scroll-snap row with the 44px slots reserved inside each tile, the act band overlays the surface's lower edge on a plate instead of taking space from the stage, four duplicate panels instead of six, no atmosphere canvas, no parallax. **No horizontal scroll at 375**, asserted at five scroll positions. | `01-landing-mobile.webp`, `13-act6-invite-mobile.webp`; E2E |
| 6 | **Typography and colour (medium)** | The app's nine-step scale, unchanged, plus one display face (Archivo, one self-hosted subset woff2, `font-display: swap`, preloaded). 16px body at 24/16 leading. **No raw hex, `rgb()` or `hsl()` in the page stylesheet**, asserted; every colour is a `--lt-*` token or a `color-mix()` of one, so both themes come for free. No body text under 12px. | `landing-rules.test.ts`; `03-story-live-light.webp` |
| 7 | **Animation (medium)** | Seven named motion classes, all on the app's three durations and four easings, with two stated exceptions (the countdown, whose duration is the retry interval, and the release spring, which is a physical model). `transform`, `opacity`, `clip-path` and SVG stroke properties only; a test rejects any `transition` naming a layout property and any `transition: all`. `will-change` is added for the duration of a motion and removed after it. `prefers-reduced-motion` removes every position change and no information. | `landing-rules.test.ts`; the reduced-motion E2E tests; `lab/reduced/sheet.png` |
| 8 | **Forms and feedback (medium)** | The stream-key row is the app's own flow: a visible `<label>`, a hint naming what the value is, an error beside the field linked by `aria-describedby`, and no placeholder standing in for a label. The chaos prologue's duplicated fields carry visible labels too. Every action has an immediate visible response and an announcement. | E2E *a paste-key destination asks for the key first, in place* |
| 9 | **Navigation (high)** | The rail's four items are real anchors to the acts and take the app's 2px active edge; the highlight clears when its act leaves rather than naming a stale section. Deep linking works: `Open LIVETAP` points at `./app/start` and gains `?intent=` once a card is picked, and that route returns 200 through the same rewrites the host applies. Back behaviour is the browser's. | E2E *hands the visitor to the real onboarding route, and every link resolves* |
| 10 | **Charts and data (low)** | Not applicable: the page has no chart. The health readout carries a word (`Idle`, `Fair`, `Excellent`) and never colour alone. | `01-landing-desktop.webp` |

---

## 4. Colour, removed

The remove-most-colour test (`LIVETAP_VISUAL_DIRECTION.md` §4.3) is satisfied by construction
rather than by a screenshot override, and the reason is stronger than the override would have
been: every state on the page renders its own word from `STATE_LABEL` and its own dot treatment
from `DOT`, both copied from the product and both asserted against it. Flatten every state
colour and the page still reads `Not connected`, `Ready`, `Live`, `Live, rough`, `Reconnecting`,
`Ended`; it stays hierarchical, because the stage is the largest and brightest thing and the
chrome the quietest; and it stays operable, because every control keeps its 1px
`--lt-border-control` boundary.

The light theme is the honest version of the same test, and it is shipped rather than simulated:
`03-story-live-light.webp` is the same frame on the light palette.

---

## 5. What could not be verified here

- **LCP, CLS and INP as field numbers.** The structural work is done (one small WebP, eager,
  with its box reserved; no framework; every first-screen box sized), but no throttled trace was
  recorded, so no second is claimed. The budget numbers quoted above are transfer sizes from
  `vite build --reportCompressedSize`, which are measurements.
- **Forced colours.** The rules are written (`forced-color-adjust: none` paired with a border on
  the `LIVE` chip and the GO LIVE fill, `outline` for focus) but Windows High Contrast was not
  loaded.
- **A real device.** Mobile was verified at 390x844 and 375x812 in Chrome with the mobile
  composition active, not on a handset, so thumb reach and the URL bar's own behaviour are
  reasoned rather than felt.
- **The deployed URL.** Everything above was measured against the real production build served
  the way the host serves it, not against a Vercel deployment.
