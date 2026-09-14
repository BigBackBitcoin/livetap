# Pending workflows

These GitHub Actions workflows are complete but could not be pushed from the build host: the
available GitHub token has `repo` scope only, and GitHub refuses to create or update files under
`.github/workflows/` without the `workflow` scope.

Human action (one time, about a minute):

```bash
gh auth refresh -h github.com -s workflow
git mv .github/workflows-pending/*.yml .github/workflows/
git commit -m "ci: enable GitHub Actions workflows" && git push
```

---

## What CI gates, and what it cannot

Worth knowing before treating a green CI badge as evidence that LIVETAP works.

| Gate | Runs in CI | Why |
|---|---|---|
| `npm run typecheck` | yes | |
| `npm run lint` | yes | |
| `npm test` (1293 tests, including the fake-IdP harness and the proof harness) | yes | |
| **No credential can reach a log line** | yes, as its own job | needs no server and no browser. A red CI names this failure instead of burying it |
| `npm run build:web` | yes | |
| Playwright e2e, mock mode | yes | |
| Unsigned desktop packages | yes, on the windows and macos runners | signing needs B-004 |
| **`node infra/dev-harness/ingest/selftest.mjs`** | **no** | needs the MediaMTX binary, which `tools/` deliberately does not commit |
| **`npm run verify:broadcast`** | **no** | needs MediaMTX, a built Electron app and a display. This is the gate that proves a real broadcast, and it is a command a human runs |

The consequence is worth stating plainly: **CI cannot tell you whether LIVETAP
broadcasts.** It tells you the code compiles, the unit tests hold, the app
builds and no credential can reach a log line. The question the product is
actually about is answered by `npm run verify:broadcast` on a machine, and by
the owner on their own machine with their own camera.

What CI genuinely unblocks that nothing else does is the **free macOS runner**,
which is the only route to a macOS build or an iOS archive without buying a
Mac. Every macOS and iOS claim in this repository is unverified until one runs.
