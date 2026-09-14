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
  /**
   * The ids of the destinations that are simulated, from `broadcastReality`.
   *
   * Passed in rather than read from `config.mock`, because `config.mock` is what the destination
   * was CONFIGURED as and the question here is what it will actually DO. Omitted, this falls back
   * to the config, which is right for a caller that has no runtime to ask.
   */
  simulatedIds?: ReadonlySet<string>;
}

/**
 * Which adapters and which engine this build actually constructed.
 *
 * Deliberately spelled out rather than imported from `../state/`: these are the exact unions
 * `RegistryKind` and `EngineHost`, so a caller passing the store's values type-checks, and a
 * drift in either becomes a compile error at the call site rather than a silent widening here.
 */
export interface RealityOfBuild {
  adapters: 'mock' | 'real' | 'injected';
  engine: 'browser' | 'desktop' | 'mobile' | 'mock';
}

export interface BroadcastReality {
  /** Destinations that will genuinely receive bytes. */
  real: DestinationSnapshot[];
  /** Destinations that are switched on and will receive nothing. */
  simulated: DestinationSnapshot[];
  simulatedIds: ReadonlySet<string>;
  /** True when nothing at all leaves this machine. */
  allSimulated: boolean;
  /** What makes it simulated, when something is. Null when every enabled destination is real. */
  reason: 'adapters' | 'engine' | 'destinations' | null;
}

/**
 * Is this broadcast real, and if not, why not - observed, never configured.
 *
 * This is the one selector the honesty banner, the GO LIVE label, the countdown length, the
 * subtitle and the live bar all read, so they cannot disagree. It exists because the build-time
 * answer was wrong in a way a creator could be hurt by: with demo mode on and one Custom RTMP
 * destination added, `addCustomDestination` writes `mock: false`, so the banner hid itself, the
 * demo badges disappeared, the button read GO LIVE and then "Live on 1" - while the mock adapter
 * and the mock engine sent nothing anywhere.
 *
 * Two facts about the running process outrank anything a destination claims about itself:
 * simulated adapters mean no platform is ever contacted, and a simulated engine means no frames
 * are ever encoded. Either one makes every destination simulated, whatever its config says.
 */
export function broadcastReality(
  destinations: DestinationSnapshot[],
  adapters: RealityOfBuild['adapters'],
  engine: RealityOfBuild['engine'],
): BroadcastReality {
  const enabled = destinations.filter((d) => d.config.enabled);
  const everything: 'adapters' | 'engine' | null =
    adapters === 'mock' ? 'adapters' : engine === 'mock' ? 'engine' : null;

  const simulated = everything !== null ? enabled : enabled.filter((d) => d.config.mock);
  const real = everything !== null ? [] : enabled.filter((d) => !d.config.mock);
  const simulatedIds = new Set(simulated.map((d) => d.config.id));

  return {
    real,
    simulated,
    simulatedIds,
    allSimulated: enabled.length > 0 && real.length === 0,
    reason: simulated.length === 0 ? null : (everything ?? 'destinations'),
  };
}

/** One sentence naming the destinations a broadcast will actually reach. Never a count alone. */
export function nameDestinations(list: DestinationSnapshot[]): string {
  const labels = list.map((d) => d.config.label);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0] as string;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

export function evaluatePreflight(input: PreflightInput): Preflight {
  const enabled = input.destinations.filter((d) => d.config.enabled);
  const ready = enabled.filter((d) => d.state === 'READY');
  const failed = enabled.filter((d) => d.state === 'FAILED');
  const demos = enabled.filter((d) =>
    input.simulatedIds ? input.simulatedIds.has(d.config.id) : d.config.mock,
  );
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
