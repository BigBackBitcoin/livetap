# macOS FFmpeg binary

Put `ffmpeg` and `ffprobe` here with:

```bash
node tools/acquire-ffmpeg.mjs --platform mac
```

It copies them from the ffmpeg already on PATH (resolving shims to the real executable),
runs each copy to prove it starts, copies the build's licence text in beside them, and
records the exact build and its SHA-256 in `../BUILD_INFO.txt`. On a machine with no
ffmpeg it prints the download URL and this destination and exits non-zero rather than
downloading 220 MB unattended. `npm run package:win`/`package:mac` run it automatically via
`prepackage`, so a packaging run either ships a working ffmpeg or stops and says why.

Dropping the binaries in by hand works too — the script and the packaging step only care
that they are here and that they run.

`electron-builder.yml` copies this directory to `resources/ffmpeg/` inside the installed app, and
`src/main/ffmpeg/ffmpegPath.ts` resolves
`process.resourcesPath/ffmpeg/mac/ffmpeg` in a packaged build.

The binaries are NOT committed (`.gitignore` excludes them): they are ~220 MB each in the gyan.dev full build and GPL-licensed (see
`docs/architecture/DESKTOP_ARCHITECTURE.md` for the licensing decision and the required
THIRD_PARTY_NOTICES text). Use a **GPL** build — never a `--enable-nonfree` build, which cannot be
redistributed at all.

The binary must be a universal or per-arch build matching the dmg arch (arm64 and x64 are both
built), and must be signed and hardened along with the app - see docs/release/DESKTOP_RELEASE.md.

A packaged build with no binary here still starts, but `capabilities()` reports
`verification: UNAVAILABLE` and main logs an error — it never pretends streaming works.
