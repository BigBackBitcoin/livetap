/**
 * Every component renders, and the accessibility floor from DESIGN_SYSTEM.md §10.1
 * holds for each one.
 */

import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { render, text } from '../testing/render.js';
import { ICON_NAMES, Icons } from './Icons.js';
import { Badge } from './Badge.js';
import { Banner } from './Banner.js';
import { Button } from './Button.js';
import { Card } from './Card.js';
import { ErrorCard } from './ErrorCard.js';
import { GoLiveButton } from './GoLiveButton.js';
import { HealthPill } from './HealthPill.js';
import { IconButton } from './IconButton.js';
import { Kbd } from './Kbd.js';
import { Logo } from './Logo.js';
import { Meter } from './Meter.js';
import { MomentCard } from './MomentCard.js';
import { Select } from './Select.js';
import { Sheet } from './Sheet.js';
import { Spinner } from './Spinner.js';
import { StatusChip } from './StatusChip.js';
import { Tabs } from './Tabs.js';
import { TextField } from './TextField.js';
import { Toggle } from './Toggle.js';
import { Tooltip } from './Tooltip.js';
import { VisuallyHidden } from './VisuallyHidden.js';
import type { ButtonVariant, ButtonSize } from './Button.js';
import type { HealthLevel } from '@livetap/core';

const cases: Array<[string, ReactElement]> = [
  ['Badge', <Badge tone="info">Connect with account</Badge>],
  [
    'Banner',
    <Banner tone="info" title="Mock mode">
      These destinations are simulated. Nothing is broadcast anywhere.
    </Banner>,
  ],
  ['Button', <Button variant="primary">Continue</Button>],
  ['Card', <Card title="Camera">Logitech StreamCam</Card>],
  [
    'ErrorCard',
    <ErrorCard
      error={{
        code: 'INGEST_DISCONNECTED',
        what: 'Twitch stopped receiving your stream.',
        why: 'Your upload dropped out for more than 5 seconds.',
        doing: 'LIVETAP is reconnecting. Attempt 2 of 8.',
        youCan: 'Stay put — if it fails, we will tell you what to change.',
        recoverable: true,
      }}
    />,
  ],
  ['GoLiveButton', <GoLiveButton state="idle" />],
  ['HealthPill', <HealthPill level="good" detail="Everything is keeping up." />],
  [
    'IconButton',
    <IconButton label="Mute microphone">
      <Icons.mic size={24} />
    </IconButton>,
  ],
  ['Kbd', <Kbd>Esc</Kbd>],
  ['Logo', <Logo />],
  ['Meter', <Meter value={0.42} label="Microphone level" peak={0.61} />],
  ['MomentCard', <MomentCard icon="🎥" name="Main Camera" onSelect={() => {}} />],
  [
    'Select',
    <Select
      label="Camera"
      options={[
        { value: 'a', label: 'FaceTime HD Camera' },
        { value: 'b', label: 'StreamCam' },
      ]}
    />,
  ],
  ['Spinner', <Spinner />],
  ['StatusChip', <StatusChip state="READY" status="YouTube" />],
  [
    'Tabs',
    <Tabs
      label="Studio dock"
      value="chat"
      onValueChange={() => {}}
      tabs={[
        { id: 'chat', label: 'Chat', content: <p>No messages yet.</p> },
        { id: 'destinations', label: 'Destinations', content: <p>1 ready.</p> },
      ]}
    />,
  ],
  ['TextField', <TextField label="Stream key" mono hint="Pasted keys are stored in your keychain." />],
  [
    'Toggle',
    <Toggle pressed onPressedChange={() => {}}>
      Record this broadcast
    </Toggle>,
  ],
  [
    'Tooltip',
    <Tooltip label="Share your screen">
      <IconButton label="Share screen">
        <Icons.screen size={24} />
      </IconButton>
    </Tooltip>,
  ],
  ['VisuallyHidden', <VisuallyHidden>You are live.</VisuallyHidden>],
];

