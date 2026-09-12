/**
 * Typed mirror of ./tokens.css.
 *
 * Every value here exists as a CSS custom property with the same name prefixed `--lt-`.
 * Consumers should prefer the CSS variables; this module exists for
 *   - values JS genuinely needs (breakpoint queries, durations for timers),
 *   - tests that assert the palette,
 *   - tooling that audits contrast.
 *
 * Normative source: docs/design/DESIGN_SYSTEM.md
 */

import type { DestinationState, HealthLevel } from '@livetap/core';

/* ------------------------------------------------------------------ */
/* Structural                                                         */
/* ------------------------------------------------------------------ */

export const fontFamily = {
  sans:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Roboto, " +
    "'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",
  mono:
    "ui-monospace, SFMono-Regular, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, " +
    "'Liberation Mono', monospace",
} as const;

/** The nine-step type scale. Keys are the pixel size. */
export const typeScale = {
  12: { size: '12px', leading: '16px', tracking: '0.005em' },
  13: { size: '13px', leading: '18px', tracking: '0.005em' },
  14: { size: '14px', leading: '20px', tracking: '0' },
  16: { size: '16px', leading: '24px', tracking: '0' },
  18: { size: '18px', leading: '26px', tracking: '-0.005em' },
  22: { size: '22px', leading: '28px', tracking: '-0.01em' },
  28: { size: '28px', leading: '34px', tracking: '-0.014em' },
  36: { size: '36px', leading: '42px', tracking: '-0.018em' },
  48: { size: '48px', leading: '52px', tracking: '-0.022em' },
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

/** 4-based spacing scale. `'05'` is the 2px half-step. */
export const space = {
  0: '0px',
  '05': '2px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

export const radius = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  full: '9999px',
} as const;

export const duration = {
  /** Hover, press, focus, toggle knob. */
  fast: 120,
  /** Tabs, tooltips, popovers, selection. */
  base: 200,
  /** Sheets, modals, aspect changes, GO LIVE morph. */
  slow: 320,
  /** The live pulse (one full leg). */
  pulse: 1600,
  /** Spinner rotation. */
  spin: 800,
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  emphasis: 'cubic-bezier(0.2, 0, 0, 1.2)',
  pulse: 'cubic-bezier(0.4, 0, 0.6, 1)',
  linear: 'linear',
} as const;

export const breakpoint = {
  /** Mobile is everything below this. */
  mobile: 640,
  /** Tablet is 640 up to and including this. */
  tablet: 1024,
  /** Desktop starts here. */
  desktop: 1025,
} as const;

/** Ready-made media query strings, so no component invents its own breakpoint. */
export const mediaQuery = {
  mobile: '(max-width: 639.98px)',
  tablet: '(min-width: 640px) and (max-width: 1024px)',
  desktop: '(min-width: 1025px)',
  tabletUp: '(min-width: 640px)',
  coarsePointer: '(pointer: coarse)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  prefersLight: '(prefers-color-scheme: light)',
  prefersDark: '(prefers-color-scheme: dark)',
} as const;

export const focusRing = {
  width: '2px',
  offset: '2px',
} as const;

/** Minimum touch target on mobile / coarse pointers, in px. */
export const touchTargetMin = 44;

/* ------------------------------------------------------------------ */
/* Palettes                                                           */
/* ------------------------------------------------------------------ */

export interface StatePalette {
  /** Foreground / dot colour. */
  fg: string;
  /** Tonal chip background. For LIVE this is a *solid* fill. */
  tint: string;
}

export interface ThemePalette {
  bg0: string;
  bg1: string;
  bg2: string;
  bg3: string;
  border: string;
  borderStrong: string;
  /** The only border token that meets the 3:1 non-text requirement. */
  borderControl: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accentLive: string;
  accentLiveSolid: string;
  onLive: string;
  accentFocus: string;
  accentFocusSolid: string;
  onFocus: string;
  success: string;
  warning: string;
  danger: string;
  dangerSolid: string;
  onDanger: string;
  info: string;
  overlay: string;
  scrimPreview: string;
  shadow1: string;
  shadow2: string;
  shadow3: string;
  shadowLive: string;
  state: Record<DestinationState, StatePalette>;
  health: Record<HealthLevel, StatePalette>;
}

export const darkPalette: ThemePalette = {
  bg0: '#0A0B0D',
  bg1: '#121417',
  bg2: '#1A1D21',
  bg3: '#23272C',
  border: '#2D3238',
  borderStrong: '#3C434B',
  borderControl: '#6B7480',
  textPrimary: '#F2F4F7',
  textSecondary: '#A7B0BB',
  textTertiary: '#8A929C',
  accentLive: '#FF5F52',
  accentLiveSolid: '#FF4D3F',
  onLive: '#0A0B0D',
  accentFocus: '#6BA8FF',
  accentFocusSolid: '#2F6FE0',
  onFocus: '#FFFFFF',
  success: '#3FD98C',
  warning: '#F5B544',
  danger: '#FF6B6B',
  dangerSolid: '#C7332B',
  onDanger: '#FFFFFF',
  info: '#6BA8FF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  scrimPreview: 'rgba(10, 11, 13, 0.72)',
  shadow1: '0 1px 2px rgba(0, 0, 0, 0.4)',
  shadow2: '0 4px 12px rgba(0, 0, 0, 0.45)',
  shadow3: '0 12px 32px rgba(0, 0, 0, 0.55)',
  shadowLive: '0 0 0 1px rgba(255, 77, 63, 0.45), 0 6px 24px rgba(255, 77, 63, 0.28)',
  state: {
    DISCONNECTED: { fg: '#8A929C', tint: '#23272C' },
    AUTHENTICATING: { fg: '#6BA8FF', tint: '#273345' },
    READY: { fg: '#3FD98C', tint: '#203B32' },
    STARTING: { fg: '#45D0E8', tint: '#213A41' },
    LIVE: { fg: '#FF5F52', tint: '#FF4D3F' },
    DEGRADED: { fg: '#F5B544', tint: '#3D3527' },
    RECONNECTING: { fg: '#FF9F45', tint: '#3F3227' },
    FAILED: { fg: '#FF6B6B', tint: '#3F292D' },
    STOPPING: { fg: '#A7B0BB', tint: '#23272C' },
    ENDED: { fg: '#8A929C', tint: '#23272C' },
  },
  health: {
    excellent: { fg: '#2ED3A3', tint: '#1D3A36' },
    good: { fg: '#56D364', tint: '#243A2C' },
    fair: { fg: '#F5B544', tint: '#3D3527' },
    poor: { fg: '#FF9F45', tint: '#3F3227' },
    critical: { fg: '#FF6B6B', tint: '#3F292D' },
    unknown: { fg: '#8A929C', tint: '#23272C' },
  },
};

export const lightPalette: ThemePalette = {
  bg0: '#F4F6F8',
  bg1: '#FAFBFC',
  bg2: '#FFFFFF',
  bg3: '#E9EDF1',
  border: '#DCE1E7',
  borderStrong: '#C2CAD3',
  borderControl: '#75808D',
  textPrimary: '#0E1116',
  textSecondary: '#4A545F',
  textTertiary: '#5F6975',
  accentLive: '#C6362C',
  accentLiveSolid: '#D63A2D',
  onLive: '#FFFFFF',
  accentFocus: '#1A66D6',
  accentFocusSolid: '#1F66DE',
  onFocus: '#FFFFFF',
  success: '#0C7449',
  warning: '#8A5A00',
  danger: '#C0332B',
  dangerSolid: '#BE2F27',
  onDanger: '#FFFFFF',
  info: '#1A66D6',
  overlay: 'rgba(14, 17, 22, 0.4)',
  scrimPreview: 'rgba(10, 11, 13, 0.72)',
  shadow1: '0 1px 2px rgba(14, 17, 22, 0.06), 0 1px 1px rgba(14, 17, 22, 0.04)',
  shadow2: '0 4px 12px rgba(14, 17, 22, 0.08), 0 1px 2px rgba(14, 17, 22, 0.05)',
  shadow3: '0 12px 32px rgba(14, 17, 22, 0.12), 0 2px 6px rgba(14, 17, 22, 0.06)',
  shadowLive: '0 0 0 1px rgba(214, 58, 45, 0.35), 0 6px 24px rgba(214, 58, 45, 0.2)',
  state: {
    DISCONNECTED: { fg: '#5A646F', tint: '#F0F1F2' },
    AUTHENTICATING: { fg: '#1A66D6', tint: '#EAF1FB' },
    READY: { fg: '#0C7449', tint: '#E9F2EF' },
    STARTING: { fg: '#0E6E86', tint: '#E9F2F4' },
    LIVE: { fg: '#C6362C', tint: '#D63A2D' },
    DEGRADED: { fg: '#8A5A00', tint: '#F4F0E8' },
    RECONNECTING: { fg: '#9A4D00', tint: '#F6EFE8' },
    FAILED: { fg: '#C0332B', tint: '#F9EDEC' },
    STOPPING: { fg: '#4A545F', tint: '#EFF0F1' },
    ENDED: { fg: '#5F6975', tint: '#F1F2F3' },
  },
  health: {
    excellent: { fg: '#0A7360', tint: '#E9F2F1' },
    good: { fg: '#1F7A33', tint: '#EBF3ED' },
    fair: { fg: '#8A5A00', tint: '#F4F0E8' },
    poor: { fg: '#9A4D00', tint: '#F6EFE8' },
    critical: { fg: '#C0332B', tint: '#F9EDEC' },
    unknown: { fg: '#5A646F', tint: '#F0F1F2' },
  },
};

export const palettes = { dark: darkPalette, light: lightPalette } as const;

/** An explicit theme choice. `'system'` is a *preference*, not a palette. */
export type ThemeName = 'dark' | 'light';
export type ThemePreference = ThemeName | 'system';

/** localStorage key holding the user's theme preference. */
export const THEME_STORAGE_KEY = 'livetap.theme';

/* ------------------------------------------------------------------ */
/* CSS variable helpers                                               */
/* ------------------------------------------------------------------ */

/** `stateVar('LIVE')` -> `'var(--lt-state-live)'`. */
export function stateVar(state: DestinationState, part: 'fg' | 'tint' = 'fg'): string {
  const base = `--lt-state-${state.toLowerCase()}`;
  return part === 'fg' ? `var(${base})` : `var(${base}-tint)`;
}

/** `healthVar('poor')` -> `'var(--lt-health-poor)'`. */
export function healthVar(level: HealthLevel, part: 'fg' | 'tint' = 'fg'): string {
  const base = `--lt-health-${level}`;
  return part === 'fg' ? `var(${base})` : `var(${base}-tint)`;
}

/** The human-facing word for a health level. Never "Unknown" — the honest word is "Checking". */
export const HEALTH_HEADLINE: Record<HealthLevel, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  critical: 'Critical',
  unknown: 'Checking',
};

/** The human-facing word for each destination state. Always rendered — colour is never alone. */
export const STATE_LABEL: Record<DestinationState, string> = {
  DISCONNECTED: 'Not connected',
  AUTHENTICATING: 'Connecting',
  READY: 'Ready',
  STARTING: 'Starting',
  LIVE: 'Live',
  DEGRADED: 'Degraded',
  RECONNECTING: 'Reconnecting',
  FAILED: 'Failed',
  STOPPING: 'Stopping',
  ENDED: 'Ended',
};

/** Which states animate their dot. Exactly two, forever. */
export const PULSING_STATES: readonly DestinationState[] = ['LIVE', 'RECONNECTING'];
