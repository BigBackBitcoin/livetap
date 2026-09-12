# macOS FFmpeg binary

Drop `ffmpeg` (and optionally `ffprobe`) here before packaging.

`electron-builder.yml` copies this directory to `resources/ffmpeg/` inside the installed app, and
`src/main/ffmpeg/ffmpegPath.ts` resolves
`process.resourcesPath/ffmpeg/mac/ffmpeg` in a packaged build.

The binaries are NOT committed: they are ~80 MB each and GPL-licensed (see
`docs/architecture/DESKTOP_ARCHITECTURE.md` for the licensing decision and the required
THIRD_PARTY_NOTICES text). Use a **GPL** build — never a `--enable-nonfree` build, which cannot be
redistributed at all.

The binary must be a universal or per-arch build matching the dmg arch (arm64 and x64 are both
built), and must be signed and hardened along with the app - see docs/release/DESKTOP_RELEASE.md.

A packaged build with no binary here still starts, but `capabilities()` reports
`verification: UNAVAILABLE` and main logs an error — it never pretends streaming works.
