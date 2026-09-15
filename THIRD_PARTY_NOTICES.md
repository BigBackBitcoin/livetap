# Third-Party Notices

LIVETAP is licensed under the MIT License (see `LICENSE`). It uses the third-party components
below. The one copyleft component LIVETAP distributes is FFmpeg, and its full license text ships
inside the binary distribution next to the binary it covers, at
`resources/ffmpeg/win/FFMPEG-LICENSE.txt` in the installed application. This file is maintained by
hand for the architecture-level components and must be regenerated mechanically for npm
dependencies before every release (see "Process controls").

## FFmpeg (desktop app only)

LIVETAP invokes the FFmpeg multimedia framework as a **separate executable program**. LIVETAP does
not link against, include, or derive from FFmpeg source code; it communicates with FFmpeg only via
command-line arguments and standard input/output pipes (`apps/desktop/src/main/ffmpeg/argv.ts`
builds the argument array; nothing is passed through a shell). LIVETAP itself therefore stays MIT:
this is mere aggregation, not a derived work. See ADR-013 in `ARCHITECTURE_DECISIONS.md`.

That reasoning covers LIVETAP's own licence. It does **not** discharge the obligations that come
with distributing the FFmpeg binary itself, which are set out below and are met in full.

### The build that ships

Recorded mechanically at packaging time by `node tools/acquire-ffmpeg.mjs` into
`apps/desktop/resources/ffmpeg/BUILD_INFO.txt`, which is copied into the installed application at
`resources/ffmpeg/BUILD_INFO.txt`.

| | |
|---|---|
| Build string (`ffmpeg -version`, first line) | `ffmpeg version 9.0.1-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers` |
| Compiler | `gcc 16.1.0 (Rev2, Built by MSYS2 project)` |
| Platform shipped | Windows x64 (`resources/ffmpeg/win/ffmpeg.exe`, `ffprobe.exe`) |
| Licence | **GNU General Public License, version 3 or later** — the build is configured `--enable-gpl --enable-version3` and links libx264 and libx265 |
| SHA-256 `ffmpeg.exe` | `57c56e369d5b4873b4d93fc1a1d833cb7cd8bc9325c14b05c34ce60b22842d8a` |
| SHA-256 `ffprobe.exe` | `afe05347caaabe479b3c4eae71992b6ec1e11c57266a1d665deb0f9fe9847208` |
| Full configure line | `resources/ffmpeg/BUILD_INFO.txt` and `resources/ffmpeg/win/FFMPEG-BUILD-README.txt`, both inside the installed app |

### Why not an LGPL build

An LGPL-2.1 build (no `--enable-gpl`) would carry lighter obligations, and ADR-013 documents it as
an alternative. It is **not** what ships, and swapping to it would not be a licensing tidy-up but a
functional regression: `apps/desktop/src/main/ffmpeg/argv.ts` names `libx264` as the transcode
encoder, and `libx264` is GPL. The hardware encoders (`h264_nvenc`, `h264_qsv`, `h264_amf`) are
tried first and are LGPL-compatible, but they are absent on most machines — on this build host all
three probed UNAVAILABLE and `libx264` was the only working encoder. Removing it would leave those
machines unable to transcode at all. So the GPL build ships, and the GPL obligations are met rather
than avoided.

### GPLv3 §4 — the licence text travels with the binary

The verbatim GPLv3 text distributed with the build is copied into the installed application at
`resources/ffmpeg/win/FFMPEG-LICENSE.txt`. `apps/desktop/scripts/verify-installer.mjs` asserts its
presence in the packaged artifact, so a build that lost it fails rather than ships.

### GPLv3 §6 — written offer of the corresponding source

**Offer.** The complete corresponding source code for the exact FFmpeg build distributed with
LIVETAP, together with the scripts used to control its compilation and installation, is available
to any recipient of this software, for as long as LIVETAP distributes this binary and for at least
three years thereafter.

- **Upstream source, exact revision:** https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a — the
  commit this build was compiled from, as published by the build's author in the `README.txt` that
  ships alongside it (`resources/ffmpeg/win/FFMPEG-BUILD-README.txt`).
