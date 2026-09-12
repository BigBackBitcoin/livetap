/**
 * The public experience's data.
 *
 * `/` ships without React and without `@livetap/core`, because importing the orchestrator to
 * paint a marketing page would drag the adapters and the media engine onto a document whose
 * whole budget is 60 KB gzipped (`LIVETAP_MOTION_SYSTEM.md` §6.1). So the handful of constants
 * the page computes from are copied here, every one of them with a comment naming its source,
 * and `src/__tests__/public-data.test.ts` imports the real values and fails if a copy drifts.
 *
 * Nothing in this file is invented. Every capability, aspect ratio, placement and safe-area
 * number is the product's own.
 */

/* ------------------------------------------------------------------ formats */

export const FORMATS = ['16:9', '9:16', '1:1'] as const;
export type Format = (typeof FORMATS)[number];

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Source: packages/core/src/production/intents.ts — SAFE_AREAS, verbatim. */
export const SAFE_AREAS: Record<Format, Insets> = {
  '16:9': { top: 0.05, bottom: 0.06, left: 0.05, right: 0.05 },
  '9:16': { top: 0.12, bottom: 0.28, left: 0.05, right: 0.16 },
  '1:1': { top: 0.06, bottom: 0.12, left: 0.06, right: 0.06 },
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Source: intents.ts — insetToSafeArea(), copied verbatim including the rounding. */
export function insetToSafeArea(rect: Rect, aspect: Format): Rect {
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

/** Source: intents.ts — chooseAspectForDestination(), copied so the page can run it. */
export function chooseAspect(
  preference: readonly Format[],
  dest: { aspects: readonly Format[]; preferred: Format },
): Format {
  for (const aspect of preference) if (dest.aspects.includes(aspect)) return aspect;
  return dest.preferred;
}

/* ------------------------------------------------------------- destinations */

export type Method = 'connect' | 'key';

export interface Destination {
  id: string;
  name: string;
  method: Method;
  aspects: readonly Format[];
  preferred: Format;
  autoStarts: boolean;
  chat: boolean;
  /** Most the platform's own documentation says it will accept, in Mbps. */
  ceilingMbps: number;
  note: string;
}

/**
 * Source: packages/adapters/src/profiles/{youtube,twitch,tiktok,instagram,x,facebook}.ts
 *
 * `method` is DERIVED from `capabilities.streamKey` through the same three-way mapping the
 * app's onboarding uses: an automated class means the account is connected once and LIVETAP
 * does the rest; `USER_ASSISTED` means the person pastes a key. It is never hand-written.
 * Order is fixed and is never re-sorted (app tenet 9).
 */
export const DESTINATIONS: readonly Destination[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    method: 'connect',
    aspects: ['16:9', '9:16'],
    preferred: '16:9',
    autoStarts: false,
    chat: true,
    ceilingMbps: 40,
    note: '',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    method: 'connect',
    aspects: ['16:9', '9:16'],
    preferred: '16:9',
    autoStarts: true,
    chat: true,
    ceilingMbps: 6,
    note: '',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    method: 'key',
    aspects: ['9:16'],
    preferred: '9:16',
    autoStarts: false,
    chat: false,
    ceilingMbps: 4.5,
    note: 'You start and end the broadcast in TikTok. LIVETAP sends the picture.',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    method: 'key',
    aspects: ['9:16'],
    preferred: '9:16',
    autoStarts: false,
    chat: false,
    ceilingMbps: 6,
    note: 'The key changes every session, so LIVETAP never stores it.',
  },
  {
    id: 'x',
    name: 'X',
    method: 'key',
    aspects: ['16:9'],
    preferred: '16:9',
    autoStarts: false,
    chat: false,
    ceilingMbps: 9,
    note: 'Sending the picture alone does not make you live. You start it on X.',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    method: 'connect',
    aspects: ['16:9', '9:16'],
    preferred: '16:9',
    autoStarts: true,
    chat: true,
    ceilingMbps: 9,
    note: 'Needs Facebook app review and business verification before it works for you.',
  },
];

export const METHOD_LABEL: Record<Method, string> = {
  connect: 'Connect account',
  key: 'Paste stream key',
};

export const METHOD_TONE: Record<Method, string> = { connect: 'success', key: 'info' };

/** The app's own demo target. It resolves nowhere, which is the point. */
export const DEMO_TARGET = 'demo.livetap.invalid';

/* -------------------------------------------------------------------- states */

/** Source: packages/core/src/types/destination.ts — DESTINATION_STATES. */
export const STATES = [
  'DISCONNECTED',
  'AUTHENTICATING',
  'READY',
  'STARTING',
  'LIVE',
  'DEGRADED',
  'RECONNECTING',
  'FAILED',
  'STOPPING',
  'ENDED',
] as const;
export type State = (typeof STATES)[number];

/** Source: PRODUCT_SPEC §4.2 — the label, the dot treatment and the pulse rule per state. */
export const STATE_LABEL: Record<State, string> = {
  DISCONNECTED: 'Not connected',
  AUTHENTICATING: 'Signing in',
  READY: 'Ready',
  STARTING: 'Starting',
  LIVE: 'Live',
  DEGRADED: 'Live, rough',
  RECONNECTING: 'Reconnecting',
  FAILED: 'Failed',
  STOPPING: 'Stopping',
  ENDED: 'Ended',
};

export const DOT: Record<State, 'ring' | 'solid' | 'pulse' | 'glyph'> = {
  DISCONNECTED: 'ring',
  AUTHENTICATING: 'solid',
  READY: 'solid',
  STARTING: 'solid',
  LIVE: 'pulse',
  DEGRADED: 'solid',
  RECONNECTING: 'pulse',
  FAILED: 'glyph',
  STOPPING: 'solid',
  ENDED: 'solid',
};

/**
 * Source: packages/core/src/destination/stateMachine.ts — the transitions this page can reach.
 * The page mirrors the table rather than re-deciding it, so a state the product cannot enter
 * cannot be entered here either.
 */
export const TRANSITIONS: Partial<Record<State, Partial<Record<string, State>>>> = {
  DISCONNECTED: { CONNECT: 'AUTHENTICATING' },
  AUTHENTICATING: { AUTH_OK: 'READY', DISCONNECT: 'DISCONNECTED' },
  READY: { START: 'STARTING', DISCONNECT: 'DISCONNECTED' },
  STARTING: { STREAM_UP: 'LIVE', STOP: 'STOPPING' },
  LIVE: { STREAM_DEGRADED: 'DEGRADED', STREAM_LOST: 'RECONNECTING', STOP: 'STOPPING' },
  DEGRADED: { STREAM_RECOVERED: 'LIVE', STREAM_LOST: 'RECONNECTING', STOP: 'STOPPING' },
  RECONNECTING: { STREAM_UP: 'LIVE', STOP: 'STOPPING' },
  STOPPING: { STOPPED: 'ENDED' },
  ENDED: { RESET: 'READY', DISCONNECT: 'DISCONNECTED' },
};

/** Mirrors nextDestinationState(): null when the product would refuse the move. */
export function nextState(from: State, event: string): State | null {
  return TRANSITIONS[from]?.[event] ?? null;
}

/**
 * One letter per state, all ten distinct.
 *
 * The public page publishes a compact signature of what actually paints so the verification
 * harness can check the acts that are flow markers. First letters would collide four ways
 * (DISCONNECTED with DEGRADED, READY with RECONNECTING, STARTING with STOPPING), and a
 * signature that cannot tell LIVE from DEGRADED is worse than none.
 */
export const STATE_CODE: Record<State, string> = {
  DISCONNECTED: 'x',
  AUTHENTICATING: 'a',
  READY: 'r',
  STARTING: 's',
  LIVE: 'L',
  DEGRADED: 'g',
  RECONNECTING: 'c',
  FAILED: 'f',
  STOPPING: 'p',
  ENDED: 'e',
};

/** Source: PRODUCT_SPEC §4.2. Exactly two states pulse, and these are they. */
export const PULSING: readonly State[] = ['LIVE', 'RECONNECTING'];

/** Source: packages/core/src/destination/reconnect.ts — DEFAULT_RECONNECT_POLICY.maxAttempts. */
export const MAX_ATTEMPTS = 10;

/**
 * The demo's retry interval, in seconds.
 *
 * The product's own first retry lands in about a second, and PRODUCT_REVIEW §3 recorded that
 * as too fast for a person to read the card the demonstration exists to show. Four seconds is
 * the honest fix to a measured defect on a surface that says it is a demo.
 */
export const RETRY_SECONDS = 4;

/* -------------------------------------------------------------------- moments */

export type LayerKind = 'color' | 'camera' | 'screen' | 'guest' | 'text';

export interface MomentLayer {
  kind: LayerKind;
  /** Normalized placement per format; `default` covers anything not named. */
  at?: { default: Rect; '9:16'?: Rect };
  text?: string;
  fit?: 'cover' | 'contain';
  radius?: number;
  visible?: boolean;
}

export interface MomentDef {
  id: string;
  name: string;
  transition: 'fade' | 'slide';
  ms: number;
  micMuted: boolean;
  layers: readonly MomentLayer[];
}

/**
 * Source: packages/core/src/moments/defaults.ts — defaultMoments(), placements verbatim.
 *
 * Only the fields the page paints are copied: no audio device ids, no transitions it cannot
 * run. The two background hex values in the product's own Moments are deliberately NOT copied,
 * because a raw hex in this page's CSS is a lint failure and because the stage's ground should
 * be the product's ground.
 */
export const MOMENTS: readonly MomentDef[] = [
  {
    id: 'starting-soon',
    name: 'Starting Soon',
    transition: 'fade',
    ms: 400,
    micMuted: true,
    layers: [
      { kind: 'color' },
      { kind: 'text', text: 'Starting soon', at: { default: { x: 0.1, y: 0.38, w: 0.8, h: 0.24 } } },
      {
        kind: 'camera',
        visible: false,
        at: {
          default: { x: 0.78, y: 0.72, w: 0.18, h: 0.24 },
          '9:16': { x: 0.6, y: 0.78, w: 0.34, h: 0.18 },
        },
        radius: 24,
      },
    ],
  },
  {
    id: 'main-camera',
    name: 'Main Camera',
    transition: 'fade',
    ms: 300,
    micMuted: false,
    layers: [{ kind: 'camera', at: { default: { x: 0, y: 0, w: 1, h: 1 } }, fit: 'cover' }],
  },
  {
    id: 'screen-share',
    name: 'Screen Share',
    transition: 'fade',
    ms: 300,
    micMuted: false,
    layers: [
      { kind: 'color' },
      {
        kind: 'screen',
        at: { default: { x: 0, y: 0, w: 1, h: 1 }, '9:16': { x: 0, y: 0.2, w: 1, h: 0.4 } },
        fit: 'contain',
      },
      {
        kind: 'camera',
        at: {
          default: { x: 0.74, y: 0.7, w: 0.22, h: 0.26 },
          '9:16': { x: 0.1, y: 0.62, w: 0.8, h: 0.3 },
        },
        radius: 20,
      },
    ],
  },
  {
    id: 'guest',
    name: 'Guest',
    transition: 'slide',
    ms: 350,
    micMuted: false,
    layers: [
      { kind: 'color' },
      {
        kind: 'camera',
        at: {
          default: { x: 0.02, y: 0.15, w: 0.47, h: 0.7 },
          '9:16': { x: 0.05, y: 0.06, w: 0.9, h: 0.42 },
        },
        radius: 20,
      },
      {
        kind: 'guest',
        at: {
          default: { x: 0.51, y: 0.15, w: 0.47, h: 0.7 },
          '9:16': { x: 0.05, y: 0.52, w: 0.9, h: 0.42 },
        },
        radius: 20,
      },
    ],
  },
  {
    id: 'break',
    name: 'Break',
    transition: 'fade',
    ms: 500,
    micMuted: true,
    layers: [
      { kind: 'color' },
      {
        kind: 'text',
        text: 'Back in a moment',
        at: { default: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 } },
      },
    ],
  },
  {
    id: 'ending',
    name: 'Ending',
    transition: 'fade',
    ms: 600,
    micMuted: false,
    layers: [
      { kind: 'color' },
      {
        kind: 'text',
        text: 'Thanks for watching',
        at: { default: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 } },
      },
    ],
  },
];

