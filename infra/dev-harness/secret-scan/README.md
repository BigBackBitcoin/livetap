# secret-scan — the credential harness

Three commands. Each answers one of §23's questions with an execution rather than a
reading, and each is written to fail loudly if it could not actually do the thing it
claims to have checked.

| Command | Answers |
|---|---|
| `npx vitest run --config infra/dev-harness/broadcast/vitest.config.ts` | can a credential reach a log line? (55 assertions: the redactor corpus, the two redactors' agreement, the shipped-source call-site scan, and the ownership decision for the two asymmetries) |
| `node infra/dev-harness/secret-scan/browser-storage-dump.mjs` | after a real paste in the real production build, what is in `localStorage`, `sessionStorage`, IndexedDB, Cache Storage and cookies? |
| `node infra/dev-harness/secret-scan/safestorage-probe.cjs` | is Electron `safeStorage` encryption usable on THIS machine, and is its ciphertext really ciphertext? |

The unit-level credential tests live with the code they test:

- `apps/desktop/src/main/oauth.security.test.ts` — loopback redirect form, state entropy, replay, timing
- `apps/desktop/src/main/ipc.security.test.ts` — the 22-channel surface, argument validation, what the renderer can reach
- `apps/desktop/src/main/vault.test.ts` — no plaintext fallback, atomic write, 0600
- `apps/web/src/state/credentialStorage.security.test.ts` — what reaches a web store, and the desktop vault contract
- `packages/adapters/src/oauth/pkce.security.test.ts` — S256 only, verifier entropy, downgrade
- `packages/adapters/src/oauth/scopes.security.test.ts` — every scope matched to a call site

`browser-storage-dump.mjs` needs `apps/web/dist`; run `npm run build -w @livetap/web` first.
It starts its own preview server on port 4183 and stops it again.

Nothing in this directory contains a real credential. The canaries are SHAPED like real
ones — `live_…`, `ya29.…`, `1//04…` — because the redactors match on shape, and a test
that uses `secret123` proves nothing.