- **Build configuration:** the complete `./configure` invocation is recorded verbatim in
  `resources/ffmpeg/BUILD_INFO.txt` inside the installed application, and is also printed by
  `ffmpeg -version` from the shipped binary.
- **Build scripts and external dependency sources:** https://www.gyan.dev/ffmpeg/builds/ — the
  distributor of this binary build, from whom the same source is obtained.
- **Requests:** open an issue at https://github.com/BigBackBitcoin/livetap/issues titled
  "FFmpeg source request". Requests are answered with a copy of the above at no charge beyond the
  cost of transmission.

**Status of this obligation for the current alpha:** GPLv3 §6 is triggered by *conveying* the
object code. The 2026-09-15 alpha installer is built for the owner to install on their own machine
and has not been conveyed to anyone else, so nothing is yet owed. The offer above is written,
specific and verifiable so that it is in place before the first build is handed to a third party.
BLOCKERS.md B-002 tracks the remaining owner decisions, which are about *hosting a mirror* and
*who answers requests*, not about what is offered.

### Components within the shipped build

The configure line is the authoritative list. Notable copyleft and permissive components include
x264 (GPL-2.0-or-later), x265 (GPL-2.0-or-later), libsrt (MPL-2.0), libopus (BSD-3-Clause), libvpx
(BSD-3-Clause), dav1d (BSD-2-Clause), SVT-AV1 (BSD-3-Clause), libaom (BSD-2-Clause), FreeType (FTL
or GPL-2.0), fontconfig (MIT) and GnuTLS (LGPL-2.1-or-later).

**Never** ship an `--enable-nonfree` build: it cannot be redistributed at all, under any licence.
`tools/acquire-ffmpeg.mjs` records the configure line of whatever it places, so a nonfree build
would be visible in `BUILD_INFO.txt` rather than silent.

## MediaMTX (self-hosted relay, server-side only)

- https://github.com/bluenviron/mediamtx — MIT License, Copyright (c) 2019 aler9. Not bundled in the apps; run by the user via `infra/relay/docker-compose.yml`.

## Electron, Chromium, Node.js (desktop app)

- Electron: MIT. Chromium: BSD-3-Clause and bundled notices. Node.js: MIT and bundled notices. Notices are generated mechanically by electron-builder into the distribution (`LICENSES.chromium.html`, `LICENSE.electron.txt`).

## Mobile native libraries (planned; see docs/architecture/MOBILE_ARCHITECTURE.md)

- HaishinKit (iOS): BSD-3-Clause — copyright and the three clauses, including the no-endorsement clause, must be retained.
- RootEncoder (Android): Apache-2.0 — retain NOTICE contents; note modifications per section 4 if any.
- Capacitor: MIT.

## npm dependencies (web, desktop, mobile, packages)

Runtime dependencies are deliberately minimal: `packages/core`, `packages/adapters`, `packages/media`
and `packages/ui` have zero runtime dependencies. `apps/web` uses React (MIT), react-dom (MIT),
react-router (MIT) and zustand (MIT). `apps/desktop` uses electron-log (MIT) and electron-updater (MIT).
The complete transitive list with license texts is generated at release time into
`docs/legal/NPM_LICENSES.md` (see process controls).

## Fonts and assets

- Inter is referenced via the system font stack (no Inter files bundled).
- Archivo (display face on the public page): SIL Open Font License 1.1, Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo). Bundled as a latin subset `apps/web/public/fonts/archivo-latin.woff2`; the license text ships alongside as `ARCHIVO-OFL.txt`.
- No proprietary UI, branding, or assets from other products are used.

## Process controls

1. CI regenerates the npm license report (`npx license-checker --production --json`) and fails on any dependency whose license is not in the allow-list (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, 0BSD, Unlicense, CC0-1.0) or is GPL/AGPL/SSPL/unstated.
2. The FFmpeg written offer above is in place and names the exact build. What remains before
   the first PUBLIC binary release is the owner decision tracked in BLOCKERS.md B-002: where a
   source mirror is hosted, and who answers requests to the address named in the offer.
3. This file is reviewed on every dependency change.