/** Source: intents.ts — renameForIntent(). */
export const RENAME: Record<string, Record<string, string>> = {
  gaming: { 'screen-share': 'Gameplay' },
  presentation: { 'screen-share': 'Slides' },
  podcast: { guest: 'Conversation' },
};

/* -------------------------------------------------------------------- intents */

export interface IntentDef {
  id: string;
  title: string;
  tagline: string;
  preference: readonly Format[];
  master: Format;
  firstMoment: string;
  whatYouGet: readonly string[];
}

/**
 * Source: packages/core/src/production/intents.ts — INTENT_PROFILES.
 *
 * `emoji` is deliberately not copied: the page draws IntentIcon, never an emoji glyph
 * (LIVETAP_VISUAL_DIRECTION.md §5).
 */
export const INTENTS: readonly IntentDef[] = [
  {
    id: 'talking',
    title: 'Talking',
    tagline: 'Just you and the camera.',
    preference: ['16:9', '9:16', '1:1'],
    master: '16:9',
    firstMoment: 'main-camera',
    whatYouGet: [
      'Full-frame camera',
      'Clean lower-third',
      'Auto vertical crop for TikTok and Shorts',
    ],
  },
  {
    id: 'gaming',
    title: 'Gaming',
    tagline: 'Your game, with you in the corner.',
    preference: ['16:9', '9:16'],
    master: '16:9',
    firstMoment: 'screen-share',
    whatYouGet: [
      'Game capture with camera picture-in-picture',
      '60 fps where the platform allows',
      'Game audio and mic balanced',
    ],
  },
  {
    id: 'podcast',
    title: 'Podcast',
    tagline: 'You and a guest, side by side.',
    preference: ['16:9', '1:1', '9:16'],
    master: '16:9',
    firstMoment: 'guest',
    whatYouGet: [
      'Split layout for two people',
      'Voice-first audio processing',
      'Square and vertical versions for clips',
    ],
  },
  {
    id: 'presentation',
    title: 'Presentation',
    tagline: 'Your screen, with you alongside.',
    preference: ['16:9', '9:16'],
    master: '16:9',
    firstMoment: 'screen-share',
    whatYouGet: [
      'Screen share with camera inset',
      'Readable text at 1080p',
      'Slides stay sharp on every platform',
    ],
  },
  {
    id: 'event',
    title: 'Event',
    tagline: 'A stage, a camera, an audience.',
    preference: ['16:9', '1:1', '9:16'],
    master: '16:9',
    firstMoment: 'starting-soon',
    whatYouGet: [
      'Wide camera framing',
      'Starting-soon and break screens',
      'Steady 30 fps for long sessions',
    ],
  },
  {
    id: 'vertical',
    title: 'Vertical Live',
    tagline: 'Built for phones, first.',
    preference: ['9:16', '1:1', '16:9'],
    master: '9:16',
    firstMoment: 'main-camera',
    whatYouGet: [
      '9:16 composition with safe areas for chat',
      'Face-forward framing',
      'Also works on YouTube and Facebook',
    ],
  },
];

