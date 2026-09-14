# Fingerprints

Every site you build with **scrollcraft** gets one row here, appended after it
ships. The registry exists so your next build can prove it is a different page
rather than a re-skin of one you already made.

This file is **yours**. It starts empty on purpose: the gate is about not
repeating *yourself*, so it has nothing to say until you have built something.

The rules and the gate live in the skill's
`references/uniqueness.md`. Short version:

**A new build must differ from EVERY row below on at least 4 of the 6
dimensions.** Four against each row individually, not four on average across the
table. If a planned build fails, change the plan. Never edit a row to make room
for it.

The six dimensions are: **grammar**, **nav treatment**, **hero device**,
**act-sequence shape**, **close pattern**, **signature move**.

Dimension 6 is free, because a signature move is unique by definition. So the
gate really asks for three more out of the remaining five, and a build that
changes only grammar and world will fail it.

---

## The registry

| Build | Grammar | Nav treatment | Hero device | Act-sequence shape | Close pattern | Signature move | World | Port |
|---|---|---|---|---|---|---|---|---|
| `livetap-public` | Live surface | The product's own app chrome: an 88px labelled left rail on desktop / a top row plus a bottom status bar carrying live session state on phones, both real enough to navigate with; no marketing bar | One fixed live surface, mounted at first paint with a real sample picture already playing on the stage and nothing covering it; a 4.2s guided demo (mic on, three destinations to `READY`) hands over to the visitor with "Your turn" | Eight chapters plus two declared silences, 12.6vh, seven device families (`pin`, `flow`, `reveal`, `pan`, `count`, `flow`+`in`, pointer `tilt`); the peak is a cold open, second on the page, `pin`, span 2.8 against a next-largest of 1.8, ahead of a descent that carries its own device shape (a reveal, a pan, a count, a staggered flow, a reveal) rather than repeating the peak's device | The product's real first-run question, "What are you making?", with six operable, pointer-tilting intent chips that re-compose the fixed stage and hand the chosen intent to `/app/start` | Drag a `LIVE` destination off the stage with the pointer, tap one band button, or press Delete: its connection path strains and snaps, it counts down and heals, and no sibling flickers | Real sample footage: a generated creator clip and a guest clip stand in for the visitor's own camera, plus one drawn screen asset. No stock photography, no photography of anything but the product's own demo picture; the product is the picture | Web, `/` in `apps/web`, dark default with a first-class light theme |

*(The row was first appended on 2026-09-12, when the registry was empty and the gate was vacuously
satisfied. It was updated in place on 2026-09-14 after an independent first-time-creator audit
(`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md`, score 59/150) drove a rebuild of the same page at the
same URL: the hero device, the act-sequence shape and the world changed; the grammar, the nav
treatment, the close pattern and the signature move did not. It was updated in place a second time,
later the same day, after the owner read that rebuild and said the spacing and flow seemed off: the
rebuild had traded every scroll device but `pin` and `flow` for a performance win, and the result read
as one section shown eight times. This second update restores five device families to five chapters
without reopening the choreography that caused the original jam, so only the act-sequence shape's own
description changes again; the grammar, the nav treatment, the hero device, the close pattern and the
signature move still do not. Both updates are revisions of one build, not a second or third build, so
the row was replaced each time rather than appended again, see `docs/design/LIVETAP_SCROLL_STORY.md`
§8 for the reasoning. From the next genuinely new build onwards, this table is the constraint.)*

---

## What is taken

Add a bullet here whenever a build claims something a later build should avoid
reusing: a grammar, a nav treatment, a close pattern, a signature move, an
act-count-and-length band. The shared columns are what the next build inherits
as a constraint, so writing them down is the whole point.

- **Live surface** as a grammar.
- **App chrome as nav**, specifically a labelled left rail (or top row on phones) plus a live
  status bar carrying session state.
- **The fixed-surface-plus-per-act-band structure**: one `position: fixed` product surface for
  the whole page, with a transparent act stack driving it and each chapter's own band living
  inside that chapter's own act, gated by the engine's own cue (opening at 0.02 of the chapter's
  travel, closing at 0.95, with ramps either side) rather than by a single shared band or a
  scroll-position listener deciding visibility. The band is still the one region of the viewport
  the surface leaves free; what changed since this bullet was first written is which mechanism
  opens and closes it. (This bullet has already been revised once: the build's first version put
  every chapter's band in one fixed layer cross-faded by a listener, and that structure read as
  one section shown eight times when the owner reviewed it. A future build should take from this
  that a single shared narration layer is not itself a safe fingerprint to copy, regardless of
  how cheaply it scrolls.)
- **A real picture on the stage from first paint**, standing in for the visitor's own camera
  until they grant it, as a hero device. (Superseding the first version's collapsing lattice of
  duplicated controls, which this build no longer uses and which should not be reused as a
  fingerprint by a future build.)
- **A short, clock-driven guided demo that hands over fast** (this build: 4.2s) rather than a
  long automatic story, as a hero pattern.
- **A real first-run question as the close**, with the answer carried into the app as a query
  parameter, and its intent chips tilting toward the pointer as a small close-specific device.
- **Drag-to-break-a-live-destination** as a signature move, with a one-tap non-pointer
  alternative, and per-item failure isolation as the peak.
- **A cold-open peak**: the signature move placed second on the page, immediately after the
  hero, ahead of a descent that carries its own device shape (a reveal, a pan, a count, a
  staggered flow, a reveal) rather than repeating the peak's own device six more times.
- **The act-count-and-length band**: 8 chapters plus 2 declared silences at 12.6vh with the peak
  at 2.8, across seven Scroll Craft device families (`pin`, `flow`, `reveal`, `pan`, `count`,
  `flow`+`in`, pointer `tilt`).
- **Uniform `pin` with no other Scroll Craft device is no longer true of this build and is not a
  fingerprint to take from it.** An earlier version of this build removed `pan`, `reveal`,
  `count`, `parallax`, `drift` and pointer `tilt` entirely after an audit found their combined
  scroll-linked cost jammed the page's main thread; that trade shipped, passed its own
  performance gate, and still read as flat and repetitive once a person looked at it, so it was
  reversed for five of those six families on the next pass. What a future build should take from
  this history is not "uniform `pin` is safe" or "uniform `pin` is unsafe," it is that **any
  scroll-linked device's cost should be measured directly** (this build's own gate is
  `apps/web/e2e/audit-closure.spec.ts`'s long-task budget) **before it ships, whether that cost
  comes from one device family repeated or several used once each.** `parallax` and `drift` stay
  cut in this build for reasons unrelated to that performance trade, recorded in
  `docs/design/LIVETAP_VISUAL_DIRECTION.md` §2.1 and §4.6.

---

## Appending a row

After shipping, add one line to the table and one bullet to **What is taken** if
the build claimed something new. Fill every column. Say what the build shares
with existing rows.

Rows are append-only. A build that has been superseded stays in the table,
because the space it occupies is still occupied.

---

## Worked example

The skill's author kept a registry of twelve builds across eight page grammars.
If you want to see what a filled-in table looks like, and which shapes tend to
collide, read `EXAMPLES.md` in the scrollcraft repository. Treat it as
illustration only: those rows are somebody else's builds and they do **not**
constrain yours.
