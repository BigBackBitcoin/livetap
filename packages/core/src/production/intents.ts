/**
 * Automatic Production: the creator says WHAT they are making and WHERE it goes;
 * LIVETAP infers the production (master aspect, per-destination aspect, layouts, safe areas,
 * quality, audio defaults). This is the core of "the easiest operating system for going live".
 */

import type { AspectRatio, PlatformId } from '../types/destination.js';
import type { AudioState, Layer, Moment, NormalizedRect } from '../types/moment.js';
import type { ProductionSettings, QualityPreset } from '../types/production.js';
import { DEFAULT_AUDIO, defaultMoments } from '../moments/defaults.js';
import { DEFAULT_PRODUCTION_SETTINGS } from './formats.js';

export const CONTENT_TYPES = ['talking', 'gaming', 'podcast', 'presentation', 'event', 'vertical'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface NormalizedInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Safe areas per aspect ratio (fraction of canvas). Vertical platforms overlay chat at the bottom
 * and action buttons on the right; keep text and faces out of those zones.
 */
export const SAFE_AREAS: Record<AspectRatio, NormalizedInsets> = {
  '16:9': { top: 0.05, bottom: 0.06, left: 0.05, right: 0.05 },
  '9:16': { top: 0.12, bottom: 0.28, left: 0.05, right: 0.16 },
  '1:1': { top: 0.06, bottom: 0.12, left: 0.06, right: 0.06 },
};

export interface IntentProfile {
  id: ContentType;
  title: string;
  emoji: string;
  /** One line a beginner understands. */
  tagline: string;
  /** What LIVETAP sets up automatically. Shown on the intent card. */
  whatYouGet: string[];
  masterAspectRatio: AspectRatio;
  /** Aspect preference order used to pick what each destination receives. */
  aspectPreference: AspectRatio[];
  qualityPreset: QualityPreset;
  audio: Partial<AudioState>;
  /** Ordered list of Moment ids from the default set; first is active. */
  momentOrder: string[];
  /** Whether a screen/window capture is the primary picture. */
  screenPrimary: boolean;
  /** Camera framing hint for the compositor and UI. */
  cameraFraming: 'full' | 'pip' | 'split' | 'stacked' | 'hidden';
}

export const INTENT_PROFILES: Record<ContentType, IntentProfile> = {
  talking: {
    id: 'talking',
    title: 'Talking',
    emoji: '🎥',
    tagline: 'Just you and the camera.',
    whatYouGet: ['Full-frame camera', 'Clean lower-third', 'Auto vertical crop for TikTok and Shorts'],
    masterAspectRatio: '16:9',
    aspectPreference: ['16:9', '9:16', '1:1'],
    qualityPreset: '1080p30',
    audio: { noiseSuppression: true, echoCancellation: true, autoGain: true },
    momentOrder: ['main-camera', 'starting-soon', 'break', 'ending'],
    screenPrimary: false,
    cameraFraming: 'full',
  },
  gaming: {
    id: 'gaming',
    title: 'Gaming',
    emoji: '🎮',
    tagline: 'Your game, with you in the corner.',
    whatYouGet: ['Game capture with camera picture-in-picture', '60 fps where the platform allows', 'Game audio and mic balanced'],
    masterAspectRatio: '16:9',
    aspectPreference: ['16:9', '9:16'],
    qualityPreset: '1080p60',
    audio: { systemAudio: true, systemGain: 0.8, noiseSuppression: true, echoCancellation: false, autoGain: false },
    momentOrder: ['screen-share', 'main-camera', 'starting-soon', 'break', 'ending'],
    screenPrimary: true,
    cameraFraming: 'pip',
  },
  podcast: {
    id: 'podcast',
    title: 'Podcast',
    emoji: '🎙',
    tagline: 'You and a guest, side by side.',
    whatYouGet: ['Split layout for two people', 'Voice-first audio processing', 'Square and vertical versions for clips'],
    masterAspectRatio: '16:9',
    aspectPreference: ['16:9', '1:1', '9:16'],
    qualityPreset: '1080p30',
    audio: { noiseSuppression: true, echoCancellation: true, autoGain: true },
    momentOrder: ['guest', 'main-camera', 'starting-soon', 'break', 'ending'],
    screenPrimary: false,
    cameraFraming: 'split',
  },
  presentation: {
    id: 'presentation',
    title: 'Presentation',
    emoji: '💻',
    tagline: 'Your screen, with you alongside.',
    whatYouGet: ['Screen share with camera inset', 'Readable text at 1080p', 'Slides stay sharp on every platform'],
    masterAspectRatio: '16:9',
    aspectPreference: ['16:9', '9:16'],
    qualityPreset: '1080p30',
    audio: { systemAudio: true, systemGain: 0.6, noiseSuppression: true, echoCancellation: true, autoGain: true },
    momentOrder: ['screen-share', 'main-camera', 'starting-soon', 'break', 'ending'],
    screenPrimary: true,
    cameraFraming: 'pip',
  },
  event: {
    id: 'event',
    title: 'Event',
    emoji: '🎤',
    tagline: 'A stage, a camera, an audience.',
    whatYouGet: ['Wide camera framing', 'Starting-soon and break screens', 'Steady 30 fps for long sessions'],
    masterAspectRatio: '16:9',
    aspectPreference: ['16:9', '1:1', '9:16'],
    qualityPreset: '1080p30',
    audio: { noiseSuppression: false, echoCancellation: false, autoGain: false },
    momentOrder: ['starting-soon', 'main-camera', 'break', 'ending'],
    screenPrimary: false,
    cameraFraming: 'full',
  },
  vertical: {
    id: 'vertical',
    title: 'Vertical Live',
    emoji: '📱',
    tagline: 'Built for phones, first.',
    whatYouGet: ['9:16 composition with safe areas for chat', 'Face-forward framing', 'Also works on YouTube and Facebook'],
    masterAspectRatio: '9:16',
    aspectPreference: ['9:16', '1:1', '16:9'],
    qualityPreset: '1080p30',
    audio: { noiseSuppression: true, echoCancellation: true, autoGain: true },
    momentOrder: ['main-camera', 'starting-soon', 'break', 'ending'],
    screenPrimary: false,
    cameraFraming: 'full',
  },
};

export interface DestinationAspectInput {
  id: string;
  platform: PlatformId;
  supportedAspectRatios: AspectRatio[];
  preferredAspectRatio: AspectRatio;
}

/** Pick what a destination should receive: the intent's first preference the platform supports. */
export function chooseAspectForDestination(intent: IntentProfile, dest: DestinationAspectInput): AspectRatio {
  for (const aspect of intent.aspectPreference) {
    if (dest.supportedAspectRatios.includes(aspect)) return aspect;
  }
  return dest.preferredAspectRatio;
}

export interface AutomaticProduction {
  intent: IntentProfile;
  settings: ProductionSettings;
  moments: Moment[];
  activeMomentId: string;
  /** destination id → aspect ratio it receives */
  destinationAspects: Record<string, AspectRatio>;
  /** Distinct aspect ratios the engine must produce (one encode each). */
  formats: AspectRatio[];
  /** Plain-language explanation shown on the "Here is your setup" screen. */
  explanation: string[];
}

/**
 * Build the whole production from an intent and the chosen destinations.
 * Pure: no side effects, deterministic.
 */
export function buildAutomaticProduction(
  contentType: ContentType,
  destinations: DestinationAspectInput[],
  base: ProductionSettings = DEFAULT_PRODUCTION_SETTINGS,
): AutomaticProduction {
  const intent = INTENT_PROFILES[contentType];
  const destinationAspects: Record<string, AspectRatio> = {};
  for (const d of destinations) destinationAspects[d.id] = chooseAspectForDestination(intent, d);
  const formats = Array.from(new Set(Object.values(destinationAspects)));

  // If every destination wants the same aspect, compose directly in it (no wasted canvas).
  const masterAspectRatio: AspectRatio = formats.length === 1 && formats[0] ? formats[0] : intent.masterAspectRatio;

  const settings: ProductionSettings = {
    ...base,
    masterAspectRatio,
    qualityPreset: intent.qualityPreset,
    formats: undefined,
  };

  const moments = layoutMomentsForIntent(intent);
  const activeMomentId = intent.momentOrder[0] ?? moments[0]?.id ?? 'main-camera';

  const explanation: string[] = [];
  explanation.push(`${intent.emoji} ${intent.title}: ${intent.tagline}`);
  if (formats.length > 1) {
    explanation.push(
      `One production, ${formats.length} formats: ${formats.join(' and ')}. LIVETAP reframes automatically.`,
    );
  } else if (formats[0]) {
    explanation.push(`Composed in ${formats[0]} for every destination.`);
  }
  explanation.push(`Quality: ${describePreset(intent.qualityPreset)}. Change it any time in Settings.`);
  if (intent.audio.systemAudio) explanation.push('Computer audio is included and balanced under your mic.');

  return { intent, settings, moments, activeMomentId, destinationAspects, formats, explanation };
}

function describePreset(p: QualityPreset): string {
  switch (p) {
    case '720p30':
      return '720p, 30 fps';
    case '1080p30':
      return '1080p, 30 fps';
    case '1080p60':
      return '1080p, 60 fps';
    default:
      return 'automatic';
  }
}

/**
 * Derive the Moment set for an intent from the built-in Moments, applying framing hints and
 * safe-area-aware placements. Moments the intent does not list are still available in Pro.
 */
export function layoutMomentsForIntent(intent: IntentProfile): Moment[] {
  const all = defaultMoments();
  const byId = new Map(all.map((m) => [m.id, m]));
  const ordered: Moment[] = [];
  for (const id of intent.momentOrder) {
    const m = byId.get(id);
    if (m) ordered.push(applyIntentToMoment(m, intent));
  }
  for (const m of all) if (!intent.momentOrder.includes(m.id)) ordered.push(applyIntentToMoment(m, intent));
  return ordered;
}

function applyIntentToMoment(moment: Moment, intent: IntentProfile): Moment {
  const audio: AudioState = { ...DEFAULT_AUDIO, ...moment.audio, ...intent.audio, micMuted: moment.audio.micMuted };
  const layers = moment.layers.map((layer) => applyIntentToLayer(layer, intent, moment.id));
  const name = renameForIntent(moment, intent);
  return { ...moment, name, audio, layers };
}

function renameForIntent(moment: Moment, intent: IntentProfile): string {
  if (moment.id === 'screen-share' && intent.id === 'gaming') return 'Gameplay';
  if (moment.id === 'screen-share' && intent.id === 'presentation') return 'Slides';
  if (moment.id === 'guest' && intent.id === 'podcast') return 'Conversation';
  return moment.name;
}

function applyIntentToLayer(layer: Layer, intent: IntentProfile, momentId: string): Layer {
  if (layer.kind === 'text') {
    return { ...layer, placement: { ...layer.placement, '9:16': insetToSafeArea(layer.placement['9:16'] ?? layer.placement.default, '9:16') } };
  }
  if (layer.kind === 'camera' && momentId === 'screen-share') {
    // Gaming: camera bottom-left (HUDs usually top-right). Presentation: bottom-right.
    const pip: NormalizedRect =
      intent.id === 'gaming' ? { x: 0.03, y: 0.68, w: 0.24, h: 0.29 } : { x: 0.73, y: 0.68, w: 0.24, h: 0.29 };
    return {
      ...layer,
      placement: {
        ...layer.placement,
        default: pip,
        '9:16': insetToSafeArea({ x: 0.1, y: 0.58, w: 0.8, h: 0.3 }, '9:16'),
      },
    };
  }
  if (layer.kind === 'camera' && momentId === 'main-camera' && intent.id === 'vertical') {
    // `cover` so a vertical production fills the frame instead of letterboxing a wide sensor.
    // Deliberately no `mirror`: see types/moment.ts. A vertical stream is the one most likely to
    // be someone holding something up to the lens.
    return { ...layer, fit: 'cover' };
  }
  return layer;
}

/** Move/shrink a rect so it lies within the safe area of the given aspect. */
export function insetToSafeArea(rect: NormalizedRect, aspect: AspectRatio): NormalizedRect {
  const s = SAFE_AREAS[aspect];
  const minX = s.left;
  const maxX = 1 - s.right;
  const minY = s.top;
  const maxY = 1 - s.bottom;
  const w = Math.min(rect.w, maxX - minX);
  const h = Math.min(rect.h, maxY - minY);
  const x = Math.min(Math.max(rect.x, minX), maxX - w);
  const y = Math.min(Math.max(rect.y, minY), maxY - h);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
