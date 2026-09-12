import { describe, expect, it } from 'vitest';
import {
  CONTENT_TYPES,
  INTENT_PROFILES,
  SAFE_AREAS,
  buildAutomaticProduction,
  chooseAspectForDestination,
  insetToSafeArea,
  layoutMomentsForIntent,
  type DestinationAspectInput,
} from './intents.js';

const youtube: DestinationAspectInput = { id: 'yt', platform: 'youtube', supportedAspectRatios: ['16:9', '9:16'], preferredAspectRatio: '16:9' };
const tiktok: DestinationAspectInput = { id: 'tt', platform: 'tiktok', supportedAspectRatios: ['9:16'], preferredAspectRatio: '9:16' };
const twitch: DestinationAspectInput = { id: 'tw', platform: 'twitch', supportedAspectRatios: ['16:9'], preferredAspectRatio: '16:9' };

describe('intent profiles', () => {
  it('cover every content type with beginner-readable copy', () => {
    for (const ct of CONTENT_TYPES) {
      const p = INTENT_PROFILES[ct];
      expect(p.id).toBe(ct);
      expect(p.tagline.length).toBeGreaterThan(8);
      expect(p.whatYouGet.length).toBeGreaterThanOrEqual(2);
      expect(p.aspectPreference[0]).toBe(p.masterAspectRatio);
      expect(p.momentOrder.length).toBeGreaterThan(0);
    }
  });
});

describe('chooseAspectForDestination', () => {
  it('gives each destination the best supported aspect for the intent', () => {
    expect(chooseAspectForDestination(INTENT_PROFILES.talking, youtube)).toBe('16:9');
    expect(chooseAspectForDestination(INTENT_PROFILES.talking, tiktok)).toBe('9:16');
    expect(chooseAspectForDestination(INTENT_PROFILES.vertical, youtube)).toBe('9:16');
    expect(chooseAspectForDestination(INTENT_PROFILES.vertical, twitch)).toBe('16:9');
  });
});

describe('buildAutomaticProduction', () => {
  it('produces one encode per distinct aspect and explains it in plain language', () => {
    const p = buildAutomaticProduction('talking', [youtube, tiktok, twitch]);
    expect(p.destinationAspects).toEqual({ yt: '16:9', tt: '9:16', tw: '16:9' });
    expect(p.formats.sort()).toEqual(['16:9', '9:16']);
    expect(p.settings.masterAspectRatio).toBe('16:9');
    expect(p.explanation.join(' ')).toMatch(/2 formats/);
    expect(p.explanation.join(' ')).not.toMatch(/bitrate|rtmp|codec|keyframe/i);
  });

  it('composes directly in 9:16 when every destination is vertical', () => {
    const p = buildAutomaticProduction('talking', [tiktok]);
    expect(p.settings.masterAspectRatio).toBe('9:16');
    expect(p.formats).toEqual(['9:16']);
  });

  it('keeps the intent master aspect when there are no destinations yet', () => {
    const p = buildAutomaticProduction('vertical', []);
    expect(p.settings.masterAspectRatio).toBe('9:16');
    expect(p.activeMomentId).toBe('main-camera');
  });

  it('sets gaming up as gameplay-first at 60 fps with system audio', () => {
    const p = buildAutomaticProduction('gaming', [twitch]);
    expect(p.settings.qualityPreset).toBe('1080p60');
    expect(p.activeMomentId).toBe('screen-share');
    expect(p.moments[0]?.name).toBe('Gameplay');
    expect(p.moments[0]?.audio.systemAudio).toBe(true);
    const cam = p.moments[0]?.layers.find((l) => l.kind === 'camera');
    expect(cam?.placement.default.x).toBeLessThan(0.5); // bottom-left for gaming
  });

  it('puts the presentation camera bottom-right and names the moment Slides', () => {
    const p = buildAutomaticProduction('presentation', [youtube]);
    expect(p.moments[0]?.name).toBe('Slides');
    const cam = p.moments[0]?.layers.find((l) => l.kind === 'camera');
    expect(cam?.placement.default.x).toBeGreaterThan(0.5);
  });

  it('never loses built-in moments (Pro can still reach them)', () => {
    const moments = layoutMomentsForIntent(INTENT_PROFILES.vertical);
    expect(moments.map((m) => m.id).sort()).toEqual(['break', 'ending', 'guest', 'main-camera', 'screen-share', 'starting-soon']);
  });
});

describe('insetToSafeArea', () => {
  it('keeps vertical text out of the chat and action zones', () => {
    const r = insetToSafeArea({ x: 0.1, y: 0.8, w: 0.8, h: 0.2 }, '9:16');
    const s = SAFE_AREAS['9:16'];
    expect(r.y + r.h).toBeLessThanOrEqual(1 - s.bottom + 1e-9);
    expect(r.x + r.w).toBeLessThanOrEqual(1 - s.right + 1e-9);
    expect(r.x).toBeGreaterThanOrEqual(s.left);
  });

  it('is a no-op for rects already inside the safe area', () => {
    expect(insetToSafeArea({ x: 0.2, y: 0.2, w: 0.5, h: 0.3 }, '16:9')).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.3 });
  });
});
