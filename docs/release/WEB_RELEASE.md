# Deploying LIVETAP on the web

The desktop and Android surfaces each have a release runbook and a verifier that
refuses a bad build. The web surface — the one most people actually reach — had
neither. This is it.

There are **two** web builds and they are not the same product. Deploying the
wrong one is the single most likely way to ship something that looks finished
and broadcasts nothing.

| | Demo build | Production build |
|---|---|---|
| `VITE_LIVETAP_MOCK_MODE` | `true` (the default) | `false` |
| Adapters | simulated | real platform adapters |
| Engine | simulated | `BrowserEngine`, real WebRTC |
| Relay | not needed | **required** |
| Landing page | says it is a demo, in its own voice | says nothing about demos |
| Can it broadcast? | no, and it tells you | yes |

Mock mode being the default is deliberate (ADR-007) and is not a bug to fix: a
demo that says it is a demo is honest. What is not acceptable is a deployment
that *claims* to be real and cannot broadcast — which is what happens if you set
`VITE_LIVETAP_MOCK_MODE=false` and stop there.

## Why a relay is not optional

A browser has no RTMP socket. It cannot reach YouTube, Twitch or Kick directly
however correct the stream key is. So every RTMP destination on the web is
published through a relay: the browser sends the destination list to the relay's
session API once, over TLS, receives a WHIP URL back, and publishes WebRTC to
it. The stream keys then live server-side for the length of the broadcast and
the browser holds a URL that is useless to anyone who steals it afterwards.

With no relay configured, `BrowserEngine` refuses every RTMP output with
`CONFIG_INVALID` and says why. That is correct behaviour and it is also a
product that does nothing. Stand up `infra/relay` first — its README is the
runbook — and only then build for production.

## The build

Run these in one shell, because the verifier compares what you set against what
was compiled in.

```bash
export VITE_LIVETAP_MOCK_MODE=false
export VITE_LIVETAP_RELAY_URL=https://relay.example.com
export VITE_LIVETAP_RELAY_TOKEN=<the relay publish password>
npm run build:web
npm run verify:web
```

`verify:web` exits non-zero and names the reason if the build is not deployable.
It checks that demo mode was genuinely compiled out (Vite constant-folds the
flag, so anything but the literal string `false` leaves a hardcoded `return
true` in the bundle), that the landing page is not still calling itself a demo,
that a relay URL actually reached the JavaScript, that `404.html` exists so an
unknown address gets a real 404, and that no server-side client secret was
compiled into the public bundle.

The OAuth token broker is separate and server-side. Set the
`LIVETAP_*_CLIENT_ID` / `LIVETAP_*_CLIENT_SECRET` pairs in
`apps/web/.env.example` as deployment environment variables — **without** a
`VITE_` prefix, which is the only thing keeping them out of the browser bundle.
The app falls back to mock mode by itself when `GET /api/oauth/config` reports
that no platform is configured, because "Connect account" could not possibly
work and pretending otherwise would be a lie.

`VITE_LIVETAP_RELAY_TOKEN` **is** public — it is compiled into the bundle like
every `VITE_` variable. That is fine for a single-tenant self-hosted relay on a
network you control and is not fine for a multi-user deployment; replace it with
short-lived per-user JWTs (`authMethod: jwt`) before opening the relay to people
you do not know. See
[`RELAY_ARCHITECTURE.md`](../architecture/RELAY_ARCHITECTURE.md).

## What deploying does not prove

`verify:web` proves the build is real. It does not prove the relay is reachable
from the internet, that your platform credentials are accepted, or that video
arrives at a platform — no static check can. After the first deploy, go live to
one destination and confirm on that platform's own dashboard.
