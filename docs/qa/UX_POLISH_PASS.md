# UX polish, performance and consolidation pass

2026-09-15, on the build host. Every number here was measured on the date it
says, by a script that is in the repo, against the production build. Nothing in
this document is an estimate.

The brief was: stop making LIVETAP explain itself. Fewer words, less visual
bulk, intentional type and spacing, one owner per region, and real performance.

---

## 1. The wall of words, measured

Grepping JSX finds the copy that happens to be written as a string literal and
misses everything composed, interpolated or conditional, which is most of the
interesting copy. So `apps/web/scripts/copy-audit.mjs` walks the built app with
a real browser and reads what is actually on screen.

    node apps/web/scripts/copy-audit.mjs      # -> docs/qa/COPY_AUDIT_RAW.md

**659 words across five application routes.** The single worst finding was not
the total, it was the repetition.

### Studio's empty state said one thing five times

| words | element | text |
|---|---|---|
| 14 | `.lt-dock__none` | No destinations are switched on, so there is nowhere for this stream to go. |
| 15 | `li` (pre-flight item) | No destination is ready - that is the one thing LIVETAP cannot do for you. |
| 12 | `p` (prompt) | No destinations yet - LIVETAP needs one place to send your stream. |
| 5 | `.lt-preflight__headline` | Not ready to go live |
| 4 | `.lt-golive__subtitle` | No destination is ready |

Fifty words, five registers, and three separate "Add destination" links, for a
condition a creator can see at a glance from an empty dock and a GO LIVE they
cannot press. A first-time creator reads five statements as five problems.

**Now: one statement, four words, one control.** "Nowhere to send this yet"
with an `Add destination` button beside it. The dock renders an empty list as
nothing; the pre-flight row and the GO LIVE subtitle stand down when the prompt
beside them owns the message. The `aria-live` region stands down with them, so
a screen reader stops announcing the same condition three times too.

### Settings

- The Pro mode switch existed **twice on the same screen**, once in the shell
  on every route and once in a Settings card. Two authoritative controls for
  one piece of state: flip either and the other moves. The shell keeps it,
  because it is the one that is there on every route. The 29-word explanation
  went with the duplicate: what Pro mode does is visible the instant it is on.
- Appearance: 24 words about how theme inheritance works, now "Following your computer."
- Quality: 13 words, now "Auto adjusts while you stream."
- Recording: 39 words down to 12, keeping the part that is about the creator's
  own content and dropping the part that is about our implementation.

---

## 2. Things that were on the picture and should not have been

The program output must contain the production and nothing else. Two things
were sitting on it on the landing stage:

- a **duplicate** "Use my camera" button. The hero already has that control,
  and it already becomes "Stop my camera" when the camera is on.
- a 12-word privacy caption, over the exact pixels the product exists to show.

Both are gone from the picture. The caption is now four words under the frame;
the duplicate control no longer exists.

The real broadcast compositor was already correct here and stays correct:
`MomentCompositor`'s `operatorOverlay` defaults to **false** and no production
code sets it, so notices and placeholder plates are recorded for the UI to draw
beside the preview and never burned into the frames that reach viewers.

When the caption moved into the flow it pushed the line below it under the
toolbar, because `layout()` reserved height for the state lines and nothing
else. It now measures the note's own box, so anything added under the stage is
reserved rather than remembered.

---

## 3. Type: nine roles, three weights

`packages/ui/src/tokens.css` had a raw size scale, which says how big but never
what for, so two surfaces showing the same kind of text kept picking different
sizes. There are now nine named roles, DISPLAY, HERO, H1, H2, BODY, UI, META,
STATUS and BUTTON, each bundling size, line-height, weight and tracking into one
decision made once.

**Five weights became three.** 400 reads, 500 labels, 600 commands. 700 and 800
existed to make display type feel expensive and did not: a heavier weight at
48px reads as shouting, while tightened tracking at the same weight reads as
typeset. Seventeen call sites across seven files moved to 600 in one pass.

Uppercase is allowed in exactly one role, STATUS, where small, wide-tracked and
strong reads as a machine state rather than as a sentence, which is the
distinction a creator needs to make at a glance mid-broadcast.

`packages/ui/src/type-roles.test.ts` measures all of this from the stylesheet:
the nine roles exist, each has a size and a line-height and a weight, the
weights come from tokens and number no more than three, the published scale has
exactly three entries, uppercase appears once, and tracking tightens as size
grows. A fourth weight fails the build.

The status readout on the landing hero was HERO scale (36px), larger than the
page's own H1, and cost enough vertical space to clip the line beneath it. It
is H1 now. Nothing on that page is bigger than the headline.

---

## 4. `hidden` did not hide

The UA stylesheet's `[hidden] { display: none }` carries the lowest specificity
there is, so any rule that sets `display` beats it. Nearly every component here
sets `display`. **`hidden` was quietly doing nothing on most of them**, and
every resulting bug looked like a logic bug rather than a CSS one:

- the pre-flight row (`display: flex`) kept repeating a message the prompt above
  it had already made;
- the first-visit tour offer could not be dismissed;
- the first-use hint on the break act never retired.

