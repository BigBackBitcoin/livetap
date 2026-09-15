import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEATS, BEAT_MS, Tour, replayTour, tourAnswered } from '../components/Tour.js';
import { useAppStore } from '../state/store.js';
import { mount } from './helpers/render.js';

/**
 * The Quick Tour's contract, which is mostly a list of things it must NOT do.
 *
 * §26 gives it a syllabus and a budget: seven ideas, thirty seconds, skippable, and after it is
 * answered the product stops explaining itself. §18 gives it the rule that matters more than any
 * of those — END is always reachable — and an overlay is the classic way that rule gets broken
 * by accident six months later.
 */

const tourCss = readFileSync(
  resolve(process.cwd(), process.cwd().endsWith('web') ? 'src/components/tour.css' : 'apps/web/src/components/tour.css'),
  'utf8',
);

async function ready(): Promise<void> {
  await useAppStore.getState().init();
  useAppStore.setState({ onboardingDone: true });
}

describe('the quick tour', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('teaches the seven things the directive names, and nothing else', () => {
    expect(BEATS).toHaveLength(7);
    expect(BEATS.map((b) => b.title.toUpperCase())).toEqual([
      'CONNECT',
      'CAMERA',
      'MOMENT',
      'DESTINATION',
      'GO LIVE',
      'BREAK IT',
      'RECOVER',
    ]);
  });

  it('fits inside thirty seconds', () => {
    expect(BEATS.length * BEAT_MS).toBeLessThanOrEqual(30_000);
  });

  it('says one short thing per beat, never a paragraph', () => {
    for (const beat of BEATS) {
      expect(beat.line.split(/(?<=[.?!])\s/), `${beat.title} is one sentence`).toHaveLength(1);
      expect(beat.line.length, `${beat.title} is short`).toBeLessThanOrEqual(90);
      expect(beat.target.length, `${beat.title} points at a real control`).toBeGreaterThan(0);
    }
  });

  it('offers itself once, and never again once the offer is answered', async () => {
    await ready();

    const first = await mount(<Tour />);
    expect(first.text()).toContain('Thirty seconds');
    await first.click('No thanks');
    expect(first.text()).toBe('');
    await first.unmount();

    expect(tourAnswered()).toBe(true);

    // A remount is a reload: the offer must not come back.
    const second = await mount(<Tour />);
    expect(second.text()).toBe('');
    await second.unmount();
  });

  it('is dismissible at any beat, and dismissing it is permanent', async () => {
    await ready();

    const view = await mount(<Tour />);
    await view.click('Show me');
    expect(view.text()).toContain(BEATS[0]!.title);
    await view.click('Next');
    await view.click('Next');
    expect(view.text()).toContain(BEATS[2]!.title);
    await view.click('Skip');
    expect(view.text()).toBe('');
    await view.unmount();

    const again = await mount(<Tour />);
    expect(again.text()).toBe('');
    await again.unmount();
  });

  it('remembers the beat, so a reload resumes instead of restarting', async () => {
    await ready();

    const view = await mount(<Tour />);
    await view.click('Show me');
    await view.click('Next');
    await view.click('Next');
    await view.unmount();

    // Answered is still true and progress survives, so a remount lands where it left off.
    const resumed = await mount(<Tour />);
    expect(resumed.text()).toContain(BEATS[2]!.title);
    await resumed.unmount();
  });

  /*
   * The thirty-second budget is only real if the clock actually runs.
   *
   * The first build paused on hover and on focus, which meant clicking "Show me" left the
   * pointer over the card and the focus inside it and the tour paused itself on beat one. An
   * unattended run measured sixty seconds without finishing. Left alone, it must end.
   */
  it('runs itself to the end in its own time when nobody touches it', async () => {
    await ready();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const view = await mount(<Tour />);
      await view.click('Show me');
      expect(view.text()).toContain(BEATS[0]!.title);

      for (let beat = 1; beat < BEATS.length; beat += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(BEAT_MS);
        });
        expect(view.text(), `beat ${beat + 1}`).toContain(BEATS[beat]!.title);
      }

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_MS);
      });
      expect(view.text(), 'the last beat ends the tour').toBe('');
      await view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops advancing on its own the moment the creator presses something', async () => {
    await ready();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const view = await mount(<Tour />);
      await view.click('Show me');
      await view.click('Next');
      expect(view.text()).toContain(BEATS[1]!.title);

      // Four beats' worth of time passes and the tour does not move: it is being driven now.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_MS * 4);
      });
      expect(view.text()).toContain(BEATS[1]!.title);
      await view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  /*
   * The safety rule. §18: END is always reachable. The tour's first and strongest guarantee is
   * that it does not exist while there is anything to end — which is exactly when `LiveBar` does.
   */
  it('renders nothing at all while a broadcast is running', async () => {
    await ready();

    for (const state of ['STARTING', 'LIVE', 'STOPPING'] as const) {
      useAppStore.setState({ production: { ...useAppStore.getState().production, state } });
      const view = await mount(<Tour />);
      expect(view.text(), `${state} must have no tour on screen`).toBe('');
      expect(view.container.querySelector('[data-lt-tour]')).toBeNull();
      await view.unmount();
    }

    useAppStore.setState({ production: { ...useAppStore.getState().production, state: 'IDLE' } });
  });

  it('does not interrupt onboarding, which is already teaching', async () => {
    await useAppStore.getState().init();
    useAppStore.setState({ onboardingDone: false });
    const view = await mount(<Tour />);
    expect(view.text()).toBe('');
    await view.unmount();
    useAppStore.setState({ onboardingDone: true });
  });

  it('can be replayed from Settings once it has been answered', async () => {
    await ready();

    const view = await mount(<Tour />);
    await view.click('No thanks');
    await view.unmount();
    expect(tourAnswered()).toBe(true);

    replayTour();
    expect(tourAnswered()).toBe(false);

    const back = await mount(<Tour />);
    expect(back.text()).toContain('Thirty seconds');
    await back.unmount();
  });

  /*
   * Layout cannot be measured in happy-dom, so these two properties are asserted where they are
   * actually decided. Both are the difference between an offer and a modal, and both are what
   * keep the tour off the stop control even if someone later moves the card.
   */
  it('never blocks the product behind it, and never paints a scrim', () => {
    const layer = /\.lt-tour\s*\{([^}]*)\}/.exec(tourCss)?.[1] ?? '';
    expect(layer, '.lt-tour must exist').not.toBe('');
    expect(layer, 'the layer must not take clicks').toMatch(/pointer-events:\s*none/);
    expect(layer, 'the layer sits below the stop control in the stacking scale').toMatch(
      /z-index:\s*var\(--lt-z-golive\)/,
    );
    expect(tourCss, 'a tour that needs a scrim is a modal').not.toMatch(/scrim|backdrop|rgba\(/);
  });

  it('pins its card to the top, away from the edge the stop control owns', () => {
    const card = /\.lt-tour__card\s*\{([^}]*)\}/.exec(tourCss)?.[1] ?? '';
    expect(card).toMatch(/inset-block-start:/);
    expect(card, 'nothing in the tour may be anchored to the bottom edge').not.toMatch(
      /inset-block-end:/,
    );
    expect(card, 'only the card takes clicks').toMatch(/pointer-events:\s*auto/);
  });
});
