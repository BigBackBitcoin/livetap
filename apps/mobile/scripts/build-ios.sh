#!/usr/bin/env bash
# Build the LIVETAP iOS app as far as a non-Mac host can take it.
#
#   bash apps/mobile/scripts/build-ios.sh
#
# WHAT THIS DOES AND DOES NOT DO, stated plainly because the difference is the whole point.
#
# It does: build the web application with demo mode compiled OUT, stage it as the phone bundle,
# verify that bundle is real, and sync it into the Xcode project. Every one of those steps runs on
# Windows, Linux or macOS and is the part that has silently gone wrong before.
#
# It does not: compile, sign, or archive. `xcodebuild` needs a Mac, and no amount of configuration
# on this host changes that. The script stops at that boundary and says so rather than implying a
# build happened.
#
# WHY IT EXISTS. `npm run sync:ios` is a bare `cap sync ios` with nothing in front of it, so it
# stages whatever is already sitting in `apps/web/dist`. `envMockMode()` treats anything but the
# literal string "false" as demo mode and Vite folds it at build time, so the default outcome is an
# iOS app with simulated adapters and a simulated engine that cannot broadcast however real the
# destination is. The desktop app shipped in exactly that state, and Android has had
# `build-android.sh` guarding against it since; iOS had nothing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

echo "[ios] 1/4 building the web application (real adapters, real engine)"
VITE_LIVETAP_MOCK_MODE=false npm run build -w @livetap/web >/dev/null

echo "[ios] 2/4 staging it as the phone bundle"
node apps/mobile/scripts/stage-web.mjs

echo "[ios] 3/4 verifying the staged bundle is a real build"
node apps/mobile/scripts/verify-staged-web.mjs

echo "[ios] 4/4 syncing into the Xcode project"
if ( cd apps/mobile && npx cap sync ios ); then
  echo "[ios] synced."
else
  echo "[ios] cap sync ios failed. On a non-Mac host this is usually CocoaPods being absent;" >&2
  echo "      the staged bundle above is still correct and is what a Mac would pick up." >&2
  exit 1
fi

cat <<'NOTE'

[ios] WHAT REMAINS, AND IT NEEDS A MAC
      xcodebuild -workspace apps/mobile/ios/App/App.xcworkspace -scheme App

      Also externally blocked, in the same way the Windows installer is unsigned rather than
      unsignable: an Apple Developer Program membership, a signing identity, and a provisioning
      profile. Until an archive is produced on Apple hardware, iOS is UNVERIFIED — configured,
      stageable and reviewable, but never compiled. Do not record it as done.
NOTE
