import type { AspectRatio } from '../types/destination.js';
import type { OutputFormat, QualityPreset, ProductionSettings } from '../types/production.js';

const DIMENSIONS: Record<AspectRatio, Record<'720' | '1080', { w: number; h: number }>> = {
  '16:9': { '720': { w: 1280, h: 720 }, '1080': { w: 1920, h: 1080 } },
  '9:16': { '720': { w: 720, h: 1280 }, '1080': { w: 1080, h: 1920 } },
  '1:1': { '720': { w: 720, h: 720 }, '1080': { w: 1080, h: 1080 } },
};

/** Bitrate targets follow YouTube/Twitch published ranges for H.264. */
export function formatForPreset(preset: QualityPreset, aspect: AspectRatio): OutputFormat {
  const p = preset === 'auto' ? '1080p30' : preset;
  const tier = p.startsWith('720') ? '720' : '1080';
  const fps = p.endsWith('60') ? 60 : 30;
  const dims = DIMENSIONS[aspect][tier];
  const videoKbps = tier === '720' ? (fps === 60 ? 3500 : 2500) : fps === 60 ? 6000 : 4500;
  return {
    aspectRatio: aspect,
    width: dims.w,
    height: dims.h,
    fps,
    videoKbps,
    audioKbps: 160,
    codec: 'h264',
    keyframeIntervalSeconds: 2,
  };
}

/**
 * Resolve the set of formats the engine must produce for the given destinations.
 * Encodes once per distinct aspect ratio; never per destination.
 */
export function resolveFormats(
  settings: ProductionSettings,
  aspectRatios: AspectRatio[],
): Record<AspectRatio, OutputFormat | undefined> {
  const result: Record<AspectRatio, OutputFormat | undefined> = { '16:9': undefined, '9:16': undefined, '1:1': undefined };
  const wanted = new Set<AspectRatio>(aspectRatios.length ? aspectRatios : [settings.masterAspectRatio]);
  for (const aspect of wanted) {
    result[aspect] = settings.formats?.[aspect] ?? formatForPreset(settings.qualityPreset, aspect);
  }
  return result;
}

/** Step a format down one notch for adaptive degradation. Returns null when already at the floor. */
export function degradeFormat(f: OutputFormat, how: 'lowerBitrate' | 'lowerResolution' | 'lowerFps'): OutputFormat | null {
  if (how === 'lowerBitrate') {
    const next = Math.round(f.videoKbps * 0.75);
    if (next < 800) return null;
    return { ...f, videoKbps: next };
  }
  if (how === 'lowerFps') {
    if (f.fps === 60) return { ...f, fps: 30, videoKbps: Math.round(f.videoKbps * 0.75) };
    if (f.fps === 30) return { ...f, fps: 24 };
    return null;
  }
  // lowerResolution
  if (f.height > 720 || f.width > 1280) {
    const dims = DIMENSIONS[f.aspectRatio]['720'];
    return { ...f, width: dims.w, height: dims.h, videoKbps: Math.min(f.videoKbps, 3000) };
  }
  return null;
}

export const DEFAULT_PRODUCTION_SETTINGS: ProductionSettings = {
  masterAspectRatio: '16:9',
  qualityPreset: 'auto',
  encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
  recording: { enabled: false, container: 'mp4', source: 'program' },
  reconnect: { enabled: true, maxAttempts: 10, initialDelayMs: 1000, maxDelayMs: 30000, multiplier: 2, jitter: 0.2 },
};
