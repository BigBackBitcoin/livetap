import { describe, expect, it } from 'vitest';
import { DESTINATION_STATES } from '@livetap/core';
import type { DestinationState } from '@livetap/core';
import { render, text } from '../testing/render.js';
import { StatusChip, isPulsingState } from './StatusChip.js';
import { STATE_LABEL } from '../tokens.js';

describe('StatusChip', () => {
  it('renders the default label for every destination state', () => {
    for (const state of DESTINATION_STATES) {
      const { container, unmount } = render(<StatusChip state={state} />);
      const chip = container.querySelector('.lt-chip');
      expect(chip, state).not.toBeNull();
      expect(text(chip), state).toContain(STATE_LABEL[state]);
      unmount();
    }
  });

  it('applies the per-state class so each state gets its own colour pair', () => {
    for (const state of DESTINATION_STATES) {
      const { container, unmount } = render(<StatusChip state={state} />);
      const chip = container.querySelector('.lt-chip');
      expect(chip?.classList.contains(`lt-chip--${state.toLowerCase()}`), state).toBe(true);
      expect(chip?.getAttribute('data-state'), state).toBe(state);
      unmount();
    }
  });

  it('never relies on colour alone — the word is always in the DOM', () => {
    for (const state of DESTINATION_STATES) {
      const { container, unmount } = render(<StatusChip state={state} />);
      expect(text(container.querySelector('.lt-chip__label')).length, state).toBeGreaterThan(0);
      unmount();
    }
  });

  it('pulses the dot for LIVE and RECONNECTING only', () => {
    const pulsing: DestinationState[] = [];
    for (const state of DESTINATION_STATES) {
      const { container, unmount } = render(<StatusChip state={state} />);
      if (container.querySelector('.lt-dot--pulse')) pulsing.push(state);
      unmount();
    }
    expect(pulsing).toEqual(['LIVE', 'RECONNECTING']);
    expect(isPulsingState('LIVE')).toBe(true);
    expect(isPulsingState('READY')).toBe(false);
  });

  it('uses a hollow ring for DISCONNECTED and an alert glyph for FAILED', () => {
    const disconnected = render(<StatusChip state="DISCONNECTED" />);
    expect(disconnected.container.querySelector('.lt-dot--ring')).not.toBeNull();
    disconnected.unmount();

    const failed = render(<StatusChip state="FAILED" />);
    expect(failed.container.querySelector('.lt-dot')).toBeNull();
    expect(failed.container.querySelector('svg')).not.toBeNull();
    failed.unmount();
  });

  it('renders a custom label and the tiny status line', () => {
    const { container, unmount } = render(
      <StatusChip state="LIVE" label="Live" status="YouTube · 4,200 kbps" />,
    );
    expect(text(container.querySelector('.lt-chip__label'))).toBe('Live');
    expect(text(container.querySelector('.lt-chip__status'))).toBe('YouTube · 4,200 kbps');
    unmount();
  });

  it('shows a reconnect detail on one line, with the full text in a title', () => {
    const detail = 'Trying again in 4 s (attempt 2 of 10)';
    const { container, unmount } = render(
      <StatusChip state="RECONNECTING" detail={detail} />,
    );
    const line = container.querySelector('.lt-chip__status');
    expect(text(line)).toBe(detail);
    expect(line?.getAttribute('title')).toBe(detail);
    unmount();
  });

  it('prefers detail over status, and titles whichever line it renders', () => {
    const both = render(
      <StatusChip state="RECONNECTING" status="YouTube" detail="Trying again in 4 s" />,
    );
    expect(text(both.container.querySelector('.lt-chip__status'))).toBe('Trying again in 4 s');
    both.unmount();

    const statusOnly = render(<StatusChip state="LIVE" status="YouTube · 4,200 kbps" />);
    const line = statusOnly.container.querySelector('.lt-chip__status');
    expect(line?.getAttribute('title')).toBe('YouTube · 4,200 kbps');
    statusOnly.unmount();

    const neither = render(<StatusChip state="LIVE" />);
    expect(neither.container.querySelector('.lt-chip__status')).toBeNull();
    neither.unmount();
  });

  it('announces politely when asked to', () => {
    const { container, unmount } = render(<StatusChip state="DEGRADED" live />);
    expect(container.querySelector('.lt-chip')?.getAttribute('aria-live')).toBe('polite');
    unmount();
  });
});
