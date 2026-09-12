# Windows FFmpeg binary

Drop `ffmpeg.exe` (and optionally `ffprobe.exe`) here before packaging.

`electron-builder.yml` copies this directory to `resources/ffmpeg/` inside the installed app, and
`src/main/ffmpeg/ffmpegPath.ts` resolves
`process.resourcesPath/ffmpeg/win/ffmpeg.exe` in a packaged build.

The binaries are NOT committed: they are ~80 MB each and GPL-licensed (see
`docs/architecture/DESKTOP_ARCHITECTURE.md` for the licensing decision and the required
THIRD_PARTY_NOTICES text). Use a **GPL** build — never a `--enable-nonfree` build, which cannot be
redistributed at all.

Verified working on this host: `ffmpeg 9.0.1-full_build` from gyan.dev, which has libx264,
rtmp/rtmps/srt protocols and the tee/fifo muxers.

A packaged build with no binary here still starts, but `capabilities()` reports
`verification: UNAVAILABLE` and main logs an error — it never pretends streaming works.
