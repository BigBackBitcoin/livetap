/**
 * Pre-flight readiness (PRODUCT_SPEC §4.5).
 *
 * It runs continuously while Studio is open, not once on a button press, and it states
 * consequences rather than issuing verdicts. Only two conditions are red, because only two
 * make a stream impossible: nothing is READY, or the device is offline. Amber never blocks.
 */
import type { DestinationSnapshot } from '@livetap/core';

export type PreflightLevel = 'green' | 'amber' | 'red';

export interface PreflightItem {
  id: string;
  /** The condition and its consequence, in one sentence. */
  text: string;
  /** One inline fix, when one exists. */
  fix?: { label: string; to: string };
}

export interface Preflight {
  level: PreflightLevel;
  headline: string;
  items: PreflightItem[];
  readyCount: number;
  demoCount: number;
  attentionCount: number;
}

export interface PreflightInput {
  destinations: DestinationSnapshot[];
  online: boolean;
  hasCamera: boolean;
  hasMic: boolean;
  micMuted: boolean;
  recording: boolean;
}

export function evaluatePreflight(input: PreflightInput): Preflight {
  const enabled = input.destinations.filter((d) => d.config.enabled);
  const ready = enabled.filter((d) => d.state === 'READY');
  const failed = enabled.filter((d) => d.state === 'FAILED');
  const demos = enabled.filter((d) => d.config.mock);
  const items: PreflightItem[] = [];

  if (!input.online) {
    return {
      level: 'red',
      headline: 'Not ready to go live',
      items: [{ id: 'offline', text: 'This device is offline, so nothing can be sent anywhere.' }],
      readyCount: 0,
      demoCount: demos.length,
      attentionCount: failed.length,
    };
  }

  if (ready.length === 0) {
    return {
      level: 'red',
      headline: 'Not ready to go live',
      items: [
        {
          id: 'no-destination',
          text: 'No destination is ready — that is the one thing LIVETAP cannot do for you.',
          fix: { label: 'Add a destination', to: '/app/destinations' },
        },
      ],
      readyCount: 0,
      demoCount: demos.length,
      attentionCount: failed.length,
    };
  }

  if (!input.hasCamera) {
    items.push({
      id: 'no-camera',
      text: 'No camera found — viewers will see your title card instead of your face.',
      fix: { label: 'Run setup again', to: '/app/start' },
    });
  }
  if (!input.hasMic) {
    items.push({
      id: 'no-mic',
      text: 'No microphone found — viewers will hear nothing.',
      fix: { label: 'Run setup again', to: '/app/start' },
    });
  } else if (input.micMuted) {
    items.push({ id: 'muted', text: 'Your microphone is muted — viewers will hear nothing.' });
  }
  if (failed.length > 0) {
    items.push({
      id: 'failed',
      text: `${failed.length} ${failed.length === 1 ? 'destination needs' : 'destinations need'} attention and will be left out.`,
      fix: { label: 'See what happened', to: '/app/destinations' },
    });
  }
  if (demos.length > 0) {
    items.push({
      id: 'demo',
      text: `${demos.length} ${demos.length === 1 ? 'destination is a demo' : 'destinations are demos'} and will not broadcast anywhere.`,
      fix: { label: 'Manage destinations', to: '/app/destinations' },
    });
  }

  if (items.length === 0) {
    return {
      level: 'green',
      headline: 'Ready to go live',
      items,
      readyCount: ready.length,
      demoCount: 0,
      attentionCount: 0,
    };
  }

  return {
    level: 'amber',
    headline:
      items.length === 1 ? 'Ready — with one thing to know' : `Ready — with ${items.length} things to know`,
    items,
    readyCount: ready.length,
    demoCount: demos.length,
    attentionCount: failed.length,
  };
}

/** The GO LIVE subtitle. Demos and failures are counted separately and said out loud. */
export function goLiveSubtitle(p: Preflight): string {
  if (p.readyCount === 0) return 'No destination is ready';
  let subtitle = `Going live on ${p.readyCount}`;
  if (p.attentionCount > 0) {
    subtitle += ` · ${p.attentionCount} ${p.attentionCount === 1 ? 'needs' : 'need'} attention`;
  }
  if (p.demoCount > 0) {
    subtitle += ` · ${p.demoCount} ${p.demoCount === 1 ? 'is a demo' : 'are demos'}`;
  }
  return subtitle;
}