describe('component smoke', () => {
  for (const [name, element] of cases) {
    it(`${name} renders`, () => {
      const { container, unmount } = render(element);
      expect(container.childElementCount, name).toBeGreaterThan(0);
      unmount();
    });
  }

  it('Sheet renders into a portal', () => {
    const { unmount } = render(
      <Sheet open onClose={() => {}} title="Add destination">
        <p>Pick a platform.</p>
      </Sheet>,
    );
    expect(document.querySelector('.lt-sheet')).not.toBeNull();
    unmount();
  });

  it('every icon-only control has an accessible name', () => {
    const { container, unmount } = render(
      <IconButton label="Stop broadcasting">
        <Icons.stop size={24} />
      </IconButton>,
    );
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Stop broadcasting');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    unmount();
  });
});

describe('Button', () => {
  const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'live'];
  const sizes: ButtonSize[] = ['sm', 'md', 'lg'];

  it('renders every variant and size with the right classes', () => {
    for (const variant of variants) {
      for (const size of sizes) {
        const { container, unmount } = render(
          <Button variant={variant} size={size}>
            Go
          </Button>,
        );
        const button = container.querySelector('button');
        expect(button?.classList.contains(`lt-btn--${variant}`)).toBe(true);
        expect(button?.classList.contains(`lt-btn--${size}`)).toBe(true);
        expect(button?.classList.contains('lt-touch')).toBe(true);
        unmount();
      }
    }
  });

  it('keeps the label while loading, and is busy and disabled', () => {
    const { container, unmount } = render(
      <Button variant="primary" loading>
        Connecting
      </Button>,
    );
    const button = container.querySelector('button');
    expect(text(button)).toBe('Connecting');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.lt-spinner')).not.toBeNull();
    unmount();
  });
});

describe('Icons', () => {
  it('ships exactly the 24 documented glyphs', () => {
    expect(ICON_NAMES).toHaveLength(24);
  });

  it('renders each glyph as a 24x24 stroke-1.75 currentColor SVG', () => {
    for (const name of ICON_NAMES) {
      const Glyph = Icons[name];
      const { container, unmount } = render(<Glyph />);
      const svg = container.querySelector('svg');
      expect(svg, name).not.toBeNull();
      expect(svg?.getAttribute('viewBox'), name).toBe('0 0 24 24');
      expect(svg?.getAttribute('stroke'), name).toBe('currentColor');
      expect(svg?.getAttribute('stroke-width'), name).toBe('1.75');
      expect(svg?.getAttribute('aria-hidden'), name).toBe('true');
      unmount();
    }
  });

  it('becomes an img with a name when given a title', () => {
    const { container, unmount } = render(<Icons.alert title="Attention" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.hasAttribute('aria-hidden')).toBe(false);
    expect(text(container.querySelector('title'))).toBe('Attention');
    unmount();
  });

  it('renders at both documented sizes only', () => {
    for (const size of [20, 24] as const) {
      const { container, unmount } = render(<Icons.camera size={size} />);
      expect(container.querySelector('svg')?.getAttribute('width')).toBe(String(size));
      unmount();
    }
  });
});

describe('HealthPill', () => {
  const levels: HealthLevel[] = ['excellent', 'good', 'fair', 'poor', 'critical', 'unknown'];

  it('renders one word per level with the matching class', () => {
    const expected: Record<HealthLevel, string> = {
      excellent: 'Excellent',
      good: 'Good',
      fair: 'Fair',
      poor: 'Poor',
      critical: 'Critical',
      unknown: 'Checking',
    };
    for (const level of levels) {
      const { container, unmount } = render(<HealthPill level={level} />);
      const pill = container.querySelector('.lt-pill');
      expect(pill?.classList.contains(`lt-pill--${level}`), level).toBe(true);
      expect(text(pill), level).toContain(expected[level]);
      unmount();
    }
  });

  it('is only a button when there is something to expand', () => {
    const plain = render(<HealthPill level="good" />);
    expect(plain.container.querySelector('button')).toBeNull();
    plain.unmount();

    const expandable = render(<HealthPill level="poor" detail="Your upload is struggling." />);
    const button = expandable.container.querySelector('button');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBeTruthy();
    expandable.unmount();
  });
});

