/**
 * Renderer-side media diagnostics for the desktop engine.
 *
 * This runs in the renderer. `DesktopEngine.start()` calls `probeRecorderSupport()` before it
 * builds a single MediaRecorder, and the answer decides the whole pipeline: can Chromium hand us
 * H.264 directly, so the main process never has to re-encode video?
 *
 * Measured on this build host (Electron 38.8.6 / Chrome 140.0.7339.249, Windows Server 2022, no GPU):
 *   MediaRecorder.isTypeSupported('video/webm;codecs=h264')        → true
 *   MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus')   → true
 *   recorder.mimeType (actual)                                     → 'video/x-matroska;codecs=avc1,opus'
 *   encoded profile                                                → H.264 Constrained Baseline 1920x1080
 *   keyframe interval                                              → ~0.86 s
 *   VideoEncoder.isConfigSupported('avc1.42E01E' @1080p)           → false
 *   VideoEncoder.isConfigSupported('avc1.640028' @1080p)           → true
 *
 * The full numbers and what they imply live in docs/architecture/DESKTOP_ARCHITECTURE.md.
 * Nothing here assumes a result: `probeRecorderSupport()` re-measures on the user's machine and the
 * engine picks the pipeline from what it finds, because a different Chromium build, a different OS
 * or an enterprise codec policy can all change the answer.
 */

/** MIME types tried in preference order: H.264 first, because H.264 is what RTMP needs (ADR-012). */
export const CANDIDATE_MIME_TYPES: readonly string[] = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=h264',
  'video/x-matroska;codecs=avc1,opus',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
];

export interface RecorderSupport {
  /** Every candidate and whether this browser claims to support it. */
  supported: Record<string, boolean>;
  /** The MIME type the engine should use, or null when MediaRecorder cannot help at all. */
  chosen: string | null;
  /**
   * true when `chosen` carries H.264 — the case where the main process can `-c:v copy` and the
   * whole pipeline contains exactly ONE video encode (the renderer's).
   */
  h264: boolean;
  /**
   * When false, main must transcode VP8/VP9 → H.264 with libx264: still one encode per aspect
   * ratio, but it now costs CPU in the app instead of being free.
   */
  hardwareRelief: boolean;
  webCodecs: {
    available: boolean;
    /** H.264 configs WebCodecs will accept at the given size, for the Option C upgrade path. */
    h264Configs: Record<string, boolean>;
  };
}

interface MediaRecorderCtor {
  isTypeSupported(type: string): boolean;
}

/**
 * Probe what this renderer can actually produce. Safe to call at startup; does not open a camera,
 * does not ask for a permission, and never throws — an environment without MediaRecorder returns a
 * fully-false report rather than blowing up the studio.
 */
export async function probeRecorderSupport(
  width = 1920,
  height = 1080,
  bitrate = 4_500_000,
  framerate = 30,
): Promise<RecorderSupport> {
  const supported: Record<string, boolean> = {};
  const recorder = (globalThis as { MediaRecorder?: MediaRecorderCtor }).MediaRecorder;

  for (const mime of CANDIDATE_MIME_TYPES) {
    let ok = false;
    try {
      ok = recorder !== undefined && recorder.isTypeSupported(mime);
    } catch {
      ok = false;
    }
    supported[mime] = ok;
  }

  const chosen = CANDIDATE_MIME_TYPES.find((mime) => supported[mime] === true) ?? null;
  const h264 = chosen !== null && /h264|avc1|avc3/i.test(chosen);

  const h264Configs: Record<string, boolean> = {};
  // Cast through `unknown`: the DOM lib types VideoEncoder precisely, but this module must also
  // compile (and be testable) in environments where it does not exist at all.
  const encoderCtor = (globalThis as unknown as {
    VideoEncoder?: { isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }> };
  }).VideoEncoder;
  if (encoderCtor !== undefined) {
    // 42E01E = Constrained Baseline 3.0, 4D0028 = Main 4.0, 640028 = High 4.0.
    for (const codec of ['avc1.42E01E', 'avc1.4D0028', 'avc1.640028']) {
      try {
        const result = await encoderCtor.isConfigSupported({
          codec,
          width,
          height,
          bitrate,
          framerate,
          avc: { format: 'annexb' },
        });
        h264Configs[codec] = result.supported === true;
      } catch {
        h264Configs[codec] = false;
      }
    }
  }

  return {
    supported,
    chosen,
    h264,
    hardwareRelief: h264,
    webCodecs: { available: encoderCtor !== undefined, h264Configs },
  };
}

/**
 * Human-readable summary for the Pro-mode diagnostics panel. Every line is honest about what was
 * measured rather than what is hoped for.
 */
export function describeRecorderSupport(report: RecorderSupport): string[] {
  const lines: string[] = [];
  if (report.chosen === null) {
    lines.push('MediaRecorder is unavailable: this build cannot stream from the renderer.');
    return lines;
  }
  lines.push(`Recording with ${report.chosen}.`);
  if (report.h264) {
    lines.push('H.264 is available in the renderer, so LIVETAP encodes once and never re-encodes video.');
  } else {
    lines.push('H.264 is not available in the renderer, so LIVETAP converts video once on the CPU before sending.');
  }
  if (report.webCodecs.available) {
    const working = Object.entries(report.webCodecs.h264Configs)
      .filter(([, ok]) => ok)
      .map(([codec]) => codec);
    lines.push(
      working.length > 0
        ? `WebCodecs H.264 is available (${working.join(', ')}) for precise bitrate and keyframe control.`
        : 'WebCodecs is present but has no working H.264 configuration at this resolution.',
    );
  }
  return lines;
}

/** Recommended MediaRecorder timeslice, ms. 1 s ≈ 330 KB at 1080p30 — a 1.7 ms IPC send (measured). */
export const RECORDER_TIMESLICE_MS = 1000;

/** MediaRecorder options for a target format. */
export function recorderOptions(
  mimeType: string,
  videoKbps: number,
  audioKbps: number,
): { mimeType: string; videoBitsPerSecond: number; audioBitsPerSecond: number } {
  return {
    mimeType,
    videoBitsPerSecond: Math.round(videoKbps * 1000),
    audioBitsPerSecond: Math.round(audioKbps * 1000),
  };
}
