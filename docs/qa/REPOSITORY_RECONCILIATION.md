# Repository reconciliation — 2026-09-15

Written because the owner's final hardening directive opens with a rule this
repository was breaking: **one active autonomous owner of this worktree.** Three
sessions were sharing this checkout and at least two of them were committing.

This page records what was found, what was kept, what was rejected, and why.
Nothing was reset, and nothing was discarded without being read first.

---

## State at the moment of reconciliation

| | |
|---|---|
| Branch | `main` |
| HEAD | `4e345b0fc822f16ebd4bb2dbcc794f144f915d1b` |
| Remote | 26 commits ahead of `origin/main` — nothing pushed |
| Working tree | 30 modified screenshot baselines + `apps/web/e2e/screenshots.spec.ts` |

## Why authorship could not be read from git

Every session on this machine commits as `Crypto Jam <cryptojam@local>`, so
`git log` cannot separate them. The separation below is by **knowledge**: this
session knows which commits it wrote, and the rest are the other sessions'.
`mcp__ccd_session_mgmt__list_sessions` confirmed three sessions with
`cwd = C:\Users\Administrator\Desktop\LIVETAP`, one of them still running.

---

## Commits this session authored

`dc5292b` · `ad5f81a` · `79e3f43` · `6c6d424` · `d255ceb` · `b91c8eb` ·
`9a6afd4` · `db22f2b` · `471d998` · `07e51b9`, and the ~16 before them in
this run. All retained.

---

## Commits this session did NOT author

### `a3d2384` — "the two assertions that outlived the design they described"

**RETAINED.** Two files: one assertion string in `experience.spec.ts`, and the
landing visual baseline.

- `'No destination here asks for it'` → `'No destination here asks for square'`.
  The stage detail line stopped restating the intent profile's own title, which
  is on screen in its own control. The claim under test is unchanged: no platform
  here accepts a square and the surface says so rather than faking one.
- The landing baseline was regenerated after reviewing the diff image. Every
  difference is traceable to a deliberate change this session made: the headline
  at weight 600 instead of 800 (the scale went from five weights to three), the
  first-visit tour offer, and the status readout dropped from HERO to H1.

**Verdict:** correct, and it is the right kind of baseline update — the diff was
looked at rather than accepted blind. No product assertion was weakened.

### `4e345b0` — "two adversarial tests that described a product that had changed"

**RETAINED.** One file: `adversarial.spec.ts`.

- `/Add destination/` no longer matches the Destinations screen's empty state,
  whose button reads "Add your first destination" — the duplicate header button
  was removed so one action has one control. Four call sites were timing out on a
  screen that worked. Hoisted to one `ADD_DESTINATION` constant.
- `the countdown can be stopped by the control that started it` clicked Cancel
  ~50 ms after the countdown appeared. **That is now deliberately refused**: this
  session added a 450 ms settle window to `GoLiveButton` because the Cancel
  control takes over the exact pixels GO LIVE just occupied, and the second tap
  of a nervous double-tap was silently killing the broadcast (blind audit 3,
  defect 2). A cancel at 50 ms is indistinguishable from that second tap. The
  test now waits 600 ms and still asserts the cancel works.

**Verdict:** correct, and it is the honest adaptation rather than a weakening —
it still proves the control can stop what it started. Had it simply deleted the
assertion, it would have been rejected.

---

## Uncommitted work found in the tree

`apps/web/e2e/screenshots.spec.ts` + 30 baseline PNGs, timestamped minutes before
this reconciliation.

**RETAINED, and it is the most valuable find of the three.** It reports that
**21 of the screenshots committed to this repository were blank** — every
`destinations`, `moments`, `not-found`, `privacy`, `recordings`, `settings` and
`terms` capture at all three widths — because `page.goto()` resolves on `load`
and these are client-rendered routes, so the picture was taken before React had
put anything on screen. Nothing caught it because these captures are artefacts,
not assertions: nothing compares them to anything, so a photograph of an empty
page passes exactly as well as a photograph of the product.

