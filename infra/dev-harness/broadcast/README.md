# LIVETAP dev-harness: the completion gate

The owner's alpha gate is one sentence:

> Install it, connect a real account, use a real camera, tap GO LIVE, broadcast
> for real, break one destination, watch the others stay live, and stop.

This directory turns the part of that sentence which does not need a camera, a
GPU or a platform account into a command with an exit code.

```bash
npm run verify:broadcast
```

## What it runs, and in what order

| Stage | What it proves | Who owns the piece |
|---|---|---|
| 1 | The receiver is honest, with no product involved: a synthetic H.264 + AAC push arrives, decodes live, records to disk, and a deliberate TCP kill reaches the encoder | `../ingest/selftest.mjs` |
| 2 | A real RTMP server is listening on `127.0.0.1:1935` | MediaMTX, started and stopped here |
| 3 | The built Electron app captures through the real `getUserMedia`, composes one picture per aspect ratio, encodes, and publishes two real RTMP streams; one is dropped at the TCP level mid-broadcast and the other keeps climbing; END clears both; `ffprobe` decodes what landed on disk | `apps/desktop/e2e/broadcast.mjs` |
| 4 | END is not conditional on the studio screen staying mounted: press END, leave for another route, and the publishers are still gone | this script |

Stage 3 shells out to the driver that lives with the app rather than driving
the UI itself. There must be exactly one set of studio selectors in this repo.
Two would eventually disagree about what the product looks like, and the day
they disagree is the day the evidence stops being evidence. This script owns
the chain, the receiver's lifetime and the verdict; the driver owns the UI.

## Reading a failure

The script distinguishes two kinds of failure on purpose, because while
several workstreams are landing code at once they mean completely different
things.

```
MISSING  the desktop app is not built: apps/desktop/dist/main/index.cjs is missing
         fix: npm run build -w @livetap/desktop

FAIL  the chain could not run, so nothing about LIVETAP was proven or disproven here.
```

`MISSING` means a piece of the chain is absent and nothing was tested. It
always names the exact path or binary and the command that supplies it.

```
  FAIL     END survives leaving the studio   1 publisher(s) were still connected 12 s after END
```

`FAIL` means the piece was there and the product did not do what it claims. The
summary table at the end lists every stage with its own verdict, so a red run
says which link broke rather than only that the chain did.

## Flags

| Flag | Why |
|---|---|
| `--seconds=<n>` | how long to hold the broadcast open, default 12 |
| `--quick` | skip stage 1. Use it when you have just run the self-test and are iterating on the product |
| `--skip-grace` | skip stage 4 |
| `--keep` | leave MediaMTX running afterwards, so you can inspect the control API |

## What is not in this directory

`secret-log.test.mjs` is here but is not part of the chain above. It is the
gate that fails if an access token, a refresh token, a client secret or a
stream key can reach a log line, and it runs under `npm test` because a leak
must be caught on the commit that introduces it, not on the next full
broadcast run. It asks three questions: whether both redactors mask a
realistic credential in the realistic shape it travels in; whether the two
redactors' field lists agree; and whether any shipped source file logs a
credential-bearing value without a redactor around it. Its call-site detector
is itself proven against the two leaks the 2026-09 security review found, so a
clean scan means the scan works rather than that the pattern stopped matching.

Nothing in this directory handles a platform credential. The only "stream key"
it knows is a MediaMTX path name on an unauthenticated loopback server.
