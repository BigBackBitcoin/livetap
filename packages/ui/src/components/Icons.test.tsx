import { describe, expect, it } from 'vitest';
import { render, text } from '../testing/render.js';
import {
  ICON_NAMES,
  INTENT_NAMES,
  IntentIcon,
  MOMENT_ICON_IDS,
  MomentIcon,
  hasMomentGlyph,
} from './Icons.js';
import type { GlyphSize } from './Icons.js';
import { MomentCard } from './MomentCard.js';

/** Every glyph in the package is drawn the same way — DESIGN_SYSTEM.md §7. */
function expectSystemGlyph(svg: SVGSVGElement | null, label: string): void {
  expect(svg, label).not.toBeNull();
  expect(svg?.getAttribute('viewBox'), label).toBe('0 0 24 24');
  expect(svg?.getAttribute('stroke'), label).toBe('currentColor');
  expect(svg?.getAttribute('stroke-width'), label).toBe('1.75');
  expect(svg?.getAttribute('fill'), label).toBe('none');
  expect(svg?.getAttribute('aria-hidden'), label).toBe('true');
  expect(svg?.querySelector('title'), label).toBeNull();
}

describe('IntentIcon', () => {
  it('draws one glyph per content type, in the system stroke style', () => {
    expect(INTENT_NAMES).toEqual([
      'talking',
      'gaming',
      'podcast',
      'presentation',
      'event',
      'vertical',
    ]);

    for (const intent of INTENT_NAMES) {
      const { container, unmount } = render(<IntentIcon intent={intent} />);
      const svg = container.querySelector('svg');
      expectSystemGlyph(svg, intent);
      expect(svg?.getAttribute('data-intent'), intent).toBe(intent);
      expect(svg?.querySelectorAll('path, circle, rect').length, intent).toBeGreaterThan(0);
      unmount();
    }
  });

  it('renders at 20, 24 and 32 without rescaling the stroke', () => {
    for (const size of [20, 24, 32] as GlyphSize[]) {
      const { container, unmount } = render(<IntentIcon intent="gaming" size={size} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe(String(size));
      expect(svg?.getAttribute('height')).toBe(String(size));
      expect(svg?.getAttribute('stroke-width')).toBe('1.75');
      unmount();
    }
  });

  it('becomes an img with a name when given a title', () => {
    const { container, unmount } = render(<IntentIcon intent="podcast" title="Podcast" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.hasAttribute('aria-hidden')).toBe(false);
    expect(text(container.querySelector('title'))).toBe('Podcast');
    unmount();
  });

  it('keeps the caller class alongside lt-icon', () => {
    const { container, unmount } = render(<IntentIcon intent="event" className="lt-intent__art" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('lt-icon')).toBe(true);
    expect(svg?.classList.contains('lt-intent__art')).toBe(true);
    unmount();
  });
});

describe('MomentIcon', () => {
  it('draws a glyph for every built-in Moment, in the system stroke style', () => {
    expect(MOMENT_ICON_IDS).toEqual([
      'starting-soon',
      'main-camera',
      'screen-share',
      'guest',
      'break',
      'ending',
    ]);

    for (const moment of MOMENT_ICON_IDS) {
      const { container, unmount } = render(<MomentIcon moment={moment} />);
      const svg = container.querySelector('svg');
      expectSystemGlyph(svg, moment);
      expect(svg?.getAttribute('data-moment'), moment).toBe(moment);
      expect(svg?.querySelectorAll('path, circle, rect').length, moment).toBeGreaterThan(0);
      unmount();
    }
  });

  it('gives every built-in a drawing of its own', () => {
    const drawings = new Set<string>();
    for (const moment of MOMENT_ICON_IDS) {
      const { container, unmount } = render(<MomentIcon moment={moment} />);
      drawings.add(container.querySelector('svg')?.innerHTML ?? '');
      unmount();
    }
    expect(drawings.size).toBe(MOMENT_ICON_IDS.length);
  });

  it('falls back to the neutral glyph for a custom Moment', () => {
    const custom = render(<MomentIcon moment="my-cooking-corner" />);
    const svg = custom.container.querySelector('svg');
    expectSystemGlyph(svg, 'custom');
    expect(svg?.getAttribute('data-moment')).toBe('my-cooking-corner');
    const fallback = svg?.innerHTML ?? '';
    custom.unmount();

    // The same fallback for any unknown id, and never a built-in's drawing.
    const other = render(<MomentIcon moment="" />);
    expect(other.container.querySelector('svg')?.innerHTML).toBe(fallback);
    other.unmount();

    for (const moment of MOMENT_ICON_IDS) {
      const built = render(<MomentIcon moment={moment} />);
      expect(built.container.querySelector('svg')?.innerHTML, moment).not.toBe(fallback);
      built.unmount();
    }
  });

  it('reports which ids have a dedicated glyph', () => {
    expect(hasMomentGlyph('break')).toBe(true);
    expect(hasMomentGlyph('my-cooking-corner')).toBe(false);
    expect(hasMomentGlyph('toString')).toBe(false);
  });

  it('renders at 20, 24 and 32 and can carry a title', () => {
    for (const size of [20, 24, 32] as GlyphSize[]) {
      const { container, unmount } = render(<MomentIcon moment="break" size={size} />);
      expect(container.querySelector('svg')?.getAttribute('width')).toBe(String(size));
      unmount();
    }

    const titled = render(<MomentIcon moment="ending" title="Ending" />);
    expect(titled.container.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(text(titled.container.querySelector('title'))).toBe('Ending');
    titled.unmount();
  });

  it('leaves the closed 24-glyph system set untouched', () => {
    expect(ICON_NAMES).toHaveLength(24);
  });
});

describe('MomentCard icon', () => {
  it('prefers the icon node over the emoji string', () => {
    const { container, unmount } = render(
      <MomentCard
        icon={<MomentIcon moment="break" />}
        emoji="☕"
        name="Break"
        onSelect={() => {}}
      />,
    );
    const slot = container.querySelector('.lt-moment__icon');
    expect(slot?.querySelector('svg')).not.toBeNull();
    expect(slot?.classList.contains('lt-moment__icon--glyph')).toBe(true);
    expect(text(slot)).toBe('');
    expect(text(container.querySelector('button'))).not.toContain('☕');
    unmount();
  });

  it('still renders an emoji passed as icon (the pre-glyph path)', () => {
    const { container, unmount } = render(<MomentCard icon="☕" name="Break" onSelect={() => {}} />);
    const slot = container.querySelector('.lt-moment__icon');
    expect(text(slot)).toBe('☕');
    expect(slot?.classList.contains('lt-moment__icon--glyph')).toBe(false);
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    unmount();
  });

  it('renders the emoji prop when no icon node is given', () => {
    const { container, unmount } = render(<MomentCard emoji="🎥" name="Camera" onSelect={() => {}} />);
    expect(text(container.querySelector('.lt-moment__icon'))).toBe('🎥');
    unmount();
  });
});
