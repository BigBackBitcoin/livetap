# Third-Party Notices

LIVETAP is licensed under the MIT License (see `LICENSE`). It uses the third-party components
below. Full license texts for copyleft components are shipped in `LICENSES/` inside binary
distributions. This file is maintained by hand for the architecture-level components and must be
regenerated mechanically for npm dependencies before every release (see "Process controls").

## FFmpeg (desktop app only)

LIVETAP invokes the FFmpeg multimedia framework as a **separate executable program**. LIVETAP does
not link against, include, or derive from FFmpeg source code; it communicates with FFmpeg only via
command-line arguments and standard input/output pipes.

- Upstream: https://ffmpeg.org/
- Version targeted: 9.0.x (per platform; exact build and SHA-256 recorded at packaging time in `apps/desktop/resources/ffmpeg/BUILD_INFO.txt`)
- License of the default build: **GNU General Public License v3 or later** (configured with `--enable-gpl --enable-version3`, linking libx264 and libx265). Development on the build host used the gyan.dev "full" build under the same terms.
- Complete corresponding source and build configuration: a source mirror URL and written offer MUST be published before the first binary release (tracked in BLOCKERS.md). Requests: security/legal contact in `SECURITY.md`.
- Bundled FFmpeg components with their own notices include x264 (GPL-2.0-or-later), x265 (GPL-2.0-or-later), libsrt (MPL-2.0), libopus (BSD-3-Clause), libvpx (BSD-3-Clause), dav1d (BSD-2-Clause), SVT-AV1 (BSD-3-Clause). The complete list is generated from the shipped build's configuration.
- An alternative LGPL-2.1 build profile (no `--enable-gpl`; openh264 BSD-2-Clause, MediaFoundation, VideoToolbox, NVENC/QSV/AMF) is documented in ADR-013 for distributions that cannot carry GPL binaries.

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
2. The FFmpeg source mirror and written offer are published before the first binary release.
3. This file is reviewed on every dependency change.