describe('Meter', () => {
  it('exposes the level to assistive technology', () => {
    const { container, unmount } = render(<Meter value={0.5} label="Microphone level" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-label')).toBe('Microphone level');
    expect(meter?.getAttribute('aria-valuenow')).toBe('50');
    expect(meter?.getAttribute('aria-valuemax')).toBe('100');
    unmount();
  });

  it('says "No signal" rather than showing a silently flat bar', () => {
    const { container, unmount } = render(<Meter value={0} label="Microphone level" silent />);
    expect(text(container.querySelector('.lt-meter__value'))).toBe('No signal');
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuetext')).toBe(
      'No signal',
    );
    unmount();
  });

  it('clamps out-of-range and non-finite values', () => {
    for (const [input, expected] of [
      [1.4, '100'],
      [-3, '0'],
      [Number.NaN, '0'],
    ] as const) {
      const { container, unmount } = render(<Meter value={input} label="Level" />);
      expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe(
        expected,
      );
      unmount();
    }
  });
});

describe('MomentCard', () => {
  it('uses aria-pressed for the active Moment', () => {
    const { container, unmount } = render(
      <MomentCard icon="☕" name="Break" active onSelect={() => {}} meta="Live now" />,
    );
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(text(container.querySelector('.lt-moment__name'))).toBe('Break');
    expect(container.querySelector('.lt-moment__icon')?.getAttribute('aria-hidden')).toBe('true');
    unmount();
  });
});

describe('TextField', () => {
  it('always renders a real label wired to the input', () => {
    const { container, unmount } = render(
      <TextField label="Stream key" hint="Never shown again after saving." />,
    );
    const input = container.querySelector('input');
    const label = container.querySelector('label');
    expect(label?.getAttribute('for')).toBe(input?.id);
    expect(text(label)).toBe('Stream key');
    expect(input?.getAttribute('aria-describedby')).toBe(container.querySelector('.lt-field__hint')?.id);
    unmount();
  });

  it('links its error message and announces it', () => {
    const { container, unmount } = render(
      <TextField label="Stream key" error="That key is missing a character." />,
    );
    const input = container.querySelector('input');
    const error = container.querySelector('.lt-field__error');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(input?.getAttribute('aria-describedby')).toBe(error?.id);
    unmount();
  });
});

describe('Tabs', () => {
  it('keeps exactly one tab in the tab order', () => {
    const { container, unmount } = render(
      <Tabs
        label="Studio dock"
        value="health"
        onValueChange={() => {}}
        tabs={[
          { id: 'chat', label: 'Chat', content: <p>a</p> },
          { id: 'destinations', label: 'Destinations', content: <p>b</p> },
          { id: 'health', label: 'Health', content: <p>c</p> },
        ]}
      />,
    );
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);

    const panel = container.querySelector('[role="tabpanel"]');
    expect(text(panel)).toBe('c');
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs[2]?.id);
    unmount();
  });
});

describe('Logo', () => {
  it('names itself and keeps the wordmark out of the accessibility tree twice', () => {
    const { container, unmount } = render(<Logo />);
    const root = container.querySelector('.lt-logo');
    expect(root?.getAttribute('role')).toBe('img');
    expect(root?.getAttribute('aria-label')).toBe('LIVETAP');
    expect(container.querySelector('.lt-logo__wordmark')?.getAttribute('aria-hidden')).toBe('true');
    unmount();
  });

  it('drops the wordmark in mark variant and scales the stroke with size', () => {
    const mark = render(<Logo variant="mark" size={20} />);
    expect(mark.container.querySelector('.lt-logo__wordmark')).toBeNull();
    expect(mark.container.querySelector('rect')?.getAttribute('stroke-width')).toBe('1.25');
    mark.unmount();

    const big = render(<Logo variant="mark" size={40} />);
    expect(big.container.querySelector('rect')?.getAttribute('stroke-width')).toBe('2.5');
    big.unmount();
  });
});

describe('Banner', () => {
  it('is permanent unless a dismiss handler is supplied', () => {
    const permanent = render(
      <Banner tone="info" title="Mock mode">
        Nothing is broadcast anywhere.
      </Banner>,
    );
    expect(permanent.container.querySelector('button')).toBeNull();
    permanent.unmount();

    const dismissible = render(
      <Banner tone="warning" onDismiss={() => {}}>
        Your upload is close to its limit.
      </Banner>,
    );
    expect(dismissible.container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Dismiss',
    );
    dismissible.unmount();
  });
});
