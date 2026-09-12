/**
 * The strings that appear more than twice in the product.
 * Single source of truth — PRODUCT_SPEC §6.4. Case is part of the string.
 */
export const COPY = {
  promise: 'Connect your accounts. Pick where you want to go live. Tap GO LIVE.',
  goLive: 'GO LIVE',
  goLiveDemo: 'GO LIVE (DEMO)',
  end: 'END',
  undo: 'UNDO',
  cancel: 'Cancel',
  addDestination: 'Add destination',
  connectAccount: 'Connect account',
  pasteKey: 'Paste stream key',
  notAvailable: 'Not available yet',
  replaceKey: 'Replace key',
  retry: 'Try again',
  signInAgain: 'Sign in again',
  chooseCamera: 'Choose a camera',
  chooseMic: 'Choose a microphone',
  download: 'Download',
  readySubtitle: 'Goes live when you tap GO LIVE',
  notConnectedSubtitle: 'Sign in to use this destination',
  demo: 'Demo',
  preflightGreen: 'Ready to go live',
  preflightRed: 'Not ready to go live',
  goLiveNone: 'No destination is ready',
  openStudio: 'Open Studio',
  noCamera: 'No camera found — using a test pattern',
  repo: 'https://github.com/BigBackBitcoin/livetap',
} as const;

/** "Going live on 3" — PRODUCT_SPEC §6.3 (the tight subtitle form). */
export function goLiveCount(n: number): string {
  return `Going live on ${n}`;
}

/** "Live on 3" */
export function liveCount(n: number): string {
  return `Live on ${n}`;
}

/** "1 destination" / "3 destinations" — the noun always takes the number's plural. */
export function destinationCount(n: number): string {
  return `${n} ${n === 1 ? 'destination' : 'destinations'}`;
}

export function thingsToKnow(n: number): string {
  return n === 1 ? 'Ready — with one thing to know' : `Ready — with ${n} things to know`;
}
