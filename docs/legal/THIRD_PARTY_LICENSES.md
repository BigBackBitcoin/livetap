# Third-Party Licenses

Attribution obligations for components LIVETAP redistributes. Each team owns the section for its
own dependencies; **append, do not rewrite**.

The point of this file is not tidiness. Apache-2.0 and BSD-3-Clause both require that the notice
travels with the binary — so whatever is listed here must also be reachable **from inside the
shipped app** (an "Open source licences" screen), not only from this repository.

---

## Mobile — native streaming libraries (`apps/mobile`)

Both licences are permissive, compatible with LIVETAP CORE's MIT licence, and acceptable for App
Store and Google Play distribution.

### RootEncoder (Android)

| | |
|---|---|
| Coordinate | `com.github.pedroSG94.RootEncoder:library:2.8.1` (JitPack) |
| Declared in | `apps/mobile/android/variables.gradle` (`rootEncoderVersion`), `apps/mobile/android/app/build.gradle` |
| Source | `https://github.com/pedroSG94/RootEncoder` |
| Licence | **Apache License 2.0** |
| Copyright | © pedroSG94 |
| Verified | 2026-09-11 — repository `LICENSE.txt` is Apache-2.0; latest release confirmed as 2.8.1; per-file headers at tag 2.8.1 carry the Apache-2.0 notice. |

**Obligations:** ship a copy of the Apache-2.0 licence text; retain copyright, patent, trademark
and attribution notices from the source; ship the upstream `NOTICE` file if one is present; state
that the file was changed if it is ever modified.

- [ ] Copy the full Apache-2.0 text into the in-app licences screen. **Not yet done.**
- [ ] Check whether the 2.8.1 tag contains a `NOTICE` file and, if so, reproduce it. **UNVERIFIED.**

### HaishinKit.swift (iOS)

| | |
|---|---|
| Pod | `HaishinKit ~> 2.0.9` |
| Declared in | `apps/mobile/ios/App/Podfile` |
| Source | `https://github.com/shogo4405/HaishinKit.swift` (now also `github.com/HaishinKit/HaishinKit.swift`) |
| Licence | **BSD-3-Clause** (the 2.0.9 podspec states `"New BSD"`) |
| Copyright | © shogo4405 |
| Verified | 2026-09-11 — read `HaishinKit.podspec` at tag 2.0.9: `s.license = "New BSD"`, `s.version = "2.0.9"`, `s.ios.deployment_target = "13.0"`. |
| Transitive | `Logboard ~> 2.5.0` (podspec dependency) — **licence UNVERIFIED**, must be checked and listed before submission. |

**Obligations:** reproduce the copyright notice, the licence conditions and the disclaimer in the
documentation/materials shipped with the binary; do **not** use the author's name to endorse
LIVETAP (the third clause).

- [ ] Copy the full BSD-3-Clause text and copyright line into the in-app licences screen.
      **Not yet done.**
- [ ] Determine and record Logboard's licence. **UNVERIFIED.**

### Version note

HaishinKit's latest release is 2.2.5 (2026-03-28), but CocoaPods trunk's newest published version
is 2.0.9 — 2.1.x and 2.2.x are Swift Package Manager only. If the project moves to Capacitor 8 +
SPM (see `docs/architecture/MOBILE_ARCHITECTURE.md` §2), update the version and re-verify the
licence at that tag.

---

## Mobile — framework (`apps/mobile`)

| Component | Version | Licence | Note |
|---|---|---|---|
| `@capacitor/core`, `cli`, `ios`, `android` | 7.6.9 | **MIT** (per npm metadata) | Apple lists `Capacitor` among its commonly-used SDKs, so it must ship a privacy manifest and be code-signed as a binary dependency. `@capacitor/ios` does ship `PrivacyInfo.xcprivacy` (verified), though with empty arrays. |
| `@capacitor/{app,browser,preferences,status-bar,splash-screen,keyboard,haptics}` | see `apps/mobile/package.json` | **MIT** (per npm metadata) | `@capacitor/preferences` ships **no** privacy manifest and calls `UserDefaults.standard` directly, which is why the app target declares `NSPrivacyAccessedAPITypeUserDefaults`. |

- [ ] Generate the full transitive licence list mechanically (e.g. `license-checker`) rather than
      by hand, and render it into the in-app screen. **Not yet done.**

---

## Other areas

Desktop (Electron, bundled `ffmpeg` — note the LGPL vs GPL determination), web, and the shared
packages are owned by their respective teams. Add sections below.
