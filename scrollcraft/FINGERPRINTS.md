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
| `livetap-public` | Live surface | The product's own app chrome: an 88px labelled left rail plus a bottom status bar carrying live session state, both real enough to navigate with; no marketing bar | One fixed live surface, mounted at first paint and already telling its own 17-step story on its own clock, seen through a collapsing lattice of six duplicated control panels | `pin` > rest > `pan` > `pin` > `reveal` > `count` > rest > bespoke pointer > `parallax` > `tilt`; 8 acts plus 2 declared rests; 12.8vh; peak at 2.8 against a next-largest of 1.6 | The product's real first-run question, "What are you making?", with six operable intent cards that re-compose the fixed stage and hand the chosen intent to `/app/start` | Drag a `LIVE` destination off the stage with the pointer: its connection path strains and snaps, it counts down and heals, and no sibling flickers | Drawn signal field. No photography, no footage, no generated imagery; the product is the picture | Web, `/` in `apps/web`, dark default with a first-class light theme |

*(The first row was appended on 2026-09-12. The registry was empty before it, so the gate was
vacuously satisfied and is recorded as such rather than reported as a pass against a table that
did not exist. From the second build onwards, this table is the constraint.)*

---

## What is taken

Add a bullet here whenever a build claims something a later build should avoid
reusing: a grammar, a nav treatment, a close pattern, a signature move, an
act-count-and-length band. The shared columns are what the next build inherits
as a constraint, so writing them down is the whole point.

- **Live surface** as a grammar.
- **App chrome as nav**, specifically a labelled left rail plus a live status bar carrying
  session state.
- **The fixed-surface-plus-flow-markers structure**: one `position: fixed` product surface for
  the whole page, with the act stack driving it, rather than one pinned stage per act. The act
  band is the one region of the viewport the surface leaves free.
- **A collapsing lattice of duplicated controls** as a hero device, where each duplicate
  converges on the position of the surface's own single instance of that control.
- **A real first-run question as the close**, with the answer carried into the app as a query
  parameter.
- **Drag-to-break-a-live-destination** as a signature move, and per-item failure isolation as
  the peak.
- **The act-count-and-length band**: 8 acts plus 2 declared rests at 12.8vh with the peak at
  2.8.

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