/* ----------------------------------------------------------------------- chat */

/**
 * Source: packages/adapters/src/mock/corpus.ts — MOCK_DISPLAY_NAMES, MOCK_MESSAGES,
 * MOCK_BADGE_POOL. Trimmed to 18 names and 28 messages to stay inside the page's JS budget;
 * the trim keeps the corpus's mix of greetings, reactions, notes and questions, and every
 * string is one of the product's own.
 */
export const CHAT_NAMES: readonly string[] = [
  'pixelnomad',
  'Marta_Oduya',
  'quietcoyote',
  'DevonWasHere',
  'lofi_gremlin',
  'Sam K.',
  'northwindow',
  'tanuki_tv',
  'Priya R',
  'saltandsolder',
  'Kaz',
  'midnight_diner',
  'HelenaBuilds',
  'roux',
  'TomasFPV',
  'Yara',
  'sundaycoder',
  'OllieOnAir',
];

export const CHAT_MESSAGES: readonly string[] = [
  'hello from Lisbon',
  'audio is perfect today',
  'that transition was clean',
  'wait how did you do that',
  'been waiting all week for this',
  'good morning everyone',
  'the new overlay looks so much better',
  'chat is fast today',
  'oh that is clever',
  'what camera are you on?',
  'do you have the link for that?',
  'this is genuinely useful thank you',
  'I just got here, what did I miss?',
  'the lighting is so much nicer now',
  'quick question: does it work offline?',
  'brb making tea',
  'back',
  'greetings from the night shift',
  'the captions are keeping up nicely',
  'please do a part two',
  'thats a really tidy solution',
  'is the vod going to be up later?',
  'my cat is watching too',
  'what keyboard is that',
  'the colour grade is lovely',
  'signal looks rock solid from here',
  'how many destinations are you on right now?',
  'I am taking notes, keep going',
];

/** The real distribution: mostly nobody, a few regulars. */
export const CHAT_BADGES: readonly (string | null)[] = [
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  'subscriber',
  'subscriber',
  'member',
  'moderator',
  'verified',
];

/**
 * Only the platforms whose `capabilities.chatRead` is an automated class. The other three
 * publish no live chat API, and the panel says so once rather than faking their audience.
 */
export const CHAT_PLATFORMS: readonly string[] = ['youtube', 'twitch', 'facebook'];

/* ------------------------------------------------------------------- sessions */

/** Source: INTENT_PROFILES.talking.qualityPreset, the page's default intent. */
export const DEFAULT_QUALITY = '1080p30';

/** The same preset as the app's own describePreset() renders it. */
export const DEFAULT_QUALITY_LABEL = '1080p, 30 fps';

/** The one height every preset in the product's default range produces. */
export const DEFAULT_HEIGHT = '1080p';
