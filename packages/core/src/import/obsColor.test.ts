import { describe, expect, it } from 'vitest';
import { obsColorToCss, obsColorToHex, obsColorWithOpacityToCss, parseObsColor } from './obsColor.js';

describe('obsColorToHex', () => {
  it('reads OBS ABGR integers (lowest byte is red)', () => {
    // 0xFFFFFFFF: A=FF, B=FF, G=FF, R=FF
    expect(obsColorToHex(4294967295)).toBe('#FFFFFF');
    // 0xFF0000FF: A=FF, B=00, G=00, R=FF
    expect(obsColorToHex(4278190335)).toBe('#FF0000');
    // 0xFFFF0000: A=FF, B=FF, G=00, R=00
    expect(obsColorToHex(4294901760)).toBe('#0000FF');
    // 0xFF00FF00: A=FF, B=00, G=FF, R=00
    expect(obsColorToHex(4278255360)).toBe('#00FF00');
    // 0xFF000000: opaque black
    expect(obsColorToHex(4278190080)).toBe('#000000');
  });

  it('accepts a signed representation of the same bits and numeric strings', () => {
    expect(obsColorToHex(-1)).toBe('#FFFFFF');
    expect(obsColorToHex('4278190335')).toBe('#FF0000');
  });

  it('returns undefined rather than guessing when the value is not a colour', () => {
    for (const bad of [undefined, null, 'red', '#fff', {}, [], NaN, Infinity, 1e20]) {
      expect(obsColorToHex(bad)).toBeUndefined();
      expect(parseObsColor(bad)).toBeUndefined();
    }
  });
});

describe('alpha handling', () => {
  it('keeps hex when opaque and switches to rgba when translucent', () => {
    expect(obsColorToCss(4278190335)).toBe('#FF0000');
    // 0x800000FF: half-transparent red
    expect(obsColorToCss(2147483903)).toBe('rgba(255, 0, 0, 0.502)');
    expect(parseObsColor(4278190080)?.a).toBe(1);
  });

  it('composes a separate 0..100 opacity field, as the text source stores it', () => {
    expect(obsColorWithOpacityToCss(4278190080, 100)).toBe('#000000');
    expect(obsColorWithOpacityToCss(4278190080, 50)).toBe('rgba(0, 0, 0, 0.5)');
    expect(obsColorWithOpacityToCss('nope', 50)).toBeUndefined();
  });
});
