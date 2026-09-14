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
| `livetap-public` | Live surface | The product's own app chrome: an 88px labelled left rail on desktop / a top row plus a bottom status bar carrying live session state on phones, both real enough to navigate with; no marketing bar | One fixed live surface, mounted at first paint with a real sample picture already playing on the stage and nothing covering it; a 4.2s guided demo (mic on, three destinations to `READY`) hands over to the visitor with "Your turn" | Eight `pin` acts and one declared rest, no other device anywhere on the page; 12.4vh; the peak is a cold open, second on the page, span 2.4 against a next-largest of 1.6, ahead of a descending explanation (Shapes, Moments, Outputs, Versus, Pro) | The product's real first-run question, "What are you making?", with six operable intent chips that re-compose the fixed stage and hand the chosen intent to `/app/start` | Drag a `LIVE` destination off the stage with the pointer, tap one band button, or press Delete: its connection path strains and snaps, it counts down and heals, and no sibling flickers | Real sample footage: a generated creator clip and a guest clip stand in for the visitor's own camera, plus one drawn screen asset. No stock photography, no photography of anything but the product's own demo picture; the product is the picture | Web, `/` in `apps/web`, dark default with a first-class light theme |

*(The row was first appended on 2026-09-12, when the registry was empty and the gate was vacuously
satisfied. It was updated in place on 2026-09-14 after an independent first-time-creator audit
(`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md`, score 59/150) drove a rebuild of the same page at the
same URL: the hero device, the act-sequence shape and the world changed; the grammar, the nav
treatment, the close pattern and the signature move did not. This is a revision of one build, not a
second build, so the row was replaced rather than appended a second time, see
`docs/design/LIVETAP_SCROLL_STORY.md` §8 for the reasoning. From the next genuinely new build onwards,
this table is the constraint.)*

---

## What is taken

Add a bullet here whenever a build claims something a later build should avoid
reusing: a grammar, a nav treatment, a close pattern, a signature move, an
act-count-and-length band. The shared columns are what the next build inherits
as a constraint, so writing them down is the whole point.

- **Live surface** as a grammar.
- **App chrome as nav**, specifically a labelled left rail (or top row on phones) plus a live
  status bar carrying session state.
- **The fixed-surface-plus-fixed-band structure**: one `position: fixed` product surface for the
  whole page, with a transparent `pin`-only act stack driving it and one fixed band layer
  cross-faded by a single passive scroll listener, rather than per-act Scroll Craft cue
  choreography. The band is the one region of the viewport the surface leaves free.
- **A real picture on the stage from first paint**, standing in for the visitor's own camera
  until they grant it, as a hero device. (Superseding the first version's collapsing lattice of
  duplicated controls, which this build no longer uses and which should not be reused as a
  fingerprint by a future build.)
- **A short, clock-driven guided demo that hands over fast** (this build: 4.2s) rather than a
  long automatic story, as a hero pattern.
- **A real first-run question as the close**, with the answer carried into the app as a query
  parameter.
- **Drag-to-break-a-live-destination** as a signature move, with a one-tap non-pointer
  alternative, and per-item failure isolation as the peak.
- **A cold-open peak**: the signature move placed second on the page, immediately after the
  hero, ahead of a descending explanation of the rest of the product.
- **The act-count-and-length band**: 8 `pin` acts plus 1 declared rest at 12.4vh with the peak
  at 2.4.
- **Uniform `pin` with no other Scroll Craft device**, as a deliberate performance trade: this
  build removed `pan`, `reveal`, `count`, `parallax`, `drift` and pointer `tilt` entirely after
  an audit found their combined scroll-linked cost jammed the page's main thread. A future build
  chasing device variety should measure its own scroll-linked frame cost before adding any of
  them back.

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
