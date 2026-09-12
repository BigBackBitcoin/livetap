import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Onboarding } from '../screens/onboarding/Onboarding.js';
import { useAppStore } from '../state/store.js';
import { mount } from './helpers/render.js';

/**
 * The onboarding flow, exercised the way a person exercises it: by clicking things that have
 * accessible names. The assertions are about what a first-time creator can see and reach, not
 * about component internals.
 */
describe('intent-first onboarding', () => {
  beforeEach(async () => {
    localStorage.clear();
    await useAppStore.getState().init();
  });

  afterEach(async () => {
    for (const dest of useAppStore.getState().destinations) {
      await useAppStore.getState().removeDestination(dest.config.id);
    }
    localStorage.clear();
  });

  it('asks what you are making first, and offers all six intents with what you get', async () => {
    const view = await mount(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );

    const text = view.text();
    expect(text).toContain('What are you making?');
    expect(text).toContain('Step 1 of 3');
    for (const title of ['Talking', 'Gaming', 'Podcast', 'Presentation', 'Event', 'Vertical Live']) {
      expect(text).toContain(title);
    }
    // Each card states its payoff, not its mechanism.
    expect(text).toContain('Full-frame camera');
    await view.unmount();
  });

  it('never shows a protocol word on the way to Studio', async () => {
    const view = await mount(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );

    await view.click('Talking');
    await view.click('YouTube');
    await view.click('TikTok');
    await view.click('Continue');

    const banned = /\b(rtmps?|bitrate|codec|keyframe|scene|sources?|ingest|CBR|VBR|NVENC|x264)\b/i;
    expect(view.text()).not.toMatch(banned);
    await view.unmount();
  });

  it('states the honest connect method per platform, derived from the capability matrix', async () => {
    const view = await mount(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );
    await view.click('Talking');

    const text = view.text();
    expect(text).toContain('Where are you going live?');
    // YouTube's stream key is NATIVE_API — LIVETAP can get it for you.
    expect(text).toContain('Connect account');
    // TikTok's is USER_ASSISTED — you paste it.
    expect(text).toContain('Paste stream key');
    // LinkedIn is PARTNER_APPROVAL_REQUIRED — LIVETAP will not pretend.
    expect(text).toContain('Not available yet');
    await view.unmount();
  });

  it('reaches the setup summary with a per-destination shape after three clicks', async () => {
    const view = await mount(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );

    await view.click('Talking');
    await view.click('YouTube');
    await view.click('TikTok');
    await view.click('Continue');

    const text = view.text();
    expect(text).toContain('Here is your setup');
    // buildAutomaticProduction's explanation, rendered.
    expect(text).toContain('Talking');
    expect(text).toMatch(/One production, 2 formats/);
    // Per-destination aspect: "YouTube 16:9 · TikTok 9:16".
    expect(text).toContain('YouTube 16:9');
    expect(text).toContain('TikTok 9:16');
    // And exactly one way forward.
    expect(text).toContain('Open Studio');
    await view.unmount();
  });

  it('says what it is doing when there is no camera, instead of showing a black box', async () => {
    const view = await mount(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );
    await view.click('Talking');
    await view.click('YouTube');
    await view.click('Continue');

    expect(view.text()).toContain('No camera found — using a test pattern');
    await view.unmount();
  });

  it('will not continue without somewhere to go', async () => {
    const view = await mount(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );
    await view.click('Talking');

    const continueButton = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === 'Continue');
    expect(continueButton?.disabled).toBe(true);
    expect(view.text()).toContain('Pick one place to go live to continue.');
    await view.unmount();
  });
});