One line of reset in `packages/ui/src/global.css` fixes all three.
`apps/web/e2e/landing-and-layout.spec.ts` now walks the real pages asserting
that nothing carrying `hidden` occupies space, and probes a `display: flex`
element directly. **Verified failing without the fix** (2 of 4 tests fail) and
passing with it, so the test can actually catch the regression.

---

## 5. GO LIVE could not look unavailable

`GoLiveButton` renders `aria-disabled` and never the `disabled` attribute,
deliberately, so the control keeps its place in the tab order and can announce
*why* it cannot be used. But the styling for the unavailable state was written
against `:disabled` alone, so it **never applied**. A creator with no
destination saw a full-strength red GO LIVE that did nothing when pressed.

Red was also the wrong colour for it. Red says something is going wrong right
now; a stream with nowhere to go is not wrong, it is incomplete, and saying
"error" about an empty setup sends a first-time creator hunting a fault they do
not have. The control is now inert and quiet when it is unavailable, and keeps
the live colour while a start is in progress, because that is busy rather than
unavailable.

---

## 6. Performance: 23.9 fps to 44.1 fps

The reported "22.5 fps with camera on, one 3402 ms long task" did not reproduce
at first: the landing page held **60.1 fps** at rest and 60.0 with the camera on
and the demo live. That number was taken while five agents were saturating this
host, which measures the machine, not the page.

So it was measured the way a creator would experience it, under CPU contention,
which is the normal condition for anyone running a multistreamer while their
machine also encodes video. The probe takes a `--throttle` multiplier and a
`--profile` flag; 4x is the conventional stand-in for a mid-range laptop.

**23.9 fps at a 4x CPU slowdown.** The original figure was real.

A CPU profile said where it went, and it was not where the canvas count
suggested:

| | before | after |
|---|---|---|
| frame rate (4x throttle) | **23.9 fps** | **44.1 fps** |
| `drawImage` self time over 8 s | **4,656 ms (55.7%)** | **1,993 ms (23.7%)** |
| longest main-thread task | **500 ms** | **244 ms** |
| idle | 9.0% | 13.3% |

Two causes, both structural:

**Every thumbnail resampled the full-resolution video independently.** Eighteen
canvases, one camera, and `cover()` called `drawImage` straight from the
`<video>` for each, at 10.6 ms per call, because each one was rescaling a
full-resolution frame down to a 352x198 thumbnail from scratch. The frame is
now rescaled **once per pass** into a shared scratch canvas and every consumer
smaller than it reads from that, which is the same shape as the real broadcast
pipeline: one composed picture fanning out to many encoders, rather than each
encoder compositing its own. Consumers larger than the scratch still read the
video directly, so the biggest picture on the page keeps full quality.

**Off-screen canvases were being composited for nobody.** The draw loop culled
on `hidden`, which answers "is this row switched off", not "can anyone see it".
Nine of the eighteen canvases were scrolled out of sight and being redrawn ten
times a second. An `IntersectionObserver` now gates them, rather than
`getBoundingClientRect`, which would flush layout twelve times a pass and trade
one waste for another.

At 1x, the page was and remains 60 fps.

---

## 7. The tour is offered once, and remembered

There was a tour, a checklist panel behind a button in the header rail, but
nothing offered it, and its progress lived in an in-memory `Set`. A visitor who
completed five of seven steps and reloaded was shown all seven again as if they
had done nothing, which is "never keep repeating the instructions" broken by a
page refresh.

- A first-visit offer now sits inline under the hero's own controls: **"New
  here? [Quick tour] [Skip]"**. Inline and not floating, because a fixed panel
  over the stage would be a second thing owning a region that already has an
  owner, and this page has an end-to-end test that fails when anything
  uninvited sits on top of a control.
- Either answer retires it permanently. So does opening the tour by any other
  route: nobody who has taken it should be asked again.
- Step progress persists, so the tour remembers what has been done.
- Nothing starts on its own and nothing is covered. A visitor who ignores the
  offer entirely has lost nothing, which is the test of whether an interruption
  was worth making.

The break act's permanent instruction became a **first-use hint**: it says the
one thing a visitor cannot guess, and it leaves the moment they have broken a
destination once, by any means. The act then demonstrates what happens instead
of describing it in advance, which was the point of the act. The keyboard route
is not part of that and never hides: for anyone not using a pointer it is not a
hint, it is the only way in, so it lives in a screen-reader line that stays.

---

## 8. What is not done

Stated plainly, because a polish pass that claims to be complete is the least
believable kind.

- **"GO LIVE (DEMO)"** was flagged for challenge and is unchanged. The
  parenthetical is redundant against the demo banner and the status bar, but it
  is also the label on the one control that starts a broadcast, and weakening a
  simulation signal is not a change to make casually or in a hurry. It needs a
  deliberate decision about which surface owns the demo statement.
- **The icon audit** was not run as a systematic pass. The icon set is already
  a single family at consistent sizes, and nothing in the screenshots showed
  the bulk the brief describes, but that is an observation rather than an audit.
- **Android and desktop device testing** still needs the owner's hardware. See
  `REAL_DEVICE_TEST_MATRIX.md`.
- **`npm run verify:engine -w @livetap/desktop`** still uses `ffmpeg -listen`
  rather than the MediaMTX receiver. It passes; it just proves less than the
  gate beside it does.
