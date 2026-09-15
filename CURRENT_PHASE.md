# CURRENT PHASE

## REAL-WORLD ALPHA SHIP — in progress, 2026-09-15

The owner's words: **build me a usable LIVETAP app.** Install it, connect a real
account, use a real camera, tap GO LIVE, broadcast for real, survive a
destination failure, stop safely, and do it again. Simple frontend, complex
backend. The creator never has to understand RTMP, stream keys, OAuth scopes,
tokens, bitrate or codecs.

### The two things that changed today, and they are the two that mattered

**There is an installer.** `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe`,
230,661,718 bytes, with a verified FFmpeg inside it. electron-builder had been
configured for weeks and had never produced an artifact, and `resources/ffmpeg/`
held two README files — so a packaged app would have opened and reported
streaming UNAVAILABLE. `scripts/verify-installer.mjs` asserts thirty things
about the artifact itself, including that the shipped ffmpeg runs and that the
renderer inside is the real build rather than the demo one, checked through two
witnesses that have to agree. The packaged app was launched and opened on
"Step 1 of 3 — What are you making?".

**A real platform is reachable tonight, with nothing registered anywhere.** The
assumption that this waited on OAuth client ids and review queues was wrong.
Every priority platform publishes an RTMP ingest URL and a stream key in its own
studio page, copyable in about thirty seconds. Tapping YouTube on a real build
used to dead-end; it now opens a paste form with the server address already
filled in and asks for the one value only the creator has. What it creates is a
real YouTube destination wearing YouTube's own profile, not a generic one — its
aspect ratios, its bitrate ceiling, and its own honesty line, which for YouTube
is load-bearing because YouTube does not publish when video arrives.

### Four defects found by looking rather than by testing

1. **Every broadcast was mirrored.** Pulled a frame out of a real recording and
   read it: Chromium's test camera draws its timecode readable at top left, and
   ours had it backwards at top right. Any shirt, book, whiteboard or product
   label reached the audience reversed. Invisible on a green test pattern.
2. **LIVE was claimed too early.** The production went LIVE when the encoder
   started, not when bytes arrived, so a broadcast aimed at a server that was
   switched off showed a running clock and a live badge.
3. **A dropped destination could never come back.** Chromium emits a keyframe
   every 7.2 s; ffmpeg gives a late joiner a 5 s window to learn the stream. The
   reconnecting sender was mathematically unable to lock on. The GOP was also
   longer than Twitch permits.
4. **Desktop sign-in could never be read back.** The Electron vault answers with
   a result object and the renderer expected a string, so every stored token
   parsed as garbage and was swallowed. It type-checked because both consumers
   reach the bridge through a cast.

### The gate, as a command

```bash
npm run verify:broadcast
```

Three simultaneous publishers at 1920x1080, 1080x1920 and 1080x1080, from one
production, decoded back by ffprobe. Failure isolation confirmed on a real TCP
drop. Reconnect is newly asserted and newly fixed; re-verification is the next
thing that runs.

### What is still the owner's

`docs/OWNER_ACTIONS.md`. Nothing in the engineering plan waits on it, and the
first real broadcast does not either — that is what the paste path bought.
What the list buys is the nicer half: LIVETAP fetching the key itself so the
creator never sees one.
