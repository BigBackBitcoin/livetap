# CURRENT PHASE

## REAL-WORLD PERSONAL ALPHA — in progress, 2026-09-14

The mission, in the owner's words: **make LIVETAP real.** Install it on Windows
and Android, connect real accounts, use a real camera and microphone, tap GO
LIVE, broadcast for real, break one destination, watch the others stay live,
and stop. Simple frontend, complex backend. The creator never has to understand
RTMP, stream keys, OAuth scopes, tokens, bitrate or codecs.

Plan: `.scratch/plan.md`. Six workstreams, all running in parallel, none of
them blocked on the owner.

### Where it actually stands

**A real broadcast happened.** 2026-09-14 12:43: the built desktop app,
driven through its own UI, captured through the real `getUserMedia`, composed
one canvas per aspect ratio, encoded with Chromium, muxed with real ffmpeg and
published two simultaneous RTMP streams at 1920x1080 and 1080x1920 that a real
server accepted and ffprobe independently decoded as H.264 plus AAC. One was
dropped at the TCP level mid-broadcast and the other kept climbing. END cleared
both. Nothing in that chain was mocked.

**It does not reproduce on a rebuild**, and the reason is two lines in two
files that belong to two other workstreams. Both are named exactly in
`docs/qa/REAL_WORLD_ALPHA_READINESS.md`, under "the regression".

**And behind that sits the one defect that matters more than any schedule.**
With mock mode turned off by hand, both destinations reach Ready, the
real-broadcast confirmation appears, and after confirming the app reports
`Live`, `live on 2 of 2`, `You are live on 2 destinations`, with both cards
reading "Sending to this destination" — while the server reports **zero
publishers**. A LIVE badge with no bytes on the wire is the worst thing this
product can ship, and it is invisible in every build anyone currently runs,
because mock mode is on everywhere and a mock LIVE with no bytes is correct.
Reproduced twice, not diagnosed. It is item zero in HANDOFF.md.

### The gate, as a command

```bash
npm run verify:broadcast
```

Two of seven gate items pass today, one fails, one is untested here, one is
untested by anyone, and two are the owner's hardware. The full item-by-item
account is `docs/qa/REAL_WORLD_ALPHA_READINESS.md`.

### What the owner should do, once, when they have an afternoon

`docs/OWNER_ACTIONS.md`. Every console step, every value, every redirect URI
and scope, in the order to do them, with what each one unblocks. About two and
a half hours. Start with Twitch: ten minutes, no review, no queue, and it is
the fastest path from UNVERIFIED to PASS on the platform matrix.

Nothing in the engineering plan waits on it.

### Previous phase

AUDIT CLOSURE (directive docs/prompt-pack/11) delivered 2026-09-14 and deployed
to https://livetap.vercel.app, with a Scroll Craft pass the same day. Closure
matrix: `docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md` (33 of 34
actionable items closed). Retest:
`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_RETEST.md`.