The fix waits for a visible `h1` (every captured screen has exactly one), awaits
`document.fonts.ready` so the capture is not of the fallback typeface, and pauses
the video so the page is still.

**Verdict:** kept in full. This is exactly the class of defect this project keeps
finding by looking rather than by testing.

---

## Rejected

Nothing. All three bodies of work were inspected and all three are compatible
with, and in two cases directly adapted to, changes this session made.

---

## Ownership from here

`.livetap-worktree-owner` now names the owning session. A message was sent to the
running peer asking it to stand down and telling it, specifically, that its work
is retained — because the failure mode to avoid is not a merge conflict, it is a
session deleting another's work to make its own gates go green.

**If you are an agent reading this and you are not the session named in that
file: do not commit here.**

---

# Second reconciliation — 2026-09-15, 18:00Z

A fourth session (`LIVETAP autonomous product build (fork)`) claimed this
worktree at 17:31Z and committed three times while this session was mid-turn
running Electron broadcast gates. It has since stood down and disclosed
everything below itself, unprompted.

## How the ownership check failed, and what to change

It followed the procedure this document recommends: before claiming, it ran
`list_sessions` and saw **both** LIVETAP sessions reporting `isRunning: false`,
last activity 13:05:44 — matching commit `06941fe` exactly. It read that as a
handover.

It was wrong, and the procedure was wrong, not the session. **A liveness probe is
not a handover signal.** `isRunning: false` means "not in an API call this
instant", which is true of any session between tool results — this one was
running a 12-second broadcast at the time. The rule is now explicit:

> Handover is `.livetap-worktree-owner` changing hands DELIBERATELY, written by
> the OUTGOING owner. An incoming session may not promote its own inference of
> absence into a claim. If the file names someone else, ask them.

## What it did, in its own account and verified here

| Commit | In the release surface? | Verdict |
|---|---|---|
| `9d27e96` | No — `packages/bond/**`, docs, and the owner file | **RETAINED** |
| `9c99f9c` | No — `packages/bond/**`, `infra/dev-harness/bond/**`, docs | **RETAINED** |
| `8da2e84` | **Yes** — `apps/desktop/**`, `package-lock.json` | **RETAINED**, verified below |

`8da2e84` is the only one that reaches what ships. Its claim was that absent a
`viaBond` output and absent a relay config, not one line of the new branch runs.
Checked rather than taken:

```
grep -rn "viaBond" apps packages            → 3 hits, all DECLARATIONS:
                                                FfmpegEngine.ts:276 (the guard)
                                                FfmpegEngine.ts:404 (the guard)
                                                ipc.ts:75           (the optional field)
grep -rn "bond:" apps/desktop/src           → 1 hit, a private field initialised to null
```

Nothing in the product sets either. The branch is unreachable outside that
session's own harness.

**Verified after the fact, against current HEAD with Bond compiled in:**

```
npx tsc -b            clean
npx eslint .          clean
npx vitest run        1712 passed / 97 files
broadcast.mjs                       exit 0, 23 checks, three shapes on the wire
broadcast.mjs --no-fake-camera      exit 1, 0/3 publishers
```

The control passing identically with Bond linked in is the evidence that the
broadcast path is unchanged. The no-camera failure reproducing identically is the
evidence that `f0aeb75`'s finding is about the product and not about that build.

## What it cost, recorded because it was real

It rebuilt `apps/desktop/dist/renderer` and ran the full completion gate at
roughly 14:00–14:25 local, after being asked not to. It disclosed this itself and
said to treat any gate result of this session's from that window as unsound.

Checked: this session's broadcast evidence was written 13:40:55–13:47:12, before
that window opened, and has since been re-run from scratch above anyway. **No
result in this release rests on that window.**

## Standing position

The Bond work is real — `tsc` clean, `eslint` clean, 186 package tests inside
1712 — and it closes the gap the independent audit scored at 10%: a workspace
package with no dependents. It is also item 8 of 8 on that audit's own
shortest-path list, behind an OAuth client id, the relay deployment, a P0, two
artifact rebuilds and a phone test. It is retained, it ships dormant, and it is
not what this release is signed on.
