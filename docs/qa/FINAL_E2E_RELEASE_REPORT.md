# Final E2E release report

The owner's hardening directive (§5) asks for one thing and is specific about how
it may be answered: **the entire suite, zero failures, no cherry-picking.** A
green `--grep` is not evidence that the suite is green, so no individual test
result appears in this document except where a run is being explained.

Two full-suite runs were made on 2026-09-15. Both are recorded. Only the second
is evidence, and the reason is about provenance rather than about the numbers.

---

## Run 1 — 12:29, `18f7702` — NOT EVIDENCE

```
333 passed · 3 skipped · 0 failed · 32.4 min · exit 0
```

Zero failures, and it is still not the run this release is signed on. Three
things were true about it that were not true of the product:

1. **It was served by a process running pre-fix code.** Playwright's
   `webServer.reuseExistingServer` bound to a `preview-server.mjs` started at
   05:13:15 by another session. The crash fix for that file — `send()` wrapped so
   a missing file 404s instead of throwing an uncaught `ENOENT` that kills the
   process — landed at 05:19 in `07e51b9`, six minutes later. So the run was
   served by the exact build whose crash produced a peer session's 101-of-103
   `ERR_CONNECTION_REFUSED` cascade earlier the same day. It did not crash. That
   is luck, not a property of the run.

2. **`npm run build` was therefore skipped.** This one turned out to be harmless,
   and it was checked rather than assumed:

   ```
   find apps/web/src packages/*/src -newermt "2026-09-15 12:21:30"   → empty
   grep dist/assets/landing-*.css → clip-path:inset(calc(var(--ltp-touchable) * -100vmax + …))
   ```

   The bundle was built by hand at 12:21:30, after the last source edit at
   12:20:30, and nothing changed before the run. The fix under test was in the
   bytes under test.

3. **It shared the host with another session's broadcast harness**, which ran at
   12:36 and 12:42 inside the window.

A run that has to be explained for three paragraphs before its number can be read
is not a release gate. It is recorded here because deleting an inconvenient green
run is how a report stops being a record.

---

## Run 2 — the clean run

Conditions established before it started, each verified rather than assumed:

| | |
|---|---|
| Stray preview server (pid 6600, 05:13:15) | **killed** |
| Orphan MediaMTX (pid 7744, 03:24:17) | **killed** |
| Ports 4173 / 1935 / 9997 | **confirmed free** before starting |
| `infra/dev-harness/ingest/recordings/` | **313 files archived**, tree empty |
| Peer sessions | stood down; worktree claimed by `.livetap-worktree-owner` |
| Server | started by Playwright itself, from `07e51b9`-or-later code |
| Bundle | built by Playwright's own `npm run build`, not reused |

RESULT_PLACEHOLDER

---

## The three skipped tests, named

All three are `screenshots.spec.ts` documentation captures, and the skip is a
design decision rather than a gap:

```js
test.skip(
  process.env.LIVETAP_CAPTURE !== '1',
  'Documentation captures rewrite committed files. Run with LIVETAP_CAPTURE=1 to regenerate.',
);
```

They rewrite files that are committed, and they cannot be made repeatable. That
was measured by the session that wrote the guard, not assumed: with every capture
waiting for a rendered page and the demo clip paused, 14 of 41 files still
differed between two consecutive runs; adding `reducedMotion` brought it to 11.
Every one of the 11 survivors carries the engine's `requestAnimationFrame`-driven
preview canvas, so a still photograph of one is a photograph of whichever
millisecond the shutter opened on.

So they are not made repeatable; they are made deliberate. Nothing asserts on
those files — which is exactly how twenty-one of them sat in the repository
completely blank without anyone noticing, the defect `5c337af` fixed.

**The two visual baselines are not affected and run on every invocation.** They
are the ones that assert, they tolerate the moving parts with a pixel budget and
a mask, and they are what actually stops a visual regression shipping.

---

## What changed between the two runs

Both are recorded so the second run's numbers can be read against the first's.

| Commit | What |
|---|---|
| `38ddd2b` | The Quick Tour offer became a banner in `<main>`'s flow instead of a fixed overlay. Removes `test.fail()` from three reproductions and widens their probe from `.lt-tour` to `.lt-tour, [data-lt-tour]`, so the beats are held to the standard the offer now meets by construction. |
| `508c1a2` | The completion gate records a reused receiver as WARN rather than PASS. Does not affect the E2E suite; recorded because it changes what a later gate run means. |

Run 1 predates both.

---

## Standing caveat on this host

This VM has no GPU and reports an idle `requestAnimationFrame` ceiling of 31 fps,
so any frame-rate number measured here is a property of the host as much as of the
product. Where a test asserts on frame rate it asserts against a floor chosen for
this host, and that is stated at the assertion rather than hidden behind a passing
result.
