/**
 * The palette is a contract, not a preference.
 *
 * DESIGN_SYSTEM.md §2.2/§2.3 publish a contrast ratio for every documented colour
 * pair. This test recomputes all of them from the WCAG 2.1 relative-luminance
 * formula, so a "small tweak" to a hex value fails here instead of shipping.
 */

import { describe, expect, it } from 'vitest';
import { DESTINATION_STATES } from '@livetap/core';
import type { HealthLevel } from '@livetap/core';
import {
  darkPalette,
  lightPalette,
  palettes,
  space,
  radius,
  typeScale,
  duration,
  breakpoint,
  STATE_LABEL,
  HEALTH_HEADLINE,
  PULSING_STATES,
  stateVar,
  healthVar,
} from './tokens.js';
import type { ThemePalette } from './tokens.js';

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const HEALTH_LEVELS: HealthLevel[] = [
  'excellent',
  'good',
  'fair',
  'poor',
  'critical',
  'unknown',
];

function layers(p: ThemePalette): Array<[string, string]> {
  return [
    ['bg-0', p.bg0],
    ['bg-1', p.bg1],
    ['bg-2', p.bg2],
    ['bg-3', p.bg3],
  ];
}

describe.each(Object.entries(palettes))('%s theme contrast', (themeName, p) => {
  const foregrounds: Array<[string, string]> = [
    ['text-primary', p.textPrimary],
    ['text-secondary', p.textSecondary],
    ['text-tertiary', p.textTertiary],
    ['accent-live', p.accentLive],
    ['accent-focus', p.accentFocus],
    ['success', p.success],
    ['warning', p.warning],
    ['danger', p.danger],
    ['info', p.info],
  ];

  it.each(foregrounds)('%s meets AA on all four background layers', (_name, fg) => {
    for (const [, bg] of layers(p)) {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('every text-on-solid-fill pair meets AA', () => {
    expect(contrast(p.onLive, p.accentLiveSolid)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(p.onFocus, p.accentFocusSolid)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(p.onDanger, p.dangerSolid)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('border-control and the focus ring meet the 3:1 non-text requirement', () => {
    for (const [, bg] of layers(p)) {
      expect(contrast(p.borderControl, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(contrast(p.accentFocus, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it('every destination state reads at AA on its own tonal chip', () => {
    for (const state of DESTINATION_STATES) {
      const entry = p.state[state];
      // LIVE is the one solid-filled chip: its "tint" is the fill, and the label
      // colour is the theme's on-live, not the state foreground.
      const fg = state === 'LIVE' ? p.onLive : entry.fg;
      expect(contrast(fg, entry.tint), `${themeName} ${state}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('every destination state reads at AA on bg-1 and bg-2', () => {
    for (const state of DESTINATION_STATES) {
      expect(contrast(p.state[state].fg, p.bg1), state).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(p.state[state].fg, p.bg2), state).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('every health level reads at AA on its tint and on bg-1', () => {
    for (const level of HEALTH_LEVELS) {
      const entry = p.health[level];
      expect(contrast(entry.fg, entry.tint), level).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(entry.fg, p.bg1), level).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('background layers are genuinely distinct, so a card never vanishes', () => {
    const values = layers(p).map(([, hex]) => luminance(hex));
    const unique = new Set(values.map((v) => v.toFixed(4)));
    expect(unique.size).toBe(4);
  });

  it('LIVE and FAILED never share a colour value', () => {
    expect(p.state.LIVE.fg).not.toBe(p.state.FAILED.fg);
  });
});

describe('palette completeness', () => {
  it('covers all 10 destination states in both themes', () => {
    for (const p of [darkPalette, lightPalette]) {
      for (const state of DESTINATION_STATES) {
        expect(p.state[state].fg).toMatch(/^#[0-9A-F]{6}$/);
        expect(p.state[state].tint).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it('covers all 6 health levels in both themes', () => {
    for (const p of [darkPalette, lightPalette]) {
      for (const level of HEALTH_LEVELS) {
        expect(p.health[level].fg).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it('gives every state and level a human-facing word', () => {
    for (const state of DESTINATION_STATES) {
      expect(STATE_LABEL[state].length).toBeGreaterThan(0);
    }
    for (const level of HEALTH_LEVELS) {
      expect(HEALTH_HEADLINE[level].length).toBeGreaterThan(0);
    }
    // "unknown" is never shown as "Unknown": the honest word is what we are doing.
    expect(HEALTH_HEADLINE.unknown).toBe('Checking');
  });

  it('pulses exactly two states, forever', () => {
    expect([...PULSING_STATES]).toEqual(['LIVE', 'RECONNECTING']);
  });
});

describe('structural scales', () => {
  it('keeps spacing on the 4 grid, with one documented 2px half-step', () => {
    const px = Object.values(space).map((v) => Number.parseInt(v, 10));
    expect(px.filter((n) => n !== 0 && n !== 2 && n % 4 !== 0)).toEqual([]);
  });

  it('exposes exactly the five documented radii', () => {
    expect(Object.keys(radius)).toEqual(['sm', 'md', 'lg', 'xl', 'full']);
  });

  it('exposes exactly the nine documented type steps, each with a line height', () => {
    const keys = Object.keys(typeScale);
    expect(keys).toEqual(['12', '13', '14', '16', '18', '22', '28', '36', '48']);
    for (const step of Object.values(typeScale)) {
      const size = Number.parseInt(step.size, 10);
      const leading = Number.parseInt(step.leading, 10);
      expect(leading).toBeGreaterThanOrEqual(size);
    }
  });

  it('keeps the three interaction durations at 120/200/320ms', () => {
    expect([duration.fast, duration.base, duration.slow]).toEqual([120, 200, 320]);
  });

  it('keeps the documented breakpoints', () => {
    expect(breakpoint.mobile).toBe(640);
    expect(breakpoint.tablet).toBe(1024);
    expect(breakpoint.desktop).toBe(1025);
  });
});

describe('css variable helpers', () => {
  it('maps a state to its lower-cased custom property', () => {
    expect(stateVar('RECONNECTING')).toBe('var(--lt-state-reconnecting)');
    expect(stateVar('LIVE', 'tint')).toBe('var(--lt-state-live-tint)');
  });

  it('maps a health level to its custom property', () => {
    expect(healthVar('critical')).toBe('var(--lt-health-critical)');
    expect(healthVar('good', 'tint')).toBe('var(--lt-health-good-tint)');
  });
});
